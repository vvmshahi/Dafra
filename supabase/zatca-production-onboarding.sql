-- ============================================================
-- ZATCA Production Onboarding — backend-only credential storage
-- Safe to run multiple times. Apply before deploying zatca-onboard-production.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.zatca_production_credentials (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id                       UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  environment                     TEXT NOT NULL DEFAULT 'production'
                                      CHECK (environment = 'production'),
  egs_serial_number               TEXT NOT NULL,
  csr_common_name                 TEXT,
  csr_organization_name           TEXT,
  csr_organizational_unit_name    TEXT,
  csr_location                    TEXT,
  csr_industry                    TEXT,
  csr_pem                         TEXT,
  public_key_pem                  TEXT,
  encrypted_private_key           TEXT,
  compliance_request_id           TEXT,
  encrypted_compliance_csid       TEXT,
  encrypted_compliance_secret     TEXT,
  encrypted_production_csid       TEXT,
  encrypted_production_secret     TEXT,
  onboarding_status               TEXT NOT NULL DEFAULT 'not_started'
                                      CHECK (onboarding_status IN (
                                        'not_started',
                                        'generating_csr',
                                        'compliance_csid_requested',
                                        'compliance_samples_passed',
                                        'production_csid_requested',
                                        'production_connected',
                                        'compliance_failed',
                                        'failed'
                                      )),
  functionality_map               TEXT NOT NULL
                                      CHECK (functionality_map IN ('0100', '1000', '1100')),
  certificate_valid_from          TIMESTAMPTZ,
  certificate_valid_to            TIMESTAMPTZ,
  compliance_sample_results       JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_error                      TEXT,
  connected_at                    TIMESTAMPTZ,
  created_by                      UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by                      UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, environment)
);

CREATE INDEX IF NOT EXISTS idx_zatca_prod_credentials_tenant
  ON public.zatca_production_credentials (tenant_id);

CREATE INDEX IF NOT EXISTS idx_zatca_prod_credentials_branch
  ON public.zatca_production_credentials (branch_id);

DROP TRIGGER IF EXISTS trg_zatca_prod_credentials_updated_at
  ON public.zatca_production_credentials;

CREATE TRIGGER trg_zatca_prod_credentials_updated_at
  BEFORE UPDATE ON public.zatca_production_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.zatca_production_credentials ENABLE ROW LEVEL SECURITY;

-- No authenticated SELECT/INSERT/UPDATE/DELETE policies are created on purpose.
-- Production private keys, CSIDs, secrets, and certificates are readable/writable
-- only through service-role Edge Functions. The frontend gets safe status from
-- zatca-onboard-production, not from this table.

COMMENT ON TABLE public.zatca_production_credentials IS
  'Backend-only encrypted ZATCA production onboarding credentials. No direct frontend RLS policies.';

COMMENT ON COLUMN public.zatca_production_credentials.encrypted_private_key IS
  'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';

COMMENT ON COLUMN public.zatca_production_credentials.encrypted_compliance_csid IS
  'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';

COMMENT ON COLUMN public.zatca_production_credentials.encrypted_compliance_secret IS
  'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';

COMMENT ON COLUMN public.zatca_production_credentials.encrypted_production_csid IS
  'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';

COMMENT ON COLUMN public.zatca_production_credentials.encrypted_production_secret IS
  'Encrypted with ZATCA_SERVER_ENCRYPTION_KEY in Supabase Edge Functions.';
