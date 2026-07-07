-- ============================================================
-- Phase 4D: Super Admin Billing Summary RPC
-- Apply manually after Phase 4B SQL and Phase 4C UI are in place.
-- ============================================================
--
-- Goals:
--   - Provide one safe aggregate RPC for super-admin client billing visibility.
--   - Replace per-tenant billing/branch helper calls in the client list.
--   - Keep POS billing enforcement out of scope for this phase.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify tenant data.
--   - Do not hard-block POS checkout in this phase.
--   - Do not change invoice numbering, VAT/tax/payment math, reports, ZATCA,
--     printer, Electron, or Edge Functions.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_super_admin_clients_billing_summary()
RETURNS TABLE (
  tenant_id UUID,
  business_name TEXT,
  business_name_ar TEXT,
  vat_number TEXT,
  city TEXT,
  contact_name TEXT,
  contact_email TEXT,
  phone TEXT,
  business_type TEXT,
  tenant_is_active BOOLEAN,
  suspended_at TIMESTAMPTZ,
  suspended_reason TEXT,
  created_at TIMESTAMPTZ,
  subscription_id UUID,
  subscription_plan_name TEXT,
  lifecycle_status TEXT,
  manual_payment_status TEXT,
  current_period_start DATE,
  current_period_end DATE,
  next_due_date DATE,
  grace_until_date DATE,
  days_until_due INTEGER,
  days_overdue INTEGER,
  can_use_pos BOOLEAN,
  access_reason TEXT,
  paid_branch_count INTEGER,
  max_branches INTEGER,
  active_branch_count INTEGER,
  total_branch_count INTEGER,
  user_count INTEGER,
  remaining_branches INTEGER,
  can_create_branch BOOLEAN,
  branch_usage_reason TEXT,
  last_payment_at TIMESTAMPTZ,
  last_payment_amount NUMERIC,
  last_payment_currency TEXT,
  last_payment_method TEXT,
  onboarding_status TEXT,
  owner_setup_status TEXT,
  branch_setup_status TEXT,
  zatca_setup_status TEXT,
  ready_for_billing BOOLEAN,
  billing_signal TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH super_admin_gate AS (
    SELECT EXISTS (
      SELECT 1
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
        AND up.is_active IS TRUE
        AND up.role::text = 'super_admin'
    ) AS allowed
  ),
  tenants_scope AS (
    SELECT t.*
    FROM public.tenants t
    CROSS JOIN super_admin_gate gate
    WHERE gate.allowed IS TRUE
  ),
  branch_counts AS (
    SELECT
      t.id AS tenant_id,
      GREATEST(COALESCE(t.max_branches, 999), 0)::integer AS max_branches,
      COUNT(b.id) FILTER (WHERE COALESCE(b.is_active, TRUE) IS TRUE)::integer AS active_branch_count,
      COUNT(b.id)::integer AS total_branch_count
    FROM tenants_scope t
    LEFT JOIN public.branches b ON b.tenant_id = t.id
    GROUP BY t.id, t.max_branches
  ),
  user_counts AS (
    SELECT
      t.id AS tenant_id,
      COUNT(up.id)::integer AS user_count
    FROM tenants_scope t
    LEFT JOIN public.user_profiles up ON up.tenant_id = t.id
    GROUP BY t.id
  ),
  latest_subscription AS (
    SELECT DISTINCT ON (ts.tenant_id)
      ts.*
    FROM public.tenant_subscriptions ts
    JOIN tenants_scope t ON t.id = ts.tenant_id
    ORDER BY ts.tenant_id, ts.created_at DESC
  ),
  latest_payment AS (
    SELECT DISTINCT ON (msp.tenant_id)
      msp.tenant_id,
      msp.payment_received_at AS last_payment_at,
      msp.amount AS last_payment_amount,
      msp.currency AS last_payment_currency,
      msp.payment_method AS last_payment_method
    FROM public.manual_subscription_payments msp
    JOIN tenants_scope t ON t.id = msp.tenant_id
    ORDER BY msp.tenant_id, msp.payment_received_at DESC, msp.created_at DESC
  ),
  owner_profile AS (
    SELECT DISTINCT ON (up.tenant_id)
      up.tenant_id,
      up.full_name AS contact_name,
      up.email AS contact_email
    FROM public.user_profiles up
    JOIN tenants_scope t ON t.id = up.tenant_id
    WHERE up.role::text = 'owner'
    ORDER BY up.tenant_id, up.created_at ASC
  ),
  calculated AS (
    SELECT
      t.id AS tenant_id,
      t.name AS business_name,
      t.name_ar AS business_name_ar,
      t.vat_number,
      t.city,
      owner_profile.contact_name,
      COALESCE(owner_profile.contact_email, t.email) AS contact_email,
      t.phone,
      t.business_type::text AS business_type,
      COALESCE(t.is_active, TRUE) AS tenant_is_active,
      t.suspended_at,
      t.suspended_reason,
      t.created_at,
      sub.id AS subscription_id,
      sp.name AS subscription_plan_name,
      sub.current_period_start,
      COALESCE(sub.current_period_end, sub.ends_at::date) AS current_period_end,
      COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) AS due_date,
      COALESCE(
        sub.grace_until_date,
        CASE
          WHEN COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) IS NOT NULL
          THEN COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) + 7
          ELSE NULL
        END
      ) AS grace_date,
      bc.max_branches,
      bc.active_branch_count,
      bc.total_branch_count,
      COALESCE(uc.user_count, 0)::integer AS user_count,
      GREATEST(COALESCE(sub.paid_branch_count, 1), 1)::integer AS paid_branch_count,
      lp.last_payment_at,
      lp.last_payment_amount,
      lp.last_payment_currency,
      lp.last_payment_method,
      tos.onboarding_status,
      tos.owner_setup_status,
      tos.branch_setup_status,
      tos.zatca_setup_status,
      COALESCE(tos.ready_for_billing, FALSE) AS ready_for_billing,
      CASE
        WHEN COALESCE(t.is_active, TRUE) IS NOT TRUE
          OR t.suspended_at IS NOT NULL
          OR sub.suspended_at IS NOT NULL THEN 'suspended'
        WHEN sub.id IS NULL THEN
          CASE
            WHEN COALESCE(t.is_active, TRUE) IS TRUE AND t.suspended_at IS NULL THEN 'active'
            ELSE 'suspended'
          END
        WHEN sub.cancelled_at IS NOT NULL
          OR sub.status::text = 'cancelled'
          OR sub.subscription_lifecycle_status = 'cancelled' THEN 'cancelled'
        WHEN sub.subscription_lifecycle_status = 'lifetime_free'
          OR (sub.status::text = 'active'
              AND COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) IS NULL
              AND sub.ends_at IS NULL) THEN 'lifetime_free'
        WHEN COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) IS NULL THEN
          COALESCE(NULLIF(sub.subscription_lifecycle_status, ''), 'active')
        WHEN CURRENT_DATE <= COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) THEN 'active'
        WHEN CURRENT_DATE <= COALESCE(
          sub.grace_until_date,
          COALESCE(sub.next_due_date, sub.current_period_end, sub.ends_at::date) + 7
        ) THEN 'grace_period'
        ELSE 'payment_due'
      END AS computed_lifecycle
    FROM tenants_scope t
    LEFT JOIN latest_subscription sub ON sub.tenant_id = t.id
    LEFT JOIN public.subscription_plans sp ON sp.id = sub.plan_id
    LEFT JOIN branch_counts bc ON bc.tenant_id = t.id
    LEFT JOIN user_counts uc ON uc.tenant_id = t.id
    LEFT JOIN latest_payment lp ON lp.tenant_id = t.id
    LEFT JOIN public.tenant_onboarding_status tos ON tos.tenant_id = t.id
    LEFT JOIN owner_profile ON owner_profile.tenant_id = t.id
  )
  SELECT
    c.tenant_id,
    c.business_name,
    c.business_name_ar,
    c.vat_number,
    c.city,
    c.contact_name,
    c.contact_email,
    c.phone,
    c.business_type,
    c.tenant_is_active,
    c.suspended_at,
    c.suspended_reason,
    c.created_at,
    c.subscription_id,
    c.subscription_plan_name,
    c.computed_lifecycle AS lifecycle_status,
    CASE
      WHEN c.computed_lifecycle IN ('active', 'lifetime_free', 'grace_period')
        THEN COALESCE(sub.manual_payment_status, 'manual_verified')
      WHEN c.computed_lifecycle = 'payment_due' THEN 'overdue'
      WHEN c.computed_lifecycle = 'cancelled' THEN COALESCE(sub.manual_payment_status, 'unpaid')
      WHEN c.computed_lifecycle = 'suspended' THEN COALESCE(sub.manual_payment_status, 'overdue')
      ELSE COALESCE(sub.manual_payment_status, 'unpaid')
    END AS manual_payment_status,
    c.current_period_start,
    c.current_period_end,
    c.due_date AS next_due_date,
    c.grace_date AS grace_until_date,
    CASE WHEN c.due_date IS NULL THEN NULL ELSE (c.due_date - CURRENT_DATE)::integer END AS days_until_due,
    CASE WHEN c.due_date IS NULL OR CURRENT_DATE <= c.due_date THEN 0 ELSE (CURRENT_DATE - c.due_date)::integer END AS days_overdue,
    CASE
      WHEN c.computed_lifecycle IN ('cancelled', 'suspended', 'payment_due') THEN FALSE
      ELSE TRUE
    END AS can_use_pos,
    CASE
      WHEN c.subscription_id IS NULL AND c.computed_lifecycle = 'active' THEN 'legacy_no_subscription_record'
      WHEN c.computed_lifecycle = 'lifetime_free' THEN 'lifetime_free'
      WHEN c.computed_lifecycle = 'active' THEN 'subscription_active'
      WHEN c.computed_lifecycle = 'grace_period' THEN 'within_grace_period'
      WHEN c.computed_lifecycle = 'payment_due' THEN 'payment_overdue_after_grace'
      WHEN c.computed_lifecycle = 'cancelled' THEN 'subscription_cancelled'
      WHEN c.computed_lifecycle = 'suspended' THEN 'tenant_or_subscription_suspended'
      ELSE c.computed_lifecycle
    END AS access_reason,
    c.paid_branch_count,
    c.max_branches,
    c.active_branch_count,
    c.total_branch_count,
    c.user_count,
    GREATEST(c.max_branches - c.active_branch_count, 0)::integer AS remaining_branches,
    c.active_branch_count < c.max_branches AS can_create_branch,
    CASE
      WHEN c.active_branch_count < c.max_branches THEN 'within_branch_limit'
      ELSE 'branch_limit_reached'
    END AS branch_usage_reason,
    c.last_payment_at,
    c.last_payment_amount,
    c.last_payment_currency,
    c.last_payment_method,
    c.onboarding_status,
    c.owner_setup_status,
    c.branch_setup_status,
    c.zatca_setup_status,
    c.ready_for_billing,
    CASE
      WHEN c.tenant_is_active IS NOT TRUE OR c.computed_lifecycle = 'suspended' THEN 'suspended'
      WHEN c.computed_lifecycle = 'lifetime_free' THEN 'paid'
      WHEN c.due_date IS NOT NULL
        AND CURRENT_DATE <= c.due_date
        AND (c.due_date - CURRENT_DATE) BETWEEN 0 AND 7 THEN 'due_soon'
      WHEN c.due_date IS NOT NULL AND CURRENT_DATE <= c.due_date THEN 'paid'
      WHEN c.due_date IS NOT NULL
        AND CURRENT_DATE > c.due_date
        AND c.grace_date IS NOT NULL
        AND CURRENT_DATE <= c.grace_date THEN 'in_grace'
      WHEN c.grace_date IS NOT NULL AND CURRENT_DATE > c.grace_date THEN 'overdue'
      WHEN c.computed_lifecycle = 'payment_due' THEN 'overdue'
      ELSE 'unknown'
    END AS billing_signal
  FROM calculated c
  LEFT JOIN latest_subscription sub ON sub.id = c.subscription_id
  ORDER BY c.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_super_admin_clients_billing_summary() IS
  'Returns one billing/onboarding/branch summary row per tenant for super-admin client list visibility. Returns no rows for non-super-admin callers.';

REVOKE ALL ON FUNCTION public.get_super_admin_clients_billing_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_super_admin_clients_billing_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
