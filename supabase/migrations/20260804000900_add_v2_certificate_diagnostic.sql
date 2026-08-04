-- Safe, non-secret metadata for diagnosing persisted V2 certificate matching.
BEGIN;

ALTER TABLE public.zatca_sandbox_v2_events
  ADD COLUMN IF NOT EXISTS certificate_diagnostic JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMIT;
