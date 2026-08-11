BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
-- POS needs an exact commercial-unit identity for an arbitrary scan.  The raw
-- barcode registry remains service-role-only; this deliberately narrow read
-- surface performs the actor and branch checks before using it.
CREATE OR REPLACE FUNCTION public.resolve_pos_barcode_v1(
  p_branch_id uuid,
  p_barcode text
)
RETURNS TABLE (
  product_id uuid,
  product_unit_id uuid,
  product_unit_version integer,
  product_name text,
  product_name_ar text,
  unit_name text,
  unit_name_ar text,
  unit_code text,
  conversion_to_base numeric,
  quantity_scale smallint,
  pricing_method text,
  resolved_selling_price numeric,
  is_base boolean,
  barcode_id uuid,
  barcode text,
  barcode_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor public.user_profiles%ROWTYPE;
  v_scope record;
  v_barcode text;
  v_match_count integer;
BEGIN
  IF auth.uid() IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch catalogue access denied'
      USING ERRCODE = '42501';
  END IF;

  -- This is the same narrow branch-operator posture as
  -- list_product_barcodes_v1: owner, admin, and service callers must use
  -- their established management surfaces, never this scanner lookup.
  SELECT up.*
    INTO v_actor
  FROM public.user_profiles up
  WHERE up.id = auth.uid()
    AND up.is_active IS TRUE
    AND up.role = 'branch';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch catalogue access denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    br.id,
    br.tenant_id
    INTO v_scope
  FROM public.branches br
  JOIN public.tenants t
    ON t.id = br.tenant_id
   AND t.is_active IS TRUE
  WHERE br.id = p_branch_id
    AND br.tenant_id = v_actor.tenant_id
    AND br.is_active IS TRUE;

  IF NOT FOUND
     OR v_actor.branch_id IS DISTINCT FROM v_scope.id
  THEN
    RAISE EXCEPTION 'Branch catalogue access denied'
      USING ERRCODE = '42501';
  END IF;

  v_barcode := public.normalize_product_barcode(p_barcode);
  IF NULLIF(v_barcode, '') IS NULL THEN
    RETURN;
  END IF;

  -- The active-registry unique index normally makes this count zero or one.
  -- Keep an explicit guard so corrupted or future unconstrained data can
  -- never be resolved arbitrarily to the wrong commercial unit.
  SELECT count(*)
    INTO v_match_count
  FROM public.product_unit_barcodes b
  JOIN public.products p
    ON p.id = b.product_id
   AND p.tenant_id = b.tenant_id
   AND p.branch_id = b.branch_id
  JOIN public.product_units pu
    ON pu.id = b.product_unit_id
   AND pu.product_id = b.product_id
   AND pu.tenant_id = b.tenant_id
   AND pu.branch_id = b.branch_id
  WHERE b.tenant_id = v_scope.tenant_id
    AND b.branch_id = v_scope.id
    AND b.normalized_barcode = v_barcode
    AND b.is_active IS TRUE
    AND b.disabled_at IS NULL
    AND p.is_active IS TRUE
    AND p.is_available IS TRUE
    AND pu.is_active IS TRUE
    AND pu.selling_enabled IS TRUE;

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'Ambiguous active barcode resolution'
      USING ERRCODE = '21000';
  END IF;

  IF v_match_count = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    pu.id,
    pu.version,
    p.name::text,
    p.name_ar::text,
    pu.name::text,
    pu.name_ar::text,
    pu.unit_code::text,
    pu.conversion_to_base,
    pu.quantity_scale,
    pu.pricing_method,
    CASE
      WHEN pu.pricing_method = 'custom' THEN pu.custom_selling_price
      ELSE round(COALESCE(p.price, 0) * pu.conversion_to_base, 2)
    END,
    pu.is_base,
    b.id,
    b.barcode,
    b.barcode_type
  FROM public.product_unit_barcodes b
  JOIN public.products p
    ON p.id = b.product_id
   AND p.tenant_id = b.tenant_id
   AND p.branch_id = b.branch_id
  JOIN public.product_units pu
    ON pu.id = b.product_unit_id
   AND pu.product_id = b.product_id
   AND pu.tenant_id = b.tenant_id
   AND pu.branch_id = b.branch_id
  WHERE b.tenant_id = v_scope.tenant_id
    AND b.branch_id = v_scope.id
    AND b.normalized_barcode = v_barcode
    AND b.is_active IS TRUE
    AND b.disabled_at IS NULL
    AND p.is_active IS TRUE
    AND p.is_available IS TRUE
    AND pu.is_active IS TRUE
    AND pu.selling_enabled IS TRUE;
END;
$function$;
ALTER FUNCTION public.resolve_pos_barcode_v1(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_pos_barcode_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_pos_barcode_v1(uuid, text)
  TO authenticated;
COMMENT ON FUNCTION public.resolve_pos_barcode_v1(uuid, text) IS
  'Authenticated branch-only POS barcode resolver. Returns one active sellable registry unit with authoritative catalogue pricing, no row for an ordinary miss, and never arbitrarily resolves an ambiguity.';
NOTIFY pgrst, 'reload schema';
COMMIT;
