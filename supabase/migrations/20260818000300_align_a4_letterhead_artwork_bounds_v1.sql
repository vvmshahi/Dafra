-- Align the authoritative V1 letterhead geometry contract with the client.
-- Artwork remains presentation-only and document-flow only; no issued rows are rewritten.
DO $migration$
DECLARE
  definition TEXT;
  old_dimensions CONSTANT TEXT := $old$
    OR (a->>'header_asset_height')::INTEGER NOT BETWEEN 8 AND 70
    OR (a->>'footer_asset_height')::INTEGER NOT BETWEEN 4 AND 35
    OR (a->>'header_asset_spacing')::INTEGER NOT BETWEEN 0 AND 16
    OR (a->>'footer_asset_spacing')::INTEGER NOT BETWEEN 0 AND 16
    OR (a->>'header_crop_top')::INTEGER NOT BETWEEN 0 AND 99$old$;
  new_dimensions CONSTANT TEXT := $new$
    OR (a->>'header_asset_height')::INTEGER NOT BETWEEN 8 AND 45
    OR (a->>'footer_asset_height')::INTEGER NOT BETWEEN 4 AND 18
    OR (a->>'header_asset_spacing')::INTEGER NOT BETWEEN 0 AND 8
    OR (a->>'footer_asset_spacing')::INTEGER NOT BETWEEN 0 AND 8
    OR ((a->>'header_asset_height')::INTEGER + (a->>'footer_asset_height')::INTEGER + (a->>'header_asset_spacing')::INTEGER + (a->>'footer_asset_spacing')::INTEGER) > 74
    OR (a->>'header_crop_top')::INTEGER NOT BETWEEN 0 AND 99$new$;
BEGIN
  IF to_regprocedure('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required invoice presentation validator is missing';
  END IF;

  definition := pg_get_functiondef('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)'::regprocedure);
  IF position('NOT BETWEEN 8 AND 45' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position(old_dimensions IN definition) = 0 THEN
    RAISE EXCEPTION 'Invoice presentation validator does not contain the reviewed V1 artwork bounds';
  END IF;

  definition := replace(definition, old_dimensions, new_dimensions);
  EXECUTE definition;
END;
$migration$;
