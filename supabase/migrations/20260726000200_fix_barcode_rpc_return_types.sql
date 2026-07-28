BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- create_product_unit_barcode and every other scoped barcode operation call
-- this private helper. user_profiles.role is public.user_role, while the
-- stable helper contract deliberately exposes actor_role as text.
CREATE OR REPLACE FUNCTION public.product_barcode_scope(
  p_product_unit_id uuid
)
RETURNS TABLE (
  user_id uuid,
  actor_role text,
  tenant_id uuid,
  branch_id uuid,
  product_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR p_product_unit_id IS NULL THEN
    RAISE EXCEPTION 'Authentication and product unit are required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    up.id,
    up.role::text,
    pu.tenant_id,
    pu.branch_id,
    pu.product_id
  FROM public.product_units pu
  JOIN public.products p
    ON p.id = pu.product_id
   AND p.tenant_id = pu.tenant_id
   AND p.branch_id = pu.branch_id
  JOIN public.user_profiles up ON up.id = v_user_id
  WHERE pu.id = p_product_unit_id
    AND p.is_active IS TRUE
    AND up.is_active IS TRUE
    AND (
      up.role = 'super_admin'
      OR (up.role = 'owner' AND up.tenant_id = pu.tenant_id)
      OR (
        up.role = 'branch'
        AND up.tenant_id = pu.tenant_id
        AND up.branch_id = pu.branch_id
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product unit not found or access denied'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

ALTER FUNCTION public.product_barcode_scope(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.product_barcode_scope(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Register the exact installed definition. The row is insert-only in this
-- release, so a later function drift cannot be silently blessed by rerunning
-- verification.
CREATE TABLE public.barcode_function_contracts_v1 (
  function_signature text PRIMARY KEY,
  definition_md5 text NOT NULL
    CHECK (definition_md5 ~ '^[a-f0-9]{32}$'),
  registered_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.barcode_function_contracts_v1 OWNER TO postgres;

COMMENT ON TABLE public.barcode_function_contracts_v1 IS
  'Immutable function-definition fingerprints for the barcode workflow release contract.';

REVOKE ALL ON TABLE public.barcode_function_contracts_v1
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.barcode_function_contracts_v1 TO service_role;

INSERT INTO public.barcode_function_contracts_v1 (
  function_signature,
  definition_md5
)
VALUES (
  'public.product_barcode_scope(uuid)',
  md5(pg_get_functiondef(
    'public.product_barcode_scope(uuid)'::regprocedure::oid
  ))
);

DO $assert_barcode_contract$
DECLARE
  v_contract record;
BEGIN
  FOR v_contract IN
    SELECT function_signature, definition_md5
    FROM public.barcode_function_contracts_v1
  LOOP
    IF to_regprocedure(v_contract.function_signature) IS NULL
       OR md5(pg_get_functiondef(
         to_regprocedure(v_contract.function_signature)::oid
       )) <> v_contract.definition_md5
    THEN
      RAISE EXCEPTION 'BARCODE_FUNCTION_CONTRACT_MISMATCH:%',
        v_contract.function_signature;
    END IF;
  END LOOP;
END;
$assert_barcode_contract$;

COMMIT;
