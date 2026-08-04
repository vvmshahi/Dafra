-- Simple three-switch customer credit configuration.
--
-- Existing credit/AR columns and RPCs remain the compatibility layer. This
-- migration adds only the Branch switch and narrow server-authoritative RPCs;
-- it does not create or rewrite invoices, payments, ledger rows, stock rows,
-- fiscal artefacts, or historical balances.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $required_simple_credit_contracts$
BEGIN
  IF to_regclass('public.branches') IS NULL
     OR to_regclass('public.customers') IS NULL
     OR to_regclass('public.customer_credit_policies') IS NULL
     OR to_regclass('public.customer_receivable_accounts') IS NULL
     OR to_regclass('public.tenant_customer_credit_policies') IS NULL
     OR to_regprocedure('public.ar_assert_scope_v1(uuid,uuid)') IS NULL
     OR to_regprocedure('public.ar_ensure_customer_account_v1(uuid)') IS NULL
     OR to_regprocedure('public.record_audit_event(text,uuid,uuid,uuid,text,text,uuid,text,text,jsonb,text,text)') IS NULL
  THEN
    RAISE EXCEPTION 'AR_SIMPLE_CREDIT_REQUIRED_CONTRACT_MISSING';
  END IF;
END
$required_simple_credit_contracts$;

-- Existing Branch rows remain NULL and therefore inherit the tenant setting.
-- New Branch rows default to false until an Owner or that Branch enables them.
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS customer_credit_enabled boolean DEFAULT false;

COMMENT ON COLUMN public.branches.customer_credit_enabled IS
  'Simple Branch customer-credit switch. NULL on legacy rows inherits the enabled tenant policy; new rows default to false.';

CREATE OR REPLACE FUNCTION public.get_branch_customer_credit_policy_v1(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor record;
  v_branch record;
  v_tenant_credit_enabled boolean := false;
  v_policy_exists boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AR_AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role, p.is_active
  INTO v_actor
  FROM public.user_profiles p
  WHERE p.id = auth.uid();
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin', 'branch') THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id, b.name, b.name_ar, b.is_active,
         b.customer_credit_enabled,
         coalesce(t.is_active, true) AS tenant_active, t.suspended_at
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id;
  IF NOT FOUND OR v_branch.is_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE OR v_branch.suspended_at IS NOT NULL
     OR v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_actor.role = 'branch' AND v_actor.branch_id IS DISTINCT FROM v_branch.id)
  THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT p.credit_enabled INTO v_tenant_credit_enabled
  FROM public.tenant_customer_credit_policies p
  WHERE p.tenant_id = v_branch.tenant_id;
  v_policy_exists := FOUND;
  v_tenant_credit_enabled := coalesce(v_tenant_credit_enabled, false);

  RETURN jsonb_build_object(
    'branchId', v_branch.id,
    'branchName', v_branch.name,
    'branchNameAr', v_branch.name_ar,
    'tenantCreditEnabled', v_tenant_credit_enabled,
    'branchChoice', v_branch.customer_credit_enabled,
    'branchCreditEnabled',
      v_tenant_credit_enabled AND coalesce(v_branch.customer_credit_enabled, true),
    'explicit', v_branch.customer_credit_enabled IS NOT NULL,
    'inherited', v_branch.customer_credit_enabled IS NULL,
    'tenantPolicyConfigured', v_policy_exists,
    'canEdit', true
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.set_branch_customer_credit_policy_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor record;
  v_branch record;
  v_branch_id uuid;
  v_credit_enabled boolean;
  v_value text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload->>'branch_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END;
  v_value := NULLIF(btrim(p_payload->>'credit_enabled'), '');
  IF v_branch_id IS NULL OR v_value IS NULL OR lower(v_value) NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  v_credit_enabled := v_value::boolean;

  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role, p.is_active
  INTO v_actor
  FROM public.user_profiles p
  WHERE p.id = auth.uid();
  IF auth.uid() IS NULL OR NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin', 'branch') THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active,
         coalesce(t.is_active, true) AS tenant_active, t.suspended_at
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = v_branch_id;
  IF NOT FOUND OR v_branch.is_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE OR v_branch.suspended_at IS NOT NULL
     OR v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_actor.role = 'branch' AND v_actor.branch_id IS DISTINCT FROM v_branch.id)
  THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  UPDATE public.branches
  SET customer_credit_enabled = v_credit_enabled,
      updated_at = now()
  WHERE id = v_branch_id AND tenant_id = v_actor.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  PERFORM public.record_audit_event(
    'branch_customer_credit_policy_set', v_actor.tenant_id, v_branch_id,
    v_actor.id, v_actor.role, 'branch', v_branch_id, 'info', 'succeeded',
    jsonb_build_object('credit_enabled', v_credit_enabled), NULL, NULL);

  RETURN public.get_branch_customer_credit_policy_v1(v_branch_id);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'AR_BRANCH_SETTINGS_PAYLOAD_INVALID' USING ERRCODE = '22023';
END
$function$;

-- Branch-authorised account setup. The older Owner/admin-only RPC is retained
-- for legacy callers; the simple UI uses this explicitly scoped replacement.
CREATE OR REPLACE FUNCTION public.ensure_customer_credit_account_v1(p_payload jsonb)
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
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'AR_ACCOUNT_SETUP_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT c.* INTO v_customer FROM public.customers c WHERE c.id = v_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_customer.branch_id, v_customer.id);
  IF v_scope.actor_role NOT IN ('owner', 'admin', 'branch') THEN
    RAISE EXCEPTION 'AR_ACCOUNT_LINK_FORBIDDEN' USING ERRCODE = '42501';
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

-- The simple customer switch deliberately stores a safe internal policy shape
-- so no limit, due date, hold, warning or approval is required in the UI.
CREATE OR REPLACE FUNCTION public.set_customer_credit_access_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_customer_id uuid;
  v_enabled boolean;
  v_value text;
  v_customer record;
  v_scope record;
  v_tenant_policy record;
  v_account_id uuid;
  v_max_credit numeric(12,2) := 9999999999.99::numeric(12,2);
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_CUSTOMER_CREDIT_ACCESS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_customer_id := NULLIF(btrim(p_payload->>'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_CUSTOMER_CREDIT_ACCESS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END;
  v_value := NULLIF(btrim(p_payload->>'credit_enabled'), '');
  IF v_customer_id IS NULL OR v_value IS NULL OR lower(v_value) NOT IN ('true', 'false') THEN
    RAISE EXCEPTION 'AR_CUSTOMER_CREDIT_ACCESS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  v_enabled := v_value::boolean;

  SELECT c.* INTO v_customer FROM public.customers c WHERE c.id = v_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_customer.branch_id, v_customer.id);
  IF v_scope.actor_role NOT IN ('owner', 'admin', 'branch') THEN
    RAISE EXCEPTION 'AR_CUSTOMER_CREDIT_ACCESS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tenant_policy
  FROM public.tenant_customer_credit_policies
  WHERE tenant_id = v_scope.tenant_id
  FOR SHARE;
  IF v_enabled AND (NOT FOUND OR v_tenant_policy.credit_enabled IS NOT TRUE) THEN
    RAISE EXCEPTION 'AR_CREDIT_TENANT_POLICY_DISABLED' USING ERRCODE = '42501';
  END IF;

  v_account_id := public.ar_ensure_customer_account_v1(v_customer_id);
  INSERT INTO public.customer_credit_policies (
    tenant_id, receivable_account_id, credit_enabled, credit_limit, terms,
    hold, hold_reason, overdue_block, warn_threshold_percent,
    requires_owner_approval, updated_by, use_tenant_default,
    configured_credit_limit, configured_hold, configured_hold_reason, due_date_days
  ) VALUES (
    v_scope.tenant_id, v_account_id, v_enabled, v_max_credit, NULL,
    false, NULL, false, 100, false, v_scope.actor_id, false,
    v_max_credit, false, NULL, NULL
  ) ON CONFLICT (tenant_id, receivable_account_id) DO UPDATE SET
    credit_enabled = EXCLUDED.credit_enabled,
    credit_limit = EXCLUDED.credit_limit,
    terms = NULL,
    hold = false,
    hold_reason = NULL,
    overdue_block = false,
    warn_threshold_percent = 100,
    requires_owner_approval = false,
    use_tenant_default = false,
    configured_credit_limit = EXCLUDED.configured_credit_limit,
    configured_hold = false,
    configured_hold_reason = NULL,
    due_date_days = NULL,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  PERFORM public.record_audit_event(
    'customer_credit_access_set', v_scope.tenant_id, v_scope.branch_id,
    v_scope.actor_id, v_scope.actor_role, 'customer', v_customer_id,
    'info', 'succeeded', jsonb_build_object('credit_enabled', v_enabled), NULL, NULL);

  RETURN jsonb_build_object('customerId', v_customer_id,
    'receivableAccountId', v_account_id, 'creditEnabled', v_enabled,
    'historicalBalanceBackfilled', false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'AR_CUSTOMER_CREDIT_ACCESS_PAYLOAD_INVALID' USING ERRCODE = '22023';
END
$function$;

-- Rebind the read-only preflight to the Branch switch. NULL on a legacy Branch
-- inherits an enabled tenant policy; a new Branch explicitly defaults false.
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
  v_branch_credit_enabled boolean := false;
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
    IF v_requested_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_AMOUNT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_requested_credit := v_requested_text::numeric(12,2);
  END IF;
  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_branch_id, v_customer_id);
  SELECT c.id, c.receivable_account_id INTO v_customer
  FROM public.customers c WHERE c.id = v_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tenant_policy FROM public.tenant_customer_credit_policies
  WHERE tenant_id = v_scope.tenant_id;
  IF NOT FOUND OR v_tenant_policy.credit_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'reasonCode', 'AR_CREDIT_TENANT_POLICY_DISABLED',
      'creditEnabled', false, 'tenantCreditEnabled', false, 'branchCreditEnabled', false,
      'tenantPolicyConfigured', FOUND, 'accountLinked', v_customer.receivable_account_id IS NOT NULL,
      'accountLinkable', v_scope.actor_role IN ('owner', 'admin', 'branch'), 'onHold', false,
      'creditLimit', 0, 'currentBalance', 0, 'availableCredit', 0, 'overdueAmount', 0,
      'requiresOwnerApproval', false, 'hardLimitEnforced', true);
  END IF;

  SELECT b.customer_credit_enabled INTO v_branch_credit_enabled
  FROM public.branches b
  WHERE b.id = v_branch_id AND b.tenant_id = v_scope.tenant_id;
  v_branch_credit_enabled := coalesce(v_branch_credit_enabled, true);
  IF v_branch_credit_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'reasonCode', 'AR_CREDIT_BRANCH_DISABLED',
      'creditEnabled', false, 'tenantCreditEnabled', true, 'branchCreditEnabled', false,
      'tenantPolicyConfigured', true, 'accountLinked', v_customer.receivable_account_id IS NOT NULL,
      'accountLinkable', v_scope.actor_role IN ('owner', 'admin', 'branch'), 'onHold', false,
      'creditLimit', 0, 'currentBalance', 0, 'availableCredit', 0, 'overdueAmount', 0,
      'requiresOwnerApproval', false, 'hardLimitEnforced', v_tenant_policy.hard_limit_enforced);
  END IF;

  IF v_customer.receivable_account_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reasonCode', 'AR_CREDIT_ACCOUNT_NOT_READY',
      'creditEnabled', false, 'tenantCreditEnabled', true, 'branchCreditEnabled', true,
      'tenantPolicyConfigured', true, 'accountLinked', false,
      'accountLinkable', v_scope.actor_role IN ('owner', 'admin', 'branch'),
      'onHold', false, 'creditLimit', 0, 'currentBalance', 0, 'availableCredit', 0,
      'overdueAmount', 0, 'requiresOwnerApproval', false,
      'hardLimitEnforced', v_tenant_policy.hard_limit_enforced);
  END IF;

  SELECT * INTO v_policy FROM public.customer_credit_policies p
  WHERE p.tenant_id = v_scope.tenant_id AND p.receivable_account_id = v_customer.receivable_account_id;
  IF NOT FOUND OR v_policy.credit_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('allowed', false, 'reasonCode', 'AR_CREDIT_DISABLED',
      'creditEnabled', false, 'tenantCreditEnabled', true, 'branchCreditEnabled', true,
      'tenantPolicyConfigured', true, 'accountLinked', true, 'accountLinkable', false,
      'onHold', coalesce(v_policy.configured_hold, false),
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
    THEN greatest(v_policy.configured_credit_limit - v_balance, 0)
    ELSE 9999999999.99::numeric(12,2) END;
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
     AND (v_policy.configured_credit_limit <= 0
       OR v_balance + v_requested_credit > v_policy.configured_credit_limit + 0.01)
     AND NOT v_can_override THEN
    v_code := 'AR_CREDIT_LIMIT_EXCEEDED';
  ELSIF v_policy.overdue_block AND v_overdue > 0.01 AND NOT v_can_override THEN
    v_code := 'AR_CREDIT_OVERDUE_BLOCK';
  ELSE
    v_code := 'AR_CREDIT_ELIGIBLE';
    v_allowed := true;
  END IF;
  RETURN jsonb_build_object('allowed', v_allowed, 'reasonCode', v_code,
    'creditEnabled', true, 'tenantCreditEnabled', true, 'branchCreditEnabled', true,
    'tenantPolicyConfigured', true, 'accountLinked', true, 'accountLinkable', false,
    'onHold', v_tenant_policy.enforce_customer_hold AND v_policy.configured_hold,
    'creditLimit', v_policy.configured_credit_limit, 'currentBalance', v_balance,
    'availableCredit', v_available, 'overdueAmount', v_overdue,
    'requiresOwnerApproval', v_policy.requires_owner_approval,
    'hardLimitEnforced', v_tenant_policy.hard_limit_enforced);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
END
$function$;

-- Keep the established checkout implementation intact apart from the Branch
-- gate. It remains the final authority for fiscal, AR and settlement writes.
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
  v_branch_credit_enabled boolean;
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
  SELECT b.customer_credit_enabled INTO v_branch_credit_enabled
  FROM public.branches b
  WHERE b.id = v_branch_id AND b.tenant_id = v_scope.tenant_id;
  IF coalesce(v_branch_credit_enabled, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'AR_CREDIT_BRANCH_DISABLED' USING ERRCODE = '42501';
  END IF;

  v_mode := coalesce(NULLIF(btrim(p_payload->>'settlement_mode'), ''), 'credit');
  IF v_mode NOT IN ('credit', 'partial') THEN
    RAISE EXCEPTION 'AR_CHECKOUT_SETTLEMENT_INVALID' USING ERRCODE = '22023';
  END IF;
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
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DEMO_CHECKOUT_RESULT_SCOPE_MISMATCH' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN v_result || jsonb_build_object('checkout_path', v_decision->>'checkoutPath',
    'demo_mode', v_decision->>'demoMode', 'is_demo', coalesce((v_decision->>'isDemo')::boolean, false),
    'non_fiscal', coalesce((v_decision->>'nonFiscal')::boolean, false));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

ALTER FUNCTION public.get_branch_customer_credit_policy_v1(uuid) OWNER TO postgres;
ALTER FUNCTION public.set_branch_customer_credit_policy_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.ensure_customer_credit_account_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.set_customer_credit_access_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.post_customer_credit_checkout_v1(jsonb) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_branch_customer_credit_policy_v1(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_branch_customer_credit_policy_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ensure_customer_credit_account_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_customer_credit_access_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_customer_credit_policy_v1(uuid),
  public.set_branch_customer_credit_policy_v1(jsonb),
  public.ensure_customer_credit_account_v1(jsonb),
  public.set_customer_credit_access_v1(jsonb) TO authenticated;

COMMENT ON FUNCTION public.get_branch_customer_credit_policy_v1(uuid) IS
  'Server-authoritative Branch customer-credit setting read. Branch users are restricted to their own Branch; legacy NULL inherits the tenant setting.';
COMMENT ON FUNCTION public.set_branch_customer_credit_policy_v1(jsonb) IS
  'Owner/admin or same-Branch Branch user may set only the simple Branch customer-credit switch.';
COMMENT ON FUNCTION public.ensure_customer_credit_account_v1(jsonb) IS
  'Idempotent Owner/admin/Branch setup of an empty customer AR account; no historical balance is created.';
COMMENT ON FUNCTION public.set_customer_credit_access_v1(jsonb) IS
  'Simple Owner/admin/Branch customer credit switch. Internal policy fields are fixed to safe compatibility values and are not user-facing controls.';
COMMENT ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) IS
  'Read-only authoritative customer-credit preflight enforcing business, Branch, customer, account and active-customer checks.';
COMMENT ON FUNCTION public.post_customer_credit_checkout_v1(jsonb) IS
  'Authoritative customer-credit checkout with the Branch switch checked before the existing fiscal/AR checkout implementation.';

NOTIFY pgrst, 'reload schema';

COMMIT;
