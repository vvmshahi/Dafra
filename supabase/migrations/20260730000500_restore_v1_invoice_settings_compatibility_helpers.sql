-- Restore the V1 presentation compatibility helpers that exist in the hosted
-- schema but were missing from the forward migration chain. The current
-- settings read RPC still uses the canonicalizer for legacy/partial rows.
--
-- These helpers are internal implementation details. They run with row
-- security disabled, so direct browser execution must remain revoked.

CREATE OR REPLACE FUNCTION public.v1_default_invoice_presentation_settings(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $default$
DECLARE
  b RECORD;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'language', CASE WHEN b.invoice_language IN ('en','ar','both') THEN b.invoice_language ELSE 'both' END,
    'after_sale_action', CASE WHEN b.print_mode = 'pdf' THEN 'a4' WHEN b.print_mode = 'both' THEN 'both' ELSE 'receipt' END,
    'branding', jsonb_build_object(
      'heading_mode', 'branch',
      'custom_heading', NULL,
      'subheading', NULL,
      'show_company_name', TRUE,
      'logo_path', b.logo_url,
      'logo_size', 'medium'
    ),
    'contact', jsonb_build_object(
      'show_phone', b.phone IS NOT NULL,
      'phone_override', b.phone,
      'show_email', COALESCE(b.show_email, b.email IS NOT NULL),
      'email', b.email,
      'show_website', COALESCE(b.show_website, b.website IS NOT NULL),
      'website', b.website,
      'show_address', TRUE,
      'address_override', NULL
    ),
    'footer', jsonb_build_object('message', b.receipt_footer, 'bold', FALSE),
    'thermal', jsonb_build_object(
      'width', '80mm',
      'density', 'standard',
      'qr_size', 'medium',
      'qr_alignment', 'center'
    ),
    'a4', jsonb_build_object('theme', 'classic')
  );
END;
$default$;

CREATE OR REPLACE FUNCTION public.v1_canonicalize_invoice_presentation_settings(
  p_settings JSONB,
  p_branch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $canonicalize$
DECLARE
  b RECORD;
  raw JSONB := COALESCE(p_settings, '{}'::JSONB);
  identity JSONB := COALESCE(raw->'identity', '{}'::JSONB);
  branding JSONB := COALESCE(raw->'branding', '{}'::JSONB);
  contact JSONB := COALESCE(raw->'contact', '{}'::JSONB);
  footer JSONB := COALESCE(raw->'footer', '{}'::JSONB);
  logo JSONB := COALESCE(raw->'logo', '{}'::JSONB);
  thermal JSONB := COALESCE(raw->'thermal', '{}'::JSONB);
  a4 JSONB := COALESCE(raw->'a4', '{}'::JSONB);
  heading TEXT;
  heading_mode TEXT;
  logo_path TEXT;
  logo_size TEXT;
  qr_size TEXT;
  action TEXT;
  language TEXT;
  extras JSONB;
  result JSONB;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(raw) <> 'object' THEN
    RAISE EXCEPTION 'presentation_settings must be an object' USING ERRCODE = '22023';
  END IF;
  IF raw ?| ARRAY[
    'compliance','zatca','registeredSellerName','vatNumber',
    'registrationIdentifier','certificate','csid'
  ] THEN
    RAISE EXCEPTION 'Compliance identity fields are not accepted' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(raw->'branding', '{}'::JSONB)) <> 'object'
    OR jsonb_typeof(COALESCE(raw->'contact', '{}'::JSONB)) <> 'object'
    OR jsonb_typeof(COALESCE(raw->'footer', '{}'::JSONB)) <> 'object'
    OR jsonb_typeof(COALESCE(raw->'thermal', '{}'::JSONB)) <> 'object'
    OR jsonb_typeof(COALESCE(raw->'a4', '{}'::JSONB)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid presentation section' USING ERRCODE = '22023';
  END IF;

  heading := NULLIF(BTRIM(COALESCE(
    branding->>'custom_heading',
    identity->>'display_heading',
    ''
  )), '');
  heading_mode := COALESCE(
    branding->>'heading_mode',
    CASE WHEN heading IS NULL OR heading = b.name THEN 'branch' ELSE 'custom' END
  );
  IF heading_mode NOT IN ('branch','custom') THEN
    RAISE EXCEPTION 'Invalid heading mode' USING ERRCODE = '22023';
  END IF;
  IF heading_mode = 'branch' THEN
    heading := NULL;
  END IF;
  IF LENGTH(COALESCE(heading, '')) > 160
    OR LENGTH(COALESCE(branding->>'subheading', identity->>'display_subheading', '')) > 160 THEN
    RAISE EXCEPTION 'Heading is too long' USING ERRCODE = '22023';
  END IF;

  logo_path := NULLIF(BTRIM(COALESCE(
    branding->>'logo_path',
    logo->>'asset_path',
    b.logo_url,
    ''
  )), '');
  logo_size := COALESCE(branding->>'logo_size', logo->>'size', 'medium');
  IF logo_size NOT IN ('small','medium','large') THEN
    RAISE EXCEPTION 'Invalid logo size' USING ERRCODE = '22023';
  END IF;
  IF logo_path IS NOT NULL
    AND logo_path !~ ('^' || p_branch_id::TEXT || '/logo\.(jpg|jpeg|png|webp)$')
    AND logo_path !~ '^invoice-branding/[^/]+/[^/]+/[0-9]+/logo\.(jpg|jpeg|png|webp)$'
    AND logo_path !~ '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Invalid V1 logo path' USING ERRCODE = '22023';
  END IF;

  language := COALESCE(
    raw->>'language',
    raw->>'invoice_language',
    CASE WHEN b.invoice_language IN ('en','ar','both') THEN b.invoice_language ELSE 'both' END
  );
  IF language NOT IN ('en','ar','both') THEN
    RAISE EXCEPTION 'Invalid invoice language' USING ERRCODE = '22023';
  END IF;
  action := COALESCE(raw->>'after_sale_action', 'receipt');
  action := CASE action
    WHEN 'thermal' THEN 'receipt'
    WHEN 'pdf' THEN 'a4'
    WHEN 'ask' THEN 'receipt'
    WHEN 'none' THEN 'receipt'
    ELSE action
  END;
  IF action NOT IN ('receipt','a4','both') THEN
    RAISE EXCEPTION 'Invalid after-sale action' USING ERRCODE = '22023';
  END IF;

  qr_size := COALESCE(thermal->>'qr_size', 'medium');
  qr_size := CASE qr_size WHEN 'standard' THEN 'medium' ELSE qr_size END;
  IF thermal->>'width' IS NOT NULL AND thermal->>'width' NOT IN ('58mm','80mm') THEN
    RAISE EXCEPTION 'Invalid thermal width' USING ERRCODE = '22023';
  END IF;
  IF thermal->>'density' IS NOT NULL
    AND thermal->>'density' NOT IN ('compact','standard','detailed') THEN
    RAISE EXCEPTION 'Invalid thermal density' USING ERRCODE = '22023';
  END IF;
  IF qr_size NOT IN ('small','medium','large') THEN
    RAISE EXCEPTION 'Invalid QR size' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(thermal->>'qr_alignment', 'center') NOT IN ('left','center','right') THEN
    RAISE EXCEPTION 'Invalid QR alignment' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(a4->>'theme', a4->>'template_id', 'classic')
    NOT IN ('classic','modern_split','minimal_professional') THEN
    RAISE EXCEPTION 'Invalid A4 theme' USING ERRCODE = '22023';
  END IF;
  IF footer ? 'bold' AND jsonb_typeof(footer->'bold') <> 'boolean' THEN
    RAISE EXCEPTION 'Invalid footer bold value' USING ERRCODE = '22023';
  END IF;

  extras := raw - ARRAY[
    'schema_version','language','invoice_language','after_sale_action',
    'branding','identity','contact','footer','logo','thermal','a4','print_mode',
    'display_name','phone','show_logo','logo_url','website','email',
    'show_website','show_email','receipt_footer','show_footer','show_cash_change',
    'branch_id','can_edit','role','compliance','zatca','registeredSellerName',
    'vatNumber','registrationIdentifier','certificate','csid'
  ];
  result := jsonb_build_object(
    'schema_version', 1,
    'language', language,
    'after_sale_action', action,
    'branding', jsonb_build_object(
      'heading_mode', heading_mode,
      'custom_heading', heading,
      'subheading', NULLIF(BTRIM(COALESCE(
        branding->>'subheading',
        identity->>'display_subheading',
        ''
      )), ''),
      'show_company_name', COALESCE(
        (branding->>'show_company_name')::BOOLEAN,
        (identity->>'show_company_name')::BOOLEAN,
        TRUE
      ),
      'logo_path', logo_path,
      'logo_size', logo_size
    ),
    'contact', jsonb_build_object(
      'show_phone', COALESCE((contact->>'show_phone')::BOOLEAN, FALSE),
      'phone_override', NULLIF(BTRIM(COALESCE(
        contact->>'phone_override',
        contact->>'phone',
        ''
      )), ''),
      'show_email', COALESCE((contact->>'show_email')::BOOLEAN, FALSE),
      'email', NULLIF(BTRIM(COALESCE(contact->>'email', '')), ''),
      'show_website', COALESCE((contact->>'show_website')::BOOLEAN, FALSE),
      'website', NULLIF(BTRIM(COALESCE(contact->>'website', '')), ''),
      'show_address', COALESCE((contact->>'show_address')::BOOLEAN, TRUE),
      'address_override', NULLIF(BTRIM(COALESCE(contact->>'address_override', '')), '')
    ),
    'footer', jsonb_build_object(
      'message', NULLIF(BTRIM(COALESCE(
        footer->>'message',
        footer->>'footer_note',
        ''
      )), ''),
      'bold', COALESCE((footer->>'bold')::BOOLEAN, FALSE)
    ),
    'thermal', jsonb_build_object(
      'width', COALESCE(thermal->>'width', '80mm'),
      'density', COALESCE(thermal->>'density', 'standard'),
      'qr_size', qr_size,
      'qr_alignment', COALESCE(thermal->>'qr_alignment', 'center')
    ),
    'a4', jsonb_build_object(
      'theme', COALESCE(a4->>'theme', a4->>'template_id', 'classic')
    )
  );
  RETURN extras || result;
END;
$canonicalize$;

CREATE OR REPLACE FUNCTION public.v1_merge_invoice_presentation_settings(
  p_base JSONB,
  p_incoming JSONB
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $merge$
  SELECT jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            COALESCE(p_base, '{}'::JSONB)
              || (COALESCE(p_incoming, '{}'::JSONB)
                - ARRAY['branding','contact','footer','thermal','a4']),
            '{branding}',
            COALESCE(p_base->'branding','{}'::JSONB)
              || COALESCE(p_incoming->'branding','{}'::JSONB),
            TRUE
          ),
          '{contact}',
          COALESCE(p_base->'contact','{}'::JSONB)
            || COALESCE(p_incoming->'contact','{}'::JSONB),
          TRUE
        ),
        '{footer}',
        COALESCE(p_base->'footer','{}'::JSONB)
          || COALESCE(p_incoming->'footer','{}'::JSONB),
        TRUE
      ),
      '{thermal}',
      COALESCE(p_base->'thermal','{}'::JSONB)
        || COALESCE(p_incoming->'thermal','{}'::JSONB),
      TRUE
    ),
    '{a4}',
    COALESCE(p_base->'a4','{}'::JSONB)
      || COALESCE(p_incoming->'a4','{}'::JSONB),
    TRUE
  );
$merge$;

REVOKE ALL ON FUNCTION public.v1_default_invoice_presentation_settings(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v1_canonicalize_invoice_presentation_settings(JSONB, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.v1_merge_invoice_presentation_settings(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.v1_default_invoice_presentation_settings(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.v1_canonicalize_invoice_presentation_settings(JSONB, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.v1_merge_invoice_presentation_settings(JSONB, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.v1_default_invoice_presentation_settings(UUID) IS
  'Internal legacy invoice-presentation default helper; direct browser execution is forbidden.';
COMMENT ON FUNCTION public.v1_canonicalize_invoice_presentation_settings(JSONB, UUID) IS
  'Internal legacy invoice-presentation canonicalizer; direct browser execution is forbidden.';
COMMENT ON FUNCTION public.v1_merge_invoice_presentation_settings(JSONB, JSONB) IS
  'Internal legacy invoice-presentation merge helper; direct browser execution is forbidden.';
