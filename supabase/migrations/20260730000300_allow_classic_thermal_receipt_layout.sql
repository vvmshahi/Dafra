-- Temporarily admit the restored pre-refinement thermal composition for manual
-- layout comparison. Existing branch defaults and stored settings are unchanged.
DO $migration$
DECLARE
  definition TEXT;
  old_contract CONSTANT TEXT :=
    $old$s->'thermal'->>'density' NOT IN ('compact','standard','detailed')$old$;
  new_contract CONSTANT TEXT :=
    $new$s->'thermal'->>'density' NOT IN ('classic','compact','standard','detailed')$new$;
BEGIN
  IF to_regprocedure('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required invoice presentation validator is missing';
  END IF;

  definition := pg_get_functiondef(
    'public.validate_invoice_presentation_settings(jsonb,uuid,uuid)'::regprocedure
  );

  IF position(new_contract IN definition) > 0 THEN
    RAISE NOTICE 'Classic thermal receipt layout is already accepted';
    RETURN;
  END IF;
  IF position(old_contract IN definition) = 0 THEN
    RAISE EXCEPTION 'Invoice presentation validator is not the reviewed thermal definition';
  END IF;

  EXECUTE replace(definition, old_contract, new_contract);
END;
$migration$;

COMMENT ON FUNCTION public.validate_invoice_presentation_settings(JSONB, UUID, UUID) IS
  'Validates the closed V1 invoice presentation contract, including the temporary classic thermal receipt comparison layout.';
