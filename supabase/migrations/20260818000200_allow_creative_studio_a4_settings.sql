-- Adds one reviewed Creative Studio presentation layout to the existing closed
-- A4 settings validator. Historical IDs remain valid and arbitrary values stay rejected.
DO $migration$
DECLARE
  definition TEXT;
  old_allowlist CONSTANT TEXT := '''classic'',''modern_split'',''minimal_professional'',''executive_green'',''clean_ledger'',''contemporary_border'',''executive_professional''';
  new_allowlist CONSTANT TEXT := '''classic'',''modern_split'',''minimal_professional'',''executive_green'',''clean_ledger'',''contemporary_border'',''executive_professional'',''creative_studio''';
BEGIN
  IF to_regprocedure('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required invoice presentation validator is missing';
  END IF;

  definition := pg_get_functiondef('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)'::regprocedure);
  IF position('''creative_studio''' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position(old_allowlist IN definition) = 0 THEN
    RAISE EXCEPTION 'Invoice presentation validator does not contain the reviewed A4 allowlist';
  END IF;

  definition := replace(definition, old_allowlist, new_allowlist);
  EXECUTE definition;
END;
$migration$;
