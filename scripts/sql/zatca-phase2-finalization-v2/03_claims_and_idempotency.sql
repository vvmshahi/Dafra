-- ZATCA Phase 2 immutable finalization v2
-- 03_claims_and_idempotency.sql
-- Leased local claims, leased single-writer network claims, token-checked writes.

BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS zatca_finalization_claim_token_v2 uuid,
  ADD COLUMN IF NOT EXISTS zatca_finalization_claimed_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_finalization_lease_expires_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_finalization_claimed_by_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_finalization_attempt_v2 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zatca_network_claim_token_v2 uuid,
  ADD COLUMN IF NOT EXISTS zatca_network_claimed_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_network_lease_expires_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_network_claimed_by_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_network_operation_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_network_attempt_v2 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zatca_network_idempotency_key_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_network_request_hash_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_network_request_started_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_network_ack_state_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_reconciliation_reason_v2 text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_network_operation_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_network_operation_v2_check
      CHECK (zatca_network_operation_v2 IS NULL OR zatca_network_operation_v2 IN ('report', 'clear'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_network_ack_state_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_network_ack_state_v2_check
      CHECK (zatca_network_ack_state_v2 IS NULL OR zatca_network_ack_state_v2 IN (
        'idle', 'claimed', 'request_started', 'response_persisted', 'reconciliation_required'
      ));
  END IF;
END
$constraints$;

CREATE OR REPLACE FUNCTION public.zatca_v2_document_kind(p_invoice public.invoices)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_original_type text;
BEGIN
  IF p_invoice.zatca_invoice_type IN ('simplified', 'standard') THEN
    RETURN p_invoice.zatca_invoice_type;
  END IF;
  IF p_invoice.original_invoice_id IS NOT NULL THEN
    SELECT zatca_invoice_type INTO v_original_type
    FROM public.invoices
    WHERE id = p_invoice.original_invoice_id
      AND tenant_id = p_invoice.tenant_id;
  END IF;
  IF v_original_type IN ('simplified', 'standard') THEN RETURN v_original_type; END IF;
  RAISE EXCEPTION 'UNRESOLVED_DOCUMENT_KIND';
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_zatca_finalization_v2(
  p_invoice_id uuid,
  p_claimed_by text,
  p_lease_seconds integer DEFAULT 90
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_kind text;
  v_token uuid;
  v_now timestamptz := clock_timestamp();
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  SELECT * INTO v_runtime FROM public.zatca_finalization_runtime WHERE singleton = true;
  IF NOT COALESCE(v_runtime.immutable_finalization_enabled, false) THEN
    RAISE EXCEPTION 'IMMUTABLE_FINALIZATION_DISABLED';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2' THEN
    RAISE EXCEPTION 'LEGACY_UNVERIFIED_INVOICE';
  END IF;
  v_kind := public.zatca_v2_document_kind(v_invoice);
  IF v_kind = 'simplified' AND NOT v_runtime.simplified_enabled THEN
    RAISE EXCEPTION 'SIMPLIFIED_FINALIZATION_DISABLED';
  END IF;
  IF v_kind = 'standard' AND NOT v_runtime.standard_enabled THEN
    RAISE EXCEPTION 'STANDARD_FINALIZATION_DISABLED';
  END IF;

  IF (v_kind = 'simplified' AND v_invoice.zatca_artifact_stage = 'simplified_final')
     OR (v_kind = 'standard' AND v_invoice.zatca_artifact_stage IN ('standard_provisional', 'standard_cleared')) THEN
    RETURN jsonb_build_object(
      'status', 'already_finalized', 'documentKind', v_kind,
      'lifecycleState', v_invoice.zatca_lifecycle_state,
      'artifactStage', v_invoice.zatca_artifact_stage
    );
  END IF;

  IF v_invoice.zatca_finalization_claim_token_v2 IS NOT NULL
     AND v_invoice.zatca_finalization_lease_expires_at_v2 > v_now THEN
    RETURN jsonb_build_object(
      'status', 'in_progress', 'documentKind', v_kind,
      'leaseExpiresAt', v_invoice.zatca_finalization_lease_expires_at_v2
    );
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.invoices SET
    zatca_document_kind = v_kind,
    zatca_lifecycle_state = CASE WHEN zatca_lifecycle_state = 'not_started' THEN 'claiming' ELSE 'retrying' END,
    zatca_finalization_claim_token_v2 = v_token,
    zatca_finalization_claimed_at_v2 = v_now,
    zatca_finalization_lease_expires_at_v2 = v_now + make_interval(secs => p_lease_seconds),
    zatca_finalization_claimed_by_v2 = left(COALESCE(NULLIF(p_claimed_by, ''), 'unknown'), 120),
    zatca_finalization_attempt_v2 = zatca_finalization_attempt_v2 + 1,
    zatca_finalization_error_v2 = NULL
  WHERE id = p_invoice_id;

  -- An expired claim transfers only its still-open reservation. A committed
  -- reservation is immutable and retries simply reuse it.
  UPDATE public.zatca_chain_reservations_v2 SET claim_token = v_token
  WHERE invoice_id = p_invoice_id AND state = 'allocated';

  RETURN jsonb_build_object(
    'status', 'claimed', 'claimToken', v_token, 'documentKind', v_kind,
    'leaseExpiresAt', v_now + make_interval(secs => p_lease_seconds)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.persist_zatca_simplified_final_v2(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_signed_xml text,
  p_xml_hash text,
  p_signature text,
  p_qr text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NULLIF(p_signed_xml, '') IS NULL OR NULLIF(p_xml_hash, '') IS NULL
     OR NULLIF(p_signature, '') IS NULL OR NULLIF(p_qr, '') IS NULL THEN
    RAISE EXCEPTION 'INCOMPLETE_SIMPLIFIED_ARTIFACT';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token
     OR v_invoice.zatca_finalization_lease_expires_at_v2 <= clock_timestamp() THEN
    RAISE EXCEPTION 'STALE_FINALIZATION_CLAIM_TOKEN';
  END IF;
  IF v_invoice.zatca_document_kind IS DISTINCT FROM 'simplified'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'ILLEGAL_SIMPLIFIED_TRANSITION';
  END IF;

  PERFORM public.commit_zatca_chain_v2(p_invoice_id, p_claim_token, p_xml_hash);
  UPDATE public.invoices SET
    zatca_simplified_xml = p_signed_xml,
    zatca_simplified_xml_hash = p_xml_hash,
    zatca_simplified_signature = p_signature,
    zatca_simplified_qr = p_qr,
    zatca_artifact_stage = 'simplified_final',
    zatca_lifecycle_state = 'locally_finalized',
    zatca_finalized_at_v2 = clock_timestamp(),
    zatca_finalization_claim_token_v2 = NULL,
    zatca_finalization_lease_expires_at_v2 = NULL,
    zatca_finalization_error_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object('status', 'locally_finalized', 'artifactStage', 'simplified_final');
END
$function$;

CREATE OR REPLACE FUNCTION public.persist_zatca_standard_provisional_v2(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_signed_xml text,
  p_xml_hash text,
  p_signature text,
  p_qr text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NULLIF(p_signed_xml, '') IS NULL OR NULLIF(p_xml_hash, '') IS NULL
     OR NULLIF(p_signature, '') IS NULL THEN RAISE EXCEPTION 'INCOMPLETE_STANDARD_PROVISIONAL_ARTIFACT'; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token
     OR v_invoice.zatca_finalization_lease_expires_at_v2 <= clock_timestamp() THEN
    RAISE EXCEPTION 'STALE_FINALIZATION_CLAIM_TOKEN';
  END IF;
  IF v_invoice.zatca_document_kind IS DISTINCT FROM 'standard'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'ILLEGAL_STANDARD_PROVISIONAL_TRANSITION';
  END IF;

  PERFORM public.commit_zatca_chain_v2(p_invoice_id, p_claim_token, p_xml_hash);
  UPDATE public.invoices SET
    zatca_provisional_xml = p_signed_xml,
    zatca_provisional_xml_hash = p_xml_hash,
    zatca_provisional_signature = p_signature,
    zatca_provisional_qr = NULLIF(p_qr, ''),
    zatca_artifact_stage = 'standard_provisional',
    zatca_lifecycle_state = 'provisional_signed',
    zatca_finalization_claim_token_v2 = NULL,
    zatca_finalization_lease_expires_at_v2 = NULL,
    zatca_finalization_error_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object('status', 'provisional_signed', 'artifactStage', 'standard_provisional');
END
$function$;

CREATE OR REPLACE FUNCTION public.fail_zatca_finalization_v2(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_safe_error jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.invoices SET
    zatca_lifecycle_state = 'finalization_failed',
    zatca_finalization_error_v2 = COALESCE(p_safe_error, '{"code":"FINALIZATION_FAILED"}'::jsonb),
    zatca_finalization_claim_token_v2 = NULL,
    zatca_finalization_lease_expires_at_v2 = NULL
  WHERE id = p_invoice_id AND zatca_finalization_claim_token_v2 = p_claim_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_FINALIZATION_CLAIM_TOKEN'; END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_zatca_network_v2(
  p_invoice_id uuid,
  p_claimed_by text,
  p_lease_seconds integer DEFAULT 120
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_token uuid;
  v_operation text;
  v_hash text;
  v_key text;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  IF v_invoice.zatca_lifecycle_state IN ('reported', 'cleared_final') THEN
    RETURN jsonb_build_object('status', 'already_complete');
  END IF;
  IF v_invoice.zatca_lifecycle_state = 'reconciliation_required'
     OR v_invoice.zatca_network_ack_state_v2 = 'reconciliation_required' THEN
    RETURN jsonb_build_object('status', 'reconciliation_required');
  END IF;

  IF v_invoice.zatca_artifact_stage = 'simplified_final' THEN
    v_operation := 'report'; v_hash := v_invoice.zatca_simplified_xml_hash;
  ELSIF v_invoice.zatca_artifact_stage = 'standard_provisional' THEN
    v_operation := 'clear'; v_hash := v_invoice.zatca_provisional_xml_hash;
  ELSE
    RAISE EXCEPTION 'NO_SUBMITTABLE_ARTIFACT';
  END IF;

  IF v_invoice.zatca_network_claim_token_v2 IS NOT NULL
     AND v_invoice.zatca_network_lease_expires_at_v2 > v_now THEN
    RETURN jsonb_build_object('status', 'in_progress', 'leaseExpiresAt', v_invoice.zatca_network_lease_expires_at_v2);
  END IF;

  -- Once request bytes may have reached ZATCA, an expired lease cannot be
  -- automatically replayed. A controlled reconciliation must establish the
  -- remote outcome first.
  IF v_invoice.zatca_network_request_started_at_v2 IS NOT NULL
     AND v_invoice.zatca_network_ack_state_v2 = 'request_started' THEN
    UPDATE public.invoices SET
      zatca_lifecycle_state = 'reconciliation_required',
      zatca_network_ack_state_v2 = 'reconciliation_required',
      zatca_reconciliation_reason_v2 = 'network lease expired after request start',
      zatca_network_claim_token_v2 = NULL,
      zatca_network_lease_expires_at_v2 = NULL
    WHERE id = p_invoice_id;
    RETURN jsonb_build_object('status', 'reconciliation_required');
  END IF;

  v_token := gen_random_uuid();
  v_key := 'zatca-v2:' || v_invoice.zatca_uuid::text || ':' || v_operation || ':' || v_hash;
  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE WHEN v_operation = 'report' THEN 'reporting_pending' ELSE 'clearance_pending' END,
    zatca_network_claim_token_v2 = v_token,
    zatca_network_claimed_at_v2 = v_now,
    zatca_network_lease_expires_at_v2 = v_now + make_interval(secs => p_lease_seconds),
    zatca_network_claimed_by_v2 = left(COALESCE(NULLIF(p_claimed_by, ''), 'unknown'), 120),
    zatca_network_operation_v2 = v_operation,
    zatca_network_attempt_v2 = zatca_network_attempt_v2 + 1,
    zatca_network_idempotency_key_v2 = v_key,
    zatca_network_request_hash_v2 = v_hash,
    zatca_network_request_started_at_v2 = NULL,
    zatca_network_ack_state_v2 = 'claimed',
    zatca_reconciliation_reason_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object(
    'status', 'claimed', 'networkToken', v_token, 'operation', v_operation,
    'idempotencyKey', v_key, 'artifactHash', v_hash,
    'leaseExpiresAt', v_now + make_interval(secs => p_lease_seconds)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.mark_zatca_network_request_started_v2(
  p_invoice_id uuid,
  p_network_token uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.invoices SET
    zatca_network_request_started_at_v2 = clock_timestamp(),
    zatca_network_ack_state_v2 = 'request_started'
  WHERE id = p_invoice_id
    AND zatca_network_claim_token_v2 = p_network_token
    AND zatca_network_lease_expires_at_v2 > clock_timestamp()
    AND zatca_network_ack_state_v2 = 'claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_NETWORK_CLAIM_TOKEN'; END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.persist_zatca_reporting_result_v2(
  p_invoice_id uuid,
  p_network_token uuid,
  p_reported boolean,
  p_safe_response jsonb,
  p_safe_warnings jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.zatca_network_claim_token_v2 IS DISTINCT FROM p_network_token
     OR v_invoice.zatca_network_operation_v2 IS DISTINCT FROM 'report' THEN
    RAISE EXCEPTION 'STALE_NETWORK_CLAIM_TOKEN';
  END IF;
  IF v_invoice.zatca_artifact_stage IS DISTINCT FROM 'simplified_final' THEN
    RAISE EXCEPTION 'SIMPLIFIED_FINAL_ARTIFACT_MISSING';
  END IF;
  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE WHEN p_reported THEN 'reported' ELSE 'reporting_failed' END,
    zatca_status = (
      CASE WHEN p_reported THEN 'reported' ELSE 'failed' END
    )::public.zatca_status,
    zatca_submitted_at = clock_timestamp(),
    zatca_network_response_v2 = COALESCE(p_safe_response, '{}'::jsonb),
    zatca_reporting_response = COALESCE(p_safe_response, '{}'::jsonb),
    zatca_warnings = COALESCE(p_safe_warnings, zatca_warnings),
    zatca_network_ack_state_v2 = 'response_persisted',
    zatca_network_claim_token_v2 = NULL,
    zatca_network_lease_expires_at_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object('status', CASE WHEN p_reported THEN 'reported' ELSE 'reporting_failed' END);
END
$function$;

CREATE OR REPLACE FUNCTION public.adopt_zatca_cleared_artifact_v2(
  p_invoice_id uuid,
  p_network_token uuid,
  p_cleared_xml text,
  p_cleared_xml_hash text,
  p_cleared_signature text,
  p_cleared_qr text,
  p_clearance_metadata jsonb,
  p_safe_response jsonb,
  p_safe_warnings jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NULLIF(p_cleared_xml, '') IS NULL OR NULLIF(p_cleared_xml_hash, '') IS NULL
     OR NULLIF(p_cleared_signature, '') IS NULL OR NULLIF(p_cleared_qr, '') IS NULL THEN
    RAISE EXCEPTION 'INCOMPLETE_CLEARED_ARTIFACT';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.zatca_network_claim_token_v2 IS DISTINCT FROM p_network_token
     OR v_invoice.zatca_network_operation_v2 IS DISTINCT FROM 'clear' THEN
    RAISE EXCEPTION 'STALE_NETWORK_CLAIM_TOKEN';
  END IF;
  IF v_invoice.zatca_artifact_stage IS DISTINCT FROM 'standard_provisional'
     OR NULLIF(v_invoice.zatca_provisional_xml, '') IS NULL THEN
    RAISE EXCEPTION 'STANDARD_PROVISIONAL_ARTIFACT_MISSING';
  END IF;

  UPDATE public.invoices SET
    zatca_cleared_xml = p_cleared_xml,
    zatca_cleared_xml_hash = p_cleared_xml_hash,
    zatca_cleared_signature = p_cleared_signature,
    zatca_cleared_qr = p_cleared_qr,
    zatca_clearance_metadata_v2 = COALESCE(p_clearance_metadata, '{}'::jsonb),
    zatca_network_response_v2 = COALESCE(p_safe_response, '{}'::jsonb),
    zatca_clearance_response = COALESCE(p_safe_response, '{}'::jsonb),
    zatca_warnings = COALESCE(p_safe_warnings, zatca_warnings),
    zatca_artifact_stage = 'standard_cleared',
    zatca_lifecycle_state = 'cleared_final',
    zatca_status = 'cleared',
    zatca_clearance_status = 'CLEARED',
    zatca_submitted_at = clock_timestamp(),
    zatca_finalized_at_v2 = clock_timestamp(),
    zatca_network_ack_state_v2 = 'response_persisted',
    zatca_network_claim_token_v2 = NULL,
    zatca_network_lease_expires_at_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object('status', 'cleared_final', 'artifactStage', 'standard_cleared');
END
$function$;

CREATE OR REPLACE FUNCTION public.fail_zatca_network_v2(
  p_invoice_id uuid,
  p_network_token uuid,
  p_ambiguous boolean,
  p_safe_reason text,
  p_safe_response jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_operation text;
BEGIN
  SELECT zatca_network_operation_v2 INTO v_operation
  FROM public.invoices
  WHERE id = p_invoice_id AND zatca_network_claim_token_v2 = p_network_token
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_NETWORK_CLAIM_TOKEN'; END IF;
  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE
      WHEN p_ambiguous THEN 'reconciliation_required'
      WHEN v_operation = 'report' THEN 'reporting_failed'
      ELSE 'clearance_failed'
    END,
    zatca_status = CASE WHEN p_ambiguous THEN zatca_status ELSE 'failed' END,
    zatca_network_response_v2 = COALESCE(p_safe_response, zatca_network_response_v2),
    zatca_network_ack_state_v2 = CASE WHEN p_ambiguous THEN 'reconciliation_required' ELSE 'response_persisted' END,
    zatca_reconciliation_reason_v2 = CASE WHEN p_ambiguous THEN left(COALESCE(p_safe_reason, 'ambiguous network outcome'), 240) ELSE NULL END,
    zatca_finalization_error_v2 = jsonb_build_object('code', CASE WHEN p_ambiguous THEN 'RECONCILIATION_REQUIRED' ELSE 'ZATCA_REJECTED' END, 'message', left(COALESCE(p_safe_reason, 'submission failed'), 240)),
    zatca_network_claim_token_v2 = NULL,
    zatca_network_lease_expires_at_v2 = NULL
  WHERE id = p_invoice_id;
END
$function$;

DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'zatca_v2_document_kind', 'claim_zatca_finalization_v2',
      'persist_zatca_simplified_final_v2', 'persist_zatca_standard_provisional_v2',
      'fail_zatca_finalization_v2', 'claim_zatca_network_v2',
      'mark_zatca_network_request_started_v2', 'persist_zatca_reporting_result_v2',
      'adopt_zatca_cleared_artifact_v2', 'fail_zatca_network_v2'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.signature);
  END LOOP;
END
$grants$;

COMMIT;
