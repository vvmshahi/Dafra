-- Sandbox profile 1100 is the fiscal capability for both Simplified Reporting
-- and Standard Clearance. This is a function-only correction: it does not
-- alter tenant, branch, credential, invoice, reservation, or chain data.
--
-- The former wrapper treated a legacy `compliance_demo_status` marker as the
-- authority and rejected every Standard document. Current Sandbox onboarding
-- instead establishes an operational 1100 credential only after all six
-- sample types (including the three Standard clearance samples) are accepted.

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
  v_tenant_id uuid;
  v_buyer_preflight jsonb;
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

  v_decision := public.resolve_pos_checkout_document_internal_base_20260803(
    p_actor_user_id, p_branch_id, p_customer_id
  );

  -- Classification is unchanged. Standard checkout still requires the
  -- authoritative persisted buyer identity before any route can be selected.
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

  SELECT b.tenant_id INTO v_tenant_id
  FROM public.branches b
  WHERE b.id = p_branch_id;

  -- This is intentionally the same operational-state contract used by the
  -- Sandbox submitter: a complete, unreconciled 1100 credential with the six
  -- accepted Kubri samples. Profile 0100 cannot reach this fiscal route.
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    JOIN public.branches b
      ON b.tenant_id = t.id
    JOIN public.zatca_sandbox_credentials c
      ON c.tenant_id = t.id
     AND c.branch_id = b.id
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
          CASE
            WHEN jsonb_typeof(c.compliance_sample_results) = 'array'
              THEN c.compliance_sample_results
            ELSE '[]'::jsonb
          END
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
          CASE
            WHEN jsonb_typeof(c.compliance_sample_results) = 'array'
              THEN c.compliance_sample_results
            ELSE '[]'::jsonb
          END
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

  -- Inactive, unresolved, incomplete, expired, or non-1100 Sandbox state
  -- retains the existing non-fiscal Demo boundary. It cannot enter either
  -- Sandbox Reporting or Sandbox Clearance.
  RETURN v_decision || jsonb_build_object('demoMode', 'non_fiscal');
END
$function$;

ALTER FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  TO service_role;

COMMIT;
