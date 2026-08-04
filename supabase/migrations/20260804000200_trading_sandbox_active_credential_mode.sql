-- Allow the fully onboarded Trading Sandbox credential to become the
-- server-derived Demo mode without changing Service Demo or business rows.
-- Compliance-only credentials retain the existing sandbox_compliance path;
-- active credentials require the complete Sandbox Production material.

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

  IF EXISTS (
    SELECT 1
    FROM public.zatca_sandbox_credentials c
    WHERE c.tenant_id = p_tenant_id
      AND c.branch_id = p_branch_id
      AND c.environment = 'sandbox'
      AND (
        (
          c.status = 'compliance'
          AND c.compliance_demo_status = 'active'
          AND c.last_successful_onboarding_status = 'compliance_passed'
          AND NULLIF(c.encrypted_private_key, '') IS NOT NULL
          AND NULLIF(c.encrypted_compliance_csid, '') IS NOT NULL
          AND NULLIF(c.encrypted_compliance_secret, '') IS NOT NULL
        )
        OR (
          c.status = 'active'
          AND c.last_successful_onboarding_status = 'active'
          AND NULLIF(c.encrypted_private_key, '') IS NOT NULL
          AND NULLIF(c.encrypted_production_csid, '') IS NOT NULL
          AND NULLIF(c.encrypted_production_secret, '') IS NOT NULL
        )
      )
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

COMMIT;
