-- ============================================================
-- Phase 4B follow-up: bill-only purchase delete permission/UX fix
-- Apply manually after phase4b-delete-simple-purchase-bill.sql.
-- ============================================================
--
-- Fixes:
--   - Allows assigned branch staff roles that can create purchases to delete
--     eligible bill-only purchases for their own branch.
--   - Replaces typed confirmation with boolean confirmation for normal shop
--     staff UX.
--   - Keeps direct browser DELETE on public.purchases revoked.
--
-- Still blocked:
--   - other tenant purchases
--   - other branch purchases
--   - detailed receiving purchases
--   - purchases with purchase_items
--   - purchases that may have affected stock

BEGIN;

REVOKE DELETE ON TABLE public.purchases FROM anon;
REVOKE DELETE ON TABLE public.purchases FROM authenticated;

DROP FUNCTION IF EXISTS public.delete_purchase_bill(UUID, TEXT);

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

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') NOT IN ('simple_bill', 'bill_only') THEN
    RAISE EXCEPTION 'This purchase cannot be deleted because it contains receiving/stock details.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COUNT(*)
    INTO v_item_count
  FROM public.purchase_items pi
  WHERE pi.purchase_id = v_purchase.id;

  IF v_item_count > 0 THEN
    RAISE EXCEPTION 'This purchase cannot be deleted because it contains receiving/stock details.'
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
  'Safely deletes bill-only simple purchases with no item rows. Uses boolean confirmation and does not delete storage attachments.';

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm authenticated can execute the boolean RPC:
--
-- SELECT has_function_privilege(
--   'authenticated',
--   'public.delete_purchase_bill(uuid, boolean)',
--   'EXECUTE'
-- ) AS authenticated_can_delete_purchase_bill;
--
-- 2) Confirm old typed-confirmation RPC was removed:
--
-- SELECT to_regprocedure('public.delete_purchase_bill(uuid, text)') IS NULL
--   AS old_text_signature_removed;
--
-- 3) Confirm direct purchase DELETE grants are not available to browser roles:
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name = 'purchases'
--   AND grantee IN ('anon', 'authenticated')
--   AND privilege_type = 'DELETE'
-- ORDER BY table_name, grantee, privilege_type;
--
-- Expected: zero rows.
--
-- 4) Confirm audit rows after a successful delete:
--
-- SELECT action, target_type, target_id, severity, status, metadata, created_at
-- FROM public.audit_events
-- WHERE action = 'purchase_bill_deleted'
-- ORDER BY created_at DESC
-- LIMIT 20;
