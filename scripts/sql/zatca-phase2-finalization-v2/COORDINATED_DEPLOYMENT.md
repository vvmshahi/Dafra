# Coordinated deployment and rollback plan

This is a release plan only. It does not authorize SQL execution, deployment,
feature enablement, staging, commit, or push. All immutable-finalization flags
remain false throughout this plan.

## 1. Classification

**D. Cached old frontend makes zero-downtime rollout unsafe.**

The dual Edge and safe-reader frontend are compatible with the pre-v2 database
after the disabled-mode fixes in this package. A stale old browser bundle is
not compatible with the `04a` grant boundary, however, and code already running
in a tab cannot be replaced by Vercel cache invalidation. Use the controlled
window below.

## 2. Pre-schema Edge compatibility

The new Edge is safe to deploy first with
`ZATCA_IMMUTABLE_FINALIZATION_ENABLED=false`.

| Request | Pre-schema result |
|---|---|
| Existing legacy submit: no `action`, no `clientVersion` | Accepted only while the database master is false or the v2 capability RPC is absent. It uses the preserved hosted-schema legacy processor. |
| `capabilities`, client 2.0.0 | Authenticates branch scope and returns `schemaVersion:null`, `databaseFeatureEnabled:false`, `legacySubmitAvailable:true`, `immutableFinalizationEnabled:false`, `compatible:false`. |
| `status`, client 2.0.0 | Authenticates invoice scope and returns a minimal legacy-safe state. QR is returned only for an already `reported`/`cleared` invoice with a stored QR. |
| `finalize`, client 2.0.0 | `426 FINALIZATION_VERSION_MISMATCH`; no write or network submission. |
| Existing retry (`source=manual_retry` or `bulk_retry`, actionless) | Accepted by the legacy path. An explicit `action=retry` is rejected `400` so it cannot be misrouted. |
| Existing report | Accepted through actionless submit; the legacy processor selects the reporting endpoint from the invoice kind. Explicit `action=report` is rejected `400`. |
| Existing clear | Accepted through actionless submit; the legacy processor selects the clearance endpoint from the invoice kind. Explicit `action=clear` is rejected `400`. |
| Versioned `submit` while flags are false | Pre-schema: `426`. Schema-compatible but disabled: `409 IMMUTABLE_FINALIZATION_DISABLED`. It is never silently downgraded. |

The fallback predicate is exact: absent raw `action`, absent `clientVersion`,
and `legacySubmitAvailable=true`. On capability-RPC failure the Edge also probes
the runtime singleton, when present, so a true database master cannot fall back
to legacy merely because migration `05` is missing. The superseded generic
finalization function remains uncallable behind
`SUPERSEDED_V1_FINALIZATION_PATH_DISABLED`.

## 3. Pre-04a frontend compatibility

The new frontend may deploy before the schema only after the new Edge above is
deployed and verified.

- `INVOICE_SAFE_SELECT` is a subset of the current table-wide authenticated
  grant and works before `04a`.
- Invoice Detail and ReceiptPrintPage read only the canonical safe selector.
- Their production QR/finalization state comes from the Edge status action.
  The pre-schema response is explicitly marked `contractMode=legacy` and is
  accepted only with `legacyCompatible=true` and the exact Edge/client
  versions. Legacy submission separately requires
  `legacySubmitAvailable=true` and a false database master.
- POS negotiates `checkoutMode` before `pos_checkout`. It selects legacy mode
  pre-schema and sends the exact actionless request after checkout. It selects
  v2 only when schema, Edge, client, acknowledgement, database master,
  document-kind flags, feature claims, and Edge kill switch are all ready.
- No raw v2 column is required. The safe frontend contains no direct legacy QR
  read or browser QR update.
- Historical legacy QR remains temporarily readable only through the
  service-role-backed safe status response. It is never granted as a browser
  invoice column.

A new frontend against the old Edge remains a no-go because the old Edge has no
capability/status contract. Therefore deployment order is Edge, verify, then
frontend.

## 4. Old frontend post-04a failures

The deployed baseline at `HEAD` has these exact failures:

| Baseline path | Query/use | Fields denied by `04a` | Result |
|---|---|---|---|
| `src/pages/invoices/InvoiceDetailPage.tsx`, `INVOICE_DETAIL_SELECT` (baseline lines 110–119), used by initial load and both refreshes | Invoice Detail row | `credit_note_idempotency_key`, `zatca_uuid`, `zatca_type_code`, `zatca_counter_number`, `zatca_prev_invoice_hash`, `zatca_xml_hash`, `zatca_qr_code`, `zatca_submission_id`, `zatca_clearance_status`, `zatca_warnings` | PostgREST rejects the entire select. The page cannot load/refresh. |
| Same baseline file (lines 308 and 334) | Reads raw `zatca_qr_code` and attempts a browser update when missing | `zatca_qr_code` | Read is denied by `04a`; update is also denied by the protected-write contract. |
| `src/pages/print/ReceiptPrintPage.tsx`, `INVOICE_PRINT_SELECT` (baseline lines 34–40), used at line 208 | Direct receipt row | `zatca_qr_code` | PostgREST rejects the entire select; the direct receipt page fails. |
| Same baseline file (line 268) | Reads raw QR | `zatca_qr_code` | Denied. |

No compatibility view or RPC can repair a cached bundle because it still
queries `public.invoices` by the original field names. A transition column grant
would have to re-expose the server-owned fields above. A table-wide grant would
also expose all new raw v2 fields. Neither is approved.

## 5. Selected deployment strategy

| Strategy | Assessment |
|---|---|
| A. Edge first → frontend first → schema/04a | **Selected, with a mandatory client-drain window for schema/04a.** Both new layers can be proven on the current schema before the grant cutover. |
| B. Edge first → schema/04a → frontend immediately | Rejected. Any active old Detail/Receipt request fails between `04a` and frontend activation. |
| C. Pause → schema → Edge → frontend → verify → reopen | Safer than B but not preferred: it postpones proof of both compatibility layers until after the database boundary changes. |
| D. Temporary compatibility grants | Rejected. The exact fields required by the old bundle are server-owned compliance/idempotency fields. |

The selected sequence combines A's predeployment proof with a maintenance
window at the irreversible browser-contract boundary.

## 6. Cache and session handling

No service-worker registration or PWA worker exists in this repository. Vite
emits content-hashed JS/CSS assets, so a fresh navigation receives the new
bundle after the deployment propagates. That does not replace JavaScript
already running in an old POS tab, receipt tab, or long-running session.

Before `04a`:

1. Announce a sale cutoff and block new browser traffic at the application
   gateway/maintenance layer.
2. Let in-flight checkouts finish while the Edge still accepts actionless
   legacy submission.
3. Require every POS station to close all Kubri tabs/windows. Record operator,
   branch, station, and time.
4. Wait for the frontend deployment to be healthy in every CDN region used.
5. During the window, apply and verify the database sequence below.
6. Reopen only to a fresh navigation. Confirm the loaded build identifies
   client 2.0.0 and its capability call reaches Edge 2.0.0.
7. Keep the old asset deployment available only as an artifact for diagnosis;
   never route users back to it after `04a`.

A version check in the new bundle cannot evict an old bundle that never
executes the new check. Operational client drain is therefore mandatory.

## 7. Exact migration order

Execute only in the authorized release change, stopping after any unexpected
result:

1. `00_hosted_preflight.sql` — read-only capture; stop on policy, grant,
   trigger, object, singleton, hash, or invoice-fingerprint drift.
2. `01_artifact_lifecycle.sql`
3. `02_chain_allocator.sql`
4. `03_claims_and_idempotency.sql`
5. `04_lock_compliance_fields.sql`
6. `04a_safe_invoice_read_surface.sql`
7. `05_capabilities_and_status.sql`
8. `06_verification.sql`
9. `09_branch_readiness_gate.sql`
10. `10_branch_readiness_verification.sql`
11. `11_durable_simplified_reporting_outbox.sql`

After step 11 and while all flags remain false, review and explicitly execute
`operator/install_reporting_outbox_dispatch.sql` only when the required Vault
URL and service-role secrets have been installed. That separate step creates
the recurring server-side outbox consumer. It does not enqueue historical
invoices and is not part of recovery execution. The Vault service-role JWT is
sent as both `Authorization: Bearer ...` and `apikey`; the Edge route verifies
exact token equality and the `service_role` claim before any global claim.
Transient reporting is limited to four attempts with 60/120/240-second
backoff. Definite rejections and ambiguous outcomes block without replay.

`04a` runs **before `05`**. It depends on the complete invoice-column shape
created by `01`–`04`, but not on the capability/status functions in `05`.
Running it immediately after `04` minimizes the interval in which newly added
raw columns inherit the legacy table-wide grant. Traffic is already closed and
the pre-schema Edge status route remains available during the brief interval
before `05`. After `05`, the SQL-backed safe status route takes over.

After every mutating file, confirm database master, simplified, and standard
flags are false and the Edge kill switch remains false. Before `04a`, old/new
legacy submission remains available. At and after `04a`, old Detail/Receipt is
known incompatible, so traffic remains closed. After `05`, new clients still
select legacy mode because the database master is false. `06` must return
exactly 59 rows: 54 `PASS`, 5 `REVIEW`, 0 `FAIL`; every REVIEW retains its named
external release test.

## 8. Edge and frontend deployment order

1. Build and test the dual Edge locally; do not change either kill switch.
2. Deploy the dual Edge against the current schema.
3. Verify old actionless submit/retry plus new capability/status, and verify
   versioned finalize fails safely.
4. Deploy the safe-reader/capability-aware frontend.
5. Verify Invoice Detail, receipt, POS precheckout legacy negotiation, credit
   note, reports, and direct receipt on the current schema.
6. Start the maintenance/client-drain window.
7. Execute `00`, then `01`, `02`, `03`, `04`, `04a`, `05`, `06`.
8. Run the post-cutover smoke matrix below.
9. Reopen browser traffic only after all mandatory checks pass.

## 9. Version-gate behavior

| Combination | Behavior |
|---|---|
| Old client + old Edge + pre-schema | Existing actionless legacy behavior. |
| Old client + new Edge + pre-schema | Actionless submit/retry/report/clear accepted in disabled legacy mode; no mandatory client version. |
| New client + new Edge + pre-schema | Capability selects legacy before `pos_checkout`; versioned status uses legacy-safe output; v2 mutations fail safely. |
| Old client + new Edge + post-schema, all flags false | Actionless submission still works because the database master is false, but old Detail/Receipt is incompatible after `04a`; do not admit this client. |
| New client + new Edge + post-schema, all flags false | Capability selects legacy before checkout; safe reads/status work; no v2 artifact is created. |
| Stale old client after `04a` | Invoice Detail/direct receipt queries fail. Keep traffic closed and require a fresh load; do not broaden grants. |

For new clients, incompatibility is always decided before `pos_checkout`. For a
future v2 enablement, the database insert guard requires a current
user/branch/client/Edge acknowledgement when the database master becomes true;
an old checkout transaction fails before invoice/payment commit. Never enable
the master until the same old-session drain has been repeated.

## 10. Rollback matrix

| Failure | Action while all flags stay false |
|---|---|
| Edge deployment fails | Keep/restore the last deployed legacy Edge; do not deploy the new frontend or start schema execution. Diagnose offline. |
| Frontend deployment fails before schema | Route back to the previous frontend while broad legacy reads still exist; do not start the database window. |
| `01`–`04` succeed but `04a` fails | Stop, keep traffic closed, preserve added objects/data, and repair the exact grant/preflight drift. Do not proceed to `05`/`06` or drop artifacts. |
| `04a` succeeds but frontend fails | Keep traffic closed. Redeploy the prevalidated safe-reader build or a forward fix. Do not route to the old bundle. |
| Verifier fails | Stop with traffic closed. Preserve every schema/artifact/chain object and resolve the named failing row. |
| Invoice Detail fails | Keep/re-enter maintenance; verify build ID, `INVOICE_SAFE_SELECT`, output-state response, RLS, and grant rows. Forward-fix/redeploy. |
| ReceiptPrintPage fails | Same as Detail; also verify historical legacy status returns QR only for `reported`/`cleared`. |
| POS fails | Block new checkout, verify capability returns legacy while flags are false, and validate failure occurs before `pos_checkout`. Existing completed sales/artifacts are untouched. |
| Cached old frontend persists | Keep that station blocked, close every old tab/window, perform a fresh navigation, and verify client/Edge versions. |

Technically, `04a` can be reversed by regranting table-wide SELECT, or partially
worked around by granting the ten denied columns requested by old Invoice
Detail plus raw QR for ReceiptPrintPage. The security cost is direct browser
access to idempotency identity, UUID/type, chain counter/PIH/hash, raw QR,
submission/clearance state, and warnings; table-wide SELECT additionally
exposes all raw v2 artifacts, claims, leases, and network state. This is not an
approved rollback. Use a safe-reader forward deployment instead.

Never regenerate/resign an invoice, clear finalization artifacts, change a
counter/PIH, remove a claim/reservation, delete a response, or undo a completed
payment as part of rollout rollback.

## 11. Smoke-test matrix

Run immediately after the coordinated deployment, with every flag still false:

| Test | Required result |
|---|---|
| POS login and sale | Fresh client 2.0.0; capability chooses legacy before checkout; one completed sale and legacy submission; no v2 row/artifact. |
| Invoice list | Loads from safe columns. |
| Invoice Detail | New and historical invoices load; no PostgREST column error. |
| Historical receipt | Loads; final legacy QR appears only through safe status when reported/cleared. |
| Historical A4 | Loads and uses the same approved output state. |
| Direct receipt URL | Fresh route loads successfully after `04a`. |
| Credit note | Creation and actionless legacy submission work; original remains accessible. |
| Reports/dashboard | Existing aggregates and safe invoice reads load. |
| RLS cross-branch denial | A branch-scoped user cannot read/status another branch's invoice. |
| Safe output-state API | Auth required; identity matches request; no XML/hash/signature/counter/PIH/claims/raw responses; QR gate enforced. |
| Old legacy submit path | Actionless auto/manual/bulk sources work while master false. |
| Raw-v2 browser reads | Explicit raw column and `select('*')` attempts fail; service role retains required access. |
| Verifier | Exactly 59 rows: 54 PASS, 5 REVIEW, 0 FAIL; discharge all external REVIEW items before release acceptance. |

Also run the repository checks:

```text
npm run test:zatca-finalization-v2
npm run test:zatca-invoice-read-surface
npm run test:zatca-coordinated-deployment
npm run build
```

The SQL verifier, disposable-role/RLS fixture, real hosted smoke tests, and
deployments are intentionally not executed by this review.

## 12. Required maintenance window

Required. The window begins before traffic is paused/client tabs are drained
and ends only after `06`, the real authenticated/service-role fixtures, the
complete smoke matrix, and fresh-client confirmation pass. Its duration is
operational rather than a guessed clock time. If any station cannot prove a
fresh bundle, keep that station closed.

## 13. Explicit go/no-go

**GO for a scheduled, staffed, reversible-at-the-application-layer coordinated
deployment using this exact order, with all flags false.**

**NO-GO for schema-only deployment, zero-downtime `04a`, any temporary raw-field
grant, admitting stale tabs, or enabling v2 in the same change.**
