-- Preserve explicitly persisted Custom Line capability for legacy branches.
-- Legacy profile defaults still govern products/services/stock/POS mode, but
-- Custom Line is an independent owner/admin capability and must not be
-- discarded by the effective read contract.

CREATE OR REPLACE FUNCTION public.get_effective_branch_billing_config(
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor record;
  v_branch record;
  v_defaults jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_BRANCH_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT id, tenant_id, branch_id, role::text AS role, is_active
  INTO v_actor
  FROM public.user_profiles
  WHERE id = v_user_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT
    b.id,
    b.tenant_id,
    b.business_profile,
    b.products_enabled,
    b.services_enabled,
    b.custom_lines_enabled,
    b.stock_enabled,
    b.pos_mode,
    COALESCE(t.business_type, 'trading') AS legacy_business_type
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_actor.role IN ('owner', 'admin') THEN
    IF v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSIF v_actor.role = 'branch' THEN
    IF v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_actor.branch_id IS DISTINCT FROM v_branch.id THEN
      RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_branch.business_profile IS NULL THEN
    RETURN jsonb_build_object(
      'branch_id', v_branch.id,
      'business_profile', NULL,
      'legacy_profile', true,
      'products_enabled', true,
      'services_enabled', false,
      'stock_enabled', (
        v_branch.legacy_business_type <> 'service'
        AND COALESCE(v_branch.stock_enabled, true)
      ),
      'pos_mode', CASE
        WHEN v_branch.legacy_business_type = 'service' THEN 'touch'
        ELSE COALESCE(v_branch.pos_mode, 'touch')
      END,
      'custom_lines_enabled', COALESCE(v_branch.custom_lines_enabled, false)
    );
  END IF;

  v_defaults := public.branch_billing_profile_defaults(v_branch.business_profile);
  RETURN jsonb_build_object(
    'branch_id', v_branch.id,
    'business_profile', v_branch.business_profile,
    'legacy_profile', false,
    'products_enabled', COALESCE(
      v_branch.products_enabled,
      (v_defaults ->> 'products_enabled')::boolean
    ),
    'services_enabled', COALESCE(
      v_branch.services_enabled,
      (v_defaults ->> 'services_enabled')::boolean
    ),
    'stock_enabled', COALESCE(
      v_branch.stock_enabled,
      (v_defaults ->> 'stock_enabled')::boolean
    ),
    'pos_mode', COALESCE(v_branch.pos_mode, v_defaults ->> 'pos_mode'),
    'custom_lines_enabled', COALESCE(v_branch.custom_lines_enabled, false)
  );
END
$function$;

ALTER FUNCTION public.get_effective_branch_billing_config(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_effective_branch_billing_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_effective_branch_billing_config(uuid) TO authenticated;
COMMENT ON FUNCTION public.get_effective_branch_billing_config(uuid) IS
  'Authoritative branch billing configuration. NULL business_profile uses legacy tenant defaults for core modules while preserving the independent Custom Line capability.';
