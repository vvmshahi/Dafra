# Phase 2 branch-entitlement reconciliation — 2026-08-03

## Status

**Deployment blocked by remote schema drift.** Local database, Edge Runtime,
Kong routing, CORS and authenticated function-path certification now pass. The
remote migration ledger is exact through `20260730000500` with only
`20260803000100` pending, but metadata proves that production has a partially
applied, unrecorded subset of its target schema. No remote migration or Edge
Function was deployed after finding that drift.

## Baselines and provenance

- Stale Phase A source: `9d72e1b9192124e68ca697194ba8e1783b9602ce`.
- Authoritative base: `d9c5e7e79fd8d837027c6642b7cd9d9c116f3715`
  (`readiness/final-web-certification-20260730`).
- Production migration history and authoritative source both contain all files
  through `20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql`.
- The eleven source files from `20260729000500` through `20260730000500` were
  retained verbatim; their SHA-256 checksums were recorded during reconciliation.

| Migration | SHA-256 |
| --- | --- |
| `20260729000500_extend_a4_invoice_themes.sql` | `f5ec7104e700f156f849431cfd860d63dd13fc3362ae1c6cbde6a490a6e8718a` |
| `20260729000600_extend_a4_invoice_branding.sql` | `846b2c50be3d85e8746f1bfd486fedc8c4e4a44936c42b2645bf6f5d5033dc35` |
| `20260729000700_complete_a4_letterhead_presentation.sql` | `49c1aada6b994ce376f6508993abead651dff9a817524b2eea1ae85797bb6723` |
| `20260729000800_harden_invoice_artwork_storage_policies.sql` | `c99627dcd6ad19fb5d5e7e9a2d4e9b71f7c61fb90c69547fb4b4df91d85c60f3` |
| `20260729000900_tolerate_optional_branch_presentation_columns.sql` | `677d9ffd8aaea928189f2c7514d12538671ea8048639a1f2845db9dab765fc38` |
| `20260730000000_restore_legacy_invoice_logo_path_compatibility.sql` | `ea48935426bd833ff2da2fe22dda16c0c0c1662a8e3c3c774dc48956e9124f32` |
| `20260730000100_preserve_complete_a4_settings_on_read.sql` | `7ebee974944bc86afab7ec5da49b2c11cc485ef6d4add7d1dad9a42878d0c4c2` |
| `20260730000200_add_a4_standard_branding_visibility.sql` | `cc2e49a9d93d200f9dfad52bf002c7f56bcf465fe35237decab0ab380e8ec1af` |
| `20260730000300_allow_classic_thermal_receipt_layout.sql` | `241a852b76bc2b2534baa0f699f886d9b089cf454a51fe267cc01e9db5b915c8` |
| `20260730000400_make_inline_barcode_generation_idempotent.sql` | `f2376e774cdd1fc5ecbbe36624d8b0439fe20465e9b0acfe359b393b9a024eb6` |
| `20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql` | `706ba88d2ddadb105f8acc26fe461511c0c234ad37887081f616644542dc4df4` |

The authoritative commits that introduced this range are retained in the
verified base history from `4e56eab59f77fddb5791a06e27232065e3d44677`
through `fb00f1c9506ec66328038d0a69eed02bb7bd561f`.

## Ported repair

Only the owner-provisioning repair was ported:

- current blank-VAT and partial-provisioning recovery behavior from deployed
  owner-provisioning v74;
- Super Admin branch-count validation (integer 1–100);
- durable `owner_provisioning_requests.branch_allowance` storage;
- idempotency identity including branch count and payment type;
- new-tenant `max_branches` and new-subscription `paid_branch_count` projection;
- null-VAT compatibility: the new migration makes `tenants.vat_number` nullable
  and the core projection uses `nullif(btrim(...), '')`, matching the deployed
  v74 blank-VAT normalization without changing existing values;
- focused contract test and the additive migration
  `20260803000100_authoritative_owner_branch_entitlement.sql`.

The selected branch allowance is distinct from a plan's unit price and catalogue
capacity. A retry with the same allowance replays safely; a conflicting retry
is rejected. Legacy requests that lack a durable allowance return
`BRANCH_ENTITLEMENT_REVIEW_REQUIRED` for human confirmation and are never
silently converted to 999. Existing tenants and subscriptions are not updated.

The existing branch creation trigger remains authoritative: after three active
branches, the fourth insertion/activation is rejected server-side.

## Evidence

- Remote parity: exact match through `20260730000500`; only
  `20260803000100` is pending.
- `npm run test:owner-branch-entitlement`: passed.
- `node scripts/test-phase1-provisioning-security.mjs`: passed.
- `npm run test:owner-branch-entitlement-runtime`: passed against the real
  disposable Postgres/Auth/RLS/trigger schema. It proves 1/3/100 allowances,
  null VAT, replay/conflict, invalid/tampered values, legacy review,
  profile-only recovery, pricing for three branches, and branches 1–3 with a
  server-side fourth-branch rejection; the transaction rolls its fixtures back.
- Fresh `npm test` passed using non-secret local public build placeholders:
  192 thermal SSR render combinations passed.
- Fresh TypeScript/Vite production build passed with the same non-secret local
  public build placeholders.

## Local Edge/Kong diagnosis and certification

The original shared `dafra` stack was not a valid function test target: its
Edge Runtime had exited with code 255 three days earlier and no longer had a
Docker-network IP, while Kong remained healthy. A fresh disposable project,
`kubri_entitlement_gatewaydiag_20260803`, used ports `59821`–`59829` and again
applied all 47 migrations through `20260803000100`.

Kong configuration correctly routes `/functions/v1/*` with path stripping to
`supabase_edge_runtime_kubri_entitlement_gatewaydiag_20260803:8081`. From inside
Kong, Docker DNS resolved that name and its `_internal/health` endpoint returned
200. A temporary `route-diagnostic` function returned `{ "ok": true }` through
the direct runtime path and through Kong, proving that neither Kong routing,
Docker DNS nor CORS was an application blocker. The diagnostic source was
removed after the test.

The original timeouts were a local infrastructure/lifecycle combination:

- the stale shared runtime was not attached to the network;
- starting all services in the 3.8 GiB Docker VM alongside unrelated local
  stacks starved health/catalog work and made the first handler requests hang;
- `supabase functions serve` leaves a stopped disposable runtime container that
  can conflict with its next invocation unless that task-created container is
  cleaned up.

Two small source corrections were required and recertified:

- use the explicitly managed `DAFRA_SERVICE_ROLE_KEY` first and Supabase's
  standard server-only `SUPABASE_SERVICE_ROLE_KEY` only as the local-runtime
  fallback;
- resolve the setup-link redirect only after the caller has been authenticated
  and authorised, so an unauthenticated request always receives 401 rather than
  an unrelated configuration failure.

With the disposable runtime serving the reconciled function, direct runtime
unauthenticated POST returned 401, and Kong forwarded it as 401 in 0.24 seconds.
OPTIONS returned 200 for no Origin, a production-like Origin and localhost with
the required allow-origin, allow-headers and allow-methods behavior. An
authenticated disposable Super Admin completed the following function-path
checks through Kong:

- first `branch_count=3` provisioning: `200 COMPLETE`;
- identical replay: `200 COMPLETE_SETUP_LINK_REGENERATED` with the same durable
  provisioning id;
- conflicting `branch_count=4` retry: `409 CONFLICT_REQUEST_DATA`;
- blank VAT projected as NULL, `tenants.max_branches=3`, and
  `tenant_subscriptions.paid_branch_count=3`;
- authenticated `branch_count=0`: `400 INVALID_REQUEST` and no provisioning
  row. The stateful database certification separately proves values 1/3/100,
  values 0/-1/101/decimal/string/omitted, profile-only recovery, pricing, and
  branches one through three with server-side fourth-branch rejection.

No local fixture was sent externally. The non-secret diagnostic trace is kept
in the ignored `.artifacts/` directory.

## Remote preflight and deployment stop

Remote read-only checks on project `bkbphkpqcxuejozayrsy` found:

- the migration ledger matches local history through `20260730000500`; only
  `20260803000100_authoritative_owner_branch_entitlement.sql` is pending;
- the two target provisioning functions already have `SECURITY DEFINER`, safe
  `search_path = pg_catalog, public, auth`, service-role-only execute grants,
  and no anon/authenticated execute grant;
- RLS is enabled on the referenced public tables. The baseline production row
  counts are four tenants, four subscriptions and two provisioning requests;
- **drift:** `tenant_subscriptions.paid_branch_count integer NOT NULL DEFAULT
  1` and its `paid_branch_count >= 1` check already exist, and
  `tenants.vat_number` is already nullable, while
  `owner_provisioning_requests.branch_allowance` does not exist.

That partial schema state is not represented by a remote migration version and
is not safe to reconcile by blindly applying a pending migration. The release
gate therefore requires an authorised remote schema-reconciliation decision
before any migration or Edge deployment. The migration was not applied, the
function remains production version 74 with `verify_jwt=false`, and no existing
tenant, subscription, request, branch, invoice, purchase or ZATCA row changed.

The existing production v74 gateway itself is healthy: a non-mutating OPTIONS
request returned 200 and an unauthenticated POST returned controlled 401. The
post-deployment malformed-branch-count smoke and controlled disposable-account
acceptance are pending because deployment did not occur.

## Deployment and acceptance gate

Do not apply `20260803000100` or deploy `create-owner-account` until the remote
partial-schema drift is reconciled and re-preflighted. No frontend deployment is
needed because the existing frontend already submits `branch_count`.

Mobile and purchase-idempotency work remained paused. No purchase migration,
frontend deployment, production migration, production Edge deployment, or
unauthorised business-data mutation occurred.
