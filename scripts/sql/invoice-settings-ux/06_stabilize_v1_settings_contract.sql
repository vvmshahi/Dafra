-- V1 presentation-settings contract reconciliation.
-- Additive and idempotent. Review against the hosted function definitions before execution.
-- This package changes only the two presentation-settings RPCs. It does not touch
-- invoices, checkout, identity, Storage, buckets, policies, or migration history.
BEGIN;

CREATE OR REPLACE FUNCTION public.v1_default_invoice_presentation_settings(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE b record;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id = p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501'; END IF;
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
    'thermal', jsonb_build_object('width', '80mm', 'density', 'standard', 'qr_size', 'medium', 'qr_alignment', 'center'),
    'a4', jsonb_build_object('theme', 'classic')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.v1_canonicalize_invoice_presentation_settings(p_settings jsonb, p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  b record;
  raw jsonb := COALESCE(p_settings, '{}'::jsonb);
  identity jsonb := COALESCE(raw->'identity', '{}'::jsonb);
  branding jsonb := COALESCE(raw->'branding', '{}'::jsonb);
  contact jsonb := COALESCE(raw->'contact', '{}'::jsonb);
  footer jsonb := COALESCE(raw->'footer', '{}'::jsonb);
  logo jsonb := COALESCE(raw->'logo', '{}'::jsonb);
  thermal jsonb := COALESCE(raw->'thermal', '{}'::jsonb);
  a4 jsonb := COALESCE(raw->'a4', '{}'::jsonb);
  heading text;
  heading_mode text;
  logo_path text;
  logo_size text;
  qr_size text;
  action text;
  language text;
  extras jsonb;
  result jsonb;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id = p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(raw) <> 'object' THEN RAISE EXCEPTION 'presentation_settings must be an object' USING ERRCODE = '22023'; END IF;
  IF raw ?| ARRAY['compliance','zatca','registeredSellerName','vatNumber','registrationIdentifier','certificate','csid'] THEN
    RAISE EXCEPTION 'Compliance identity fields are not accepted' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(COALESCE(raw->'branding', '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(raw->'contact', '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(raw->'footer', '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(raw->'thermal', '{}'::jsonb)) <> 'object'
    OR jsonb_typeof(COALESCE(raw->'a4', '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid presentation section' USING ERRCODE = '22023';
  END IF;

  heading := NULLIF(BTRIM(COALESCE(branding->>'custom_heading', identity->>'display_heading', '')), '');
  heading_mode := COALESCE(branding->>'heading_mode', CASE WHEN heading IS NULL OR heading = b.name THEN 'branch' ELSE 'custom' END);
  IF heading_mode NOT IN ('branch','custom') THEN RAISE EXCEPTION 'Invalid heading mode' USING ERRCODE = '22023'; END IF;
  IF heading_mode = 'branch' THEN heading := NULL; END IF;
  IF LENGTH(COALESCE(heading, '')) > 160 OR LENGTH(COALESCE(branding->>'subheading', identity->>'display_subheading', '')) > 160 THEN
    RAISE EXCEPTION 'Heading is too long' USING ERRCODE = '22023';
  END IF;

  logo_path := NULLIF(BTRIM(COALESCE(branding->>'logo_path', logo->>'asset_path', b.logo_url, '')), '');
  logo_size := COALESCE(branding->>'logo_size', logo->>'size', 'medium');
  IF logo_size NOT IN ('small','medium','large') THEN RAISE EXCEPTION 'Invalid logo size' USING ERRCODE = '22023'; END IF;
  IF logo_path IS NOT NULL AND logo_path !~ ('^' || p_branch_id::text || '/logo\.(jpg|jpeg|png|webp)$')
    AND logo_path !~ '^invoice-branding/[^/]+/[^/]+/[0-9]+/logo\.(jpg|jpeg|png|webp)$'
    AND logo_path !~ '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Invalid V1 logo path' USING ERRCODE = '22023';
  END IF;

  language := COALESCE(raw->>'language', raw->>'invoice_language', CASE WHEN b.invoice_language IN ('en','ar','both') THEN b.invoice_language ELSE 'both' END);
  IF language NOT IN ('en','ar','both') THEN RAISE EXCEPTION 'Invalid invoice language' USING ERRCODE = '22023'; END IF;
  action := COALESCE(raw->>'after_sale_action', 'receipt');
  action := CASE action WHEN 'thermal' THEN 'receipt' WHEN 'pdf' THEN 'a4' WHEN 'ask' THEN 'receipt' WHEN 'none' THEN 'receipt' ELSE action END;
  IF action NOT IN ('receipt','a4','both') THEN RAISE EXCEPTION 'Invalid after-sale action' USING ERRCODE = '22023'; END IF;

  qr_size := COALESCE(thermal->>'qr_size', 'medium');
  qr_size := CASE qr_size WHEN 'standard' THEN 'medium' ELSE qr_size END;
  IF thermal->>'width' IS NOT NULL AND thermal->>'width' NOT IN ('58mm','80mm') THEN RAISE EXCEPTION 'Invalid thermal width' USING ERRCODE = '22023'; END IF;
  IF thermal->>'density' IS NOT NULL AND thermal->>'density' NOT IN ('compact','standard','detailed') THEN RAISE EXCEPTION 'Invalid thermal density' USING ERRCODE = '22023'; END IF;
  IF qr_size NOT IN ('small','medium','large') THEN RAISE EXCEPTION 'Invalid QR size' USING ERRCODE = '22023'; END IF;
  IF COALESCE(thermal->>'qr_alignment', 'center') NOT IN ('left','center','right') THEN RAISE EXCEPTION 'Invalid QR alignment' USING ERRCODE = '22023'; END IF;
  IF COALESCE(a4->>'theme', a4->>'template_id', 'classic') NOT IN ('classic','modern_split','minimal_professional') THEN RAISE EXCEPTION 'Invalid A4 theme' USING ERRCODE = '22023'; END IF;
  IF footer ? 'bold' AND jsonb_typeof(footer->'bold') <> 'boolean' THEN RAISE EXCEPTION 'Invalid footer bold value' USING ERRCODE = '22023'; END IF;

  extras := raw - ARRAY[
    'schema_version','language','invoice_language','after_sale_action','branding','identity','contact','footer','logo','thermal','a4','print_mode',
    'display_name','phone','show_logo','logo_url','website','email','show_website','show_email','receipt_footer','show_footer','show_cash_change',
    'branch_id','can_edit','role','compliance','zatca','registeredSellerName','vatNumber','registrationIdentifier','certificate','csid'
  ];
  result := jsonb_build_object(
    'schema_version', 1,
    'language', language,
    'after_sale_action', action,
    'branding', jsonb_build_object(
      'heading_mode', heading_mode,
      'custom_heading', heading,
      'subheading', NULLIF(BTRIM(COALESCE(branding->>'subheading', identity->>'display_subheading', '')), ''),
      'show_company_name', COALESCE((branding->>'show_company_name')::boolean, (identity->>'show_company_name')::boolean, TRUE),
      'logo_path', logo_path,
      'logo_size', logo_size
    ),
    'contact', jsonb_build_object(
      'show_phone', COALESCE((contact->>'show_phone')::boolean, FALSE),
      'phone_override', NULLIF(BTRIM(COALESCE(contact->>'phone_override', contact->>'phone', '')), ''),
      'show_email', COALESCE((contact->>'show_email')::boolean, FALSE),
      'email', NULLIF(BTRIM(COALESCE(contact->>'email', '')), ''),
      'show_website', COALESCE((contact->>'show_website')::boolean, FALSE),
      'website', NULLIF(BTRIM(COALESCE(contact->>'website', '')), ''),
      'show_address', COALESCE((contact->>'show_address')::boolean, TRUE),
      'address_override', NULLIF(BTRIM(COALESCE(contact->>'address_override', '')), '')
    ),
    'footer', jsonb_build_object(
      'message', NULLIF(BTRIM(COALESCE(footer->>'message', footer->>'footer_note', '')), ''),
      'bold', COALESCE((footer->>'bold')::boolean, FALSE)
    ),
    'thermal', jsonb_build_object(
      'width', COALESCE(thermal->>'width', '80mm'),
      'density', COALESCE(thermal->>'density', 'standard'),
      'qr_size', qr_size,
      'qr_alignment', COALESCE(thermal->>'qr_alignment', 'center')
    ),
    'a4', jsonb_build_object('theme', COALESCE(a4->>'theme', a4->>'template_id', 'classic'))
  );
  RETURN extras || result;
END;
$$;

CREATE OR REPLACE FUNCTION public.v1_merge_invoice_presentation_settings(p_base jsonb, p_incoming jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(COALESCE(p_base, '{}'::jsonb) || (COALESCE(p_incoming, '{}'::jsonb) - ARRAY['branding','contact','footer','thermal','a4']), '{branding}', COALESCE(p_base->'branding','{}'::jsonb) || COALESCE(p_incoming->'branding','{}'::jsonb), true),
          '{contact}', COALESCE(p_base->'contact','{}'::jsonb) || COALESCE(p_incoming->'contact','{}'::jsonb), true),
        '{footer}', COALESCE(p_base->'footer','{}'::jsonb) || COALESCE(p_incoming->'footer','{}'::jsonb), true),
      '{thermal}', COALESCE(p_base->'thermal','{}'::jsonb) || COALESCE(p_incoming->'thermal','{}'::jsonb), true),
    '{a4}', COALESCE(p_base->'a4','{}'::jsonb) || COALESCE(p_incoming->'a4','{}'::jsonb), true);
$$;

CREATE OR REPLACE FUNCTION public.get_branch_invoice_settings(p_branch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE u record; b record; settings jsonb; can_edit boolean;
BEGIN
  SELECT tenant_id, branch_id, role::text AS role, is_active INTO u FROM public.user_profiles WHERE id = auth.uid();
  SELECT * INTO b FROM public.branches WHERE id = p_branch_id AND is_active;
  IF NOT FOUND OR NOT COALESCE(u.is_active, false) OR NOT ((u.role = 'owner' AND u.tenant_id = b.tenant_id) OR (u.role = 'branch' AND u.tenant_id = b.tenant_id AND u.branch_id = b.id)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  settings := public.v1_canonicalize_invoice_presentation_settings(COALESCE(b.presentation_settings, '{}'::jsonb), b.id);
  can_edit := u.role IN ('owner','branch');
  RETURN jsonb_build_object('branch_id', b.id, 'presentation_settings', settings, 'invoice_language', settings->>'language', 'print_mode', b.print_mode, 'can_edit', can_edit, 'role', u.role);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_branch_invoice_settings(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  u record; b record; settings jsonb; incoming jsonb; merged jsonb;
  lang text; mode text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'Invalid invoice settings payload' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE k NOT IN ('branch_id','invoice_language','print_mode','presentation_settings','display_name','phone','show_logo','logo_url','website','email','show_website','show_email','receipt_footer','show_footer','show_cash_change')) THEN
    RAISE EXCEPTION 'Unsupported presentation setting' USING ERRCODE = '22023';
  END IF;
  SELECT tenant_id, branch_id, role::text AS role, is_active INTO u FROM public.user_profiles WHERE id = auth.uid();
  SELECT * INTO b FROM public.branches WHERE id = NULLIF(BTRIM(p_payload->>'branch_id'), '')::uuid FOR UPDATE;
  IF NOT FOUND OR NOT COALESCE(u.is_active, false) OR NOT ((u.role = 'owner' AND u.tenant_id = b.tenant_id) OR (u.role = 'branch' AND u.tenant_id = b.tenant_id AND u.branch_id = b.id)) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  settings := public.v1_canonicalize_invoice_presentation_settings(COALESCE(b.presentation_settings, '{}'::jsonb), b.id);
  incoming := p_payload->'presentation_settings';
  IF incoming IS NOT NULL THEN
    IF jsonb_typeof(incoming) <> 'object' THEN RAISE EXCEPTION 'Invalid presentation settings' USING ERRCODE = '22023'; END IF;
    IF incoming ? 'identity' OR incoming ? 'logo' OR incoming ? 'a4' AND (incoming->'a4' ? 'template_id') THEN
      incoming := public.v1_canonicalize_invoice_presentation_settings(incoming, b.id);
    END IF;
    merged := public.v1_merge_invoice_presentation_settings(settings, incoming);
    settings := public.v1_canonicalize_invoice_presentation_settings(merged, b.id);
  END IF;
  lang := COALESCE(p_payload->>'invoice_language', settings->>'language', b.invoice_language);
  mode := COALESCE(p_payload->>'print_mode', b.print_mode);
  IF lang NOT IN ('en','ar','both') OR mode NOT IN ('thermal','pdf','both') THEN RAISE EXCEPTION 'Invalid document mode or language' USING ERRCODE = '22023'; END IF;
  settings := jsonb_set(settings, '{language}', TO_JSONB(lang), true);
  UPDATE public.branches SET presentation_settings = settings, invoice_language = lang, print_mode = mode, updated_at = now() WHERE id = b.id;
  RETURN jsonb_build_object('branch_id', b.id, 'presentation_settings', settings, 'invoice_language', lang, 'print_mode', mode, 'can_edit', true, 'role', u.role);
END;
$$;

REVOKE ALL ON FUNCTION public.get_branch_invoice_settings(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_branch_invoice_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_branch_invoice_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_branch_invoice_settings(jsonb) TO authenticated;

COMMIT;
