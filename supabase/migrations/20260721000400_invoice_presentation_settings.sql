-- Phase 4B: validated invoice-presentation persistence and snapshot v2.
-- Additive only. Existing snapshot v1 and NULL legacy documents remain readable.

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS presentation_settings JSONB;

COMMENT ON COLUMN public.branches.presentation_settings IS
  'Validated schema-versioned customer-facing invoice presentation settings. Never contains compliance identity or binary assets.';

CREATE OR REPLACE FUNCTION public.default_invoice_presentation_settings(p_branch_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE b RECORD;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id=p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'schema_version',1,
    'identity',jsonb_build_object(
      'display_heading',b.invoice_display_heading,
      'display_subheading',b.invoice_display_subheading,
      'custom_display_name',b.display_name,
      'show_company_name',COALESCE(b.show_company_display_name,TRUE),
      'show_branch_name',COALESCE(b.show_branch_display_name,TRUE)),
    'contact',jsonb_build_object(
      'phone',b.phone,'email',b.email,'website',b.website,
      'show_phone',b.phone IS NOT NULL,'show_email',COALESCE(b.show_email,b.email IS NOT NULL),
      'show_website',COALESCE(b.show_website,b.website IS NOT NULL),'show_address',TRUE),
    'footer',jsonb_build_object(
      'thank_you_message',NULL,'footer_note',b.receipt_footer,'refund_note',NULL,
      'show_thank_you',FALSE,'show_footer',COALESCE(b.show_footer,TRUE),'show_refund_note',FALSE),
    'logo',jsonb_build_object(
      'visible',COALESCE(b.show_logo,FALSE) AND COALESCE(b.logo_url,'') ~ '^invoice-branding/',
      'asset_path',CASE WHEN COALESCE(b.logo_url,'') ~ '^invoice-branding/' THEN b.logo_url ELSE NULL END,
      'asset_version',COALESCE(b.logo_asset_version,1),'size','medium'),
    'thermal',jsonb_build_object(
      'width','80mm','density',COALESCE(b.thermal_density,'standard'),'qr_size','standard',
      'wrap_item_names',TRUE,'show_cash_change',COALESCE(b.show_cash_change,TRUE)),
    'a4',jsonb_build_object(
      'template_id',CASE WHEN b.a4_template_id IN ('classic','modern_split','minimal_professional') THEN b.a4_template_id ELSE 'classic' END,
      'template_version',COALESCE(b.document_template_version,1),'header_style','standard'));
END; $$;

CREATE OR REPLACE FUNCTION public.validate_invoice_presentation_settings(p_settings JSONB, p_tenant_id UUID, p_branch_id UUID)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE s JSONB:=p_settings; section TEXT; v TEXT; n INTEGER;
  top_keys CONSTANT TEXT[]:=ARRAY['schema_version','identity','contact','footer','logo','thermal','a4'];
BEGIN
  IF s IS NULL OR jsonb_typeof(s)<>'object' THEN RAISE EXCEPTION 'presentation_settings must be an object' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s) k WHERE k<>ALL(top_keys)) THEN RAISE EXCEPTION 'Unknown presentation_settings key' USING ERRCODE='22023'; END IF;
  IF (s->>'schema_version') IS NULL OR (s->>'schema_version')::INTEGER<>1 THEN RAISE EXCEPTION 'Unsupported presentation settings schema_version' USING ERRCODE='22023'; END IF;
  FOREACH section IN ARRAY ARRAY['identity','contact','footer','logo','thermal','a4'] LOOP
    IF jsonb_typeof(s->section)<>'object' THEN RAISE EXCEPTION 'Invalid presentation section: %',section USING ERRCODE='22023'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s->'identity') k WHERE k<>ALL(ARRAY['display_heading','display_subheading','custom_display_name','show_company_name','show_branch_name'])) THEN RAISE EXCEPTION 'Unknown identity key' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s->'contact') k WHERE k<>ALL(ARRAY['phone','email','website','show_phone','show_email','show_website','show_address'])) THEN RAISE EXCEPTION 'Unknown contact key' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s->'footer') k WHERE k<>ALL(ARRAY['thank_you_message','footer_note','refund_note','show_thank_you','show_footer','show_refund_note'])) THEN RAISE EXCEPTION 'Unknown footer key' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s->'logo') k WHERE k<>ALL(ARRAY['visible','asset_path','asset_version','size'])) THEN RAISE EXCEPTION 'Unknown logo key' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s->'thermal') k WHERE k<>ALL(ARRAY['width','density','qr_size','wrap_item_names','show_cash_change'])) THEN RAISE EXCEPTION 'Unknown thermal key' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(s->'a4') k WHERE k<>ALL(ARRAY['template_id','template_version','header_style'])) THEN RAISE EXCEPTION 'Unknown a4 key' USING ERRCODE='22023'; END IF;

  FOREACH v IN ARRAY ARRAY['display_heading','display_subheading','custom_display_name'] LOOP
    IF jsonb_typeof(s->'identity'->v) NOT IN ('string','null') OR length(COALESCE(s->'identity'->>v,''))>160 THEN RAISE EXCEPTION 'Invalid identity field: %',v USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY['phone','email','website'] LOOP
    IF jsonb_typeof(s->'contact'->v) NOT IN ('string','null') THEN RAISE EXCEPTION 'Invalid contact field: %',v USING ERRCODE='22023'; END IF;
  END LOOP;
  IF length(COALESCE(s->'contact'->>'phone',''))>50 OR length(COALESCE(s->'contact'->>'email',''))>255 OR length(COALESCE(s->'contact'->>'website',''))>255 THEN RAISE EXCEPTION 'Contact field too long' USING ERRCODE='22023'; END IF;
  IF COALESCE(s->'contact'->>'email','')<>'' AND (s->'contact'->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid email' USING ERRCODE='22023'; END IF;
  IF COALESCE(s->'contact'->>'website','')<>'' AND (s->'contact'->>'website') !~ '^https://[^[:space:]]+$' THEN RAISE EXCEPTION 'Website must use https' USING ERRCODE='22023'; END IF;
  FOREACH v IN ARRAY ARRAY['thank_you_message','footer_note','refund_note'] LOOP
    IF jsonb_typeof(s->'footer'->v) NOT IN ('string','null') OR length(COALESCE(s->'footer'->>v,''))>500 THEN RAISE EXCEPTION 'Invalid footer field: %',v USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY['show_company_name','show_branch_name'] LOOP IF jsonb_typeof(s->'identity'->v)<>'boolean' THEN RAISE EXCEPTION 'Invalid identity boolean' USING ERRCODE='22023'; END IF; END LOOP;
  FOREACH v IN ARRAY ARRAY['show_phone','show_email','show_website','show_address'] LOOP IF jsonb_typeof(s->'contact'->v)<>'boolean' THEN RAISE EXCEPTION 'Invalid contact boolean' USING ERRCODE='22023'; END IF; END LOOP;
  FOREACH v IN ARRAY ARRAY['show_thank_you','show_footer','show_refund_note'] LOOP IF jsonb_typeof(s->'footer'->v)<>'boolean' THEN RAISE EXCEPTION 'Invalid footer boolean' USING ERRCODE='22023'; END IF; END LOOP;
  FOREACH v IN ARRAY ARRAY['visible'] LOOP IF jsonb_typeof(s->'logo'->v)<>'boolean' THEN RAISE EXCEPTION 'Invalid logo boolean' USING ERRCODE='22023'; END IF; END LOOP;
  FOREACH v IN ARRAY ARRAY['wrap_item_names','show_cash_change'] LOOP IF jsonb_typeof(s->'thermal'->v)<>'boolean' THEN RAISE EXCEPTION 'Invalid thermal boolean' USING ERRCODE='22023'; END IF; END LOOP;
  IF s->'logo'->>'size' NOT IN ('small','medium','large') THEN RAISE EXCEPTION 'Invalid logo size' USING ERRCODE='22023'; END IF;
  IF s->'thermal'->>'width' NOT IN ('58mm','80mm') OR s->'thermal'->>'density' NOT IN ('compact','standard','detailed') OR s->'thermal'->>'qr_size' NOT IN ('small','standard','large') THEN RAISE EXCEPTION 'Invalid thermal setting' USING ERRCODE='22023'; END IF;
  IF s->'a4'->>'template_id' NOT IN ('classic','modern_split','minimal_professional') OR s->'a4'->>'header_style' NOT IN ('standard','compact','branded') THEN RAISE EXCEPTION 'Invalid A4 setting' USING ERRCODE='22023'; END IF;
  n:=(s->'a4'->>'template_version')::INTEGER; IF n<>1 THEN RAISE EXCEPTION 'Unsupported template version' USING ERRCODE='22023'; END IF;
  n:=(s->'logo'->>'asset_version')::INTEGER; IF n<1 THEN RAISE EXCEPTION 'Invalid logo asset version' USING ERRCODE='22023'; END IF;
  v:=NULLIF(btrim(COALESCE(s->'logo'->>'asset_path','')),'');
  IF v IS NOT NULL AND v !~ ('^invoice-branding/'||p_tenant_id::TEXT||'/'||p_branch_id::TEXT||'/'||n::TEXT||'/logo\.(png|jpg|jpeg|webp)$') THEN RAISE EXCEPTION 'Invalid immutable logo asset path' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object(
    'schema_version',1,
    'identity',jsonb_build_object('display_heading',NULLIF(btrim(s->'identity'->>'display_heading'),''),'display_subheading',NULLIF(btrim(s->'identity'->>'display_subheading'),''),'custom_display_name',NULLIF(btrim(s->'identity'->>'custom_display_name'),''),'show_company_name',(s->'identity'->>'show_company_name')::BOOLEAN,'show_branch_name',(s->'identity'->>'show_branch_name')::BOOLEAN),
    'contact',jsonb_build_object('phone',NULLIF(btrim(s->'contact'->>'phone'),''),'email',NULLIF(btrim(s->'contact'->>'email'),''),'website',NULLIF(btrim(s->'contact'->>'website'),''),'show_phone',(s->'contact'->>'show_phone')::BOOLEAN,'show_email',(s->'contact'->>'show_email')::BOOLEAN,'show_website',(s->'contact'->>'show_website')::BOOLEAN,'show_address',(s->'contact'->>'show_address')::BOOLEAN),
    'footer',jsonb_build_object('thank_you_message',NULLIF(btrim(s->'footer'->>'thank_you_message'),''),'footer_note',NULLIF(btrim(s->'footer'->>'footer_note'),''),'refund_note',NULLIF(btrim(s->'footer'->>'refund_note'),''),'show_thank_you',(s->'footer'->>'show_thank_you')::BOOLEAN,'show_footer',(s->'footer'->>'show_footer')::BOOLEAN,'show_refund_note',(s->'footer'->>'show_refund_note')::BOOLEAN),
    'logo',jsonb_build_object('visible',(s->'logo'->>'visible')::BOOLEAN,'asset_path',v,'asset_version',n,'size',s->'logo'->>'size'),
    'thermal',jsonb_build_object('width',s->'thermal'->>'width','density',s->'thermal'->>'density','qr_size',s->'thermal'->>'qr_size','wrap_item_names',(s->'thermal'->>'wrap_item_names')::BOOLEAN,'show_cash_change',(s->'thermal'->>'show_cash_change')::BOOLEAN),
    'a4',jsonb_build_object('template_id',s->'a4'->>'template_id','template_version',(s->'a4'->>'template_version')::INTEGER,'header_style',s->'a4'->>'header_style'));
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_invoice_presentation_settings(p_branch_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE b RECORD; s JSONB;
BEGIN
  SELECT id,tenant_id,presentation_settings INTO b FROM public.branches WHERE id=p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE='42501'; END IF;
  s:=COALESCE(b.presentation_settings,public.default_invoice_presentation_settings(p_branch_id));
  RETURN public.validate_invoice_presentation_settings(s,b.tenant_id,b.id);
END; $$;

CREATE OR REPLACE FUNCTION public.update_branch_invoice_settings(p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE uid UUID:=auth.uid(); u RECORD; b RECORD; s JSONB; lang TEXT; mode TEXT;
  allowed CONSTANT TEXT[]:=ARRAY['branch_id','invoice_language','print_mode','presentation_settings','display_name','phone','show_logo','logo_url','website','email','show_website','show_email','receipt_footer','show_footer','show_cash_change'];
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k<>ALL(allowed)) THEN RAISE EXCEPTION 'Unknown or invalid invoice settings key' USING ERRCODE='22023'; END IF;
  -- Official seller and compliance fields are not accepted: strict top-level
  -- and per-section key allowlists reject them structurally without confusing
  -- legitimate presentation keys such as qr_size with QR payload data.
  SELECT id,tenant_id,branch_id,role::TEXT role,is_active INTO u FROM public.user_profiles WHERE id=uid;
  SELECT * INTO b FROM public.branches WHERE id=NULLIF(btrim(p_payload->>'branch_id'),'')::UUID FOR UPDATE;
  IF NOT FOUND OR NOT b.is_active OR NOT u.is_active OR NOT ((u.role='owner' AND u.tenant_id=b.tenant_id) OR (u.role='branch' AND u.tenant_id=b.tenant_id AND u.branch_id=b.id)) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  lang:=p_payload->>'invoice_language'; mode:=p_payload->>'print_mode';
  IF lang NOT IN ('en','ar','both') OR mode NOT IN ('thermal','pdf','both') THEN RAISE EXCEPTION 'Invalid operational document defaults' USING ERRCODE='22023'; END IF;
  IF p_payload ? 'presentation_settings' THEN
    s:=p_payload->'presentation_settings';
  ELSE
    -- Transitional compatibility for the existing Phase 4A form. Each legacy
    -- field maps to one unambiguous canonical field; Phase 4C will send v1 directly.
    s:=public.resolve_invoice_presentation_settings(b.id);
    s:=jsonb_set(s,'{identity,custom_display_name}',COALESCE(to_jsonb(NULLIF(btrim(COALESCE(p_payload->>'display_name','')),'')),'null'::JSONB),TRUE);
    s:=jsonb_set(s,'{contact,phone}',COALESCE(to_jsonb(NULLIF(btrim(COALESCE(p_payload->>'phone','')),'')),'null'::JSONB),TRUE);
    s:=jsonb_set(s,'{contact,email}',COALESCE(to_jsonb(NULLIF(btrim(COALESCE(p_payload->>'email','')),'')),'null'::JSONB),TRUE);
    s:=jsonb_set(s,'{contact,website}',COALESCE(to_jsonb(NULLIF(btrim(COALESCE(p_payload->>'website','')),'')),'null'::JSONB),TRUE);
    s:=jsonb_set(s,'{contact,show_phone}',to_jsonb(NULLIF(btrim(COALESCE(p_payload->>'phone','')),'') IS NOT NULL),TRUE);
    s:=jsonb_set(s,'{contact,show_email}',COALESCE(p_payload->'show_email','false'::JSONB),TRUE);
    s:=jsonb_set(s,'{contact,show_website}',COALESCE(p_payload->'show_website','false'::JSONB),TRUE);
    s:=jsonb_set(s,'{footer,footer_note}',COALESCE(to_jsonb(NULLIF(btrim(COALESCE(p_payload->>'receipt_footer','')),'')),'null'::JSONB),TRUE);
    s:=jsonb_set(s,'{footer,show_footer}',COALESCE(p_payload->'show_footer','true'::JSONB),TRUE);
    s:=jsonb_set(s,'{thermal,show_cash_change}',COALESCE(p_payload->'show_cash_change','true'::JSONB),TRUE);
    s:=jsonb_set(s,'{logo,visible}',COALESCE(p_payload->'show_logo','true'::JSONB),TRUE);
    IF p_payload ? 'logo_url' THEN
      s:=jsonb_set(s,'{logo,asset_path}',COALESCE(p_payload->'logo_url','null'::JSONB),TRUE);
      IF NULLIF(btrim(COALESCE(p_payload->>'logo_url','')),'') IS NOT NULL THEN
        s:=jsonb_set(s,'{logo,asset_version}',to_jsonb(split_part(p_payload->>'logo_url','/',4)::INTEGER),TRUE);
      END IF;
    END IF;
  END IF;
  s:=public.validate_invoice_presentation_settings(s,b.tenant_id,b.id);
  UPDATE public.branches SET presentation_settings=s,invoice_language=lang,print_mode=mode,updated_at=NOW() WHERE id=b.id;
  PERFORM public.record_audit_event('branch_invoice_settings_updated',b.tenant_id,b.id,uid,u.role,'branch',b.id,'info','succeeded',jsonb_build_object('schema_version',1,'invoice_language',lang,'print_mode',mode,'logo_asset_version',s#>>'{logo,asset_version}','template_id',s#>>'{a4,template_id}'),NULL,NULL);
  RETURN jsonb_build_object('branch_id',b.id,'presentation_settings',s,'invoice_language',lang,'print_mode',mode,'can_edit',TRUE);
END; $$;
REVOKE ALL ON FUNCTION public.update_branch_invoice_settings(JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_branch_invoice_settings(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_branch_invoice_settings(p_branch_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE uid UUID:=auth.uid(); u RECORD; b RECORD; can_edit BOOLEAN;
BEGIN
  SELECT id,tenant_id,branch_id,role::TEXT role,is_active INTO u FROM public.user_profiles WHERE id=uid;
  SELECT id,tenant_id,invoice_language,print_mode INTO b FROM public.branches WHERE id=p_branch_id AND is_active;
  can_edit:=u.is_active AND ((u.role='owner' AND u.tenant_id=b.tenant_id) OR (u.role='branch' AND u.tenant_id=b.tenant_id AND u.branch_id=b.id));
  IF b.id IS NULL OR NOT can_edit THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('branch_id',b.id,'presentation_settings',public.resolve_invoice_presentation_settings(b.id),'invoice_language',b.invoice_language,'print_mode',b.print_mode,'can_edit',can_edit,'role',u.role);
END; $$;
REVOKE ALL ON FUNCTION public.get_branch_invoice_settings(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_branch_invoice_settings(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.capture_invoice_identity_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET row_security=off AS $$
DECLARE c RECORD; b RECORD; s JSONB;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id=NEW.branch_id AND tenant_id=NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice branch does not match tenant' USING ERRCODE='23503'; END IF;
  IF b.compliance_identity_mode='legacy' THEN NEW.identity_snapshot:=NULL; RETURN NEW; END IF;
  SELECT * INTO c FROM public.branch_compliance_profiles WHERE branch_id=NEW.branch_id AND tenant_id=NEW.tenant_id AND validation_status='verified';
  IF NOT FOUND THEN RAISE EXCEPTION 'Official seller profile is incomplete or unverified' USING ERRCODE='23514'; END IF;
  s:=public.resolve_invoice_presentation_settings(b.id);
  NEW.identity_snapshot:=jsonb_build_object(
    'version',2,'legacy',FALSE,
    'compliance',jsonb_build_object('registeredSellerName',c.registered_seller_name,'registeredSellerNameAr',c.registered_seller_name_ar,'vatNumber',c.vat_number,'registrationScheme',c.registration_scheme,'registrationIdentifier',c.registration_identifier,'address',jsonb_build_object('buildingNumber',c.building_number,'street',c.street,'district',c.district,'city',c.city,'postalCode',c.postal_code,'country',c.country)),
    'presentationSettings',s,
    'document',jsonb_build_object('language',COALESCE(NEW.document_language,b.invoice_language,'both'),'printMode',b.print_mode));
  RETURN NEW;
END; $$;

-- Immutable path contract. Uploads use INSERT only; replacement uses a new version.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('branch-assets','branch-assets',TRUE,2097152,ARRAY['image/jpeg','image/png','image/webp']::TEXT[])
ON CONFLICT (id) DO UPDATE
SET public=EXCLUDED.public,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION public.invoice_branding_asset_path(p_tenant_id UUID,p_branch_id UUID,p_asset_version INTEGER,p_extension TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE ext TEXT:=lower(p_extension);
BEGIN
  IF p_asset_version<1 OR ext NOT IN ('png','jpg','jpeg','webp') THEN RAISE EXCEPTION 'Invalid logo asset reference' USING ERRCODE='22023'; END IF;
  RETURN 'invoice-branding/'||p_tenant_id||'/'||p_branch_id||'/'||p_asset_version||'/logo.'||ext;
END; $$;

CREATE OR REPLACE FUNCTION public.prevent_invoice_branding_asset_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF OLD.bucket_id='branch-assets' AND OLD.name LIKE 'invoice-branding/%' THEN
    RAISE EXCEPTION 'Versioned invoice-branding assets are immutable' USING ERRCODE='42501';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS storage_invoice_branding_immutable ON storage.objects';
    EXECUTE 'CREATE TRIGGER storage_invoice_branding_immutable BEFORE UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_branding_asset_mutation()';
    EXECUTE 'DROP POLICY IF EXISTS phase4b_invoice_branding_insert ON storage.objects';
    EXECUTE $p$CREATE POLICY phase4b_invoice_branding_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
      bucket_id='branch-assets' AND (storage.foldername(name))[1]='invoice-branding'
      AND (storage.foldername(name))[2]=public.get_my_tenant_id()::TEXT
      AND ((public.get_my_role()::TEXT='owner') OR ((storage.foldername(name))[3]=public.get_my_branch_id()::TEXT))
      AND name ~ '^invoice-branding/[0-9a-f-]{36}/[0-9a-f-]{36}/[1-9][0-9]*/logo\.(png|jpg|jpeg|webp)$'
    )$p$;
    -- Deliberately no UPDATE/DELETE policy; the trigger also defeats any older
    -- permissive bucket policy because PostgreSQL combines permissive policies.
  END IF;
END $$;
