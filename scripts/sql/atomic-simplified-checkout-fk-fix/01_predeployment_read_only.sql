BEGIN TRANSACTION READ ONLY;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '2s';

-- Fixed incident scope from the prior read-only Branch 1 audit. This script
-- returns identifiers and state only; it does not return customer or cart data.
WITH scope AS (
  SELECT
    '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid AS tenant_id,
    '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid AS affected_branch_id
),
expected_functions(signature) AS (
  VALUES
    ('public.pos_checkout(jsonb)'),
    ('public.pos_checkout_legacy_base_v1(jsonb)'),
    ('public.pos_checkout_with_product_units_v1(jsonb)'),
    ('public.prepare_zatca_atomic_checkout_v2(uuid,text,jsonb,text,integer)'),
    ('public.commit_zatca_atomic_checkout_v2(uuid,uuid)'),
    ('public.build_zatca_atomic_receipt_snapshot_v2(uuid)')
)
SELECT
  expected.signature,
  to_regprocedure(expected.signature) IS NOT NULL AS exists,
  CASE
    WHEN to_regprocedure(expected.signature) IS NULL THEN NULL
    ELSE md5(pg_get_functiondef(to_regprocedure(expected.signature)::oid))
  END AS deployed_definition_md5,
  contract.definition_md5 AS registered_definition_md5,
  CASE
    WHEN contract.definition_md5 IS NULL THEN NULL
    ELSE md5(pg_get_functiondef(
      to_regprocedure(expected.signature)::oid
    )) = contract.definition_md5
  END AS registered_contract_matches
FROM expected_functions AS expected
LEFT JOIN public.product_units_commercial_function_contracts_v1 AS contract
  ON contract.function_signature = expected.signature
ORDER BY expected.signature;

SELECT
  md5(pg_get_functiondef(
    'public.pos_checkout_with_product_units_v1(jsonb)'::regprocedure
  )) AS package_checkout_definition_md5,
  '0e292564d123cdd70d502bb89881f353'::text
    AS expected_corrected_definition_md5,
  md5(pg_get_functiondef(
    'public.pos_checkout_with_product_units_v1(jsonb)'::regprocedure
  )) = '0e292564d123cdd70d502bb89881f353'
    AS corrected_definition_installed,
  strpos(
    pg_get_functiondef(
      'public.pos_checkout_with_product_units_v1(jsonb)'::regprocedure
    ),
    'RETURNING id INTO v_invoice_id;'
  ) > 0 AS captures_persisted_parent_id,
  strpos(
    pg_get_functiondef(
      'public.pos_checkout_with_product_units_v1(jsonb)'::regprocedure
    ),
    'ATOMIC_CHECKOUT_COMMERCIAL_PARENT_MISSING'
  ) > 0 AS verifies_parent_before_children,
  strpos(
    pg_get_functiondef(
      'public.pos_checkout_with_product_units_v1(jsonb)'::regprocedure
    ),
    'INSERT INTO public.invoice_items'
  ) > strpos(
    pg_get_functiondef(
      'public.pos_checkout_with_product_units_v1(jsonb)'::regprocedure
    ),
    'ATOMIC_CHECKOUT_COMMERCIAL_PARENT_MISSING'
  ) AS assertion_precedes_item_insert;

SELECT
  runtime.schema_version,
  runtime.minimum_client_version,
  runtime.minimum_edge_version,
  runtime.immutable_finalization_enabled,
  runtime.simplified_enabled,
  runtime.standard_enabled,
  runtime.atomic_simplified_checkout_enabled
FROM public.zatca_finalization_runtime AS runtime
WHERE runtime.singleton IS TRUE;

SELECT
  constraint_row.conname,
  pg_get_constraintdef(constraint_row.oid, true) AS definition,
  constraint_row.convalidated AS validated,
  constraint_row.condeferrable AS deferrable,
  constraint_row.condeferred AS initially_deferred
FROM pg_constraint AS constraint_row
WHERE constraint_row.conrelid = 'public.invoice_items'::regclass
  AND constraint_row.conname = 'invoice_items_invoice_id_fkey';

WITH scope AS (
  SELECT
    '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid AS tenant_id,
    '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid AS affected_branch_id
)
SELECT
  branch.id AS branch_id,
  branch.is_active AS branch_active,
  tenant.is_active AS tenant_active,
  gate.enabled AS atomic_branch_gate_enabled,
  credentials.onboarding_status,
  count(capability.user_id) FILTER (
    WHERE capability.expires_at > clock_timestamp()
      AND capability.client_version = runtime.minimum_client_version
      AND capability.edge_version = runtime.minimum_edge_version
  ) AS current_capability_acknowledgements
FROM scope
JOIN public.branches AS branch
  ON branch.id = scope.affected_branch_id
 AND branch.tenant_id = scope.tenant_id
JOIN public.tenants AS tenant ON tenant.id = branch.tenant_id
LEFT JOIN public.zatca_atomic_checkout_branch_gates_v2 AS gate
  ON gate.tenant_id = branch.tenant_id
 AND gate.branch_id = branch.id
LEFT JOIN public.zatca_production_credentials AS credentials
  ON credentials.tenant_id = branch.tenant_id
 AND credentials.branch_id = branch.id
CROSS JOIN public.zatca_finalization_runtime AS runtime
LEFT JOIN public.zatca_client_capabilities_v2 AS capability
  ON capability.branch_id = branch.id
WHERE runtime.singleton IS TRUE
GROUP BY
  branch.id,
  branch.is_active,
  tenant.is_active,
  gate.enabled,
  credentials.onboarding_status;

WITH scope AS (
  SELECT
    '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid AS tenant_id,
    '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid AS affected_branch_id
)
SELECT
  intent.state,
  count(*) AS intent_count,
  count(*) FILTER (
    WHERE intent.state = 'prepared'
      AND intent.expires_at <= clock_timestamp()
  ) AS expired_prepared_count,
  min(intent.created_at) AS oldest_created_at,
  max(intent.updated_at) AS latest_updated_at
FROM public.zatca_atomic_checkout_intents_v2 AS intent
CROSS JOIN scope
WHERE intent.tenant_id = scope.tenant_id
  AND intent.branch_id = scope.affected_branch_id
  AND (
    intent.state = 'prepared'
    OR intent.updated_at >= clock_timestamp() - interval '14 days'
  )
GROUP BY intent.state
ORDER BY intent.state;

SELECT
  count(*) AS orphan_invoice_item_count
FROM public.invoice_items AS item
LEFT JOIN public.invoices AS invoice ON invoice.id = item.invoice_id
WHERE invoice.id IS NULL;

SELECT
  count(*) FILTER (
    WHERE item.id IS NOT NULL
      AND item.tenant_id IS DISTINCT FROM invoice.tenant_id
  ) AS item_parent_tenant_mismatch_count,
  count(*) FILTER (
    WHERE payment.id IS NOT NULL
      AND payment.tenant_id IS DISTINCT FROM invoice.tenant_id
  ) AS payment_parent_tenant_mismatch_count,
  count(*) FILTER (
    WHERE movement.id IS NOT NULL
      AND (
        movement.tenant_id IS DISTINCT FROM invoice.tenant_id
        OR movement.branch_id IS DISTINCT FROM invoice.branch_id
      )
  ) AS stock_parent_scope_mismatch_count,
  count(*) FILTER (
    WHERE outbox.id IS NOT NULL
      AND (
        outbox.tenant_id IS DISTINCT FROM invoice.tenant_id
        OR outbox.branch_id IS DISTINCT FROM invoice.branch_id
      )
  ) AS outbox_parent_scope_mismatch_count
FROM public.invoices AS invoice
LEFT JOIN public.invoice_items AS item ON item.invoice_id = invoice.id
LEFT JOIN public.payments AS payment ON payment.invoice_id = invoice.id
LEFT JOIN public.pos_stock_movements AS movement
  ON movement.invoice_id = invoice.id
LEFT JOIN public.zatca_reporting_outbox_v2 AS outbox
  ON outbox.invoice_id = invoice.id;

-- Review the two previously observed committed-but-incomplete candidates.
-- They are not assumed to share this FK defect: a transaction that hit the FK
-- rolled back and therefore cannot leave a committed parent candidate.
WITH
scope AS (
  SELECT
    '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid AS tenant_id,
    '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid AS affected_branch_id
),
recent AS (
  SELECT
    invoice.*,
    CASE
      WHEN invoice.status::text = 'posted'
       AND invoice.payment_status::text = 'paid'
       AND (
         invoice.zatca_status::text IN ('reported', 'cleared')
         OR (
           invoice.zatca_finalization_version = 2
           AND invoice.zatca_document_kind = 'simplified'
           AND invoice.zatca_artifact_stage = 'simplified_final'
           AND invoice.zatca_lifecycle_state IN (
             'locally_finalized', 'reporting_pending', 'reported'
           )
         )
         OR (
           invoice.zatca_finalization_version = 2
           AND invoice.zatca_document_kind = 'standard'
           AND invoice.zatca_artifact_stage = 'standard_cleared'
           AND invoice.zatca_lifecycle_state = 'cleared_final'
         )
       )
      THEN true
      ELSE false
    END AS appears_complete
  FROM public.invoices AS invoice
  CROSS JOIN scope
  WHERE invoice.tenant_id = scope.tenant_id
    AND invoice.branch_id = scope.affected_branch_id
    AND invoice.created_at >= clock_timestamp() - interval '14 days'
    AND invoice.zatca_type_code = '388'
)
SELECT
  recent.id AS invoice_id,
  recent.invoice_number,
  recent.created_at,
  recent.zatca_invoice_type,
  recent.zatca_finalization_version,
  recent.zatca_lifecycle_state,
  recent.zatca_artifact_stage,
  recent.zatca_finalized_at_v2 IS NOT NULL AS finalization_timestamp_present,
  atomic_intent.id AS atomic_intent_id,
  atomic_intent.state AS atomic_intent_state,
  atomic_intent.prepared_snapshot IS NOT NULL AS prepared_snapshot_present,
  atomic_intent.receipt_payload IS NOT NULL AS committed_receipt_present,
  CASE
    WHEN atomic_intent.prepared_snapshot IS NULL THEN NULL
    ELSE atomic_intent.prepared_snapshot->>'invoice_id'
  END = recent.id::text AS prepared_snapshot_parent_matches,
  CASE
    WHEN atomic_intent.receipt_payload IS NULL THEN NULL
    ELSE atomic_intent.receipt_payload->>'invoice_id'
  END = recent.id::text AS committed_receipt_parent_matches,
  count(DISTINCT item.id) AS invoice_item_count,
  count(DISTINCT payment.id) AS payment_count,
  count(DISTINCT reservation.invoice_id) AS chain_reservation_count,
  min(reservation.state::text) AS chain_reservation_state,
  count(DISTINCT outbox.id) AS reporting_outbox_count
FROM recent
LEFT JOIN public.invoice_items AS item ON item.invoice_id = recent.id
LEFT JOIN public.payments AS payment ON payment.invoice_id = recent.id
LEFT JOIN public.zatca_atomic_checkout_intents_v2 AS atomic_intent
  ON atomic_intent.invoice_id = recent.id
LEFT JOIN public.zatca_chain_reservations_v2 AS reservation
  ON reservation.invoice_id = recent.id
LEFT JOIN public.zatca_reporting_outbox_v2 AS outbox
  ON outbox.invoice_id = recent.id
WHERE recent.status::text = 'posted'
  AND recent.payment_status::text = 'paid'
  AND recent.appears_complete IS FALSE
GROUP BY
  recent.id,
  recent.invoice_number,
  recent.created_at,
  recent.zatca_invoice_type,
  recent.zatca_finalization_version,
  recent.zatca_lifecycle_state,
  recent.zatca_artifact_stage,
  recent.zatca_finalized_at_v2,
  atomic_intent.id,
  atomic_intent.state,
  atomic_intent.prepared_snapshot,
  atomic_intent.receipt_payload
ORDER BY recent.created_at;

ROLLBACK;
