-- ZATCA Phase 2 immutable finalization v2
-- 01_artifact_lifecycle.sql
-- ADDITIVE / DISABLED BY DEFAULT / NO HISTORICAL CLASSIFICATION

BEGIN;

CREATE TABLE IF NOT EXISTS public.zatca_finalization_runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  immutable_finalization_enabled boolean NOT NULL DEFAULT false,
  simplified_enabled boolean NOT NULL DEFAULT false,
  standard_enabled boolean NOT NULL DEFAULT false,
  schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version = 2),
  minimum_edge_version text NOT NULL DEFAULT '2.0.0',
  minimum_client_version text NOT NULL DEFAULT '2.0.0',
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NULL REFERENCES auth.users(id)
);

INSERT INTO public.zatca_finalization_runtime (
  singleton,
  immutable_finalization_enabled,
  simplified_enabled,
  standard_enabled
) VALUES (true, false, false, false)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.zatca_finalization_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_finalization_runtime FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zatca_finalization_runtime TO service_role;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS zatca_finalization_version integer,
  ADD COLUMN IF NOT EXISTS zatca_artifact_provenance text,
  ADD COLUMN IF NOT EXISTS zatca_document_kind text,
  ADD COLUMN IF NOT EXISTS zatca_lifecycle_state text,
  ADD COLUMN IF NOT EXISTS zatca_artifact_stage text,
  ADD COLUMN IF NOT EXISTS zatca_finalized_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_finalization_error_v2 jsonb,

  ADD COLUMN IF NOT EXISTS zatca_simplified_xml text,
  ADD COLUMN IF NOT EXISTS zatca_simplified_xml_hash text,
  ADD COLUMN IF NOT EXISTS zatca_simplified_signature text,
  ADD COLUMN IF NOT EXISTS zatca_simplified_qr text,

  ADD COLUMN IF NOT EXISTS zatca_provisional_xml text,
  ADD COLUMN IF NOT EXISTS zatca_provisional_xml_hash text,
  ADD COLUMN IF NOT EXISTS zatca_provisional_signature text,
  ADD COLUMN IF NOT EXISTS zatca_provisional_qr text,

  ADD COLUMN IF NOT EXISTS zatca_cleared_xml text,
  ADD COLUMN IF NOT EXISTS zatca_cleared_xml_hash text,
  ADD COLUMN IF NOT EXISTS zatca_cleared_signature text,
  ADD COLUMN IF NOT EXISTS zatca_cleared_qr text,
  ADD COLUMN IF NOT EXISTS zatca_clearance_metadata_v2 jsonb,
  ADD COLUMN IF NOT EXISTS zatca_network_response_v2 jsonb;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_finalization_version_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_finalization_version_v2_check
      CHECK (zatca_finalization_version IS NULL OR zatca_finalization_version = 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_artifact_provenance_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_artifact_provenance_v2_check
      CHECK (zatca_artifact_provenance IS NULL OR zatca_artifact_provenance = 'server_v2');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_document_kind_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_document_kind_v2_check
      CHECK (zatca_document_kind IS NULL OR zatca_document_kind IN ('simplified', 'standard'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_lifecycle_state_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_lifecycle_state_v2_check
      CHECK (zatca_lifecycle_state IS NULL OR zatca_lifecycle_state IN (
        'not_started', 'claiming', 'locally_finalized', 'reporting_pending', 'reported',
        'provisional_signed', 'clearance_pending', 'cleared_final',
        'finalization_failed', 'reporting_failed', 'clearance_failed', 'retrying',
        'reconciliation_required'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_artifact_stage_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_artifact_stage_v2_check
      CHECK (zatca_artifact_stage IS NULL OR zatca_artifact_stage IN (
        'none', 'simplified_final', 'standard_provisional', 'standard_cleared'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_artifact_shape_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_artifact_shape_v2_check CHECK (
      zatca_finalization_version IS NULL
      OR (
        zatca_artifact_provenance = 'server_v2'
        AND zatca_document_kind IN ('simplified', 'standard')
        AND zatca_lifecycle_state IS NOT NULL
        AND zatca_artifact_stage IS NOT NULL
        AND (
          zatca_artifact_stage = 'none'
          OR (zatca_artifact_stage = 'simplified_final'
            AND zatca_document_kind = 'simplified'
            AND NULLIF(zatca_simplified_xml, '') IS NOT NULL
            AND NULLIF(zatca_simplified_xml_hash, '') IS NOT NULL
            AND NULLIF(zatca_simplified_signature, '') IS NOT NULL
            AND NULLIF(zatca_simplified_qr, '') IS NOT NULL)
          OR (zatca_artifact_stage = 'standard_provisional'
            AND zatca_document_kind = 'standard'
            AND NULLIF(zatca_provisional_xml, '') IS NOT NULL
            AND NULLIF(zatca_provisional_xml_hash, '') IS NOT NULL
            AND NULLIF(zatca_provisional_signature, '') IS NOT NULL)
          OR (zatca_artifact_stage = 'standard_cleared'
            AND zatca_document_kind = 'standard'
            AND NULLIF(zatca_provisional_xml, '') IS NOT NULL
            AND NULLIF(zatca_provisional_xml_hash, '') IS NOT NULL
            AND NULLIF(zatca_cleared_xml, '') IS NOT NULL
            AND NULLIF(zatca_cleared_xml_hash, '') IS NOT NULL
            AND NULLIF(zatca_cleared_signature, '') IS NOT NULL
            AND NULLIF(zatca_cleared_qr, '') IS NOT NULL)
        )
      )
    ) NOT VALID;
  END IF;
END
$constraints$;

COMMENT ON COLUMN public.invoices.zatca_finalization_version IS
  'NULL means legacy/unclassified. Value 2 is set only for new feature-gated invoices; never backfilled.';
COMMENT ON COLUMN public.invoices.zatca_artifact_provenance IS
  'NULL means legacy_unverified. server_v2 means the v2 server state machine created the artifact.';
COMMENT ON COLUMN public.invoices.zatca_simplified_qr IS
  'Authoritative immutable customer QR only for artifact_stage=simplified_final.';
COMMENT ON COLUMN public.invoices.zatca_provisional_xml IS
  'Immutable standard clearance request. It is never a customer-output artifact.';
COMMENT ON COLUMN public.invoices.zatca_cleared_xml IS
  'Authoritative standard customer XML returned by and validated from ZATCA clearance.';

-- Deliberately no UPDATE statement exists in this migration. Existing rows retain
-- NULL version/provenance/lifecycle and therefore remain legacy_unverified.
CREATE OR REPLACE FUNCTION public.initialize_zatca_finalization_v2_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_enabled boolean := false;
  v_original_kind text;
BEGIN
  SELECT immutable_finalization_enabled
  INTO v_enabled
  FROM public.zatca_finalization_runtime
  WHERE singleton = true;

  IF COALESCE(v_enabled, false) THEN
    NEW.zatca_finalization_version := 2;
    NEW.zatca_artifact_provenance := 'server_v2';
    NEW.zatca_lifecycle_state := 'not_started';
    NEW.zatca_artifact_stage := 'none';
    v_original_kind := CASE
      WHEN NEW.zatca_invoice_type = 'simplified' THEN 'simplified'
      WHEN NEW.zatca_invoice_type = 'standard' THEN 'standard'
      ELSE NULL
    END;
    IF v_original_kind IS NULL AND NEW.original_invoice_id IS NOT NULL THEN
      SELECT CASE
        WHEN zatca_invoice_type = 'simplified' THEN 'simplified'
        WHEN zatca_invoice_type = 'standard' THEN 'standard'
        ELSE NULL
      END INTO v_original_kind
      FROM public.invoices
      WHERE id = NEW.original_invoice_id AND tenant_id = NEW.tenant_id;
    END IF;
    IF v_original_kind IS NULL THEN RAISE EXCEPTION 'UNRESOLVED_DOCUMENT_KIND'; END IF;
    NEW.zatca_document_kind := v_original_kind;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.initialize_zatca_finalization_v2_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zatca_v2_20_initialize_invoice ON public.invoices;
CREATE TRIGGER zatca_v2_20_initialize_invoice
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.initialize_zatca_finalization_v2_invoice();

COMMIT;
