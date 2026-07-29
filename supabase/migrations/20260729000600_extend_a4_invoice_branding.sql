BEGIN;

-- Presentation-only extension. Fiscal identity, invoice rows, QR payloads,
-- calculations, issuance, and document classification are not changed.
DO $extend_a4_branding$
DECLARE
  v_definition text;
  v_old_keys text := 'ARRAY[''template_id'',''template_version'',''header_style'']';
  v_new_keys text := 'ARRAY[''template_id'',''template_version'',''header_style'',''accent_color'',''header_asset_path'',''header_asset_version'',''header_asset_enabled'',''header_asset_fit'',''header_asset_height'',''header_asset_spacing'']';
  v_old_return text := '''a4'',jsonb_build_object(''template_id'',s->''a4''->>''template_id'',''template_version'',(s->''a4''->>''template_version'')::INTEGER,''header_style'',s->''a4''->>''header_style'')';
  v_new_return text := '''a4'',jsonb_build_object(''template_id'',s->''a4''->>''template_id'',''template_version'',(s->''a4''->>''template_version'')::INTEGER,''header_style'',s->''a4''->>''header_style'',''accent_color'',lower(s->''a4''->>''accent_color''),''header_asset_path'',NULLIF(btrim(s->''a4''->>''header_asset_path''),''''),''header_asset_version'',(s->''a4''->>''header_asset_version'')::INTEGER,''header_asset_enabled'',(s->''a4''->>''header_asset_enabled'')::BOOLEAN,''header_asset_fit'',s->''a4''->>''header_asset_fit'',''header_asset_height'',(s->''a4''->>''header_asset_height'')::INTEGER,''header_asset_spacing'',(s->''a4''->>''header_asset_spacing'')::INTEGER)';
  v_checks text := $checks$
  IF COALESCE(s->'a4'->>'accent_color','') !~ '^#[0-9A-Fa-f]{6}$' THEN RAISE EXCEPTION 'Invalid A4 accent colour' USING ERRCODE='22023'; END IF;
  IF s->'a4'->>'header_asset_fit' NOT IN ('contain','cover') OR jsonb_typeof(s->'a4'->'header_asset_enabled') <> 'boolean' THEN RAISE EXCEPTION 'Invalid A4 header artwork setting' USING ERRCODE='22023'; END IF;
  IF (s->'a4'->>'header_asset_height')::INTEGER NOT BETWEEN 18 AND 56 OR (s->'a4'->>'header_asset_spacing')::INTEGER NOT BETWEEN 0 AND 16 THEN RAISE EXCEPTION 'Invalid A4 header artwork dimensions' USING ERRCODE='22023'; END IF;
  n := (s->'a4'->>'header_asset_version')::INTEGER;
  v := NULLIF(btrim(COALESCE(s->'a4'->>'header_asset_path','')),'');
  IF v IS NOT NULL AND v !~ ('^invoice-branding/'||p_tenant_id::TEXT||'/'||p_branch_id::TEXT||'/'||n::TEXT||'/header\.(png|jpg|jpeg|webp)$') THEN RAISE EXCEPTION 'Invalid immutable A4 header asset path' USING ERRCODE='22023'; END IF;
  $checks$;
BEGIN
  v_definition := pg_get_functiondef('public.validate_invoice_presentation_settings(jsonb,uuid,uuid)'::regprocedure);
  IF strpos(v_definition,v_old_keys)=0 OR strpos(v_definition,v_old_return)=0 THEN RAISE EXCEPTION 'A4_BRANDING_VALIDATOR_ANCHOR_MISSING'; END IF;
  v_definition := replace(v_definition,v_old_keys,v_new_keys);
  v_definition := replace(v_definition,'  RETURN jsonb_build_object(',v_checks||E'\n  RETURN jsonb_build_object(');
  v_definition := replace(v_definition,v_old_return,v_new_return);
  EXECUTE v_definition;
END
$extend_a4_branding$;

DO $storage_policy$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  DROP POLICY IF EXISTS phase5b_invoice_branding_insert ON storage.objects;
  CREATE POLICY phase5b_invoice_branding_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id='branch-assets' AND (storage.foldername(name))[1]='invoice-branding'
    AND (storage.foldername(name))[2]=public.get_my_tenant_id()::TEXT
    AND ((public.get_my_role()::TEXT='owner') OR ((storage.foldername(name))[3]=public.get_my_branch_id()::TEXT))
    AND name ~ '^invoice-branding/[0-9a-f-]{36}/[0-9a-f-]{36}/[1-9][0-9]*/(logo|header)\.(png|jpg|jpeg|webp)$'
  );
END
$storage_policy$;

COMMENT ON FUNCTION public.validate_invoice_presentation_settings(jsonb, uuid, uuid) IS
  'Validates branch-scoped presentation settings including A4 layout, accent colour, and immutable decorative header artwork.';

COMMIT;
