# Atomic simplified checkout v2

Status: implemented locally, disabled by default, not deployed.

This extension replaces the buyer-visible simplified checkout split with one
authenticated Edge action and a two-phase internal protocol. It does not
change standard clearance gating and does not select, enqueue, or mutate any
historical invoice.

## Sequence

```text
POS
 │ persist idempotency key + fingerprint locally
 │ POST checkout_simplified
 ▼
Edge ── authenticate JWT; load active user_profiles; authorize branch
 │
 │ prepare_zatca_atomic_checkout_v2
 ▼
PostgreSQL ── lock branch/chain; create short-lived private intent
 │             run authoritative commercial RPC in a savepoint
 │             capture exact snapshot; roll all preview writes back
 │
 ▼
Edge ── build from prepared snapshot; sign once; verify hash/identity
 │       store private candidate artifact idempotently
 │
 │ commit_zatca_atomic_checkout_v2 (authenticated caller transaction)
 ▼
PostgreSQL ── re-run authoritative commercial validation
               compare exact prepared/final snapshots
               commit invoice/items/payments/stock/refund
               commit immutable XML/hash/signature/QR + UUID/counter/PIH
               commit chain reservation/head + outbox + idempotent receipt
               COMMIT
 │
 ▼
Edge ── return safe complete receipt; schedule waitUntil outbox attempt
 │
 ▼
POS ── render returned snapshot; render stored QR; request current-view print

Cron ── durable outbox claim ── ZATCA ── append evidence ── apply result
```

The final RPC is the only transaction that makes a sale buyer-visible. If its
artifact, chain, outbox, payment, stock, or commercial validation fails, that
transaction rolls back completely.

## SQL objects and required installation order

The protected commercial functions must be aligned and verified before the
atomic migration. The exact disabled installation sequence is:

```bash
scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 11a
scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 11b
scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 12
scripts/sql/zatca-phase2-finalization-v2/operator/run_sql_step.sh 13
```

Step `11a` accepts only the reviewed production or release-canonical function
hashes and installs deterministic compatibility definitions. Step `11b` is
read-only and must report the aligned hashes
`68d6d28ff7ed53ad8b79180b3e26592b` and
`ea38d6800970cf51594e27c11c376ebd`. Step `12` accepts only those aligned
hashes, installs the private reserved-ID context, and asserts patched hashes
`447dc2f026ae6f488fa434079759b75e` and
`acbf207e42d0a41cb81f09e9859e8fb1`. Step `13` grants authenticated SELECT on
`pos_sessions` without adding or widening an RLS policy.

| Object | Purpose |
|---|---|
| `zatca_finalization_runtime.atomic_simplified_checkout_enabled` | Global rollout switch, false by default. |
| `zatca_atomic_checkout_branch_gates_v2` | Explicit canary/branch gate, false by default. |
| `zatca_atomic_checkout_intents_v2` | Private short-lived preparation, candidate artifact, immutable receipt, and idempotency record. |
| `zatca_atomic_checkout_one_active_branch_v2` | One active preparation per tenant/branch. |
| `zatca_atomic_checkout_chain_position_v2` | No duplicate prepared/committed ZATCA chain position. |
| `prepare_zatca_atomic_checkout_v2` | Authoritative non-issued preparation and exact preview snapshot. |
| `claim_zatca_atomic_checkout_signing_v2` | Short DB-owned lease allowing only one Edge invocation to sign an intent. |
| `store_zatca_atomic_checkout_artifact_v2` | Idempotently stores the once-signed private candidate. |
| `commit_zatca_atomic_checkout_v2` | One final business/artifact/chain/outbox commit and safe receipt response. |
| `get_zatca_atomic_checkout_result_v2` | Exact committed replay, including after a rollout pause. |
| `expire_zatca_atomic_checkout_intents_v2` | Bounded cleanup for expired non-issued intents. |
| `zatca_reporting_response_evidence_v2` | Append-only sanitized ZATCA response evidence. |
| `append_zatca_reporting_response_evidence_v2` | Durably records HTTP/status/code/outcome evidence first. |
| `apply_zatca_reporting_response_evidence_v2` | Applies an already-recorded evidence row to invoice/outbox state. |
| `get_zatca_output_state_v2` | Complete simplified-artifact print gate plus safe reporting display state. |

The intent has unique constraints for branch/idempotency key, invoice ID,
invoice UUID, invoice number, active branch preparation, and branch chain
position. Once set, its identity, snapshot, candidate XML/hash/signature/QR,
and receipt cannot change. A short signing lease prevents concurrent duplicate
requests from signing the same prepared snapshot twice; a crashed signer can
be safely reclaimed only after its lease expires.

## Security model

- The Edge request requires a valid authenticated session.
- Edge loads the caller's active `public.user_profiles` row; JWT metadata is
  not treated as the tenant/branch authority.
- Branch users are restricted to their active profile branch. Tenant roles are
  restricted to their own tenant.
- The prepared branch must equal the Edge-authorized branch before credentials
  are loaded or an artifact is signed.
- Preparation and candidate storage are service-role-only. Intents, candidate
  XML, signatures, and response evidence have no browser table access.
- Final commit is callable by `authenticated`, but requires `auth.uid()` to
  equal the intent actor and requires the unexposed random claim token.
- The caller payload never supplies a counter, PIH, UUID, invoice number,
  artifact, outbox identity, tenant, or authorization scope.
- The response contains a QR and safe receipt data, never XML, signing keys,
  credentials, authorization headers, service tokens, or raw ZATCA responses.

## Failure-state matrix

| Point | Local outcome | Safe next action |
|---|---|---|
| Authentication/branch/readiness fails | No intent or commercial write | Correct access/readiness and retry. |
| Atomic rollout/gate is off and no prior intent exists | `legacy_required`, no write | Existing rollout path only; canary remains isolated. |
| A committed intent exists after flags are paused | Exact committed receipt replay | Render/print; never fall back and duplicate. |
| An uncommitted intent exists after flags are paused | 409 in-progress/paused | Operator resolves rollout; do not create a second sale. |
| Preparation validation fails | Preview savepoint and outer RPC roll back | Correct cart/payment/stock data. |
| Edge/signing fails before candidate storage | Private intent only | Same key retries signing. |
| Edge fails after candidate storage | Private candidate only | Same key skips signing and retries final commit. |
| Intent expires | No buyer-visible sale | Cleanup marks expired; same key remains terminal. |
| Price/customer/stock changes before commit | Final transaction rolls back | Start a new deliberate checkout/key after UI refresh. |
| Chain head changes or predecessor exists | Final transaction rolls back/no overtaking | Complete or expire predecessor, then retry safely. |
| Response is lost after commit | Complete sale/artifact/outbox remains | Same key/fingerprint returns exact receipt. |
| ZATCA slow/unavailable | Receipt remains printable; outbox pending/retryable | Cron retries bounded transient failures. |
| ZATCA definite rejection | Artifact remains immutable; outbox blocked | Display rejected; operator review, no blind retry. |
| Post-send ambiguity | Artifact remains immutable; blocked reconciliation | Reconcile, never blindly resubmit. |
| ZATCA response apply fails | Append-only evidence remains | Reconcile from evidence; do not fabricate a null response. |
| Printer fails | Sale remains committed exactly once | Retry printing the same snapshot/invoice. |
| Simplified QR/artifact missing | Printing blocked | Treat as integrity incident. |
| Standard not cleared | Printing/sharing blocked | Continue existing clearance workflow. |

## Coordinated rollout

No step below is performed by this document or by repository tests.

1. Keep the existing database master, simplified, standard, Edge, and new
   atomic switches false.
2. Apply the guarded `11a` alignment, pass read-only `11b`, apply `12`, then
   apply the POS-session grant in `13`. Verify all flags remain false and no
   historical row or outbox entry was created.
3. Deploy the Edge version containing both the new action and the write-free
   rollout fallback. Verify authentication, exact committed replay, and
   response redaction while the new flag remains false.
4. Deploy the reviewed web frontend. With the atomic flag false it must retain
   existing routing and record no preparation intent. Electron packaging and
   deployment are explicitly excluded from this rollout.
5. Select one explicitly approved branch. Seed/review its chain using the
   existing readiness process; never derive a historical PIH automatically.
6. Enable the existing immutable master and simplified prerequisites while
   leaving the standard flag false, then insert/enable only that branch gate
   and enable the global atomic simplified switch. The capability response is
   fail-closed unless all four database conditions are true.
7. On the canary, prove payment, invoice, stock, committed reservation,
   immutable artifact, outbox, and receipt identities match. Prove first print
   uses the response snapshot with no invoice/status refetch.
8. Observe warm latency for every named timing event, outbox age, transient
   attempts, blocked/reconciliation counts, duplicate-key replays, abandoned
   intents, and printer failures.
9. Exercise slow/unavailable ZATCA and close/refresh immediately after
   checkout. The receipt must remain printable and cron must remain the durable
   reporter.
10. Expand branch gates deliberately only after the canary evidence is
    reviewed.

Rollback is flag-only: disable the global atomic switch and/or branch gate.
Never delete an intent, outbox row, chain reservation, or finalized invoice as
rollback. Exact committed replay is checked before rollout flags, so a response
lost just before rollback still returns the original receipt. An unfinished
intent is blocked rather than diverted into a duplicate legacy checkout.

INV-0826 and INV-0827 remain historical reconciliation incidents. This
migration contains no identifier, backfill, recovery call, or state change for
either document.

## Local release gates

Run:

```bash
npm run test:zatca-atomic-capabilities
npm run test:zatca-atomic-simplified-checkout
npm run test:zatca-finalization-v2
npm run test:zatca-durable-reporting-recovery
npm run test:zatca-outbox-security
npm run test:zatca-phase2-qr
npm run test:zatca-invoice-read-surface
npm run test:phase4e-thermal-receipts
npm run test:zatca-branch-readiness-v2
npm run test:zatca-coordinated-deployment
npm run test:zatca-release-package
npm run build
git diff --check
```

For an isolated local stack whose config is guarded as
`dafra_atomic_disposable_*`, also run:

```bash
DAFRA_ATOMIC_TEST_WORKDIR=/private/tmp/dafra-atomic-disposable.<suffix> \
  npm run test:zatca-atomic-simplified-checkout-runtime
```

The runtime suite exercises PostgreSQL transactions, PostgREST schema cache,
actual anon/authenticated/service-role grants, and two concurrent PostgreSQL
sessions. Electron testing, packaging, and deployment are outside this web
rollout.
