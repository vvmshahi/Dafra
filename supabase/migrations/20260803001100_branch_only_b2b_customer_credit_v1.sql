-- Branch-only, Business/B2B customer-credit rule.
--
-- The tenant and customer policy tables remain as historical compatibility
-- storage. They no longer participate in customer-credit eligibility. This
-- migration creates no balances, invoices, payments, stock movements, fiscal
-- artifacts, or historical backfill.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $required_branch_only_credit_contracts$
BEGIN
  IF to_regclass('public.branches') IS NULL
     OR to_regclass('public.customers') IS NULL
     OR to_regclass('public.customer_credit_policies') IS NULL
     OR to_regprocedure('public.ar_assert_scope_v1(uuid,uuid)') IS NULL
     OR to_regprocedure('public.ar_ensure_customer_account_v1(uuid)') IS NULL
     OR to_regprocedure('public.post_customer_credit_checkout_v1_hardened_20260803(jsonb)') IS NULL
     OR to_regprocedure('public.resolve_pos_checkout_document_internal_v1(uuid,uuid,uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'AR_BRANCH_ONLY_CREDIT_REQUIRED_CONTRACT_MISSING';
  END IF;
END
$required_branch_only_credit_contracts$;

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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'CREDIT_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role, p.is_active
  INTO v_actor FROM public.user_profiles p WHERE p.id = auth.uid();
  SELECT b.id, b.tenant_id, b.name, b.name_ar, b.is_active,
         b.customer_credit_enabled,
         coalesce(t.is_active, true) AS tenant_active, t.suspended_at
  INTO v_branch
  FROM public.branches b JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin', 'branch')
     OR v_branch.is_active IS NOT TRUE OR v_branch.tenant_active IS NOT TRUE
     OR v_branch.suspended_at IS NOT NULL
     OR v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_actor.role = 'branch' AND v_actor.branch_id IS DISTINCT FROM v_branch.id) THEN
    RAISE EXCEPTION 'CREDIT_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'branchId', v_branch.id,
    'branchName', v_branch.name,
    'branchNameAr', v_branch.name_ar,
    'tenantCreditEnabled', true,
    'branchChoice', v_branch.customer_credit_enabled,
    'branchCreditEnabled', coalesce(v_branch.customer_credit_enabled, false),
    'explicit', v_branch.customer_credit_enabled IS NOT NULL,
    'inherited', v_branch.customer_credit_enabled IS NULL,
    'tenantPolicyConfigured', false,
    'canEdit', true);
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
  v_branch_id uuid;
  v_enabled boolean;
  v_actor record;
  v_branch record;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END;
  IF v_branch_id IS NULL OR jsonb_typeof(p_payload -> 'credit_enabled') <> 'boolean' THEN
    RAISE EXCEPTION 'AR_BRANCH_SETTINGS_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  v_enabled := (p_payload ->> 'credit_enabled')::boolean;
  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role, p.is_active
  INTO v_actor FROM public.user_profiles p WHERE p.id = auth.uid();
  SELECT b.id, b.tenant_id, b.is_active,
         coalesce(t.is_active, true) AS tenant_active, t.suspended_at
  INTO v_branch
  FROM public.branches b JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = v_branch_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin', 'branch')
     OR v_branch.is_active IS NOT TRUE OR v_branch.tenant_active IS NOT TRUE
     OR v_branch.suspended_at IS NOT NULL
     OR v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_actor.role = 'branch' AND v_actor.branch_id IS DISTINCT FROM v_branch.id) THEN
    RAISE EXCEPTION 'CREDIT_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  UPDATE public.branches
  SET customer_credit_enabled = v_enabled, updated_at = now()
  WHERE id = v_branch_id AND tenant_id = v_actor.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RETURN public.get_branch_customer_credit_policy_v1(v_branch_id);
END
$function$;

-- Automatic, idempotent account creation for eligible Business/B2B customers.
-- The legacy policy row is normalized only because the reviewed raw posting
-- engine still reads it. It is not an eligibility gate or a user-facing limit.
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
  v_branch record;
  v_scope record;
  v_account_id uuid;
  v_created boolean := false;
  v_compatibility_limit numeric(12,2) := 9999999999.99::numeric(12,2);
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_ACCOUNT_SETUP_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_customer_id := NULLIF(btrim(p_payload ->> 'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_ACCOUNT_SETUP_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'AR_ACCOUNT_SETUP_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT c.* INTO v_customer
  FROM public.customers c
  WHERE c.id = v_customer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  IF v_customer.customer_type::text IS DISTINCT FROM 'business' THEN
    RAISE EXCEPTION 'BUSINESS_CUSTOMER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF v_customer.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'CUSTOMER_INACTIVE' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active, b.customer_credit_enabled,
         coalesce(t.is_active, true) AS tenant_active, t.suspended_at
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = v_customer.branch_id;
  IF NOT FOUND OR v_branch.is_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE OR v_branch.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'BRANCH_INACTIVE' USING ERRCODE = '42501';
  END IF;
  IF coalesce(v_branch.customer_credit_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'BRANCH_CREDIT_DISABLED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_customer.branch_id, v_customer.id);
  IF v_scope.actor_role NOT IN ('owner', 'admin', 'branch') THEN
    RAISE EXCEPTION 'CREDIT_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  v_created := v_customer.receivable_account_id IS NULL;
  v_account_id := public.ar_ensure_customer_account_v1(v_customer_id);

  INSERT INTO public.customer_credit_policies (
    tenant_id, receivable_account_id, credit_enabled, credit_limit, terms,
    hold, hold_reason, overdue_block, warn_threshold_percent,
    requires_owner_approval, updated_by, use_tenant_default,
    configured_credit_limit, configured_hold, configured_hold_reason, due_date_days
  ) VALUES (
    v_scope.tenant_id, v_account_id, true, v_compatibility_limit, NULL,
    false, NULL, false, 100, false, v_scope.actor_id, false,
    v_compatibility_limit, false, NULL, NULL
  ) ON CONFLICT (tenant_id, receivable_account_id) DO UPDATE SET
    credit_enabled = true,
    credit_limit = v_compatibility_limit,
    terms = NULL,
    hold = false,
    hold_reason = NULL,
    overdue_block = false,
    warn_threshold_percent = 100,
    requires_owner_approval = false,
    use_tenant_default = false,
    configured_credit_limit = v_compatibility_limit,
    configured_hold = false,
    configured_hold_reason = NULL,
    due_date_days = NULL,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  RETURN jsonb_build_object(
    'customerId', v_customer_id,
    'receivableAccountId', v_account_id,
    'created', v_created,
    'historicalBalanceBackfilled', false,
    'automatic', true);
EXCEPTION WHEN others THEN
  IF SQLERRM IN (
    'AR_ACCOUNT_SETUP_PAYLOAD_INVALID', 'CUSTOMER_NOT_FOUND',
    'BUSINESS_CUSTOMER_REQUIRED', 'CUSTOMER_INACTIVE', 'BRANCH_INACTIVE',
    'BRANCH_CREDIT_DISABLED', 'CREDIT_UNAUTHORIZED'
  ) THEN
    RAISE;
  END IF;
  RAISE EXCEPTION 'CREDIT_ACCOUNT_SETUP_FAILED' USING ERRCODE = '42501';
END
$function$;

-- Read-only Branch-only/B2B preflight. The account is intentionally optional:
-- the posting wrapper creates it atomically when the first credit sale needs it.
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
  v_requested_text text;
  v_requested_credit numeric(12,2) := 0;
  v_actor record;
  v_branch record;
  v_customer record;
  v_account_balance numeric(12,2) := 0;
  v_account_ready boolean := false;
  v_branch_enabled boolean := false;
  v_branch_active boolean := false;
  v_customer_active boolean := false;
  v_code text := 'AR_CREDIT_ELIGIBLE';
  v_allowed boolean := false;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_customer_id := NULLIF(btrim(p_payload ->> 'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
  END;
  IF v_branch_id IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  v_requested_text := NULLIF(btrim(coalesce(p_payload ->> 'proposed_credit_amount', '')), '');
  IF v_requested_text IS NOT NULL THEN
    IF v_requested_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_AMOUNT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_requested_credit := v_requested_text::numeric(12,2);
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'CREDIT_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role, p.is_active
  INTO v_actor FROM public.user_profiles p WHERE p.id = auth.uid();
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin', 'branch') THEN
    RAISE EXCEPTION 'CREDIT_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id, b.is_active, b.customer_credit_enabled,
         coalesce(t.is_active, true) AS tenant_active, t.suspended_at
  INTO v_branch
  FROM public.branches b JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = v_branch_id;
  IF NOT FOUND THEN
    v_code := 'BRANCH_INACTIVE';
  ELSIF v_branch.is_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE OR v_branch.suspended_at IS NOT NULL THEN
    v_code := 'BRANCH_INACTIVE';
  ELSIF v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_actor.role = 'branch' AND v_actor.branch_id IS DISTINCT FROM v_branch.id) THEN
    RAISE EXCEPTION 'CREDIT_UNAUTHORIZED' USING ERRCODE = '42501';
  ELSE
    v_branch_active := true;
    v_branch_enabled := coalesce(v_branch.customer_credit_enabled, false);
    SELECT c.id, c.tenant_id, c.branch_id, c.customer_type::text AS customer_type,
           c.is_active, c.receivable_account_id,
           coalesce(nullif(btrim(c.business_name), ''), nullif(btrim(c.company_name), ''), nullif(btrim(c.name), '')) AS business_identity
    INTO v_customer
    FROM public.customers c WHERE c.id = v_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = '42501';
    END IF;
    v_customer_active := coalesce(v_customer.is_active, false);
    IF v_customer.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_customer.branch_id IS DISTINCT FROM v_branch.id THEN
      RAISE EXCEPTION 'CREDIT_UNAUTHORIZED' USING ERRCODE = '42501';
    ELSIF v_branch_enabled IS NOT TRUE THEN
      v_code := 'BRANCH_CREDIT_DISABLED';
    ELSIF v_customer.is_active IS NOT TRUE THEN
      v_code := 'CUSTOMER_INACTIVE';
    ELSIF v_customer.customer_type IS DISTINCT FROM 'business'
       OR v_customer.business_identity IS NULL THEN
      v_code := 'BUSINESS_CUSTOMER_REQUIRED';
    ELSE
      v_allowed := true;
      v_account_ready := v_customer.receivable_account_id IS NOT NULL;
      IF v_account_ready THEN
        v_account_balance := public.ar_account_balance_v1(v_customer.receivable_account_id);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'eligible', v_allowed,
    'reasonCode', v_code,
    'reason_code', v_code,
    'effectiveReasonCode', v_code,
    'business_enabled', true,
    'branch_enabled', v_branch_enabled,
    'customer_enabled', v_allowed,
    'account_ready', v_account_ready,
    'account_auto_create', v_allowed AND NOT v_account_ready,
    'customer_active', v_customer_active,
    'branch_active', v_branch_active,
    'businessEnabled', true,
    'branchEnabled', v_branch_enabled,
    'customerEnabled', v_allowed,
    'accountReady', v_account_ready,
    'customerActive', v_customer_active,
    'branchActive', v_branch_active,
    'creditEnabled', v_allowed,
    'accountLinked', v_account_ready,
    'accountLinkable', false,
    'currentBalance', v_account_balance,
    'creditLimit', NULL,
    'availableCredit', NULL,
    'overdueAmount', 0,
    'requiresOwnerApproval', false,
    'tenantCreditEnabled', true,
    'tenantPolicyConfigured', false,
    'hardLimitEnforced', false,
    'proposedCreditAmount', v_requested_credit);
END
$function$;

-- The reviewed raw engine remains responsible for fiscal/AR writes. This
-- wrapper supplies the compatibility account/policy and applies only the
-- Branch/B2B rule before invoking it.
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
  v_eligibility jsonb;
  v_result jsonb;
  v_invoice_id uuid;
  v_decision jsonb;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'AR_CHECKOUT_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_branch_id := NULLIF(btrim(p_payload ->> 'branch_id'), '')::uuid;
    v_customer_id := NULLIF(btrim(p_payload ->> 'customer_id'), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
  END;
  IF v_branch_id IS NULL OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = '22023';
  END IF;

  v_eligibility := public.get_customer_credit_checkout_eligibility_v1(p_payload);
  IF v_eligibility ->> 'reasonCode' IS DISTINCT FROM 'AR_CREDIT_ELIGIBLE' THEN
    RAISE EXCEPTION '%', v_eligibility ->> 'reasonCode' USING ERRCODE = '42501';
  END IF;

  PERFORM public.ensure_customer_credit_account_v1(jsonb_build_object('customer_id', v_customer_id));
  v_result := public.post_customer_credit_checkout_v1_hardened_20260803(p_payload);
  v_invoice_id := NULLIF(v_result ->> 'invoice_id', '')::uuid;
  v_decision := public.resolve_pos_checkout_document_internal_v1(auth.uid(), v_branch_id, v_customer_id);

  IF v_decision ->> 'checkoutPath' = 'demo' THEN
    PERFORM set_config('app.demo_checkout_authorized', 'true', true);
    UPDATE public.invoices
    SET is_demo = true, zatca_status = 'not_submitted',
        zatca_counter_number = NULL, zatca_prev_invoice_hash = NULL,
        zatca_xml = NULL, zatca_xml_hash = NULL, zatca_signature = NULL,
        zatca_qr_code = NULL, zatca_submission_id = NULL,
        zatca_submitted_at = NULL, zatca_clearance_status = NULL,
        zatca_clearance_response = NULL, zatca_reporting_response = NULL,
        zatca_warnings = NULL
    WHERE id = v_invoice_id AND branch_id = v_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DEMO_CHECKOUT_RESULT_SCOPE_MISMATCH' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object(
    'checkout_path', v_decision ->> 'checkoutPath',
    'demo_mode', v_decision ->> 'demoMode',
    'is_demo', coalesce((v_decision ->> 'isDemo')::boolean, false),
    'non_fiscal', coalesce((v_decision ->> 'nonFiscal')::boolean, false),
    'credit_rule', 'branch_only_b2b');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
END
$function$;

-- These APIs remain as compatibility symbols but cannot re-enable the removed
-- Owner/customer switches. The UI no longer calls them.
REVOKE ALL ON FUNCTION public.get_tenant_customer_credit_policy_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_tenant_customer_credit_policy_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_customer_credit_access_v1(jsonb) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.ensure_customer_credit_account_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.get_branch_customer_credit_policy_v1(uuid) OWNER TO postgres;
ALTER FUNCTION public.set_branch_customer_credit_policy_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) OWNER TO postgres;
ALTER FUNCTION public.post_customer_credit_checkout_v1(jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_branch_customer_credit_policy_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_branch_customer_credit_policy_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_customer_credit_account_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_customer_credit_checkout_v1(jsonb) TO authenticated;

COMMENT ON FUNCTION public.ensure_customer_credit_account_v1(jsonb) IS
  'Automatic idempotent empty account setup for an active Business/B2B customer in a credit-enabled Branch. No manual customer switch or historical balance is required.';
COMMENT ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) IS
  'Read-only Branch-only Business/B2B preflight. Tenant policy, customer policy, limits, holds, terms and approvals are not eligibility gates.';
COMMENT ON FUNCTION public.post_customer_credit_checkout_v1(jsonb) IS
  'Authoritative Branch-only Business/B2B credit checkout with automatic account setup and no user-facing limit or customer switch.';

NOTIFY pgrst, 'reload schema';

COMMIT;
