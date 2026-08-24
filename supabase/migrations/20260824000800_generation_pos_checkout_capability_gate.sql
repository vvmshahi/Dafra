-- Generation POS gate hotfix.
--
-- Generation is a local fiscal regime. It must not inherit the Production
-- ZATCA credential, capability-acknowledgement, chain, ICV, or PIH gates that
-- belong to Integration. The resolver remains the server authority: it
-- selects the Generation route only for a valid, active Generation branch and
-- still requires the established seller identity contract.

BEGIN;

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
  v_branch record;
  v_customer record;
  v_buyer_preflight jsonb;
  v_document_type text;
  v_classification_reason text;
  v_generation_missing text[] := ARRAY[]::text[];
  v_tenant_id uuid;
  v_sandbox_operational boolean := false;
BEGIN
  IF p_actor_user_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.user_profiles p
       JOIN public.branches b ON b.id = p_branch_id
       WHERE p.id = p_actor_user_id
         AND p.is_active = true
         AND p.role = 'branch'
         AND p.tenant_id = b.tenant_id
         AND p.branch_id = b.id
     ) THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'CHECKOUT_BRANCH_FORBIDDEN');
  END IF;

  SELECT
    b.id,
    b.tenant_id,
    b.fiscal_regime,
    b.fiscal_activation_state,
    b.fiscal_policy_revision,
    COALESCE(t.is_active, true) AS tenant_active,
    t.suspended_at,
    b.business_name,
    b.display_name,
    b.vat_number,
    b.name,
    b.city,
    b.street,
    b.building_number,
    b.postal_code,
    b.invoice_prefix
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id
    AND b.is_active IS TRUE;

  IF NOT FOUND
     OR v_branch.tenant_active IS NOT TRUE
     OR v_branch.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'blocked', 'code', 'CHECKOUT_BRANCH_NOT_ACTIVE');
  END IF;

  IF v_branch.fiscal_regime IS DISTINCT FROM 'generation'
       AND v_branch.fiscal_regime IS DISTINCT FROM 'integration'
     OR v_branch.fiscal_activation_state IS DISTINCT FROM 'generation_active'
       AND v_branch.fiscal_activation_state IS DISTINCT FROM 'integration_setup'
       AND v_branch.fiscal_activation_state IS DISTINCT FROM 'integration_active'
     OR (v_branch.fiscal_regime = 'generation'
         AND v_branch.fiscal_activation_state <> 'generation_active')
     OR (v_branch.fiscal_regime = 'integration'
         AND v_branch.fiscal_activation_state = 'generation_active') THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'FISCAL_POLICY_INVALID',
      'fiscalRegime', v_branch.fiscal_regime,
      'fiscalActivationState', v_branch.fiscal_activation_state
    );
  END IF;

  -- Generation never calls the Integration classifier. In particular, no
  -- Production credential, capability acknowledgement, readiness, chain,
  -- clearance, ICV, or PIH query is made on this route.
  IF v_branch.fiscal_regime = 'generation' THEN
    IF NULLIF(btrim(COALESCE(v_branch.business_name, v_branch.display_name, '')), '') IS NULL THEN
      v_generation_missing := array_append(v_generation_missing, 'legalName');
    END IF;
    IF v_branch.vat_number IS NULL OR btrim(v_branch.vat_number) !~ '^[0-9]{15}$' THEN
      v_generation_missing := array_append(v_generation_missing, 'vatNumber');
    END IF;
    IF NULLIF(btrim(COALESCE(v_branch.name, '')), '') IS NULL THEN
      v_generation_missing := array_append(v_generation_missing, 'branchName');
    END IF;
    IF NULLIF(btrim(COALESCE(v_branch.city, '')), '') IS NULL THEN
      v_generation_missing := array_append(v_generation_missing, 'city');
    END IF;
    IF NULLIF(btrim(COALESCE(v_branch.street, '')), '') IS NULL THEN
      v_generation_missing := array_append(v_generation_missing, 'street');
    END IF;
    IF NULLIF(btrim(COALESCE(v_branch.building_number, '')), '') IS NULL THEN
      v_generation_missing := array_append(v_generation_missing, 'buildingNumber');
    END IF;
    IF NULLIF(btrim(COALESCE(v_branch.postal_code, '')), '') IS NULL THEN
      v_generation_missing := array_append(v_generation_missing, 'postalCode');
    END IF;
    IF NULLIF(btrim(COALESCE(v_branch.invoice_prefix, '')), '') IS NULL THEN
      v_generation_missing := array_append(v_generation_missing, 'invoicePrefix');
    END IF;

    IF cardinality(v_generation_missing) > 0 THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'code', 'GENERATION_SELLER_IDENTITY_REQUIRED',
        'fiscalRegime', 'generation',
        'fiscalActivationState', v_branch.fiscal_activation_state,
        'fiscalPolicyRevision', v_branch.fiscal_policy_revision,
        'missingFields', to_jsonb(v_generation_missing)
      );
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

    IF v_document_type = 'standard' THEN
      v_buyer_preflight := public.validate_standard_buyer_identity_internal_v1(
        v_branch.tenant_id, v_branch.id, p_customer_id
      );
      IF COALESCE((v_buyer_preflight->>'eligible')::boolean, false) IS NOT TRUE THEN
        RETURN jsonb_build_object(
          'status', 'blocked',
          'code', COALESCE(v_buyer_preflight->>'code', 'STANDARD_BUYER_IDENTITY_REQUIRED'),
          'documentType', 'standard',
          'classificationReason', v_classification_reason,
          'missingFields', COALESCE(v_buyer_preflight->'missingFields', '[]'::jsonb),
          'invalidFields', COALESCE(v_buyer_preflight->'invalidFields', '[]'::jsonb),
          'fiscalRegime', 'generation',
          'fiscalActivationState', v_branch.fiscal_activation_state,
          'fiscalPolicyRevision', v_branch.fiscal_policy_revision
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'status', 'allowed',
      'documentType', v_document_type,
      'checkoutPath', 'generation',
      'capability', NULL,
      'classificationReason', v_classification_reason,
      'atomicEligible', false,
      'atomicEligibilityReason', 'generation_uses_fiscal_finalizer',
      'readinessStatus', 'generation_ready',
      'readinessReason', 'generation_active',
      'productionConnected', false,
      'isDemo', false,
      'nonFiscal', false,
      'fiscalRegime', 'generation',
      'fiscalActivationState', v_branch.fiscal_activation_state,
      'fiscalPolicyRevision', v_branch.fiscal_policy_revision
    );
  END IF;

  -- Integration and Sandbox retain the existing classifier and all of its
  -- capability/readiness/credential protections.
  v_decision := public.resolve_pos_checkout_document_internal_base_20260803(
    p_actor_user_id, p_branch_id, p_customer_id
  );

  IF v_decision->>'status' = 'allowed'
     AND v_decision->>'documentType' = 'standard' THEN
    SELECT b.tenant_id INTO v_tenant_id FROM public.branches b WHERE b.id = p_branch_id;
    v_buyer_preflight := public.validate_standard_buyer_identity_internal_v1(
      v_tenant_id, p_branch_id, p_customer_id
    );
    IF COALESCE((v_buyer_preflight->>'eligible')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'code', COALESCE(v_buyer_preflight->>'code', 'STANDARD_BUYER_IDENTITY_REQUIRED'),
        'documentType', 'standard',
        'classificationReason', v_decision->>'classificationReason',
        'missingFields', COALESCE(v_buyer_preflight->'missingFields', '[]'::jsonb),
        'invalidFields', COALESCE(v_buyer_preflight->'invalidFields', '[]'::jsonb)
      );
    END IF;
  END IF;

  IF v_decision->>'status' IS DISTINCT FROM 'allowed'
     OR v_decision->>'checkoutPath' IS DISTINCT FROM 'demo' THEN
    RETURN v_decision || jsonb_build_object('demoMode', 'not_demo');
  END IF;

  SELECT b.tenant_id INTO v_tenant_id FROM public.branches b WHERE b.id = p_branch_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    JOIN public.branches b ON b.tenant_id = t.id
    JOIN public.zatca_sandbox_credentials c
      ON c.tenant_id = t.id AND c.branch_id = b.id
    WHERE t.id = v_tenant_id
      AND b.id = p_branch_id
      AND t.is_demo IS TRUE
      AND t.is_active IS TRUE
      AND t.suspended_at IS NULL
      AND b.is_active IS TRUE
      AND b.zatca_environment = 'sandbox'
      AND c.environment = 'sandbox'
      AND c.status = 'active'
      AND c.onboarding_status = 'active'
      AND c.functionality_map = '1100'
      AND NULLIF(c.encrypted_private_key, '') IS NOT NULL
      AND NULLIF(c.compliance_request_id, '') IS NOT NULL
      AND NULLIF(c.encrypted_compliance_csid, '') IS NOT NULL
      AND NULLIF(c.encrypted_compliance_secret, '') IS NOT NULL
      AND NULLIF(c.encrypted_production_csid, '') IS NOT NULL
      AND NULLIF(c.encrypted_production_secret, '') IS NOT NULL
      AND NULLIF(c.certificate, '') IS NOT NULL
      AND c.reconciliation_status IS DISTINCT FROM 'required'
      AND c.onboarding_operation IS NULL
      AND (c.expires_at IS NULL OR c.expires_at > now())
      AND (
        SELECT count(DISTINCT sample.value->>'type')
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(c.compliance_sample_results) = 'array'
            THEN c.compliance_sample_results ELSE '[]'::jsonb END
        ) AS sample(value)
        WHERE sample.value->>'status' = 'accepted'
          AND sample.value->>'type' IN (
            'simplified_invoice', 'simplified_credit_note', 'simplified_debit_note',
            'standard_invoice', 'standard_credit_note', 'standard_debit_note'
          )
      ) = 6
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(c.compliance_sample_results) = 'array'
            THEN c.compliance_sample_results ELSE '[]'::jsonb END
        ) AS sample(value)
        WHERE sample.value->>'status' = 'accepted'
          AND sample.value->>'type' NOT IN (
            'simplified_invoice', 'simplified_credit_note', 'simplified_debit_note',
            'standard_invoice', 'standard_credit_note', 'standard_debit_note'
          )
      )
  ) INTO v_sandbox_operational;

  IF v_sandbox_operational THEN
    RETURN v_decision || jsonb_build_object(
      'checkoutPath', 'sandbox',
      'capability', '1100',
      'atomicEligible', false,
      'atomicEligibilityReason', 'sandbox_sequential_submission',
      'readinessStatus', 'sandbox_operational_connected',
      'readinessReason', 'sandbox_requirements_satisfied',
      'productionConnected', false,
      'isDemo', false,
      'nonFiscal', false,
      'demoMode', 'not_demo'
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

COMMENT ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid) IS
  'Server-authoritative POS classifier: Generation uses the local fiscal finalizer; Integration/Sandbox retain ZATCA capability gates.';

COMMIT;
