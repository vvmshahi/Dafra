-- ZATCA Phase 2 immutable finalization v2
-- 11_durable_simplified_reporting_outbox.sql
-- Additive transactional outbox for server-side simplified reporting.
--
-- This file is safe to install while all finalization flags are false. It does
-- not enqueue historical rows. The two known incident rows are handled only by
-- the separately authenticated, hard-coded recovery path.
--
-- Retry policy: at most four transient dispatch attempts. Backoff after the
-- first three transient failures is 60, 120, then 240 seconds. A fourth
-- transient failure is blocked as MAX_TRANSIENT_ATTEMPTS_REACHED. Definite
-- ZATCA rejections and ambiguous post-send outcomes are never auto-retried.

BEGIN;

CREATE TABLE IF NOT EXISTS public.zatca_reporting_outbox_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  operation text NOT NULL DEFAULT 'report' CHECK (operation = 'report'),
  artifact_hash text NOT NULL CHECK (NULLIF(btrim(artifact_hash), '') IS NOT NULL),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'retryable', 'accepted', 'blocked')
  ),
  source text NOT NULL DEFAULT 'finalization',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  claimed_by text,
  last_outcome text,
  last_error text,
  safe_response jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_at timestamptz,
  UNIQUE (invoice_id, operation)
);

ALTER TABLE public.zatca_reporting_outbox_v2
  ADD COLUMN IF NOT EXISTS last_outcome text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.zatca_reporting_outbox_v2'::regclass
      AND conname = 'zatca_reporting_outbox_v2_last_outcome_check'
  ) THEN
    ALTER TABLE public.zatca_reporting_outbox_v2
      ADD CONSTRAINT zatca_reporting_outbox_v2_last_outcome_check
      CHECK (
        last_outcome IS NULL OR last_outcome IN (
          'accepted', 'transient_failure', 'definite_rejection', 'ambiguous_outcome'
        )
      );
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS zatca_reporting_outbox_v2_dispatch_idx
ON public.zatca_reporting_outbox_v2(status, available_at, created_at)
WHERE status IN ('pending', 'retryable');

CREATE INDEX IF NOT EXISTS zatca_reporting_outbox_v2_branch_idx
ON public.zatca_reporting_outbox_v2(tenant_id, branch_id, created_at);

ALTER TABLE public.zatca_reporting_outbox_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_reporting_outbox_v2 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zatca_reporting_outbox_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_zatca_reporting_outbox_v2(
  p_invoice_id uuid,
  p_source text DEFAULT 'server_retry'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_reservation public.zatca_chain_reservations_v2%ROWTYPE;
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2'
     OR v_invoice.zatca_document_kind IS DISTINCT FROM 'simplified'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'simplified_final'
     OR NULLIF(v_invoice.zatca_simplified_xml, '') IS NULL
     OR NULLIF(v_invoice.zatca_simplified_xml_hash, '') IS NULL
     OR NULLIF(v_invoice.zatca_simplified_signature, '') IS NULL
     OR NULLIF(v_invoice.zatca_simplified_qr, '') IS NULL THEN
    RAISE EXCEPTION 'SIMPLIFIED_FINAL_ARTIFACT_MISSING';
  END IF;
  IF v_invoice.zatca_lifecycle_state = 'reconciliation_required'
     OR v_invoice.zatca_network_ack_state_v2 = 'reconciliation_required' THEN
    RAISE EXCEPTION 'RECONCILIATION_REQUIRED';
  END IF;

  SELECT * INTO v_reservation
  FROM public.zatca_chain_reservations_v2
  WHERE invoice_id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_reservation.state IS DISTINCT FROM 'committed'
     OR v_reservation.counter_number IS DISTINCT FROM v_invoice.zatca_counter_number
     OR v_reservation.previous_hash IS DISTINCT FROM v_invoice.zatca_prev_invoice_hash
     OR v_reservation.committed_artifact_hash IS DISTINCT FROM v_invoice.zatca_simplified_xml_hash THEN
    RAISE EXCEPTION 'COMMITTED_ARTIFACT_IDENTITY_MISMATCH';
  END IF;

  SELECT * INTO v_outbox
  FROM public.zatca_reporting_outbox_v2
  WHERE invoice_id = p_invoice_id AND operation = 'report'
  FOR UPDATE;

  IF FOUND THEN
    IF v_outbox.artifact_hash IS DISTINCT FROM v_invoice.zatca_simplified_xml_hash
       OR v_outbox.tenant_id IS DISTINCT FROM v_invoice.tenant_id
       OR v_outbox.branch_id IS DISTINCT FROM v_invoice.branch_id THEN
      RAISE EXCEPTION 'OUTBOX_ARTIFACT_IDENTITY_MISMATCH';
    END IF;
    IF v_outbox.status = 'accepted' OR v_invoice.zatca_status = 'reported' THEN
      UPDATE public.zatca_reporting_outbox_v2 SET
        status = 'accepted',
        accepted_at = COALESCE(accepted_at, clock_timestamp()),
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
      WHERE id = v_outbox.id;
      RETURN jsonb_build_object('status', 'accepted', 'outboxId', v_outbox.id);
    END IF;
    IF v_outbox.status = 'blocked' THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'outboxId', v_outbox.id,
        'error', COALESCE(v_outbox.last_error, 'REPORTING_OUTBOX_BLOCKED')
      );
    END IF;
    IF v_outbox.status = 'processing'
       AND v_outbox.lease_expires_at > clock_timestamp() THEN
      RETURN jsonb_build_object(
        'status', 'in_progress',
        'outboxId', v_outbox.id,
        'leaseExpiresAt', v_outbox.lease_expires_at
      );
    END IF;

    UPDATE public.zatca_reporting_outbox_v2 SET
      status = 'pending',
      source = left(COALESCE(NULLIF(p_source, ''), 'server_retry'), 80),
      available_at = clock_timestamp(),
      lease_token = NULL,
      lease_expires_at = NULL,
      claimed_by = NULL,
      last_error = NULL,
      updated_at = clock_timestamp()
    WHERE id = v_outbox.id;
    RETURN jsonb_build_object('status', 'pending', 'outboxId', v_outbox.id);
  END IF;

  INSERT INTO public.zatca_reporting_outbox_v2 (
    tenant_id, branch_id, invoice_id, operation, artifact_hash, status, source
  ) VALUES (
    v_invoice.tenant_id,
    v_invoice.branch_id,
    v_invoice.id,
    'report',
    v_invoice.zatca_simplified_xml_hash,
    CASE WHEN v_invoice.zatca_status = 'reported' THEN 'accepted' ELSE 'pending' END,
    left(COALESCE(NULLIF(p_source, ''), 'server_retry'), 80)
  )
  RETURNING * INTO v_outbox;

  RETURN jsonb_build_object('status', v_outbox.status, 'outboxId', v_outbox.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_zatca_reporting_outbox_v2(
  p_claimed_by text,
  p_lease_seconds integer DEFAULT 120,
  p_invoice_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_reservation public.zatca_chain_reservations_v2%ROWTYPE;
  v_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'INVALID_LEASE';
  END IF;

  SELECT o.* INTO v_outbox
  FROM public.zatca_reporting_outbox_v2 o
  JOIN public.invoices i ON i.id = o.invoice_id
  WHERE (p_invoice_id IS NULL OR o.invoice_id = p_invoice_id)
    AND (
      (o.status IN ('pending', 'retryable') AND o.available_at <= v_now)
      OR (o.status = 'processing' AND o.lease_expires_at <= v_now)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.zatca_reporting_outbox_v2 earlier
      JOIN public.invoices earlier_invoice ON earlier_invoice.id = earlier.invoice_id
      WHERE earlier.tenant_id = o.tenant_id
        AND earlier.branch_id = o.branch_id
        AND earlier_invoice.zatca_counter_number < i.zatca_counter_number
        AND earlier.status <> 'accepted'
    )
  ORDER BY i.zatca_counter_number, o.created_at
  FOR UPDATE OF o SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_work'); END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_outbox.invoice_id
  FOR UPDATE;
  SELECT * INTO v_reservation
  FROM public.zatca_chain_reservations_v2
  WHERE invoice_id = v_outbox.invoice_id
  FOR UPDATE;

  IF v_invoice.zatca_status = 'reported'
     AND v_invoice.zatca_lifecycle_state = 'reported' THEN
    UPDATE public.zatca_reporting_outbox_v2 SET
      status = 'accepted',
      accepted_at = COALESCE(accepted_at, v_now),
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
    WHERE id = v_outbox.id;
    RETURN jsonb_build_object(
      'status', 'already_accepted',
      'invoiceId', v_outbox.invoice_id,
      'outboxId', v_outbox.id
    );
  END IF;

  -- attempt_count counts actual claimed dispatch attempts. A legacy or
  -- manually-corrupted retryable row can never receive a fifth attempt.
  IF v_outbox.attempt_count >= 4 THEN
    UPDATE public.zatca_reporting_outbox_v2 SET
      status = 'blocked',
      last_outcome = 'transient_failure',
      last_error = 'MAX_TRANSIENT_ATTEMPTS_REACHED',
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
    WHERE id = v_outbox.id;
    UPDATE public.invoices SET
      zatca_lifecycle_state = 'reporting_failed',
      zatca_status = 'failed',
      zatca_finalization_error_v2 = jsonb_build_object(
        'code', 'MAX_TRANSIENT_ATTEMPTS_REACHED',
        'message', 'Maximum transient reporting attempts reached.'
      )
    WHERE id = v_outbox.invoice_id;
    RETURN jsonb_build_object(
      'status', 'blocked',
      'invoiceId', v_outbox.invoice_id,
      'outboxId', v_outbox.id,
      'error', 'MAX_TRANSIENT_ATTEMPTS_REACHED'
    );
  END IF;

  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2'
     OR v_invoice.zatca_document_kind IS DISTINCT FROM 'simplified'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'simplified_final'
     OR NULLIF(v_invoice.zatca_simplified_xml, '') IS NULL
     OR v_invoice.zatca_simplified_xml_hash IS DISTINCT FROM v_outbox.artifact_hash
     OR v_reservation.state IS DISTINCT FROM 'committed'
     OR v_reservation.committed_artifact_hash IS DISTINCT FROM v_outbox.artifact_hash
     OR v_reservation.counter_number IS DISTINCT FROM v_invoice.zatca_counter_number
     OR v_reservation.previous_hash IS DISTINCT FROM v_invoice.zatca_prev_invoice_hash THEN
    UPDATE public.zatca_reporting_outbox_v2 SET
      status = 'blocked',
      last_error = 'COMMITTED_ARTIFACT_IDENTITY_MISMATCH',
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
    WHERE id = v_outbox.id;
    RETURN jsonb_build_object(
      'status', 'blocked',
      'invoiceId', v_outbox.invoice_id,
      'outboxId', v_outbox.id,
      'error', 'COMMITTED_ARTIFACT_IDENTITY_MISMATCH'
    );
  END IF;

  UPDATE public.zatca_reporting_outbox_v2 SET
    status = 'processing',
    attempt_count = attempt_count + 1,
    lease_token = v_token,
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    claimed_by = left(COALESCE(NULLIF(p_claimed_by, ''), 'unknown'), 120),
    updated_at = v_now
  WHERE id = v_outbox.id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'outboxId', v_outbox.id,
    'outboxToken', v_token,
    'invoiceId', v_invoice.id,
    'tenantId', v_invoice.tenant_id,
    'branchId', v_invoice.branch_id,
    'counterNumber', v_invoice.zatca_counter_number,
    'artifactHash', v_outbox.artifact_hash
  );
END
$function$;

-- Remove the unsafe boolean contract if an earlier review build installed it.
DROP FUNCTION IF EXISTS public.persist_zatca_reporting_outbox_result_v2(
  uuid, uuid, uuid, boolean, jsonb, jsonb
);

CREATE OR REPLACE FUNCTION public.persist_zatca_reporting_outbox_result_v2(
  p_outbox_id uuid,
  p_outbox_token uuid,
  p_network_token uuid,
  p_outcome text,
  p_safe_response jsonb,
  p_safe_warnings jsonb DEFAULT NULL,
  p_safe_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice_id uuid;
  v_invoice public.invoices%ROWTYPE;
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
  v_reservation public.zatca_chain_reservations_v2%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_reason text;
  v_backoff_seconds integer;
  v_attempts_exhausted boolean;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN (
    'accepted', 'transient_failure', 'definite_rejection', 'ambiguous_outcome'
  ) THEN
    RAISE EXCEPTION 'INVALID_REPORTING_OUTCOME';
  END IF;

  SELECT invoice_id INTO v_invoice_id
  FROM public.zatca_reporting_outbox_v2
  WHERE id = p_outbox_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_NOT_FOUND'; END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_invoice_id
  FOR UPDATE;
  SELECT * INTO v_outbox
  FROM public.zatca_reporting_outbox_v2
  WHERE id = p_outbox_id
  FOR UPDATE;
  SELECT * INTO v_reservation
  FROM public.zatca_chain_reservations_v2
  WHERE invoice_id = v_invoice_id
  FOR UPDATE;

  IF v_outbox.status IS DISTINCT FROM 'processing'
     OR v_outbox.lease_token IS DISTINCT FROM p_outbox_token
     OR v_outbox.lease_expires_at <= v_now
     OR v_invoice.zatca_network_claim_token_v2 IS DISTINCT FROM p_network_token
     OR v_invoice.zatca_network_operation_v2 IS DISTINCT FROM 'report'
     OR COALESCE(v_invoice.zatca_network_ack_state_v2, '') NOT IN ('claimed', 'request_started')
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'simplified_final'
     OR v_invoice.zatca_simplified_xml_hash IS DISTINCT FROM v_outbox.artifact_hash
     OR v_reservation.state IS DISTINCT FROM 'committed'
     OR v_reservation.committed_artifact_hash IS DISTINCT FROM v_outbox.artifact_hash THEN
    RAISE EXCEPTION 'STALE_OR_MISMATCHED_REPORTING_OUTCOME';
  END IF;

  IF p_outcome IN ('accepted', 'ambiguous_outcome')
     AND v_invoice.zatca_network_ack_state_v2 IS DISTINCT FROM 'request_started' THEN
    RAISE EXCEPTION 'REMOTE_OUTCOME_REQUIRES_STARTED_REQUEST';
  END IF;

  v_attempts_exhausted := p_outcome = 'transient_failure'
    AND v_outbox.attempt_count >= 4;
  v_backoff_seconds := LEAST(
    900,
    60 * power(2, GREATEST(v_outbox.attempt_count - 1, 0))::integer
  );
  v_status := CASE
    WHEN p_outcome = 'accepted' THEN 'accepted'
    WHEN p_outcome = 'transient_failure' AND NOT v_attempts_exhausted THEN 'retryable'
    ELSE 'blocked'
  END;
  v_reason := CASE
    WHEN p_outcome = 'accepted' THEN NULL
    WHEN v_attempts_exhausted THEN 'MAX_TRANSIENT_ATTEMPTS_REACHED'
    WHEN p_outcome = 'definite_rejection' THEN
      COALESCE(NULLIF(p_safe_reason, ''), 'ZATCA_DEFINITE_REJECTION')
    WHEN p_outcome = 'ambiguous_outcome' THEN
      COALESCE(NULLIF(p_safe_reason, ''), 'AMBIGUOUS_REMOTE_OUTCOME')
    ELSE COALESCE(NULLIF(p_safe_reason, ''), 'TRANSIENT_REPORTING_FAILURE')
  END;

  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE
      WHEN p_outcome = 'accepted' THEN 'reported'
      WHEN p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'
      ELSE 'reporting_failed'
    END,
    zatca_status = CASE
      WHEN p_outcome = 'accepted' THEN 'reported'
      WHEN p_outcome = 'transient_failure' AND NOT v_attempts_exhausted THEN 'pending'
      WHEN p_outcome = 'ambiguous_outcome' THEN zatca_status
      ELSE 'failed'
    END,
    zatca_submitted_at = v_now,
    zatca_network_response_v2 = COALESCE(p_safe_response, zatca_network_response_v2),
    zatca_reporting_response = COALESCE(p_safe_response, zatca_reporting_response),
    zatca_warnings = COALESCE(p_safe_warnings, zatca_warnings),
    zatca_network_ack_state_v2 = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'
      ELSE 'response_persisted'
    END,
    zatca_reconciliation_reason_v2 = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN left(v_reason, 240)
      ELSE NULL
    END,
    zatca_finalization_error_v2 = CASE
      WHEN p_outcome = 'accepted' THEN NULL
      ELSE jsonb_build_object(
        'code', CASE
          WHEN v_attempts_exhausted THEN 'MAX_TRANSIENT_ATTEMPTS_REACHED'
          WHEN p_outcome = 'definite_rejection' THEN 'ZATCA_DEFINITE_REJECTION'
          WHEN p_outcome = 'ambiguous_outcome' THEN 'RECONCILIATION_REQUIRED'
          ELSE 'REPORTING_TRANSIENT_FAILURE'
        END,
        'message', left(v_reason, 240)
      )
    END,
    zatca_network_claim_token_v2 = NULL,
    zatca_network_lease_expires_at_v2 = NULL
  WHERE id = v_invoice_id;

  UPDATE public.zatca_reporting_outbox_v2 SET
    status = v_status,
    last_outcome = p_outcome,
    safe_response = COALESCE(p_safe_response, safe_response),
    last_error = left(v_reason, 240),
    available_at = CASE
      WHEN v_status = 'retryable'
        THEN v_now + make_interval(secs => v_backoff_seconds)
      ELSE available_at
    END,
    accepted_at = CASE WHEN p_outcome = 'accepted' THEN v_now ELSE NULL END,
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = v_now
  WHERE id = p_outbox_id;

  RETURN jsonb_build_object(
    'status', v_status,
    'outcome', p_outcome,
    'invoiceId', v_invoice_id,
    'attemptCount', v_outbox.attempt_count,
    'retryAfterSeconds', CASE WHEN v_status = 'retryable' THEN v_backoff_seconds ELSE NULL END,
    'reason', v_reason
  );
END
$function$;

DROP FUNCTION IF EXISTS public.fail_zatca_reporting_outbox_attempt_v2(
  uuid, uuid, boolean, boolean, text
);

CREATE OR REPLACE FUNCTION public.fail_zatca_reporting_outbox_attempt_v2(
  p_outbox_id uuid,
  p_outbox_token uuid,
  p_outcome text,
  p_safe_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_reason text;
  v_backoff_seconds integer;
  v_attempts_exhausted boolean;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN (
    'transient_failure', 'definite_rejection', 'ambiguous_outcome'
  ) THEN
    RAISE EXCEPTION 'INVALID_PREFLIGHT_REPORTING_OUTCOME';
  END IF;
  SELECT * INTO v_outbox
  FROM public.zatca_reporting_outbox_v2
  WHERE id = p_outbox_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_outbox.status IS DISTINCT FROM 'processing'
     OR v_outbox.lease_token IS DISTINCT FROM p_outbox_token THEN
    RAISE EXCEPTION 'STALE_OUTBOX_CLAIM_TOKEN';
  END IF;

  v_attempts_exhausted := p_outcome = 'transient_failure'
    AND v_outbox.attempt_count >= 4;
  v_backoff_seconds := LEAST(
    900,
    60 * power(2, GREATEST(v_outbox.attempt_count - 1, 0))::integer
  );
  v_status := CASE
    WHEN p_outcome = 'transient_failure' AND NOT v_attempts_exhausted THEN 'retryable'
    ELSE 'blocked'
  END;
  v_reason := CASE
    WHEN v_attempts_exhausted THEN 'MAX_TRANSIENT_ATTEMPTS_REACHED'
    ELSE COALESCE(NULLIF(p_safe_reason, ''), upper(p_outcome))
  END;

  UPDATE public.zatca_reporting_outbox_v2 SET
    status = v_status,
    last_outcome = p_outcome,
    available_at = CASE
      WHEN v_status = 'retryable'
        THEN v_now + make_interval(secs => v_backoff_seconds)
      ELSE available_at
    END,
    last_error = left(v_reason, 240),
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = v_now
  WHERE id = p_outbox_id
    AND status = 'processing';

  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'
      ELSE 'reporting_failed'
    END,
    zatca_status = CASE
      WHEN p_outcome = 'transient_failure' AND NOT v_attempts_exhausted THEN 'pending'
      WHEN p_outcome = 'ambiguous_outcome' THEN zatca_status
      ELSE 'failed'
    END,
    zatca_network_ack_state_v2 = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'
      ELSE zatca_network_ack_state_v2
    END,
    zatca_reconciliation_reason_v2 = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN left(v_reason, 240)
      ELSE zatca_reconciliation_reason_v2
    END,
    zatca_finalization_error_v2 = jsonb_build_object(
      'code', CASE
        WHEN v_attempts_exhausted THEN 'MAX_TRANSIENT_ATTEMPTS_REACHED'
        WHEN p_outcome = 'definite_rejection' THEN 'REPORTING_PREFLIGHT_BLOCKED'
        WHEN p_outcome = 'ambiguous_outcome' THEN 'RECONCILIATION_REQUIRED'
        ELSE 'REPORTING_TRANSIENT_FAILURE'
      END,
      'message', left(v_reason, 240)
    )
  WHERE id = v_outbox.invoice_id;

  RETURN jsonb_build_object(
    'status', v_status,
    'outcome', p_outcome,
    'attemptCount', v_outbox.attempt_count,
    'retryAfterSeconds', CASE WHEN v_status = 'retryable' THEN v_backoff_seconds ELSE NULL END,
    'reason', v_reason
  );
END
$function$;

-- Replace only the simplified persistence function. Chain commit, immutable
-- artifact persistence, and outbox insertion remain one PostgreSQL transaction.
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
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_outbox_id uuid;
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

  INSERT INTO public.zatca_reporting_outbox_v2 (
    tenant_id, branch_id, invoice_id, operation, artifact_hash, status, source
  ) VALUES (
    v_invoice.tenant_id, v_invoice.branch_id, p_invoice_id,
    'report', btrim(p_xml_hash), 'pending', 'finalization'
  )
  ON CONFLICT (invoice_id, operation) DO NOTHING
  RETURNING id INTO v_outbox_id;
  IF v_outbox_id IS NULL THEN
    RAISE EXCEPTION 'DURABLE_REPORTING_OUTBOX_ALREADY_EXISTS';
  END IF;

  RETURN jsonb_build_object(
    'status', 'locally_finalized',
    'artifactStage', 'simplified_final',
    'reportingDispatch', 'durably_queued',
    'outboxId', v_outbox_id
  );
END
$function$;

DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'enqueue_zatca_reporting_outbox_v2',
      'claim_zatca_reporting_outbox_v2',
      'persist_zatca_reporting_outbox_result_v2',
      'fail_zatca_reporting_outbox_attempt_v2',
      'persist_zatca_simplified_final_v2'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.signature);
  END LOOP;
END
$grants$;

COMMIT;
