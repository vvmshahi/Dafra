-- SUPERSEDED / UNSAFE / DO NOT EXECUTE. See ../zatca-phase2-finalization-v2/.
-- Phase 2 finalization state (additive, idempotent; do not execute from the
-- repository without a reviewed production change window).
--
-- This migration adds only server-owned metadata. It never rewrites QR, XML,
-- hashes, signatures, UUIDs, counters, or invoice-chain values.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'zatca_finalization_status'
  ) THEN
    CREATE TYPE public.zatca_finalization_status AS ENUM (
      'not_started',
      'finalizing',
      'finalized',
      'failed'
    );
  END IF;
END
$$;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS zatca_finalization_status public.zatca_finalization_status
    NOT NULL DEFAULT 'not_started'::public.zatca_finalization_status,
  ADD COLUMN IF NOT EXISTS zatca_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_finalization_error jsonb,
  ADD COLUMN IF NOT EXISTS zatca_finalization_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoices_zatca_finalization_version_positive'
      AND conrelid = 'public.invoices'::regclass
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_zatca_finalization_version_positive
      CHECK (zatca_finalization_version > 0) NOT VALID;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS invoices_zatca_finalization_status_idx
  ON public.invoices (tenant_id, branch_id, zatca_finalization_status, created_at DESC);

GRANT SELECT (
  zatca_finalization_status,
  zatca_finalized_at,
  zatca_finalization_error,
  zatca_finalization_version
) ON TABLE public.invoices TO authenticated;

COMMENT ON COLUMN public.invoices.zatca_finalization_status IS
  'Server-owned local Phase 2 finalization state. finalized means XML, hash, signature, and QR are complete and immutable.';
COMMENT ON COLUMN public.invoices.zatca_finalized_at IS
  'Server timestamp for the first successful immutable Phase 2 finalization.';
COMMENT ON COLUMN public.invoices.zatca_finalization_error IS
  'Safe local-finalization error metadata; never contains keys, certificates, raw XML, or QR payloads.';
COMMENT ON COLUMN public.invoices.zatca_finalization_version IS
  'Version marker for the server-owned finalization contract.';

-- Conservative metadata-only classification for already-complete historical
-- documents. No compliance value is changed. Incomplete rows remain
-- not_started and are never silently regenerated or backfilled.
UPDATE public.invoices
SET zatca_finalization_status = 'finalized',
    zatca_finalized_at = COALESCE(zatca_submitted_at, updated_at, created_at)
WHERE zatca_finalization_status = 'not_started'
  AND NULLIF(BTRIM(zatca_qr_code), '') IS NOT NULL
  AND NULLIF(BTRIM(zatca_xml), '') IS NOT NULL
  AND NULLIF(BTRIM(zatca_xml_hash), '') IS NOT NULL
  AND NULLIF(BTRIM(zatca_signature), '') IS NOT NULL;

COMMIT;
