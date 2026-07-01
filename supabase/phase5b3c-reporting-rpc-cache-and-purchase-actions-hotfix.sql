-- ============================================================
-- Phase 5B-3C hotfix: reporting RPC schema cache + purchase actions
-- Apply manually after phase5b3b-reporting-foundation.sql and
-- phase5b3b-reporting-compatibility-hotfix.sql.
-- ============================================================
--
-- Goals:
--   - Keep server-side reporting foundation.
--   - Reload Supabase/PostgREST schema cache so browser RPC calls can see
--     newly-created reporting functions.
--   - Preserve owner/admin tenant-wide reporting and branch-user scoping.
--   - Keep pending receive-stock purchases out of purchase totals.
--   - Allow legacy pending stock rows with receiving_status = not_applicable
--     and status = draft to use Confirm Stock/Delete actions.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify stock quantities by applying this patch.
--   - Do not call ZATCA.
--   - Do not modify ZATCA XML/signing/hash/QR/canonicalization.

BEGIN;

-- ============================================================
-- Reporting scope helper
-- ============================================================

CREATE OR REPLACE FUNCTION public.reporting_resolve_scope(p_branch_id UUID DEFAULT NULL)
RETURNS TABLE (
  caller_id UUID,
  caller_role TEXT,
  scope_tenant_id UUID,
  profile_branch_id UUID,
  scope_branch_id UUID,
  tenant_scope BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NOT NULL THEN
    SELECT b.id, b.tenant_id
      INTO v_branch
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.is_active IS TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501';
    END IF;
  END IF;

  caller_id := v_profile.id;
  caller_role := v_profile.role;
  profile_branch_id := v_profile.branch_id;

  IF v_profile.role = 'super_admin' THEN
    IF p_branch_id IS NULL THEN
      IF v_profile.tenant_id IS NULL THEN
        RAISE EXCEPTION 'Branch is required for this report scope' USING ERRCODE = '42501';
      END IF;

      scope_tenant_id := v_profile.tenant_id;
      scope_branch_id := NULL;
      tenant_scope := TRUE;
    ELSE
      scope_tenant_id := v_branch.tenant_id;
      scope_branch_id := v_branch.id;
      tenant_scope := FALSE;
    END IF;

    RETURN NEXT;
    RETURN;
  END IF;

  IF v_profile.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Caller tenant not found' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    IF v_profile.role IN ('owner', 'admin') THEN
      scope_tenant_id := v_profile.tenant_id;
      scope_branch_id := NULL;
      tenant_scope := TRUE;
    ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
      IF v_profile.branch_id IS NULL THEN
        RAISE EXCEPTION 'Caller branch not found' USING ERRCODE = '42501';
      END IF;

      scope_tenant_id := v_profile.tenant_id;
      scope_branch_id := v_profile.branch_id;
      tenant_scope := FALSE;
    ELSE
      RAISE EXCEPTION 'You do not have permission to view this report.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_profile.role IN ('owner', 'admin') THEN
      IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
        RAISE EXCEPTION 'You do not have permission to view this branch report.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_profile.role IN ('branch', 'manager', 'cashier', 'accountant') THEN
      IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
         OR v_profile.branch_id IS DISTINCT FROM v_branch.id
      THEN
        RAISE EXCEPTION 'You do not have permission to view this branch report.'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'You do not have permission to view this branch report.'
        USING ERRCODE = '42501';
    END IF;

    scope_tenant_id := v_branch.tenant_id;
    scope_branch_id := v_branch.id;
    tenant_scope := FALSE;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reporting_resolve_scope(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporting_resolve_scope(UUID) TO service_role;

-- Re-assert browser RPC grants. These should already exist from Phase 5B-3B,
-- but re-granting is safe and helps PostgREST rebuild its callable function map.
GRANT EXECUTE ON FUNCTION public.get_sales_report_summary(DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vat_support_summary(DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_purchase_report_summary(DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expense_report_summary(DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profit_report_summary(DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_report_summary(DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) TO authenticated;

-- ============================================================
-- Purchase action compatibility wrappers
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
  v_effective_receiving_status TEXT;
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

  v_effective_receiving_status := COALESCE(v_purchase.receiving_status, 'not_applicable');

  IF v_effective_receiving_status = 'not_applicable'
     AND COALESCE(v_purchase.status, 'posted') = 'draft'
  THEN
    UPDATE public.purchases
    SET receiving_status = 'pending_confirmation',
        updated_at = NOW()
    WHERE id = v_purchase.id;

    v_effective_receiving_status := 'pending_confirmation';
  END IF;

  IF v_effective_receiving_status NOT IN ('draft', 'pending_confirmation', 'confirmed') THEN
    RAISE EXCEPTION 'This purchase is already deleted or cannot be deleted.'
      USING ERRCODE = '23514';
  END IF;

  v_stock_was_added := v_effective_receiving_status = 'confirmed';

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
      'receiving_status_effective', v_effective_receiving_status,
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

  SELECT p.id, p.tenant_id, p.branch_id, p.purchase_date,
         p.purchase_mode, p.status, p.receiving_status
    INTO v_purchase
  FROM public.purchases p
  WHERE p.id = p_purchase_id
  FOR UPDATE;

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

  IF COALESCE(v_purchase.purchase_mode, 'detailed_receiving') IN ('detailed_receiving', 'receive_stock')
     AND COALESCE(v_purchase.status, 'posted') = 'draft'
     AND COALESCE(v_purchase.receiving_status, 'not_applicable') = 'not_applicable'
  THEN
    UPDATE public.purchases
    SET receiving_status = 'pending_confirmation',
        updated_at = NOW()
    WHERE id = v_purchase.id;
  END IF;

  RETURN public.confirm_purchase_receiving_unchecked(p_purchase_id, p_confirm);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_purchase_receiving(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_purchase_receiving(UUID, BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.confirm_purchase_receiving_unchecked(uuid, boolean)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.confirm_purchase_receiving_unchecked(UUID, BOOLEAN) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.confirm_purchase_receiving_unchecked(UUID, BOOLEAN) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.delete_purchase_receiving(UUID, BOOLEAN) IS
  'User-facing Delete action for receive-stock purchases. Cancels pending receiving or safely reverses confirmed receiving within 45 days; treats draft/not_applicable stock rows as pending.';

COMMENT ON FUNCTION public.confirm_purchase_receiving(UUID, BOOLEAN) IS
  'User-facing Confirm Stock RPC. Enforces the 45-day window, normalizes draft/not_applicable stock rows to pending, then delegates to Phase 4C stock confirmation.';

-- Force PostgREST/Supabase REST to reload callable RPC signatures immediately.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm PostgREST-facing report functions are executable:
--
-- SELECT
--   has_function_privilege('authenticated', 'public.get_sales_report_summary(date, date, uuid)', 'EXECUTE') AS can_sales,
--   has_function_privilege('authenticated', 'public.get_vat_support_summary(date, date, uuid)', 'EXECUTE') AS can_vat,
--   has_function_privilege('authenticated', 'public.get_purchase_report_summary(date, date, uuid)', 'EXECUTE') AS can_purchase,
--   has_function_privilege('authenticated', 'public.get_dashboard_summary(uuid, date, date)', 'EXECUTE') AS can_dashboard;
--
-- 2) Confirm authenticated SQL Editor calls without auth context still fail:
--
-- SELECT auth.uid();
--
-- Expected in Supabase SQL Editor: NULL, so direct report RPC calls can raise
-- Unauthorized unless run with an authenticated request context.
--
-- 3) Confirm browser purchase actions remain narrow:
--
-- SELECT
--   has_function_privilege('authenticated', 'public.delete_purchase_receiving(uuid, boolean)', 'EXECUTE') AS can_delete_receiving,
--   has_function_privilege('authenticated', 'public.confirm_purchase_receiving(uuid, boolean)', 'EXECUTE') AS can_confirm_stock,
--   has_function_privilege('authenticated', 'public.cancel_purchase_receiving(uuid, text, boolean)', 'EXECUTE') AS can_call_raw_cancel;
--
-- Expected: can_delete_receiving = true, can_confirm_stock = true,
-- can_call_raw_cancel = false.
