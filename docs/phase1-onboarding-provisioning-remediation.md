# Phase 1 onboarding provisioning remediation

New customer provisioning must remain paused until this package is reviewed,
applied in staging, and explicitly approved for production.

`DAFRA_TEST_FAULT_SECRET` is a disposable-runtime-only test control. It must
never be configured in staging or production. Without that environment value,
the fault headers are inert. Deployment preflight must explicitly confirm the
variable is absent.

## State machines and retry contract

Owner provisioning is keyed uniquely by normalized email. The server records
`requested → auth_user_ready → subscription_ready → complete`. Database tenant,
owner-profile, and subscription changes happen in one locked RPC transaction.
Supabase Auth user creation and setup-link generation remain external operations.
An Auth identity is reusable only when its immutable provisioning marker matches
the durable request. A setup-link failure returns
`CORE_COMPLETE_SETUP_LINK_FAILED`; retry only regenerates the link and re-verifies
the same database identifiers.

First-branch provisioning is keyed uniquely by tenant. It records
`requested → branch_ready → complete`. The locked database RPC reuses the single
Main branch. The Edge Function creates or recognizes only an Auth identity marked
with the same provisioning ID, then one transaction confirms its profile and
username mapping. Username conflict leaves the branch at `branch_ready`, allowing
a different username. Passwords are never stored.

Recoverable failures retain safe error codes. Ambiguous identities become
`failed_manual_review`; operators must inspect them and must not delete or
reassign identities automatically.

## Application order and preflight

1. Keep new provisioning paused.
2. In a production read-only session run
   `supabase/phase1-provisioning-readonly-checks.sql` and retain counts in the
   restricted change record. The migration deliberately stops if duplicate Main
   branches or duplicate live subscriptions exist.
   Review every inconsistency count, RPC ACL/search-path row, and affected
   trigger before approving the migration.
3. Apply `20260728000000_phase1_onboarding_provisioning.sql` during a quiet
   window. Partial unique indexes briefly lock their tables; expected duration is
   proportional to branch/subscription row counts.
4. Deploy `create-owner-account` and `provision-first-branch`.
5. Deploy the frontend only after function smoke tests.
6. Run the read-only checks again, verify RPC grants, then execute the manual
   plan below before unpausing.

No production step was run as part of this implementation.

## Post-deployment verification

- A fresh owner returns `COMPLETE` and exactly one tenant/live subscription.
- Replaying it returns the same IDs and a regenerated setup link.
- Forced link failure returns partial status and no link.
- A first-branch retry returns the same branch ID.
- Username conflict preserves that branch and accepts a different username.
- An owner with branch-only partial state remains on `/setup-branch`.
- Browser roles cannot execute service-only provisioning RPCs.
- Logs contain provisioning ID, step, safe result, and duration only.

Manual staging failure injection must cover interruptions after Auth creation,
database core, branch creation, Auth branch creation, profile creation, and
mapping creation; two-tab concurrency; timeout after server success; inactive
tenant/owner; branch limit; Arabic/mobile/keyboard recovery; and sign-out from
the bounded profile error screen.

## Support recovery

Search by provisioning ID (never by a recovery URL). `failed_recoverable` can be
retried with the unchanged request. For `CORE_COMPLETE_SETUP_LINK_FAILED`, retry
the create action to generate a fresh link. For a first-branch username conflict,
retain all branch fields and submit a new username. Any
`failed_manual_review` state requires verifying Auth metadata, profile, tenant,
subscription, branch, and mapping IDs before a reviewed repair.

## Rollback

Rollback application code first (frontend, then Edge Functions). Do not drop
state tables while requests may still be running. After the old code is restored
and provisioning is paused:

```sql
BEGIN;
DROP FUNCTION IF EXISTS public.get_first_branch_provisioning_status();
DROP FUNCTION IF EXISTS public.set_first_branch_provisioning_result(uuid,text,text);
DROP FUNCTION IF EXISTS public.complete_first_branch_access(uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.prepare_first_branch_provisioning(uuid,jsonb);
DROP FUNCTION IF EXISTS public.set_owner_provisioning_result(uuid,text,text);
DROP FUNCTION IF EXISTS public.complete_owner_provisioning_core(uuid);
DROP FUNCTION IF EXISTS public.attach_owner_provisioning_auth(uuid,uuid);
DROP FUNCTION IF EXISTS public.acquire_owner_provisioning(uuid,text,uuid,text,jsonb);
DROP INDEX IF EXISTS public.tenant_subscriptions_one_live_per_tenant_uidx;
DROP INDEX IF EXISTS public.branches_one_main_per_tenant_uidx;
-- Preserve provisioning tables for audit by default. Drop only after export and approval.
COMMIT;
```

Dropping indexes reopens duplicate risk; keep provisioning paused. The migration
does not rewrite or delete customer data, so there is no row-level undo.

## Existing-data remediation

If preflight reports violations, do not apply the migration. Export affected IDs
to restricted operator storage. For each duplicate group, identify the actual
usable owner/subscription/Main branch from business records and access mappings;
obtain review; update only the approved row(s); validate with the same detection
query; retain a reverse update script. There is intentionally no automatic
winner-selection rule.
