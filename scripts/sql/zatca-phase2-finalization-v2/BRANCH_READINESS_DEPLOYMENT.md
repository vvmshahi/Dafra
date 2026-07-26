# Per-branch v2 readiness deployment

Prepared only. Nothing in this document authorizes SQL, deployment, secret
changes, invoice creation, or ZATCA calls.

## Readiness contract

Simplified v2 is selected only when all of these are true:

1. schema, Edge, and client versions are compatible at `2 / 2.1.0 / 2.1.0`;
2. database immutable-finalization master is true;
3. database simplified flag is true;
4. the Edge execution switch `ZATCA_IMMUTABLE_FINALIZATION_ENABLED` is true;
5. production onboarding is connected and encrypted production credentials exist;
6. `zatca_branch_readiness_v2.readiness_status = 'ready'`;
7. a valid `zatca_chain_heads_v2` row exists for the same tenant and branch;
8. the branch is not blocked;
9. the current user has a non-expired matching capability acknowledgement.

Any false condition returns `checkoutMode=legacy`. The invoice insert trigger
independently applies the same database-owned head/readiness/onboarding/client
checks before it can stamp `server_v2`. Claim and allocation functions repeat
the structural gate before changing lease, counter, or PIH state.

Standard routing is independent. With `standard_enabled=false`, standard
invoices select legacy and retain the existing clearance call. If standard v2
is later reviewed and enabled, the existing v2 standard path remains
clearance-gated and prints only the validated cleared artifact.

## Exact coordinated deployment

Keep billing paused, all database v2 flags false, and the Edge execution switch
false until step 10.

1. Capture the protected release baseline and verify the reviewed clean commit.
2. Run the existing hosted preflight, then run
   `operator/cleanup_expired_capability_rows.sql` while every flag remains
   false.
3. Run the original `06_verification.sql`; require 54 PASS / 5 REVIEW / 0 FAIL.
   This happens before step 09 changes the expected runtime versions.
4. Apply `09_branch_readiness_gate.sql`.
5. Run `10_branch_readiness_verification.sql`; require 15 PASS and 0 FAIL.
6. Deploy `zatca-submit` and `zatca-onboard-production` version `2.1.0` with
   `ZATCA_IMMUTABLE_FINALIZATION_ENABLED=false`. Verify capabilities return
   legacy for both production branches.
7. Deploy/promote the matching frontend client `2.1.0`. Refresh every POS and
   verify both simplified and standard checkouts still select legacy before
   `pos_checkout`.
8. Run `operator/seed_reviewed_branch_1_and_block_branch_2.sql` under two-person
   review. Verify branch 1 has counter 860/hash
   `0rt4rBEZvug668xBtEWMyKjvip70PJip0H9Fq2TkQSo=` and ready status; verify branch
   2 has blocked status and no head.
9. Set only the Edge execution switch true. Database flags remain false, so all
   branches must still return legacy.
10. Run `operator/activate_simplified_branch_gate.sql`. This enables only the
    database master and simplified flags; standard remains false.
11. Refresh one branch-1 client. Require a fresh acknowledgement and
    `simplifiedCheckoutMode=v2`; require `standardCheckoutMode=legacy`.
12. Verify branch 2 returns both modes as legacy and creates no capability,
    claim, reservation, counter, PIH, or v2 artifact.
13. Run one approved branch-1 simplified canary only in the separately
    authorized production procedure. Verify allocation from 861 and PIH equal
    to the reviewed counter-860 hash before reopening billing.
14. Reopen billing only after the canary, safe reads, QR, receipt, A4, retry,
    and cross-branch checks pass.

## New production branch initialization

After production credentials are saved as `production_connected`,
`zatca-onboard-production` calls
`initialize_zatca_new_branch_chain_v2`. The function:

- takes the tenant/branch advisory lock;
- verifies connected encrypted production credentials;
- refuses to infer a counter or PIH from invoice counts;
- allows automatic initialization only when no invoice exists;
- inserts counter `0` and the repository first-invoice PIH constant;
- records `production_onboarding/ready` in the readiness table;
- is idempotent only for that exact counter-0/new-unit state.

A historical branch is marked blocked and remains legacy. An initialization
error makes onboarding report failure after credentials are stored, while the
missing readiness row keeps all checkout and Edge routing on legacy.

## Exact rollback

1. Run `operator/rollback_global_master_false.sql` first. This makes every new
   checkout select legacy even if a client acknowledgement or ready head exists.
2. Set `ZATCA_IMMUTABLE_FINALIZATION_ENABLED=false` on the Edge Function.
3. Verify both branches return simplified and standard legacy modes.
4. Preserve all v2 heads, readiness rows, reservations, finalized artifacts,
   acknowledgements, and network-response records.
5. Roll back the frontend/Edge binaries only if required after global routing
   is confirmed legacy. Never downgrade or rewrite an existing `server_v2`
   invoice; reconcile it through the matching v2 runtime.
