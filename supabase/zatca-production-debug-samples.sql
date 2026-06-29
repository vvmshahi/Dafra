-- ============================================================
-- TEMPORARY DEBUG: ZATCA production compliance failed sample XML capture
-- Safe to run multiple times. Remove after production onboarding is fixed.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.zatca_production_debug_samples (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id                       UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  sample_type                     TEXT NOT NULL,
  invoice_hash                    TEXT,
  signed_invoice_xml_base64       TEXT NOT NULL,
  issue_date                      TEXT,
  issue_time                      TEXT,
  qr_timestamp                    TEXT,
  transformed_canonical_hash      TEXT,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zatca_prod_debug_samples_branch_created
  ON public.zatca_production_debug_samples (branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_zatca_prod_debug_samples_tenant_created
  ON public.zatca_production_debug_samples (tenant_id, created_at DESC);

ALTER TABLE public.zatca_production_debug_samples ENABLE ROW LEVEL SECURITY;

-- No authenticated policies are created on purpose.
-- TEMPORARY DEBUG: rows may contain full signed invoice XML and are accessible
-- only through service-role tooling/scripts.

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT ON TABLE public.zatca_production_debug_samples TO service_role;

DROP POLICY IF EXISTS zatca_prod_debug_samples_service_role_select
  ON public.zatca_production_debug_samples;

CREATE POLICY zatca_prod_debug_samples_service_role_select
  ON public.zatca_production_debug_samples
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS zatca_prod_debug_samples_service_role_insert
  ON public.zatca_production_debug_samples;

CREATE POLICY zatca_prod_debug_samples_service_role_insert
  ON public.zatca_production_debug_samples
  FOR INSERT
  TO service_role
  WITH CHECK (true);

COMMENT ON TABLE public.zatca_production_debug_samples IS
  'TEMPORARY DEBUG: failed ZATCA production compliance sample signed XML capture. Service-role only. Remove after onboarding debug.';

COMMENT ON COLUMN public.zatca_production_debug_samples.signed_invoice_xml_base64 IS
  'TEMPORARY DEBUG: exact signed invoice XML base64 submitted during failed compliance sample.';
