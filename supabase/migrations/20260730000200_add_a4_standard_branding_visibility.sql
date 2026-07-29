-- Persist the explicit relationship between custom header artwork and Kubri's
-- decorative invoice identity. Legal seller and fiscal fields are unaffected.
DO $migration$
DECLARE
  definition TEXT;
BEGIN
  IF to_regprocedure('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required invoice presentation validator is missing';
  END IF;

  definition := pg_get_functiondef(
    'public.validate_invoice_presentation_settings(jsonb,uuid,uuid)'::regprocedure
  );

  IF position('show_standard_branding' IN definition) > 0 THEN
    RAISE NOTICE 'A4 standard-branding visibility is already supported';
    RETURN;
  END IF;

  IF position($old$'artwork_scope','artwork_template_id'$old$ IN definition) = 0
    OR position($old$'header_asset_enabled', COALESCE(direct_a4->'header_asset_enabled','false'::JSONB),$old$ IN definition) = 0
    OR position($old$FOREACH v IN ARRAY ARRAY['auto_foreground','header_asset_enabled','footer_asset_enabled'] LOOP$old$ IN definition) = 0
    OR position($old$'header_asset_enabled', (a->>'header_asset_enabled')::BOOLEAN,$old$ IN definition) = 0 THEN
    RAISE EXCEPTION 'Invoice presentation validator is not the reviewed A4 definition';
  END IF;

  definition := replace(
    definition,
    $old$'artwork_scope','artwork_template_id'$old$,
    $new$'artwork_scope','artwork_template_id','show_standard_branding'$new$
  );
  definition := replace(
    definition,
    $old$'header_asset_enabled', COALESCE(direct_a4->'header_asset_enabled','false'::JSONB),$old$,
    $new$'header_asset_enabled', COALESCE(direct_a4->'header_asset_enabled','false'::JSONB),
        'show_standard_branding', COALESCE(
          direct_a4->'show_standard_branding',
          to_jsonb(NOT COALESCE((direct_a4->>'header_asset_enabled')::BOOLEAN, FALSE))
        ),$new$
  );
  definition := replace(
    definition,
    $old$  IF EXISTS (SELECT 1 FROM jsonb_object_keys(s) k WHERE k <> ALL(top_keys)) THEN$old$,
    $new$  -- Older settings did not carry this presentation-only choice. Preserve
  -- invoices without artwork and remove duplicate identity for custom headers.
  IF jsonb_typeof(s->'a4') = 'object'
    AND NOT (s->'a4' ? 'show_standard_branding') THEN
    s := jsonb_set(
      s,
      '{a4,show_standard_branding}',
      to_jsonb(
        CASE
          WHEN jsonb_typeof(s#>'{a4,header_asset_enabled}') = 'boolean'
            THEN NOT (s#>>'{a4,header_asset_enabled}')::BOOLEAN
          ELSE TRUE
        END
      ),
      TRUE
    );
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_object_keys(s) k WHERE k <> ALL(top_keys)) THEN$new$
  );
  definition := replace(
    definition,
    $old$FOREACH v IN ARRAY ARRAY['auto_foreground','header_asset_enabled','footer_asset_enabled'] LOOP$old$,
    $new$FOREACH v IN ARRAY ARRAY['auto_foreground','header_asset_enabled','footer_asset_enabled','show_standard_branding'] LOOP$new$
  );
  definition := replace(
    definition,
    $old$'header_asset_enabled', (a->>'header_asset_enabled')::BOOLEAN,$old$,
    $new$'header_asset_enabled', (a->>'header_asset_enabled')::BOOLEAN,
      'show_standard_branding', (a->>'show_standard_branding')::BOOLEAN,$new$
  );

  EXECUTE definition;
END;
$migration$;

DO $migration$
DECLARE
  definition TEXT;
BEGIN
  IF to_regprocedure('public.default_invoice_presentation_settings(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Required invoice presentation defaults function is missing';
  END IF;

  definition := pg_get_functiondef(
    'public.default_invoice_presentation_settings(uuid)'::regprocedure
  );

  IF position('show_standard_branding' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF position($old$'header_asset_enabled', FALSE,$old$ IN definition) = 0 THEN
    RAISE EXCEPTION 'Invoice presentation defaults are not the reviewed A4 definition';
  END IF;

  definition := replace(
    definition,
    $old$'header_asset_enabled', FALSE,$old$,
    $new$'header_asset_enabled', FALSE,
      'show_standard_branding', TRUE,$new$
  );
  EXECUTE definition;
END;
$migration$;

COMMENT ON FUNCTION public.validate_invoice_presentation_settings(JSONB, UUID, UUID) IS
  'Validates the closed V1 invoice presentation contract, including branch-authoritative artwork and explicit standard-branding visibility.';
