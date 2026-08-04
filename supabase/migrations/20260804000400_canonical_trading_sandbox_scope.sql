-- Canonical, server-authoritative scope contract for the permanent Trading
-- Sandbox demo. No browser-supplied tenant or branch value is accepted.
BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_zatca_trading_sandbox_scope()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_tenant record;
  v_branch record;
BEGIN
  SELECT id, name, business_type, is_demo, is_active
  INTO v_tenant
  FROM public.tenants
  WHERE id = 'ebf1144b-55ed-472a-99c9-23b5ee915351'::uuid
    AND is_demo IS TRUE
    AND is_active IS TRUE
    AND suspended_at IS NULL;

  SELECT id, tenant_id, name, business_name, vat_number, cr_number,
         building_number, street, district, city, postal_code, country,
         zatca_phase, zatca_environment, is_active
  INTO v_branch
  FROM public.branches
  WHERE id = '14271653-b404-44bf-9f39-7e9927569c02'::uuid
    AND tenant_id = 'ebf1144b-55ed-472a-99c9-23b5ee915351'::uuid
    AND zatca_environment = 'sandbox'
    AND is_active IS TRUE;

  IF NOT FOUND OR v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'Trading Sandbox scope is not eligible'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'name', v_tenant.name,
      'business_type', v_tenant.business_type,
      'is_demo', v_tenant.is_demo,
      'is_active', v_tenant.is_active
    ),
    'branch', jsonb_build_object(
      'id', v_branch.id,
      'tenant_id', v_branch.tenant_id,
      'name', v_branch.name,
      'business_name', v_branch.business_name,
      'vat_number', v_branch.vat_number,
      'cr_number', v_branch.cr_number,
      'building_number', v_branch.building_number,
      'street', v_branch.street,
      'district', v_branch.district,
      'city', v_branch.city,
      'postal_code', v_branch.postal_code,
      'country', v_branch.country,
      'zatca_phase', v_branch.zatca_phase,
      'zatca_environment', v_branch.zatca_environment,
      'is_active', v_branch.is_active
    )
  );
END;
$function$;

ALTER FUNCTION public.resolve_zatca_trading_sandbox_scope() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_zatca_trading_sandbox_scope()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_zatca_trading_sandbox_scope()
  TO service_role;

COMMIT;
