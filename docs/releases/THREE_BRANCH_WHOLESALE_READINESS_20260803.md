# Phase 2 branch-entitlement reconciliation — 2026-08-03

## Status

**Deployment blocked.** The repair is reconciled onto the authoritative
migration source and remote parity is clean, but the required isolated local
reset/runtime certification did not reach a usable database schema.

## Baselines and provenance

- Stale Phase A source: `9d72e1b9192124e68ca697194ba8e1783b9602ce`.
- Authoritative base: `d9c5e7e79fd8d837027c6642b7cd9d9c116f3715`
  (`readiness/final-web-certification-20260730`).
- Production migration history and authoritative source both contain all files
  through `20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql`.
- The eleven source files from `20260729000500` through `20260730000500` were
  retained verbatim; their SHA-256 checksums were recorded during reconciliation.

## Ported repair

Only the owner-provisioning repair was ported:

- current blank-VAT and partial-provisioning recovery behavior from deployed
  owner-provisioning v74;
- Super Admin branch-count validation (integer 1–100);
- durable `owner_provisioning_requests.branch_allowance` storage;
- idempotency identity including branch count and payment type;
- new-tenant `max_branches` and new-subscription `paid_branch_count` projection;
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
- The previous Phase A web build had passed before reconciliation; a fresh
  reconciled build could not complete while the local Docker host was stalled.

## Local reset failure

The shared local Supabase project identifier (`dafra`) attached the initial
reset to a stale unhealthy stack. A unique, port-isolated temporary stack was
then attempted; it failed to create a healthy database/schema and the startup
process remained stuck in local image initialization. Temporary config changes
were restored and only the unique local process/container was stopped. This is
not a production failure, but it prevents certification of database runtime,
branch 1–3 creation, fourth-branch rejection, or legacy/retry fixtures.

## Deployment and acceptance gate

Do not apply the migration or deploy `create-owner-account` until a clean local
reset completes and the requested runtime fixture suite passes. No frontend
deployment is currently required because the existing frontend already submits
`branch_count`; no production frontend, Edge Function, migration, tenant,
subscription, branch, invoice, purchase, or ZATCA data was changed.

Mobile and purchase-idempotency work remained paused. No purchase migration was
applied.
