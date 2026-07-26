-- Reconcile an append-only ZATCA reporting response when the remote response
-- arrived after the original worker leases expired.
--
-- This migration does not enqueue, submit, rebuild, sign, or alter any
-- commercial invoice artifact. It only applies already-persisted response
-- evidence through the existing reporting-result state transition.

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_zatca_reporting_response_evidence_v2(
  p_invoice_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
  v_reservation public.zatca_chain_reservations_v2%ROWTYPE;
  v_evidence public.zatca_reporting_response_evidence_v2%ROWTYPE;
  v_outbox_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'INVOICE_ID_REQUIRED';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND';
  END IF;

  SELECT * INTO v_outbox
  FROM public.zatca_reporting_outbox_v2
  WHERE invoice_id = p_invoice_id
    AND operation = 'report'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORTING_OUTBOX_NOT_FOUND';
  END IF;

  SELECT * INTO v_reservation
  FROM public.zatca_chain_reservations_v2
  WHERE invoice_id = p_invoice_id
  FOR UPDATE;

  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2'
     OR v_invoice.zatca_document_kind IS DISTINCT FROM 'simplified'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'simplified_final'
     OR NULLIF(v_invoice.zatca_simplified_xml, '') IS NULL
     OR NULLIF(v_invoice.zatca_simplified_xml_hash, '') IS NULL
     OR v_outbox.tenant_id IS DISTINCT FROM v_invoice.tenant_id
     OR v_outbox.branch_id IS DISTINCT FROM v_invoice.branch_id
     OR v_outbox.artifact_hash IS DISTINCT FROM v_invoice.zatca_simplified_xml_hash
     OR v_reservation.state IS DISTINCT FROM 'committed'
     OR v_reservation.tenant_id IS DISTINCT FROM v_invoice.tenant_id
     OR v_reservation.branch_id IS DISTINCT FROM v_invoice.branch_id
     OR v_reservation.counter_number IS DISTINCT FROM v_invoice.zatca_counter_number
     OR v_reservation.previous_hash IS DISTINCT FROM v_invoice.zatca_prev_invoice_hash
     OR v_reservation.committed_artifact_hash
       IS DISTINCT FROM v_invoice.zatca_simplified_xml_hash THEN
    RAISE EXCEPTION 'COMMITTED_ARTIFACT_IDENTITY_MISMATCH';
  END IF;

  IF v_invoice.zatca_status = 'reported'
     AND v_invoice.zatca_lifecycle_state = 'reported' THEN
    UPDATE public.zatca_reporting_outbox_v2
    SET status = 'accepted',
        last_outcome = 'accepted',
        last_error = NULL,
        accepted_at = COALESCE(accepted_at, v_now),
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = v_now
    WHERE id = v_outbox.id;
    RETURN jsonb_build_object(
      'status', 'accepted',
      'invoiceId', v_invoice.id,
      'outboxId', v_outbox.id,
      'idempotentReplay', true
    );
  END IF;

  IF v_outbox.status = 'processing'
     AND v_outbox.lease_expires_at > v_now THEN
    RETURN jsonb_build_object(
      'status', 'in_progress',
      'invoiceId', v_invoice.id,
      'outboxId', v_outbox.id,
      'reason', 'REPORTING_OUTBOX_LEASE_ACTIVE'
    );
  END IF;
  IF v_invoice.zatca_network_claim_token_v2 IS NOT NULL
     AND v_invoice.zatca_network_lease_expires_at_v2 > v_now THEN
    RETURN jsonb_build_object(
      'status', 'in_progress',
      'invoiceId', v_invoice.id,
      'outboxId', v_outbox.id,
      'reason', 'REPORTING_NETWORK_LEASE_ACTIVE'
    );
  END IF;

  IF v_invoice.zatca_lifecycle_state IS DISTINCT FROM 'reconciliation_required'
     AND COALESCE(v_invoice.zatca_network_ack_state_v2, '')
       IS DISTINCT FROM 'reconciliation_required' THEN
    RETURN jsonb_build_object(
      'status', v_outbox.status,
      'invoiceId', v_invoice.id,
      'outboxId', v_outbox.id,
      'reason', 'RECONCILIATION_NOT_REQUIRED',
      'idempotentReplay', true
    );
  END IF;

  -- Accepted evidence always wins. Otherwise use the most recent durable
  -- response. This prevents a known accepted response from ever being sent
  -- again as a new network attempt.
  SELECT * INTO v_evidence
  FROM public.zatca_reporting_response_evidence_v2
  WHERE invoice_id = v_invoice.id
    AND outbox_id = v_outbox.id
  ORDER BY
    CASE WHEN classified_outcome = 'accepted' THEN 0 ELSE 1 END,
    received_at DESC,
    id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'reconciliation_required',
      'invoiceId', v_invoice.id,
      'outboxId', v_outbox.id,
      'reason', 'REPORTING_RESPONSE_EVIDENCE_NOT_FOUND'
    );
  END IF;

  IF v_evidence.tenant_id IS DISTINCT FROM v_invoice.tenant_id
     OR v_evidence.branch_id IS DISTINCT FROM v_invoice.branch_id
     OR v_evidence.invoice_id IS DISTINCT FROM v_invoice.id
     OR v_evidence.outbox_id IS DISTINCT FROM v_outbox.id
     OR v_evidence.network_token IS NULL
     OR v_evidence.attempt_count > v_outbox.attempt_count THEN
    RAISE EXCEPTION 'REPORTING_RESPONSE_EVIDENCE_IDENTITY_MISMATCH';
  END IF;

  IF v_evidence.classified_outcome = 'ambiguous_outcome' THEN
    RETURN jsonb_build_object(
      'status', 'reconciliation_required',
      'invoiceId', v_invoice.id,
      'outboxId', v_outbox.id,
      'reason', COALESCE(
        NULLIF(v_evidence.safe_reason, ''),
        'AMBIGUOUS_REMOTE_OUTCOME'
      )
    );
  END IF;

  -- Restore only the short-lived claim identities required by the existing
  -- persistence function. The evidence row proves that this exact network
  -- token reached request_started and received the stored response. These
  -- temporary values and the result transition commit atomically.
  UPDATE public.zatca_reporting_outbox_v2
  SET status = 'processing',
      lease_token = v_outbox_token,
      lease_expires_at = v_now + interval '60 seconds',
      claimed_by = 'evidence-reconciliation',
      updated_at = v_now
  WHERE id = v_outbox.id;

  UPDATE public.invoices
  SET zatca_network_claim_token_v2 = v_evidence.network_token,
      zatca_network_lease_expires_at_v2 = v_now + interval '60 seconds',
      zatca_network_claimed_by_v2 = 'evidence-reconciliation',
      zatca_network_operation_v2 = 'report',
      zatca_network_request_started_at_v2 = COALESCE(
        zatca_network_request_started_at_v2,
        v_evidence.received_at
      ),
      zatca_network_ack_state_v2 = 'request_started'
  WHERE id = v_invoice.id;

  v_result := public.persist_zatca_reporting_outbox_result_v2(
    v_outbox.id,
    v_outbox_token,
    v_evidence.network_token,
    v_evidence.classified_outcome,
    v_evidence.safe_response,
    v_evidence.safe_warnings,
    v_evidence.safe_reason
  );

  RETURN v_result || jsonb_build_object(
    'evidenceId', v_evidence.id,
    'evidenceReconciled', true
  );
END
$function$;

ALTER FUNCTION public.reconcile_zatca_reporting_response_evidence_v2(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reconcile_zatca_reporting_response_evidence_v2(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_zatca_reporting_response_evidence_v2(uuid)
  TO service_role;

COMMENT ON FUNCTION public.reconcile_zatca_reporting_response_evidence_v2(uuid) IS
  'Applies existing append-only ZATCA reporting response evidence without rebuilding or resubmitting an invoice artifact.';

COMMIT;
