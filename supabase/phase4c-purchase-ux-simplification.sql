-- ============================================================
-- Phase 4C follow-up: simplified purchase UX RPCs
-- Apply manually after phase4c-safe-purchase-receiving.sql.
-- ============================================================
--
-- Goals:
--   - Keep purchase UI simple: View, Edit, Delete, Confirm Stock.
--   - Remove direct browser UPDATE/DELETE dependency for purchase edits.
--   - Enforce a 45-day edit/delete window in safe RPCs.
--   - Keep stock-affecting deletes on the safe reversal/cancel path.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not modify existing stock quantities except through the safe
--     receiving delete wrapper when called by a user.
--   - Do not call ZATCA.
--   - This patch does not modify ZATCA XML/signing/hash/QR/canonicalization.

BEGIN;

-- Browser users keep insert/read only. Updates/deletes stay RPC-owned.
REVOKE UPDATE, DELETE ON TABLE public.purchases FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.purchases FROM authenticated;
REVOKE UPDATE, DELETE ON TABLE public.purchase_items FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.purchase_items FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.purchases TO authenticated;
GRANT SELECT, INSERT ON TABLE public.purchase_items TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_edit_window_days()
RETURNS INTEGER
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 45
$$;

REVOKE ALL ON FUNCTION public.purchase_edit_window_days() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_edit_window_days() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.purchase_is_in_edit_window(p_purchase_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(p_purchase_date >= CURRENT_DATE - public.purchase_edit_window_days(), FALSE)
$$;

REVOKE ALL ON FUNCTION public.purchase_is_in_edit_window(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purchase_is_in_edit_window(DATE) TO authenticated, service_role;

-- ============================================================
-- Safe edit RPC for simple bills and pending receive-stock bills
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_purchase_entry(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_purchase_id UUID;
  v_supplier_id UUID;
  v_purchase_date DATE;
  v_bill_number TEXT;
  v_tax_mode TEXT;
  v_payment_status TEXT;
  v_payment_method TEXT;
  v_notes TEXT;
  v_bill_url TEXT;
  v_amount NUMERIC(12, 2);
  v_subtotal NUMERIC(12, 2);
  v_vat_amount NUMERIC(12, 2);
  v_total_amount NUMERIC(12, 2);
  v_items JSONB;
  v_item JSONB;
  v_item_count INTEGER := 0;
  v_line_name TEXT;
  v_inventory_item_id UUID;
  v_quantity NUMERIC(12, 3);
  v_unit_cost NUMERIC(12, 2);
  v_line_total NUMERIC(12, 2);
  v_raw_line_total NUMERIC(12, 2) := 0;
  v_supplier_id_text TEXT;
  v_inventory_id_text TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid purchase payload' USING ERRCODE = '22023';
  END IF;

  v_purchase_id := NULLIF(TRIM(COALESCE(p_payload ->> 'purchase_id', '')), '')::uuid;

  IF v_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = v_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to edit this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to edit this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to edit this purchase.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.status, 'posted') = 'cancelled'
     OR COALESCE(v_purchase.receiving_status, 'not_applicable') IN ('confirmed', 'cancelled', 'reversed', 'confirmed_legacy')
  THEN
    RAISE EXCEPTION 'This purchase can no longer be edited.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('simple_bill', 'detailed_receiving') THEN
    RAISE EXCEPTION 'Unsupported purchase mode' USING ERRCODE = '23514';
  END IF;

  v_tax_mode := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'tax_input_mode', '')), ''), v_purchase.tax_input_mode, 'included');
  IF v_tax_mode NOT IN ('included', 'excluded') THEN
    RAISE EXCEPTION 'VAT mode must be included or excluded' USING ERRCODE = '22023';
  END IF;

  v_payment_status := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'payment_status', '')), ''), v_purchase.payment_status, 'paid');
  IF v_payment_status NOT IN ('paid', 'unpaid', 'partial') THEN
    RAISE EXCEPTION 'Invalid payment status' USING ERRCODE = '22023';
  END IF;

  v_payment_method := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'payment_method', '')), ''), v_purchase.payment_method, 'cash');
  IF v_payment_method NOT IN ('cash', 'card', 'bank_transfer') THEN
    RAISE EXCEPTION 'Invalid payment method' USING ERRCODE = '22023';
  END IF;

  v_purchase_date := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'purchase_date', '')), '')::date, v_purchase.purchase_date);
  v_bill_number := NULLIF(TRIM(COALESCE(p_payload ->> 'bill_number', '')), '');
  v_notes := NULLIF(TRIM(COALESCE(p_payload ->> 'notes', '')), '');
  v_bill_url := NULLIF(TRIM(COALESCE(p_payload ->> 'bill_url', '')), '');

  IF p_payload ? 'supplier_id' THEN
    v_supplier_id_text := NULLIF(TRIM(COALESCE(p_payload ->> 'supplier_id', '')), '');
    v_supplier_id := v_supplier_id_text::uuid;
  ELSE
    v_supplier_id := v_purchase.supplier_id;
  END IF;

  IF v_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.suppliers s
    WHERE s.id = v_supplier_id
      AND s.tenant_id = v_purchase.tenant_id
  ) THEN
    RAISE EXCEPTION 'Supplier not found for this tenant' USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') = 'simple_bill' THEN
    v_amount := NULLIF(TRIM(COALESCE(p_payload ->> 'amount', '')), '')::numeric;

    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Purchase amount must be greater than zero' USING ERRCODE = '22023';
    END IF;

    IF v_tax_mode = 'included' THEN
      v_total_amount := round(v_amount, 2);
      v_vat_amount := round(v_total_amount * 15 / 115, 2);
      v_subtotal := round(v_total_amount - v_vat_amount, 2);
    ELSE
      v_subtotal := round(v_amount, 2);
      v_vat_amount := round(v_subtotal * 0.15, 2);
      v_total_amount := round(v_subtotal + v_vat_amount, 2);
    END IF;

    IF EXISTS (SELECT 1 FROM public.purchase_items pi WHERE pi.purchase_id = v_purchase.id) THEN
      RAISE EXCEPTION 'This simple bill has item lines and cannot be edited here.'
        USING ERRCODE = '23514';
    END IF;

    UPDATE public.purchases
    SET supplier_id = v_supplier_id,
        purchase_date = v_purchase_date,
        bill_number = v_bill_number,
        tax_input_mode = v_tax_mode,
        payment_status = v_payment_status,
        subtotal = v_subtotal,
        vat_amount = v_vat_amount,
        total_amount = v_total_amount,
        payment_method = v_payment_method,
        bill_url = CASE WHEN p_payload ? 'bill_url' THEN v_bill_url ELSE bill_url END,
        notes = v_notes,
        updated_at = NOW()
    WHERE id = v_purchase.id;

    PERFORM public.record_audit_event(
      'purchase_bill_updated',
      v_purchase.tenant_id,
      v_purchase.branch_id,
      v_user_id,
      v_profile.role,
      'purchase',
      v_purchase.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', v_purchase.purchase_mode,
        'tax_input_mode', v_tax_mode,
        'payment_status', v_payment_status,
        'total_amount', v_total_amount,
        'has_bill_number', v_bill_number IS NOT NULL,
        'has_bill_url', COALESCE(v_bill_url, v_purchase.bill_url) IS NOT NULL
      ),
      NULL,
      NULL
    );
  ELSE
    IF COALESCE(v_purchase.receiving_status, 'not_applicable') NOT IN ('draft', 'pending_confirmation') THEN
      RAISE EXCEPTION 'Only pending stock purchases can be edited.'
        USING ERRCODE = '23514';
    END IF;

    v_items := COALESCE(p_payload -> 'items', '[]'::jsonb);
    IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
      RAISE EXCEPTION 'Add at least one item before saving this purchase.'
        USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.purchase_items
    WHERE purchase_id = v_purchase.id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
    LOOP
      v_line_name := NULLIF(TRIM(COALESCE(v_item ->> 'name', '')), '');
      v_inventory_id_text := NULLIF(TRIM(COALESCE(v_item ->> 'inventory_item_id', '')), '');
      v_inventory_item_id := v_inventory_id_text::uuid;
      v_quantity := NULLIF(TRIM(COALESCE(v_item ->> 'quantity', '')), '')::numeric;
      v_unit_cost := COALESCE(NULLIF(TRIM(COALESCE(v_item ->> 'unit_cost', '')), '')::numeric, 0);

      IF v_line_name IS NULL OR v_quantity IS NULL OR v_quantity <= 0 THEN
        RAISE EXCEPTION 'Each item needs a name and quantity greater than zero.'
          USING ERRCODE = '22023';
      END IF;

      IF v_unit_cost < 0 THEN
        RAISE EXCEPTION 'Unit cost cannot be negative' USING ERRCODE = '22023';
      END IF;

      IF v_inventory_item_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_items ii
        WHERE ii.id = v_inventory_item_id
          AND ii.tenant_id = v_purchase.tenant_id
          AND ii.branch_id = v_purchase.branch_id
      ) THEN
        RAISE EXCEPTION 'Linked stock item was not found in this branch.'
          USING ERRCODE = '23514';
      END IF;

      v_line_total := round(v_quantity * v_unit_cost, 2);
      v_raw_line_total := v_raw_line_total + v_line_total;
      v_item_count := v_item_count + 1;

      INSERT INTO public.purchase_items (
        purchase_id,
        inventory_item_id,
        name,
        supplier_item_name,
        line_type,
        receiving_status,
        received_quantity,
        match_source,
        quantity,
        unit_cost,
        total
      ) VALUES (
        v_purchase.id,
        v_inventory_item_id,
        v_line_name,
        v_line_name,
        CASE WHEN v_inventory_item_id IS NULL THEN 'non_stock' ELSE 'stock' END,
        'pending',
        0,
        CASE WHEN v_inventory_item_id IS NULL THEN 'none' ELSE 'manual' END,
        v_quantity,
        v_unit_cost,
        v_line_total
      );
    END LOOP;

    IF v_tax_mode = 'included' THEN
      v_total_amount := round(v_raw_line_total, 2);
      v_vat_amount := round(v_total_amount * 15 / 115, 2);
      v_subtotal := round(v_total_amount - v_vat_amount, 2);
    ELSE
      v_subtotal := round(v_raw_line_total, 2);
      v_vat_amount := round(v_subtotal * 0.15, 2);
      v_total_amount := round(v_subtotal + v_vat_amount, 2);
    END IF;

    UPDATE public.purchases
    SET supplier_id = v_supplier_id,
        purchase_date = v_purchase_date,
        bill_number = v_bill_number,
        tax_input_mode = v_tax_mode,
        payment_status = v_payment_status,
        subtotal = v_subtotal,
        vat_amount = v_vat_amount,
        total_amount = v_total_amount,
        payment_method = v_payment_method,
        bill_url = CASE WHEN p_payload ? 'bill_url' THEN v_bill_url ELSE bill_url END,
        notes = v_notes,
        status = 'draft',
        receiving_status = 'pending_confirmation',
        updated_at = NOW()
    WHERE id = v_purchase.id;

    PERFORM public.record_audit_event(
      'purchase_receiving_updated',
      v_purchase.tenant_id,
      v_purchase.branch_id,
      v_user_id,
      v_profile.role,
      'purchase',
      v_purchase.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', v_purchase.purchase_mode,
        'tax_input_mode', v_tax_mode,
        'payment_status', v_payment_status,
        'line_count', v_item_count,
        'total_amount', v_total_amount,
        'has_bill_number', v_bill_number IS NOT NULL,
        'has_bill_url', COALESCE(v_bill_url, v_purchase.bill_url) IS NOT NULL
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'purchase_mode', v_purchase.purchase_mode,
    'subtotal', v_subtotal,
    'vat_amount', v_vat_amount,
    'total_amount', v_total_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_purchase_entry(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_purchase_entry(jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_purchase_entry(jsonb) IS
  'Safely edits simple purchase bills and pending receive-stock purchases within the 45-day edit window.';

-- ============================================================
-- 45-day simple bill delete guard
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_purchase_bill(
  p_purchase_id UUID,
  p_confirm BOOLEAN DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_item_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Deletion confirmation is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase bill not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to delete this purchase bill.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to delete this purchase bill.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to delete this purchase bill.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('simple_bill', 'bill_only') THEN
    RAISE EXCEPTION 'This purchase contains stock details. Use the purchase delete action.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)
    INTO v_item_count
  FROM public.purchase_items pi
  WHERE pi.purchase_id = v_purchase.id;

  IF v_item_count > 0 THEN
    RAISE EXCEPTION 'This purchase contains stock details. Use the purchase delete action.'
      USING ERRCODE = '23514';
  END IF;

  DELETE FROM public.purchases
  WHERE id = v_purchase.id;

  PERFORM public.record_audit_event(
    'purchase_bill_deleted',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'warning',
    'succeeded',
    jsonb_build_object(
      'purchase_mode', v_purchase.purchase_mode,
      'status', v_purchase.status,
      'tax_input_mode', v_purchase.tax_input_mode,
      'payment_status', v_purchase.payment_status,
      'payment_method', v_purchase.payment_method,
      'has_bill_number', v_purchase.bill_number IS NOT NULL,
      'has_bill_url', v_purchase.bill_url IS NOT NULL,
      'attachment_cleanup_deferred', v_purchase.bill_url IS NOT NULL,
      'total_amount', v_purchase.total_amount,
      'purchase_date', v_purchase.purchase_date
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'ok', true,
    'purchase_id', v_purchase.id,
    'attachment_cleanup_deferred', v_purchase.bill_url IS NOT NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_purchase_bill(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_purchase_bill(UUID, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.delete_purchase_bill(UUID, BOOLEAN) IS
  'Safely deletes bill-only simple purchases with no item rows within the 45-day edit/delete window.';

-- ============================================================
-- Simple Delete wrapper for pending/confirmed receive-stock purchases
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_purchase_receiving(
  p_purchase_id UUID,
  p_confirm BOOLEAN DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
  v_result JSONB;
  v_stock_was_added BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Deletion confirmation is required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.*
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to delete this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to delete this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to delete this purchase.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('detailed_receiving', 'receive_stock') THEN
    RAISE EXCEPTION 'Only receive-stock purchases use this delete action.'
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(v_purchase.receiving_status, 'not_applicable') NOT IN ('draft', 'pending_confirmation', 'confirmed') THEN
    RAISE EXCEPTION 'This purchase is already deleted or cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  v_stock_was_added := COALESCE(v_purchase.receiving_status, 'not_applicable') = 'confirmed';

  SELECT public.cancel_purchase_receiving(
    p_purchase_id,
    'Deleted from purchase history',
    TRUE
  ) INTO v_result;

  PERFORM public.record_audit_event(
    'purchase_receiving_deleted_or_reversed',
    v_purchase.tenant_id,
    v_purchase.branch_id,
    v_user_id,
    v_profile.role,
    'purchase',
    v_purchase.id,
    'warning',
    'succeeded',
    jsonb_build_object(
      'purchase_mode', v_purchase.purchase_mode,
      'receiving_status_before', v_purchase.receiving_status,
      'stock_was_added', v_stock_was_added,
      'total_amount', v_purchase.total_amount
    ),
    NULL,
    NULL
  );

  RETURN v_result || jsonb_build_object(
    'deleted', true,
    'stock_was_added', v_stock_was_added
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_purchase_receiving(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_purchase_receiving(UUID, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.delete_purchase_receiving(UUID, BOOLEAN) IS
  'User-facing Delete action for receive-stock purchases. Cancels pending receiving or safely reverses confirmed receiving within 45 days.';

-- ============================================================
-- 45-day Confirm Stock guard while preserving the same RPC name
-- ============================================================

DO $$
BEGIN
  IF to_regprocedure('public.confirm_purchase_receiving_unchecked(uuid, boolean)') IS NULL
     AND to_regprocedure('public.confirm_purchase_receiving(uuid, boolean)') IS NOT NULL
  THEN
    ALTER FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN)
      RENAME TO confirm_purchase_receiving_unchecked;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_purchase_receiving(
  p_purchase_id UUID,
  p_confirm BOOLEAN DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_purchase RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Missing purchase id' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.tenant_id, p.branch_id, p.purchase_date
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'You do not have permission to confirm this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'You do not have permission to confirm this purchase.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'You do not have permission to confirm this purchase.'
      USING ERRCODE = '42501';
  END IF;

  IF public.purchase_is_in_edit_window(v_purchase.purchase_date) IS NOT TRUE THEN
    RAISE EXCEPTION 'Purchases older than 45 days can only be viewed.'
      USING ERRCODE = '23514';
  END IF;

  RETURN public.confirm_purchase_receiving_unchecked(p_purchase_id, p_confirm);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.confirm_purchase_receiving_unchecked(uuid, boolean)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.confirm_purchase_receiving_unchecked(UUID, BOOLEAN) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.confirm_purchase_receiving_unchecked(UUID, BOOLEAN) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN) IS
  'User-facing Confirm Stock RPC. Enforces the 45-day window, then delegates to the Phase 4C stock confirmation implementation.';

-- Keep the lower-level cancel/reversal RPC callable by service-role/server paths,
-- but route browser users through delete_purchase_receiving for the 45-day UX rule.
REVOKE ALL ON FUNCTION public.cancel_purchase_receiving(UUID, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_receiving(UUID, TEXT, BOOLEAN) TO service_role;

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm browser roles can execute simplified purchase RPCs:
--
-- SELECT
--   has_function_privilege('authenticated', 'public.update_purchase_entry(jsonb)', 'EXECUTE') AS can_update_purchase,
--   has_function_privilege('authenticated', 'public.delete_purchase_bill(uuid, boolean)', 'EXECUTE') AS can_delete_bill,
--   has_function_privilege('authenticated', 'public.delete_purchase_receiving(uuid, boolean)', 'EXECUTE') AS can_delete_receiving,
--   has_function_privilege('authenticated', 'public.confirm_purchase_receiving(uuid, boolean)', 'EXECUTE') AS can_confirm_stock;
--
-- 2) Confirm browser users no longer execute the lower-level cancel/reversal RPC:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.cancel_purchase_receiving(uuid, text, boolean)',
--   'EXECUTE'
-- ) AS authenticated_can_call_raw_cancel;
--
-- Expected: false.
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.confirm_purchase_receiving_unchecked(uuid, boolean)',
--   'EXECUTE'
-- ) AS authenticated_can_call_unchecked_confirm;
--
-- Expected: false.
--
-- 3) Confirm direct purchase UPDATE/DELETE grants are still blocked:
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('purchases', 'purchase_items')
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type IN ('UPDATE', 'DELETE')
-- ORDER BY table_name, grantee, privilege_type;
--
-- Expected: zero rows.
--
-- 4) Confirm edit window helper:
--
-- SELECT public.purchase_edit_window_days() AS edit_window_days;
--
-- 5) Confirm audit rows after manual tests:
--
-- SELECT action, target_type, target_id, severity, status, metadata, created_at
-- FROM public.audit_events
-- WHERE action IN (
--   'purchase_bill_updated',
--   'purchase_bill_deleted',
--   'purchase_receiving_updated',
--   'purchase_receiving_confirmed',
--   'purchase_receiving_deleted_or_reversed'
-- )
-- ORDER BY created_at DESC
-- LIMIT 20;
