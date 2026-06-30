-- ============================================================
-- Phase 4B follow-up: safe delete for bill-only purchases
-- Apply manually after Phase 4B simple purchase bill migration.
-- ============================================================
--
-- Goals:
--   - Allow deletion of test/duplicate simple bill-only purchase records.
--   - Keep detailed receiving and stock-affecting purchases protected.
--   - Do not grant direct browser DELETE on public.purchases.
--   - Do not delete storage attachments in this phase.
--
-- Safety:
--   - Requires exact confirmation text: DELETE PURCHASE BILL
--   - Allows owner/admin for own tenant.
--   - Allows manager for their assigned branch only.
--   - Blocks detailed_receiving, rows with purchase_items, and anything that
--     may have affected stock.

BEGIN;

REVOKE DELETE ON TABLE public.purchases FROM anon;
REVOKE DELETE ON TABLE public.purchases FROM authenticated;

CREATE OR REPLACE FUNCTION public.delete_purchase_bill(
  p_purchase_id UUID,
  p_confirm_text TEXT
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

  IF COALESCE(p_confirm_text, '') <> 'DELETE PURCHASE BILL' THEN
    RAISE EXCEPTION 'Confirmation phrase did not match' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT p.id,
         p.tenant_id,
         p.branch_id,
         p.supplier_id,
         p.purchase_mode,
         p.status,
         p.bill_number,
         p.tax_input_mode,
         p.payment_status,
         p.payment_method,
         p.bill_url,
         p.total_amount,
         p.purchase_date,
         p.created_at
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase bill not found' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'manager' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_purchase.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_purchase.branch_id
    THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('simple_bill', 'bill_only') THEN
    RAISE EXCEPTION 'This purchase cannot be deleted because it contains item/stock receiving details. Use reversal/cancel flow after Phase 4C.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)
    INTO v_item_count
  FROM public.purchase_items pi
  WHERE pi.purchase_id = v_purchase.id;

  IF v_item_count > 0 THEN
    RAISE EXCEPTION 'This purchase cannot be deleted because it contains item/stock receiving details. Use reversal/cancel flow after Phase 4C.'
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

REVOKE ALL ON FUNCTION public.delete_purchase_bill(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_purchase_bill(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.delete_purchase_bill(UUID, TEXT) IS
  'Safely deletes bill-only simple purchases with no item rows. Does not delete storage attachments.';

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm authenticated can execute the RPC:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.delete_purchase_bill(uuid, text)',
--   'EXECUTE'
-- ) AS authenticated_can_delete_purchase_bill;
--
-- 2) Confirm direct purchase DELETE grants were not broadened by this patch:
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name = 'purchases'
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type = 'DELETE'
-- ORDER BY table_name, grantee, privilege_type;
--
-- 3) Confirm the audit event can be queried after a successful delete:
--
-- SELECT action, target_type, target_id, severity, status, metadata, created_at
-- FROM public.audit_events
-- WHERE action = 'purchase_bill_deleted'
-- ORDER BY created_at DESC
-- LIMIT 20;
