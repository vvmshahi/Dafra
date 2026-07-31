BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- A purchase operation is deliberately separate from purchases: legacy web
-- creation remains intact, while this new RPC gets durable replay semantics.
CREATE TABLE public.purchase_posting_operations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  request_fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  purchase_id uuid REFERENCES public.purchases(id) ON DELETE RESTRICT,
  result jsonb,
  created_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_posting_operations_state_check
    CHECK (state IN ('pending', 'completed', 'failed')),
  CONSTRAINT purchase_posting_operations_fingerprint_check
    CHECK (length(request_fingerprint) = 64),
  CONSTRAINT purchase_posting_operations_completed_result_check
    CHECK (
      state <> 'completed'
      OR (purchase_id IS NOT NULL AND result IS NOT NULL AND completed_at IS NOT NULL)
    ),
  CONSTRAINT purchase_posting_operations_operation_scope_uidx
    UNIQUE (branch_id, operation_id)
);

CREATE INDEX purchase_posting_operations_tenant_branch_created_idx
  ON public.purchase_posting_operations (tenant_id, branch_id, created_at DESC);

COMMENT ON TABLE public.purchase_posting_operations IS
  'Durable idempotency and reconciliation records for post_purchase_receiving_v1. A completed operation stores only its stable response, never the original purchase payload.';

COMMENT ON COLUMN public.purchase_posting_operations.request_fingerprint IS
  'SHA-256 of the server-normalized request semantic fields. Reusing an operation ID with a different fingerprint is rejected.';

-- Phase 1 reserved saleable-product snapshot columns for this later package
-- receiving flow. Legacy inventory movements keep their non-null inventory id;
-- new product movements use product_id/product_unit_id and no inventory target.
ALTER TABLE public.purchase_stock_movements
  ALTER COLUMN inventory_item_id DROP NOT NULL;

ALTER TABLE public.purchase_stock_movements
  ADD CONSTRAINT purchase_stock_movements_target_reference_check
  CHECK (
    (stock_target_type IS NULL AND inventory_item_id IS NOT NULL AND product_id IS NULL)
    OR (stock_target_type = 'inventory_item' AND inventory_item_id IS NOT NULL AND product_id IS NULL)
    OR (stock_target_type = 'saleable_product' AND product_id IS NOT NULL AND inventory_item_id IS NULL)
  ) NOT VALID;

COMMENT ON CONSTRAINT purchase_stock_movements_target_reference_check
  ON public.purchase_stock_movements IS
  'Legacy rows continue to use inventory_item_id. New package-aware receiving rows use exactly one explicit stock target.';

ALTER TABLE public.purchase_posting_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY purchase_posting_operations_service_role_all
  ON public.purchase_posting_operations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.purchase_posting_operations
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.purchase_posting_operations
  TO service_role;

CREATE OR REPLACE FUNCTION public.post_purchase_receiving_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_scope record;
  v_supplier record;
  v_product record;
  v_existing public.purchase_posting_operations%ROWTYPE;
  v_operation_id uuid;
  v_branch_id uuid;
  v_supplier_id uuid;
  v_purchase_date date;
  v_action text;
  v_tax_input_mode text;
  v_payment_status text;
  v_payment_method text;
  v_bill_number text;
  v_notes text;
  v_lines jsonb;
  v_raw_line jsonb;
  v_canonical_lines jsonb := '[]'::jsonb;
  v_canonical_payload jsonb;
  v_request_fingerprint text;
  v_expected_totals jsonb;
  v_expected_subtotal numeric(12,2);
  v_expected_vat_amount numeric(12,2);
  v_expected_total_amount numeric(12,2);
  v_purchase_id uuid;
  v_purchase_item_id uuid;
  v_product_id uuid;
  v_product_unit_id uuid;
  v_expected_product_unit_version integer;
  v_package_quantity numeric(18,6);
  v_package_unit_cost numeric(14,2);
  v_base_quantity numeric(18,6);
  v_base_unit_cost numeric(18,6);
  v_line_total numeric(12,2);
  v_line_vat_amount numeric(12,2);
  v_raw_total numeric(12,2) := 0;
  v_subtotal numeric(12,2);
  v_vat_amount numeric(12,2);
  v_total_amount numeric(12,2);
  v_receipt_result jsonb;
  v_result jsonb;
  v_now timestamptz := now();
  v_line_count integer := 0;
  v_stock_lines integer := 0;
  v_non_stock_lines integer := 0;
  v_line_sequence integer := 0;
  v_line_key text;
  v_receipt_reference text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PPC02', MESSAGE = 'PURCHASE_UNAUTHORIZED';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'PPC01', MESSAGE = 'PURCHASE_INVALID_PAYLOAD';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'operation_id', 'branch_id', 'supplier_id', 'purchase_date',
      'bill_number', 'notes', 'payment_method', 'payment_status',
      'tax_input_mode', 'action', 'lines', 'expected_totals'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PPC01', MESSAGE = 'PURCHASE_INVALID_PAYLOAD';
  END IF;

  IF jsonb_typeof(p_payload -> 'operation_id') <> 'string'
     OR jsonb_typeof(p_payload -> 'branch_id') <> 'string'
     OR jsonb_typeof(p_payload -> 'supplier_id') <> 'string'
     OR jsonb_typeof(p_payload -> 'purchase_date') <> 'string'
     OR jsonb_typeof(p_payload -> 'action') <> 'string'
     OR jsonb_typeof(p_payload -> 'lines') <> 'array'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PPC01', MESSAGE = 'PURCHASE_INVALID_PAYLOAD';
  END IF;

  BEGIN
    v_operation_id := NULLIF(btrim(p_payload ->> 'operation_id'), '')::uuid;
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_supplier_id := NULLIF(btrim(p_payload ->> 'supplier_id'), '')::uuid;
    v_purchase_date := NULLIF(btrim(p_payload ->> 'purchase_date'), '')::date;
  EXCEPTION
    WHEN invalid_text_representation OR datetime_field_overflow THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC01', MESSAGE = 'PURCHASE_INVALID_PAYLOAD';
  END;

  v_action := NULLIF(btrim(p_payload ->> 'action'), '');
  v_tax_input_mode := COALESCE(NULLIF(btrim(p_payload ->> 'tax_input_mode'), ''), 'included');
  v_payment_status := COALESCE(NULLIF(btrim(p_payload ->> 'payment_status'), ''), 'paid');
  v_payment_method := COALESCE(NULLIF(btrim(p_payload ->> 'payment_method'), ''), 'cash');
  v_bill_number := NULLIF(btrim(p_payload ->> 'bill_number'), '');
  v_notes := NULLIF(btrim(p_payload ->> 'notes'), '');
  v_lines := p_payload -> 'lines';

  IF v_operation_id IS NULL
     OR v_branch_id IS NULL
     OR v_supplier_id IS NULL
     OR v_purchase_date IS NULL
     OR v_action <> 'receive'
     OR jsonb_array_length(v_lines) NOT BETWEEN 1 AND 100
     OR v_tax_input_mode NOT IN ('included', 'excluded')
     OR v_payment_status NOT IN ('paid', 'unpaid', 'partial')
     OR v_payment_method NOT IN ('cash', 'card', 'bank_transfer')
     OR (v_bill_number IS NOT NULL AND length(v_bill_number) > 120)
     OR (v_notes IS NOT NULL AND length(v_notes) > 1000)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PPC09', MESSAGE = 'PURCHASE_VALIDATION_FAILED';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
  INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'PPC02', MESSAGE = 'PURCHASE_UNAUTHORIZED';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active AS branch_is_active, t.is_active AS tenant_is_active
  INTO v_scope
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = v_branch_id;

  IF NOT FOUND OR v_scope.branch_is_active IS NOT TRUE OR v_scope.tenant_is_active IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'PPC03', MESSAGE = 'PURCHASE_BRANCH_MISMATCH';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_scope.tenant_id THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC03', MESSAGE = 'PURCHASE_BRANCH_MISMATCH';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_scope.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_scope.id
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC03', MESSAGE = 'PURCHASE_BRANCH_MISMATCH';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = 'PPC02', MESSAGE = 'PURCHASE_UNAUTHORIZED';
  END IF;

  SELECT id, tenant_id, branch_id, is_active
  INTO v_supplier
  FROM public.suppliers
  WHERE id = v_supplier_id;

  IF NOT FOUND OR v_supplier.is_active IS NOT TRUE
     OR v_supplier.tenant_id IS DISTINCT FROM v_scope.tenant_id
     OR v_supplier.branch_id IS DISTINCT FROM v_scope.id
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PPC04', MESSAGE = 'PURCHASE_INVALID_SUPPLIER';
  END IF;

  -- Parse only client semantic inputs before reservation. Calculated totals,
  -- quantities in base units and stock targets are always recomputed below.
  FOR v_raw_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    IF jsonb_typeof(v_raw_line) <> 'object'
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(v_raw_line) AS key_name
         WHERE key_name NOT IN (
           'product_id', 'product_unit_id', 'expected_product_unit_version',
           'quantity', 'unit_cost'
         )
       )
       OR jsonb_typeof(v_raw_line -> 'product_id') <> 'string'
       OR (v_raw_line ? 'product_unit_id' AND jsonb_typeof(v_raw_line -> 'product_unit_id') NOT IN ('string', 'null'))
       OR jsonb_typeof(v_raw_line -> 'expected_product_unit_version') <> 'number'
       OR jsonb_typeof(v_raw_line -> 'quantity') <> 'number'
       OR jsonb_typeof(v_raw_line -> 'unit_cost') <> 'number'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC01', MESSAGE = 'PURCHASE_INVALID_PAYLOAD';
    END IF;

    BEGIN
      v_product_id := NULLIF(btrim(v_raw_line ->> 'product_id'), '')::uuid;
      v_product_unit_id := NULLIF(btrim(v_raw_line ->> 'product_unit_id'), '')::uuid;
      v_expected_product_unit_version := (v_raw_line ->> 'expected_product_unit_version')::integer;
      v_package_quantity := (v_raw_line ->> 'quantity')::numeric;
      v_package_unit_cost := (v_raw_line ->> 'unit_cost')::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE = 'PPC01', MESSAGE = 'PURCHASE_INVALID_PAYLOAD';
    END;

    IF v_product_id IS NULL
       OR v_expected_product_unit_version IS NULL
       OR v_expected_product_unit_version <= 0
       OR v_package_quantity IS NULL
       OR v_package_quantity <= 0
       OR v_package_quantity > 999999999999::numeric
       OR v_package_unit_cost IS NULL
       OR v_package_unit_cost < 0
       OR round(v_package_unit_cost, 2) <> v_package_unit_cost
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC09', MESSAGE = 'PURCHASE_VALIDATION_FAILED';
    END IF;

    v_canonical_lines := v_canonical_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'product_unit_id', v_product_unit_id,
      'expected_product_unit_version', v_expected_product_unit_version,
      'quantity', trim_scale(v_package_quantity),
      'unit_cost', trim_scale(v_package_unit_cost)
    ));
  END LOOP;

  SELECT jsonb_agg(value ORDER BY
    value ->> 'product_id',
    COALESCE(value ->> 'product_unit_id', ''),
    (value ->> 'expected_product_unit_version')::integer,
    (value ->> 'quantity')::numeric,
    (value ->> 'unit_cost')::numeric
  )
  INTO v_canonical_lines
  FROM jsonb_array_elements(v_canonical_lines);

  v_canonical_payload := jsonb_build_object(
    'action', v_action,
    'branch_id', v_scope.id,
    'supplier_id', v_supplier.id,
    'purchase_date', to_char(v_purchase_date, 'YYYY-MM-DD'),
    'bill_number', v_bill_number,
    'notes', v_notes,
    'payment_method', v_payment_method,
    'payment_status', v_payment_status,
    'tax_input_mode', v_tax_input_mode,
    'lines', v_canonical_lines
  );
  v_request_fingerprint := encode(
    extensions.digest(convert_to(v_canonical_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  IF p_payload ? 'expected_totals' THEN
    v_expected_totals := p_payload -> 'expected_totals';
    IF jsonb_typeof(v_expected_totals) <> 'object'
       OR EXISTS (
         SELECT 1
         FROM jsonb_object_keys(v_expected_totals) AS key_name
         WHERE key_name NOT IN ('subtotal', 'vat_amount', 'total_amount')
       )
       OR jsonb_typeof(v_expected_totals -> 'subtotal') <> 'number'
       OR jsonb_typeof(v_expected_totals -> 'vat_amount') <> 'number'
       OR jsonb_typeof(v_expected_totals -> 'total_amount') <> 'number'
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC01', MESSAGE = 'PURCHASE_INVALID_PAYLOAD';
    END IF;
    BEGIN
      v_expected_subtotal := (v_expected_totals ->> 'subtotal')::numeric;
      v_expected_vat_amount := (v_expected_totals ->> 'vat_amount')::numeric;
      v_expected_total_amount := (v_expected_totals ->> 'total_amount')::numeric;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE = 'PPC01', MESSAGE = 'PURCHASE_INVALID_PAYLOAD';
    END;
  END IF;

  -- This lock serializes every same-operation request before the operation
  -- row is inspected. It also makes a concurrent replay return the committed
  -- result rather than racing the unique index.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('purchase-posting:' || v_scope.id::text || ':' || v_operation_id::text, 0)
  );

  SELECT *
  INTO v_existing
  FROM public.purchase_posting_operations
  WHERE branch_id = v_scope.id
    AND operation_id = v_operation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC06', MESSAGE = 'PURCHASE_IDEMPOTENCY_CONFLICT';
    END IF;
    IF v_existing.state = 'completed' THEN
      RETURN v_existing.result || jsonb_build_object('idempotent_replay', true);
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'PPC07', MESSAGE = 'PURCHASE_OPERATION_IN_PROGRESS';
  END IF;

  INSERT INTO public.purchase_posting_operations (
    tenant_id, branch_id, operation_id, request_fingerprint, state, created_by
  ) VALUES (
    v_scope.tenant_id, v_scope.id, v_operation_id, v_request_fingerprint, 'pending', v_user_id
  );

  INSERT INTO public.purchases (
    tenant_id, branch_id, supplier_id, added_by, purchase_date,
    purchase_mode, status, receiving_status, bill_number, tax_input_mode,
    payment_status, payment_method, notes, subtotal, vat_amount, total_amount,
    received_at, received_by, created_at, updated_at
  ) VALUES (
    v_scope.tenant_id, v_scope.id, v_supplier.id, v_user_id, v_purchase_date,
    'detailed_receiving', 'posted', 'confirmed', v_bill_number, v_tax_input_mode,
    v_payment_status, v_payment_method, v_notes, 0, 0, 0,
    v_now, v_user_id, v_now, v_now
  )
  RETURNING id INTO v_purchase_id;

  FOR v_raw_line IN
    SELECT value
    FROM jsonb_array_elements(v_canonical_lines)
    ORDER BY
      value ->> 'product_id',
      COALESCE(value ->> 'product_unit_id', ''),
      (value ->> 'expected_product_unit_version')::integer,
      (value ->> 'quantity')::numeric,
      (value ->> 'unit_cost')::numeric
  LOOP
    v_line_sequence := v_line_sequence + 1;
    v_product_id := (v_raw_line ->> 'product_id')::uuid;
    v_product_unit_id := NULLIF(v_raw_line ->> 'product_unit_id', '')::uuid;
    v_expected_product_unit_version := (v_raw_line ->> 'expected_product_unit_version')::integer;
    v_package_quantity := (v_raw_line ->> 'quantity')::numeric;
    v_package_unit_cost := (v_raw_line ->> 'unit_cost')::numeric;

    -- Lock in product/base-unit/unit order. Re-validating here keeps the
    -- snapshots correct if a unit changed after payload normalization.
    SELECT
      p.id AS product_id,
      p.tenant_id,
      p.branch_id,
      p.name AS product_name,
      p.track_stock,
      p.is_service,
      p.is_active AS product_active,
      u.id AS product_unit_id,
      u.version AS product_unit_version,
      u.name AS purchase_unit_name,
      u.unit_code AS package_unit_code,
      u.quantity_scale AS package_quantity_scale,
      u.conversion_to_base,
      u.is_active AS unit_active,
      u.receiving_enabled,
      b.name AS base_unit_name,
      b.unit_code AS base_unit_code,
      b.quantity_scale AS base_quantity_scale
    INTO v_product
    FROM public.products p
    JOIN public.product_units b
      ON b.product_id = p.id
     AND b.tenant_id = p.tenant_id
     AND b.branch_id = p.branch_id
     AND b.is_base IS TRUE
    JOIN public.product_units u
      ON u.id = COALESCE(v_product_unit_id, b.id)
     AND u.product_id = p.id
     AND u.tenant_id = p.tenant_id
     AND u.branch_id = p.branch_id
    WHERE p.id = v_product_id
      AND p.tenant_id = v_scope.tenant_id
      AND p.branch_id = v_scope.id
    ORDER BY p.id, b.id, u.id
    FOR UPDATE OF p, b, u;

    IF NOT FOUND
       OR v_product.product_active IS NOT TRUE
       OR v_product.unit_active IS NOT TRUE
       OR v_product.receiving_enabled IS NOT TRUE
       OR v_product.product_unit_version IS DISTINCT FROM v_expected_product_unit_version
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC05', MESSAGE = 'PURCHASE_INVALID_PRODUCT_UNIT';
    END IF;

    IF round(v_package_quantity, v_product.package_quantity_scale) <> v_package_quantity THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC09', MESSAGE = 'PURCHASE_VALIDATION_FAILED';
    END IF;

    v_base_quantity := v_package_quantity * v_product.conversion_to_base;
    IF v_base_quantity <= 0
       OR v_base_quantity > 999999999.999::numeric
       OR round(v_base_quantity, LEAST(v_product.base_quantity_scale, 3)) <> v_base_quantity
    THEN
      RAISE EXCEPTION USING ERRCODE = 'PPC09', MESSAGE = 'PURCHASE_VALIDATION_FAILED';
    END IF;

    v_line_total := round(v_package_quantity * v_package_unit_cost, 2);
    v_line_vat_amount := CASE
      WHEN v_tax_input_mode = 'included' THEN round(v_line_total * 15 / 115, 2)
      ELSE round(v_line_total * 0.15, 2)
    END;
    v_raw_total := v_raw_total + v_line_total;

    IF COALESCE(v_product.track_stock, false) IS TRUE
       AND COALESCE(v_product.is_service, false) IS FALSE
    THEN
      IF public.branch_effective_stock_enabled(v_scope.tenant_id, v_scope.id) IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'PPC09', MESSAGE = 'PURCHASE_STOCK_DISABLED';
      END IF;

      INSERT INTO public.purchase_items (
        purchase_id, product_id, product_unit_id, product_unit_version,
        stock_target_type, name, supplier_item_name, line_type,
        receiving_status, received_quantity, match_source, quantity,
        unit_cost, total, tax_rate, vat_amount, package_quantity,
        conversion_to_base, base_quantity, purchase_unit_name, base_unit_name,
        package_unit_code, base_unit_code, package_unit_cost, base_unit_cost
      ) VALUES (
        v_purchase_id, v_product.product_id, v_product.product_unit_id, v_product.product_unit_version,
        'saleable_product', v_product.product_name, v_product.product_name, 'stock',
        'pending', 0, 'manual', v_package_quantity,
        v_package_unit_cost, v_line_total, 15, v_line_vat_amount, v_package_quantity,
        v_product.conversion_to_base, v_base_quantity, v_product.purchase_unit_name, v_product.base_unit_name,
        v_product.package_unit_code, v_product.base_unit_code, v_package_unit_cost,
        round(v_package_unit_cost / v_product.conversion_to_base, 6)
      )
      RETURNING id INTO v_purchase_item_id;

      v_line_key := 'purchase:' || v_operation_id::text || ':' || v_line_sequence::text;
      v_receipt_reference := v_purchase_id::text || ':' || v_purchase_item_id::text;
      v_receipt_result := public.receive_product_stock_with_units_v1(jsonb_build_object(
        'product_id', v_product.product_id,
        'product_unit_id', v_product.product_unit_id,
        'package_quantity', v_package_quantity,
        'expected_product_unit_version', v_product.product_unit_version,
        'supplier_id', v_supplier.id,
        'unit_cost', v_package_unit_cost,
        'idempotency_key', v_line_key,
        'reference', v_receipt_reference
      ));

      IF COALESCE((v_receipt_result ->> 'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE = 'PPC08', MESSAGE = 'PURCHASE_STOCK_FAILURE';
      END IF;

      v_base_quantity := (v_receipt_result ->> 'base_quantity')::numeric;
      v_base_unit_cost := (v_receipt_result ->> 'base_unit_cost')::numeric;

      INSERT INTO public.purchase_stock_movements (
        tenant_id, branch_id, purchase_id, purchase_item_id, inventory_item_id,
        stock_target_type, product_id, product_unit_id, product_unit_version,
        package_quantity, conversion_to_base, base_quantity, package_unit_name,
        base_unit_name, quantity_delta, unit_cost, reason, created_by, created_at
      ) VALUES (
        v_scope.tenant_id, v_scope.id, v_purchase_id, v_purchase_item_id, NULL,
        'saleable_product', v_product.product_id, v_product.product_unit_id, v_product.product_unit_version,
        v_package_quantity, v_product.conversion_to_base, v_base_quantity, v_product.purchase_unit_name,
        v_product.base_unit_name, v_base_quantity, round(v_base_unit_cost, 2),
        'purchase_receiving_confirmed', v_user_id, v_now
      );

      UPDATE public.purchase_items
      SET receiving_status = 'confirmed',
          received_quantity = v_package_quantity,
          confirmed_at = v_now
      WHERE id = v_purchase_item_id;

      v_stock_lines := v_stock_lines + 1;
    ELSE
      -- A service or non-stock product remains a fully auditable purchase line,
      -- but never creates a stock receipt or stock movement.
      INSERT INTO public.purchase_items (
        purchase_id, product_id, product_unit_id, product_unit_version,
        stock_target_type, name, supplier_item_name, line_type,
        receiving_status, received_quantity, match_source, quantity,
        unit_cost, total, tax_rate, vat_amount, package_quantity,
        conversion_to_base, base_quantity, purchase_unit_name, base_unit_name,
        package_unit_code, base_unit_code, package_unit_cost, base_unit_cost,
        confirmed_at
      ) VALUES (
        v_purchase_id, v_product.product_id, v_product.product_unit_id, v_product.product_unit_version,
        'none', v_product.product_name, v_product.product_name, 'non_stock',
        'skipped', 0, 'manual', v_package_quantity,
        v_package_unit_cost, v_line_total, 15, v_line_vat_amount, v_package_quantity,
        v_product.conversion_to_base, v_base_quantity, v_product.purchase_unit_name, v_product.base_unit_name,
        v_product.package_unit_code, v_product.base_unit_code, v_package_unit_cost,
        round(v_package_unit_cost / v_product.conversion_to_base, 6), v_now
      )
      RETURNING id INTO v_purchase_item_id;

      PERFORM public.mark_product_unit_used(v_product.product_unit_id);
      v_non_stock_lines := v_non_stock_lines + 1;
    END IF;

    v_line_count := v_line_count + 1;
  END LOOP;

  IF v_tax_input_mode = 'included' THEN
    v_total_amount := round(v_raw_total, 2);
    v_vat_amount := round(v_total_amount * 15 / 115, 2);
    v_subtotal := round(v_total_amount - v_vat_amount, 2);
  ELSE
    v_subtotal := round(v_raw_total, 2);
    v_vat_amount := round(v_subtotal * 0.15, 2);
    v_total_amount := round(v_subtotal + v_vat_amount, 2);
  END IF;

  IF v_expected_totals IS NOT NULL
     AND (
       v_expected_subtotal IS DISTINCT FROM v_subtotal
       OR v_expected_vat_amount IS DISTINCT FROM v_vat_amount
       OR v_expected_total_amount IS DISTINCT FROM v_total_amount
     )
  THEN
    RAISE EXCEPTION USING ERRCODE = 'PPC10', MESSAGE = 'PURCHASE_TOTAL_MISMATCH';
  END IF;

  UPDATE public.purchases
  SET subtotal = v_subtotal,
      vat_amount = v_vat_amount,
      total_amount = v_total_amount,
      updated_at = v_now
  WHERE id = v_purchase_id;

  v_result := jsonb_build_object(
    'success', true,
    'purchase_id', v_purchase_id,
    'operation_id', v_operation_id,
    'idempotent_replay', false,
    'status', 'posted',
    'receiving_status', 'confirmed',
    'received', true,
    'stock_applied', v_stock_lines > 0,
    'line_count', v_line_count,
    'stock_lines_confirmed', v_stock_lines,
    'lines_skipped', v_non_stock_lines,
    'subtotal', v_subtotal,
    'vat_amount', v_vat_amount,
    'total_amount', v_total_amount,
    'created_at', v_now
  );

  UPDATE public.purchase_posting_operations
  SET state = 'completed',
      purchase_id = v_purchase_id,
      result = v_result,
      completed_at = v_now,
      updated_at = v_now
  WHERE branch_id = v_scope.id
    AND operation_id = v_operation_id;

  PERFORM public.record_audit_event(
    'purchase_posted_and_received',
    v_scope.tenant_id,
    v_scope.id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase_id,
    'info',
    'succeeded',
    jsonb_build_object(
      'operation_id', v_operation_id,
      'line_count', v_line_count,
      'stock_lines_confirmed', v_stock_lines,
      'lines_skipped', v_non_stock_lines,
      'total_amount', v_total_amount
    ),
    NULL,
    NULL
  );

  RETURN v_result;
END
$function$;

ALTER FUNCTION public.post_purchase_receiving_v1(jsonb) OWNER TO postgres;

COMMENT ON FUNCTION public.post_purchase_receiving_v1(jsonb) IS
  'Creates and immediately receives a package-aware saleable-product purchase in one idempotent transaction. It does not replace legacy web draft/confirm purchase receiving.';

REVOKE ALL ON FUNCTION public.post_purchase_receiving_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_purchase_receiving_v1(jsonb)
  TO authenticated;

-- Existing cancellation now also reverses the new saleable-product movement
-- rows. Legacy inventory-item cancellation remains byte-for-byte equivalent in
-- behavior and continues to use its original movement ledger.
CREATE OR REPLACE FUNCTION public.cancel_purchase_receiving(
  p_purchase_id uuid,
  p_reason text,
  p_confirm boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_purchase record;
  v_movement record;
  v_now timestamptz := now();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_reversed_lines integer := 0;
  v_reversed_quantity numeric(12,3) := 0;
  v_available_quantity numeric(12,3);
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;
  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Cancel/reversal confirmation is required' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 OR length(v_reason) > 500 THEN
    RAISE EXCEPTION 'A cancellation or reversal reason is required.' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
  INTO v_profile FROM public.user_profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('purchase-receiving:' || p_purchase_id::text, 0));
  SELECT p.* INTO v_purchase FROM public.purchases p WHERE p.id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to cancel this purchase receiving.' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id THEN
      RAISE EXCEPTION 'You do not have permission to cancel this purchase receiving.' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to cancel this purchase receiving.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('detailed_receiving', 'receive_stock') THEN
    RAISE EXCEPTION 'Only receive-stock purchases can use this cancel/reversal flow.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('cancelled', 'reversed') THEN
    RAISE EXCEPTION 'This purchase receiving is already cancelled or reversed.' USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('draft', 'pending_confirmation') THEN
    UPDATE public.purchase_items SET receiving_status = 'cancelled'
    WHERE purchase_id = v_purchase.id AND receiving_status = 'pending';
    UPDATE public.purchases
    SET receiving_status = 'cancelled', status = 'cancelled', cancelled_at = v_now,
        cancelled_by = v_user_id, cancellation_reason = v_reason, updated_at = v_now
    WHERE id = v_purchase.id;
    RETURN jsonb_build_object('ok', true, 'purchase_id', v_purchase.id, 'receiving_status', 'cancelled', 'stock_changed', false);
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') <> 'confirmed' THEN
    RAISE EXCEPTION 'This purchase receiving is not confirmed and cannot be reversed.' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.purchase_stock_movements psm
    WHERE psm.purchase_id = v_purchase.id AND psm.reason = 'purchase_receiving_confirmed'
  ) THEN
    RAISE EXCEPTION 'This received purchase has no stock movement records. Use a manual inventory adjustment.' USING ERRCODE = '23514';
  END IF;

  FOR v_movement IN
    SELECT psm.* FROM public.purchase_stock_movements psm
    WHERE psm.purchase_id = v_purchase.id
      AND psm.reason = 'purchase_receiving_confirmed'
      AND NOT EXISTS (SELECT 1 FROM public.purchase_stock_movements rev WHERE rev.reversal_of = psm.id)
    ORDER BY psm.created_at, psm.id FOR UPDATE
  LOOP
    IF v_movement.stock_target_type = 'saleable_product' THEN
      SELECT p.stock_quantity INTO v_available_quantity
      FROM public.products p
      WHERE p.id = v_movement.product_id
        AND p.tenant_id = v_purchase.tenant_id
        AND p.branch_id = v_purchase.branch_id
      FOR UPDATE;
      IF v_available_quantity IS NULL THEN
        RAISE EXCEPTION 'Linked saleable product was not found in this branch.' USING ERRCODE = '23514';
      END IF;
      IF v_available_quantity < v_movement.quantity_delta THEN
        RAISE EXCEPTION 'Cannot reverse receiving because current stock is lower than the received quantity.' USING ERRCODE = '23514';
      END IF;
      UPDATE public.products
      SET stock_quantity = stock_quantity - v_movement.quantity_delta, updated_at = v_now
      WHERE id = v_movement.product_id
        AND tenant_id = v_purchase.tenant_id
        AND branch_id = v_purchase.branch_id;
      INSERT INTO public.purchase_stock_movements (
        tenant_id, branch_id, purchase_id, purchase_item_id, inventory_item_id,
        stock_target_type, product_id, product_unit_id, product_unit_version,
        package_quantity, conversion_to_base, base_quantity, package_unit_name,
        base_unit_name, quantity_delta, unit_cost, reason, reversal_of, created_by, created_at
      ) VALUES (
        v_purchase.tenant_id, v_purchase.branch_id, v_purchase.id, v_movement.purchase_item_id, NULL,
        'saleable_product', v_movement.product_id, v_movement.product_unit_id, v_movement.product_unit_version,
        v_movement.package_quantity, v_movement.conversion_to_base, v_movement.base_quantity, v_movement.package_unit_name,
        v_movement.base_unit_name, -v_movement.quantity_delta, v_movement.unit_cost,
        'purchase_receiving_reversed', v_movement.id, v_user_id, v_now
      );
      INSERT INTO public.pos_stock_movements (
        tenant_id, branch_id, product_id, invoice_id, quantity_delta, reason,
        created_by, created_at, idempotency_key, product_unit_id, product_unit_version,
        package_quantity, conversion_to_base, base_quantity, selling_unit_name, base_unit_name
      ) VALUES (
        v_purchase.tenant_id, v_purchase.branch_id, v_movement.product_id, NULL,
        -v_movement.quantity_delta, 'purchase_receiving_reversed', v_user_id, v_now,
        'purchase-reversal:' || v_purchase.id::text || ':' || v_movement.id::text,
        v_movement.product_unit_id, v_movement.product_unit_version,
        v_movement.package_quantity, v_movement.conversion_to_base, v_movement.base_quantity,
        v_movement.package_unit_name, v_movement.base_unit_name
      );
    ELSE
      SELECT ii.current_quantity INTO v_available_quantity
      FROM public.inventory_items ii
      WHERE ii.id = v_movement.inventory_item_id
        AND ii.tenant_id = v_purchase.tenant_id
        AND ii.branch_id = v_purchase.branch_id
      FOR UPDATE;
      IF v_available_quantity IS NULL THEN
        RAISE EXCEPTION 'Linked stock item was not found in this branch.' USING ERRCODE = '23514';
      END IF;
      IF v_available_quantity < v_movement.quantity_delta THEN
        RAISE EXCEPTION 'Cannot reverse receiving because current stock is lower than the received quantity.' USING ERRCODE = '23514';
      END IF;
      UPDATE public.inventory_items
      SET current_quantity = current_quantity - v_movement.quantity_delta, updated_at = v_now
      WHERE id = v_movement.inventory_item_id;
      INSERT INTO public.purchase_stock_movements (
        tenant_id, branch_id, purchase_id, purchase_item_id, inventory_item_id,
        quantity_delta, unit_cost, reason, reversal_of, created_by, created_at
      ) VALUES (
        v_purchase.tenant_id, v_purchase.branch_id, v_purchase.id, v_movement.purchase_item_id,
        v_movement.inventory_item_id, -v_movement.quantity_delta, v_movement.unit_cost,
        'purchase_receiving_reversed', v_movement.id, v_user_id, v_now
      );
    END IF;

    UPDATE public.purchase_items SET receiving_status = 'reversed'
    WHERE id = v_movement.purchase_item_id;
    v_reversed_lines := v_reversed_lines + 1;
    v_reversed_quantity := v_reversed_quantity + v_movement.quantity_delta;
  END LOOP;

  IF v_reversed_lines = 0 THEN
    RAISE EXCEPTION 'This purchase receiving has already been reversed.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.purchases
  SET receiving_status = 'reversed', status = 'cancelled', reversed_at = v_now,
      reversed_by = v_user_id, reversal_reason = v_reason, updated_at = v_now
  WHERE id = v_purchase.id;

  PERFORM public.record_audit_event(
    'purchase_receiving_reversed', v_purchase.tenant_id, v_purchase.branch_id,
    v_user_id, v_profile.role, 'purchase', v_purchase.id, 'warning', 'succeeded',
    jsonb_build_object('reversed_lines', v_reversed_lines, 'reversed_quantity', v_reversed_quantity,
      'reason_length', length(v_reason), 'total_amount', v_purchase.total_amount), NULL, NULL
  );

  RETURN jsonb_build_object(
    'ok', true, 'purchase_id', v_purchase.id, 'receiving_status', 'reversed',
    'stock_changed', true, 'reversed_lines', v_reversed_lines, 'reversed_quantity', v_reversed_quantity
  );
END
$function$;

ALTER FUNCTION public.cancel_purchase_receiving(uuid, text, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.cancel_purchase_receiving(uuid, text, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_receiving(uuid, text, boolean)
  TO authenticated, service_role;

COMMIT;
