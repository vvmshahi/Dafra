-- Rebind public wrappers after the 00600 classifier rename and harden the
-- read-only preflight's no-account/no-policy path. This is forward-only and
-- contains no business-row, policy, credential, fiscal, stock, or payment DML.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_pos_checkout_document_v1(
  p_branch_id uuid,
  p_customer_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
  SELECT public.resolve_pos_checkout_document_internal_v1(
    auth.uid(), p_branch_id, p_customer_id
  )
$function$;

ALTER FUNCTION public.resolve_pos_checkout_document_v1(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_pos_checkout_document_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pos_checkout_document_v1(uuid, uuid)
  TO authenticated;

-- Explicitly bind the public checkout contract to the server-derived mode
-- classifier. This avoids any stale PL/pgSQL execution plan retaining the
-- base classifier OID from before 00600 renamed it.
CREATE OR REPLACE FUNCTION public.pos_checkout(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_customer_id uuid;
  v_decision jsonb;
  v_result jsonb;
  v_code text;
  v_invoice_id uuid;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  v_branch_id := NULLIF(btrim(COALESCE(p_payload->>'branch_id', '')), '')::uuid;
  v_customer_id := NULLIF(btrim(COALESCE(p_payload->>'customer_id', '')), '')::uuid;
  v_decision := public.resolve_pos_checkout_document_internal_v1(
    auth.uid(), v_branch_id, v_customer_id
  );
  IF v_decision->>'status' IS DISTINCT FROM 'allowed' THEN
    v_code := COALESCE(v_decision->>'code', 'CHECKOUT_DOCUMENT_BLOCKED');
    RAISE EXCEPTION '%', v_code USING ERRCODE = 'P0001';
  END IF;
  IF v_decision->>'checkoutPath' = 'atomic'
     AND NULLIF(current_setting('app.atomic_checkout_intent_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'ATOMIC_CHECKOUT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.pos_checkout_capability_base_v1(p_payload - 'is_demo' - 'non_fiscal');
  IF v_result->>'zatca_invoice_type' IS DISTINCT FROM v_decision->>'documentType' THEN
    RAISE EXCEPTION 'CHECKOUT_DOCUMENT_CLASSIFICATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_decision->>'checkoutPath' = 'demo' THEN
    v_invoice_id := NULLIF(v_result->>'invoice_id', '')::uuid;
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
      AND tenant_id = (SELECT tenant_id FROM public.branches WHERE id = v_branch_id)
      AND branch_id = v_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DEMO_CHECKOUT_RESULT_SCOPE_MISMATCH' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object(
    'document_decision', v_decision->>'documentType',
    'checkout_path', v_decision->>'checkoutPath',
    'classification_reason', v_decision->>'classificationReason',
    'is_demo', COALESCE((v_decision->>'isDemo')::boolean, false),
    'non_fiscal', COALESCE((v_decision->>'nonFiscal')::boolean, false),
    'demo_mode', v_decision->>'demoMode',
    'receipt_label', CASE WHEN v_decision->>'checkoutPath' = 'demo'
      THEN 'DEMO — NOT A TAX INVOICE' ELSE NULL END,
    'receipt_label_ar', CASE WHEN v_decision->>'checkoutPath' = 'demo'
      THEN 'تجريبي — ليست فاتورة ضريبية' ELSE NULL END
  );
END
$function$;

ALTER FUNCTION public.pos_checkout(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb) TO authenticated, service_role;

-- 00600's original implementation is preserved as an internal function. The
-- public wrapper resolves account/policy absence without ever calling a path
-- that can create an account, then delegates all other policy math to it.
ALTER FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb)
  RENAME TO get_customer_credit_checkout_eligibility_v1_base_20260803;

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
  v_requested_credit_text text;
  v_scope record;
  v_customer record;
  v_policy_id uuid;
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
  IF v_requested_credit_text IS NOT NULL
     AND v_requested_credit_text !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_AMOUNT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.ar_assert_scope_v1(v_branch_id, v_customer_id);
  SELECT c.id, c.receivable_account_id INTO v_customer
  FROM public.customers c WHERE c.id = v_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AR_CUSTOMER_NOT_FOUND' USING ERRCODE = '42501';
  END IF;

  IF v_customer.receivable_account_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false, 'reasonCode', 'AR_CREDIT_DISABLED',
      'creditEnabled', false, 'accountLinked', false,
      'accountLinkable', v_scope.actor_role IN ('owner', 'admin'),
      'onHold', false, 'creditLimit', 0, 'currentBalance', 0,
      'availableCredit', 0, 'overdueAmount', 0, 'requiresOwnerApproval', false
    );
  END IF;

  SELECT p.id INTO v_policy_id
  FROM public.customer_credit_policies p
  WHERE p.tenant_id = v_scope.tenant_id
    AND p.receivable_account_id = v_customer.receivable_account_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false, 'reasonCode', 'AR_CREDIT_DISABLED',
      'creditEnabled', false, 'accountLinked', true, 'accountLinkable', false,
      'onHold', false, 'creditLimit', 0, 'currentBalance', 0,
      'availableCredit', 0, 'overdueAmount', 0, 'requiresOwnerApproval', false
    );
  END IF;

  RETURN public.get_customer_credit_checkout_eligibility_v1_base_20260803(p_payload);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN
  RAISE EXCEPTION 'AR_CREDIT_PREFLIGHT_IDENTIFIER_INVALID' USING ERRCODE = '22023';
END
$function$;

ALTER FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_credit_checkout_eligibility_v1(jsonb)
  TO authenticated;
REVOKE ALL ON FUNCTION public.get_customer_credit_checkout_eligibility_v1_base_20260803(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

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
  v_branch_id := NULLIF(btrim(COALESCE(p_payload->>'branch_id', '')), '')::uuid;
  v_customer_id := NULLIF(btrim(COALESCE(p_payload->>'customer_id', '')), '')::uuid;
  v_decision := public.resolve_pos_checkout_document_internal_v1(auth.uid(), v_branch_id, v_customer_id);
  IF v_decision->>'status' IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION '%', COALESCE(v_decision->>'code', 'AR_CHECKOUT_DOCUMENT_BLOCKED')
      USING ERRCODE = 'P0001';
  END IF;
  v_result := public.post_customer_credit_checkout_v1_hardened_20260803(p_payload);
  v_invoice_id := NULLIF(v_result->>'invoice_id', '')::uuid;

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
    WHERE id = v_invoice_id AND branch_id = v_branch_id;
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

DO $refresh_contracts$
BEGIN
  -- The prior registry is missing the public credit wrapper row. Upsert both
  -- public contracts so this forward-only rebind is independently auditable.
  INSERT INTO public.product_units_commercial_function_contracts_v1 (
    function_signature,
    definition_md5,
    registered_at
  )
  VALUES
    (
      'public.pos_checkout(jsonb)',
      md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)),
      clock_timestamp()
    ),
    (
      'public.post_customer_credit_checkout_v1(jsonb)',
      md5(pg_get_functiondef('public.post_customer_credit_checkout_v1(jsonb)'::regprocedure)),
      clock_timestamp()
    )
  ON CONFLICT (function_signature) DO UPDATE
  SET definition_md5 = EXCLUDED.definition_md5,
      registered_at = EXCLUDED.registered_at;
END
$refresh_contracts$;

NOTIFY pgrst, 'reload schema';

COMMIT;
