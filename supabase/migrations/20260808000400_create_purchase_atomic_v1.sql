BEGIN;
-- The operation id is deliberately scoped to the authenticated creator and
-- branch. It is used only to make a transport-level retry return the one
-- purchase it already created; it is not part of receiving or stock movement.
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS creation_idempotency_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS purchases_branch_actor_creation_idempotency_uidx
  ON public.purchases (tenant_id, branch_id, added_by, creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;
-- purchase_items already invokes this helper through its scope trigger. The
-- existing implementation reads FOUND after dynamic EXECUTE, which PostgreSQL
-- does not update. Keep every validation decision identical, but use the
-- dynamic statement row count so an in-scope inventory line can be inserted.
CREATE OR REPLACE FUNCTION public.phase5e_assert_optional_branch_fk(
  p_table TEXT,
  p_id UUID,
  p_label TEXT,
  p_tenant_id UUID,
  p_branch_id UUID,
  p_allow_tenant_wide BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_has_branch_id BOOLEAN;
  v_row RECORD;
  v_row_count INTEGER;
  v_sql TEXT;
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;

  IF p_table NOT IN (
    'categories',
    'suppliers',
    'inventory_items',
    'products',
    'customers'
  ) THEN
    RAISE EXCEPTION 'Unsupported branch validation table.'
      USING ERRCODE = '22023';
  END IF;

  v_has_branch_id := public.phase5e_column_exists(p_table, 'branch_id');
  v_sql := CASE
    WHEN v_has_branch_id THEN format('SELECT tenant_id, branch_id FROM public.%I WHERE id = $1', p_table)
    ELSE format('SELECT tenant_id, NULL::uuid AS branch_id FROM public.%I WHERE id = $1', p_table)
  END;

  EXECUTE v_sql INTO v_row USING p_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 OR v_row.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION '% does not belong to this tenant.', p_label
      USING ERRCODE = '23514';
  END IF;

  IF v_row.branch_id IS NULL THEN
    IF p_allow_tenant_wide IS TRUE THEN
      RETURN;
    END IF;

    RAISE EXCEPTION '% must be branch-scoped.', p_label
      USING ERRCODE = '23514';
  END IF;

  IF v_row.branch_id IS DISTINCT FROM p_branch_id THEN
    RAISE EXCEPTION '% does not belong to this branch.', p_label
      USING ERRCODE = '23514';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.create_purchase_atomic_v1(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_supplier RECORD;
  v_inventory_item RECORD;
  v_existing RECORD;
  v_item JSONB;
  v_items JSONB;
  v_validated_items JSONB := '[]'::JSONB;
  v_branch_id UUID;
  v_supplier_id UUID;
  v_inventory_item_id UUID;
  v_purchase_id UUID;
  v_operation_id UUID;
  v_purchase_date DATE;
  v_tax_input_mode TEXT;
  v_payment_status TEXT;
  v_payment_method TEXT;
  v_bill_number TEXT;
  v_notes TEXT;
  v_branch_text TEXT;
  v_supplier_text TEXT;
  v_operation_text TEXT;
  v_purchase_date_text TEXT;
  v_inventory_item_text TEXT;
  v_supplier_item_name TEXT;
  v_line_name TEXT;
  v_quantity_text TEXT;
  v_unit_cost_text TEXT;
  v_quantity NUMERIC(12,3);
  v_unit_cost NUMERIC(12,2);
  v_line_total NUMERIC(12,2);
  v_raw_line_total NUMERIC := 0;
  v_subtotal NUMERIC(12,2);
  v_vat_amount NUMERIC(12,2);
  v_total_amount NUMERIC(12,2);
  v_line_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to create a purchase'
      USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Purchase payload must be a JSON object'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS payload_key(key_name)
    WHERE payload_key.key_name NOT IN (
      'branch_id', 'supplier_id', 'purchase_date', 'bill_number',
      'tax_input_mode', 'payment_status', 'payment_method', 'notes',
      'operation_id', 'items'
    )
  ) THEN
    RAISE EXCEPTION 'Purchase payload contains unsupported fields'
      USING ERRCODE = '22023';
  END IF;

  v_branch_text := NULLIF(BTRIM(COALESCE(p_payload ->> 'branch_id', '')), '');
  v_operation_text := NULLIF(BTRIM(COALESCE(p_payload ->> 'operation_id', '')), '');
  IF v_branch_text IS NULL OR v_operation_text IS NULL THEN
    RAISE EXCEPTION 'branch_id and operation_id are required'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_branch_id := v_branch_text::UUID;
    v_operation_id := v_operation_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'branch_id and operation_id must be UUID values'
      USING ERRCODE = '22023';
  END;

  SELECT id, tenant_id, branch_id, role, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caller profile was not found'
      USING ERRCODE = '42501';
  END IF;

  IF v_profile.is_active IS NOT TRUE OR v_profile.role::TEXT <> 'branch' THEN
    RAISE EXCEPTION 'Only an active branch user may create a purchase'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = v_branch_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch access is not permitted for this purchase'
      USING ERRCODE = '42501';
  END IF;

  IF v_branch.is_active IS NOT TRUE
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR v_profile.branch_id IS DISTINCT FROM v_branch_id THEN
    RAISE EXCEPTION 'Branch access is not permitted for this purchase'
      USING ERRCODE = '42501';
  END IF;

  -- A retry with the same operation id must not race into a second header.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_branch_id::TEXT || ':' || v_operation_id::TEXT, 0)
  );

  SELECT p.id, p.supplier_id, p.purchase_date, p.status, p.receiving_status,
         p.subtotal, p.vat_amount, p.total_amount
    INTO v_existing
  FROM public.purchases p
  WHERE p.tenant_id = v_branch.tenant_id
    AND p.branch_id = v_branch_id
    AND p.added_by = v_user_id
    AND p.creation_idempotency_key = v_operation_id;

  IF FOUND THEN
    SELECT COUNT(*) INTO v_line_count
    FROM public.purchase_items
    WHERE purchase_id = v_existing.id;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'purchase_id', v_existing.id,
      'branch_id', v_branch_id,
      'supplier_id', v_existing.supplier_id,
      'purchase_date', v_existing.purchase_date,
      'status', v_existing.status,
      'receiving_status', v_existing.receiving_status,
      'subtotal', v_existing.subtotal,
      'vat_amount', v_existing.vat_amount,
      'total_amount', v_existing.total_amount,
      'line_count', v_line_count,
      'idempotent_replay', TRUE
    );
  END IF;

  v_items := p_payload -> 'items';
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'At least one purchase item is required'
      USING ERRCODE = '22023';
  END IF;

  v_supplier_text := NULLIF(BTRIM(COALESCE(p_payload ->> 'supplier_id', '')), '');
  IF v_supplier_text IS NOT NULL THEN
    BEGIN
      v_supplier_id := v_supplier_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'supplier_id must be a UUID value'
        USING ERRCODE = '22023';
    END;

    SELECT id, tenant_id, branch_id, is_active
      INTO v_supplier
    FROM public.suppliers
    WHERE id = v_supplier_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Supplier is outside the active branch scope'
        USING ERRCODE = '42501';
    END IF;

    IF v_supplier.is_active IS NOT TRUE
       OR v_supplier.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_supplier.branch_id IS DISTINCT FROM v_branch_id THEN
      RAISE EXCEPTION 'Supplier is outside the active branch scope'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_purchase_date_text := NULLIF(BTRIM(COALESCE(p_payload ->> 'purchase_date', '')), '');
  IF v_purchase_date_text IS NULL THEN
    v_purchase_date := (timezone('Asia/Riyadh', now()))::DATE;
  ELSE
    BEGIN
      v_purchase_date := v_purchase_date_text::DATE;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'purchase_date must be an ISO date'
        USING ERRCODE = '22023';
    END;
  END IF;

  v_tax_input_mode := COALESCE(NULLIF(BTRIM(p_payload ->> 'tax_input_mode'), ''), 'included');
  IF v_tax_input_mode NOT IN ('included', 'excluded') THEN
    RAISE EXCEPTION 'tax_input_mode must be included or excluded'
      USING ERRCODE = '22023';
  END IF;

  v_payment_status := COALESCE(NULLIF(BTRIM(p_payload ->> 'payment_status'), ''), 'paid');
  IF v_payment_status NOT IN ('paid', 'unpaid', 'partial') THEN
    RAISE EXCEPTION 'payment_status is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_payment_method := COALESCE(NULLIF(BTRIM(p_payload ->> 'payment_method'), ''), 'cash');
  IF v_payment_method NOT IN ('cash', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'payment_method is invalid'
      USING ERRCODE = '22023';
  END IF;

  v_bill_number := NULLIF(BTRIM(p_payload ->> 'bill_number'), '');
  v_notes := NULLIF(BTRIM(p_payload ->> 'notes'), '');
  IF length(COALESCE(v_bill_number, '')) > 255 OR length(COALESCE(v_notes, '')) > 4000 THEN
    RAISE EXCEPTION 'Purchase reference or notes exceed the supported length'
      USING ERRCODE = '22023';
  END IF;

  -- Validate every line and compute totals before inserting a header. The
  -- subsequent inserts are still one database transaction if an unexpected
  -- constraint error occurs.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS source(value)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Each purchase item must be an object'
        USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(v_item) AS item_key(key_name)
      WHERE item_key.key_name NOT IN (
        'inventory_item_id', 'supplier_item_name', 'quantity', 'unit_cost'
      )
    ) THEN
      RAISE EXCEPTION 'Purchase item contains unsupported fields'
        USING ERRCODE = '22023';
    END IF;

    v_inventory_item_text := NULLIF(BTRIM(COALESCE(v_item ->> 'inventory_item_id', '')), '');
    v_supplier_item_name := NULLIF(BTRIM(v_item ->> 'supplier_item_name'), '');

    IF v_inventory_item_text IS NOT NULL THEN
      BEGIN
        v_inventory_item_id := v_inventory_item_text::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'inventory_item_id must be a UUID value'
          USING ERRCODE = '22023';
      END;

      SELECT id, tenant_id, branch_id, name
        INTO v_inventory_item
      FROM public.inventory_items
      WHERE id = v_inventory_item_id
      FOR KEY SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Inventory item is outside the active branch scope'
          USING ERRCODE = '42501';
      END IF;

      IF v_inventory_item.tenant_id IS DISTINCT FROM v_branch.tenant_id
         OR v_inventory_item.branch_id IS DISTINCT FROM v_branch_id THEN
        RAISE EXCEPTION 'Inventory item is outside the active branch scope'
          USING ERRCODE = '42501';
      END IF;

      v_line_name := BTRIM(v_inventory_item.name);
      v_supplier_item_name := COALESCE(v_supplier_item_name, v_line_name);
    ELSE
      v_inventory_item_id := NULL;
      v_line_name := v_supplier_item_name;
    END IF;

    IF v_line_name IS NULL OR length(v_line_name) = 0 OR length(v_line_name) > 255
       OR length(COALESCE(v_supplier_item_name, '')) > 255 THEN
      RAISE EXCEPTION 'Each purchase item requires a valid item name'
        USING ERRCODE = '22023';
    END IF;

    v_quantity_text := NULLIF(BTRIM(COALESCE(v_item ->> 'quantity', '')), '');
    v_unit_cost_text := NULLIF(BTRIM(COALESCE(v_item ->> 'unit_cost', '')), '');
    IF v_quantity_text IS NULL OR v_quantity_text !~ '^[0-9]+(\.[0-9]{1,3})?$'
       OR v_unit_cost_text IS NULL OR v_unit_cost_text !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Each purchase item requires non-negative decimal quantity and unit_cost'
        USING ERRCODE = '22023';
    END IF;

    v_quantity := v_quantity_text::NUMERIC(12,3);
    v_unit_cost := v_unit_cost_text::NUMERIC(12,2);
    IF v_quantity <= 0 OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Purchase quantity must be positive and unit_cost cannot be negative'
        USING ERRCODE = '22023';
    END IF;

    v_line_total := ROUND(v_quantity * v_unit_cost, 2)::NUMERIC(12,2);
    v_raw_line_total := v_raw_line_total + (v_quantity * v_unit_cost);
    v_line_count := v_line_count + 1;
    v_validated_items := v_validated_items || jsonb_build_array(jsonb_build_object(
      'inventory_item_id', v_inventory_item_id,
      'name', v_line_name,
      'supplier_item_name', v_supplier_item_name,
      'line_type', CASE WHEN v_inventory_item_id IS NULL THEN 'non_stock' ELSE 'stock' END,
      'match_source', CASE WHEN v_inventory_item_id IS NULL THEN 'none' ELSE 'manual' END,
      'quantity', v_quantity,
      'unit_cost', v_unit_cost,
      'total', v_line_total
    ));
  END LOOP;

  IF v_tax_input_mode = 'included' THEN
    v_total_amount := ROUND(v_raw_line_total, 2)::NUMERIC(12,2);
    v_vat_amount := ROUND(v_total_amount * 15 / 115, 2)::NUMERIC(12,2);
    v_subtotal := ROUND(v_total_amount - v_vat_amount, 2)::NUMERIC(12,2);
  ELSE
    v_subtotal := ROUND(v_raw_line_total, 2)::NUMERIC(12,2);
    v_vat_amount := ROUND(v_subtotal * 0.15, 2)::NUMERIC(12,2);
    v_total_amount := ROUND(v_subtotal + v_vat_amount, 2)::NUMERIC(12,2);
  END IF;

  INSERT INTO public.purchases (
    tenant_id, branch_id, supplier_id, added_by, purchase_date, purchase_mode,
    status, receiving_status, bill_number, tax_input_mode, payment_status,
    payment_method, notes, subtotal, vat_amount, total_amount,
    creation_idempotency_key
  ) VALUES (
    v_branch.tenant_id, v_branch_id, v_supplier_id, v_user_id, v_purchase_date,
    'detailed_receiving', 'draft', 'pending_confirmation', v_bill_number,
    v_tax_input_mode, v_payment_status, v_payment_method, v_notes, v_subtotal,
    v_vat_amount, v_total_amount, v_operation_id
  )
  ON CONFLICT (tenant_id, branch_id, added_by, creation_idempotency_key)
    WHERE creation_idempotency_key IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_purchase_id;

  IF v_purchase_id IS NULL THEN
    SELECT p.id, p.supplier_id, p.purchase_date, p.status, p.receiving_status,
           p.subtotal, p.vat_amount, p.total_amount
      INTO v_existing
    FROM public.purchases p
    WHERE p.tenant_id = v_branch.tenant_id
      AND p.branch_id = v_branch_id
      AND p.added_by = v_user_id
      AND p.creation_idempotency_key = v_operation_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Could not create or recover the purchase'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*) INTO v_line_count
    FROM public.purchase_items
    WHERE purchase_id = v_existing.id;

    RETURN jsonb_build_object(
      'ok', TRUE,
      'purchase_id', v_existing.id,
      'branch_id', v_branch_id,
      'supplier_id', v_existing.supplier_id,
      'purchase_date', v_existing.purchase_date,
      'status', v_existing.status,
      'receiving_status', v_existing.receiving_status,
      'subtotal', v_existing.subtotal,
      'vat_amount', v_existing.vat_amount,
      'total_amount', v_existing.total_amount,
      'line_count', v_line_count,
      'idempotent_replay', TRUE
    );
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_validated_items) AS source(value)
  LOOP
    INSERT INTO public.purchase_items (
      purchase_id, inventory_item_id, name, supplier_item_name, line_type,
      receiving_status, received_quantity, match_source, quantity, unit_cost, total
    ) VALUES (
      v_purchase_id,
      NULLIF(v_item ->> 'inventory_item_id', '')::UUID,
      v_item ->> 'name',
      v_item ->> 'supplier_item_name',
      v_item ->> 'line_type',
      'pending',
      0,
      v_item ->> 'match_source',
      (v_item ->> 'quantity')::NUMERIC(12,3),
      (v_item ->> 'unit_cost')::NUMERIC(12,2),
      (v_item ->> 'total')::NUMERIC(12,2)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'purchase_id', v_purchase_id,
    'branch_id', v_branch_id,
    'supplier_id', v_supplier_id,
    'purchase_date', v_purchase_date,
    'status', 'draft',
    'receiving_status', 'pending_confirmation',
    'subtotal', v_subtotal,
    'vat_amount', v_vat_amount,
    'total_amount', v_total_amount,
    'line_count', v_line_count,
    'idempotent_replay', FALSE
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_purchase_atomic_v1(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_atomic_v1(JSONB) TO authenticated;
COMMENT ON FUNCTION public.create_purchase_atomic_v1(JSONB) IS
  'Atomically creates one detailed-receiving purchase and its pending lines for an active branch user. It never receives stock.';
NOTIFY pgrst, 'reload schema';
COMMIT;
