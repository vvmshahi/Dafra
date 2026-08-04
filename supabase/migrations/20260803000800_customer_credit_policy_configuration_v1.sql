-- Tenant-level customer-credit configuration and discoverable legacy account setup.
--
-- This is forward-only and does not create invoices, payments, receipts, ledger
-- entries, stock movements, fiscal artefacts, or historical balances. Existing
-- customer policies remain disabled or retain their explicitly configured limit.
-- A tenant policy row is deliberately created only by an authorised write; an
-- absent row is a safe, explicit disabled state for both existing and new tenants.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $required_customer_credit_contracts$
BEGIN
  IF to_regclass('public.customers') IS NULL
     OR to_regclass('public.customer_credit_policies') IS NULL
     OR to_regclass('public.customer_receivable_accounts') IS NULL
     OR to_regprocedure('public.ar_assert_scope_v1(uuid,uuid)') IS NULL
     OR to_regprocedure('public.post_customer_credit_checkout_v1(jsonb)') IS NULL
     OR to_regprocedure('public.record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)') IS NULL
  THEN
    RAISE EXCEPTION 'AR_CREDIT_POLICY_CONFIGURATION_REQUIRED_CONTRACT_MISSING';
  END IF;
END
$required_customer_credit_contracts$;

CREATE TABLE IF NOT EXISTS public.tenant_customer_credit_policies (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  credit_enabled boolean NOT NULL DEFAULT false,
  allow_unpaid_invoices boolean NOT NULL DEFAULT true,
  allow_partial_initial_payments boolean NOT NULL DEFAULT true,
  default_credit_limit numeric(12,2) NOT NULL DEFAULT 0
    CHECK (default_credit_limit >= 0),
  hard_limit_enforced boolean NOT NULL DEFAULT true,
  warn_threshold_percent numeric(5,2) NOT NULL DEFAULT 80
    CHECK (warn_threshold_percent BETWEEN 0 AND 100),
  enforce_customer_hold boolean NOT NULL DEFAULT true,
  allow_manager_override boolean NOT NULL DEFAULT false,
  default_allocation_mode text NOT NULL DEFAULT 'oldest_first'
    CHECK (default_allocation_mode IN ('oldest_first', 'manual')),
  internal_terms text,
  due_date_days integer CHECK (due_date_days BETWEEN 1 AND 365),
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenant_customer_credit_policies IS
  'Tenant-wide customer-credit controls. No row means credit is disabled. Rows are created only by an authorised Owner/admin policy save; no migration or read operation enables credit.';

ALTER TABLE public.customer_credit_policies
  ADD COLUMN IF NOT EXISTS use_tenant_default boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS configured_credit_limit numeric(12,2),
  ADD COLUMN IF NOT EXISTS configured_hold boolean,
  ADD COLUMN IF NOT EXISTS configured_hold_reason text,
  ADD COLUMN IF NOT EXISTS due_date_days integer;

-- Preserve all already configured customer limits/holds before adding the
-- tenant-default indirection. This changes policy metadata only, never AR rows.
UPDATE public.customer_credit_policies
SET configured_credit_limit = credit_limit,
    configured_hold = hold,
    configured_hold_reason = hold_reason
WHERE configured_credit_limit IS NULL
   OR configured_hold IS NULL;

ALTER TABLE public.customer_credit_policies
  ALTER COLUMN configured_credit_limit SET NOT NULL,
  ALTER COLUMN configured_hold SET NOT NULL;

DO $customer_policy_configuration_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_credit_policies_configured_hold_reason_check'
      AND conrelid = 'public.customer_credit_policies'::regclass
  ) THEN
    ALTER TABLE public.customer_credit_policies
      ADD CONSTRAINT customer_credit_policies_configured_hold_reason_check
      CHECK ((configured_hold IS FALSE)
        OR nullif(btrim(coalesce(configured_hold_reason, '')), '') IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customer_credit_policies_due_date_days_check'
      AND conrelid = 'public.customer_credit_policies'::regclass
  ) THEN
    ALTER TABLE public.customer_credit_policies
      ADD CONSTRAINT customer_credit_policies_due_date_days_check
      CHECK (due_date_days IS NULL OR due_date_days BETWEEN 1 AND 365);
  END IF;
END
$customer_policy_configuration_constraints$;

COMMENT ON TABLE public.customer_credit_policies IS
  'Per-customer receivable-account credit approvals. A row never grants credit by itself: the tenant policy must exist and be enabled, and each customer remains explicitly approved.';

-- The original AR scope helper predated the operational roles added by the
-- receivables schema. All roles may execute authorised operational reads and
-- credit checkout in their own scope; only individual policy writers below may
-- configure credit, and they require owner/admin explicitly.
CREATE OR REPLACE FUNCTION public.ar_assert_scope_v1(
  p_branch_id uuid,
  p_customer_id uuid DEFAULT NULL
)
RETURNS TABLE(
  tenant_id uuid,
  actor_id uuid,
  actor_role text,
  branch_id uuid,
  customer_id uuid,
  receivable_account_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor record;
  v_branch record;
  v_customer record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AR_AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role, p.is_active
  INTO v_actor
  FROM public.user_profiles p
  WHERE p.id = auth.uid();

  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin', 'manager', 'accountant', 'cashier', 'branch')
  THEN
    RAISE EXCEPTION 'AR_ACTOR_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active,
         coalesce(t.is_active, true) AS tenant_active, t.suspended_at
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id;

  IF NOT FOUND OR v_branch.is_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE OR v_branch.suspended_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'AR_BRANCH_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  IF v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_actor.role IN ('branch', 'cashier', 'manager')
         AND v_actor.branch_id IS DISTINCT FROM v_branch.id)
  THEN
    RAISE EXCEPTION 'AR_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT c.id, c.tenant_id, c.branch_id, c.receivable_account_id, c.is_active
    INTO v_customer
    FROM public.customers c
    WHERE c.id = p_customer_id;

    IF NOT FOUND OR v_customer.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_customer.branch_id IS DISTINCT FROM v_branch.id
       OR v_customer.is_active IS NOT TRUE
    THEN
      RAISE EXCEPTION 'AR_CUSTOMER_NOT_ACTIVE_OR_OUT_OF_SCOPE' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY SELECT v_branch.tenant_id, v_actor.id, v_actor.role, v_branch.id,
    CASE WHEN p_customer_id IS NULL THEN NULL::uuid ELSE v_customer.id END,
    CASE WHEN p_customer_id IS NULL THEN NULL::uuid ELSE v_customer.receivable_account_id END;
END
$function$;

CREATE OR REPLACE FUNCTION public.get_tenant_customer_credit_policy_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor record;
  v_tenant record;
  v_policy record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AR_AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.tenant_id, p.role::text AS role, p.is_active
  INTO v_actor FROM public.user_profiles p WHERE p.id = auth.uid();
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'AR_CREDIT_TENANT_POLICY_OWNER_ONLY' USING ERRCODE = '42501';
  END IF;
  SELECT t.id, coalesce(t.is_active, true) AS is_active, t.suspended_at
  INTO v_tenant FROM public.tenants t WHERE t.id = v_actor.tenant_id;
  IF NOT FOUND OR v_tenant.is_active IS NOT TRUE OR v_tenant.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'AR_TENANT_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_policy FROM public.tenant_customer_credit_policies
  WHERE tenant_id = v_actor.tenant_id;

  RETURN jsonb_build_object(
    'exists', FOUND,
    'creditEnabled', coalesce(v_policy.credit_enabled, false),
    'allowUnpaidInvoices', coalesce(v_policy.allow_unpaid_invoices, true),
    'allowPartialInitialPayments', coalesce(v_policy.allow_partial_initial_payments, true),
    'defaultCreditLimit', coalesce(v_policy.default_credit_limit, 0),
    'hardLimitEnforced', coalesce(v_policy.hard_limit_enforced, true),
    'warnThresholdPercent', coalesce(v_policy.warn_threshold_percent, 80),
    'enforceCustomerHold', coalesce(v_policy.enforce_customer_hold, true),
    'allowManagerOverride', coalesce(v_policy.allow_manager_override, false),
    'defaultAllocationMode', coalesce(v_policy.default_allocation_mode, 'oldest_first'),
    'internalTerms', v_policy.internal_terms,
    'dueDateDays', v_policy.due_date_days
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_customer_credit_policy_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor record;
  v_tenant record;
  v_current public.tenant_customer_credit_policies%ROWTYPE;
  v_text text;
  v_credit_enabled boolean := false;
  v_allow_unpaid boolean := true;
  v_allow_partial boolean := true;
  v_default_limit numeric(12,2) := 0;
  v_hard_limit boolean := true;
  v_warn numeric(5,2) := 80;
  v_enforce_hold boolean := true;
  v_allow_manager_override boolean := false;
  v_allocation text := 'oldest_first';
  v_terms text;
  v_due_days integer;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_TENANT_POLICY_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AR_AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.tenant_id, p.role::text AS role, p.is_active
  INTO v_actor FROM public.user_profiles p WHERE p.id = auth.uid();
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'AR_CREDIT_TENANT_POLICY_OWNER_ONLY' USING ERRCODE = '42501';
  END IF;
  SELECT t.id, coalesce(t.is_active, true) AS is_active, t.suspended_at
  INTO v_tenant FROM public.tenants t WHERE t.id = v_actor.tenant_id;
  IF NOT FOUND OR v_tenant.is_active IS NOT TRUE OR v_tenant.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'AR_TENANT_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_current FROM public.tenant_customer_credit_policies
  WHERE tenant_id = v_actor.tenant_id;
  IF FOUND THEN
    v_credit_enabled := v_current.credit_enabled;
    v_allow_unpaid := v_current.allow_unpaid_invoices;
    v_allow_partial := v_current.allow_partial_initial_payments;
    v_default_limit := v_current.default_credit_limit;
    v_hard_limit := v_current.hard_limit_enforced;
    v_warn := v_current.warn_threshold_percent;
    v_enforce_hold := v_current.enforce_customer_hold;
    v_allow_manager_override := v_current.allow_manager_override;
    v_allocation := v_current.default_allocation_mode;
    v_terms := v_current.internal_terms;
    v_due_days := v_current.due_date_days;
  END IF;

  FOREACH v_text IN ARRAY ARRAY['credit_enabled', 'allow_unpaid_invoices',
    'allow_partial_initial_payments', 'hard_limit_enforced',
    'enforce_customer_hold', 'allow_manager_override']
  LOOP
    IF NULLIF(btrim(p_payload->>v_text), '') IS NOT NULL
       AND lower(btrim(p_payload->>v_text)) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'AR_TENANT_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF NULLIF(btrim(p_payload->>'credit_enabled'), '') IS NOT NULL THEN v_credit_enabled := (p_payload->>'credit_enabled')::boolean; END IF;
  IF NULLIF(btrim(p_payload->>'allow_unpaid_invoices'), '') IS NOT NULL THEN v_allow_unpaid := (p_payload->>'allow_unpaid_invoices')::boolean; END IF;
  IF NULLIF(btrim(p_payload->>'allow_partial_initial_payments'), '') IS NOT NULL THEN v_allow_partial := (p_payload->>'allow_partial_initial_payments')::boolean; END IF;
  IF NULLIF(btrim(p_payload->>'hard_limit_enforced'), '') IS NOT NULL THEN v_hard_limit := (p_payload->>'hard_limit_enforced')::boolean; END IF;
  IF NULLIF(btrim(p_payload->>'enforce_customer_hold'), '') IS NOT NULL THEN v_enforce_hold := (p_payload->>'enforce_customer_hold')::boolean; END IF;
  IF NULLIF(btrim(p_payload->>'allow_manager_override'), '') IS NOT NULL THEN v_allow_manager_override := (p_payload->>'allow_manager_override')::boolean; END IF;

  v_text := NULLIF(btrim(p_payload->>'default_credit_limit'), '');
  IF v_text IS NOT NULL THEN
    IF v_text !~ '^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'AR_TENANT_POLICY_VALUE_INVALID' USING ERRCODE = '22023'; END IF;
    v_default_limit := v_text::numeric(12,2);
  END IF;
  v_text := NULLIF(btrim(p_payload->>'warn_threshold_percent'), '');
  IF v_text IS NOT NULL THEN
    IF v_text !~ '^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'AR_TENANT_POLICY_VALUE_INVALID' USING ERRCODE = '22023'; END IF;
    v_warn := v_text::numeric(5,2);
  END IF;
  v_text := NULLIF(btrim(p_payload->>'due_date_days'), '');
  IF p_payload ? 'due_date_days' THEN
    IF v_text IS NULL THEN v_due_days := NULL;
    ELSIF v_text !~ '^[1-9][0-9]{0,2}$' THEN RAISE EXCEPTION 'AR_TENANT_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
    ELSE v_due_days := v_text::integer;
    END IF;
  END IF;
  v_allocation := coalesce(NULLIF(btrim(p_payload->>'default_allocation_mode'), ''), v_allocation);
  v_terms := CASE WHEN p_payload ? 'internal_terms' THEN NULLIF(btrim(p_payload->>'internal_terms'), '') ELSE v_terms END;
  IF v_default_limit < 0 OR v_warn NOT BETWEEN 0 AND 100 OR v_due_days NOT BETWEEN 1 AND 365
     OR v_allocation NOT IN ('oldest_first', 'manual') OR length(coalesce(v_terms, '')) > 2000 THEN
    RAISE EXCEPTION 'AR_TENANT_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tenant_customer_credit_policies (
    tenant_id, credit_enabled, allow_unpaid_invoices, allow_partial_initial_payments,
    default_credit_limit, hard_limit_enforced, warn_threshold_percent,
    enforce_customer_hold, allow_manager_override, default_allocation_mode,
    internal_terms, due_date_days, created_by, updated_by
  ) VALUES (
    v_actor.tenant_id, v_credit_enabled, v_allow_unpaid, v_allow_partial,
    v_default_limit, v_hard_limit, v_warn, v_enforce_hold,
    v_allow_manager_override, v_allocation, v_terms, v_due_days, v_actor.id, v_actor.id
  ) ON CONFLICT (tenant_id) DO UPDATE SET
    credit_enabled = EXCLUDED.credit_enabled,
    allow_unpaid_invoices = EXCLUDED.allow_unpaid_invoices,
    allow_partial_initial_payments = EXCLUDED.allow_partial_initial_payments,
    default_credit_limit = EXCLUDED.default_credit_limit,
    hard_limit_enforced = EXCLUDED.hard_limit_enforced,
    warn_threshold_percent = EXCLUDED.warn_threshold_percent,
    enforce_customer_hold = EXCLUDED.enforce_customer_hold,
    allow_manager_override = EXCLUDED.allow_manager_override,
    default_allocation_mode = EXCLUDED.default_allocation_mode,
    internal_terms = EXCLUDED.internal_terms,
    due_date_days = EXCLUDED.due_date_days,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  -- Keep only customer settings explicitly marked "use tenant default" in
  -- sync. Custom limits/holds stay customer-specific. Effective fields remain
  -- compatible with the reviewed checkout implementation.
  UPDATE public.customer_credit_policies p
  SET configured_credit_limit = CASE WHEN p.use_tenant_default THEN v_default_limit ELSE p.configured_credit_limit END,
      credit_limit = CASE WHEN v_hard_limit
        THEN CASE WHEN p.use_tenant_default THEN v_default_limit ELSE p.configured_credit_limit END
        ELSE 9999999999.99::numeric(12,2) END,
      warn_threshold_percent = CASE WHEN p.use_tenant_default THEN v_warn ELSE p.warn_threshold_percent END,
      hold = CASE WHEN v_enforce_hold THEN p.configured_hold ELSE false END,
      hold_reason = CASE WHEN v_enforce_hold AND p.configured_hold THEN p.configured_hold_reason ELSE NULL END,
      due_date_days = CASE WHEN p.use_tenant_default THEN v_due_days ELSE p.due_date_days END,
      updated_by = v_actor.id,
      updated_at = now()
  WHERE p.tenant_id = v_actor.tenant_id
    AND (p.configured_credit_limit IS DISTINCT FROM CASE WHEN p.use_tenant_default THEN v_default_limit ELSE p.configured_credit_limit END
      OR p.credit_limit IS DISTINCT FROM CASE WHEN v_hard_limit THEN CASE WHEN p.use_tenant_default THEN v_default_limit ELSE p.configured_credit_limit END ELSE 9999999999.99::numeric(12,2) END
      OR p.warn_threshold_percent IS DISTINCT FROM CASE WHEN p.use_tenant_default THEN v_warn ELSE p.warn_threshold_percent END
      OR p.due_date_days IS DISTINCT FROM CASE WHEN p.use_tenant_default THEN v_due_days ELSE p.due_date_days END
      OR p.hold IS DISTINCT FROM CASE WHEN v_enforce_hold THEN p.configured_hold ELSE false END
      OR p.hold_reason IS DISTINCT FROM CASE WHEN v_enforce_hold AND p.configured_hold THEN p.configured_hold_reason ELSE NULL END);

  PERFORM public.record_audit_event(
    'tenant_customer_credit_policy_set', v_actor.tenant_id, NULL, v_actor.id,
    v_actor.role, 'tenant', v_actor.tenant_id, 'info', 'succeeded',
    jsonb_build_object('credit_enabled', v_credit_enabled,
      'hard_limit_enforced', v_hard_limit, 'default_credit_limit', v_default_limit), NULL, NULL);

  RETURN public.get_tenant_customer_credit_policy_v1();
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_TENANT_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
END
$function$;

CREATE OR REPLACE FUNCTION public.ensure_customer_receivable_account_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_customer_id uuid;
  v_customer record;
  v_scope record;
  v_account_id uuid;
  v_created boolean := false;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_ACCOUNT_SETUP_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_customer_id := NULLIF(btrim(p_payload->>'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_ACCOUNT_SETUP_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END;
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'AR_ACCOUNT_SETUP_PAYLOAD_INVALID' USING ERRCODE = '22023'; END IF;
  SELECT c.* INTO v_customer FROM public.customers c WHERE c.id = v_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_customer.branch_id, v_customer.id);
  IF v_scope.actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'AR_ACCOUNT_LINK_OWNER_ONLY' USING ERRCODE = '42501';
  END IF;
  v_created := v_customer.receivable_account_id IS NULL;
  v_account_id := public.ar_ensure_customer_account_v1(v_customer_id);
  IF v_created THEN
    PERFORM public.record_audit_event(
      'customer_receivable_account_setup', v_scope.tenant_id, v_scope.branch_id,
      v_scope.actor_id, v_scope.actor_role, 'customer', v_customer_id,
      'info', 'succeeded', jsonb_build_object('receivable_account_id', v_account_id), NULL, NULL);
  END IF;
  RETURN jsonb_build_object('customerId', v_customer_id,
    'receivableAccountId', v_account_id, 'created', v_created,
    'historicalBalanceBackfilled', false);
END
$function$;

CREATE OR REPLACE FUNCTION public.set_customer_credit_policy_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_customer_id uuid;
  v_scope record;
  v_tenant_policy record;
  v_current public.customer_credit_policies%ROWTYPE;
  v_account_id uuid;
  v_text text;
  v_enabled boolean := false;
  v_use_default boolean := false;
  v_configured_limit numeric(12,2) := 0;
  v_terms text;
  v_configured_hold boolean := false;
  v_configured_hold_reason text;
  v_overdue_block boolean := false;
  v_warn numeric(5,2) := 80;
  v_requires_owner boolean := false;
  v_due_days integer;
  v_has_current boolean := false;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_POLICY_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_customer_id := NULLIF(btrim(p_payload->>'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
  END;
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(
    (SELECT branch_id FROM public.customers WHERE id = v_customer_id), v_customer_id);
  IF v_scope.actor_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'AR_CREDIT_POLICY_OWNER_ONLY' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tenant_policy FROM public.tenant_customer_credit_policies
  WHERE tenant_id = v_scope.tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AR_CREDIT_TENANT_POLICY_REQUIRED' USING ERRCODE = '42501'; END IF;

  v_account_id := public.ar_ensure_customer_account_v1(v_customer_id);
  SELECT * INTO v_current FROM public.customer_credit_policies
  WHERE tenant_id = v_scope.tenant_id AND receivable_account_id = v_account_id;
  IF FOUND THEN
    v_has_current := true;
    v_enabled := v_current.credit_enabled;
    v_use_default := v_current.use_tenant_default;
    v_configured_limit := v_current.configured_credit_limit;
    v_terms := v_current.terms;
    v_configured_hold := v_current.configured_hold;
    v_configured_hold_reason := v_current.configured_hold_reason;
    v_overdue_block := v_current.overdue_block;
    v_warn := v_current.warn_threshold_percent;
    v_requires_owner := v_current.requires_owner_approval;
    v_due_days := v_current.due_date_days;
  END IF;

  FOREACH v_text IN ARRAY ARRAY['credit_enabled', 'use_tenant_default', 'hold',
    'overdue_block', 'requires_owner_approval']
  LOOP
    IF NULLIF(btrim(p_payload->>v_text), '') IS NOT NULL
       AND lower(btrim(p_payload->>v_text)) NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF NULLIF(btrim(p_payload->>'credit_enabled'), '') IS NOT NULL THEN v_enabled := (p_payload->>'credit_enabled')::boolean; END IF;
  IF NULLIF(btrim(p_payload->>'use_tenant_default'), '') IS NOT NULL THEN v_use_default := (p_payload->>'use_tenant_default')::boolean; END IF;
  IF NULLIF(btrim(p_payload->>'hold'), '') IS NOT NULL THEN v_configured_hold := (p_payload->>'hold')::boolean; END IF;
  IF NULLIF(btrim(p_payload->>'overdue_block'), '') IS NOT NULL THEN v_overdue_block := (p_payload->>'overdue_block')::boolean; END IF;
  IF NULLIF(btrim(p_payload->>'requires_owner_approval'), '') IS NOT NULL THEN v_requires_owner := (p_payload->>'requires_owner_approval')::boolean; END IF;
  IF v_enabled AND v_tenant_policy.credit_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_CREDIT_TENANT_POLICY_DISABLED' USING ERRCODE = '42501';
  END IF;

  v_text := NULLIF(btrim(p_payload->>'credit_limit'), '');
  IF v_use_default THEN
    v_configured_limit := v_tenant_policy.default_credit_limit;
  ELSIF v_text IS NOT NULL THEN
    IF v_text !~ '^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023'; END IF;
    v_configured_limit := v_text::numeric(12,2);
  ELSIF NOT v_has_current THEN
    RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
  END IF;
  v_text := NULLIF(btrim(p_payload->>'warn_threshold_percent'), '');
  IF v_text IS NOT NULL THEN
    IF v_text !~ '^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023'; END IF;
    v_warn := v_text::numeric(5,2);
  ELSIF v_use_default THEN
    v_warn := v_tenant_policy.warn_threshold_percent;
  END IF;
  v_terms := CASE WHEN p_payload ? 'terms' THEN NULLIF(btrim(p_payload->>'terms'), '') ELSE v_terms END;
  v_configured_hold_reason := CASE WHEN p_payload ? 'hold_reason' THEN NULLIF(btrim(p_payload->>'hold_reason'), '') ELSE v_configured_hold_reason END;
  IF p_payload ? 'due_date_days' THEN
    v_text := NULLIF(btrim(p_payload->>'due_date_days'), '');
    IF v_text IS NULL THEN v_due_days := NULL;
    ELSIF v_text !~ '^[1-9][0-9]{0,2}$' THEN RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
    ELSE v_due_days := v_text::integer;
    END IF;
  ELSIF v_use_default THEN
    v_due_days := v_tenant_policy.due_date_days;
  END IF;
  IF v_configured_hold AND v_configured_hold_reason IS NULL THEN
    RAISE EXCEPTION 'AR_CREDIT_HOLD_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_configured_limit < 0 OR v_warn NOT BETWEEN 0 AND 100
     OR v_due_days NOT BETWEEN 1 AND 365 OR length(coalesce(v_terms, '')) > 2000 THEN
    RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.customer_credit_policies (
    tenant_id, receivable_account_id, credit_enabled, credit_limit, terms,
    hold, hold_reason, overdue_block, warn_threshold_percent,
    requires_owner_approval, updated_by, use_tenant_default,
    configured_credit_limit, configured_hold, configured_hold_reason, due_date_days
  ) VALUES (
    v_scope.tenant_id, v_account_id, v_enabled,
    CASE WHEN v_tenant_policy.hard_limit_enforced THEN v_configured_limit ELSE 9999999999.99::numeric(12,2) END,
    v_terms,
    CASE WHEN v_tenant_policy.enforce_customer_hold THEN v_configured_hold ELSE false END,
    CASE WHEN v_tenant_policy.enforce_customer_hold AND v_configured_hold THEN v_configured_hold_reason ELSE NULL END,
    v_overdue_block, v_warn, v_requires_owner, v_scope.actor_id, v_use_default,
    v_configured_limit, v_configured_hold, v_configured_hold_reason, v_due_days
  ) ON CONFLICT (tenant_id, receivable_account_id) DO UPDATE SET
    credit_enabled = EXCLUDED.credit_enabled,
    credit_limit = EXCLUDED.credit_limit,
    terms = EXCLUDED.terms,
    hold = EXCLUDED.hold,
    hold_reason = EXCLUDED.hold_reason,
    overdue_block = EXCLUDED.overdue_block,
    warn_threshold_percent = EXCLUDED.warn_threshold_percent,
    requires_owner_approval = EXCLUDED.requires_owner_approval,
    use_tenant_default = EXCLUDED.use_tenant_default,
    configured_credit_limit = EXCLUDED.configured_credit_limit,
    configured_hold = EXCLUDED.configured_hold,
    configured_hold_reason = EXCLUDED.configured_hold_reason,
    due_date_days = EXCLUDED.due_date_days,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  PERFORM public.record_audit_event(
    'customer_credit_policy_set', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'customer', v_customer_id,
    'info', 'succeeded', jsonb_build_object('credit_enabled', v_enabled,
      'use_tenant_default', v_use_default, 'credit_limit', v_configured_limit,
      'hold', v_configured_hold), NULL, NULL);
  RETURN jsonb_build_object('customerId', v_customer_id,
    'receivableAccountId', v_account_id, 'creditEnabled', v_enabled,
    'useTenantDefault', v_use_default, 'creditLimit', v_configured_limit,
    'hold', v_configured_hold, 'holdReason', v_configured_hold_reason,
    'dueDateDays', v_due_days);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_POLICY_VALUE_INVALID' USING ERRCODE = '22023';
END
$function$;

-- Rebind the workspace envelope so the UI receives configured (rather than
-- internal unlimited) limits and can distinguish tenant defaults from custom
-- customer settings without direct table reads.
CREATE OR REPLACE FUNCTION public.get_customer_receivable_workspace_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_workspace jsonb;
  v_customer_id uuid;
  v_account_id uuid;
  v_policy record;
  v_tenant_policy record;
BEGIN
  v_workspace := public.get_customer_receivable_workspace_v1_raw_20260803(p_payload);
  v_customer_id := NULLIF(btrim(p_payload->>'customer_id'), '')::uuid;
  SELECT c.receivable_account_id INTO v_account_id FROM public.customers c WHERE c.id = v_customer_id;
  v_workspace := jsonb_set(v_workspace, '{customer,receivableAccountId}', to_jsonb(v_account_id), true);
  IF v_account_id IS NULL THEN RETURN v_workspace; END IF;
  SELECT * INTO v_policy FROM public.customer_credit_policies p
  WHERE p.receivable_account_id = v_account_id;
  IF NOT FOUND THEN RETURN v_workspace; END IF;
  SELECT * INTO v_tenant_policy FROM public.tenant_customer_credit_policies p
  WHERE p.tenant_id = v_policy.tenant_id;
  RETURN jsonb_set(v_workspace, '{policy}', jsonb_build_object(
    'creditEnabled', v_policy.credit_enabled,
    'creditLimit', v_policy.configured_credit_limit,
    'terms', v_policy.terms,
    'hold', v_policy.configured_hold,
    'holdReason', v_policy.configured_hold_reason,
    'overdueBlock', v_policy.overdue_block,
    'warnThresholdPercent', v_policy.warn_threshold_percent,
    'requiresOwnerApproval', v_policy.requires_owner_approval,
    'useTenantDefault', v_policy.use_tenant_default,
    'dueDateDays', v_policy.due_date_days,
    'hardLimitEnforced', coalesce(v_tenant_policy.hard_limit_enforced, true),
    'tenantCreditEnabled', coalesce(v_tenant_policy.credit_enabled, false)
  ), true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_WORKSPACE_FILTER_INVALID' USING ERRCODE = '22023';
END
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_credit_checkout_eligibility_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_customer_id uuid;
  v_requested_credit numeric(12,2) := 0;
  v_requested_text text;
  v_override_reason text;
  v_scope record;
  v_customer record;
  v_tenant_policy record;
  v_policy record;
  v_balance numeric(12,2) := 0;
  v_overdue numeric(12,2) := 0;
  v_available numeric(12,2) := 0;
  v_allowed boolean := false;
  v_code text := 'AR_CREDIT_DISABLED';
  v_can_override boolean := false;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload->>'branch_id'), '')::uuid;
    v_customer_id := NULLIF(btrim(p_payload->>'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
  END;
  IF v_branch_id IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_IDENTIFIERS_REQUIRED' USING ERRCODE = '22023';
  END IF;
  v_requested_text := NULLIF(btrim(coalesce(p_payload->>'proposed_credit_amount', '')), '');
  IF v_requested_text IS NOT NULL THEN
    IF v_requested_text !~ '^(0|[1-9][0-9]*)(\\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_AMOUNT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_requested_credit := v_requested_text::numeric(12,2);
  END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_branch_id, v_customer_id);
  SELECT c.id, c.receivable_account_id INTO v_customer FROM public.customers c WHERE c.id = v_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_tenant_policy FROM public.tenant_customer_credit_policies
  WHERE tenant_id = v_scope.tenant_id;
  IF NOT FOUND OR v_tenant_policy.credit_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'reasonCode', 'AR_CREDIT_TENANT_POLICY_DISABLED',
      'creditEnabled', false, 'tenantCreditEnabled', false,
      'tenantPolicyConfigured', FOUND, 'accountLinked', v_customer.receivable_account_id IS NOT NULL,
      'accountLinkable', v_scope.actor_role IN ('owner', 'admin'), 'onHold', false,
      'creditLimit', 0, 'currentBalance', 0, 'availableCredit', 0, 'overdueAmount', 0,
      'requiresOwnerApproval', false, 'hardLimitEnforced', true);
  END IF;
  IF v_customer.receivable_account_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reasonCode', 'AR_CREDIT_DISABLED',
      'creditEnabled', false, 'tenantCreditEnabled', true, 'tenantPolicyConfigured', true,
      'accountLinked', false, 'accountLinkable', v_scope.actor_role IN ('owner', 'admin'),
      'onHold', false, 'creditLimit', 0, 'currentBalance', 0, 'availableCredit', 0,
      'overdueAmount', 0, 'requiresOwnerApproval', false,
      'hardLimitEnforced', v_tenant_policy.hard_limit_enforced);
  END IF;
  SELECT * INTO v_policy FROM public.customer_credit_policies p
  WHERE p.tenant_id = v_scope.tenant_id AND p.receivable_account_id = v_customer.receivable_account_id;
  IF NOT FOUND OR v_policy.credit_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'reasonCode', 'AR_CREDIT_DISABLED',
      'creditEnabled', false, 'tenantCreditEnabled', true, 'tenantPolicyConfigured', true,
      'accountLinked', true, 'accountLinkable', false, 'onHold', coalesce(v_policy.configured_hold, false),
      'creditLimit', coalesce(v_policy.configured_credit_limit, 0), 'currentBalance', 0,
      'availableCredit', 0, 'overdueAmount', 0,
      'requiresOwnerApproval', coalesce(v_policy.requires_owner_approval, false),
      'hardLimitEnforced', v_tenant_policy.hard_limit_enforced);
  END IF;
  v_override_reason := NULLIF(btrim(p_payload->>'override_reason'), '');
  v_can_override := v_override_reason IS NOT NULL AND (
    v_scope.actor_role IN ('owner', 'admin')
    OR (v_scope.actor_role = 'manager' AND v_tenant_policy.allow_manager_override));
  v_balance := public.ar_account_balance_v1(v_customer.receivable_account_id);
  v_available := CASE WHEN v_tenant_policy.hard_limit_enforced
    THEN greatest(v_policy.configured_credit_limit - v_balance, 0) ELSE 9999999999.99::numeric(12,2) END;
  SELECT coalesce(sum(public.ar_invoice_outstanding_v1(i.id)), 0) INTO v_overdue
  FROM public.invoices i
  WHERE i.tenant_id = v_scope.tenant_id AND i.customer_id = v_customer_id
    AND i.status = 'posted' AND i.zatca_invoice_type IN ('simplified', 'standard')
    AND i.due_date IS NOT NULL AND i.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date
    AND public.ar_invoice_outstanding_v1(i.id) > 0.01;
  IF v_tenant_policy.enforce_customer_hold AND v_policy.configured_hold AND NOT v_can_override THEN
    v_code := 'AR_CREDIT_HOLD';
  ELSIF v_policy.requires_owner_approval AND v_scope.actor_role NOT IN ('owner', 'admin') THEN
    v_code := 'AR_CREDIT_OWNER_APPROVAL_REQUIRED';
  ELSIF v_tenant_policy.hard_limit_enforced
     AND (v_policy.configured_credit_limit <= 0 OR v_balance + v_requested_credit > v_policy.configured_credit_limit + 0.01)
     AND NOT v_can_override THEN
    v_code := 'AR_CREDIT_LIMIT_EXCEEDED';
  ELSIF v_policy.overdue_block AND v_overdue > 0.01 AND NOT v_can_override THEN
    v_code := 'AR_CREDIT_OVERDUE_BLOCK';
  ELSE
    v_code := 'AR_CREDIT_ELIGIBLE'; v_allowed := true;
  END IF;
  RETURN jsonb_build_object('allowed', v_allowed, 'reasonCode', v_code,
    'creditEnabled', true, 'tenantCreditEnabled', true, 'tenantPolicyConfigured', true,
    'accountLinked', true, 'accountLinkable', false,
    'onHold', v_tenant_policy.enforce_customer_hold AND v_policy.configured_hold,
    'creditLimit', v_policy.configured_credit_limit, 'currentBalance', v_balance,
    'availableCredit', v_available, 'overdueAmount', v_overdue,
    'requiresOwnerApproval', v_policy.requires_owner_approval,
    'hardLimitEnforced', v_tenant_policy.hard_limit_enforced);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
END
$function$;

-- Global policy checks happen before the established checkout can create a
-- receivable account. The reviewed inner checkout remains the final authority
-- for customer policy, fiscal checkout, idempotency, ledger and settlement.
CREATE OR REPLACE FUNCTION public.post_customer_credit_checkout_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_customer_id uuid;
  v_scope record;
  v_tenant_policy record;
  v_mode text;
  v_override_reason text;
  v_due_days integer;
  v_payload_effective jsonb := p_payload;
  v_result jsonb;
  v_invoice_id uuid;
  v_decision jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_CHECKOUT_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload->>'branch_id'), '')::uuid;
    v_customer_id := NULLIF(btrim(p_payload->>'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
  END;
  IF v_branch_id IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIERS_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_branch_id, v_customer_id);
  SELECT * INTO v_tenant_policy FROM public.tenant_customer_credit_policies
  WHERE tenant_id = v_scope.tenant_id FOR SHARE;
  IF NOT FOUND OR v_tenant_policy.credit_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_CREDIT_TENANT_POLICY_DISABLED' USING ERRCODE = '42501';
  END IF;
  v_mode := coalesce(NULLIF(btrim(p_payload->>'settlement_mode'), ''), 'credit');
  IF v_mode NOT IN ('credit', 'partial') THEN RAISE EXCEPTION 'AR_CHECKOUT_SETTLEMENT_INVALID' USING ERRCODE = '22023'; END IF;
  IF v_mode = 'credit' AND v_tenant_policy.allow_unpaid_invoices IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_CREDIT_UNPAID_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF v_mode = 'partial' AND v_tenant_policy.allow_partial_initial_payments IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_CREDIT_PARTIAL_NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  v_override_reason := NULLIF(btrim(p_payload->>'override_reason'), '');
  IF v_scope.actor_role = 'manager' AND v_override_reason IS NOT NULL
     AND v_tenant_policy.allow_manager_override IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_CREDIT_MANAGER_OVERRIDE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT p.due_date_days INTO v_due_days
  FROM public.customers c
  JOIN public.customer_credit_policies p
    ON p.tenant_id = v_scope.tenant_id
   AND p.receivable_account_id = c.receivable_account_id
  WHERE c.id = v_customer_id;
  v_due_days := coalesce(v_due_days, v_tenant_policy.due_date_days);
  IF NULLIF(btrim(p_payload->>'due_date'), '') IS NULL AND v_due_days IS NOT NULL THEN
    v_payload_effective := p_payload || jsonb_build_object(
      'due_date', ((now() AT TIME ZONE 'Asia/Riyadh')::date + v_due_days)::text);
  END IF;
  v_decision := public.resolve_pos_checkout_document_internal_v1(auth.uid(), v_branch_id, v_customer_id);
  IF v_decision->>'status' IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION '%', coalesce(v_decision->>'code', 'AR_CHECKOUT_DOCUMENT_BLOCKED') USING ERRCODE = 'P0001';
  END IF;
  v_result := public.post_customer_credit_checkout_v1_hardened_20260803(v_payload_effective);
  v_invoice_id := NULLIF(v_result->>'invoice_id', '')::uuid;
  IF v_decision->>'checkoutPath' = 'demo' THEN
    PERFORM set_config('app.demo_checkout_authorized', 'true', true);
    UPDATE public.invoices SET is_demo = true, zatca_status = 'not_submitted',
      zatca_counter_number = NULL, zatca_prev_invoice_hash = NULL, zatca_xml = NULL,
      zatca_xml_hash = NULL, zatca_signature = NULL, zatca_qr_code = NULL,
      zatca_submission_id = NULL, zatca_submitted_at = NULL, zatca_clearance_status = NULL,
      zatca_clearance_response = NULL, zatca_reporting_response = NULL, zatca_warnings = NULL
    WHERE id = v_invoice_id AND branch_id = v_branch_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'DEMO_CHECKOUT_RESULT_SCOPE_MISMATCH' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN v_result || jsonb_build_object('checkout_path', v_decision->>'checkoutPath',
    'demo_mode', v_decision->>'demoMode', 'is_demo', coalesce((v_decision->>'isDemo')::boolean, false),
    'non_fiscal', coalesce((v_decision->>'nonFiscal')::boolean, false));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
END
$function$;

-- Receipts retain an explicit caller choice. When a reviewed client omits
-- auto_allocate, the tenant default supplies the server-side behaviour.
CREATE OR REPLACE FUNCTION public.record_customer_payment_receipt_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_customer_id uuid;
  v_scope record;
  v_allocation_mode text := 'oldest_first';
  v_payload_effective jsonb := p_payload;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_RECEIPT_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload->>'branch_id'), '')::uuid;
    v_customer_id := NULLIF(btrim(p_payload->>'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_RECEIPT_VALUE_INVALID' USING ERRCODE = '22023';
  END;
  IF v_branch_id IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'AR_RECEIPT_VALUE_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_branch_id, v_customer_id);
  SELECT default_allocation_mode INTO v_allocation_mode
  FROM public.tenant_customer_credit_policies
  WHERE tenant_id = v_scope.tenant_id;
  IF NOT (p_payload ? 'auto_allocate') THEN
    v_payload_effective := p_payload || jsonb_build_object(
      'auto_allocate', coalesce(v_allocation_mode, 'oldest_first') = 'oldest_first');
  END IF;
  RETURN public.record_customer_payment_receipt_v1_raw_20260803(v_payload_effective);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_RECEIPT_VALUE_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER TABLE public.tenant_customer_credit_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_customer_credit_policies FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.ar_assert_scope_v1(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.get_tenant_customer_credit_policy_v1() OWNER TO postgres;
ALTER FUNCTION public.set_tenant_customer_credit_policy_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.ensure_customer_receivable_account_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.set_customer_credit_policy_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.get_customer_receivable_workspace_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.post_customer_credit_checkout_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.record_customer_payment_receipt_v1(jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ar_assert_scope_v1(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ar_ensure_customer_account_v1(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tenant_customer_credit_policy_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_tenant_customer_credit_policy_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_customer_receivable_account_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_customer_credit_policy_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_receivable_workspace_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_customer_credit_checkout_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_customer_payment_receipt_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_customer_credit_policy_v1(),
  public.set_tenant_customer_credit_policy_v1(jsonb),
  public.ensure_customer_receivable_account_v1(jsonb),
  public.set_customer_credit_policy_v1(jsonb),
  public.get_customer_receivable_workspace_v1(jsonb),
  public.get_customer_credit_checkout_eligibility_v1(jsonb),
  public.post_customer_credit_checkout_v1(jsonb),
  public.record_customer_payment_receipt_v1(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_customer_receivable_workspace_v1_raw_20260803(jsonb),
  public.get_customer_credit_checkout_eligibility_v1_base_20260803(jsonb),
  public.post_customer_credit_checkout_v1_hardened_20260803(jsonb),
  public.record_customer_payment_receipt_v1_raw_20260803(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_tenant_customer_credit_policy_v1() IS
  'Owner/admin-only tenant customer-credit configuration read. Missing policy is returned as explicit disabled defaults and does not create a row.';
COMMENT ON FUNCTION public.ensure_customer_receivable_account_v1(jsonb) IS
  'Owner/admin-only idempotent empty account setup for a real customer. It never backfills historical debt or mutates invoices.';
COMMENT ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) IS
  'Read-only authoritative customer-credit preflight. It enforces the tenant policy before customer approval and never creates an account or policy.';
COMMENT ON FUNCTION public.post_customer_credit_checkout_v1(jsonb) IS
  'Authoritative customer-credit checkout. Tenant policy is checked before any AR account can be created; the reviewed inner checkout remains the final settlement authority.';

NOTIFY pgrst, 'reload schema';

COMMIT;
