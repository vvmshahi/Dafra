-- Stage 6E.A: authoritative Standard buyer preflight.
--
-- This migration creates no tables, changes no credentials, and performs no
-- business/fiscal DML. It preserves classification and checkout-path choices;
-- it only blocks a classified Standard intent before the commercial checkout
-- dispatcher can run when the authoritative buyer record is incomplete.

BEGIN;
CREATE OR REPLACE FUNCTION public.validate_standard_buyer_identity_internal_v1(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_customer record;
  v_missing text[] := ARRAY[]::text[];
  v_invalid text[] := ARRAY[]::text[];
  v_code text := NULL;
BEGIN
  SELECT c.business_name, c.company_name, c.vat_number, c.building_number,
         c.address, c.district, c.city, c.postal_code, c.country
  INTO v_customer
  FROM public.customers c
  WHERE c.id = p_customer_id
    AND c.tenant_id = p_tenant_id
    AND c.branch_id = p_branch_id
    AND c.is_active IS TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'code', 'CHECKOUT_CUSTOMER_NOT_AVAILABLE');
  END IF;

  IF NULLIF(btrim(COALESCE(v_customer.business_name, v_customer.company_name, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'legalName');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_LEGAL_NAME_REQUIRED');
  END IF;
  IF NULLIF(btrim(COALESCE(v_customer.vat_number, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'vatNumber');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_VAT_REQUIRED');
  ELSIF btrim(v_customer.vat_number) !~ '^3[0-9]{13}3$' THEN
    v_invalid := array_append(v_invalid, 'vatNumber');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_VAT_INVALID');
  END IF;
  IF NULLIF(btrim(COALESCE(v_customer.building_number, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'buildingNumber');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_BUILDING_NUMBER_REQUIRED');
  END IF;
  -- Customer.address is the established persisted street/address field.
  IF NULLIF(btrim(COALESCE(v_customer.address, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'address');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_STREET_REQUIRED');
  END IF;
  IF NULLIF(btrim(COALESCE(v_customer.district, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'district');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_DISTRICT_REQUIRED');
  END IF;
  IF NULLIF(btrim(COALESCE(v_customer.city, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'city');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_CITY_REQUIRED');
  END IF;
  IF NULLIF(btrim(COALESCE(v_customer.postal_code, '')), '') IS NULL THEN
    v_missing := array_append(v_missing, 'postalCode');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_POSTAL_CODE_REQUIRED');
  ELSIF btrim(v_customer.postal_code) !~ '^[0-9]{5}$' THEN
    v_invalid := array_append(v_invalid, 'postalCode');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_POSTAL_CODE_INVALID');
  END IF;
  IF NULLIF(btrim(COALESCE(v_customer.country, '')), '') IS NULL
     OR upper(btrim(v_customer.country)) <> 'SA' THEN
    v_missing := array_append(v_missing, 'country');
    v_code := COALESCE(v_code, 'STANDARD_BUYER_COUNTRY_REQUIRED');
  END IF;

  RETURN jsonb_build_object(
    'eligible', cardinality(v_missing) = 0 AND cardinality(v_invalid) = 0,
    'code', v_code,
    'missingFields', to_jsonb(v_missing),
    'invalidFields', to_jsonb(v_invalid)
  );
END
$function$;
ALTER FUNCTION public.validate_standard_buyer_identity_internal_v1(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.validate_standard_buyer_identity_internal_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_standard_buyer_identity_internal_v1(uuid, uuid, uuid)
  TO service_role;
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
  v_buyer_preflight jsonb;
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

  -- Classification is unchanged. Only an already-classified Standard intent is
  -- checked against authoritative persisted buyer identity before checkout.
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
  v_demo_mode := public.zatca_demo_checkout_mode_internal_v1(v_tenant_id, p_branch_id);
  IF v_demo_mode = 'sandbox_compliance' THEN
    IF v_decision->>'documentType' = 'standard' THEN
      RETURN jsonb_build_object('status', 'blocked', 'code', 'SANDBOX_STANDARD_CLEARANCE_UNAVAILABLE', 'demoMode', 'sandbox_compliance');
    END IF;
    RETURN v_decision || jsonb_build_object(
      'checkoutPath', 'sandbox', 'atomicEligible', false,
      'atomicEligibilityReason', 'sandbox_compliance_validation',
      'readinessStatus', 'sandbox_compliance_active',
      'readinessReason', 'sandbox_compliance_validation_only',
      'productionConnected', false, 'isDemo', false, 'nonFiscal', false,
      'demoMode', 'sandbox_compliance'
    );
  END IF;

  RETURN v_decision || jsonb_build_object('demoMode', 'non_fiscal');
END
$function$;
ALTER FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pos_checkout_document_internal_v1(uuid, uuid, uuid)
  TO service_role;
COMMIT;
