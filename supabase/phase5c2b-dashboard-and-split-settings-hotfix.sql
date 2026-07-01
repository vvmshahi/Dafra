-- ============================================================
-- Phase 5C-2B hotfix: dashboard accuracy + Split Payment setting permission
-- Apply manually after phase5c2a-dashboard-branch-and-pos-settings-hotfix.sql.
-- ============================================================
--
-- Goals:
--   - Keep branches RLS/security intact.
--   - Keep Split Payment setting updates behind a narrow SECURITY DEFINER RPC.
--   - Make dashboard branch cards use safe production ZATCA status from the
--     server-side dashboard summary instead of browser cache guesses.
--   - Preserve existing reporting totals semantics from Phase 5B-3B.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data manually outside this schema patch.
--   - Do not call ZATCA.
--   - Do not touch ZATCA XML/signing/hash/QR/canonicalization.
--   - Do not disable RLS on branches.

BEGIN;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS allow_split_payments BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- Narrow POS settings RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_branch_pos_settings(
  p_branch_id UUID,
  p_payload JSONB
)
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
  v_allow_split_payments BOOLEAN;
  v_updated_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch id' USING ERRCODE = '22023';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid POS settings payload' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name <> 'allow_split_payments'
  ) THEN
    RAISE EXCEPTION 'Unsupported POS setting' USING ERRCODE = '22023';
  END IF;

  IF NOT (p_payload ? 'allow_split_payments')
     OR jsonb_typeof(p_payload -> 'allow_split_payments') <> 'boolean'
  THEN
    RAISE EXCEPTION 'allow_split_payments must be a boolean' USING ERRCODE = '22023';
  END IF;

  v_allow_split_payments := (p_payload ->> 'allow_split_payments')::boolean;

  SELECT id, role::text AS role, tenant_id, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, allow_split_payments, is_active
    INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'super_admin' THEN
    NULL;
  ELSIF v_profile.role IN ('owner', 'admin') THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.branches
  SET allow_split_payments = v_allow_split_payments,
      updated_at = v_updated_at
  WHERE id = v_branch.id;

  IF to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_pos_settings_updated',
      v_branch.tenant_id,
      v_branch.id,
      v_user_id,
      v_profile.role,
      'branch',
      v_branch.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'branch_code', v_branch.branch_code,
        'allow_split_payments_before', COALESCE(v_branch.allow_split_payments, FALSE),
        'allow_split_payments_after', v_allow_split_payments
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'branch_id', v_branch.id,
    'allow_split_payments', v_allow_split_payments,
    'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_branch_pos_settings(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_branch_pos_settings(UUID, JSONB) TO authenticated;

COMMENT ON FUNCTION public.update_branch_pos_settings(UUID, JSONB) IS
  'Safely updates narrow branch POS checkout settings without broad browser UPDATE access to branches.';

-- ============================================================
-- Dashboard summary with safe production status
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_summary(
  p_branch_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_scope RECORD;
  v_start_date DATE := COALESCE(p_start_date, CURRENT_DATE);
  v_end_date DATE := COALESCE(p_end_date, COALESCE(p_start_date, CURRENT_DATE));
  v_total_sales NUMERIC := 0;
  v_total_count INTEGER := 0;
  v_total_cash NUMERIC := 0;
  v_total_card NUMERIC := 0;
  v_total_vat NUMERIC := 0;
  v_total_expenses NUMERIC := 0;
  v_daily_sales JSONB := '[]'::jsonb;
  v_branch_stats JSONB := '[]'::jsonb;
BEGIN
  IF v_start_date > v_end_date THEN
    RAISE EXCEPTION 'Invalid dashboard date range' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN v_start_date AND v_end_date
      AND is_counted IS TRUE
  )
  SELECT
    COALESCE(SUM(signed_total_amount), 0),
    COUNT(*)::integer,
    COALESCE(SUM(signed_tax_amount), 0)
  INTO v_total_sales, v_total_count, v_total_vat
  FROM inv;

  WITH inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN v_start_date AND v_end_date
      AND is_counted IS TRUE
  ),
  rows AS (
    SELECT
      COALESCE(p.method::text, inv.payment_method) AS method,
      CASE
        WHEN p.id IS NULL THEN inv.signed_total_amount
        ELSE inv.accounting_sign * COALESCE(p.amount, 0)
      END AS signed_payment_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  )
  SELECT
    COALESCE(SUM(CASE WHEN method = 'cash' THEN signed_payment_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN method = 'card' THEN signed_payment_amount ELSE 0 END), 0)
  INTO v_total_cash, v_total_card
  FROM rows;

  SELECT COALESCE(SUM(total_paid), 0)
    INTO v_total_expenses
  FROM public.reporting_expenses_v e
  WHERE e.tenant_id = v_scope.scope_tenant_id
    AND (v_scope.scope_branch_id IS NULL OR e.branch_id = v_scope.scope_branch_id)
    AND e.expense_date BETWEEN v_start_date AND v_end_date;

  WITH days AS (
    SELECT generate_series(v_start_date, v_end_date, '1 day'::interval)::date AS day
  ),
  rows AS (
    SELECT
      d.day::text AS date,
      COALESCE(SUM(i.signed_total_amount), 0) AS sales
    FROM days d
    LEFT JOIN public.reporting_invoice_documents_v i
      ON i.tenant_id = v_scope.scope_tenant_id
     AND (v_scope.scope_branch_id IS NULL OR i.branch_id = v_scope.scope_branch_id)
     AND i.invoice_date = d.day
     AND i.is_counted IS TRUE
    GROUP BY d.day
    ORDER BY d.day
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', date, 'sales', sales)
    ORDER BY date
  ), '[]'::jsonb)
  INTO v_daily_sales
  FROM rows;

  WITH scoped_branches AS (
    SELECT b.*
    FROM public.branches b
    WHERE b.tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR b.id = v_scope.scope_branch_id)
  ),
  inv AS (
    SELECT *
    FROM public.reporting_invoice_documents_v
    WHERE tenant_id = v_scope.scope_tenant_id
      AND (v_scope.scope_branch_id IS NULL OR branch_id = v_scope.scope_branch_id)
      AND invoice_date BETWEEN v_start_date AND v_end_date
      AND is_counted IS TRUE
  ),
  payment_totals AS (
    SELECT
      inv.branch_id,
      COALESCE(SUM(CASE
        WHEN COALESCE(p.method::text, inv.payment_method) = 'cash'
          THEN CASE
            WHEN p.id IS NULL THEN inv.signed_total_amount
            ELSE inv.accounting_sign * COALESCE(p.amount, 0)
          END
        ELSE 0
      END), 0) AS today_cash,
      COALESCE(SUM(CASE
        WHEN COALESCE(p.method::text, inv.payment_method) = 'card'
          THEN CASE
            WHEN p.id IS NULL THEN inv.signed_total_amount
            ELSE inv.accounting_sign * COALESCE(p.amount, 0)
          END
        ELSE 0
      END), 0) AS today_card
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
    GROUP BY inv.branch_id
  ),
  open_sessions AS (
    SELECT branch_id, MIN(opened_at) AS opened_at
    FROM public.pos_sessions
    WHERE tenant_id = v_scope.scope_tenant_id
      AND status = 'open'
    GROUP BY branch_id
  ),
  production_status AS (
    SELECT DISTINCT ON (branch_id)
      branch_id,
      onboarding_status,
      connected_at,
      disconnected_at,
      updated_at
    FROM public.zatca_production_credentials
    WHERE tenant_id = v_scope.scope_tenant_id
      AND environment = 'production'
    ORDER BY branch_id, updated_at DESC NULLS LAST
  ),
  rows AS (
    SELECT
      b.id,
      b.name,
      b.logo_url,
      b.is_active,
      b.is_main_branch,
      COALESCE(b.zatca_phase, 1) AS zatca_phase,
      COALESCE(SUM(inv.signed_total_amount), 0) AS today_sales,
      COUNT(inv.id)::integer AS today_count,
      COALESCE(pt.today_cash, 0) AS today_cash,
      COALESCE(pt.today_card, 0) AS today_card,
      os.opened_at IS NOT NULL AS session_open,
      os.opened_at AS session_opened_at,
      CASE
        WHEN COALESCE(b.zatca_phase, 1) >= 2 THEN jsonb_build_object(
          'ok', COALESCE(ps.onboarding_status = 'production_connected', FALSE),
          'branchId', b.id,
          'environment', 'production',
          'onboardingStatus', COALESCE(ps.onboarding_status, 'not_started'),
          'connectedAt', ps.connected_at,
          'disconnectedAt', ps.disconnected_at,
          'updatedAt', ps.updated_at
        )
        ELSE NULL
      END AS production_status
    FROM scoped_branches b
    LEFT JOIN inv ON inv.branch_id = b.id
    LEFT JOIN payment_totals pt ON pt.branch_id = b.id
    LEFT JOIN open_sessions os ON os.branch_id = b.id
    LEFT JOIN production_status ps ON ps.branch_id = b.id
    GROUP BY
      b.id,
      b.name,
      b.logo_url,
      b.is_active,
      b.is_main_branch,
      b.zatca_phase,
      pt.today_cash,
      pt.today_card,
      os.opened_at,
      ps.onboarding_status,
      ps.connected_at,
      ps.disconnected_at,
      ps.updated_at
    ORDER BY b.is_main_branch DESC, b.created_at ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name,
      'logo_url', logo_url,
      'is_active', is_active,
      'is_main_branch', is_main_branch,
      'zatca_phase', zatca_phase,
      'todaySales', today_sales,
      'todayCount', today_count,
      'todayCash', today_cash,
      'todayCard', today_card,
      'sessionOpen', session_open,
      'sessionOpenedAt', session_opened_at,
      'metricsAvailable', TRUE,
      'productionStatusReadable', TRUE,
      'productionStatus', production_status
    )
    ORDER BY is_main_branch DESC, name
  ), '[]'::jsonb)
  INTO v_branch_stats
  FROM rows;

  RETURN jsonb_build_object(
    'totalSales', v_total_sales,
    'totalCount', v_total_count,
    'totalCash', v_total_cash,
    'totalCard', v_total_card,
    'totalVat', v_total_vat,
    'totalExpenses', v_total_expenses,
    'dailySales', v_daily_sales,
    'branchStats', v_branch_stats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_summary(UUID, DATE, DATE) IS
  'Safe dashboard summary where cancelled invoices are excluded, credit notes reduce totals, expenses use total_paid, and branch cards include safe production ZATCA status.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm callable RPCs:
--
-- SELECT
--   has_function_privilege('authenticated', 'public.update_branch_pos_settings(uuid, jsonb)', 'EXECUTE') AS can_update_pos,
--   has_function_privilege('authenticated', 'public.get_dashboard_summary(uuid, date, date)', 'EXECUTE') AS can_dashboard;
--
-- Expected: both true.
--
-- 2) Confirm unsupported POS settings are rejected:
--
-- SELECT public.update_branch_pos_settings(
--   '<branch-id>'::uuid,
--   jsonb_build_object('allow_split_payments', true, 'vat_number', 'SHOULD_NOT_UPDATE')
-- );
--
-- Expected: Unsupported POS setting.
--
-- 3) Authenticated owner/admin POS setting smoke:
--
-- SELECT public.update_branch_pos_settings(
--   '<branch-id>'::uuid,
--   jsonb_build_object('allow_split_payments', true)
-- );
--
-- Expected in an authenticated owner/admin request context:
--   ok = true and branches.allow_split_payments updates.
--
-- 4) Dashboard summary smoke:
--
-- SELECT public.get_dashboard_summary(NULL, CURRENT_DATE, CURRENT_DATE);
--
-- Expected in an authenticated owner/admin request context:
--   branchStats includes existing branches, numeric totals, and each Phase 2
--   branch has productionStatus.onboardingStatus from the safe credential row
--   or not_started when no production credential row exists.
--
-- 5) Branch/cashier negative test:
--   A branch/cashier authenticated request to update another branch's POS
--   settings should raise Forbidden.
