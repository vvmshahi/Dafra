-- Safe, non-secret metadata for auditing the V2 Production request linkage.
BEGIN;

ALTER TABLE public.zatca_sandbox_v2_events
  ADD COLUMN IF NOT EXISTS production_request_linkage JSONB NOT NULL DEFAULT '{}'::JSONB;

COMMIT;
