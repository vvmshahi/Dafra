-- ============================================================
-- Phase 5S: Isolated ZATCA Sandbox compliance validation
-- Apply manually after Phase 5R.
--
-- This is not reporting or clearance. It never changes invoice
-- ZATCA status and never participates in a production/Sandbox
-- reporting chain.
-- ============================================================

BEGIN;

ALTER TABLE public.zatca_sandbox_credentials
  ADD COLUMN IF NOT EXISTS compliance_demo_status TEXT NOT NULL DEFAULT 'disabled';

ALTER TABLE public.zatca_sandbox_credentials
  DROP CONSTRAINT IF EXISTS zatca_sandbox_compliance_demo_status_check;

ALTER TABLE public.zatca_sandbox_credentials
  ADD CONSTRAINT zatca_sandbox_compliance_demo_status_check CHECK (
    compliance_demo_status IN ('disabled', 'active')
  );

CREATE UNIQUE INDEX IF NOT EXISTS zatca_sandbox_credentials_one_compliance_demo_active_uidx
  ON public.zatca_sandbox_credentials (tenant_id, branch_id, environment)
  WHERE compliance_demo_status = 'active';

COMMENT ON COLUMN public.zatca_sandbox_credentials.compliance_demo_status IS
  'Explicit service-role opt-in for isolated developer-portal compliance validation. Never means reported, cleared, or production active.';

CREATE TABLE IF NOT EXISTS public.zatca_sandbox_validation_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  credential_id UUID NOT NULL REFERENCES public.zatca_sandbox_credentials(id) ON DELETE RESTRICT,
  device_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment = 'sandbox'),
  endpoint_kind TEXT NOT NULL DEFAULT 'compliance_validation'
    CHECK (endpoint_kind = 'compliance_validation'),
  status TEXT NOT NULL DEFAULT 'sandbox_validation_pending' CHECK (status IN (
    'sandbox_validation_pending',
    'sandbox_validated',
    'sandbox_validated_with_warnings',
    'sandbox_validation_rejected',
    'sandbox_validation_failed'
  )),
  invoice_snapshot_hash TEXT NOT NULL CHECK (length(invoice_snapshot_hash) = 64),
  invoice_uuid UUID NOT NULL,
  invoice_hash TEXT,
  signed_xml TEXT,
  submission_payload JSONB,
  safe_response JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_response) = 'object'),
  validation_warnings JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_warnings) = 'array'),
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_errors) = 'array'),
  response_status INTEGER,
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id),
  UNIQUE (tenant_id, branch_id, credential_id, device_id, invoice_id),
  CHECK (
    (invoice_hash IS NULL AND signed_xml IS NULL AND submission_payload IS NULL)
    OR (invoice_hash IS NOT NULL AND signed_xml IS NOT NULL AND submission_payload IS NOT NULL)
  )
);

ALTER TABLE public.zatca_sandbox_validation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zatca_sandbox_validation_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.zatca_sandbox_validation_attempts TO service_role;

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
      AND t.is_demo IS TRUE
      AND t.is_active IS TRUE
      AND b.id = NEW.branch_id
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
      AND i.zatca_invoice_type = 'simplified'
      AND i.zatca_status::text NOT IN ('reported', 'cleared')
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

DROP TRIGGER IF EXISTS trg_validate_zatca_sandbox_validation_attempt
  ON public.zatca_sandbox_validation_attempts;
CREATE TRIGGER trg_validate_zatca_sandbox_validation_attempt
  BEFORE INSERT OR UPDATE ON public.zatca_sandbox_validation_attempts
  FOR EACH ROW EXECUTE FUNCTION public.validate_zatca_sandbox_validation_attempt();

REVOKE ALL ON FUNCTION public.validate_zatca_sandbox_validation_attempt() FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMIT;
