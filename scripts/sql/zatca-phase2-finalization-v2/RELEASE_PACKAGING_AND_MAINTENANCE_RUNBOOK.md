# ZATCA finalization v2 release packaging and maintenance runbook

Status: prepared, not executed. This package installs disabled infrastructure
only. It does not authorize a hosted SQL change, Edge deployment, frontend
promotion, feature enablement, commit, push, or merge.

## 1. Completion classification

**A. Release package and maintenance runbook are ready.**

This classification means the source package and operator procedure are ready
for review and rehearsal. Production remains blocked until the worktree is
committed through the reviewed commit plan, the operator host has the required
CLIs, two operators approve the protected baseline, a maintenance window is
active, and every live gate in this document passes.

## 2. Exact worktree file classification

Categories:

- A — invoice presentation/settings work
- B — ZATCA finalization v2 schema/server work
- C — safe invoice-read/frontend compatibility work
- D — tests/documentation/operator evidence
- E — unrelated or uncertain

No changed file is currently classified E. Mixed files are identified
explicitly rather than forced into an inaccurate single category.

| File | Class | Reason / commit treatment |
|---|---|---|
| `package.json` | D | Adds ZATCA test entry points; keep whole file with release tests. |
| `scripts/audit-phase4c-invoice-settings-ui.mjs` | D | Presentation audit. |
| `scripts/audit-phase4d-document-view-model.mjs` | D | Document model audit. |
| `scripts/audit-phase4e-thermal-receipts.mjs` | D | Thermal presentation audit. |
| `scripts/audit-phase4f-a4-templates.mjs` | D | A4 presentation audit. |
| `scripts/audit-phase4g-invoice-release-readiness.mjs` | D | Presentation release audit. |
| `scripts/audit-phase5b-release-scope.mjs` | D | Presentation release-scope audit. |
| `scripts/sql/invoice-settings-ux/01_extend_presentation_settings_rpc.sql` | A | Presentation settings database contract. |
| `scripts/sql/invoice-settings-ux/02_verification.sql` | D | Presentation verification. |
| `scripts/sql/invoice-settings-ux/03_rollback_plan.md` | D | Presentation rollback documentation. |
| `scripts/sql/invoice-settings-ux/README.md` | D | Presentation package documentation. |
| `scripts/sql/invoice-settings-ux/06_rollback_plan.md` | D | Presentation rollback documentation. |
| `scripts/sql/invoice-settings-ux/06_stabilize_v1_settings_contract.sql` | A | Stabilizes presentation settings contract. |
| `scripts/sql/invoice-settings-ux/07_verify_v1_settings_contract.sql` | D | Presentation verification. |
| `scripts/sql/invoice-settings-ux/CONTRACT.md` | D | Presentation contract documentation. |
| `scripts/test-invoice-settings-ux-redesign.mjs` | D | Presentation test. |
| `scripts/test-phase4d-document-view-model.mjs` | D | Document model test. |
| `scripts/test-phase4e-thermal-receipts.mjs` | D | Thermal presentation test. |
| `scripts/test-phase4f-a4-templates.mjs` | D | A4 presentation test. |
| `scripts/test-v1-pos-settings-compat.mjs` | D | Presentation/POS compatibility test. |
| `scripts/test-runtime-presentation-parity.mjs` | D | Runtime presentation parity test. |
| `src/components/print/A4Document.tsx` | A | Canonical A4 renderer changes. |
| `src/components/print/DocumentPreview.tsx` | A | Canonical preview wrapper. |
| `src/components/print/ThermalReceipt.tsx` | A | Canonical thermal renderer changes. |
| `src/index.css` | A | Document renderer styles. |
| `src/lib/invoices/documentViewAdapters.ts` | A | Presentation adapters, including later POS/detail consumers. |
| `src/lib/invoices/documentViewModel.ts` | A | Canonical document view model. |
| `src/lib/invoices/presentationSettings.ts` | A | Presentation normalization/serialization. |
| `src/lib/invoices/runtimePresentation.ts` | A | Runtime settings resolution. |
| `src/lib/invoices/visibleTotals.ts` | A | Shared visible-total calculation. |
| `src/localization/documents.ts` | A | Arabic/bilingual document-language behavior. |
| `src/localization/locales/ar-SA/documents.json` | A | Arabic document copy. |
| `src/localization/locales/en/documents.json` | A | English document copy. |
| `src/pages/branch/InvoiceSettingsPage.tsx` | A | Presentation settings UI. |
| `docs/invoice-presentation-architecture.md` | D | Presentation architecture documentation. |
| `src/types/database.ts` | A+B | Disjoint presentation-settings and v2 invoice/type hunks; split only by hunk. |
| `supabase/functions/zatca-submit/index.ts` | B+C | V2 processor plus disabled-mode legacy/safe-status routing; keep whole. |
| `supabase/functions/_shared/zatca/cleared_artifact.mjs` | B | Returned-cleared-artifact parser. |
| `scripts/sql/zatca-phase2-finalization-v2/01_artifact_lifecycle.sql` | B | V2 runtime/artifact lifecycle schema. |
| `scripts/sql/zatca-phase2-finalization-v2/02_chain_allocator.sql` | B | Serialized chain allocator. |
| `scripts/sql/zatca-phase2-finalization-v2/03_claims_and_idempotency.sql` | B | Claims, leases, persistence, idempotency. |
| `scripts/sql/zatca-phase2-finalization-v2/04_lock_compliance_fields.sql` | B | Protected write/grant lock. |
| `scripts/sql/zatca-phase2-finalization-v2/05_capabilities_and_status.sql` | B+C | Capability guard and safe v2/legacy status contract. |
| `src/lib/invoices/invoiceReadContract.ts` | C | Canonical authenticated invoice allowlist. |
| `src/lib/zatca/qrSelector.ts` | C | Stored-output-only QR selection. |
| `src/lib/zatca/submission.ts` | B+C | Client v2 contract, safe status, and disabled-mode routing. Keep whole. |
| `src/pages/invoices/InvoiceDetailPage.tsx` | A+C | Presentation renderer migration and safe invoice/status reads. Keep whole. |
| `src/pages/pos/POSPage.tsx` | A+B+C | Presentation, pre-checkout capability mode, and safe output flow. Keep whole. |
| `src/pages/print/ReceiptPrintPage.tsx` | A+C | Presentation renderer migration and safe invoice/status reads. Keep whole. |
| `src/localization/locales/ar-SA/pos.json` | C | Finalization/attention/retry UI copy. |
| `src/localization/locales/en/pos.json` | C | Finalization/attention/retry UI copy. |
| `scripts/sql/zatca-phase2-finalization-v2/04a_safe_invoice_read_surface.sql` | C | Authenticated safe-column grant boundary. |
| `scripts/fixtures/zatca/standard-cleared-returned.xml` | D | Cleared-artifact test fixture. |
| `scripts/test-zatca-phase2-finalization-v2.mjs` | D | V2 deterministic test. |
| `scripts/test-zatca-invoice-read-surface.mjs` | D | Safe read-surface test. |
| `scripts/test-zatca-coordinated-deployment.mjs` | D | Disabled-mode routing/deployment test. |
| `scripts/test-zatca-release-package.mjs` | D | Operator-package and fail-closed gate test. |
| `scripts/test-zatca-phase2-finalization.mjs` | D | Superseded-contract regression evidence. |
| `scripts/sql/zatca-phase2-finalization-v2/00_hosted_preflight.sql` | D | Read-only hosted baseline capture. |
| `scripts/sql/zatca-phase2-finalization-v2/06_verification.sql` | D | Fail-closed 59-row verifier. |
| `scripts/sql/zatca-phase2-finalization-v2/07_rollback_plan.md` | D | Rollback documentation. |
| `scripts/sql/zatca-phase2-finalization-v2/08_allocator_two_session_fixture.md` | D | External concurrency fixture instructions. |
| `scripts/sql/zatca-phase2-finalization-v2/CONTRACT.md` | D | V2 contract documentation. |
| `scripts/sql/zatca-phase2-finalization-v2/COORDINATED_DEPLOYMENT.md` | D | Coordinated rollout proof. |
| `scripts/sql/zatca-phase2-finalization-v2/INVOICE_READ_CONTRACT.md` | D | Safe read contract documentation. |
| `scripts/sql/zatca-phase2-finalization-v2/fixtures/allocator_session_a.sql` | D | Two-session fixture A. |
| `scripts/sql/zatca-phase2-finalization-v2/fixtures/allocator_session_b.sql` | D | Two-session fixture B. |
| `scripts/sql/zatca-phase2-finalization-v2/fixtures/invoice_read_surface_fixture.sql` | D | Disposable grants/RLS fixture. |
| `scripts/sql/zatca-phase2-finalization-v2/operator/verify_flags_false.sql` | D | Read-only post-step flag guard. |
| `scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh` | D | One-file-at-a-time SQL/log wrapper. |
| `scripts/sql/zatca-phase2-finalization-v2/operator/capture_protected_baseline.sh` | D | Git/Edge/Vercel/database baseline capture. |
| `scripts/sql/zatca-phase2-finalization-v2/RELEASE_PACKAGING_AND_MAINTENANCE_RUNBOOK.md` | D | This operator runbook. |
| `scripts/sql/zatca-phase2-finalization/01_add_finalization_state.sql` | B | Superseded unsafe schema retained for audit only; never execute. |
| `scripts/sql/zatca-phase2-finalization/02_lock_compliance_fields.sql` | B | Superseded unsafe lock migration retained for audit only; never execute. |
| `scripts/sql/zatca-phase2-finalization/03_verification.sql` | D | Superseded verifier evidence; never use for release. |
| `scripts/sql/zatca-phase2-finalization/04_rollback_plan.md` | D | Superseded rollback documentation. |
| `scripts/sql/zatca-phase2-finalization/CONTRACT.md` | D | Superseded contract documentation. |
| `scripts/sql/zatca-phase2-finalization/SUPERSEDED_UNSAFE_DO_NOT_EXECUTE.md` | D | Explicit safety marker. |

## 3. Proposed commit plan

Do not stage or commit from this runbook automatically. Use interactive hunk
review only after the file table and dependency findings are approved.

### Commit 1 — presentation foundations

Message:

```text
feat(invoices): unify presentation settings and document renderers
```

Files:

- `scripts/audit-phase4c-invoice-settings-ui.mjs`
- `scripts/audit-phase4d-document-view-model.mjs`
- `scripts/audit-phase4e-thermal-receipts.mjs`
- `scripts/audit-phase4f-a4-templates.mjs`
- `scripts/audit-phase4g-invoice-release-readiness.mjs`
- `scripts/audit-phase5b-release-scope.mjs`
- `scripts/sql/invoice-settings-ux/01_extend_presentation_settings_rpc.sql`
- `scripts/sql/invoice-settings-ux/02_verification.sql`
- `scripts/sql/invoice-settings-ux/03_rollback_plan.md`
- `scripts/sql/invoice-settings-ux/README.md`
- `scripts/sql/invoice-settings-ux/06_rollback_plan.md`
- `scripts/sql/invoice-settings-ux/06_stabilize_v1_settings_contract.sql`
- `scripts/sql/invoice-settings-ux/07_verify_v1_settings_contract.sql`
- `scripts/sql/invoice-settings-ux/CONTRACT.md`
- `scripts/test-invoice-settings-ux-redesign.mjs`
- `scripts/test-phase4d-document-view-model.mjs`
- `scripts/test-phase4e-thermal-receipts.mjs`
- `scripts/test-phase4f-a4-templates.mjs`
- `scripts/test-v1-pos-settings-compat.mjs`
- `scripts/test-runtime-presentation-parity.mjs`
- `src/components/print/A4Document.tsx`
- `src/components/print/DocumentPreview.tsx`
- `src/components/print/ThermalReceipt.tsx`
- `src/index.css`
- `src/lib/invoices/documentViewAdapters.ts`
- `src/lib/invoices/documentViewModel.ts`
- `src/lib/invoices/presentationSettings.ts`
- `src/lib/invoices/runtimePresentation.ts`
- `src/lib/invoices/visibleTotals.ts`
- `src/localization/documents.ts`
- `src/localization/locales/ar-SA/documents.json`
- `src/localization/locales/en/documents.json`
- `src/pages/branch/InvoiceSettingsPage.tsx`
- `docs/invoice-presentation-architecture.md`
- only the `src/types/database.ts` `InvoicePresentationSettings` hunk around
  current lines 1257–1265; do not include the finalization hunks.

Dependency: none.

Run:

```text
npm run build
node scripts/test-invoice-settings-ux-redesign.mjs
node scripts/test-phase4d-document-view-model.mjs
node scripts/test-phase4e-thermal-receipts.mjs
node scripts/test-phase4f-a4-templates.mjs
node scripts/test-runtime-presentation-parity.mjs
node scripts/test-v1-pos-settings-compat.mjs
```

Reversion: independently revertible before commit 3. Commit 3 consumes these
model/renderer APIs, so reverting commit 1 after commit 3 requires reverting or
forward-fixing commit 3 in the same change.

### Commit 2 — disabled v2 server infrastructure

Message:

```text
feat(zatca): add disabled immutable-finalization v2 infrastructure
```

Files:

- `supabase/functions/zatca-submit/index.ts` whole file;
- `supabase/functions/_shared/zatca/cleared_artifact.mjs`;
- migrations `01`, `02`, `03`, `04`, and `05`;
- `src/types/database.ts` current v2 hunks: `ZatcaFinalizationStatus`,
  database enum, and invoice finalization/artifact fields (current lines around
  14, 480, and 1187–1196).

The Edge file is deliberately not split: its v2 router, runtime capability
probe, disabled legacy fallback, audit/rate-limit path, and safe status path
must ship as one server contract.

Dependency: none at Git/build time; deployment still requires the coordinated
order in this document.

Run:

```text
npm run build
node scripts/test-zatca-phase2-finalization-v2.mjs
node scripts/test-zatca-coordinated-deployment.mjs
```

Reversion: the source commit can be reverted before commit 3 or deployment.
Applied database migrations are additive audit infrastructure and are not
dropped as a routine rollback. After commit 3, the frontend depends on this
Edge contract.

### Commit 3 — safe browser contract and integrated pages

Message:

```text
feat(zatca): enforce safe invoice reads and coordinated legacy compatibility
```

Files:

- `04a_safe_invoice_read_surface.sql`;
- `src/lib/invoices/invoiceReadContract.ts`;
- `src/lib/zatca/qrSelector.ts`;
- `src/lib/zatca/submission.ts` whole file;
- `src/pages/invoices/InvoiceDetailPage.tsx` whole file;
- `src/pages/pos/POSPage.tsx` whole file;
- `src/pages/print/ReceiptPrintPage.tsx` whole file;
- both POS localization JSON files.

Dependency: commits 1 and 2. The three page files are kept whole because their
presentation renderer migrations and safe QR/status reads share imports,
derived state, print gating, and JSX. Splitting those hunks would create
unbuildable intermediate pages.

Run:

```text
npm run build
node scripts/test-zatca-invoice-read-surface.mjs
node scripts/test-zatca-coordinated-deployment.mjs
node scripts/test-v1-pos-settings-compat.mjs
```

Reversion: independently route-revertible only before `04a`. After `04a`, an
old frontend cannot be admitted; use a safe-reader forward fix.

### Commit 4 — release evidence and operator package

Message:

```text
test(zatca): package coordinated deployment evidence and runbook
```

Files:

- `package.json`
- `scripts/fixtures/zatca/standard-cleared-returned.xml`
- `scripts/test-zatca-phase2-finalization-v2.mjs`
- `scripts/test-zatca-invoice-read-surface.mjs`
- `scripts/test-zatca-coordinated-deployment.mjs`
- `scripts/test-zatca-release-package.mjs`
- `scripts/test-zatca-phase2-finalization.mjs`
- `scripts/sql/zatca-phase2-finalization-v2/00_hosted_preflight.sql`
- `scripts/sql/zatca-phase2-finalization-v2/06_verification.sql`
- `scripts/sql/zatca-phase2-finalization-v2/07_rollback_plan.md`
- `scripts/sql/zatca-phase2-finalization-v2/08_allocator_two_session_fixture.md`
- `scripts/sql/zatca-phase2-finalization-v2/CONTRACT.md`
- `scripts/sql/zatca-phase2-finalization-v2/COORDINATED_DEPLOYMENT.md`
- `scripts/sql/zatca-phase2-finalization-v2/INVOICE_READ_CONTRACT.md`
- `scripts/sql/zatca-phase2-finalization-v2/RELEASE_PACKAGING_AND_MAINTENANCE_RUNBOOK.md`
- `scripts/sql/zatca-phase2-finalization-v2/fixtures/allocator_session_a.sql`
- `scripts/sql/zatca-phase2-finalization-v2/fixtures/allocator_session_b.sql`
- `scripts/sql/zatca-phase2-finalization-v2/fixtures/invoice_read_surface_fixture.sql`
- `scripts/sql/zatca-phase2-finalization-v2/operator/verify_flags_false.sql`
- `scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh`
- `scripts/sql/zatca-phase2-finalization-v2/operator/capture_protected_baseline.sh`
- `scripts/sql/zatca-phase2-finalization/01_add_finalization_state.sql`
- `scripts/sql/zatca-phase2-finalization/02_lock_compliance_fields.sql`
- `scripts/sql/zatca-phase2-finalization/03_verification.sql`
- `scripts/sql/zatca-phase2-finalization/04_rollback_plan.md`
- `scripts/sql/zatca-phase2-finalization/CONTRACT.md`
- `scripts/sql/zatca-phase2-finalization/SUPERSEDED_UNSAFE_DO_NOT_EXECUTE.md`

Dependency: commits 1–3.

Run all local gates listed in section 13.

Reversion: tests/docs are independently revertible, but reverting the stricter
`06` verifier or operator guards weakens the release gate and is not approved
for the production rollout.

## 4. Mixed-file dependency findings

| File | Presentation hunks | V2 finalization hunks | Safe-read/compatibility hunks | Decision |
|---|---|---|---|---|
| `POSPage.tsx` | Document adapter/imports and ReceiptView/A4/thermal integration around current imports 30–43 and renderer body 486–752 | Pre-checkout capability mode, finalize/retry/output flow around 1953–2179 and 2403–2459 | Stored output and no client-generated production QR in the same flow | Whole file in commit 3; depends on commits 1 and 2. |
| `InvoiceDetailPage.tsx` | A4/Thermal model imports, print CSS/model construction/render integration | Safe output status supplies finalization state | `INVOICE_SAFE_SELECT`, safe status, removal of raw QR read/write | Whole file in commit 3. |
| `ReceiptPrintPage.tsx` | Stored-document adapter and canonical thermal renderer | Safe output status supplies finalization state | Safe invoice select, safe production status, sandbox status, print gate | Whole file in commit 3. |
| `submission.ts` | None | V2 capability/finalize/submit result types | Legacy checkout mode, pre-schema safe status, actionless fallback request | Whole file in commit 3; must match commit 2 Edge. |
| `database.ts` | Presentation settings type changes near 1257–1265 | Finalization enum/invoice fields near 14, 480, 1187–1196 | None | Disjoint hunk split is safe. |
| document locale files | All document-title/seller/buyer/date/debit-note copy | None | None | Commit 1. |
| POS locale files | None | Attention/finalization/retry copy | Same strings are used by coordinated compatibility | Commit 3 whole. |
| `zatca-submit/index.ts` | None | Artifact/claim/network v2 processor | Legacy fallback, capabilities, status, version router | Commit 2 whole; never split. |
| `package.json` | None | None | Test script registrations only | Commit 4 whole. |

## 5. Protected baseline capture

### Operator prerequisites

- Clean checkout of the reviewed release commit and expected branch.
- `git`, `jq`, PostgreSQL `psql`, `shasum`, Supabase CLI, and Vercel CLI.
- Authenticated Supabase/Vercel CLIs using native credential storage or
  protected environment variables.
- A libpq service entry and protected password file. Do not put a database URL
  containing a password on the command line.
- A release evidence directory with access limited to the release operators.

Set only non-secret identifiers and confirmations:

```bash
export PGSERVICE='dafra-production'
export SUPABASE_PROJECT_REF='REPLACE_WITH_PROJECT_REF'
export VERCEL_PRODUCTION_URL='https://REPLACE_WITH_CURRENT_PRODUCTION_DEPLOYMENT'
export RELEASE_LOG_DIR='/REPLACE/WITH/PROTECTED/RELEASE-EVIDENCE'
export EDGE_KILL_SWITCH_CONFIRMED_FALSE='YES'
export EXPECTED_RELEASE_COMMIT='REPLACE_WITH_REVIEWED_COMMIT'
export EXPECTED_RELEASE_BRANCH='feature/invoice-settings-ux-redesign'
```

An authorized operator must inspect the Edge configuration and confirm only the
boolean statement `ZATCA_IMMUTABLE_FINALIZATION_ENABLED=false`. Do not copy or
display the secrets list.

Run:

```bash
bash scripts/sql/zatca-phase2-finalization-v2/operator/capture_protected_baseline.sh
```

The capture contains:

- current Git commit, branch, and worktree state;
- reviewed local source hashes;
- hosted `zatca-submit` version/status timestamps;
- current Vercel production deployment inspection;
- operator-confirmed false Edge kill switch;
- hosted protected function definitions/hashes;
- invoice count and ID/update fingerprint;
- invoice policies, table/column grants, effective privileges, and triggers;
- existing/partial v2 objects and functions;
- database feature-flag state when the runtime exists.

Stop unless two operators sign off that protected hashes are `MATCH`, no
unexpected policy/grant/trigger drift exists, the invoice fingerprint is
explained, and all existing flags are absent or false.

## 6. Edge-first deployment runbook

### Prepare an exact rollback source

Record the Git commit known to have produced the currently hosted Edge version:

```bash
export PREVIOUS_EDGE_COMMIT='REPLACE_WITH_VERIFIED_COMMIT'
export EDGE_ROLLBACK_DIR='/REPLACE/WITH/PROTECTED/edge-rollback-source'
mkdir -p "${EDGE_ROLLBACK_DIR}"
git archive "${PREVIOUS_EDGE_COMMIT}" \
  supabase/config.toml \
  supabase/functions/zatca-submit \
  supabase/functions/_shared \
  | tar -x -C "${EDGE_ROLLBACK_DIR}"
shasum -a 256 \
  "${EDGE_ROLLBACK_DIR}/supabase/functions/zatca-submit/index.ts" \
  > "${RELEASE_LOG_DIR}/previous_edge_source_hash.txt"
```

Optionally download the hosted source for forensic comparison:

```bash
export EDGE_DOWNLOAD_DIR='/REPLACE/WITH/PROTECTED/edge-download'
mkdir -p "${EDGE_DOWNLOAD_DIR}"
(
  cd "${EDGE_DOWNLOAD_DIR}"
  supabase functions download zatca-submit \
    --project-ref "${SUPABASE_PROJECT_REF}" \
    --use-api
)
```

Do not treat a download as a complete rollback bundle unless all shared modules
and configuration used by that version are also present.

### Predeploy checks

- [ ] Baseline capture approved.
- [ ] Hosted Edge kill switch confirmed false.
- [ ] Database master/simplified/standard flags absent or false.
- [ ] Approved old-client canary invoice/branch identified.
- [ ] Rollback source and prior hosted function version recorded.
- [ ] Local tests and Edge TypeScript syntax pass.

Stop if any item is incomplete.

### Deploy command — execute only in the authorized Edge change

```bash
supabase functions deploy zatca-submit \
  --project-ref "${SUPABASE_PROJECT_REF}" \
  --use-api
```

Immediately capture the new version:

```bash
supabase functions list \
  --project-ref "${SUPABASE_PROJECT_REF}" \
  --output json \
  | tee "${RELEASE_LOG_DIR}/edge_after_deploy.json"
```

### Authenticated checks

Set protected session values without echoing them:

```bash
export SUPABASE_FUNCTION_URL="https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/zatca-submit"
export SUPABASE_PUBLISHABLE_KEY='SET_IN_PROTECTED_SHELL'
export SMOKE_USER_JWT='SET_IN_PROTECTED_SHELL'
export SMOKE_BRANCH_ID='APPROVED_BRANCH_UUID'
export SMOKE_INVOICE_ID='APPROVED_CANARY_INVOICE_UUID'
```

Capability must be pre-schema/disabled:

```bash
curl --fail-with-body --silent --show-error \
  "${SUPABASE_FUNCTION_URL}" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${SMOKE_USER_JWT}" \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc \
    --arg branchId "${SMOKE_BRANCH_ID}" \
    '{action:"capabilities",clientVersion:"2.0.0",branchId:$branchId}')" \
  | tee "${RELEASE_LOG_DIR}/edge_capability_pre_schema.json" \
  | jq -e '
      .edgeFunctionVersion == "2.0.0"
      and .schemaVersion == null
      and .databaseFeatureEnabled == false
      and .edgeKillSwitchEnabled == false
      and .immutableFinalizationEnabled == false
      and .legacySubmitAvailable == true
      and .compatible == false
    '
```

Safe status must return the same invoice identity and no raw artifact fields:

```bash
curl --fail-with-body --silent --show-error \
  "${SUPABASE_FUNCTION_URL}" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${SMOKE_USER_JWT}" \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc \
    --arg invoiceId "${SMOKE_INVOICE_ID}" \
    --arg branchId "${SMOKE_BRANCH_ID}" \
    '{action:"status",clientVersion:"2.0.0",invoiceId:$invoiceId,branchId:$branchId}')" \
  | tee "${RELEASE_LOG_DIR}/edge_status_pre_schema.json" \
  | jq -e --arg invoiceId "${SMOKE_INVOICE_ID}" '
      .invoiceId == $invoiceId
      and .contractMode == "legacy"
      and .legacyCompatible == true
      and has("zatca_xml") == false
      and has("zatca_xml_hash") == false
      and has("zatca_signature") == false
      and has("zatca_prev_invoice_hash") == false
    '
```

Versioned v2 finalize must fail safely with HTTP 426. Capture the status
separately and stop unless it is exact:

```bash
http_status="$(
  curl --silent --show-error \
    --output "${RELEASE_LOG_DIR}/edge_finalize_pre_schema.json" \
    --write-out '%{http_code}' \
    "${SUPABASE_FUNCTION_URL}" \
    -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
    -H "Authorization: Bearer ${SMOKE_USER_JWT}" \
    -H 'Content-Type: application/json' \
    --data "$(jq -nc \
      --arg invoiceId "${SMOKE_INVOICE_ID}" \
      --arg branchId "${SMOKE_BRANCH_ID}" \
      '{action:"finalize",clientVersion:"2.0.0",invoiceId:$invoiceId,branchId:$branchId}')"
)"
test "${http_status}" = '426'
jq -e '.code == "FINALIZATION_VERSION_MISMATCH"' \
  "${RELEASE_LOG_DIR}/edge_finalize_pre_schema.json"
```

Actionless legacy submission changes invoice/ZATCA state. Run it only against
the specifically approved canary created for this verification:

```bash
curl --fail-with-body --silent --show-error \
  "${SUPABASE_FUNCTION_URL}" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY}" \
  -H "Authorization: Bearer ${SMOKE_USER_JWT}" \
  -H 'Content-Type: application/json' \
  --data "$(jq -nc \
    --arg invoiceId "${SMOKE_INVOICE_ID}" \
    --arg branchId "${SMOKE_BRANCH_ID}" \
    '{invoiceId:$invoiceId,branchId:$branchId,source:"manual_retry"}')" \
  | tee "${RELEASE_LOG_DIR}/edge_actionless_legacy.json" \
  | jq -e '
      .contractMode == "legacy"
      and (.invoiceStatus == "reported" or .invoiceStatus == "cleared"
        or .invoiceStatus == "pending" or .invoiceStatus == "not_submitted")
    '
```

Also complete one approved sale from the still-old production frontend and
confirm its actionless request is accepted. Stop on any mandatory client-version
rejection, authorization difference, duplicate submission, or unexpected v2
row/artifact.

### Edge rollback

If any Edge verification fails:

1. Stop new canary operations; do not deploy the frontend or schema.
2. From the prepared rollback directory:

```bash
(
  cd "${EDGE_ROLLBACK_DIR}"
  supabase functions deploy zatca-submit \
    --project-ref "${SUPABASE_PROJECT_REF}" \
    --use-api
)
supabase functions list \
  --project-ref "${SUPABASE_PROJECT_REF}" \
  --output json \
  | tee "${RELEASE_LOG_DIR}/edge_after_rollback.json"
```

3. Repeat an old-client actionless canary.
4. Keep the incident open until hosted version and behavior match the baseline.

## 7. Frontend preview and pre-schema runbook

Build and run the local gates:

```bash
npm ci
npm run build
npm run test:zatca-finalization-v2
npm run test:zatca-invoice-read-surface
npm run test:zatca-coordinated-deployment
```

Confirm the Vercel Preview environment has the same required public
configuration and secret-name inventory as Production, points to the reviewed
current backend for this canary, and differs only where intentionally recorded.
Do not print secret values. Then create one prebuilt preview; do not use
`--prod`:

```bash
vercel pull --yes --environment=preview
vercel build
vercel deploy --prebuilt --yes \
  | tee "${RELEASE_LOG_DIR}/frontend_preview_deploy.txt"
export FRONTEND_PREVIEW_URL="$(tail -n 1 "${RELEASE_LOG_DIR}/frontend_preview_deploy.txt")"
vercel inspect "${FRONTEND_PREVIEW_URL}" \
  | tee "${RELEASE_LOG_DIR}/frontend_preview_inspect.txt"
```

Against the current pre-v2 database and verified new Edge:

- [ ] Login succeeds.
- [ ] Invoice List loads and filters.
- [ ] Invoice Detail loads a historical and a new invoice.
- [ ] ReceiptPrintPage loads from direct URL.
- [ ] Historical A4 renders.
- [ ] POS capability request selects `checkoutMode=legacy` before checkout.
- [ ] One approved canary sale records one payment and one invoice.
- [ ] Post-sale receipt uses the legacy-safe Edge QR/status.
- [ ] Credit-note flow remains available.
- [ ] Browser network log has no `invoices?select=*`.
- [ ] Browser invoice requests contain only `INVOICE_SAFE_SELECT` fields.
- [ ] No request selects raw v2 or legacy server-owned QR/XML/hash/signature
      fields.

Stop on any failure. The static read-surface test is necessary but does not
replace browser network inspection.

After preview approval, the separate authorized frontend change may promote the
reviewed deployment:

```bash
vercel promote "${FRONTEND_PREVIEW_URL}"
vercel inspect "${FRONTEND_PREVIEW_URL}" \
  | tee "${RELEASE_LOG_DIR}/frontend_after_promote.txt"
```

Before schema migration, frontend routing can be rolled back safely:

```bash
vercel rollback "${VERCEL_PRODUCTION_URL}"
vercel rollback status \
  | tee "${RELEASE_LOG_DIR}/frontend_rollback_status.txt"
```

After `04a`, do not route to the old frontend.

## 8. Maintenance-window checklist

Every checkbox is a stop gate. Two operators should record initials and UTC
time next to each item in the release ticket.

### Pause and identify

- [ ] Announce billing pause to every branch/station.
  - Stop if any branch has not acknowledged.
- [ ] Block new billing traffic at the application/gateway layer.
  - Stop if a new checkout can still start.
- [ ] Confirm no checkout/payment request is in progress.
  - Let an in-flight transaction finish or fail cleanly; never interrupt it.
- [ ] Confirm Edge 2.0.0 is healthy and kill switch false.
  - Stop on a mismatched version or true/unknown switch.
- [ ] Confirm the promoted frontend deployment is the reviewed build.
  - Stop on a deployment/commit mismatch.

### Drain clients

- [ ] Every operator closes every Kubri tab/window, including POS, invoice,
      receipt, A4, and background tabs.
- [ ] Station ledger records branch, station, operator, closed-at UTC, and
      browser process closed.
- [ ] Long-running Electron/browser instances are fully exited.
- [ ] No stale application request appears in Edge/PostgREST logs during the
      quiet-period observation.
- [ ] No station is reopened yet.

Use this ledger; one row is required for every station:

| Branch | Station/device | Operator | All Kubri tabs closed UTC | Browser/Electron process exited | Fresh bundle hash after reopen | Direct receipt URL passed | Operator initials |
|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  |

Stop if any station cannot be positively accounted for. CDN invalidation is not
client drain.

### Protected preflight

- [ ] Run `00` through the one-step wrapper:

```bash
export EXPECTED_RELEASE_COMMIT='REPLACE_WITH_REVIEWED_COMMIT'
export EXPECTED_RELEASE_BRANCH='feature/invoice-settings-ux-redesign'
export MAINTENANCE_APPROVED='YES'
export CLIENT_DRAIN_CONFIRMED='YES'
export EDGE_KILL_SWITCH_CONFIRMED_FALSE='YES'
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 00
```

- [ ] Compare invoice fingerprint with the protected baseline and explain any
      legitimate interim invoices.
- [ ] Protected hashes are `MATCH`.
- [ ] Policies, grants, and triggers match the reviewed contract.
- [ ] No partial/unexpected v2 object exists.

Stop on any drift.

### Apply one file at a time

Run only one command, review its log and all-false guard, then authorize the
next:

```bash
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 01
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 02
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 03
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 04
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 04a
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 05
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 06
```

After every `01`–`06` invocation:

- [ ] Command exited zero.
- [ ] SQL log contains no error, warning requiring review, or timeout.
- [ ] The all-false guard exited zero.
- [ ] Database master=false.
- [ ] Simplified=false.
- [ ] Standard=false.
- [ ] Edge kill switch remains false.
- [ ] No unexpected application traffic occurred.

`06` itself raises and exits nonzero unless it produces exactly 59 named rows:
54 PASS, 5 REVIEW, 0 FAIL. Stop immediately on any nonzero result.

### Fresh-client verification and reopen

- [ ] Open one new browser process with no restored tabs.
- [ ] Navigate freshly to the production URL.
- [ ] Confirm the HTML references the new hashed JS bundle.
- [ ] Confirm capability response reports Edge/client/schema 2.0.0/2 and all
      flags false.
- [ ] Run every smoke test in section 10.
- [ ] Complete all five external REVIEW gates.
- [ ] Open one station per branch and repeat login/direct receipt/POS readiness.
- [ ] Reopen billing only after release lead and database operator both approve.

## 9. Exact SQL command package

The wrapper:

- uses `psql -X` and `ON_ERROR_STOP=1`;
- sets a 5-second lock timeout and 10-minute statement timeout by default;
- captures a SHA-256 and complete output log per file;
- refuses a dirty or unexpected Git checkout;
- requires maintenance/client-drain/kill-switch confirmations for mutations;
- runs `verify_flags_false.sql` after every mutating step;
- stops under shell `errexit` and `pipefail`.

Exact commands and order:

```bash
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 00
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 01
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 02
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 03
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 04
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 04a
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 05
bash scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 06
```

Never run the superseded directory. Never set a feature flag in this package.

## 10. Post-deployment smoke tests while flags remain false

| Test | Required result/evidence |
|---|---|
| Login | Fresh session authenticates; correct tenant/branch. |
| POS sale | Capability chooses legacy before checkout; sale completes. |
| Payment once | Exactly one payment/checkout identity; refresh does not duplicate. |
| Invoice List | New sale appears through safe columns. |
| Invoice Detail | New and historical rows load without column-permission errors. |
| Historical receipt | Loads and uses safe status; QR only when reported/cleared. |
| Historical A4 | Loads through canonical document model and safe status. |
| Direct receipt URL | Fresh navigation loads new hashed application bundle. |
| Credit note | Creates once, links original, and follows actionless legacy submission. |
| Dashboard/reports | Existing aggregates load and totals remain consistent. |
| Cross-branch RLS | Branch-scoped user cannot read or status another branch's invoice. |
| Safe output state | Exact invoice identity; no XML/hash/signature/counter/PIH/claim/raw response fields. |
| Legacy ZATCA submission | Actionless request accepted while database master=false. |
| Raw-v2 browser denial | Raw column and `select('*')` requests fail; safe selector succeeds. |
| Disabled infrastructure | Chain heads, reservations, and capability rows remain empty except an explicitly explained capability acknowledgement created by the new client; no artifact row is populated. |
| Flags | Database master/simplified/standard=false and Edge kill switch=false. |
| Verifier | 59 total: 54 PASS, 5 REVIEW, 0 FAIL; all REVIEW evidence attached. |

If a smoke sale creates a capability acknowledgement while flags are false,
record and explain it. It is not a chain reservation or finalization artifact.

## 11. Rollback and forward-fix matrix

| Failure | Exact response |
|---|---|
| Edge verification failure | Stop before frontend/schema; redeploy prepared prior Edge source, recapture version, repeat old-client canary. |
| Frontend preview/promotion failure before schema | `vercel rollback`, verify rollback status and old app, do not start maintenance SQL. |
| Migration `01`–`04` failure | Keep billing closed and flags false; preserve additive objects; diagnose the exact failed transaction and forward-fix/re-run only after review. |
| `04a` failure | Keep billing closed. Do not proceed to `05`; repair grant/preflight drift. Never mask failure with broad SELECT. |
| `05` failure | Keep billing closed. Preserve `04a`; safe-reader frontend/Edge remain required. Forward-fix capability/status SQL. |
| Verifier failure | Keep billing closed; preserve all artifacts/schema; resolve named FAIL or unexpected count and rerun `06`. |
| POS failure | Block checkout; confirm capability/mode decision precedes `pos_checkout`; inspect one-payment invariant. Forward-fix. |
| Invoice Detail failure | Verify build hash, safe selector, RLS, grants, status identity. Forward-fix the safe frontend/API. |
| Receipt failure | Verify new direct route, safe selector/status, historical legacy QR gate. Forward-fix. |
| Stale browser detected | Keep that station closed, terminate the browser process, reopen a fresh navigation, verify hashed bundle and capability version. |
| Unexpected raw-column access | Treat as security stop. Keep billing closed, preserve logs, identify source/build, remove access by forward fix. |

Authenticated table-wide SELECT or protected-column grants are not a normal
rollback. Do not regenerate invoices, clear artifacts, change chain state,
delete responses, or reverse completed payments.

## 12. Estimated maintenance steps

Plan for four gated phases, not a guessed elapsed time:

1. Five pause/identity gates.
2. Five client-drain gates.
3. Eight SQL invocations plus seven post-mutation flag reviews.
4. Sixteen smoke/security checks plus two-person reopen approval.

That is approximately 43 recorded decisions/checks. Rehearse the procedure in a
production-equivalent environment to measure duration; do not shorten the live
window by combining SQL steps or skipping evidence.

## 13. Local package validation and deployment decision

Run before proposing commits:

```bash
bash -n scripts/sql/zatca-phase2-finalization-v2/operator/capture_protected_baseline.sh
bash -n scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh
npm run test:zatca-finalization-v2
npm run test:zatca-invoice-read-surface
npm run test:zatca-coordinated-deployment
npm run test:zatca-release-package
npm run build
git diff --check
```

Decision:

- **Ready to form the four proposed commits and rehearse the operator package.**
- **Ready for an authorized coordinated production window only after protected
  baseline approval and all prerequisites above.**
- **Not ready for zero-downtime `04a`, schema-only deployment, stale-client
  admission, broad grant restoration, or v2 feature enablement.**
