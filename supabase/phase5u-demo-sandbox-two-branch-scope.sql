-- ============================================================
-- Phase 5U: Permanent-demo Sandbox two-branch scope
-- Apply manually after Phase 5T.
--
-- Extends the isolated compliance-validation and credit-note
-- exception from the Trading branch to the exact existing Service
-- branch. Production and all other tenant/branch behavior is unchanged.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_definition TEXT;
  v_existing TEXT := $old$v_original.branch_id = '14271653-b404-44bf-9f39-7e9927569c02'::uuid$old$;
  v_replacement TEXT := $new$v_original.branch_id IN (
         '14271653-b404-44bf-9f39-7e9927569c02'::uuid,
         'c30094d7-40ca-4d2e-833a-07aa18c4fa46'::uuid
       )$new$;
BEGIN
  SELECT pg_get_functiondef('public.create_partial_credit_note(jsonb)'::regprocedure)
  INTO v_definition;

  IF POSITION(v_existing IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected permanent-demo credit-note branch guard was not found';
  END IF;

  EXECUTE REPLACE(v_definition, v_existing, v_replacement);
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_zatca_sandbox_validation_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM public.tenants t
    JOIN public.branches b ON b.tenant_id = t.id
    JOIN public.zatca_sandbox_credentials c
      ON c.tenant_id = t.id AND c.branch_id = b.id
    JOIN public.invoices i
      ON i.tenant_id = t.id AND i.branch_id = b.id
    WHERE t.id = NEW.tenant_id
      AND t.id = 'ebf1144b-55ed-472a-99c9-23b5ee915351'::uuid
      AND t.is_demo IS TRUE
      AND t.is_active IS TRUE
      AND b.id = NEW.branch_id
      AND b.id IN (
        '14271653-b404-44bf-9f39-7e9927569c02'::uuid,
        'c30094d7-40ca-4d2e-833a-07aa18c4fa46'::uuid
      )
      AND b.is_active IS TRUE
      AND b.zatca_environment = 'sandbox'
      AND c.id = NEW.credential_id
      AND c.device_id = NEW.device_id
      AND c.environment = 'sandbox'
      AND c.compliance_demo_status = 'active'
      AND c.last_successful_onboarding_status IN ('compliance_passed', 'sandbox_production_csid_ready', 'active')
      AND c.encrypted_private_key IS NOT NULL
      AND c.encrypted_compliance_csid IS NOT NULL
      AND c.encrypted_compliance_secret IS NOT NULL
      AND i.id = NEW.invoice_id
      AND i.status = 'posted'
      AND i.zatca_status::text NOT IN ('reported', 'cleared')
      AND (
        (i.zatca_invoice_type = 'simplified' AND i.zatca_type_code = '388')
        OR (
          i.zatca_invoice_type = 'credit_note'
          AND i.zatca_type_code = '381'
          AND i.original_invoice_id IS NOT NULL
          AND NULLIF(BTRIM(i.invoice_reference), '') IS NOT NULL
          AND NULLIF(BTRIM(i.credit_reason), '') IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.zatca_sandbox_validation_attempts original_attempt
            WHERE original_attempt.invoice_id = i.original_invoice_id
              AND original_attempt.tenant_id = i.tenant_id
              AND original_attempt.branch_id = i.branch_id
              AND original_attempt.status IN ('sandbox_validated', 'sandbox_validated_with_warnings')
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Invalid Sandbox compliance-validation scope' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
    OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.environment IS DISTINCT FROM OLD.environment
    OR NEW.endpoint_kind IS DISTINCT FROM OLD.endpoint_kind
    OR NEW.invoice_snapshot_hash IS DISTINCT FROM OLD.invoice_snapshot_hash
    OR NEW.invoice_uuid IS DISTINCT FROM OLD.invoice_uuid
    OR (OLD.invoice_hash IS NOT NULL AND NEW.invoice_hash IS DISTINCT FROM OLD.invoice_hash)
    OR (OLD.signed_xml IS NOT NULL AND NEW.signed_xml IS DISTINCT FROM OLD.signed_xml)
    OR (OLD.submission_payload IS NOT NULL AND NEW.submission_payload IS DISTINCT FROM OLD.submission_payload)
  ) THEN
    RAISE EXCEPTION 'Sandbox compliance-validation payload is immutable' USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_zatca_sandbox_validation_attempt() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
