# ZATCA Phase 2 finalization v2 contract

Status: pre-deployment and disabled by default. Nothing in this directory is run
by the application or by repository tests. Schema execution remains blocked
until `00_hosted_preflight.sql` matches the reviewed policy, grant, trigger,
protected-hash, singleton, and historical-invoice contracts.

## Historical policy

Existing rows are never classified, regenerated, or frozen. Their
`zatca_finalization_version`, provenance, lifecycle, and stage stay `NULL`, which
means `legacy_unverified`. The v2 output RPC returns no customer artifact for
those rows. Reconciliation and chain-head seeding are separate controlled work.

The insert initializer runs only while the database release flag is enabled and
only after a recent compatible-client acknowledgement. This preserves disabled
old-code behavior without allowing old clients to create Phase 2 output after
enablement.

## Authoritative artifacts

| Kind | Stage | Stored fields | Customer output |
|---|---|---|---|
| Simplified | `simplified_final` | `zatca_simplified_xml/hash/signature/qr` | Yes, immediately |
| Standard | `standard_provisional` | `zatca_provisional_xml/hash/signature/qr` | Never |
| Standard | `standard_cleared` | retained provisional fields plus `zatca_cleared_xml/hash/signature/qr` and clearance metadata | Yes |
| Legacy | `NULL` | old generic columns, unverified provenance | Unavailable in v2 |

Simplified reporting changes only safe status/response fields. Standard
clearance decodes and validates `clearedInvoice`, checks UUID and invoice ID,
extracts the returned QR and clearance signature, and atomically writes a
separate final artifact. Provisional bytes remain unchanged.

## Chain transaction and recovery

The compliance unit in this repository is the branch. The allocator locks one
`zatca_chain_heads_v2` row and permits at most one unresolved reservation per
branch. The reservation supplies counter and PIH. Persisting a local simplified
or provisional standard artifact calls `commit_zatca_chain_v2` in the same
transaction, so the head advances before another invoice can allocate. A
locally-finalized but unreported simplified invoice therefore participates.

Allocation and reuse require the invoice's current claim token, an unexpired
lease, and a claiming/retrying lifecycle while the invoice row is locked. An
expired claim transfers an open reservation only inside
`claim_zatca_finalization_v2`; the old claimant can no longer allocate, reuse, or
commit. A committed reservation remains immutable and is returned only to its
original token for an idempotent retry.

First-head initialization takes a transaction advisory lock scoped to the
tenant/branch compliance unit, performs a conflict-safe insert, and rereads the
head under `FOR UPDATE`. It never relies on an uncaught primary-key race. If an
earlier invoice has not committed, a concurrent caller receives
`CHAIN_PREDECESSOR_PENDING` and must retry after the predecessor completes.

A branch with any pre-v2 history has no trusted automatic seed. An operator must
establish the last verified counter/hash and call `seed_zatca_chain_head_v2`
with a review reason. Only a genuinely new compliance unit receives the
official first-invoice hash automatically.

## Claims and network identity

Local and network work have distinct tokens, owners, attempts, timestamps, and
leases. Only the current unexpired local token may persist an artifact. Network
submissions use the exact stored artifact and the stable identity
`zatca-v2:<invoice UUID>:<report|clear>:<artifact hash>`; it is a durable local
identity, not an undocumented ZATCA HTTP header.

Request start is committed before `fetch`. A response and resulting status (or
cleared artifact) are persisted by one RPC before Edge returns success. If a
lease expires after request start, or a response cannot be persisted, automatic
replay is prohibited and the invoice becomes `reconciliation_required` when
the database is reachable. Remote status must be reconciled using the stable
UUID/hash identity before any manual recovery.

## Ownership

Authenticated/anonymous roles have no update grant on identity, artifact,
chain, lifecycle, or lease columns. A trigger rejects direct browser writes and
enforces these server invariants:

- v2 never writes generic legacy artifact columns;
- simplified final fields, counter, and PIH never change;
- standard provisional request fields, counter, and PIH never change;
- cleared fields are written only in the provisional-to-cleared transition and
  never change afterward;
- safe errors, warnings, network statuses, and timestamps remain writable by
  approved service RPCs.

Every mutating helper is `SECURITY DEFINER SET search_path = public, pg_temp`,
revoked from PUBLIC/anon/authenticated, and granted to `service_role` only.

Authenticated clients do not select v2 lifecycle, stage, provenance, artifacts,
hashes, signatures, claims, leases, or idempotency data from `invoices`.
Invoice detail, receipt print, and POS obtain safe lifecycle/output metadata and
the permitted final QR through the authenticated Edge status action backed by
`get_zatca_output_state_v2`.

`04a_safe_invoice_read_surface.sql` removes table-wide browser SELECT, grants
the exact 32-column authenticated allowlist in `INVOICE_READ_CONTRACT.md`,
grants anon no invoice columns, and preserves service-role table access. It
does not change rows, policies, or RLS. Its preconditions accept only the
reviewed legacy table grant or an already-applied allowlist; unexpected PUBLIC,
inherited, anon, non-safe column, or service-role drift rolls back.

## Hosted policy and grant gate

`00_hosted_preflight.sql` is mandatory and read-only. Its captured output must
be reviewed before `01`. Policy drift is a hard stop. If either legacy QR
backfill policy exists, `04` accepts only the canonical permissive authenticated
UPDATE policy with branch access, a NULL existing QR, and a non-cancelled
invoice. A repurposed name, command, role, `USING`, or `WITH CHECK` predicate
causes `POLICY_DEFINITION_DRIFT` and rolls the migration back.

Before its named column revocation, `04` accepts either no browser compliance
UPDATE grants or the historical authenticated `UPDATE(zatca_qr_code)` grant.
Table-wide browser UPDATE or broader protected-column grants are a hard stop.
No unrelated invoice privilege is revoked.

Before `04a`, preflight must show the effective table/column privileges for
anon, authenticated, and service_role. The migration accepts only the reviewed
table-wide legacy state, the already-complete safe allowlist, or the canonical
snapshot state: `document_language` is the sole missing safe grant and the
eleven named legacy ZATCA metadata grants are the exact unsafe set that `04a`
revokes. Any other privilege drift fails closed. After `04a`, verification must
show no browser table-wide SELECT, all 32 authenticated safe columns readable,
all 52 server-only columns unreadable by browser roles, no anon invoice read,
and full service-role access.

## Release and compatibility

Effective enablement requires all of: database master flag, document-kind flag,
Edge environment kill switch, schema 2, Edge 2.0.0, client 2.0.0, and a recent
per-user/per-branch acknowledgement. The database master, simplified, and
standard flags default false.

| Combination | Result |
|---|---|
| A. old frontend + complete v2 schema (including `04a`) + old Edge | Not approved. Historical detail/receipt code can request legacy raw QR, and PostgREST rejects that query after the allowlist replaces table-wide SELECT. |
| B. old frontend + complete v2 schema + dual Edge | Not approved. Actionless submit remains compatible while the database master is false, but the old invoice-read incompatibility applies after `04a`. |
| C. safe-reader frontend + dual Edge + complete v2 schema | Approved only after preflight, `04a`, `06`, and external role/source fixtures pass. Capability acknowledgement then gates enablement. |
| D. new frontend + old Edge | Capability action/version response is absent; frontend blocks before `pos_checkout`. |
| E. new Edge + old schema | Approved disabled-mode transition only: capability selects legacy before checkout, status is legacy-safe, actionless legacy submit remains available, and v2 mutations fail safely. |

The read-only status action remains available with exact versions when the
release flag is paused, allowing recovery/reprint of already-authoritative v2
artifacts. New finalization and submission are stopped.

## Rollout invariant

Never enable the database master before the dual-contract Edge and new frontend
are deployed, branch chain heads are reviewed/seeded, and the real browser,
service-role, concurrency, cleared-artifact, and reprint fixtures have passed.
The isolated two-session allocator/lease fixture is a release gate, not an
optional static check. Standard remains independently disabled until
returned-artifact sandbox proof.

## Controlled rollout order

1. Run and capture `00_hosted_preflight.sql`; stop on any policy, privilege,
   protected-hash, partial-v2, singleton, or invoice-fingerprint drift.
2. Review schema, grants, state transitions, and deterministic fixtures.
3. Enter a controlled no-browser-traffic release window. Applying the complete
   package as a schema-only change while an old frontend is serving is a hard
   no-go.
4. Before the database window, deploy the dual-contract Edge with its kill
   switch false, verify legacy/capability/status behavior, then deploy and
   verify the safe-reader frontend against the current schema.
5. Drain active browser sessions and close traffic.
6. Apply `01`, `02`, `03`, `04`, `04a`, and `05`, in that order, with database
   master, simplified, standard, and Edge flags false after every file. `04a`
   immediately follows `04` to minimize the broad-grant interval; the
   pre-schema Edge status fallback covers the interval before `05`.
7. Run `06`; before the Product Units commercial contract is installed, all
   59 mandatory rows must be present: 54 `PASS`, 5 `REVIEW`, and 0 `FAIL`. After
   that versioned contract is installed, require all 60 rows: 55 `PASS`, 5
   `REVIEW`, and 0 `FAIL`. Discharge each `REVIEW` with its named external test
   before release.
8. Review and explicitly seed each pre-existing branch chain head.

## Per-branch readiness extension

`09_branch_readiness_gate.sql` makes the reviewed chain head necessary but not
sufficient. A branch must also have an explicit `ready` record, connected
production onboarding, a current client acknowledgement, compatible `2.1.0`
Edge/client versions, enabled global simplified flags, and an enabled Edge
execution switch. Any missing condition selects the legacy contract before the
invoice insert can be marked `server_v2`.

The insert trigger and the claim/allocation wrappers independently enforce the
database-owned portion of that gate. Global flags therefore cannot turn an
unseeded or blocked branch into v2. New compliance units receive the repository
first PIH and counter zero only through approved production onboarding;
historical branches require controlled reconciliation.

Standard routing remains separate and clearance-gated. A false standard flag
selects legacy standard clearance while simplified-ready branches can use v2.

## Durable simplified reporting

`11_durable_simplified_reporting_outbox.sql` replaces only the simplified
artifact persistence function. The chain commit, immutable simplified
XML/hash/signature/QR update, and one `zatca_reporting_outbox_v2` insert commit
in the same PostgreSQL transaction. No historical row is auto-enqueued.

The Edge response returns the stored QR after that commit and starts a
server-side `EdgeRuntime.waitUntil` drain. A Vault-authenticated `pg_cron` /
`pg_net` invocation is the durable consumer and retry backstop. Browser code
does not start reporting. The worker verifies the stored XML against
`zatca_simplified_xml_hash`, the outbox artifact hash, and the committed chain
reservation before dispatch, and it has no XML-build, allocation, signing, or
QR-generation path.

Every remote result is classified as `accepted`, `transient_failure`,
`definite_rejection`, or `ambiguous_outcome`. Only transient failures may
retry. The database permits four total attempts, with 60, 120, and 240 second
backoffs after the first three failures; a fourth transient failure blocks as
`MAX_TRANSIENT_ATTEMPTS_REACHED`. Explicit validation errors, deterministic
4xx responses, and ambiguous post-send outcomes block immediately. Ambiguous
outcomes also set the invoice to `reconciliation_required`.

The global `drain_outbox` action keeps the gateway-accepted legacy JWT in both
`Authorization` and `apikey`. After gateway signature verification, Edge
requires `role=service_role`, project ref `bkbphkpqcxuejozayrsy`, matching
Authorization/apikey JWTs, and a timing-safe match between
`X-Zatca-Dispatch-Token` and Edge secret `ZATCA_OUTBOX_DISPATCH_TOKEN`. The
legacy JWT is deliberately not byte-compared with
`SUPABASE_SERVICE_ROLE_KEY`, which may be a newer `sb_secret` credential. The
matching dispatcher token is stored in Vault as
`zatca_outbox_dispatch_token`. Caller-provided tenant, branch, and invoice
scope is rejected, each batch is clamped to ten, and responses contain
aggregate counts only.

Manual retry for `simplified_final` only requeues that exact stored artifact.
Blocked records cannot be requeued through ordinary retry.
Legacy and standard submission/clearance behavior remains on its existing
paths.

## Atomic simplified checkout extension

`11a_atomic_commercial_function_alignment.sql` first installs the exact
reviewed owner/admin and permanent-demo compatibility definitions. The
read-only `11b` gate verifies their hashes before
`12_atomic_simplified_checkout_v2.sql` installs the disabled-by-default atomic
simplified invoice and simplified credit-note path. Step `13` then supplies
the table-level authenticated `pos_sessions` SELECT needed for its existing
RLS policies. A private short-lived intent reserves the branch chain position
and captures an authoritative commercial preview inside a deliberately
rolled-back savepoint. Edge signs that exact snapshot once. The final
authenticated RPC re-runs the commercial validation and commits the
invoice/items/payments/stock or refund, immutable artifact, chain
reservation/head, durable outbox, and immutable receipt in one transaction.

There is at most one active intent per branch. Existing chain allocation cannot
overtake it. Idempotency, invoice, UUID, invoice-number, and chain-position
uniqueness prevent duplicate commercial or compliance identities. The same
key/fingerprint returns the stored receipt, including when rollout flags were
paused after commit. A non-committed intent is never diverted into a second
legacy checkout.

The global `atomic_simplified_checkout_enabled` switch and explicit branch gate
both default false. Outside a canary the new Edge action returns a write-free
rollout decision and the existing frontend path remains available. Standard
documents and notes remain clearance-gated.

Every received ZATCA response is first inserted into the append-only sanitized
`zatca_reporting_response_evidence_v2` table, then applied to outbox/invoice
state. Evidence remains available if result application fails. See
`ATOMIC_SIMPLIFIED_CHECKOUT_ROLLOUT.md` for the sequence, failure matrix, and
coordinated enable/rollback procedure.
9. Run real service-role, browser-denial, two-session concurrency, stale-lease,
   and protected-hash fixtures.
10. Reopen browser traffic only after authenticated safe reads, denied raw and
    star reads, safe output-state access, and cross-tenant RLS behavior pass.
11. Enable the Edge kill switch and database master for pilot branches, with
    simplified true and standard false.
12. Prove simplified first-print QR = stored QR = reprint QR.
13. Prove reporting retry never changes the stored artifact.
14. Expand simplified traffic gradually while monitoring claims and
    reconciliation.
15. Exercise returned-cleared-artifact parsing/adoption in ZATCA sandbox.
16. Enable standard only after provisional-output denial and cleared-output
    proof pass.
17. Retain both kill switches, the pause sequence, and reconciliation runbook.
