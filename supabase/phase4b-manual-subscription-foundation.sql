-- ============================================================
-- Phase 4B: Manual Subscription, Payment, and Onboarding Foundation
-- Apply manually after Phase 4A audit review.
-- ============================================================
--
-- Goals:
--   - Add a manual subscription payment ledger.
--   - Extend tenant_subscriptions with non-destructive lifecycle fields.
--   - Add onboarding status and internal support-note foundations.
--   - Add helper functions for future POS/branch-limit enforcement.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not hard-block POS checkout in this phase.
--   - Do not change invoice numbering, VAT/tax/payment math, reports, ZATCA,
--     printer, Electron, or existing production credential behavior.

BEGIN;

-- ============================================================
-- Tenant subscription lifecycle foundation
-- ============================================================

ALTER TABLE public.tenant_subscriptions
  ADD COLUMN IF NOT EXISTS plan_interval TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS price_per_branch NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS paid_branch_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_period_start DATE,
  ADD COLUMN IF NOT EXISTS current_period_end DATE,
  ADD COLUMN IF NOT EXISTS next_due_date DATE,
  ADD COLUMN IF NOT EXISTS grace_until_date DATE,
  ADD COLUMN IF NOT EXISTS manual_payment_status TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS subscription_lifecycle_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_payment_id UUID,
  ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_subscriptions_plan_interval_check'
      AND conrelid = 'public.tenant_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_plan_interval_check
      CHECK (plan_interval IN ('monthly', 'yearly', 'manual', 'custom', 'lifetime'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_subscriptions_paid_branch_count_check'
      AND conrelid = 'public.tenant_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_paid_branch_count_check
      CHECK (paid_branch_count >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_subscriptions_price_per_branch_check'
      AND conrelid = 'public.tenant_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_price_per_branch_check
      CHECK (price_per_branch IS NULL OR price_per_branch >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_subscriptions_period_dates_check'
      AND conrelid = 'public.tenant_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_period_dates_check
      CHECK (
        current_period_start IS NULL
        OR current_period_end IS NULL
        OR current_period_end >= current_period_start
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_subscriptions_due_grace_check'
      AND conrelid = 'public.tenant_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_due_grace_check
      CHECK (
        next_due_date IS NULL
        OR grace_until_date IS NULL
        OR grace_until_date >= next_due_date
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_subscriptions_manual_payment_status_check'
      AND conrelid = 'public.tenant_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_manual_payment_status_check
      CHECK (manual_payment_status IN ('unpaid', 'manual_verified', 'overdue', 'refunded'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_subscriptions_lifecycle_status_check'
      AND conrelid = 'public.tenant_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_lifecycle_status_check
      CHECK (
        subscription_lifecycle_status IN (
          'setup_pending',
          'active',
          'payment_due',
          'grace_period',
          'suspended',
          'cancelled',
          'lifetime_free'
        )
      );
  END IF;
END;
$$;

UPDATE public.tenant_subscriptions ts
SET
  plan_interval = CASE
    WHEN ts.ends_at IS NULL AND ts.status::text = 'active' THEN 'lifetime'
    WHEN ts.ends_at IS NOT NULL AND (ts.ends_at::date - ts.starts_at::date) >= 330 THEN 'yearly'
    WHEN ts.ends_at IS NOT NULL AND (ts.ends_at::date - ts.starts_at::date) BETWEEN 27 AND 32 THEN 'monthly'
    ELSE COALESCE(NULLIF(ts.plan_interval, ''), 'manual')
  END,
  price_per_branch = COALESCE(ts.price_per_branch, sp.price_monthly),
  paid_branch_count = GREATEST(
    1,
    COALESCE(
      ts.paid_branch_count,
      NULLIF(t.max_branches, 999),
      1
    )
  ),
  current_period_start = COALESCE(ts.current_period_start, ts.starts_at::date),
  current_period_end = COALESCE(ts.current_period_end, ts.ends_at::date),
  next_due_date = COALESCE(ts.next_due_date, ts.ends_at::date),
  grace_until_date = COALESCE(ts.grace_until_date, (ts.ends_at::date + 7)),
  manual_payment_status = CASE
    WHEN ts.manual_payment_status IS NOT NULL AND ts.manual_payment_status <> 'unpaid' THEN ts.manual_payment_status
    WHEN ts.status::text = 'active' THEN 'manual_verified'
    WHEN ts.status::text = 'expired' THEN 'overdue'
    ELSE ts.manual_payment_status
  END,
  subscription_lifecycle_status = CASE
    WHEN ts.subscription_lifecycle_status IS NOT NULL
         AND ts.subscription_lifecycle_status <> 'active'
    THEN ts.subscription_lifecycle_status
    WHEN ts.cancelled_at IS NOT NULL OR ts.status::text = 'cancelled' THEN 'cancelled'
    WHEN ts.status::text = 'active' AND ts.ends_at IS NULL THEN 'lifetime_free'
    WHEN ts.status::text = 'active' THEN 'active'
    WHEN ts.status::text = 'expired' THEN 'payment_due'
    WHEN ts.status::text = 'trial' THEN 'setup_pending'
    ELSE ts.subscription_lifecycle_status
  END
FROM public.tenants t,
     public.subscription_plans sp
WHERE t.id = ts.tenant_id
  AND sp.id = ts.plan_id;

CREATE INDEX IF NOT EXISTS tenant_subscriptions_lifecycle_idx
  ON public.tenant_subscriptions (subscription_lifecycle_status, next_due_date);

CREATE INDEX IF NOT EXISTS tenant_subscriptions_payment_status_idx
  ON public.tenant_subscriptions (manual_payment_status, next_due_date);

CREATE INDEX IF NOT EXISTS tenant_subscriptions_next_due_idx
  ON public.tenant_subscriptions (next_due_date)
  WHERE next_due_date IS NOT NULL;

COMMENT ON COLUMN public.tenant_subscriptions.plan_interval IS
  'Manual billing interval for Kubri subscription operations: monthly, yearly, manual, custom, or lifetime.';

COMMENT ON COLUMN public.tenant_subscriptions.subscription_lifecycle_status IS
  'Non-destructive manual lifecycle status used by Kubri support; does not replace the legacy subscription_status enum.';

COMMENT ON COLUMN public.tenant_subscriptions.manual_payment_status IS
  'Manual payment status for offline payments before gateway integration.';

-- ============================================================
-- Manual subscription payment ledger
-- ============================================================

CREATE TABLE IF NOT EXISTS public.manual_subscription_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.tenant_subscriptions(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  plan_interval TEXT NOT NULL,
  paid_branch_count INTEGER NOT NULL,
  price_per_branch NUMERIC(12, 2),
  payment_method TEXT,
  payment_reference TEXT,
  payment_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  coverage_start_date DATE NOT NULL,
  coverage_end_date DATE NOT NULL,
  next_due_date DATE NOT NULL,
  grace_until_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'manual_verified',
  money_back_until_date DATE,
  notes TEXT,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manual_subscription_payments_amount_check
    CHECK (amount >= 0),
  CONSTRAINT manual_subscription_payments_paid_branch_count_check
    CHECK (paid_branch_count >= 1),
  CONSTRAINT manual_subscription_payments_price_per_branch_check
    CHECK (price_per_branch IS NULL OR price_per_branch >= 0),
  CONSTRAINT manual_subscription_payments_currency_check
    CHECK (currency = upper(currency) AND length(currency) = 3),
  CONSTRAINT manual_subscription_payments_plan_interval_check
    CHECK (plan_interval IN ('monthly', 'yearly', 'manual', 'custom', 'lifetime')),
  CONSTRAINT manual_subscription_payments_coverage_dates_check
    CHECK (coverage_end_date >= coverage_start_date),
  CONSTRAINT manual_subscription_payments_due_date_check
    CHECK (next_due_date >= coverage_end_date),
  CONSTRAINT manual_subscription_payments_grace_date_check
    CHECK (grace_until_date = next_due_date + 7),
  CONSTRAINT manual_subscription_payments_status_check
    CHECK (status IN ('unpaid', 'manual_verified', 'overdue', 'refunded'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_subscriptions_last_payment_id_fkey'
      AND conrelid = 'public.tenant_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.tenant_subscriptions
      ADD CONSTRAINT tenant_subscriptions_last_payment_id_fkey
      FOREIGN KEY (last_payment_id)
      REFERENCES public.manual_subscription_payments(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS manual_subscription_payments_tenant_received_idx
  ON public.manual_subscription_payments (tenant_id, payment_received_at DESC);

CREATE INDEX IF NOT EXISTS manual_subscription_payments_subscription_idx
  ON public.manual_subscription_payments (subscription_id)
  WHERE subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS manual_subscription_payments_next_due_idx
  ON public.manual_subscription_payments (next_due_date, status);

DROP TRIGGER IF EXISTS trg_manual_subscription_payments_updated_at ON public.manual_subscription_payments;
CREATE TRIGGER trg_manual_subscription_payments_updated_at
  BEFORE UPDATE ON public.manual_subscription_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.manual_subscription_payments IS
  'Manual ledger of offline Kubri subscription payments before payment gateway integration.';

COMMENT ON COLUMN public.manual_subscription_payments.payment_reference IS
  'Manual payment proof/reference. Do not store card data or sensitive bank credentials.';

-- ============================================================
-- Onboarding status foundation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenant_onboarding_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID UNIQUE NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  onboarding_status TEXT NOT NULL DEFAULT 'details_pending',
  owner_setup_status TEXT NOT NULL DEFAULT 'owner_invited',
  branch_setup_status TEXT NOT NULL DEFAULT 'branch_setup_pending',
  zatca_setup_status TEXT NOT NULL DEFAULT 'zatca_setup_pending',
  ready_for_billing BOOLEAN NOT NULL DEFAULT FALSE,
  owner_setup_link_sent_at TIMESTAMPTZ,
  owner_setup_completed_at TIMESTAMPTZ,
  first_branch_created_at TIMESTAMPTZ,
  first_invoice_created_at TIMESTAMPTZ,
  notes TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_onboarding_status_check
    CHECK (
      onboarding_status IN (
        'details_pending',
        'owner_invited',
        'owner_setup_complete',
        'branch_setup_pending',
        'zatca_setup_pending',
        'ready_for_billing',
        'live'
      )
    ),
  CONSTRAINT tenant_onboarding_owner_setup_status_check
    CHECK (owner_setup_status IN ('owner_invited', 'owner_setup_complete', 'setup_link_expired', 'setup_blocked')),
  CONSTRAINT tenant_onboarding_branch_setup_status_check
    CHECK (branch_setup_status IN ('branch_setup_pending', 'first_branch_created', 'branch_setup_complete')),
  CONSTRAINT tenant_onboarding_zatca_setup_status_check
    CHECK (zatca_setup_status IN ('zatca_setup_pending', 'not_required', 'in_progress', 'production_ready', 'needs_attention'))
);

CREATE INDEX IF NOT EXISTS tenant_onboarding_status_status_idx
  ON public.tenant_onboarding_status (onboarding_status, ready_for_billing);

DROP TRIGGER IF EXISTS trg_tenant_onboarding_status_updated_at ON public.tenant_onboarding_status;
CREATE TRIGGER trg_tenant_onboarding_status_updated_at
  BEFORE UPDATE ON public.tenant_onboarding_status
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.tenant_onboarding_status (
  tenant_id,
  onboarding_status,
  owner_setup_status,
  branch_setup_status,
  zatca_setup_status,
  ready_for_billing,
  first_branch_created_at,
  first_invoice_created_at
)
SELECT
  t.id,
  CASE
    WHEN inv.first_invoice_created_at IS NOT NULL THEN 'live'
    WHEN br.first_branch_created_at IS NOT NULL THEN 'ready_for_billing'
    WHEN owner_profile.owner_exists IS TRUE THEN 'branch_setup_pending'
    ELSE 'owner_invited'
  END,
  CASE
    WHEN owner_profile.owner_exists IS TRUE THEN 'owner_setup_complete'
    ELSE 'owner_invited'
  END,
  CASE
    WHEN br.first_branch_created_at IS NOT NULL THEN 'first_branch_created'
    ELSE 'branch_setup_pending'
  END,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.tenant_id = t.id
        AND COALESCE(b.zatca_phase, 1) >= 2
    ) THEN 'zatca_setup_pending'
    ELSE 'not_required'
  END,
  br.first_branch_created_at IS NOT NULL,
  br.first_branch_created_at,
  inv.first_invoice_created_at
FROM public.tenants t
LEFT JOIN LATERAL (
  SELECT MIN(b.created_at) AS first_branch_created_at
  FROM public.branches b
  WHERE b.tenant_id = t.id
) br ON TRUE
LEFT JOIN LATERAL (
  SELECT MIN(i.created_at) AS first_invoice_created_at
  FROM public.invoices i
  WHERE i.tenant_id = t.id
) inv ON TRUE
LEFT JOIN LATERAL (
  SELECT TRUE AS owner_exists
  FROM public.user_profiles up
  WHERE up.tenant_id = t.id
    AND up.role::text = 'owner'
  LIMIT 1
) owner_profile ON TRUE
ON CONFLICT (tenant_id) DO NOTHING;

COMMENT ON TABLE public.tenant_onboarding_status IS
  'Manual onboarding checklist/status foundation for Kubri super-admin operations.';

-- ============================================================
-- Internal support notes foundation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tenant_support_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  note_type TEXT NOT NULL DEFAULT 'general',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_support_notes_note_no_empty
    CHECK (length(btrim(note)) > 0),
  CONSTRAINT tenant_support_notes_note_type_check
    CHECK (note_type IN ('general', 'payment', 'onboarding', 'support', 'risk', 'zatca'))
);

CREATE INDEX IF NOT EXISTS tenant_support_notes_tenant_created_idx
  ON public.tenant_support_notes (tenant_id, created_at DESC);

COMMENT ON TABLE public.tenant_support_notes IS
  'Internal Kubri support notes; replaces misuse of tenants.address for support/payment/onboarding notes.';

-- ============================================================
-- Branch usage and subscription access helpers
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_tenant_branch_usage(p_tenant_id UUID)
RETURNS TABLE (
  tenant_id UUID,
  max_branches INTEGER,
  active_branch_count INTEGER,
  total_branch_count INTEGER,
  remaining_branches INTEGER,
  can_create_branch BOOLEAN,
  reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH tenant_row AS (
    SELECT
      t.id,
      GREATEST(COALESCE(t.max_branches, 999), 0)::integer AS max_branches
    FROM public.tenants t
    WHERE t.id = p_tenant_id
      AND (
        public.is_super_admin()
        OR public.get_my_tenant_id() = t.id
      )
  ),
  counts AS (
    SELECT
      tr.id AS tenant_id,
      tr.max_branches,
      COUNT(b.id) FILTER (WHERE COALESCE(b.is_active, TRUE) IS TRUE)::integer AS active_branch_count,
      COUNT(b.id)::integer AS total_branch_count
    FROM tenant_row tr
    LEFT JOIN public.branches b ON b.tenant_id = tr.id
    GROUP BY tr.id, tr.max_branches
  )
  SELECT
    c.tenant_id,
    c.max_branches,
    c.active_branch_count,
    c.total_branch_count,
    GREATEST(c.max_branches - c.active_branch_count, 0)::integer AS remaining_branches,
    c.active_branch_count < c.max_branches AS can_create_branch,
    CASE
      WHEN c.active_branch_count < c.max_branches THEN 'within_branch_limit'
      ELSE 'branch_limit_reached'
    END AS reason
  FROM counts c;
$$;

CREATE OR REPLACE FUNCTION public.can_create_branch(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT usage.can_create_branch
    FROM public.get_tenant_branch_usage(p_tenant_id) AS usage
    LIMIT 1
  ), FALSE)
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_subscription_access(p_tenant_id UUID)
RETURNS TABLE (
  tenant_id UUID,
  lifecycle_status TEXT,
  manual_payment_status TEXT,
  max_branches INTEGER,
  paid_branch_count INTEGER,
  current_period_end DATE,
  next_due_date DATE,
  grace_until_date DATE,
  days_until_due INTEGER,
  days_overdue INTEGER,
  can_use_pos BOOLEAN,
  can_create_branch BOOLEAN,
  reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant RECORD;
  v_sub RECORD;
  v_has_sub BOOLEAN := FALSE;
  v_due DATE;
  v_grace DATE;
  v_lifecycle TEXT;
  v_payment_status TEXT;
  v_can_create_branch BOOLEAN := FALSE;
BEGIN
  SELECT
    t.id,
    COALESCE(t.is_active, TRUE) AS is_active,
    t.suspended_at,
    GREATEST(COALESCE(t.max_branches, 999), 0)::integer AS max_branches
  INTO v_tenant
  FROM public.tenants t
  WHERE t.id = p_tenant_id
    AND (
      public.is_super_admin()
      OR public.get_my_tenant_id() = t.id
    );

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      p_tenant_id,
      'not_found'::TEXT,
      'unpaid'::TEXT,
      0,
      0,
      NULL::DATE,
      NULL::DATE,
      NULL::DATE,
      NULL::INTEGER,
      NULL::INTEGER,
      FALSE,
      FALSE,
      'tenant_not_found_or_forbidden'::TEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_sub
  FROM public.tenant_subscriptions ts
  WHERE ts.tenant_id = p_tenant_id
  ORDER BY ts.created_at DESC
  LIMIT 1;
  v_has_sub := FOUND;

  SELECT usage.can_create_branch
  INTO v_can_create_branch
  FROM public.get_tenant_branch_usage(p_tenant_id) AS usage
  LIMIT 1;
  v_can_create_branch := COALESCE(v_can_create_branch, FALSE);

  IF NOT v_has_sub THEN
    RETURN QUERY
    SELECT
      v_tenant.id,
      CASE WHEN v_tenant.is_active IS TRUE AND v_tenant.suspended_at IS NULL THEN 'active' ELSE 'suspended' END,
      'unpaid'::TEXT,
      v_tenant.max_branches,
      1,
      NULL::DATE,
      NULL::DATE,
      NULL::DATE,
      NULL::INTEGER,
      NULL::INTEGER,
      (v_tenant.is_active IS TRUE AND v_tenant.suspended_at IS NULL),
      v_can_create_branch,
      CASE
        WHEN v_tenant.is_active IS TRUE AND v_tenant.suspended_at IS NULL THEN 'legacy_no_subscription_record'
        ELSE 'tenant_inactive_or_suspended'
      END;
    RETURN;
  END IF;

  v_due := COALESCE(v_sub.next_due_date, v_sub.current_period_end, v_sub.ends_at::date);
  v_grace := COALESCE(v_sub.grace_until_date, CASE WHEN v_due IS NOT NULL THEN v_due + 7 ELSE NULL END);

  IF v_tenant.is_active IS NOT TRUE OR v_tenant.suspended_at IS NOT NULL OR v_sub.suspended_at IS NOT NULL THEN
    v_lifecycle := 'suspended';
  ELSIF v_sub.cancelled_at IS NOT NULL
        OR v_sub.status::text = 'cancelled'
        OR v_sub.subscription_lifecycle_status = 'cancelled' THEN
    v_lifecycle := 'cancelled';
  ELSIF v_sub.subscription_lifecycle_status = 'lifetime_free'
        OR (v_sub.status::text = 'active' AND v_due IS NULL AND v_sub.ends_at IS NULL) THEN
    v_lifecycle := 'lifetime_free';
  ELSIF v_due IS NULL THEN
    v_lifecycle := COALESCE(NULLIF(v_sub.subscription_lifecycle_status, ''), 'active');
  ELSIF CURRENT_DATE <= v_due THEN
    v_lifecycle := 'active';
  ELSIF v_grace IS NOT NULL AND CURRENT_DATE <= v_grace THEN
    v_lifecycle := 'grace_period';
  ELSE
    v_lifecycle := 'payment_due';
  END IF;

  v_payment_status := CASE
    WHEN v_lifecycle IN ('active', 'lifetime_free', 'grace_period') THEN COALESCE(v_sub.manual_payment_status, 'manual_verified')
    WHEN v_lifecycle = 'payment_due' THEN 'overdue'
    WHEN v_lifecycle = 'cancelled' THEN COALESCE(v_sub.manual_payment_status, 'unpaid')
    WHEN v_lifecycle = 'suspended' THEN COALESCE(v_sub.manual_payment_status, 'overdue')
    ELSE COALESCE(v_sub.manual_payment_status, 'unpaid')
  END;

  RETURN QUERY
  SELECT
    v_tenant.id,
    v_lifecycle,
    v_payment_status,
    v_tenant.max_branches,
    GREATEST(COALESCE(v_sub.paid_branch_count, 1), 1)::integer,
    COALESCE(v_sub.current_period_end, v_sub.ends_at::date),
    v_due,
    v_grace,
    CASE WHEN v_due IS NULL THEN NULL ELSE (v_due - CURRENT_DATE)::integer END,
    CASE WHEN v_due IS NULL OR CURRENT_DATE <= v_due THEN 0 ELSE (CURRENT_DATE - v_due)::integer END,
    CASE
      WHEN v_lifecycle IN ('cancelled', 'suspended', 'payment_due') THEN FALSE
      ELSE TRUE
    END,
    v_can_create_branch,
    CASE
      WHEN v_lifecycle = 'lifetime_free' THEN 'lifetime_free'
      WHEN v_lifecycle = 'active' THEN 'subscription_active'
      WHEN v_lifecycle = 'grace_period' THEN 'within_grace_period'
      WHEN v_lifecycle = 'payment_due' THEN 'payment_overdue_after_grace'
      WHEN v_lifecycle = 'cancelled' THEN 'subscription_cancelled'
      WHEN v_lifecycle = 'suspended' THEN 'tenant_or_subscription_suspended'
      ELSE v_lifecycle
    END;
END;
$$;

COMMENT ON FUNCTION public.get_tenant_branch_usage(UUID) IS
  'Returns branch usage and branch-limit availability for a tenant without enforcing writes.';

COMMENT ON FUNCTION public.can_create_branch(UUID) IS
  'Boolean helper for future branch creation enforcement.';

COMMENT ON FUNCTION public.get_tenant_subscription_access(UUID) IS
  'Calculates manual subscription access state for future POS/branch enforcement; this phase does not wire it into checkout.';

-- ============================================================
-- RLS and grants
-- ============================================================

ALTER TABLE public.manual_subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_onboarding_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_support_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manual_subscription_payments_service_role_all ON public.manual_subscription_payments;
DROP POLICY IF EXISTS manual_subscription_payments_super_admin_all ON public.manual_subscription_payments;
DROP POLICY IF EXISTS manual_subscription_payments_owner_read ON public.manual_subscription_payments;

CREATE POLICY manual_subscription_payments_service_role_all
  ON public.manual_subscription_payments
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY manual_subscription_payments_super_admin_all
  ON public.manual_subscription_payments
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY manual_subscription_payments_owner_read
  ON public.manual_subscription_payments
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role()::text IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS tenant_onboarding_status_service_role_all ON public.tenant_onboarding_status;
DROP POLICY IF EXISTS tenant_onboarding_status_super_admin_all ON public.tenant_onboarding_status;
DROP POLICY IF EXISTS tenant_onboarding_status_owner_read ON public.tenant_onboarding_status;

CREATE POLICY tenant_onboarding_status_service_role_all
  ON public.tenant_onboarding_status
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY tenant_onboarding_status_super_admin_all
  ON public.tenant_onboarding_status
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY tenant_onboarding_status_owner_read
  ON public.tenant_onboarding_status
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_role()::text IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS tenant_support_notes_service_role_all ON public.tenant_support_notes;
DROP POLICY IF EXISTS tenant_support_notes_super_admin_all ON public.tenant_support_notes;

CREATE POLICY tenant_support_notes_service_role_all
  ON public.tenant_support_notes
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

CREATE POLICY tenant_support_notes_super_admin_all
  ON public.tenant_support_notes
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

REVOKE ALL ON TABLE public.manual_subscription_payments FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.tenant_onboarding_status FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.tenant_support_notes FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manual_subscription_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_onboarding_status TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_support_notes TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.manual_subscription_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_onboarding_status TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_support_notes TO service_role;

REVOKE ALL ON FUNCTION public.get_tenant_branch_usage(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_create_branch(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tenant_subscription_access(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_tenant_branch_usage(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_create_branch(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tenant_subscription_access(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
