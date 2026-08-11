BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';
-- This is intentionally a narrow mobile read surface. The barcode table keeps
-- its service-role-only raw SELECT policy; all caller and scope checks happen
-- before the security-definer query can return a row.
CREATE OR REPLACE FUNCTION public.list_product_barcodes_v1(
  p_product_id uuid
)
RETURNS TABLE (
  id uuid,
  barcode text,
  product_id uuid,
  product_unit_id uuid,
  product_unit_name text,
  product_unit_name_ar text,
  product_unit_code text,
  product_unit_version integer,
  is_primary boolean,
  is_active boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor public.user_profiles%ROWTYPE;
  v_product record;
BEGIN
  IF auth.uid() IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and product are required'
      USING ERRCODE = '42501';
  END IF;

  -- This read surface is deliberately narrower than the established web
  -- mutation and scanner contracts: only an active exact `branch` actor may
  -- read the active tenant and assigned branch's catalogue product.
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
    p.id,
    p.tenant_id,
    p.branch_id
    INTO v_product
  FROM public.products p
  JOIN public.branches br
    ON br.id = p.branch_id
   AND br.tenant_id = p.tenant_id
   AND br.is_active IS TRUE
  JOIN public.tenants t
    ON t.id = p.tenant_id
   AND t.is_active IS TRUE
  WHERE p.id = p_product_id
    AND p.is_active IS TRUE;

  IF NOT FOUND
     OR v_actor.tenant_id IS DISTINCT FROM v_product.tenant_id
     OR v_actor.branch_id IS DISTINCT FROM v_product.branch_id
  THEN
    RAISE EXCEPTION 'Branch catalogue access denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.barcode,
    b.product_id,
    b.product_unit_id,
    pu.name::text,
    pu.name_ar::text,
    pu.unit_code::text,
    pu.version,
    b.is_primary,
    b.is_active,
    b.created_at
  FROM public.product_unit_barcodes b
  JOIN public.product_units pu
    ON pu.id = b.product_unit_id
   AND pu.product_id = b.product_id
   AND pu.tenant_id = b.tenant_id
   AND pu.branch_id = b.branch_id
  WHERE b.product_id = v_product.id
    AND b.tenant_id = v_product.tenant_id
    AND b.branch_id = v_product.branch_id
  ORDER BY b.is_active DESC, b.is_primary DESC, b.created_at, b.id;
END;
$function$;
ALTER FUNCTION public.list_product_barcodes_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_product_barcodes_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_product_barcodes_v1(uuid)
  TO authenticated;
COMMIT;
