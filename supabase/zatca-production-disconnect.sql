-- ============================================================
-- ZATCA Production Local Disconnect Support
-- Safe to run multiple times before deploying zatca-disconnect-production.
-- ============================================================

ALTER TABLE public.zatca_production_credentials
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ;

ALTER TABLE public.zatca_production_credentials
  DROP CONSTRAINT IF EXISTS zatca_production_credentials_onboarding_status_check;

ALTER TABLE public.zatca_production_credentials
  ADD CONSTRAINT zatca_production_credentials_onboarding_status_check
  CHECK (onboarding_status IN (
    'not_started',
    'generating_csr',
    'compliance_csid_requested',
    'compliance_samples_passed',
    'production_csid_requested',
    'production_connected',
    'disconnected',
    'compliance_failed',
    'failed'
  ));

COMMENT ON COLUMN public.zatca_production_credentials.disconnected_at IS
  'Timestamp when Dafra local production submission was soft-disabled for this branch. This does not revoke the FATOORA device.';
