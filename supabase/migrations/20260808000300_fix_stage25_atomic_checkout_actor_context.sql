-- P0: the private service-only classifier receives the already-verified Edge
-- actor explicitly. Do not compare that actor to the service-role auth.uid().
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
  v_demo_mode text;
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
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'CHECKOUT_BRANCH_FORBIDDEN'
    );
  END IF;

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
COMMIT;
