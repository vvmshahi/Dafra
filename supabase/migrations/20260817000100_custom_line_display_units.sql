-- Custom Line display units are immutable invoice snapshot metadata only.
-- Product/package identity, stock conversion, and fiscal totals remain server-owned.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $custom_line_display_units$
DECLARE
  v_definition text;
  v_patched text;
  v_fields_anchor text := $anchor$      'unit_price', 'vat_treatment'$anchor$;
  v_fields_replacement text := $replacement$      'unit_price', 'vat_treatment', 'unit'$replacement$;
  v_validation_anchor text := $anchor$      BEGIN
        v_qty := NULLIF(btrim(COALESCE(v_item ->> 'quantity', '')), '')::numeric;$anchor$;
  v_validation_replacement text := $replacement$      IF jsonb_typeof(v_item -> 'unit') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_LINE_UNIT' USING ERRCODE = '22023';
      END IF;
      v_custom_unit := v_item ->> 'unit';
      IF v_custom_unit IS NULL OR v_custom_unit ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_LINE_UNIT' USING ERRCODE = '22023';
      END IF;
      v_custom_unit := btrim(v_custom_unit);
      IF v_custom_unit IS NULL OR length(v_custom_unit) > 40 THEN
        RAISE EXCEPTION 'INVALID_CUSTOM_LINE_UNIT' USING ERRCODE = '22023';
      END IF;
      v_custom_unit := CASE lower(v_custom_unit)
        WHEN 'pce' THEN 'PCE' WHEN 'piece' THEN 'PCE'
        WHEN 'unt' THEN 'UNT' WHEN 'unit' THEN 'UNT'
        WHEN 'box' THEN 'BOX' WHEN 'btl' THEN 'BTL' WHEN 'bottle' THEN 'BTL'
        WHEN 'pac' THEN 'PAC' WHEN 'pack' THEN 'PAC'
        WHEN 'kgm' THEN 'KGM' WHEN 'kg' THEN 'KGM'
        WHEN 'ltr' THEN 'LTR' WHEN 'liter' THEN 'LTR'
        WHEN 'mtr' THEN 'MTR' WHEN 'meter' THEN 'MTR'
        WHEN 'hur' THEN 'HUR' WHEN 'hour' THEN 'HUR'
        ELSE v_custom_unit
      END;

      BEGIN
        v_qty := NULLIF(btrim(COALESCE(v_item ->> 'quantity', '')), '')::numeric;$replacement$;
BEGIN
  IF to_regprocedure('public.pos_checkout_custom_lines_v1(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'CUSTOM_LINE_DISPLAY_UNIT_REQUIRED_FUNCTION_MISSING';
  END IF;
  v_definition := pg_get_functiondef('public.pos_checkout_custom_lines_v1(jsonb)'::regprocedure);
  IF position(v_fields_anchor IN v_definition) = 0
     OR position('v_custom_name_ar text;' IN v_definition) = 0
     OR position(v_validation_anchor IN v_definition) = 0
     OR position($needle$'unit', 'PCE'$needle$ IN v_definition) = 0 THEN
    RAISE EXCEPTION 'CUSTOM_LINE_DISPLAY_UNIT_CONTRACT_UNREVIEWED';
  END IF;
  v_patched := replace(v_definition, v_fields_anchor, v_fields_replacement);
  v_patched := replace(v_patched, '  v_custom_name_ar text;', '  v_custom_name_ar text;' || E'\n  v_custom_unit text;');
  v_patched := replace(v_patched, v_validation_anchor, v_validation_replacement);
  v_patched := replace(v_patched, $needle$'unit', 'PCE'$needle$, $replacement$'unit', v_custom_unit$replacement$);
  v_patched := replace(v_patched, $needle$'selling_unit_name', 'PCE'$needle$, $replacement$'selling_unit_name', v_custom_unit$replacement$);
  v_patched := replace(v_patched, $needle$'selling_unit_code', 'PCE'$needle$, $replacement$'selling_unit_code', v_custom_unit$replacement$);
  v_patched := replace(v_patched, $needle$'base_unit_name', 'PCE'$needle$, $replacement$'base_unit_name', v_custom_unit$replacement$);
  v_patched := replace(v_patched, $needle$'base_unit_code', 'PCE'$needle$, $replacement$'base_unit_code', v_custom_unit$replacement$);
  IF v_patched IS NOT DISTINCT FROM v_definition
     OR position('INVALID_CUSTOM_LINE_UNIT' IN v_patched) = 0
     OR position($needle$'unit', v_custom_unit$needle$ IN v_patched) = 0 THEN
    RAISE EXCEPTION 'CUSTOM_LINE_DISPLAY_UNIT_PATCH_UNREVIEWED';
  END IF;
  EXECUTE v_patched;
END
$custom_line_display_units$;

NOTIFY pgrst, 'reload schema';
COMMIT;
