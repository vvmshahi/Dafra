-- Restore the historical branch-assets logo path accepted by the V1 invoice
-- settings contract. The path remains branch-authoritative: the UUID prefix
-- must equal p_branch_id. All A4 artwork validation remains unchanged.
DO $migration$
DECLARE
  v_definition TEXT;
  v_old TEXT := $old$
  IF v IS NOT NULL
    AND v !~ ('^invoice-branding/'||p_tenant_id::TEXT||'/'||p_branch_id::TEXT||'/[1-9][0-9]*/logo\.(png|jpg|jpeg|webp)$') THEN
    RAISE EXCEPTION 'Invalid immutable logo path' USING ERRCODE = '22023';
  END IF;
$old$;
  v_new TEXT := $new$
  IF v IS NOT NULL
    AND v !~ ('^invoice-branding/'||p_tenant_id::TEXT||'/'||p_branch_id::TEXT||'/[1-9][0-9]*/logo\.(png|jpg|jpeg|webp)$')
    AND v !~ ('^'||p_branch_id::TEXT||'/logo\.(png|jpg|jpeg|webp)$') THEN
    RAISE EXCEPTION 'Invalid immutable logo path' USING ERRCODE = '22023';
  END IF;
$new$;
BEGIN
  IF to_regprocedure('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required invoice presentation validator is missing';
  END IF;

  v_definition := pg_get_functiondef(
    'public.validate_invoice_presentation_settings(jsonb,uuid,uuid)'::regprocedure
  );

  IF position(v_new IN v_definition) > 0 THEN
    RAISE NOTICE 'Historical invoice logo compatibility is already installed';
    RETURN;
  END IF;

  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Invoice presentation validator logo contract is not the reviewed definition';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END;
$migration$;

COMMENT ON FUNCTION public.validate_invoice_presentation_settings(JSONB, UUID, UUID) IS
  'Validates the closed V1 invoice presentation contract, including branch-authoritative historical logo paths and private A4 artwork paths.';
