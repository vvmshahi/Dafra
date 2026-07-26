# Authenticated invoice read contract

This is the reviewed browser contract for `public.invoices`. It accompanies
`04a_safe_invoice_read_surface.sql`; it does not authorize SQL execution or a
hosted change. Existing invoice RLS remains responsible for tenant and branch
row isolation.

## Selected model

The package uses a hybrid of access models A and D:

- revoke table-wide `SELECT` from `authenticated` and `anon`;
- grant `authenticated` only the explicit safe invoice columns below;
- grant `anon` no invoice columns;
- leave `service_role` table-wide access intact;
- retain every existing invoice RLS policy;
- obtain permitted final QR and v2 output state through the authenticated Edge
  status action backed by `get_zatca_output_state_v2`;
- obtain permanent-demo sandbox QR only through the existing sandbox validation
  status API.

This is less disruptive than migrating all browser paths to a view or a family
of new RPCs: existing PostgREST filters, ordering, embedded item/customer/payment
relations, and RLS row rules remain in place. The tradeoff is deliberate schema
coupling: adding a future browser-readable invoice field requires an explicit
review and allowlist migration. A future column is not readable by default.

## Exact safe browser columns (32)

1. `id`
2. `tenant_id`
3. `branch_id`
4. `customer_id`
5. `created_by`
6. `invoice_number`
7. `invoice_reference`
8. `zatca_invoice_type`
9. `zatca_status`
10. `zatca_submitted_at`
11. `subtotal`
12. `discount_amount`
13. `taxable_amount`
14. `tax_amount`
15. `total_amount`
16. `currency_code`
17. `invoice_date`
18. `supply_date`
19. `due_date`
20. `status`
21. `payment_status`
22. `notes`
23. `notes_ar`
24. `cancelled_at`
25. `cancellation_reason`
26. `created_at`
27. `updated_at`
28. `session_id`
29. `payment_method`
30. `original_invoice_id`
31. `credit_reason`
32. `document_language`

`src/lib/invoices/invoiceReadContract.ts` is the canonical typed frontend list.
The legacy `zatca_status` and `zatca_submitted_at` remain ordinary display
fields. V2 lifecycle, provenance, stage, compatibility, output permission, and
final QR do not come from the invoice table.

## Exact raw v2 columns (37)

These columns are introduced by the v2 migrations and remain server-only:

1. `zatca_finalization_version`
2. `zatca_artifact_provenance`
3. `zatca_document_kind`
4. `zatca_lifecycle_state`
5. `zatca_artifact_stage`
6. `zatca_finalized_at_v2`
7. `zatca_finalization_error_v2`
8. `zatca_simplified_xml`
9. `zatca_simplified_xml_hash`
10. `zatca_simplified_signature`
11. `zatca_simplified_qr`
12. `zatca_provisional_xml`
13. `zatca_provisional_xml_hash`
14. `zatca_provisional_signature`
15. `zatca_provisional_qr`
16. `zatca_cleared_xml`
17. `zatca_cleared_xml_hash`
18. `zatca_cleared_signature`
19. `zatca_cleared_qr`
20. `zatca_clearance_metadata_v2`
21. `zatca_network_response_v2`
22. `zatca_finalization_claim_token_v2`
23. `zatca_finalization_claimed_at_v2`
24. `zatca_finalization_lease_expires_at_v2`
25. `zatca_finalization_claimed_by_v2`
26. `zatca_finalization_attempt_v2`
27. `zatca_network_claim_token_v2`
28. `zatca_network_claimed_at_v2`
29. `zatca_network_lease_expires_at_v2`
30. `zatca_network_claimed_by_v2`
31. `zatca_network_operation_v2`
32. `zatca_network_attempt_v2`
33. `zatca_network_idempotency_key_v2`
34. `zatca_network_request_hash_v2`
35. `zatca_network_request_started_at_v2`
36. `zatca_network_ack_state_v2`
37. `zatca_reconciliation_reason_v2`

The migration also denies these 15 pre-v2 server-owned fields, for a complete
52-column server-only grant contract:

`zatca_uuid`, `zatca_type_code`, `zatca_counter_number`,
`zatca_prev_invoice_hash`, `zatca_xml`, `zatca_xml_hash`, `zatca_signature`,
`zatca_qr_code`, `zatca_submission_id`, `zatca_clearance_status`,
`zatca_clearance_response`, `zatca_reporting_response`, `zatca_warnings`,
`checkout_idempotency_key`, and `credit_note_idempotency_key`.

## Current frontend invoice-read inventory

All rows below are browser/authenticated PostgREST paths. `select('*')` is
absent on `invoices`; stars on `invoice_items`, `payments`, `branches`, or other
tables are outside this invoice-column contract.

| File/path | Query purpose and selected invoice columns | `invoices.*` | Raw needed | Safe replacement/result |
|---|---|---:|---:|---|
| `src/pages/customers/CustomersPage.tsx` | customer totals: `customer_id,total_amount,invoice_date` | No | No | Already safe |
| `src/pages/invoices/InvoicesPage.tsx` | list: `id,branch_id,invoice_number,invoice_reference,zatca_invoice_type,invoice_date,created_at,status,subtotal,tax_amount,total_amount,zatca_status`, plus existing customer/item/payment relations | No | No | Already safe; sandbox status API supplies sandbox status |
| `src/pages/invoices/InvoicesPage.tsx` | credit links: `id,invoice_number,original_invoice_id,created_at` | No | No | Already safe |
| `src/pages/admin/BranchDetailPage.tsx` | branch invoices: `id,invoice_number,total_amount,status,invoice_date,payment_method`, plus customer/payment relations | No | No | Already safe |
| `src/pages/operations/OperationsPage.tsx` | operations status: `id,branch_id,invoice_number,invoice_date,created_at,zatca_invoice_type,zatca_status,zatca_submitted_at,status` | No | No | Already safe |
| `src/pages/super-admin/ClientDetailPage.tsx` | tenant summary: `status,total_amount` | No | No | Already safe; RLS/admin policy remains authoritative |
| `src/pages/day-closing/DayClosingPage.tsx` | daily totals: `id,total_amount,tax_amount,zatca_invoice_type` | No | No | Already safe |
| `src/pages/super-admin/SuperAdminDashboard.tsx` | platform totals: `invoice_date,total_amount` | No | No | Already safe; existing admin policy remains authoritative |
| `src/pages/print/ReceiptPrintPage.tsx` | receipt invoice row: canonical `INVOICE_SAFE_SELECT` | No | No | Production QR/status uses output-state API; demo QR uses sandbox status API |
| `src/pages/print/ReceiptPrintPage.tsx` | original document language: `document_language` | No | No | Already safe |
| `src/pages/customers/CustomerDetailPage.tsx` | customer history: `id,invoice_number,invoice_date,total_amount,tax_amount,status,payment_status`, plus item relation | No | No | Already safe |
| `src/lib/zatca/submission.ts` | retry candidates: `id,branch_id,invoice_number,zatca_status` | No | No | Already safe; submission itself is Edge-backed |
| `src/pages/invoices/InvoiceDetailPage.tsx` | invoice detail and refresh: canonical `INVOICE_SAFE_SELECT` | No | No | Final QR/lifecycle uses output-state API; demo QR uses sandbox status API |
| `src/pages/invoices/InvoiceDetailPage.tsx` | linked credit notes: `id,invoice_number,total_amount,zatca_status,payment_status,credit_reason,created_at` | No | No | Already safe |
| `src/pages/invoices/InvoiceDetailPage.tsx` | original invoice link: `id,invoice_number,total_amount,zatca_status,document_language` | No | No | Already safe |
| `src/pages/invoices/CreateCreditNoteModal.tsx` | original submission eligibility: `zatca_status` | No | No | Already safe |
| `src/pages/pos/POSPage.tsx` | completed-session reload: `id,zatca_invoice_type,total_amount` | No | No | Already safe; completed-sale QR/status uses Edge response/output-state API |

Reports and exports that do not appear in this table obtain aggregated data from
their existing RPCs or derive it from the safe rows above; they do not query
`public.invoices` directly. Generated database types contain invoice field
definitions but perform no reads. `documentViewAdapters.ts` and `qrSelector.ts`
are pure adapters and issue no database query.

Service-role queries in `supabase/functions/**` legitimately read raw compliance
inputs and artifacts and are intentionally excluded from the browser allowlist.

## Safe output-state response

The approved Edge status response is camel-cased consistently with the client:

`invoiceId`, `invoiceStatus`, `finalizationStatus`, `artifactStage`,
`documentKind`, `canPrint`, `canShare`, `retryAvailable`,
`reconciliationRequired`, `qrCode`, `error`, `schemaVersion`,
`edgeFunctionVersion`, `minimumClientVersion`, `compatible`, and
`immutableFinalizationEnabled`, plus `contractMode`, `legacyCompatible`,
`databaseFeatureEnabled`, and `legacySubmitAvailable`.

The RPC may read server-only columns internally, but returns no XML, hash,
signature, counter, PIH, provisional artifact, claim/lease value, idempotency
value, or raw ZATCA response. `qrCode` is non-null only for permitted final
output.

## Compatibility and schema-only decision

The current worktree is compatible with the allowlist. A previously deployed
frontend that still directly selects `zatca_qr_code` (or any other server-only
field) is not compatible with `04a`: PostgREST will reject the entire query.
Therefore applying the v2 schema including `04a` while that old frontend is
serving is **NO-GO**. Deploy a frontend containing this safe-reader contract
before `04a`, then drain all already-open old bundles before applying it; keep
all finalization flags disabled until the normal capability rollout gates pass.
