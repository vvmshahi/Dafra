-- Customer-credit POS preflight and server-derived Demo/Sandbox routing.
--
-- This migration is additive with respect to business records. It introduces
-- read-only eligibility/mode decisions, then wraps the existing public credit
-- checkout solely to preserve the existing non-fiscal marker for AR checkout.
-- No policy is enabled, no credential is read, and no fiscal data is rewritten.

BEGIN;

CREATE OR REPLACE FUNCTION public.zatca_demo_checkout_mode_internal_v1(
  p_tenant_id uuid,
  p_branch_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch record;
BEGIN
  SELECT COALESCE(t.is_demo, false) AS is_demo,
         COALESCE(t.is_active, false) AS tenant_active,
         t.suspended_at,
         COALESCE(b.is_active, false) AS branch_active,
         b.zatca_environment
  INTO v_branch
  FROM public.tenants t
  JOIN public.branches b ON b.tenant_id = t.id
  WHERE t.id = p_tenant_id
    AND b.id = p_branch_id;

  IF NOT FOUND OR v_branch.is_demo IS NOT TRUE THEN
    RETURN 'not_demo';
  END IF;

  IF v_branch.tenant_active IS NOT TRUE
     OR v_branch.suspended_at IS NOT NULL
     OR v_branch.branch_active IS NOT TRUE
     OR v_branch.zatca_environment IS DISTINCT FROM 'sandbox' THEN
    RETURN 'non_fiscal';
  END IF;

  -- Sandbox compliance is enabled only from server-held, active compliance
  -- material. This does not select or expose production credentials.
  IF EXISTS (
    SELECT 1
    FROM public.zatca_sandbox_credentials c
    WHERE c.tenant_id = p_tenant_id
      AND c.branch_id = p_branch_id
      AND c.environment = 'sandbox'
      AND c.status = 'compliance'
      AND c.compliance_demo_status = 'active'
      AND c.last_successful_onboarding_status = 'compliance_passed'
      AND NULLIF(c.encrypted_private_key, '') IS NOT NULL
      AND NULLIF(c.encrypted_compliance_csid, '') IS NOT NULL
      AND NULLIF(c.encrypted_compliance_secret, '') IS NOT NULL
      AND (c.expires_at IS NULL OR c.expires_at > now())
  ) THEN
    RETURN 'sandbox_compliance';
  END IF;

  RETURN 'non_fiscal';
END
$function$;

ALTER FUNCTION public.zatca_demo_checkout_mode_internal_v1(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zatca_demo_checkout_mode_internal_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.zatca_demo_checkout_mode_internal_v1(uuid, uuid)
  TO service_role;

-- Keep the reviewed classifier intact and make the Demo-mode choice a narrow,
-- server-derived wrapper. A client payload cannot choose either route.
ALTER FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  RENAME TO resolve_pos_checkout_document_internal_base_20260803;

CREATE OR REPLACE FUNCTION public.resolve_pos_checkout_document_internal_v1(
  p_actor_user_id uuid,
  p_branch_id uuid,
  p_customer_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_decision jsonb;
  v_tenant_id uuid;
  v_demo_mode text;
BEGIN
  v_decision := public.resolve_pos_checkout_document_internal_base_20260803(
    p_actor_user_id, p_branch_id, p_customer_id
  );

  IF v_decision->>'status' IS DISTINCT FROM 'allowed'
     OR v_decision->>'checkoutPath' IS DISTINCT FROM 'demo' THEN
    RETURN v_decision || jsonb_build_object('demoMode', 'not_demo');
  END IF;

  SELECT b.tenant_id INTO v_tenant_id
  FROM public.branches b
  WHERE b.id = p_branch_id;
  v_demo_mode := public.zatca_demo_checkout_mode_internal_v1(v_tenant_id, p_branch_id);

  IF v_demo_mode = 'sandbox_compliance' THEN
    -- The deployed sandbox capability has compliance validation only. Standard
    -- invoice clearance is intentionally blocked until a separately certified
    -- sandbox-clearance capability exists.
    IF v_decision->>'documentType' = 'standard' THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'code', 'SANDBOX_STANDARD_CLEARANCE_UNAVAILABLE',
        'demoMode', 'sandbox_compliance'
      );
    END IF;

    RETURN v_decision || jsonb_build_object(
      'checkoutPath', 'sandbox',
      'atomicEligible', false,
      'atomicEligibilityReason', 'sandbox_compliance_validation',
      'readinessStatus', 'sandbox_compliance_active',
      'readinessReason', 'sandbox_compliance_validation_only',
      'productionConnected', false,
      'isDemo', false,
      'nonFiscal', false,
      'demoMode', 'sandbox_compliance'
    );
  END IF;

  RETURN v_decision || jsonb_build_object('demoMode', 'non_fiscal');
END
$function$;

ALTER FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_zatca_demo_checkout_mode_v1(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_profile record;
  v_branch record;
  v_mode text;
BEGIN
  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role
  INTO v_profile
  FROM public.user_profiles p
  WHERE p.id = auth.uid() AND p.is_active IS TRUE;

  IF NOT FOUND OR v_profile.role NOT IN ('owner', 'admin', 'branch') THEN
    RAISE EXCEPTION 'CHECKOUT_PROFILE_NOT_ACTIVE' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.tenant_id
  INTO v_branch
  FROM public.branches b
  WHERE b.id = p_branch_id;

  IF NOT FOUND
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_profile.role = 'branch' AND v_profile.branch_id IS DISTINCT FROM v_branch.id) THEN
    RAISE EXCEPTION 'CHECKOUT_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_mode := public.zatca_demo_checkout_mode_internal_v1(v_branch.tenant_id, v_branch.id);
  RETURN jsonb_build_object(
    'mode', v_mode,
    'isDemo', v_mode IN ('non_fiscal', 'sandbox_compliance'),
    'sandbox', v_mode = 'sandbox_compliance',
    'nonFiscal', v_mode = 'non_fiscal'
  );
END
$function$;

ALTER FUNCTION public.get_zatca_demo_checkout_mode_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_zatca_demo_checkout_mode_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_zatca_demo_checkout_mode_v1(uuid)
  TO authenticated;

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
  v_requested_credit_text text;
  v_scope record;
  v_customer record;
  v_policy record;
  v_balance numeric(12,2) := 0;
  v_overdue numeric(12,2) := 0;
  v_available numeric(12,2) := 0;
  v_code text := 'AR_CREDIT_DISABLED';
  v_allowed boolean := false;
  v_account_linked boolean := false;
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

  v_requested_credit_text := NULLIF(btrim(COALESCE(p_payload->>'proposed_credit_amount', '')), '');
  IF v_requested_credit_text IS NOT NULL THEN
    IF v_requested_credit_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_AMOUNT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_requested_credit := v_requested_credit_text::numeric(12,2);
  END IF;

  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_branch_id, v_customer_id);
  SELECT c.id, c.receivable_account_id
  INTO v_customer
  FROM public.customers c
  WHERE c.id = v_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501';
  END IF;

  v_account_linked := v_customer.receivable_account_id IS NOT NULL;
  IF v_account_linked THEN
    SELECT * INTO v_policy
    FROM public.customer_credit_policies p
    WHERE p.tenant_id = v_scope.tenant_id
      AND p.receivable_account_id = v_customer.receivable_account_id;
  END IF;

  IF NOT FOUND OR v_policy.credit_enabled IS NOT TRUE THEN
    v_code := 'AR_CREDIT_DISABLED';
  ELSE
    v_balance := public.ar_account_balance_v1(v_customer.receivable_account_id);
    v_available := GREATEST(v_policy.credit_limit - v_balance, 0);

    SELECT COALESCE(sum(public.ar_invoice_outstanding_v1(i.id)), 0)
    INTO v_overdue
    FROM public.invoices i
    WHERE i.tenant_id = v_scope.tenant_id
      AND i.customer_id = v_customer_id
      AND i.status = 'posted'
      AND i.zatca_invoice_type IN ('simplified', 'standard')
      AND i.due_date IS NOT NULL
      AND i.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date
      AND public.ar_invoice_outstanding_v1(i.id) > 0.01;

    IF v_policy.hold IS TRUE
       AND NOT (v_scope.actor_role IN ('owner', 'admin', 'manager') AND NULLIF(btrim(p_payload->>'override_reason'), '') IS NOT NULL) THEN
      v_code := 'AR_CREDIT_HOLD';
    ELSIF v_policy.requires_owner_approval IS TRUE
       AND v_scope.actor_role NOT IN ('owner', 'admin') THEN
      v_code := 'AR_CREDIT_OWNER_APPROVAL_REQUIRED';
    ELSIF v_policy.credit_limit <= 0
       OR v_balance + v_requested_credit > v_policy.credit_limit + 0.01 THEN
      v_code := 'AR_CREDIT_LIMIT_EXCEEDED';
    ELSIF v_policy.overdue_block IS TRUE AND v_overdue > 0.01
       AND NOT (v_scope.actor_role IN ('owner', 'admin', 'manager') AND NULLIF(btrim(p_payload->>'override_reason'), '') IS NOT NULL) THEN
      v_code := 'AR_CREDIT_OVERDUE_BLOCK';
    ELSE
      v_code := 'AR_CREDIT_ELIGIBLE';
      v_allowed := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'reasonCode', v_code,
    'creditEnabled', COALESCE(v_policy.credit_enabled, false),
    'accountLinked', v_account_linked,
    'accountLinkable', NOT v_account_linked AND v_scope.actor_role IN ('owner', 'admin'),
    'onHold', COALESCE(v_policy.hold, false),
    'creditLimit', COALESCE(v_policy.credit_limit, 0),
    'currentBalance', v_balance,
    'availableCredit', v_available,
    'overdueAmount', v_overdue,
    'requiresOwnerApproval', COALESCE(v_policy.requires_owner_approval, false)
  );
END
$function$;

ALTER FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb)
  TO authenticated;

-- The commercial credit checkout invokes the private base checkout directly.
-- Wrap the current hardened public function so non-fiscal Demo AR sales retain
-- the same post-checkout marker and artifact suppression as normal Demo sales.
ALTER FUNCTION public.post_customer_credit_checkout_v1(jsonb)
  RENAME TO post_customer_credit_checkout_v1_hardened_20260803;

CREATE OR REPLACE FUNCTION public.post_customer_credit_checkout_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_result jsonb;
  v_branch_id uuid;
  v_customer_id uuid;
  v_invoice_id uuid;
  v_decision jsonb;
BEGIN
  v_result := public.post_customer_credit_checkout_v1_hardened_20260803(p_payload);
  v_branch_id := NULLIF(btrim(COALESCE(p_payload->>'branch_id', '')), '')::uuid;
  v_customer_id := NULLIF(btrim(COALESCE(p_payload->>'customer_id', '')), '')::uuid;
  v_invoice_id := NULLIF(v_result->>'invoice_id', '')::uuid;
  v_decision := public.resolve_pos_checkout_document_internal_v1(auth.uid(), v_branch_id, v_customer_id);

  IF v_decision->>'checkoutPath' = 'demo' THEN
    PERFORM set_config('app.demo_checkout_authorized', 'true', true);
    UPDATE public.invoices
    SET is_demo = true,
        zatca_status = 'not_submitted',
        zatca_counter_number = NULL,
        zatca_prev_invoice_hash = NULL,
        zatca_xml = NULL,
        zatca_xml_hash = NULL,
        zatca_signature = NULL,
        zatca_qr_code = NULL,
        zatca_submission_id = NULL,
        zatca_submitted_at = NULL,
        zatca_clearance_status = NULL,
        zatca_clearance_response = NULL,
        zatca_reporting_response = NULL,
        zatca_warnings = NULL
    WHERE id = v_invoice_id
      AND branch_id = v_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DEMO_CHECKOUT_RESULT_SCOPE_MISMATCH' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object(
    'checkout_path', v_decision->>'checkoutPath',
    'demo_mode', v_decision->>'demoMode',
    'is_demo', COALESCE((v_decision->>'isDemo')::boolean, false),
    'non_fiscal', COALESCE((v_decision->>'nonFiscal')::boolean, false)
  );
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_CHECKOUT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.post_customer_credit_checkout_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.post_customer_credit_checkout_v1(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_customer_credit_checkout_v1(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.post_customer_credit_checkout_v1_hardened_20260803(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) IS
  'Read-only authoritative preflight for POS customer credit. It never enables a policy or creates a receivable account.';
COMMENT ON FUNCTION public.get_zatca_demo_checkout_mode_v1(uuid) IS
  'Returns the server-derived non-fiscal or sandbox-compliance demonstration mode for an authorized branch; no credential material is returned.';
COMMENT ON FUNCTION public.post_customer_credit_checkout_v1(jsonb) IS
  'Creates an unpaid or partially settled customer invoice through the reviewed commercial checkout, then appends AR records atomically. Non-fiscal demo marking is server-derived; client flags are ignored.';

DO $refresh_contracts$
BEGIN
  UPDATE public.product_units_commercial_function_contracts_v1
  SET definition_md5 = md5(pg_get_functiondef('public.post_customer_credit_checkout_v1(jsonb)'::regprocedure)),
      registered_at = clock_timestamp()
  WHERE function_signature = 'public.post_customer_credit_checkout_v1(jsonb)';
END
$refresh_contracts$;

NOTIFY pgrst, 'reload schema';

COMMIT;
