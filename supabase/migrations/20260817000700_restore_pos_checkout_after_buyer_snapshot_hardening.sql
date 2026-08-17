-- P0: repair the immutable identity trigger against the production branches
-- contract. The prior migration referenced Phase-6A objects that are not
-- materialized in this linked production schema. This is forward-only: it
-- changes capture for new documents and never rewrites historic snapshots.

BEGIN;

CREATE OR REPLACE FUNCTION public.capture_invoice_identity_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $function$
DECLARE
  branch_snapshot jsonb;
  buyer_customer record;
  original_document record;
  fiscal_document_kind text;
  buyer_snapshot jsonb;
  buyer_name text;
BEGIN
  -- Capture the authoritative branch row as JSON so this function only reads
  -- fields that exist in the production-shaped branches contract.
  SELECT to_jsonb(branch_row) INTO branch_snapshot
  FROM public.branches AS branch_row
  WHERE branch_row.id = NEW.branch_id
    AND branch_row.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice branch does not match tenant' USING ERRCODE = '23503';
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

      -- Preserve the approved B2B issue-time readiness gate. The P0 repair
      -- only changes the seller source; it does not relax buyer validation.
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
      'registeredSellerName', COALESCE(NULLIF(btrim(branch_snapshot->>'business_name'), ''), NULLIF(btrim(branch_snapshot->>'name'), '')),
      'registeredSellerNameAr', COALESCE(NULLIF(btrim(branch_snapshot->>'business_name_ar'), ''), NULLIF(btrim(branch_snapshot->>'name_ar'), '')),
      'vatNumber', NULLIF(btrim(branch_snapshot->>'vat_number'), ''),
      'registrationScheme', CASE WHEN NULLIF(btrim(branch_snapshot->>'cr_number'), '') IS NULL THEN NULL ELSE 'CR' END,
      'registrationIdentifier', NULLIF(btrim(branch_snapshot->>'cr_number'), ''),
      'address', jsonb_build_object(
        'buildingNumber', NULLIF(btrim(branch_snapshot->>'building_number'), ''),
        'street', COALESCE(NULLIF(btrim(branch_snapshot->>'street'), ''), NULLIF(btrim(branch_snapshot->>'address'), '')),
        'streetAr', COALESCE(NULLIF(btrim(branch_snapshot->>'street_ar'), ''), NULLIF(btrim(branch_snapshot->>'address_ar'), '')),
        'district', NULLIF(btrim(branch_snapshot->>'district'), ''),
        'city', NULLIF(btrim(branch_snapshot->>'city'), ''),
        'postalCode', NULLIF(btrim(branch_snapshot->>'postal_code'), ''),
        'country', NULLIF(btrim(branch_snapshot->>'country'), '')
      )
    ),
    'buyer', buyer_snapshot,
    'presentationSettings', public.resolve_invoice_presentation_settings(NEW.branch_id),
    'document', jsonb_build_object(
      'language', COALESCE(NEW.document_language, NULLIF(btrim(branch_snapshot->>'invoice_language'), ''), 'both'),
      'printMode', COALESCE(NULLIF(btrim(branch_snapshot->>'print_mode'), ''), 'thermal'),
      'fiscalDocumentKind', fiscal_document_kind
    )
  );
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.capture_invoice_identity_snapshot() IS
  'Captures immutable V3 seller, buyer, presentation, and fiscal-document identity from the production branches contract for newly inserted invoices.';

COMMIT;
