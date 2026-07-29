BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

CREATE OR REPLACE FUNCTION public.generate_internal_product_unit_barcode(
  p_product_unit_id uuid,
  p_is_primary boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_scope record;
  v_existing public.product_unit_barcodes%ROWTYPE;
  v_value text;
BEGIN
  SELECT * INTO v_scope
  FROM public.product_barcode_scope(p_product_unit_id);

  -- Serialize generation for this exact product unit. A concurrent request
  -- waits here, then observes and returns the barcode created by the winner.
  PERFORM 1
  FROM public.product_units
  WHERE id = p_product_unit_id
  FOR UPDATE;

  SELECT *
  INTO v_existing
  FROM public.product_unit_barcodes
  WHERE product_unit_id = p_product_unit_id
    AND is_active
  ORDER BY is_primary DESC, created_at, id
  LIMIT 1;

  IF FOUND THEN
    RETURN to_jsonb(v_existing);
  END IF;

  LOOP
    v_value := 'DF' || upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 18));
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.product_unit_barcodes
      WHERE branch_id = v_scope.branch_id
        AND normalized_barcode = v_value
    );
  END LOOP;

  RETURN public.create_product_unit_barcode(jsonb_build_object(
    'product_unit_id', p_product_unit_id,
    'barcode', v_value,
    'barcode_type', 'code128',
    'source', 'internal',
    'is_primary', p_is_primary
  ));
END;
$function$;

ALTER FUNCTION public.generate_internal_product_unit_barcode(uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.generate_internal_product_unit_barcode(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_internal_product_unit_barcode(uuid, boolean)
  TO authenticated, service_role;

COMMIT;
