-- Adds one reviewed, presentation-only A4 layout to the closed settings-save
-- allowlist. Historical IDs remain valid; arbitrary values remain rejected.
DO $migration$
DECLARE
  definition TEXT;
  old_allowlist CONSTANT TEXT := '''classic'',''modern_split'',''minimal_professional'',''executive_green'',''clean_ledger'',''contemporary_border''';
  new_allowlist CONSTANT TEXT := '''classic'',''modern_split'',''minimal_professional'',''executive_green'',''clean_ledger'',''contemporary_border'',''executive_professional''';
BEGIN
  IF to_regprocedure('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required invoice presentation validator is missing';
  END IF;

  definition := pg_get_functiondef('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)'::regprocedure);
  IF position('''executive_professional''' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position(old_allowlist IN definition) = 0 THEN
    RAISE EXCEPTION 'Invoice presentation validator does not contain the reviewed A4 allowlist';
  END IF;

  definition := replace(definition, old_allowlist, new_allowlist);
  EXECUTE definition;
END;
$migration$;

COMMENT ON FUNCTION public.validate_invoice_presentation_settings(JSONB, UUID, UUID) IS
  'Validates the closed V1 invoice presentation contract, including the Executive Professional A4 layout.';
