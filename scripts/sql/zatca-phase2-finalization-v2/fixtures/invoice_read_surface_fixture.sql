-- Disposable PostgreSQL role/RLS fixture for 04a_safe_invoice_read_surface.sql.
-- DO NOT run on hosted production. Run with a migration-owner connection only
-- after loading representative disposable data and the complete v2 package:
--
-- psql "$ZATCA_V2_DISPOSABLE_DATABASE_URL" \
--   -v authenticated_user_id='<visible-tenant user_profiles.id>' \
--   -v visible_invoice_id='<invoice visible to that user>' \
--   -v visible_tenant_id='<visible invoice tenant>' \
--   -v hidden_invoice_id='<invoice from a different tenant>' \
--   -f fixtures/invoice_read_surface_fixture.sql

\set ON_ERROR_STOP on

\if :{?authenticated_user_id}
\else
  \echo 'authenticated_user_id is required'
  \quit 3
\endif
\if :{?visible_invoice_id}
\else
  \echo 'visible_invoice_id is required'
  \quit 3
\endif
\if :{?visible_tenant_id}
\else
  \echo 'visible_tenant_id is required'
  \quit 3
\endif
\if :{?hidden_invoice_id}
\else
  \echo 'hidden_invoice_id is required'
  \quit 3
\endif

DO $disposable_guard$
BEGIN
  IF current_database() !~* '(test|fixture|disposable)' THEN
    RAISE EXCEPTION 'DISPOSABLE_DATABASE_REQUIRED';
  END IF;
END
$disposable_guard$;

BEGIN;

SELECT
  EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = :'authenticated_user_id'::uuid
      AND tenant_id = :'visible_tenant_id'::uuid
      AND is_active = true
  )
  AND EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = :'visible_invoice_id'::uuid
      AND tenant_id = :'visible_tenant_id'::uuid
  )
  AND EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = :'hidden_invoice_id'::uuid
      AND tenant_id <> :'visible_tenant_id'::uuid
  ) AS fixture_scope_valid
\gset
\if :fixture_scope_valid
\else
  \echo 'Fixture IDs do not establish the required visible and cross-tenant scopes'
  \quit 3
\endif

SELECT set_config('request.jwt.claim.sub', :'authenticated_user_id', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SET LOCAL ROLE authenticated;

-- Every approved safe column must be selectable as one row under existing RLS.
SELECT
  id, tenant_id, branch_id, customer_id, created_by,
  invoice_number, invoice_reference, zatca_invoice_type,
  zatca_status, zatca_submitted_at, subtotal, discount_amount,
  taxable_amount, tax_amount, total_amount, currency_code,
  invoice_date, supply_date, due_date, status, payment_status,
  notes, notes_ar, cancelled_at, cancellation_reason,
  created_at, updated_at, session_id, payment_method,
  original_invoice_id, credit_reason, document_language
FROM public.invoices
WHERE id = :'visible_invoice_id'::uuid;

SELECT count(*) = 1 AS authenticated_safe_read_succeeds
FROM public.invoices
WHERE id = :'visible_invoice_id'::uuid
\gset
\if :authenticated_safe_read_succeeds
\else
  \echo 'Authenticated safe read did not return the visible fixture invoice'
  \quit 3
\endif

-- A named raw-v2/legacy artifact read must fail with insufficient_privilege.
SAVEPOINT raw_read_probe;
\set ON_ERROR_STOP off
SELECT zatca_finalization_version, zatca_simplified_xml, zatca_qr_code
FROM public.invoices
WHERE id = :'visible_invoice_id'::uuid;
\set raw_read_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT raw_read_probe;
SELECT :'raw_read_sqlstate' = '42501' AS authenticated_raw_read_denied \gset
\if :authenticated_raw_read_denied
\else
  \echo 'Authenticated raw invoice read did not fail with SQLSTATE 42501'
  \quit 3
\endif

-- SELECT * expands to denied columns and must fail as a whole.
SAVEPOINT star_read_probe;
\set ON_ERROR_STOP off
SELECT * FROM public.invoices WHERE id = :'visible_invoice_id'::uuid;
\set star_read_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT star_read_probe;
SELECT :'star_read_sqlstate' = '42501' AS authenticated_star_read_denied \gset
\if :authenticated_star_read_denied
\else
  \echo 'Authenticated invoice SELECT * did not fail with SQLSTATE 42501'
  \quit 3
\endif

-- Existing RLS must still hide a known invoice from another tenant.
SELECT count(*) = 0 AS cross_tenant_invoice_hidden
FROM public.invoices
WHERE id = :'hidden_invoice_id'::uuid
\gset
\if :cross_tenant_invoice_hidden
\else
  \echo 'Cross-tenant invoice became visible through the safe allowlist'
  \quit 3
\endif

RESET ROLE;
SET LOCAL ROLE service_role;

-- Service-role Edge paths retain full and explicit raw reads.
SELECT * FROM public.invoices WHERE id = :'visible_invoice_id'::uuid;
SELECT
  zatca_uuid, zatca_xml, zatca_xml_hash, zatca_signature, zatca_qr_code,
  zatca_finalization_version, zatca_simplified_xml, zatca_provisional_xml,
  zatca_cleared_xml, zatca_network_response_v2
FROM public.invoices
WHERE id = :'visible_invoice_id'::uuid;

SELECT count(*) = 1 AS service_role_full_read_succeeds
FROM public.invoices
WHERE id = :'visible_invoice_id'::uuid
\gset
\if :service_role_full_read_succeeds
\else
  \echo 'service_role could not read the visible fixture invoice'
  \quit 3
\endif

-- The RPC may inspect raw fields internally but its JSON output is allowlisted.
WITH output_state AS (
  SELECT public.get_zatca_output_state_v2(
    :'visible_invoice_id'::uuid,
    :'visible_tenant_id'::uuid
  ) AS value
)
SELECT
  (value ->> 'invoiceId') = :'visible_invoice_id' AS output_invoice_matches,
  value ?& ARRAY[
    'invoiceId', 'invoiceStatus', 'finalizationStatus', 'artifactStage',
    'documentKind', 'canPrint', 'canShare', 'retryAvailable',
    'reconciliationRequired', 'qrCode', 'error'
  ]
  AND NOT value ?| ARRAY[
    'xml', 'hash', 'signature', 'counter', 'pih', 'provisionalArtifact',
    'claimToken', 'claimedBy', 'leaseExpiresAt', 'idempotencyKey',
    'networkRequestHash', 'networkResponse', 'clearanceResponse'
  ] AS output_contract_safe
FROM output_state
\gset
\if :output_invoice_matches
\else
  \echo 'Output-state RPC returned the wrong invoice identity'
  \quit 3
\endif
\if :output_contract_safe
\else
  \echo 'Output-state RPC safe-key contract failed'
  \quit 3
\endif

RESET ROLE;
ROLLBACK;

\echo 'PASS disposable invoice read surface fixture'
