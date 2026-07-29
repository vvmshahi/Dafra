-- Authoritative, non-fiscal checkout for explicitly flagged demo tenants.
--
-- Commercial demo records remain tenant-isolated in the existing POS model so
-- cart, stock, sessions, payments, history, and KPIs can be exercised. They are
-- explicitly marked and are structurally barred from every production fiscal
-- artifact, chain, and reporting-outbox path.

BEGIN;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.is_demo IS
  'Authoritative server-side demo scope. Clients cannot opt a tenant into demo checkout.';

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS zatca_environment text NOT NULL DEFAULT 'production';

DO $ensure_branch_zatca_environment_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.branches'::regclass
      AND conname = 'branches_zatca_environment_check'
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_zatca_environment_check
      CHECK (zatca_environment IN ('production', 'sandbox'));
  END IF;
END
$ensure_branch_zatca_environment_check$;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoices.is_demo IS
  'True only for server-authorized, non-fiscal demo checkout records. Never a tax invoice.';

CREATE OR REPLACE FUNCTION public.guard_demo_invoice_fiscal_state_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_authoritative_demo boolean := false;
BEGIN
  IF NEW.is_demo IS TRUE THEN
    SELECT COALESCE(t.is_demo, false)
           AND COALESCE(t.is_active, false)
           AND t.suspended_at IS NULL
           AND COALESCE(b.is_active, false)
           AND b.zatca_environment = 'sandbox'
    INTO v_authoritative_demo
    FROM public.tenants t
    JOIN public.branches b
      ON b.tenant_id = t.id
    WHERE t.id = NEW.tenant_id
      AND b.id = NEW.branch_id;

    IF v_authoritative_demo IS NOT TRUE THEN
      RAISE EXCEPTION 'DEMO_CHECKOUT_SCOPE_INVALID' USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'INSERT'
       OR OLD.is_demo IS DISTINCT FROM NEW.is_demo THEN
      IF current_setting('app.demo_checkout_authorized', true)
         IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'DEMO_MARKER_SERVER_ONLY' USING ERRCODE = '42501';
      END IF;
    END IF;

    IF NEW.zatca_xml IS NOT NULL
       OR NEW.zatca_xml_hash IS NOT NULL
       OR NEW.zatca_signature IS NOT NULL
       OR NEW.zatca_qr_code IS NOT NULL
       OR NEW.zatca_submission_id IS NOT NULL
       OR NEW.zatca_submitted_at IS NOT NULL
       OR NEW.zatca_clearance_status IS NOT NULL
       OR NEW.zatca_clearance_response IS NOT NULL
       OR NEW.zatca_reporting_response IS NOT NULL
       OR NEW.zatca_simplified_xml IS NOT NULL
       OR NEW.zatca_simplified_xml_hash IS NOT NULL
       OR NEW.zatca_simplified_signature IS NOT NULL
       OR NEW.zatca_simplified_qr IS NOT NULL
       OR NEW.zatca_provisional_xml IS NOT NULL
       OR NEW.zatca_provisional_xml_hash IS NOT NULL
       OR NEW.zatca_provisional_signature IS NOT NULL
       OR NEW.zatca_provisional_qr IS NOT NULL
       OR NEW.zatca_cleared_xml IS NOT NULL
       OR NEW.zatca_cleared_xml_hash IS NOT NULL
       OR NEW.zatca_cleared_signature IS NOT NULL
       OR NEW.zatca_cleared_qr IS NOT NULL
       OR NEW.zatca_clearance_metadata_v2 IS NOT NULL
       OR NEW.zatca_network_response_v2 IS NOT NULL
       OR NEW.zatca_counter_number IS NOT NULL
       OR NEW.zatca_prev_invoice_hash IS NOT NULL
       OR NEW.zatca_status::text IN ('reported', 'cleared') THEN
      RAISE EXCEPTION 'DEMO_FISCAL_OUTPUT_FORBIDDEN' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.guard_demo_invoice_fiscal_state_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_demo_invoice_fiscal_state_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS invoices_guard_demo_fiscal_state_v1 ON public.invoices;
CREATE TRIGGER invoices_guard_demo_fiscal_state_v1
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.guard_demo_invoice_fiscal_state_v1();

CREATE OR REPLACE FUNCTION public.guard_demo_fiscal_queue_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.id = NEW.invoice_id
      AND i.is_demo IS TRUE
  ) THEN
    RAISE EXCEPTION 'DEMO_FISCAL_QUEUE_FORBIDDEN' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION public.guard_demo_fiscal_queue_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_demo_fiscal_queue_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zatca_reporting_outbox_guard_demo_v1
  ON public.zatca_reporting_outbox_v2;
CREATE TRIGGER zatca_reporting_outbox_guard_demo_v1
BEFORE INSERT OR UPDATE ON public.zatca_reporting_outbox_v2
FOR EACH ROW EXECUTE FUNCTION public.guard_demo_fiscal_queue_v1();

DROP TRIGGER IF EXISTS zatca_chain_reservations_guard_demo_v1
  ON public.zatca_chain_reservations_v2;
CREATE TRIGGER zatca_chain_reservations_guard_demo_v1
BEFORE INSERT OR UPDATE ON public.zatca_chain_reservations_v2
FOR EACH ROW EXECUTE FUNCTION public.guard_demo_fiscal_queue_v1();

-- Extend the existing authoritative classifier. Demo status is derived from
-- tenants.is_demo plus an active Sandbox branch; it is never accepted from a
-- checkout payload or inferred from a display name.
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
  v_profile record;
  v_branch record;
  v_customer record;
  v_credentials record;
  v_readiness record;
  v_eligibility jsonb;
  v_document_type text;
  v_classification_reason text;
  v_atomic_eligible boolean := false;
  v_atomic_reason text := 'not_evaluated';
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'AUTHENTICATION_REQUIRED');
  END IF;

  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role
  INTO v_profile
  FROM public.user_profiles p
  WHERE p.id = p_actor_user_id AND p.is_active = true;

  IF NOT FOUND OR v_profile.role NOT IN ('owner', 'admin', 'branch') THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'CHECKOUT_PROFILE_NOT_ACTIVE');
  END IF;

  SELECT b.id, b.tenant_id, b.is_active AS branch_active,
    COALESCE(t.is_active, true) AS tenant_active, t.suspended_at,
    COALESCE(t.is_demo, false) AS tenant_is_demo, b.zatca_environment
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id;

  IF NOT FOUND
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (v_profile.role = 'branch' AND v_profile.branch_id IS DISTINCT FROM v_branch.id) THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'CHECKOUT_BRANCH_FORBIDDEN');
  END IF;

  IF v_branch.branch_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE
     OR v_branch.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'CHECKOUT_BRANCH_NOT_ACTIVE');
  END IF;

  IF p_customer_id IS NULL THEN
    v_document_type := 'simplified';
    v_classification_reason := 'walk_in_retail';
  ELSE
    SELECT c.id, c.customer_type, c.vat_number
    INTO v_customer
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.tenant_id = v_branch.tenant_id
      AND c.branch_id = v_branch.id
      AND c.is_active = true;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'blocked', 'code', 'CHECKOUT_CUSTOMER_NOT_AVAILABLE');
    END IF;

    IF v_customer.customer_type = 'business'
       AND COALESCE(v_customer.vat_number, '') ~ '^3[0-9]{13}3$' THEN
      v_document_type := 'standard';
      v_classification_reason := 'vat_qualified_business';
    ELSIF v_customer.customer_type = 'business' THEN
      v_document_type := 'simplified';
      v_classification_reason := 'business_without_qualifying_vat';
    ELSE
      v_document_type := 'simplified';
      v_classification_reason := 'individual_customer';
    END IF;
  END IF;

  IF v_branch.tenant_is_demo IS TRUE THEN
    IF v_branch.zatca_environment IS DISTINCT FROM 'sandbox' THEN
      RETURN jsonb_build_object('status', 'blocked', 'code', 'DEMO_CHECKOUT_REQUIRES_SANDBOX_BRANCH');
    END IF;
    RETURN jsonb_build_object(
      'status', 'allowed',
      'documentType', v_document_type,
      'checkoutPath', 'demo',
      'capability', NULL,
      'classificationReason', v_classification_reason,
      'atomicEligible', false,
      'atomicEligibilityReason', 'demo_non_fiscal',
      'readinessStatus', 'not_applicable',
      'readinessReason', 'demo_non_fiscal',
      'productionConnected', false,
      'isDemo', true,
      'nonFiscal', true
    );
  END IF;

  SELECT c.functionality_map, c.onboarding_status,
    NULLIF(c.encrypted_production_csid, '') IS NOT NULL AS has_csid,
    NULLIF(c.encrypted_production_secret, '') IS NOT NULL AS has_secret
  INTO v_credentials
  FROM public.zatca_production_credentials c
  WHERE c.tenant_id = v_branch.tenant_id
    AND c.branch_id = v_branch.id
    AND c.environment = 'production';

  IF NOT FOUND OR v_credentials.functionality_map IS NULL THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'INVOICE_CAPABILITY_NOT_CONFIGURED');
  END IF;
  IF v_credentials.onboarding_status IS DISTINCT FROM 'production_connected'
     OR v_credentials.has_csid IS NOT TRUE OR v_credentials.has_secret IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'ZATCA_CONNECTION_REQUIRED',
      'capability', v_credentials.functionality_map);
  END IF;
  IF v_credentials.functionality_map = '0100' AND v_document_type = 'standard' THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'BRANCH_SIMPLIFIED_ONLY',
      'capability', v_credentials.functionality_map, 'classificationReason', v_classification_reason);
  END IF;
  IF v_credentials.functionality_map = '1000' AND v_document_type = 'simplified' THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'BRANCH_STANDARD_ONLY',
      'capability', v_credentials.functionality_map, 'classificationReason', v_classification_reason);
  END IF;
  IF v_credentials.functionality_map NOT IN ('0100', '1000', '1100') THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'INVOICE_CAPABILITY_NOT_CONFIGURED');
  END IF;

  SELECT r.readiness_status, r.reason INTO v_readiness
  FROM public.zatca_branch_readiness_v2 r
  WHERE r.tenant_id = v_branch.tenant_id AND r.branch_id = v_branch.id;

  IF v_document_type = 'simplified' THEN
    v_eligibility := public.get_zatca_atomic_checkout_eligibility_v2(v_branch.id, p_actor_user_id);
    v_atomic_eligible := COALESCE((v_eligibility->>'eligible')::boolean, false);
    v_atomic_reason := COALESCE(v_eligibility->>'blockingReason', 'eligibility_unknown');
  ELSE
    v_atomic_reason := 'standard_uses_legacy_clearance';
  END IF;

  RETURN jsonb_build_object(
    'status', 'allowed', 'documentType', v_document_type,
    'checkoutPath', CASE WHEN v_document_type = 'simplified' AND v_atomic_eligible THEN 'atomic' ELSE 'legacy' END,
    'capability', v_credentials.functionality_map,
    'classificationReason', v_classification_reason,
    'atomicEligible', v_atomic_eligible, 'atomicEligibilityReason', v_atomic_reason,
    'readinessStatus', COALESCE(v_readiness.readiness_status, 'missing'),
    'readinessReason', v_readiness.reason, 'productionConnected', true,
    'isDemo', false, 'nonFiscal', false
  );
END
$function$;

ALTER FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  TO service_role;

-- Preserve the existing public signature. The server decision controls whether
-- the private commercial base is invoked as fiscal checkout or demo checkout.
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
      AND tenant_id = (
        SELECT tenant_id FROM public.branches WHERE id = v_branch_id
      )
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
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pos_checkout(jsonb) IS
  'Server-classified fiscal checkout for real tenants, or explicitly marked non-fiscal commercial checkout for authoritative active demo/Sandbox scope.';

DO $verify_contract_update$
BEGIN
  UPDATE public.product_units_commercial_function_contracts_v1
  SET definition_md5 = md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)),
      registered_at = clock_timestamp()
  WHERE function_signature = 'public.pos_checkout(jsonb)';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POS_CHECKOUT_DEMO_CONTRACT_UPDATE_FAILED';
  END IF;
END
$verify_contract_update$;

COMMIT;
