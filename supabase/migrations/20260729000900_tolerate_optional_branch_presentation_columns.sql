BEGIN;

-- Some hosted databases recorded the original presentation migration while
-- retaining only branches.presentation_settings and the older operational
-- columns. Read optional legacy columns through the row JSON so defaults remain
-- usable on both canonical and drifted schemas without changing any branch row.
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
  branch_json JSONB;
  template_id TEXT;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id = p_branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501'; END IF;

  branch_json := to_jsonb(b);
  template_id := CASE
    WHEN branch_json->>'a4_template_id' IN (
      'classic',
      'modern_split',
      'minimal_professional',
      'executive_green',
      'clean_ledger',
      'contemporary_border'
    ) THEN branch_json->>'a4_template_id'
    ELSE 'classic'
  END;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'language', CASE WHEN b.invoice_language = 'ar' THEN 'ar' ELSE 'both' END,
    'after_sale_action', CASE WHEN b.print_mode = 'pdf' THEN 'a4' WHEN b.print_mode = 'both' THEN 'both' ELSE 'receipt' END,
    'branding', jsonb_build_object(
      'heading_mode', 'branch',
      'custom_heading', NULL,
      'subheading', NULLIF(btrim(branch_json->>'invoice_display_subheading'), ''),
      'show_company_name', COALESCE((branch_json->>'show_company_display_name')::BOOLEAN, TRUE),
      'logo_path', CASE WHEN COALESCE(b.logo_url,'') ~ '^invoice-branding/' THEN b.logo_url ELSE NULL END,
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
      'address_override', b.address
    ),
    'footer', jsonb_build_object(
      'message', b.receipt_footer,
      'bold', COALESCE(b.show_footer, TRUE)
    ),
    'thermal', jsonb_build_object(
      'width', '80mm',
      'density', CASE
        WHEN branch_json->>'thermal_density' IN ('compact','standard','detailed')
          THEN branch_json->>'thermal_density'
        ELSE 'standard'
      END,
      'qr_size', 'medium',
      'qr_alignment', 'center'
    ),
    'a4', jsonb_build_object(
      'theme', template_id,
      'accent_color', '#0f766e',
      'heading_color', '#10251a',
      'body_color', '#1f2937',
      'auto_foreground', TRUE,
      'header_asset_path', NULL,
      'header_asset_version', 1,
      'header_asset_enabled', FALSE,
      'header_asset_fit', 'contain',
      'header_asset_height', 28,
      'header_asset_spacing', 6,
      'header_crop_top', 0,
      'header_crop_height', 18,
      'footer_asset_path', NULL,
      'footer_asset_version', 1,
      'footer_asset_enabled', FALSE,
      'footer_asset_fit', 'contain',
      'footer_asset_height', 10,
      'footer_asset_spacing', 4,
      'footer_crop_top', 92,
      'footer_crop_height', 8,
      'artwork_scope', 'all',
      'artwork_template_id', template_id
    )
  );
END;
$defaults$;

REVOKE ALL ON FUNCTION public.default_invoice_presentation_settings(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_invoice_presentation_settings(UUID) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.default_invoice_presentation_settings(UUID) IS
  'Builds non-fiscal presentation defaults while tolerating absent optional legacy branch presentation columns.';

COMMIT;
