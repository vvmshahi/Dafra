-- ============================================================
-- ZATCA Phase 2 — Schema Updates
-- Run after schema.sql is already applied.
-- ============================================================

-- Add secrets for Basic Auth (never exposed to browser)
ALTER TABLE zatca_certificates
  ADD COLUMN IF NOT EXISTS compliance_secret   TEXT,       -- compliance CSID secret
  ADD COLUMN IF NOT EXISTS production_secret   TEXT,       -- production CSID secret
  ADD COLUMN IF NOT EXISTS activated_at        TIMESTAMPTZ;  -- when production CSID was activated

-- Add public_key_pem column for displaying the EGS public key in the UI
ALTER TABLE zatca_certificates
  ADD COLUMN IF NOT EXISTS public_key_pem      TEXT;       -- PEM ECDSA public key (for display)

-- Ensure invoices table has all ZATCA Phase 2 columns
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS zatca_xml                  TEXT,
  ADD COLUMN IF NOT EXISTS zatca_xml_hash             TEXT,
  ADD COLUMN IF NOT EXISTS zatca_submission_id        TEXT,
  ADD COLUMN IF NOT EXISTS zatca_submitted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zatca_clearance_status     TEXT,
  ADD COLUMN IF NOT EXISTS zatca_reporting_response   JSONB,
  ADD COLUMN IF NOT EXISTS zatca_warnings             JSONB;

-- Ensure zatca_status column exists and has correct default
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'zatca_status'
  ) THEN
    ALTER TABLE invoices ADD COLUMN zatca_status VARCHAR(30) DEFAULT 'not_submitted';
  END IF;
END $$;

-- Update certificate_status enum to include all needed statuses
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'compliance' AND enumtypid = 'certificate_status'::regtype) THEN
    ALTER TYPE certificate_status ADD VALUE 'compliance';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'active' AND enumtypid = 'certificate_status'::regtype) THEN
    ALTER TYPE certificate_status ADD VALUE 'active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expired' AND enumtypid = 'certificate_status'::regtype) THEN
    ALTER TYPE certificate_status ADD VALUE 'expired';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'revoked' AND enumtypid = 'certificate_status'::regtype) THEN
    ALTER TYPE certificate_status ADD VALUE 'revoked';
  END IF;
END $$;

-- sync_queue table for ZATCA retry logic
CREATE TABLE IF NOT EXISTS sync_queue (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id       UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  invoice_id      UUID REFERENCES invoices(id) ON DELETE CASCADE,
  action          VARCHAR(50) NOT NULL,       -- 'zatca_submit'
  payload         JSONB,
  status          VARCHAR(20) DEFAULT 'pending', -- pending | success | failed
  attempts        INTEGER DEFAULT 0,
  max_attempts    INTEGER DEFAULT 5,
  last_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_tenant   ON sync_queue (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status   ON sync_queue (status);
CREATE INDEX IF NOT EXISTS idx_sync_queue_action   ON sync_queue (action);
CREATE INDEX IF NOT EXISTS idx_sync_queue_invoice  ON sync_queue (invoice_id);

-- RLS for sync_queue
ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_queue_super_admin" ON sync_queue
  FOR ALL TO authenticated
  USING  (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super_admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'super_admin'));

CREATE POLICY "sync_queue_owner_all" ON sync_queue
  FOR ALL TO authenticated
  USING  (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND role = 'owner'));

CREATE POLICY "sync_queue_manager_read" ON sync_queue
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid() AND role IN ('owner','manager')));
