-- Historical reset prerequisite for the Trading Sandbox migrations.
--
-- The original credential foundation was applied from the unversioned
-- phase5q/phase5r/phase5s SQL files.  Migrations 20260804000200 onward
-- nevertheless depend on this table and its onboarding columns.  Recreate
-- only that durable schema prerequisite here; later versioned migrations
-- remain the authority for the operational functions they define.

BEGIN;

CREATE TABLE IF NOT EXISTS public.zatca_sandbox_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  environment TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (environment = 'sandbox'),
  device_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  encrypted_private_key TEXT NOT NULL,
  encrypted_compliance_csid TEXT,
  encrypted_compliance_secret TEXT,
  encrypted_production_csid TEXT,
  encrypted_production_secret TEXT,
  certificate TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'compliance', 'active', 'revoked', 'expired', 'failed')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  onboarding_status TEXT NOT NULL DEFAULT 'not_started',
  last_successful_onboarding_status TEXT NOT NULL DEFAULT 'not_started',
  failed_step TEXT,
  onboarding_operation TEXT,
  operation_started_at TIMESTAMPTZ,
  reconciliation_status TEXT NOT NULL DEFAULT 'not_required',
  reconciliation_decision TEXT,
  reconciled_at TIMESTAMPTZ,
  reconciled_by TEXT,
  reconciliation_summary JSONB,
  functionality_map TEXT,
  egs_serial_number TEXT,
  csr_common_name TEXT,
  csr_organization_name TEXT,
  csr_organizational_unit_name TEXT,
  csr_location TEXT,
  csr_industry TEXT,
  csr_pem TEXT,
  public_key_pem TEXT,
  compliance_request_id TEXT,
  compliance_sample_results JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_safe_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  certificate_valid_from TIMESTAMPTZ,
  csr_generated_at TIMESTAMPTZ,
  compliance_csid_received_at TIMESTAMPTZ,
  compliance_checked_at TIMESTAMPTZ,
  sandbox_production_csid_received_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  compliance_demo_status TEXT NOT NULL DEFAULT 'disabled',
  UNIQUE (tenant_id, branch_id, environment, device_id)
);

ALTER TABLE public.zatca_sandbox_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zatca_sandbox_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.zatca_sandbox_credentials TO service_role;

COMMIT;
