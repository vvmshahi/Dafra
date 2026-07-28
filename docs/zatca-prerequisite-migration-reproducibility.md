# ZATCA prerequisite migration reproducibility

## Root cause and repair

The immutable-finalization v2 prerequisite package was deployed from
`scripts/sql/zatca-phase2-finalization-v2` but was never represented in
`supabase/migrations`. The later migration
`20260724000100_atomic_simplified_checkout_v2.sql` therefore worked on the
deployed database and failed on a clean database.

`20260723000000_restore_zatca_finalization_v2_prerequisites.sql` is an exact
versioned copy of deployed steps 01, 02, 03, 04, 04a, 05, 09, and 11, in their
reviewed deployment order. All rollout switches remain disabled. It precedes
Atomic Checkout and does not classify or rewrite historical invoices.

No existing migration was edited.

## Clean installs

Clean installations execute the restored migration chronologically. No manual
SQL or migration-history repair is permitted. Two consecutive clean resets must
pass before release.

## Existing production upgrade

Do not execute the restored package blindly over a database that already ran
later Atomic/ZATCA changes: later migrations intentionally evolved at least one
read function. Instead:

1. Run `supabase/zatca-prerequisites-production-preflight.sql` in a reviewed
   read-only session.
2. Compare object types, columns, RLS, owners, grants, functions, disabled
   rollout flags, and migration history with the reviewed repository schema.
3. Stop on any missing or incompatible result.
4. If and only if the deployed objects match the historical package and the
   later Atomic migrations are already recorded, record migration
   `20260723000000` as applied with the approved Supabase migration-history
   repair command. This is bookkeeping for the already deployed package, not a
   schema mutation.
5. Re-run the preflight and normal post-deployment verification.

Production access was unavailable during implementation; this comparison is a
mandatory deployment gate.

The history-only path was exercised on the disposable database by marking
`20260723000000` reverted and then applied. Excluding the migration-history
schema and normalizing `pg_dump`'s random `\restrict` token, the before/after
schema SHA-256 was identical
(`5f75c2e2b8d4a79150ba000069907c55139cda4d9644e86f62fe9e472d92242e`).
The version row changed from absent to present and no application object
changed.

## Security contract

The restored private tables are owned by `postgres`, have RLS enabled, deny
`PUBLIC`, `anon`, and `authenticated`, and grant service access only where the
historical package requires it. Public status/read RPC behavior is preserved
exactly from the deployed package. No credentials or customer data are stored
by the migration.

## Rollback

Before Atomic Checkout is installed, the restored package can be removed only
in reverse dependency order: reporting outbox, branch readiness/capabilities,
claims and guards, chain allocator, then runtime/artifact columns. This requires
a maintenance window because it takes DDL locks.

After any later Atomic/ZATCA migration exists, do not drop prerequisite objects:
they have hard dependencies and are part of the deployed behavior. Rollback is
then limited to removing the migration-history entry if it was recorded in
error; preserve all schema objects and re-run the read-only comparison. Never
drop invoice columns or mutate invoice rows as an automated rollback.

Validation after rollback or history repair must confirm disabled rollout
flags, expected ACLs/RLS, intact Atomic functions, and unchanged invoice and
credit-note regression results.
