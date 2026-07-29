BEGIN;

-- Extend only the presentation allowlist. Fiscal identity, invoice values,
-- snapshots, QR selection, and document classification remain untouched.
DO $extend_a4_theme_allowlist$
DECLARE
  v_definition text;
  v_old text := '(''classic'',''modern_split'',''minimal_professional'')';
  v_new text := '(''classic'',''modern_split'',''minimal_professional'',''executive_green'',''clean_ledger'',''contemporary_border'')';
BEGIN
  v_definition := pg_get_functiondef(
    'public.validate_invoice_presentation_settings(jsonb,uuid,uuid)'::regprocedure
  );

  IF strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'A4_THEME_VALIDATOR_ALLOWLIST_ANCHOR_MISSING';
  END IF;
  IF strpos(replace(v_definition, v_old, v_new), v_old) > 0 THEN
    RAISE EXCEPTION 'A4_THEME_VALIDATOR_ALLOWLIST_AMBIGUOUS';
  END IF;

  EXECUTE replace(v_definition, v_old, v_new);
END
$extend_a4_theme_allowlist$;

COMMENT ON FUNCTION public.validate_invoice_presentation_settings(jsonb, uuid, uuid) IS
  'Validates branch-scoped presentation settings, including the six approved A4 themes. Does not accept fiscal or calculation fields.';

COMMIT;
