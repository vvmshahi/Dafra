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
