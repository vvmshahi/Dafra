BEGIN;

-- A4 presentation only. This migration does not read or rewrite invoices,
-- checkout, payments, stock, customers, fiscal XML, or QR payloads.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoice-artwork',
  'invoice-artwork',
  FALSE,
  8388608,
  ARRAY['image/jpeg','image/png','image/webp']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = 8388608,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::TEXT[];

-- The old public branch-assets bucket remains available for historical logos,
-- but new letterhead derivatives are accepted only by the private bucket.
DO $storage_policies$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;

  DROP POLICY IF EXISTS phase5b_invoice_branding_insert ON storage.objects;
  CREATE POLICY phase5b_invoice_branding_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'branch-assets'
      AND (storage.foldername(name))[1] = 'invoice-branding'
      AND (storage.foldername(name))[2] = public.get_my_tenant_id()::TEXT
      AND (
        public.get_my_role()::TEXT = 'owner'
        OR (storage.foldername(name))[3] = public.get_my_branch_id()::TEXT
      )
      AND name ~ '^invoice-branding/[0-9a-f-]{36}/[0-9a-f-]{36}/[1-9][0-9]*/logo\.(png|jpg|jpeg|webp)$'
    );

  DROP POLICY IF EXISTS a4_invoice_artwork_insert ON storage.objects;
  DROP POLICY IF EXISTS a4_invoice_artwork_select ON storage.objects;
  DROP POLICY IF EXISTS a4_invoice_artwork_update ON storage.objects;
  DROP POLICY IF EXISTS a4_invoice_artwork_delete ON storage.objects;

  CREATE POLICY a4_invoice_artwork_insert ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
      bucket_id = 'invoice-artwork'
      AND (storage.foldername(name))[1] = 'tenant'
      AND (storage.foldername(name))[2] = public.get_my_tenant_id()::TEXT
      AND (storage.foldername(name))[3] = 'branch'
      AND (storage.foldername(name))[5] = 'invoice-artwork'
      AND name ~ '^tenant/[0-9a-f-]{36}/branch/[0-9a-f-]{36}/invoice-artwork/[0-9a-f-]{36}/(header|footer)\.(png|jpg|jpeg|webp)$'
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR b.id = public.get_my_branch_id()
          )
      )
    );

  CREATE POLICY a4_invoice_artwork_select ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'invoice-artwork'
      AND (storage.foldername(name))[1] = 'tenant'
      AND (storage.foldername(name))[2] = public.get_my_tenant_id()::TEXT
      AND (storage.foldername(name))[3] = 'branch'
      AND (storage.foldername(name))[5] = 'invoice-artwork'
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR b.id = public.get_my_branch_id()
          )
      )
    );

  CREATE POLICY a4_invoice_artwork_update ON storage.objects
    FOR UPDATE TO authenticated
    USING (
      bucket_id = 'invoice-artwork'
      AND (storage.foldername(name))[2] = public.get_my_tenant_id()::TEXT
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR b.id = public.get_my_branch_id()
          )
      )
    )
    WITH CHECK (
      bucket_id = 'invoice-artwork'
      AND (storage.foldername(name))[1] = 'tenant'
      AND (storage.foldername(name))[2] = public.get_my_tenant_id()::TEXT
      AND (storage.foldername(name))[3] = 'branch'
      AND (storage.foldername(name))[5] = 'invoice-artwork'
      AND name ~ '^tenant/[0-9a-f-]{36}/branch/[0-9a-f-]{36}/invoice-artwork/[0-9a-f-]{36}/(header|footer)\.(png|jpg|jpeg|webp)$'
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR b.id = public.get_my_branch_id()
          )
      )
    );

  CREATE POLICY a4_invoice_artwork_delete ON storage.objects
    FOR DELETE TO authenticated
    USING (
      bucket_id = 'invoice-artwork'
      AND (storage.foldername(name))[2] = public.get_my_tenant_id()::TEXT
      AND EXISTS (
        SELECT 1
        FROM public.branches b
        WHERE b.id::TEXT = (storage.foldername(name))[4]
          AND b.tenant_id = public.get_my_tenant_id()
          AND b.is_active
          AND (
            public.get_my_role()::TEXT = 'owner'
            OR b.id = public.get_my_branch_id()
          )
      )
    );
END;
$storage_policies$;

CREATE OR REPLACE FUNCTION public.validate_invoice_presentation_settings(
  p_settings JSONB,
  p_tenant_id UUID,
  p_branch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $validate$
DECLARE
  s JSONB := p_settings;
  direct_identity JSONB;
  direct_contact JSONB;
  direct_footer JSONB;
  direct_logo JSONB;
  direct_thermal JSONB;
  direct_a4 JSONB;
  a JSONB;
  v TEXT;
  n INTEGER;
  top_keys CONSTANT TEXT[] := ARRAY['schema_version','language','after_sale_action','branding','contact','footer','thermal','a4'];
  branding_keys CONSTANT TEXT[] := ARRAY['heading_mode','custom_heading','subheading','show_company_name','logo_path','logo_size'];
  contact_keys CONSTANT TEXT[] := ARRAY['show_phone','phone_override','show_email','email','show_website','website','show_address','address_override'];
  footer_keys CONSTANT TEXT[] := ARRAY['message','bold'];
  thermal_keys CONSTANT TEXT[] := ARRAY['width','density','qr_size','qr_alignment'];
  a4_keys CONSTANT TEXT[] := ARRAY[
    'theme','accent_color','heading_color','body_color','auto_foreground',
    'header_asset_path','header_asset_version','header_asset_enabled','header_asset_fit',
    'header_asset_height','header_asset_spacing','header_crop_top','header_crop_height',
    'footer_asset_path','footer_asset_version','footer_asset_enabled','footer_asset_fit',
    'footer_asset_height','footer_asset_spacing','footer_crop_top','footer_crop_height',
    'artwork_scope','artwork_template_id'
  ];
BEGIN
  IF s IS NULL OR jsonb_typeof(s) <> 'object' THEN
    RAISE EXCEPTION 'presentation_settings must be an object' USING ERRCODE = '22023';
  END IF;

  -- Normalize the historical direct V1 object without changing its meaning.
  IF s ? 'identity' THEN
    direct_identity := COALESCE(s->'identity', '{}'::JSONB);
    direct_contact := COALESCE(s->'contact', '{}'::JSONB);
    direct_footer := COALESCE(s->'footer', '{}'::JSONB);
    direct_logo := COALESCE(s->'logo', '{}'::JSONB);
    direct_thermal := COALESCE(s->'thermal', '{}'::JSONB);
    direct_a4 := COALESCE(s->'a4', '{}'::JSONB);
    s := jsonb_build_object(
      'schema_version', 1,
      'language', 'both',
      'after_sale_action', 'receipt',
      'branding', jsonb_build_object(
        'heading_mode', COALESCE(direct_identity->>'heading_mode','branch'),
        'custom_heading', COALESCE(direct_identity->'display_heading','null'::JSONB),
        'subheading', COALESCE(direct_identity->'display_subheading','null'::JSONB),
        'show_company_name', COALESCE(direct_identity->'show_company_name','true'::JSONB),
        'logo_path', COALESCE(direct_logo->'asset_path','null'::JSONB),
        'logo_size', COALESCE(direct_logo->>'size','medium')
      ),
      'contact', jsonb_build_object(
        'show_phone', COALESCE(direct_contact->'show_phone','false'::JSONB),
        'phone_override', COALESCE(direct_contact->'phone','null'::JSONB),
        'show_email', COALESCE(direct_contact->'show_email','false'::JSONB),
        'email', COALESCE(direct_contact->'email','null'::JSONB),
        'show_website', COALESCE(direct_contact->'show_website','false'::JSONB),
        'website', COALESCE(direct_contact->'website','null'::JSONB),
        'show_address', COALESCE(direct_contact->'show_address','true'::JSONB),
        'address_override', COALESCE(direct_contact->'address_override','null'::JSONB)
      ),
      'footer', jsonb_build_object(
        'message', COALESCE(direct_footer->'footer_note','null'::JSONB),
        'bold', COALESCE(direct_footer->'bold','false'::JSONB)
      ),
      'thermal', jsonb_build_object(
        'width', COALESCE(direct_thermal->>'width','80mm'),
        'density', COALESCE(direct_thermal->>'density','standard'),
        'qr_size', CASE WHEN direct_thermal->>'qr_size' = 'standard' THEN 'medium' ELSE COALESCE(direct_thermal->>'qr_size','medium') END,
        'qr_alignment', 'center'
      ),
      'a4', jsonb_build_object(
        'theme', COALESCE(direct_a4->>'template_id','classic'),
        'accent_color', COALESCE(direct_a4->>'accent_color','#0f766e'),
        'heading_color', COALESCE(direct_a4->>'heading_color','#10251a'),
        'body_color', COALESCE(direct_a4->>'body_color','#1f2937'),
        'auto_foreground', COALESCE(direct_a4->'auto_foreground','true'::JSONB),
        'header_asset_path', COALESCE(direct_a4->'header_asset_path','null'::JSONB),
        'header_asset_version', COALESCE(direct_a4->'header_asset_version','1'::JSONB),
        'header_asset_enabled', COALESCE(direct_a4->'header_asset_enabled','false'::JSONB),
        'header_asset_fit', COALESCE(direct_a4->>'header_asset_fit','contain'),
        'header_asset_height', COALESCE(direct_a4->'header_asset_height','28'::JSONB),
        'header_asset_spacing', COALESCE(direct_a4->'header_asset_spacing','6'::JSONB),
        'header_crop_top', COALESCE(direct_a4->'header_crop_top','0'::JSONB),
        'header_crop_height', COALESCE(direct_a4->'header_crop_height','18'::JSONB),
        'footer_asset_path', COALESCE(direct_a4->'footer_asset_path','null'::JSONB),
        'footer_asset_version', COALESCE(direct_a4->'footer_asset_version','1'::JSONB),
        'footer_asset_enabled', COALESCE(direct_a4->'footer_asset_enabled','false'::JSONB),
        'footer_asset_fit', COALESCE(direct_a4->>'footer_asset_fit','contain'),
        'footer_asset_height', COALESCE(direct_a4->'footer_asset_height','10'::JSONB),
        'footer_asset_spacing', COALESCE(direct_a4->'footer_asset_spacing','4'::JSONB),
        'footer_crop_top', COALESCE(direct_a4->'footer_crop_top','92'::JSONB),
        'footer_crop_height', COALESCE(direct_a4->'footer_crop_height','8'::JSONB),
        'artwork_scope', COALESCE(direct_a4->>'artwork_scope','all'),
        'artwork_template_id', COALESCE(direct_a4->>'artwork_template_id', direct_a4->>'template_id', 'classic')
      )
    );
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_object_keys(s) k WHERE k <> ALL(top_keys)) THEN
    RAISE EXCEPTION 'Unknown presentation_settings key' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((s->>'schema_version')::INTEGER, 0) <> 1 THEN
    RAISE EXCEPTION 'Unsupported presentation settings schema_version' USING ERRCODE = '22023';
  END IF;
  IF s->>'language' NOT IN ('ar','both')
    OR s->>'after_sale_action' NOT IN ('receipt','a4','both') THEN
    RAISE EXCEPTION 'Invalid presentation language or action' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(s->'branding') k WHERE k <> ALL(branding_keys))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(s->'contact') k WHERE k <> ALL(contact_keys))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(s->'footer') k WHERE k <> ALL(footer_keys))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(s->'thermal') k WHERE k <> ALL(thermal_keys))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(s->'a4') k WHERE k <> ALL(a4_keys)) THEN
    RAISE EXCEPTION 'Unknown presentation section key' USING ERRCODE = '22023';
  END IF;

  IF s->'branding'->>'heading_mode' NOT IN ('branch','custom')
    OR s->'branding'->>'logo_size' NOT IN ('small','medium','large')
    OR jsonb_typeof(s->'branding'->'show_company_name') <> 'boolean' THEN
    RAISE EXCEPTION 'Invalid branding setting' USING ERRCODE = '22023';
  END IF;
  IF length(COALESCE(s->'branding'->>'custom_heading','')) > 160
    OR length(COALESCE(s->'branding'->>'subheading','')) > 160 THEN
    RAISE EXCEPTION 'Branding text is too long' USING ERRCODE = '22023';
  END IF;
  v := NULLIF(btrim(COALESCE(s->'branding'->>'logo_path','')), '');
  IF v IS NOT NULL
    AND v !~ ('^invoice-branding/'||p_tenant_id::TEXT||'/'||p_branch_id::TEXT||'/[1-9][0-9]*/logo\.(png|jpg|jpeg|webp)$') THEN
    RAISE EXCEPTION 'Invalid immutable logo path' USING ERRCODE = '22023';
  END IF;

  FOREACH v IN ARRAY ARRAY['show_phone','show_email','show_website','show_address'] LOOP
    IF jsonb_typeof(s->'contact'->v) <> 'boolean' THEN
      RAISE EXCEPTION 'Invalid contact boolean' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF length(COALESCE(s->'contact'->>'phone_override','')) > 50
    OR length(COALESCE(s->'contact'->>'email','')) > 255
    OR length(COALESCE(s->'contact'->>'website','')) > 255
    OR length(COALESCE(s->'contact'->>'address_override','')) > 500 THEN
    RAISE EXCEPTION 'Contact field is too long' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(s->'contact'->>'email','') <> ''
    AND s->'contact'->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invalid email' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(s->'contact'->>'website','') <> ''
    AND s->'contact'->>'website' !~ '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Website must use https' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(s->'footer'->'bold') <> 'boolean'
    OR length(COALESCE(s->'footer'->>'message','')) > 500 THEN
    RAISE EXCEPTION 'Invalid footer setting' USING ERRCODE = '22023';
  END IF;
  IF s->'thermal'->>'width' NOT IN ('58mm','80mm')
    OR s->'thermal'->>'density' NOT IN ('compact','standard','detailed')
    OR s->'thermal'->>'qr_size' NOT IN ('small','medium','large')
    OR s->'thermal'->>'qr_alignment' <> 'center' THEN
    RAISE EXCEPTION 'Invalid thermal setting' USING ERRCODE = '22023';
  END IF;

  a := s->'a4';
  IF a->>'theme' NOT IN ('classic','modern_split','minimal_professional','executive_green','clean_ledger','contemporary_border')
    OR a->>'artwork_template_id' NOT IN ('classic','modern_split','minimal_professional','executive_green','clean_ledger','contemporary_border')
    OR a->>'artwork_scope' NOT IN ('selected','all') THEN
    RAISE EXCEPTION 'Invalid A4 layout setting' USING ERRCODE = '22023';
  END IF;
  FOREACH v IN ARRAY ARRAY['accent_color','heading_color','body_color'] LOOP
    IF COALESCE(a->>v,'') !~ '^#[0-9A-Fa-f]{6}$' THEN
      RAISE EXCEPTION 'Invalid A4 colour: %', v USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOREACH v IN ARRAY ARRAY['auto_foreground','header_asset_enabled','footer_asset_enabled'] LOOP
    IF jsonb_typeof(a->v) <> 'boolean' THEN
      RAISE EXCEPTION 'Invalid A4 boolean: %', v USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF a->>'header_asset_fit' NOT IN ('contain','cover')
    OR a->>'footer_asset_fit' NOT IN ('contain','cover') THEN
    RAISE EXCEPTION 'Invalid artwork fit' USING ERRCODE = '22023';
  END IF;
  FOREACH v IN ARRAY ARRAY[
    'header_asset_version','header_asset_height','header_asset_spacing','header_crop_top','header_crop_height',
    'footer_asset_version','footer_asset_height','footer_asset_spacing','footer_crop_top','footer_crop_height'
  ] LOOP
    IF COALESCE(a->>v,'') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid numeric A4 setting: %', v USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (a->>'header_asset_version')::INTEGER < 1
    OR (a->>'footer_asset_version')::INTEGER < 1
    OR (a->>'header_asset_height')::INTEGER NOT BETWEEN 8 AND 70
    OR (a->>'footer_asset_height')::INTEGER NOT BETWEEN 4 AND 35
    OR (a->>'header_asset_spacing')::INTEGER NOT BETWEEN 0 AND 16
    OR (a->>'footer_asset_spacing')::INTEGER NOT BETWEEN 0 AND 16
    OR (a->>'header_crop_top')::INTEGER NOT BETWEEN 0 AND 99
    OR (a->>'header_crop_height')::INTEGER NOT BETWEEN 1 AND 100
    OR (a->>'footer_crop_top')::INTEGER NOT BETWEEN 0 AND 99
    OR (a->>'footer_crop_height')::INTEGER NOT BETWEEN 1 AND 100
    OR (a->>'header_crop_top')::INTEGER + (a->>'header_crop_height')::INTEGER > 100
    OR (a->>'footer_crop_top')::INTEGER + (a->>'footer_crop_height')::INTEGER > 100 THEN
    RAISE EXCEPTION 'A4 artwork dimensions are outside the safe range' USING ERRCODE = '22023';
  END IF;

  v := NULLIF(btrim(COALESCE(a->>'header_asset_path','')), '');
  IF v IS NOT NULL
    AND v !~ ('^tenant/'||p_tenant_id::TEXT||'/branch/'||p_branch_id::TEXT||'/invoice-artwork/[0-9a-f-]{36}/header\.(png|jpg|jpeg|webp)$') THEN
    RAISE EXCEPTION 'Invalid private header artwork path' USING ERRCODE = '22023';
  END IF;
  v := NULLIF(btrim(COALESCE(a->>'footer_asset_path','')), '');
  IF v IS NOT NULL
    AND v !~ ('^tenant/'||p_tenant_id::TEXT||'/branch/'||p_branch_id::TEXT||'/invoice-artwork/[0-9a-f-]{36}/footer\.(png|jpg|jpeg|webp)$') THEN
    RAISE EXCEPTION 'Invalid private footer artwork path' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'language', s->>'language',
    'after_sale_action', s->>'after_sale_action',
    'branding', jsonb_build_object(
      'heading_mode', s#>>'{branding,heading_mode}',
      'custom_heading', NULLIF(btrim(s#>>'{branding,custom_heading}'),''),
      'subheading', NULLIF(btrim(s#>>'{branding,subheading}'),''),
      'show_company_name', (s#>>'{branding,show_company_name}')::BOOLEAN,
      'logo_path', NULLIF(btrim(s#>>'{branding,logo_path}'),''),
      'logo_size', s#>>'{branding,logo_size}'
    ),
    'contact', jsonb_build_object(
      'show_phone', (s#>>'{contact,show_phone}')::BOOLEAN,
      'phone_override', NULLIF(btrim(s#>>'{contact,phone_override}'),''),
      'show_email', (s#>>'{contact,show_email}')::BOOLEAN,
      'email', NULLIF(btrim(s#>>'{contact,email}'),''),
      'show_website', (s#>>'{contact,show_website}')::BOOLEAN,
      'website', NULLIF(btrim(s#>>'{contact,website}'),''),
      'show_address', (s#>>'{contact,show_address}')::BOOLEAN,
      'address_override', NULLIF(btrim(s#>>'{contact,address_override}'),'')
    ),
    'footer', jsonb_build_object(
      'message', NULLIF(btrim(s#>>'{footer,message}'),''),
      'bold', (s#>>'{footer,bold}')::BOOLEAN
    ),
    'thermal', s->'thermal',
    'a4', jsonb_build_object(
      'theme', a->>'theme',
      'accent_color', lower(a->>'accent_color'),
      'heading_color', lower(a->>'heading_color'),
      'body_color', lower(a->>'body_color'),
      'auto_foreground', (a->>'auto_foreground')::BOOLEAN,
      'header_asset_path', NULLIF(btrim(a->>'header_asset_path'),''),
      'header_asset_version', (a->>'header_asset_version')::INTEGER,
      'header_asset_enabled', (a->>'header_asset_enabled')::BOOLEAN,
      'header_asset_fit', a->>'header_asset_fit',
      'header_asset_height', (a->>'header_asset_height')::INTEGER,
      'header_asset_spacing', (a->>'header_asset_spacing')::INTEGER,
      'header_crop_top', (a->>'header_crop_top')::INTEGER,
      'header_crop_height', (a->>'header_crop_height')::INTEGER,
      'footer_asset_path', NULLIF(btrim(a->>'footer_asset_path'),''),
      'footer_asset_version', (a->>'footer_asset_version')::INTEGER,
      'footer_asset_enabled', (a->>'footer_asset_enabled')::BOOLEAN,
      'footer_asset_fit', a->>'footer_asset_fit',
      'footer_asset_height', (a->>'footer_asset_height')::INTEGER,
      'footer_asset_spacing', (a->>'footer_asset_spacing')::INTEGER,
      'footer_crop_top', (a->>'footer_crop_top')::INTEGER,
      'footer_crop_height', (a->>'footer_crop_height')::INTEGER,
      'artwork_scope', a->>'artwork_scope',
      'artwork_template_id', a->>'artwork_template_id'
    )
  );
END;
$validate$;

CREATE OR REPLACE FUNCTION public.default_invoice_presentation_settings(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $defaults$
DECLARE
  b RECORD;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id = p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'schema_version', 1,
    'language', CASE WHEN b.invoice_language = 'ar' THEN 'ar' ELSE 'both' END,
    'after_sale_action', CASE WHEN b.print_mode = 'pdf' THEN 'a4' WHEN b.print_mode = 'both' THEN 'both' ELSE 'receipt' END,
    'branding', jsonb_build_object(
      'heading_mode', 'branch',
      'custom_heading', NULL,
      'subheading', b.invoice_display_subheading,
      'show_company_name', COALESCE(b.show_company_display_name, TRUE),
      'logo_path', CASE WHEN COALESCE(b.logo_url,'') ~ '^invoice-branding/' THEN b.logo_url ELSE NULL END,
      'logo_size', 'medium'
    ),
    'contact', jsonb_build_object(
      'show_phone', b.phone IS NOT NULL, 'phone_override', b.phone,
      'show_email', COALESCE(b.show_email,b.email IS NOT NULL), 'email', b.email,
      'show_website', COALESCE(b.show_website,b.website IS NOT NULL), 'website', b.website,
      'show_address', TRUE, 'address_override', b.address
    ),
    'footer', jsonb_build_object('message', b.receipt_footer, 'bold', COALESCE(b.show_footer,TRUE)),
    'thermal', jsonb_build_object(
      'width','80mm','density',COALESCE(b.thermal_density,'standard'),
      'qr_size','medium','qr_alignment','center'
    ),
    'a4', jsonb_build_object(
      'theme', CASE WHEN b.a4_template_id IN ('classic','modern_split','minimal_professional','executive_green','clean_ledger','contemporary_border') THEN b.a4_template_id ELSE 'classic' END,
      'accent_color','#0f766e','heading_color','#10251a','body_color','#1f2937','auto_foreground',TRUE,
      'header_asset_path',NULL,'header_asset_version',1,'header_asset_enabled',FALSE,'header_asset_fit','contain',
      'header_asset_height',28,'header_asset_spacing',6,'header_crop_top',0,'header_crop_height',18,
      'footer_asset_path',NULL,'footer_asset_version',1,'footer_asset_enabled',FALSE,'footer_asset_fit','contain',
      'footer_asset_height',10,'footer_asset_spacing',4,'footer_crop_top',92,'footer_crop_height',8,
      'artwork_scope','all','artwork_template_id','classic'
    )
  );
END;
$defaults$;

CREATE OR REPLACE FUNCTION public.resolve_invoice_presentation_settings(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $resolve$
DECLARE
  b RECORD;
  s JSONB;
BEGIN
  SELECT id, tenant_id, presentation_settings INTO b
  FROM public.branches
  WHERE id = p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501'; END IF;
  s := COALESCE(b.presentation_settings, public.default_invoice_presentation_settings(p_branch_id));
  RETURN public.validate_invoice_presentation_settings(s, b.tenant_id, b.id);
END;
$resolve$;

CREATE OR REPLACE FUNCTION public.update_branch_invoice_settings(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $update$
DECLARE
  uid UUID := auth.uid();
  u RECORD;
  b RECORD;
  s JSONB;
  lang TEXT;
  mode TEXT;
  allowed CONSTANT TEXT[] := ARRAY[
    'branch_id','invoice_language','print_mode','presentation_settings',
    'display_name','phone','show_logo','logo_url','website','email',
    'show_website','show_email','receipt_footer','show_footer','show_cash_change'
  ];
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k <> ALL(allowed)) THEN
    RAISE EXCEPTION 'Unknown or invalid invoice settings key' USING ERRCODE = '22023';
  END IF;
  SELECT id, tenant_id, branch_id, role::TEXT AS role, is_active
    INTO u FROM public.user_profiles WHERE id = uid;
  SELECT * INTO b
    FROM public.branches
    WHERE id = NULLIF(btrim(p_payload->>'branch_id'),'')::UUID
    FOR UPDATE;
  IF NOT FOUND OR NOT b.is_active OR NOT u.is_active
    OR NOT (
      (u.role = 'owner' AND u.tenant_id = b.tenant_id)
      OR (u.role = 'branch' AND u.tenant_id = b.tenant_id AND u.branch_id = b.id)
    ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  lang := COALESCE(NULLIF(p_payload->>'invoice_language',''), b.invoice_language, 'both');
  mode := COALESCE(NULLIF(p_payload->>'print_mode',''), b.print_mode, 'thermal');
  IF lang NOT IN ('en','ar','both') OR mode NOT IN ('thermal','pdf','both') THEN
    RAISE EXCEPTION 'Invalid operational document defaults' USING ERRCODE = '22023';
  END IF;
  s := CASE WHEN p_payload ? 'presentation_settings'
    THEN p_payload->'presentation_settings'
    ELSE public.resolve_invoice_presentation_settings(b.id)
  END;
  s := public.validate_invoice_presentation_settings(s, b.tenant_id, b.id);
  UPDATE public.branches
    SET presentation_settings = s,
        invoice_language = lang,
        print_mode = mode,
        updated_at = NOW()
    WHERE id = b.id;
  PERFORM public.record_audit_event(
    'branch_invoice_settings_updated', b.tenant_id, b.id, uid, u.role,
    'branch', b.id, 'info', 'succeeded',
    jsonb_build_object(
      'schema_version',1,
      'invoice_language',lang,
      'print_mode',mode,
      'template_id',s#>>'{a4,theme}',
      'header_artwork',s#>>'{a4,header_asset_enabled}',
      'footer_artwork',s#>>'{a4,footer_asset_enabled}'
    ),
    NULL, NULL
  );
  RETURN jsonb_build_object(
    'branch_id',b.id,
    'presentation_settings',s,
    'invoice_language',lang,
    'print_mode',mode,
    'can_edit',TRUE
  );
END;
$update$;

REVOKE ALL ON FUNCTION public.validate_invoice_presentation_settings(JSONB,UUID,UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_branch_invoice_settings(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_branch_invoice_settings(JSONB) TO authenticated;

COMMENT ON FUNCTION public.validate_invoice_presentation_settings(JSONB,UUID,UUID) IS
  'Validates branch-scoped, non-fiscal invoice presentation including six A4 layouts, colour tokens, and private header/footer artwork.';
COMMENT ON COLUMN public.branches.presentation_settings IS
  'Validated branch presentation preferences. A4 artwork contains private derivative paths only; fiscal identity and calculations are excluded.';

COMMIT;
