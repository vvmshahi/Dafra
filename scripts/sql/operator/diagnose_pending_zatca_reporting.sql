-- Read-only operator diagnostic for the production reporting backlog headed by
-- INV-0906 and the unclaimed target INV-0916. This script deliberately omits
-- XML, QR data, signatures, hashes, certificates, credentials, network tokens,
-- raw request/response bodies, and customer information.

BEGIN TRANSACTION READ ONLY;

-- 1. Target invoice and outbox state.
SELECT
  'target_invoice' AS diagnostic_section,
  i.id AS invoice_id,
  i.invoice_number,
  i.tenant_id,
  i.branch_id,
  i.created_at,
  i.zatca_counter_number,
  i.zatca_status,
  i.zatca_lifecycle_state,
  i.zatca_artifact_stage,
  CASE
    WHEN i.zatca_lifecycle_state = 'reconciliation_required'
      OR i.zatca_network_ack_state_v2 = 'reconciliation_required'
      THEN 'reconciliation_required'
    WHEN i.zatca_status = 'reported' THEN 'reported'
    ELSE 'reporting_pending'
  END AS reporting_display_state,
  i.zatca_network_ack_state_v2,
  i.zatca_submitted_at,
  i.zatca_finalization_error_v2 ->> 'code' AS safe_error_code,
  i.zatca_reconciliation_reason_v2 AS safe_reconciliation_reason,
  (NULLIF(i.zatca_simplified_xml_hash, '') IS NOT NULL) AS artifact_hash_present
FROM public.invoices i
WHERE i.id = '762872f8-b43e-47c9-ada7-68636c984eeb'::uuid;

SELECT
  'target_outbox' AS diagnostic_section,
  o.id AS outbox_id,
  o.invoice_id,
  o.status,
  o.attempt_count,
  o.available_at,
  o.updated_at AS last_attempt_state_change_at,
  o.last_outcome,
  o.last_error AS last_safe_error,
  o.claimed_by,
  (o.lease_token IS NOT NULL) AS lease_present,
  o.lease_expires_at,
  (o.lease_expires_at IS NOT NULL
    AND o.lease_expires_at <= clock_timestamp()) AS lease_expired,
  (o.status = 'retryable') AS retry_available,
  o.accepted_at
FROM public.zatca_reporting_outbox_v2 o
WHERE o.id = 'fbc300c7-2ae3-4601-9355-4adc9a6f542d'::uuid;

SELECT
  'target_response_evidence' AS diagnostic_section,
  e.id AS evidence_id,
  e.invoice_id,
  e.outbox_id,
  e.attempt_count,
  e.http_status,
  e.reporting_status,
  e.validation_status,
  e.classified_outcome,
  e.safe_reason,
  e.received_at
FROM public.zatca_reporting_response_evidence_v2 e
WHERE e.invoice_id = '762872f8-b43e-47c9-ada7-68636c984eeb'::uuid
ORDER BY e.received_at;

-- 2. Every simplified v2 invoice after the branch's last reported counter.
WITH branch_scope AS (
  SELECT
    '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid AS tenant_id,
    '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid AS branch_id
),
last_reported AS (
  SELECT MAX(i.zatca_counter_number) AS counter_number
  FROM public.invoices i
  JOIN branch_scope s
    ON s.tenant_id = i.tenant_id AND s.branch_id = i.branch_id
  WHERE i.zatca_status = 'reported'
    AND i.zatca_document_kind = 'simplified'
    AND i.zatca_finalization_version = 2
)
SELECT
  'pending_after_last_reported' AS diagnostic_section,
  i.id AS invoice_id,
  i.invoice_number,
  i.created_at,
  i.zatca_counter_number,
  i.zatca_status,
  i.zatca_lifecycle_state,
  i.zatca_network_ack_state_v2,
  o.id AS outbox_id,
  o.status AS outbox_status,
  o.attempt_count,
  o.available_at,
  o.updated_at AS last_attempt_state_change_at,
  o.last_outcome,
  o.last_error AS last_safe_error,
  (o.lease_token IS NOT NULL) AS outbox_lease_present,
  o.lease_expires_at AS outbox_lease_expires_at,
  (i.zatca_network_claim_token_v2 IS NOT NULL) AS network_lease_present,
  i.zatca_network_lease_expires_at_v2 AS network_lease_expires_at,
  COUNT(e.id) AS response_evidence_count,
  COUNT(e.id) FILTER (WHERE e.classified_outcome = 'accepted')
    AS accepted_evidence_count,
  CASE
    WHEN COUNT(e.id) FILTER (WHERE e.classified_outcome = 'accepted') > 0
      AND i.zatca_status <> 'reported'
      THEN 'accepted_evidence_pending_reconciliation'
    WHEN COUNT(e.id) > 0
      THEN 'response_evidence_persisted_not_reconciled'
    WHEN COALESCE(o.attempt_count, 0) = 0
      THEN 'not_submitted'
    WHEN o.status = 'retryable'
      THEN 'retry_scheduled'
    WHEN o.status = 'blocked'
      THEN 'permanently_stuck'
    ELSE 'submitted_without_persisted_response_evidence'
  END AS safe_submission_classification
FROM public.invoices i
JOIN branch_scope s
  ON s.tenant_id = i.tenant_id AND s.branch_id = i.branch_id
CROSS JOIN last_reported lr
LEFT JOIN public.zatca_reporting_outbox_v2 o
  ON o.invoice_id = i.id AND o.operation = 'report'
LEFT JOIN public.zatca_reporting_response_evidence_v2 e
  ON e.invoice_id = i.id AND e.outbox_id = o.id
WHERE i.zatca_document_kind = 'simplified'
  AND i.zatca_finalization_version = 2
  AND i.zatca_counter_number > lr.counter_number
GROUP BY i.id, o.id
ORDER BY i.zatca_counter_number;

-- 3. Persisted response evidence for the affected group, without response
-- bodies or network tokens.
SELECT
  'affected_response_evidence' AS diagnostic_section,
  i.id AS invoice_id,
  i.invoice_number,
  i.zatca_counter_number,
  e.id AS evidence_id,
  e.attempt_count,
  e.http_status,
  e.reporting_status,
  e.validation_status,
  e.classified_outcome,
  e.safe_reason,
  e.received_at
FROM public.zatca_reporting_response_evidence_v2 e
JOIN public.invoices i ON i.id = e.invoice_id
WHERE i.tenant_id = '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid
  AND i.branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
  AND i.zatca_status <> 'reported'
ORDER BY i.zatca_counter_number, e.received_at;

-- 4. Expired/stuck claims and accepted-evidence reconciliation conflicts.
SELECT
  'expired_or_stuck_claims' AS diagnostic_section,
  i.id AS invoice_id,
  i.invoice_number,
  i.zatca_counter_number,
  o.id AS outbox_id,
  o.status AS outbox_status,
  o.attempt_count,
  o.claimed_by,
  o.lease_expires_at AS outbox_lease_expires_at,
  i.zatca_network_ack_state_v2,
  i.zatca_network_lease_expires_at_v2 AS network_lease_expires_at
FROM public.invoices i
LEFT JOIN public.zatca_reporting_outbox_v2 o
  ON o.invoice_id = i.id AND o.operation = 'report'
WHERE i.tenant_id = '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid
  AND i.branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
  AND (
    (o.status = 'processing' AND o.lease_expires_at <= clock_timestamp())
    OR (
      i.zatca_network_claim_token_v2 IS NOT NULL
      AND i.zatca_network_lease_expires_at_v2 <= clock_timestamp()
    )
    OR i.zatca_lifecycle_state = 'reconciliation_required'
    OR i.zatca_network_ack_state_v2 = 'reconciliation_required'
  )
ORDER BY i.zatca_counter_number;

SELECT
  'accepted_evidence_pending_invoice' AS diagnostic_section,
  i.id AS invoice_id,
  i.invoice_number,
  i.zatca_counter_number,
  i.zatca_status,
  i.zatca_lifecycle_state,
  o.id AS outbox_id,
  o.status AS outbox_status,
  COUNT(e.id) AS accepted_evidence_count,
  MAX(e.received_at) AS latest_accepted_evidence_at
FROM public.invoices i
JOIN public.zatca_reporting_outbox_v2 o
  ON o.invoice_id = i.id AND o.operation = 'report'
JOIN public.zatca_reporting_response_evidence_v2 e
  ON e.invoice_id = i.id
  AND e.outbox_id = o.id
  AND e.classified_outcome = 'accepted'
WHERE i.zatca_status <> 'reported' OR o.status <> 'accepted'
GROUP BY i.id, o.id
ORDER BY i.created_at;

-- 5. Missing or duplicate outbox rows. A unique constraint should make the
-- duplicate section empty; it is retained as an integrity check.
SELECT
  'missing_reporting_outbox' AS diagnostic_section,
  i.id AS invoice_id,
  i.invoice_number,
  i.zatca_counter_number,
  i.zatca_status,
  i.zatca_lifecycle_state
FROM public.invoices i
WHERE i.tenant_id = '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid
  AND i.branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
  AND i.zatca_finalization_version = 2
  AND i.zatca_document_kind = 'simplified'
  AND i.zatca_artifact_stage = 'simplified_final'
  AND NOT EXISTS (
    SELECT 1
    FROM public.zatca_reporting_outbox_v2 o
    WHERE o.invoice_id = i.id AND o.operation = 'report'
  )
ORDER BY i.zatca_counter_number;

SELECT
  'duplicate_reporting_outbox' AS diagnostic_section,
  o.invoice_id,
  COUNT(*) AS outbox_count
FROM public.zatca_reporting_outbox_v2 o
WHERE o.operation = 'report'
GROUP BY o.invoice_id
HAVING COUNT(*) > 1
ORDER BY o.invoice_id;

-- 6. Chain and committed-artifact continuity. Hash values are compared but
-- never selected.
WITH ordered AS (
  SELECT
    i.id,
    i.invoice_number,
    i.zatca_counter_number,
    i.zatca_prev_invoice_hash,
    i.zatca_simplified_xml_hash,
    LAG(i.zatca_counter_number) OVER (
      PARTITION BY i.tenant_id, i.branch_id
      ORDER BY i.zatca_counter_number
    ) AS previous_counter,
    LAG(i.zatca_simplified_xml_hash) OVER (
      PARTITION BY i.tenant_id, i.branch_id
      ORDER BY i.zatca_counter_number
    ) AS previous_artifact_hash
  FROM public.invoices i
  WHERE i.tenant_id = '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid
    AND i.branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
    AND i.zatca_finalization_version = 2
    AND i.zatca_document_kind = 'simplified'
    AND i.zatca_artifact_stage = 'simplified_final'
)
SELECT
  'chain_continuity' AS diagnostic_section,
  o.id AS invoice_id,
  o.invoice_number,
  o.zatca_counter_number,
  (o.previous_counter IS NULL
    OR o.zatca_counter_number = o.previous_counter + 1) AS counter_contiguous,
  (o.previous_artifact_hash IS NULL
    OR o.zatca_prev_invoice_hash = o.previous_artifact_hash) AS previous_hash_contiguous,
  (r.state = 'committed') AS reservation_committed,
  (r.counter_number = o.zatca_counter_number) AS reservation_counter_matches,
  (r.previous_hash = o.zatca_prev_invoice_hash) AS reservation_previous_hash_matches,
  (r.committed_artifact_hash = o.zatca_simplified_xml_hash)
    AS reservation_artifact_matches
FROM ordered o
LEFT JOIN public.zatca_chain_reservations_v2 r ON r.invoice_id = o.id
WHERE o.zatca_counter_number >= 951
ORDER BY o.zatca_counter_number;

-- 7. Scheduler health, without exposing its command, headers, Vault values, or
-- HTTP response bodies.
SELECT
  'reporting_scheduler' AS diagnostic_section,
  j.jobid,
  j.jobname,
  j.schedule,
  j.active,
  j.database,
  j.username
FROM cron.job j
WHERE j.jobname = 'zatca-reporting-outbox-v2';

SELECT
  'reporting_scheduler_runs' AS diagnostic_section,
  r.jobid,
  r.status,
  r.start_time,
  r.end_time
FROM cron.job_run_details r
JOIN cron.job j ON j.jobid = r.jobid
WHERE j.jobname = 'zatca-reporting-outbox-v2'
ORDER BY r.start_time DESC
LIMIT 20;

-- 8. Required worker/RPC existence, ownership, SECURITY DEFINER status,
-- search_path configuration, and role privileges.
WITH required_functions(function_name) AS (
  VALUES
    ('enqueue_zatca_reporting_outbox_v2'),
    ('claim_zatca_reporting_outbox_v2'),
    ('append_zatca_reporting_response_evidence_v2'),
    ('apply_zatca_reporting_response_evidence_v2'),
    ('reconcile_zatca_reporting_response_evidence_v2'),
    ('persist_zatca_reporting_outbox_result_v2'),
    ('fail_zatca_reporting_outbox_attempt_v2'),
    ('claim_zatca_network_v2'),
    ('mark_zatca_network_request_started_v2')
),
public_functions AS (
  SELECT p.*
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
)
SELECT
  'reporting_function_privileges' AS diagnostic_section,
  required.function_name,
  p.oid::regprocedure::text AS function_signature,
  pg_get_userbyid(p.proowner) AS function_owner,
  p.prosecdef AS security_definer,
  p.proconfig AS function_configuration,
  has_function_privilege(
    'service_role',
    p.oid,
    'EXECUTE'
  ) AS service_role_can_execute,
  has_function_privilege(
    'authenticated',
    p.oid,
    'EXECUTE'
  ) AS authenticated_can_execute,
  has_function_privilege(
    'anon',
    p.oid,
    'EXECUTE'
  ) AS anon_can_execute
FROM required_functions required
LEFT JOIN public_functions p ON p.proname = required.function_name
ORDER BY required.function_name, function_signature;

ROLLBACK;
