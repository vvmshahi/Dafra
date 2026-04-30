-- ============================================================
-- ZATCA Phase 2 — Schema Updates
-- Safe to run multiple times (fully idempotent).
-- Run after schema.sql is already applied.
-- ============================================================

-- zatca_certificates: add Phase 2 columns
ALTER TABLE zatca_certificates
  ADD COLUMN IF NOT EXISTS compliance_secret   TEXT,
  ADD COLUMN IF NOT EXISTS production_secret   TEXT,
  ADD COLUMN IF NOT EXISTS public_key_pem      TEXT,
  ADD COLUMN IF NOT EXISTS activated_at        TIMESTAMPTZ;

-- invoices: add ZATCA Phase 2 submission columns
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS zatca_xml                  TEXT,
  ADD COLUMN IF NOT EXISTS zatca_xml_hash             TEXT,
  ADD COLUMN IF NOT EXISTS zatca_submission_id        TEXT,
  ADD COLUMN IF NOT EXISTS zatca_submitted_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS zatca_clearance_status     TEXT,
  ADD COLUMN IF NOT EXISTS zatca_reporting_response   JSONB,
  ADD COLUMN IF NOT EXISTS zatca_warnings             JSONB;

-- invoices: ensure zatca_status column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'zatca_status'
  ) THEN
    ALTER TABLE invoices ADD COLUMN zatca_status VARCHAR(30) DEFAULT 'not_submitted';
  END IF;
END $$;

-- certificate_status enum: add missing values
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

-- sync_queue: already created in schema.sql — nothing to do here.
-- Add action index if missing (schema.sql omits it).
CREATE INDEX IF NOT EXISTS idx_sync_queue_action ON sync_queue (action);
