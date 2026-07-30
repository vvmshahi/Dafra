# Kubri final web production-readiness certification — 30 July 2026

## Scope and verdict

**Status: FAILED — release blocked pending listed P1 deployment work and authorised operational evidence.**

**Recommendation: D — source and deterministic-contract readiness are strong, but this is not a web-production certification.** A controlled deployment must first apply the forward migration in this branch, then an authorised demo lifecycle and real fiscal pilot must be completed. No real seller, customer, OTP, CSID, fiscal invoice, reporting, clearance, chain, or production business data was created or modified by this audit.

This report separates source-level and deterministic automated evidence from authenticated demo/production and genuine fiscal verification. A passing source contract is not evidence of a real ZATCA production pilot.

## Recovery and baseline

| Item | Status | Evidence |
| --- | --- | --- |
| Interrupted-audit recovery | PASSED | No prior final certification, screenshots, logs, or artefact report was found. One untracked forward migration was recovered and reviewed. |
| Feature branch and source | PASSED | `feature/final-web-printing-ui-refinements-20260729`, initial/source SHA `9000bc1f741a6f6090eb1c84868be2d16ef1afa6`; it matches `origin/feature/final-web-printing-ui-refinements-20260729`. |
| Printing & Documents refinements | PASSED | Branch history contains the complete 29 July printing/document commits and focused contracts pass. |
| Public production source | PASSED | Latest production deployment is Ready, created 29 July 2026, and aliases `dafra.vercel.app` / `kubri.shop` point to the `main` SHA `59b134179c51229331bd2a686fca927089abda6e`, not this feature branch. |
| Latest Preview | PASSED | Ready Preview `dafra-d5k0tfa6m-mohammed-shahin-v-vs-projects.vercel.app`, created 30 July 2026, with the feature-branch preview alias. No authenticated UI walkthrough was performed. |
| Supabase project and remote history | FAILED | Linked project `bkbphkpqcxuejozayrsy` is at `20260730000400`; local forward migration `20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql` is not applied remotely. |
| Edge Functions | PASSED (inventory only) | Required owner/branch, ZATCA, sandbox and production functions are Active; current versions were captured with `supabase functions list`. This is not an endpoint exercise. |
| Public configuration and secrets | PASSED (source inspection) | Browser configuration contains only public Supabase URL/anon configuration. Source and example environment policy prohibit VITE-prefixed fiscal private keys, OTPs and CSIDs. No secret values are recorded here. |
| Fresh local reset | NOT TESTED | Local Supabase startup was blocked before reset because host port `54322` is occupied by another local project. Nothing was stopped or overwritten. |

## Test tracks

| Track | Status | Evidence |
| --- | --- | --- |
| Source-level verification | PASSED | Reviewed migrations, RLS/privilege contracts, Edge routing, safe invoice reads, non-fiscal demo guard, printer/document code, and branch-scoped settings. |
| Deterministic automated tests | PASSED | `npm test`, `npm run build`, `git diff --check`, printing/document, demo, owner/branch, catalogue/stock/purchase/customer/supplier/expense/POS, invoice/credit-note, QR, outbox, finalization, capability, atomic and rollout contract scripts passed after focused maintenance repairs. |
| Authenticated demo verification | PENDING AUTHORISED SESSION | No authorised demo tenant credentials/session were supplied or inferred. |
| Authenticated production verification | PENDING AUTHORISED SESSION | No customer production session was used. |
| Genuine real-fiscal verification | PENDING REAL ZATCA PILOT | No authorised Saudi seller identity, OTP/CSID, buyer, or controlled production transaction was available. |

## Lifecycle and operational coverage

| Area | Status | Evidence and remaining evidence |
| --- | --- | --- |
| New Owner onboarding | PENDING AUTHORISED SESSION | Invitation/create-owner and provisioning source exists; registration, email/password, retry/idempotency, suspension/expiry and routing require an authorised fresh account. |
| Tenant and subscription | PENDING AUTHORISED SESSION | Source gates and owner workspace contracts pass; create-once, direct RPC denial and subscription states require authenticated verification. |
| Branch creation and branch login | PENDING AUTHORISED SESSION | Branch modal, validation, access and owner-workspace contracts pass; invitation/login, duplicate identities and sibling isolation require an authorised tenant. |
| Business and document settings | PASSED (source/automated) | Branch-scoped settings, six A4 layouts, four thermal layouts, artwork policy, labels, RTL fixtures, persistence and print paths pass. Re-login and physical printer validation remain pending. |
| ZATCA onboarding and readiness | PASSED (source/automated) | Backend-only credential path, branch readiness, capability acknowledgement, atomic gating, private-artifact protections and failure contracts pass. Credential issuance/expiry/revocation needs an authorised real session. |
| Register operations | PENDING AUTHORISED SESSION | POS/session source contracts pass; opening/closing, reconciliation, contention and retry require controlled demo execution. |
| Categories, products, units and barcodes | PASSED (source/automated) | Catalogue, categories, units, barcode generation/printing and low-stock eligibility contracts pass. CRUD and concurrent remote execution remain pending. |
| Stock, purchases and expenses | PASSED (source/automated) | Unit conversion, receipt/purchase, movement and expense UI/idempotency contracts pass. Exact-once remote mutations remain pending. |
| Customers and suppliers | PASSED (source/automated) | B2B/customer validation, Walk-in rendering, supplier integration, Arabic copy and scope contracts pass. Authenticated CRUD remains pending. |
| POS Cash/Card/Split | PASSED (source/automated) | Cart, scanner, stock-safe mutation, cash/card/split, direct session error UX, idempotency and double-click contracts pass. Controlled checkout/reconciliation remains pending. |
| Demo non-fiscal checkout | PASSED (source/automated); PENDING AUTHORISED SESSION | Server derives demo state, strips client demo flags, prevents QR/XML/outbox/chain mutation, and enforces bilingual wording. One authorised demo sale must verify persisted reconciliation. |
| Simplified B2C production pilot | PENDING REAL ZATCA PILOT | Do not run without authorised seller identity, live credentials and controlled approval. |
| Standard B2B production pilot | PENDING REAL ZATCA PILOT | Do not run without an authorised valid buyer and clearance approval. |
| QR, XML and signature | PASSED (source/automated) | Stored QR only, no demo QR, Phase Two QR, immutable artifact, signature, print gating and QR rendering contracts pass. Real payload/scan verification remains pending. |
| Reporting and clearance | PASSED (source/automated) | Durable reporting outbox, retry classification, reconciliation, Standard clearance gate and false-success protections pass. Endpoint response verification remains pending. |
| Returns and credit notes | PASSED (source/automated) | B2C/B2B UX, eligibility, duplicate/retry storage and atomic credit-note architecture contracts pass. Controlled lifecycle mutation remains pending. |
| Invoices, receipts, print and PDF | PASSED (source/automated) | Safe read surface, receipt/A4, saved settings, page/RTL/demo/fiscal gating and PDF/print code paths pass. Browser and device rendering remains pending. |
| Reports and register reconciliation | PENDING AUTHORISED SESSION | Report-query and unit/report contracts pass; one real demo-session cash equation has not been reconciled. |
| Owner/Admin workspace | PASSED (source/automated) | Owner workspace, branch modal, sessions and printing routes have focused contracts. Authenticated route walkthrough remains pending. |
| Tenant/Branch isolation | PASSED (source/automated); PENDING AUTHORISED SESSION | RLS, explicit safe columns, tenant/branch server checks, protected ZATCA artifacts and storage contracts pass. Cross-account RPC/storage proof requires three authorised roles. |
| Failure recovery/idempotency | PASSED (source/automated) | Checkout replay/fingerprint, lost-response, lease, outbox, retry, barcode and document-state contracts pass. Network interruption exercise remains pending. |
| Performance | P2 | Build succeeds but warns about a `2.89 MB` minified (`771.91 kB` gzip) main chunk. No measured authenticated route timings were taken; optimise only after profiling. |
| Responsive English/Arabic/RTL | PASSED (source/automated); NOT TESTED (manual viewports) | RTL, bilingual and responsive contracts/SSR fixtures pass. Required browser checks at all listed resolutions remain pending. |
| Deployment and rollback | FAILED | Deployment SHA traceability and previews are available, but the pending migration blocks certification. Rollback/runbook material exists; fresh local reset was blocked by an unrelated local Docker port conflict. |

## Findings

### P0

**Status: PASSED — no confirmed P0 finding.** No source-level evidence of cross-tenant access, browser private-key exposure, client-ready spoofing, duplicate atomic checkout, false fiscal success, or chain mutation was found. This does not replace authenticated penetration testing.

### P1

**Status: FAILED — one release blocker.**

1. **Forward migration not applied/committed at audit start.**
   - Reproduction: `supabase migration list --linked` shows local `20260730000500` with no remote counterpart.
   - Impact: the forward migration chain does not reproducibly restore internal legacy presentation helpers used by the invoice-settings read path; production release/deployment cannot be certified.
   - Smallest safe fix: preserve and commit `20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql`; deploy it in the next authorised database release, then run a fresh reset and settings smoke.
   - Required test: local fresh reset plus owner/branch settings save, refresh and re-login; production migration list must match.
   - Blocking: yes, until applied and verified.

### P2/P3

**Status: PASSED with deferred items.**

1. **P2 — stale package commands.** `test:credit-note-eligibility-preflight` and `test:credit-note-duplicate-inv0834-diagnostic` reference absent scripts. They are not invoked by `npm test`; do not use them as release evidence until restored or removed in a separately scoped maintenance change.
2. **P2 — bundle size.** Vite reports a large main JavaScript chunk. Profile authenticated routes before code-splitting.
3. **P2 — local reset environment.** Docker port `54322` is in use by another project. Resolve locally without stopping unrelated projects, then rerun reset.
4. **P3 — physical printer validation.** Browser render contracts pass; hardware-specific 58/80 mm and Electron printer calibration need later controlled testing.

## Corrective work

**Status: PASSED.** This certification preserves the recovered forward migration and repairs deterministic tests that had become stale after the receipt composition/checkout and safe-read refactors. The fixes strengthen coverage; they do not weaken fiscal, RLS, validation, or idempotency controls.

Affected focused tests now verify the live composition module, early server document decision, explicit non-fiscal demo print exception, post-demo constrained invoice read grant, and recovered eligibility migration location.

## Required release gate

**Status: FAILED.** Before any merge/public release:

1. Apply and verify `20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql` in the linked project.
2. Run a clean local Supabase reset after resolving the unrelated port conflict.
3. Complete an authorised demo lifecycle: new Owner, tenant/subscription, Branch user, register, one demo cash/card/split checkout, return, and full reconciliation; retain the transaction.
4. Complete authenticated Owner/Branch/other-tenant/anonymous isolation and storage/RPC checks.
5. Execute viewport/RTL browser walkthroughs and measured performance checks.
6. For fiscal certification only, separately obtain written authorisation and genuine Saudi seller/buyer credentials for controlled Simplified B2C and Standard B2B pilots.

## Authorised mutations and push

**Status: PASSED.** No remote business, customer, fiscal, credential, invoice, reporting, clearance, outbox, chain, or production deployment mutation was made. Local changes are source migration, deterministic test maintenance, and this report only. Push is limited to `feature/final-web-printing-ui-refinements-20260729`; no merge or release tag is created.

## Final verdict

**KUBRI_FINAL_WEB_PRODUCTION_READINESS_BLOCKED**

The application has substantial source-level and deterministic contract evidence, including fiscal safety controls. It is not production-certified: the forward migration is pending, no clean reset completed, no authorised demo lifecycle was executed, and no real ZATCA pilot was authorised or attempted.

## Technical blocker clearance update — 30 July 2026

The migration and clean-reset blockers were subsequently cleared in the isolated
readiness worktree. The local Supabase failure was traced to the mixed-case
`project_id = "Dafra"` in `supabase/config.toml`: Docker service discovery
constructed `supabase_db_Dafra`, which Storage could not resolve. The local-only
development configuration now uses `project_id = "dafra"`.

The disposable local stack was repaired without removing unrelated project
containers or volumes. A clean reset completed the complete migration chain
through `20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql`;
the database and all configured Supabase services remained healthy afterward.
The three restored V1 helpers were verified locally and remotely for signatures,
ownership, `SECURITY DEFINER` settings, safe search paths, comments, and
service-role-only execution. Browser execution remains revoked.

The linked project `bkbphkpqcxuejozayrsy` initially had exactly one pending
migration, `20260730000500`. The supported dry run listed only that migration.
It was applied through the supported linked migration workflow. A subsequent
migration list shows local/remote parity, and a second dry run reports the
remote database is up to date.

Dependencies were restored with `npm ci`; package metadata and the lockfile were
unchanged. `npm test`, `npm run build`, and `git diff --check` passed. The
focused runtime helper harness could not complete because its cleanup command
hard-codes the obsolete `supabase_db_Dafra` container name; its synthetic local
fixtures were removed by a clean disposable reset. The existing invoice-settings
source contract also has a stale expected-key assertion for the already-present
`show_standard_branding` field. Neither issue changed migration or production
data, and no test was weakened.

The migration and clean-reset blockers are **PASSED**. Full production
readiness remains blocked pending the authorised Owner/tenant/Branch lifecycle,
operational CRUD and POS/demo verification, authenticated isolation checks,
responsive Arabic/RTL verification, and separately authorised controlled
Simplified B2C and Standard B2B ZATCA pilots.

## NEW BRANCH FISCAL PATHWAY DECISION

This is a non-interactive source/database-contract audit. No account, invoice,
payment, stock, customer, credential, reporting, clearance, chain, or ZATCA
record was created or modified.

### Default state

A new Branch is **not Atomic by default**. The branch-insert trigger creates:

- an Atomic checkout gate with `enabled = false`;
- a `zatca_branch_readiness_v2` row with `readiness_status = 'blocked'`,
  `readiness_source = 'operator_block'`, and reason
  `awaiting_production_onboarding`;
- ordinary branch defaults including `zatca_phase = 1`, invoice counter `0`,
  and the configured invoice language/VAT mode.

The Branch RPC derives `tenant_id` from the authenticated Owner profile. It does
not accept a client tenant override. It requires an active Owner profile,
active/non-suspended tenant, valid payload, and branch-limit allowance. The
Owner provisioning path uses normalized-email/request-fingerprint uniqueness,
advisory locking, replay detection, an active plan allowlist, and resumable
states; no manual SQL is part of the intended flow. The inspected Branch RPC
itself has no duplicate-submit idempotency key, so duplicate UI submission is
protected by database uniqueness/limits rather than a dedicated branch request
record.

### Pathway matrix

| Branch state | Credentials/readiness/capability | Invoice type | Pathway | Checkout | QR/reporting/clearance |
| --- | --- | --- | --- | --- | --- |
| New or production Branch without production credentials | Missing production CSID/secret or functionality map | Simplified or Standard | Blocked | No | No fiscal output |
| Demo tenant with active Sandbox Branch | Server-derived `tenants.is_demo = true` and `branches.zatca_environment = 'sandbox'` | Simplified or Standard classification | Demo/non-fiscal | Yes | No production QR/XML/signature/reporting/clearance/chain/outbox; bilingual demo warning |
| Production credentials connected, Atomic readiness absent/blocked | Valid production connection and capability, but no Atomic eligibility | Simplified | Legacy Simplified | Yes | Legacy stored/reporting path; Atomic is not selected |
| Production credentials connected, Atomic eligible | Runtime/schema/client/Edge compatibility, Atomic global switch, readiness `ready`, chain head, production credentials, active branch/tenant, valid acknowledgement, and enabled gate | Simplified | Atomic Simplified | Yes | Locally finalized immutable artifact, stored QR, durable reporting outbox; retry/reconciliation is server-controlled |
| Simplified-only capability with Standard buyer | Capability `0100`, classified Standard | Standard | Blocked | No | No clearance |
| Standard-only capability with Simplified buyer | Capability `1000`, classified Simplified | Simplified | Blocked | No | No reporting |
| Fully ready Standard B2B Branch | Valid production connection and Standard capability | Standard qualified business buyer | Legacy Standard clearance | Yes, subject to clearance gate | Clearance-gated; provisional/failed states are not printable-final |
| Mixed capability `1100` | Valid production connection; pathway depends on document kind | Simplified/Standard | Atomic only for eligible Simplified; Legacy clearance for Standard | Conditional | Document-specific QR and submission gates |
| Expired/revoked/partial credentials, inactive branch/tenant, suspended tenant, missing chain, expired acknowledgement, incompatible runtime, or inconsistent state | Any required gate false | Any | Blocked or legacy-required before fiscal mutation | No for blocked state | No false fiscal success; reconciliation/error state is explicit |

The authoritative classifier is
`resolve_pos_checkout_document_internal_v1`, exposed to authenticated callers
through `resolve_pos_checkout_document_v1`. It derives actor, tenant, branch,
customer, capability, credential, environment, readiness, and Atomic eligibility
server-side. Client payload flags such as `is_demo` and `non_fiscal` are removed
before the commercial checkout base is called.

### Atomic enablement and recovery

Atomic Simplified requires schema/client/Edge version `2.1.0`, compatible runtime,
immutable finalization, simplified and Atomic global enablement, branch readiness
`ready`, a valid production connection, an existing chain head, active tenant and
Branch, an unexpired authorized capability acknowledgement, serialized chain
allocation, leased claims, and the enabled branch gate. Standard B2B does not use
Atomic; it remains on the legacy clearance path.

The client cannot force Atomic mode. The server returns `legacy_required` when
Atomic rollout is disabled or the branch is not ready, and the database checkout
wrapper requires an Atomic intent when the authoritative path is Atomic. Atomic
checkout uses cart fingerprints, idempotency keys, durable response evidence,
serialized chain allocation, replay handling, and reconciliation-required states.
Reporting is scheduled after the committed local transaction and is not awaited
by checkout. Legacy finalization and Standard clearance retain their own
provisional/failed/cleared print gates.

### ZATCA and demo safety

Credential creation, CSR/OTP/CSID handling, production secrets, and submission
are server-side contracts. Browser code receives capability/status data rather
than private credentials; production onboarding and readiness are not client-set
flags. Demo classification is derived from authoritative tenant/environment rows,
not display names or client payloads. Demo output uses
`DEMO — NOT A TAX INVOICE` / `تجريبي — ليست فاتورة ضريبية`; demo fiscal queue and
chain guards reject production reporting/clearance state.

### Audit evidence and remaining checks

Deterministic suites covering finalization, coordinated deployment, branch
readiness, Atomic eligibility/capabilities/acknowledgement, Atomic checkout,
durable reporting recovery, outbox security, invoice read safety, demo checkout,
printing/documents, barcode workflow, and artwork contracts passed. The
authenticated artwork RLS runtime suite was not run because it is explicitly
opt-in and no authorized credentials were available. Manual browser acceptance
of onboarding, Branch login, CRUD, POS/register, reconciliation, isolation, and
English/Arabic/RTL viewports remains **PENDING MANUAL ACCEPTANCE**. Real
Simplified B2C and Standard B2B fiscal execution remains **PENDING AUTHORISED
REAL ZATCA PILOT**.
