-- Phase 1: branch billing-profile foundation.
--
-- This migration is deliberately additive. Existing branches retain a NULL
-- business_profile and therefore keep their current tenant-business-type
-- behaviour until an owner/admin explicitly classifies them. No invoice,
-- product, tenant, stock, ZATCA, or checkout rows are rewritten here.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $required_branch_billing_profile_contracts$
BEGIN
  IF to_regclass('public.branches') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.invoice_items') IS NULL
     OR to_regclass('public.tenants') IS NULL
     OR to_regclass('public.user_profiles') IS NULL
     OR to_regprocedure('public.create_branch_for_tenant(jsonb)') IS NULL
  THEN
    RAISE EXCEPTION 'BRANCH_BILLING_PROFILE_REQUIRED_CONTRACT_MISSING';
  END IF;
END
$required_branch_billing_profile_contracts$;

-- NULL means "legacy/unclassified". It is intentional: no heuristic
-- classification or behaviour-changing backfill is performed for live
-- branches.
ALTER TABLE public.branches
  ADD COLUMN business_profile text,
  ADD COLUMN products_enabled boolean,
  ADD COLUMN services_enabled boolean,
  ADD COLUMN custom_lines_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.branches
  ADD CONSTRAINT branches_business_profile_check
  CHECK (
    business_profile IS NULL
    OR business_profile IN ('retail_trading', 'food_beverage', 'services')
  ) NOT VALID;

COMMENT ON COLUMN public.branches.business_profile IS
  'Branch-scoped operational profile. NULL preserves legacy tenant business-type behavior until explicitly configured.';
COMMENT ON COLUMN public.branches.products_enabled IS
  'Branch product capability. NULL is legacy/unconfigured and has no behaviour-changing effect until a business profile is selected.';
COMMENT ON COLUMN public.branches.services_enabled IS
  'Branch saved-service capability. NULL is legacy/unconfigured and has no behaviour-changing effect until a business profile is selected.';
COMMENT ON COLUMN public.branches.custom_lines_enabled IS
  'Branch custom billing-line capability. Reserved for a later checkout phase; defaults false and is not tied to a business profile.';

-- Branch rows intentionally use column-level authenticated grants. Revoke the
-- new capability columns explicitly so an owner/admin must use the narrow RPC
-- below and branch users cannot self-elevate even if broader table grants are
-- introduced later.
REVOKE INSERT (business_profile, products_enabled, services_enabled, custom_lines_enabled),
       UPDATE (business_profile, products_enabled, services_enabled, custom_lines_enabled)
ON TABLE public.branches
FROM anon, authenticated;

-- The default makes all historical rows logically legacy without rewriting
-- invoices. Future catalogue/custom checkout work will write explicit values.
ALTER TABLE public.invoice_items
  ADD COLUMN line_source text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_line_source_check
  CHECK (line_source IN ('legacy', 'catalogue', 'custom')) NOT VALID;

COMMENT ON COLUMN public.invoice_items.line_source IS
  'Immutable invoice-line provenance. Existing rows retain the non-destructive legacy default; future checkout phases will write catalogue or custom.';

REVOKE INSERT (line_source), UPDATE (line_source)
ON TABLE public.invoice_items
FROM anon, authenticated;

-- NOT VALID is intentional. It enforces every new insert/update immediately
-- while allowing unknown historical data to remain readable and be audited
-- before any separately approved cleanup. It also prevents a tracked product
-- from being converted into a saved service by the secure product RPC.
ALTER TABLE public.products
  ADD CONSTRAINT products_service_cannot_track_stock_check
  CHECK (NOT COALESCE(is_service, false) OR NOT COALESCE(track_stock, false)) NOT VALID;

COMMENT ON CONSTRAINT products_service_cannot_track_stock_check ON public.products IS
  'Phase 1 invariant: saved services can never track stock. Existing rows are not rewritten by this NOT VALID constraint.';

-- One shared set of profile defaults. These are applied only to explicitly
-- classified branches; they never reinterpret tenants.business_type.
CREATE OR REPLACE FUNCTION public.branch_billing_profile_defaults(
  p_business_profile text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $function$
BEGIN
  CASE p_business_profile
    WHEN 'retail_trading' THEN
      RETURN jsonb_build_object(
        'products_enabled', true,
        'services_enabled', false,
        'custom_lines_enabled', false,
        'stock_enabled', true,
        'pos_mode', 'quick'
      );
    WHEN 'food_beverage' THEN
      RETURN jsonb_build_object(
        'products_enabled', true,
        'services_enabled', false,
        'custom_lines_enabled', false,
        'stock_enabled', true,
        'pos_mode', 'touch'
      );
    WHEN 'services' THEN
      RETURN jsonb_build_object(
        'products_enabled', false,
        'services_enabled', true,
        'custom_lines_enabled', false,
        'stock_enabled', false,
        'pos_mode', 'touch'
      );
    ELSE
      RAISE EXCEPTION 'BRANCH_BILLING_PROFILE_INVALID' USING ERRCODE = '22023';
  END CASE;
END
$function$;

ALTER FUNCTION public.branch_billing_profile_defaults(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.branch_billing_profile_defaults(text) FROM PUBLIC, anon, authenticated;

-- This is the only configuration read contract Phase 2 UI/POS work should
-- consume. For legacy branches it deliberately reproduces the existing
-- tenant-service stock/Touch interpretation. For a classified branch, branch
-- fields plus profile defaults are authoritative.
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
      'custom_lines_enabled', false
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
  'Authoritative branch billing configuration. NULL business_profile uses legacy tenant behaviour; explicit profiles use branch fields and profile defaults.';

-- Capability writes are intentionally separate from general Branch editing.
-- Owners/admins can configure a tenant branch; a Branch user can read its own
-- effective config but can never elevate any capability.
CREATE OR REPLACE FUNCTION public.update_branch_billing_profile_config(
  p_branch_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor record;
  v_branch record;
  v_business_profile text;
  v_products_enabled boolean;
  v_services_enabled boolean;
  v_custom_lines_enabled boolean;
  v_defaults jsonb;
  v_updated_at timestamptz := clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_BRANCH_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_payload) AS key_name
    WHERE key_name NOT IN (
      'business_profile',
      'products_enabled',
      'services_enabled',
      'custom_lines_enabled'
    )
  ) THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_KEY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT (p_payload ? 'business_profile')
     AND NOT (p_payload ? 'products_enabled')
     AND NOT (p_payload ? 'services_enabled')
     AND NOT (p_payload ? 'custom_lines_enabled') THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_EMPTY' USING ERRCODE = '22023';
  END IF;

  IF (p_payload ? 'business_profile')
     AND jsonb_typeof(p_payload -> 'business_profile') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'BRANCH_BILLING_PROFILE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (p_payload ? 'business_profile')
     AND jsonb_typeof(p_payload -> 'business_profile') = 'string'
     AND p_payload ->> 'business_profile' NOT IN (
       'retail_trading', 'food_beverage', 'services'
     ) THEN
    RAISE EXCEPTION 'BRANCH_BILLING_PROFILE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['products_enabled', 'services_enabled', 'custom_lines_enabled']) AS key_name
    WHERE p_payload ? key_name
      AND jsonb_typeof(p_payload -> key_name) <> 'boolean'
  ) THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_CAPABILITY_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT id, tenant_id, role::text AS role, is_active
  INTO v_actor
  FROM public.user_profiles
  WHERE id = v_user_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE
     OR v_actor.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT
    id,
    tenant_id,
    branch_code,
    business_profile,
    products_enabled,
    services_enabled,
    custom_lines_enabled,
    is_active
  INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id
  FOR UPDATE;
  IF NOT FOUND OR v_branch.is_active IS NOT TRUE
     OR v_actor.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_business_profile := CASE
    WHEN p_payload ? 'business_profile' THEN NULLIF(btrim(p_payload ->> 'business_profile'), '')
    ELSE v_branch.business_profile
  END;
  IF v_business_profile IS NOT NULL
     AND v_business_profile NOT IN ('retail_trading', 'food_beverage', 'services') THEN
    RAISE EXCEPTION 'BRANCH_BILLING_PROFILE_INVALID' USING ERRCODE = '22023';
  END IF;

  v_products_enabled := CASE
    WHEN p_payload ? 'products_enabled' THEN (p_payload ->> 'products_enabled')::boolean
    ELSE v_branch.products_enabled
  END;
  v_services_enabled := CASE
    WHEN p_payload ? 'services_enabled' THEN (p_payload ->> 'services_enabled')::boolean
    ELSE v_branch.services_enabled
  END;
  v_custom_lines_enabled := CASE
    WHEN p_payload ? 'custom_lines_enabled' THEN (p_payload ->> 'custom_lines_enabled')::boolean
    ELSE COALESCE(v_branch.custom_lines_enabled, false)
  END;

  -- Selecting a profile fills only unset legacy capability fields. It never
  -- overwrites an explicit owner/admin choice, and Products + Services remains
  -- a valid combination.
  IF v_business_profile IS NOT NULL THEN
    v_defaults := public.branch_billing_profile_defaults(v_business_profile);
    v_products_enabled := COALESCE(
      v_products_enabled,
      (v_defaults ->> 'products_enabled')::boolean
    );
    v_services_enabled := COALESCE(
      v_services_enabled,
      (v_defaults ->> 'services_enabled')::boolean
    );
  END IF;

  UPDATE public.branches
  SET business_profile = v_business_profile,
      products_enabled = v_products_enabled,
      services_enabled = v_services_enabled,
      custom_lines_enabled = v_custom_lines_enabled,
      updated_at = v_updated_at
  WHERE id = v_branch.id;

  IF to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_billing_profile_config_updated',
      v_branch.tenant_id,
      v_branch.id,
      v_user_id,
      v_actor.role,
      'branch',
      v_branch.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'branch_code', v_branch.branch_code,
        'business_profile_before', v_branch.business_profile,
        'business_profile_after', v_business_profile,
        'products_enabled_before', v_branch.products_enabled,
        'products_enabled_after', v_products_enabled,
        'services_enabled_before', v_branch.services_enabled,
        'services_enabled_after', v_services_enabled,
        'custom_lines_enabled_before', v_branch.custom_lines_enabled,
        'custom_lines_enabled_after', v_custom_lines_enabled
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN public.get_effective_branch_billing_config(v_branch.id);
END
$function$;

ALTER FUNCTION public.update_branch_billing_profile_config(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.update_branch_billing_profile_config(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_branch_billing_profile_config(uuid, jsonb) TO authenticated;
COMMENT ON FUNCTION public.update_branch_billing_profile_config(uuid, jsonb) IS
  'Owner/admin-only branch billing profile and capability updates. Profile defaults are applied only to unset values; custom-line access remains profile-agnostic.';

-- Preserve the existing RPC signature and authorization semantics. New keys
-- are optional, so all existing branch-creation callers remain compatible.
CREATE OR REPLACE FUNCTION public.create_branch_for_tenant(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile record;
  v_tenant record;
  v_usage record;
  v_branch public.branches%ROWTYPE;
  v_name text;
  v_country text;
  v_vat_mode text;
  v_invoice_language text;
  v_zatca_phase integer;
  v_is_active boolean;
  v_show_logo boolean;
  v_is_main_branch boolean;
  v_business_profile text;
  v_products_enabled boolean;
  v_services_enabled boolean;
  v_custom_lines_enabled boolean := false;
  v_pos_mode text;
  v_billing_defaults jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid branch payload' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::text AS role, tenant_id, is_active
  INTO v_profile
  FROM public.user_profiles
  WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE OR v_profile.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;
  IF v_profile.role <> 'owner' THEN
    RAISE EXCEPTION 'Only tenant owners can create branches' USING ERRCODE = '42501';
  END IF;

  SELECT t.id, COALESCE(t.is_active, true) AS is_active, t.suspended_at
  INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_profile.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found' USING ERRCODE = '42501';
  END IF;
  IF v_tenant.is_active IS NOT TRUE OR v_tenant.suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'This account is suspended. New branches cannot be created.'
      USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_payload ->> 'name', '')), '');
  v_country := upper(COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'country', '')), ''), 'SA'));
  v_vat_mode := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'vat_mode', '')), ''), 'exclusive');
  v_invoice_language := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'invoice_language', '')), ''), 'both');
  v_zatca_phase := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'zatca_phase', '')), '')::integer, 1);
  v_is_active := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'is_active', '')), '')::boolean, true);
  v_show_logo := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'show_logo', '')), '')::boolean, true);
  v_is_main_branch := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'is_main_branch', '')), '')::boolean, false);

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Branch name is required' USING ERRCODE = '22023';
  END IF;
  IF length(v_country) <> 2 THEN
    RAISE EXCEPTION 'Branch country must be a two-letter code' USING ERRCODE = '22023';
  END IF;
  IF v_vat_mode NOT IN ('exclusive', 'inclusive') THEN
    RAISE EXCEPTION 'Unsupported VAT mode' USING ERRCODE = '22023';
  END IF;
  IF v_invoice_language NOT IN ('en', 'ar', 'both') THEN
    RAISE EXCEPTION 'Unsupported invoice language' USING ERRCODE = '22023';
  END IF;
  IF v_zatca_phase NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Unsupported ZATCA phase' USING ERRCODE = '22023';
  END IF;

  IF (p_payload ? 'business_profile')
     AND jsonb_typeof(p_payload -> 'business_profile') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'BRANCH_BILLING_PROFILE_INVALID' USING ERRCODE = '22023';
  END IF;
  v_business_profile := CASE
    WHEN p_payload ? 'business_profile' THEN NULLIF(btrim(p_payload ->> 'business_profile'), '')
    ELSE NULL
  END;
  IF v_business_profile IS NOT NULL
     AND v_business_profile NOT IN ('retail_trading', 'food_beverage', 'services') THEN
    RAISE EXCEPTION 'BRANCH_BILLING_PROFILE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['products_enabled', 'services_enabled', 'custom_lines_enabled']) AS key_name
    WHERE p_payload ? key_name
      AND jsonb_typeof(p_payload -> key_name) <> 'boolean'
  ) THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_CAPABILITY_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (p_payload ? 'pos_mode') AND (
    jsonb_typeof(p_payload -> 'pos_mode') <> 'string'
    OR p_payload ->> 'pos_mode' NOT IN ('touch', 'quick')
  ) THEN
    RAISE EXCEPTION 'BRANCH_BILLING_CONFIG_POS_MODE_INVALID' USING ERRCODE = '22023';
  END IF;

  v_products_enabled := CASE
    WHEN p_payload ? 'products_enabled' THEN (p_payload ->> 'products_enabled')::boolean
    ELSE NULL
  END;
  v_services_enabled := CASE
    WHEN p_payload ? 'services_enabled' THEN (p_payload ->> 'services_enabled')::boolean
    ELSE NULL
  END;
  v_custom_lines_enabled := CASE
    WHEN p_payload ? 'custom_lines_enabled' THEN (p_payload ->> 'custom_lines_enabled')::boolean
    ELSE false
  END;
  IF v_business_profile IS NOT NULL THEN
    v_billing_defaults := public.branch_billing_profile_defaults(v_business_profile);
    v_products_enabled := COALESCE(v_products_enabled, (v_billing_defaults ->> 'products_enabled')::boolean);
    v_services_enabled := COALESCE(v_services_enabled, (v_billing_defaults ->> 'services_enabled')::boolean);
    v_pos_mode := COALESCE(
      NULLIF(btrim(COALESCE(p_payload ->> 'pos_mode', '')), ''),
      v_billing_defaults ->> 'pos_mode'
    );
  ELSE
    v_pos_mode := COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'pos_mode', '')), ''), 'touch');
  END IF;

  SELECT * INTO v_usage
  FROM public.get_tenant_branch_usage(v_profile.tenant_id)
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant branch usage not found' USING ERRCODE = '42501';
  END IF;
  IF v_is_active IS TRUE AND v_usage.can_create_branch IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch limit reached. Please contact Kubri support to add more branches.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.branches (
    tenant_id, name, name_ar, business_name, business_name_ar, vat_number,
    cr_number, building_number, street, district, city, country, postal_code,
    phone, email, website, vat_mode, invoice_prefix, receipt_footer,
    show_logo, invoice_language, zatca_phase, is_active, is_main_branch,
    invoice_counter, business_profile, products_enabled, services_enabled,
    custom_lines_enabled, pos_mode
  ) VALUES (
    v_profile.tenant_id,
    v_name,
    NULLIF(btrim(COALESCE(p_payload ->> 'name_ar', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'business_name', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'business_name_ar', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'vat_number', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'cr_number', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'building_number', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'street', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'district', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'city', '')), ''),
    v_country,
    NULLIF(btrim(COALESCE(p_payload ->> 'postal_code', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'phone', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'email', '')), ''),
    NULLIF(btrim(COALESCE(p_payload ->> 'website', '')), ''),
    v_vat_mode,
    COALESCE(NULLIF(btrim(COALESCE(p_payload ->> 'invoice_prefix', '')), ''), 'INV'),
    NULLIF(btrim(COALESCE(p_payload ->> 'receipt_footer', '')), ''),
    v_show_logo,
    v_invoice_language,
    v_zatca_phase,
    v_is_active,
    v_is_main_branch,
    0,
    v_business_profile,
    v_products_enabled,
    v_services_enabled,
    v_custom_lines_enabled,
    v_pos_mode
  )
  RETURNING * INTO v_branch;

  RETURN to_jsonb(v_branch);
END
$function$;

ALTER FUNCTION public.create_branch_for_tenant(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_branch_for_tenant(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_branch_for_tenant(jsonb) TO authenticated;
COMMENT ON FUNCTION public.create_branch_for_tenant(jsonb) IS
  'Creates a branch using the legacy-compatible payload plus optional Phase 1 billing profile/capability fields. Existing callers remain valid.';

NOTIFY pgrst, 'reload schema';

COMMIT;
