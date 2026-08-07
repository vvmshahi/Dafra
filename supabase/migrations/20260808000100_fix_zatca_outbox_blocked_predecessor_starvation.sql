BEGIN;

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
        AND earlier.status IN ('pending', 'processing', 'retryable')
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

COMMIT;
