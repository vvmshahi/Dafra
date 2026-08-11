-- Stage 6D.2: issue-time document presentation contract.
--
-- Additive only. This does not touch fiscal artifacts, invoice totals,
-- payments, customer identity, checkout, ZATCA processing, or old invoices.
BEGIN;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS presentation_snapshot JSONB;
COMMENT ON COLUMN public.invoices.presentation_snapshot IS
  'Immutable, versioned, presentation-only issue-time document configuration. NULL means a pre-6D.2 legacy invoice and uses live compatibility resolution.';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_presentation_snapshot_v1_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_presentation_snapshot_v1_check
      CHECK (
        presentation_snapshot IS NULL
        OR (
          jsonb_typeof(presentation_snapshot) = 'object'
          AND presentation_snapshot->>'version' = '1'
          AND presentation_snapshot->>'contract' = 'kubri.invoice_presentation'
          AND presentation_snapshot->'document'->>'mode' IN ('receipt', 'a4', 'both')
          AND presentation_snapshot->'document'->>'language' IN ('en', 'ar', 'both')
          AND jsonb_typeof(presentation_snapshot->'presentation') = 'object'
        )
      );
  END IF;
END;
$$;
-- New V1 settings own document availability. Older rows without an explicit
-- after_sale_action retain the legacy print_mode mapping. Keeping the legacy
-- column synchronized prevents new contradictory rows without rewriting old
-- branch records.
CREATE OR REPLACE FUNCTION public.sync_branch_print_mode_from_presentation_settings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE action text;
BEGIN
  IF jsonb_typeof(NEW.presentation_settings) <> 'object' THEN
    RETURN NEW;
  END IF;

  action := NEW.presentation_settings->>'after_sale_action';
  action := CASE action
    WHEN 'thermal' THEN 'receipt'
    WHEN 'pdf' THEN 'a4'
    WHEN 'ask' THEN 'receipt'
    WHEN 'none' THEN 'receipt'
    ELSE action
  END;

  IF action = 'receipt' THEN
    NEW.print_mode := 'thermal';
  ELSIF action = 'a4' THEN
    NEW.print_mode := 'pdf';
  ELSIF action = 'both' THEN
    NEW.print_mode := 'both';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS branches_sync_invoice_document_mode ON public.branches;
CREATE TRIGGER branches_sync_invoice_document_mode
BEFORE INSERT OR UPDATE OF presentation_settings, print_mode ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.sync_branch_print_mode_from_presentation_settings();
-- Return the fully resolved rendering settings rather than the raw branch JSON.
-- The source branch row is read once at invoice insertion; the resulting JSON
-- is complete enough for the Web resolver to avoid later branch-setting reads.
CREATE OR REPLACE FUNCTION public.resolve_invoice_presentation_snapshot_v1(
  p_branch_id uuid,
  p_document_language text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  b record;
  source_settings jsonb;
  raw jsonb;
  branding jsonb;
  identity jsonb;
  contact jsonb;
  footer jsonb;
  logo jsonb;
  thermal jsonb;
  a4 jsonb;
  action text;
  language text;
  heading_mode text;
  heading text;
  subheading text;
  footer_note text;
  show_footer boolean;
  logo_path text;
  logo_visible boolean;
BEGIN
  SELECT * INTO b FROM public.branches WHERE id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found' USING ERRCODE = '42501';
  END IF;

  -- Read the branch row directly. In particular, NULL has a meaningful legacy
  -- fallback to print_mode and direct branch display fields; replacing it with
  -- a synthetic V1 envelope would incorrectly turn legacy PDF/both rows into
  -- receipt-only snapshots.
  source_settings := COALESCE(b.presentation_settings, '{}'::jsonb);
  raw := source_settings;
  branding := COALESCE(raw->'branding', '{}'::jsonb);
  identity := COALESCE(raw->'identity', '{}'::jsonb);
  contact := COALESCE(raw->'contact', '{}'::jsonb);
  footer := COALESCE(raw->'footer', '{}'::jsonb);
  logo := COALESCE(raw->'logo', '{}'::jsonb);
  thermal := COALESCE(raw->'thermal', '{}'::jsonb);
  a4 := COALESCE(raw->'a4', '{}'::jsonb);

  action := CASE source_settings->>'after_sale_action'
    WHEN 'receipt' THEN 'receipt'
    WHEN 'thermal' THEN 'receipt'
    WHEN 'a4' THEN 'a4'
    WHEN 'pdf' THEN 'a4'
    WHEN 'both' THEN 'both'
    ELSE CASE b.print_mode WHEN 'pdf' THEN 'a4' WHEN 'both' THEN 'both' ELSE 'receipt' END
  END;
  language := CASE
    WHEN p_document_language IN ('en', 'ar', 'both') THEN p_document_language
    WHEN raw->>'language' IN ('en', 'ar', 'both') THEN raw->>'language'
    WHEN raw->>'invoice_language' IN ('en', 'ar', 'both') THEN raw->>'invoice_language'
    WHEN b.invoice_language IN ('en', 'ar', 'both') THEN b.invoice_language
    ELSE 'both'
  END;

  heading_mode := CASE
    WHEN COALESCE(branding->>'heading_mode', identity->>'heading_mode') = 'custom' THEN 'custom'
    ELSE 'branch'
  END;
  heading := CASE
    WHEN heading_mode = 'custom' THEN NULLIF(BTRIM(COALESCE(branding->>'custom_heading', identity->>'display_heading', '')), '')
    ELSE COALESCE(
      NULLIF(BTRIM(identity->>'display_heading'), ''),
      NULLIF(BTRIM(b.display_name), ''),
      NULLIF(BTRIM(b.name), ''),
      NULLIF(BTRIM(b.business_name), '')
    )
  END;
  subheading := NULLIF(BTRIM(COALESCE(branding->>'subheading', identity->>'display_subheading', '')), '');
  footer_note := CASE
    WHEN footer ? 'message' THEN NULLIF(BTRIM(COALESCE(footer->>'message', '')), '')
    WHEN footer ? 'footer_note' THEN NULLIF(BTRIM(COALESCE(footer->>'footer_note', '')), '')
    ELSE NULLIF(BTRIM(COALESCE(b.receipt_footer, '')), '')
  END;
  show_footer := CASE
    WHEN footer ? 'show_footer' THEN COALESCE((footer->>'show_footer')::boolean, FALSE)
    WHEN footer ? 'message' THEN footer_note IS NOT NULL
    ELSE COALESCE(b.show_footer, footer_note IS NOT NULL)
  END;
  logo_path := NULLIF(BTRIM(COALESCE(branding->>'logo_path', logo->>'asset_path', b.logo_url, '')), '');
  logo_visible := CASE
    WHEN branding ? 'logo_path' THEN logo_path IS NOT NULL
    ELSE COALESCE((logo->>'visible')::boolean, b.show_logo, TRUE) AND logo_path IS NOT NULL
  END;

  RETURN jsonb_build_object(
    'version', 1,
    'contract', 'kubri.invoice_presentation',
    'document', jsonb_build_object('mode', action, 'language', language),
    'presentation', jsonb_build_object(
      'schema_version', 1,
      'identity', jsonb_build_object(
        'display_heading', heading,
        'display_subheading', subheading,
        'custom_display_name', CASE WHEN heading_mode = 'custom' THEN heading ELSE NULL END,
        'show_company_name', COALESCE((branding->>'show_company_name')::boolean, (identity->>'show_company_name')::boolean, TRUE),
        'show_branch_name', FALSE,
        'heading_mode', heading_mode
      ),
      'contact', jsonb_build_object(
        'phone', COALESCE(NULLIF(BTRIM(COALESCE(contact->>'phone_override', contact->>'phone', '')), ''), b.phone),
        'email', CASE WHEN contact ? 'email' THEN NULLIF(BTRIM(COALESCE(contact->>'email', '')), '') ELSE b.email END,
        'website', CASE WHEN contact ? 'website' THEN NULLIF(BTRIM(COALESCE(contact->>'website', '')), '') ELSE b.website END,
        'address_override', COALESCE(NULLIF(BTRIM(COALESCE(contact->>'address_override', '')), ''), b.address),
        'show_phone', COALESCE((contact->>'show_phone')::boolean, b.phone IS NOT NULL),
        'show_email', COALESCE((contact->>'show_email')::boolean, b.show_email, b.email IS NOT NULL),
        'show_website', COALESCE((contact->>'show_website')::boolean, b.show_website, b.website IS NOT NULL),
        'show_address', COALESCE((contact->>'show_address')::boolean, TRUE)
      ),
      'footer', jsonb_build_object(
        'thank_you_message', NULL,
        'footer_note', footer_note,
        'refund_note', NULL,
        'show_thank_you', FALSE,
        'show_footer', show_footer,
        'show_refund_note', FALSE,
        'bold', COALESCE((footer->>'bold')::boolean, FALSE)
      ),
      'logo', jsonb_build_object(
        'visible', logo_visible,
        'asset_path', logo_path,
        'asset_version', COALESCE(NULLIF(logo->>'asset_version', '')::integer, 1),
        'size', CASE COALESCE(branding->>'logo_size', logo->>'size', 'medium') WHEN 'small' THEN 'small' WHEN 'large' THEN 'large' ELSE 'medium' END
      ),
      'thermal', jsonb_build_object(
        'width', CASE thermal->>'width' WHEN '58mm' THEN '58mm' ELSE '80mm' END,
        'density', CASE thermal->>'density' WHEN 'compact' THEN 'compact' WHEN 'detailed' THEN 'detailed' ELSE 'standard' END,
        'qr_size', CASE thermal->>'qr_size' WHEN 'small' THEN 'small' WHEN 'large' THEN 'large' ELSE 'standard' END,
        'qr_alignment', 'center',
        'wrap_item_names', COALESCE((thermal->>'wrap_item_names')::boolean, TRUE),
        'show_cash_change', COALESCE((thermal->>'show_cash_change')::boolean, b.show_cash_change, TRUE)
      ),
      'a4', jsonb_build_object(
        'template_id', CASE COALESCE(a4->>'theme', a4->>'template_id', 'classic') WHEN 'modern_split' THEN 'modern_split' WHEN 'minimal_professional' THEN 'minimal_professional' ELSE 'classic' END,
        'template_version', 1,
        'header_style', CASE a4->>'header_style' WHEN 'compact' THEN 'compact' WHEN 'branded' THEN 'branded' ELSE 'standard' END
      ),
      'after_sale_action', action
    )
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.capture_invoice_presentation_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  -- Ignore any INSERT value: the branch state is resolved only on the server.
  NEW.presentation_snapshot := public.resolve_invoice_presentation_snapshot_v1(
    NEW.branch_id,
    NEW.document_language
  );
  RETURN NEW;
END;
$$;
-- PostgreSQL executes same-timing triggers alphabetically. This name ensures
-- the existing invoices_snapshot_document_language trigger runs first.
DROP TRIGGER IF EXISTS invoices_snapshot_presentation ON public.invoices;
CREATE TRIGGER invoices_snapshot_presentation
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_presentation_snapshot();
CREATE OR REPLACE FUNCTION public.prevent_invoice_presentation_snapshot_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.presentation_snapshot IS DISTINCT FROM OLD.presentation_snapshot THEN
    RAISE EXCEPTION 'Issued invoice presentation snapshot is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invoices_presentation_snapshot_immutable ON public.invoices;
CREATE TRIGGER invoices_presentation_snapshot_immutable
BEFORE UPDATE OF presentation_snapshot ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_presentation_snapshot_change();
-- The snapshot contains the normalized, presentation-only contract. It is
-- intentionally readable through the same authenticated invoice surface as
-- other customer-output fields, while anonymous access remains denied.
REVOKE SELECT (presentation_snapshot) ON public.invoices FROM PUBLIC, anon;
GRANT SELECT (presentation_snapshot) ON public.invoices TO authenticated;
COMMIT;
