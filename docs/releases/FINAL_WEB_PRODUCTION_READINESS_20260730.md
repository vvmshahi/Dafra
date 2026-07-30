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
