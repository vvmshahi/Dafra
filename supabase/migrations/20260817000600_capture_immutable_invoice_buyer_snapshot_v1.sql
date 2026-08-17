-- Immutable issue-time buyer identity for document presentation.
--
-- This extends the existing identity_snapshot envelope rather than creating a
-- second customer snapshot. Historic rows remain untouched: V1/V2/NULL are
-- explicitly handled by the Web compatibility path.

BEGIN;

-- The remote migration ledger may contain the historical identity foundation
-- while an imported schema is missing its additive column. Recreate only the
-- column contract; never derive or backfill any historic buyer values.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS identity_snapshot jsonb;

CREATE OR REPLACE FUNCTION public.capture_invoice_identity_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  b record;
  seller_profile record;
  buyer_customer record;
  original_document record;
  fiscal_document_kind text;
  buyer_snapshot jsonb;
  buyer_name text;
BEGIN
  SELECT * INTO b
  FROM public.branches
  WHERE id = NEW.branch_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice branch does not match tenant' USING ERRCODE = '23503';
  END IF;

  -- Legacy branches continue to be explicitly identifiable. Do not fabricate
  -- issue-time identity for rows issued before the protected contract.
  IF b.compliance_identity_mode = 'legacy' THEN
    NEW.identity_snapshot := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO seller_profile
  FROM public.branch_compliance_profiles
  WHERE branch_id = NEW.branch_id
    AND tenant_id = NEW.tenant_id
    AND validation_status = 'verified';
  IF NOT FOUND
     OR NULLIF(btrim(seller_profile.registered_seller_name), '') IS NULL
     OR NULLIF(btrim(seller_profile.vat_number), '') IS NULL
     OR NULLIF(btrim(seller_profile.building_number), '') IS NULL
     OR NULLIF(btrim(seller_profile.street), '') IS NULL
     OR NULLIF(btrim(seller_profile.district), '') IS NULL
     OR NULLIF(btrim(seller_profile.city), '') IS NULL
     OR NULLIF(btrim(seller_profile.postal_code), '') IS NULL THEN
    RAISE EXCEPTION 'Official seller profile is incomplete or unverified' USING ERRCODE = '23514';
  END IF;

  IF NEW.zatca_invoice_type::text IN ('credit_note', 'debit_note') THEN
    SELECT identity_snapshot, zatca_invoice_type
    INTO original_document
    FROM public.invoices
    WHERE id = NEW.original_invoice_id
      AND tenant_id = NEW.tenant_id
      AND branch_id = NEW.branch_id;

    IF FOUND THEN
      fiscal_document_kind := CASE
        WHEN original_document.identity_snapshot->'document'->>'fiscalDocumentKind' IN ('simplified', 'standard')
          THEN original_document.identity_snapshot->'document'->>'fiscalDocumentKind'
        WHEN original_document.zatca_invoice_type::text = 'standard' THEN 'standard'
        ELSE 'simplified'
      END;
      buyer_snapshot := CASE
        WHEN original_document.identity_snapshot->>'version' = '3'
          AND jsonb_typeof(original_document.identity_snapshot->'buyer') = 'object'
          THEN original_document.identity_snapshot->'buyer'
        ELSE jsonb_build_object('state', 'legacy_unavailable')
      END;
    ELSE
      -- Existing credit authority performs its own original-document checks.
      -- Preserve an explicit non-authoritative state rather than reading the
      -- current customer row or preventing that financial correction here.
      fiscal_document_kind := 'simplified';
      buyer_snapshot := jsonb_build_object('state', 'legacy_unavailable');
    END IF;
  ELSE
    fiscal_document_kind := CASE WHEN NEW.zatca_invoice_type::text = 'standard' THEN 'standard' ELSE 'simplified' END;

    IF NEW.customer_id IS NULL THEN
      buyer_snapshot := jsonb_build_object('state', 'walk_in');
    ELSE
      SELECT id, customer_type, name, name_ar, business_name, business_name_ar,
             company_name, vat_number, cr_number, phone, address, address_ar,
             building_number, district, city, postal_code, country
      INTO buyer_customer
      FROM public.customers
      WHERE id = NEW.customer_id
        AND tenant_id = NEW.tenant_id
        AND branch_id = NEW.branch_id
        AND is_active IS TRUE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice buyer is not available for issue-time capture' USING ERRCODE = '23514';
      END IF;

      buyer_name := CASE
        WHEN buyer_customer.customer_type = 'business' THEN COALESCE(NULLIF(btrim(buyer_customer.business_name), ''), NULLIF(btrim(buyer_customer.company_name), ''), NULLIF(btrim(buyer_customer.name), ''))
        ELSE NULLIF(btrim(buyer_customer.name), '')
      END;

      IF fiscal_document_kind = 'standard' AND (
        buyer_customer.customer_type IS DISTINCT FROM 'business'
        OR buyer_name IS NULL
        OR NULLIF(btrim(buyer_customer.vat_number), '') IS NULL
        OR NULLIF(btrim(buyer_customer.cr_number), '') IS NULL
        OR NULLIF(btrim(buyer_customer.building_number), '') IS NULL
        OR NULLIF(btrim(buyer_customer.address), '') IS NULL
        OR NULLIF(btrim(buyer_customer.district), '') IS NULL
        OR NULLIF(btrim(buyer_customer.city), '') IS NULL
        OR NULLIF(btrim(buyer_customer.postal_code), '') IS NULL
        OR NULLIF(btrim(buyer_customer.country), '') IS NULL
      ) THEN
        RAISE EXCEPTION 'STANDARD_BUYER_SNAPSHOT_REQUIRED' USING ERRCODE = '23514';
      END IF;

      buyer_snapshot := jsonb_build_object(
        'state', 'captured',
        'customerType', buyer_customer.customer_type,
        'name', buyer_name,
        'nameAr', CASE
          WHEN buyer_customer.customer_type = 'business' THEN COALESCE(NULLIF(btrim(buyer_customer.business_name_ar), ''), NULLIF(btrim(buyer_customer.name_ar), ''))
          ELSE NULLIF(btrim(buyer_customer.name_ar), '')
        END,
        'vatNumber', NULLIF(btrim(buyer_customer.vat_number), ''),
        'identifierType', CASE WHEN NULLIF(btrim(buyer_customer.cr_number), '') IS NULL THEN NULL ELSE 'CR' END,
        'identifierValue', NULLIF(btrim(buyer_customer.cr_number), ''),
        'phone', NULLIF(btrim(buyer_customer.phone), ''),
        'address', jsonb_build_object(
          'buildingNumber', NULLIF(btrim(buyer_customer.building_number), ''),
          'street', NULLIF(btrim(buyer_customer.address), ''),
          'streetAr', NULLIF(btrim(buyer_customer.address_ar), ''),
          'district', NULLIF(btrim(buyer_customer.district), ''),
          'city', NULLIF(btrim(buyer_customer.city), ''),
          'postalCode', NULLIF(btrim(buyer_customer.postal_code), ''),
          'country', NULLIF(btrim(buyer_customer.country), '')
        )
      );
    END IF;
  END IF;

  NEW.identity_snapshot := jsonb_build_object(
    'version', 3,
    'legacy', FALSE,
    'compliance', jsonb_build_object(
      'registeredSellerName', seller_profile.registered_seller_name,
      'registeredSellerNameAr', seller_profile.registered_seller_name_ar,
      'vatNumber', seller_profile.vat_number,
      'registrationScheme', seller_profile.registration_scheme,
      'registrationIdentifier', seller_profile.registration_identifier,
      'address', jsonb_build_object(
        'buildingNumber', seller_profile.building_number,
        'street', seller_profile.street,
        'district', seller_profile.district,
        'city', seller_profile.city,
        'postalCode', seller_profile.postal_code,
        'country', seller_profile.country
      )
    ),
    'buyer', buyer_snapshot,
    'presentationSettings', public.resolve_invoice_presentation_settings(b.id),
    'document', jsonb_build_object(
      'language', COALESCE(NEW.document_language, b.invoice_language, 'both'),
      'printMode', b.print_mode,
      'fiscalDocumentKind', fiscal_document_kind
    )
  );
  RETURN NEW;
END
$function$;

-- Ensure the capture trigger exists even on a ledger-reconciled database
-- whose historical identity-foundation DDL was not materialized.
DROP TRIGGER IF EXISTS invoices_capture_identity_snapshot ON public.invoices;
CREATE TRIGGER invoices_capture_identity_snapshot
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_identity_snapshot();

CREATE OR REPLACE FUNCTION public.prevent_invoice_identity_snapshot_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.identity_snapshot IS DISTINCT FROM OLD.identity_snapshot THEN
    RAISE EXCEPTION 'Issued invoice identity snapshot is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS invoices_identity_snapshot_immutable ON public.invoices;
CREATE TRIGGER invoices_identity_snapshot_immutable
BEFORE UPDATE OF identity_snapshot ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_identity_snapshot_change();

COMMENT ON COLUMN public.invoices.identity_snapshot IS
  'Immutable versioned issue-time seller, buyer, presentation, and fiscal-document snapshot. NULL identifies legacy documents.';

-- identity_snapshot contains the already approved customer-facing document
-- identity only; it contains no signed XML, credentials, QR payload, or other
-- server-only ZATCA artifact. RLS remains the row authorization boundary.
GRANT SELECT (identity_snapshot) ON TABLE public.invoices TO authenticated;

COMMIT;
