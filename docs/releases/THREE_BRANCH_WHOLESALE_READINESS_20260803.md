# Phase 2 branch-entitlement reconciliation — 2026-08-03

## Status

**Production migration and Edge rollout complete; controlled acceptance pending.**
The previously unrecorded partial DDL state was definition-equivalent to the
intended migration, so `20260803000100` was conservatively revised, certified
against clean, equivalent-drift and incompatible fixtures, then applied once to
production. `create-owner-account` is active as Edge Function v75. No frontend
deployment was needed. Production three-branch acceptance remains pending an
explicitly authorised disposable Super Admin/account.

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

- Clean-schema and production migration parity now match through
  `20260803000100`.
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

## Initial remote drift preflight

The original read-only checks on project `bkbphkpqcxuejozayrsy` found:

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

That partial schema state was not represented by a remote migration version and
was not safe to reconcile by blindly applying the original pending file. The
following reconciliation records the conservative compatibility strategy and
the resulting authorised rollout.

## Drift reconciliation and production rollout

### Shared-checksum and compatibility decision

- Previous pending-file SHA-256:
  `cc1a40d1eb1bcb14f47b6d521a72524db8274c1c87387965ef2961baf7330179`.
- Revised applied-file SHA-256:
  `2800767161c8a6b7baaf257b79ca37e24540e1511775d49b3b52a2fb8ef45447`.
- Supabase CLI exposed one accessible shared project,
  `bkbphkpqcxuejozayrsy`; its ledger had no applied `20260803000100` entry.
  The migration commit existed only on
  `origin/hotfix/phase2-branch-entitlement-20260803`. No accessible shared
  environment had applied the old checksum, so revising the still-pending file
  was safe.

The production definitions were classified as follows:

- **A — already present and equivalent:**
  `tenant_subscriptions.paid_branch_count integer NOT NULL DEFAULT 1`, its
  exact `CHECK ((paid_branch_count >= 1))` constraint, and nullable
  `tenants.vat_number character varying(15)` with no default.
- **B — existing functions intentionally replaced:** the two provisioning
  functions had the certified signatures, `SECURITY DEFINER`, safe search path,
  and service-role-only execute grants, but required the new durable allowance
  behavior.
- **C — missing and added:** nullable integer
  `owner_provisioning_requests.branch_allowance` plus its 1–100-or-NULL check
  and documentation comment.
- **D — unrelated:** all other production drift was left untouched.

The revised migration uses catalog checks rather than exception swallowing. It
accepts only the equivalent paid-count/check/VAT definitions above, adds only
missing entitlement objects, and clearly fails for incompatible paid-count
type, null/default, check range, branch-allowance column, or function signature.
It does not update `tenants` or `tenant_subscriptions` rows.

### Local certification

- A fresh disposable clean chain applied all 47 migrations through the revised
  `20260803000100`; the stateful runtime suite passed.
- `test:owner-branch-entitlement-migration-compatibility` constructed the exact
  partial production state, applied the revised migration, preserved a fixture
  tenant/subscription's values, added only `branch_allowance`, retained the
  compatible paid/VAT definitions, and compiled the functions.
- The same suite proved explicit failure for incompatible paid-count type,
  nullable/default, check range, branch-allowance type, and entitlement function
  signature fixtures.
- Contract, provisioning-security, stateful entitlement, full `npm test`,
  TypeScript, and Vite production build all passed. Public build placeholders
  were intentionally supplied for `npm test` and `npm run build`.
- Direct Edge and Kong OPTIONS/unauthenticated paths were rechecked after the
  revised migration: OPTIONS 200 and POST 401. The local Docker worker again
  cancelled a newly started authenticated flow under its CPU limit; the handler
  and full authenticated replay/conflict/three-branch flow had already passed
  on the same source before this migration-only revision, and the database suite
  independently revalidated its complete state transitions.

### Production result

- Final migration ledger: `20260803000100` recorded once; no pending migration.
- Aggregate rows before and after deployment: four tenants, four subscriptions,
  and two provisioning requests. No existing tenant or subscription value was
  rewritten.
- Final entitlement schema: nullable integer `branch_allowance` with no default
  and its documented 1–100-or-NULL check; existing integer NOT NULL default-1
  `paid_branch_count` and its check preserved; VAT remains nullable.
- Final functions: both target RPCs remain `SECURITY DEFINER` with
  `search_path = pg_catalog, public, auth`, execute granted only to
  `service_role`, and no anon/authenticated execute grant.
- Only `create-owner-account` was deployed. It is active as version **75** with
  `verify_jwt=false`; blank-VAT recovery, Super Admin authorisation, durable
  retry, setup-link, and structured-error behavior are retained.
- Post-deploy public smoke: OPTIONS `200` (4.59s) and unauthenticated POST
  `401` (0.34s); aggregate counts remained unchanged. No platform 503 occurred.

Authenticated production validation requests for branch counts 0, 101, decimal,
and malformed payload require an authorised Super Admin bearer token. None was
provided, so those checks were not simulated. Likewise, no explicitly
authorised disposable email/tenant was provided for controlled three-branch
acceptance. These are the remaining acceptance gate, not a migration or Edge
deployment block.

No frontend deployment was made or is needed: the current production frontend
already sends `branch_count`. Mobile and purchase-idempotency work remained
paused. No unauthorised production business data was modified.
