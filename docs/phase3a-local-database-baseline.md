# Phase 3A local database baseline audit

This document is local-development guidance. It does not authorize a hosted database connection. Never use `supabase link`, `supabase db pull`, `supabase db push`, `--linked`, production credentials, or production customer data for this workflow.

## Decision

Strategy D: further investigation and correction are required. No migration workspace was created because the current standalone SQL cannot yet be reproduced safely from an empty database.

Blocking findings:

1. `schema.sql` declares `sync_queue.created_at` twice, so the baseline is not executable as written.
2. The history contains 96 standalone SQL files, multiple superseded function/RLS definitions, data-dependent updates, and 39 files without explicit transaction wrappers.
3. `update-roles-part1.sql` and `update-zatca.sql` add enum values and require transaction-boundary handling; they cannot simply be concatenated into one baseline transaction.
4. Phase 6A compares the `user_role` enum returned by `get_my_role()` with `admin`, but the final repository enum is `super_admin`, `owner`, `branch`, `accountant`. Phase 6A must use a text comparison or document a migration that introduces `admin`.
5. Phase 5T/5U contain fixed demo tenant/branch UUIDs and cannot be part of a generic baseline.
6. Storage is intentionally disabled locally, while historical storage migrations expect the Supabase-managed `storage` schema. Their schema-only applicability must be tested separately.

## SQL inventory and classification

The letter is the file's dominant purpose: A baseline, B forward schema, C security/RLS, D RPC/function, E repair/backfill, F operational/production, G diagnostic, H seed/test data, I destructive utility, J superseded history.

| Class | Files |
| --- | --- |
| A | `schema.sql` |
| B | `add-branch-email.sql`, `add-customer-type.sql`, `add-day-closing.sql`, `add-employees.sql`, `add-pos-sessions.sql`, `fix-branch-isolation.sql`, `fix-invoice-counter.sql`, `phase2c-full-credit-note.sql`, `phase3b-branch-username-login-foundation.sql`, `phase3c-rate-limit-audit.sql`, `phase4b-manual-subscription-foundation.sql`, `phase4b-simple-purchase-bill.sql`, `phase4c-safe-purchase-receiving.sql`, `phase4d-supplier-item-mapping-attachments.sql`, `phase4e-branch-limit-and-manual-suspension-enforcement.sql`, `phase4h-owner-setup-completion-tracking.sql`, `phase5b3c-expense-vat-claimability.sql`, `phase5b3d-business-type-reporting-mode.sql`, `phase5c2-split-payment.sql`, `phase5c2a-dashboard-branch-and-pos-settings-hotfix.sql`, `phase5c2b-dashboard-and-split-settings-hotfix.sql`, `phase5c5a-register-session-reporting-foundation.sql`, `phase5c6-pos-touch-navigation-buttons.sql`, `phase5f-branch-stock-module-toggle.sql`, `phase5i-invoice-list-performance-indexes.sql`, `phase5j-partial-item-credit-notes.sql`, `phase5k-branch-pos-mode.sql`, `phase5l-product-stock-tracking-controls.sql`, `phase5m-product-stock-receipts.sql`, `phase5n-credit-note-session-linkage.sql`, `phase5o-product-sku-generation.sql`, `phase5v-expense-vat-supporting-details.sql`, `phase5w-split-refund-allocation.sql`, `phase5x-document-language-snapshot.sql`, `phase6a-compliance-presentation-identity-foundation.sql`, `update-branches.sql`, `update-customers.sql`, `update-expenses.sql`, `update-inventory.sql`, `update-invoice-settings.sql`, `update-products.sql`, `update-tenants.sql`, `update-zatca.sql` |
| C | `fix-all-rls.sql`, `final-rls-fix.sql`, `fix-branch-permissions.sql`, `fix-invoice-items-rls.sql`, `fix-login-rls.sql`, `phase1-user-profiles-self-update-lockdown.sql`, `phase3a-rls-canonical-lockdown.sql`, `phase3b-storage-policy-lockdown.sql`, `phase5b-financial-write-lockdown-and-active-rls.sql`, `phase5e-branch-operations-permission-hardening.sql`, `phase5g-fix-purchase-supplier-scope-validation.sql`, `phase5h-fix-product-category-scope-validation.sql` |
| D | `fix-complete-onboarding.sql`, `phase-reports-b2-date-filters-and-supplier-totals.sql`, `phase2b-pos-payment-tender.sql`, `phase3c-branch-invoice-settings-rpc-fix.sql`, `phase4b-delete-simple-purchase-bill-permission-fix.sql`, `phase4c-purchase-ux-simplification.sql`, `phase4d-super-admin-billing-summary.sql`, `phase5b3b-reporting-foundation.sql`, `phase5b3b-reporting-compatibility-hotfix.sql`, `phase5b3b-sales-report-hotfix.sql`, `phase5b3c-reporting-rpc-cache-and-purchase-actions-hotfix.sql`, `phase5c3-dashboard-and-credit-note-hotfix.sql`, `phase5c3a-dashboard-kpi-pipeline-hotfix.sql`, `phase5c5b-register-session-rpc-availability-hotfix.sql`, `phase5c5c-register-session-summary-argument-limit-hotfix.sql` |
| E | `phase2-pos-checkout-tax-rate-fix.sql`, `update-plans.sql`, `update-roles-part1.sql`, `update-roles-part2.sql` |
| F | `zatca-production-onboarding.sql`, `zatca-production-disconnect.sql`, `phase5q-secure-zatca-demo-foundation.sql`, `phase5r-secure-zatca-sandbox-onboarding.sql`, `phase5s-zatca-sandbox-compliance-validation.sql`, `phase5t-demo-sandbox-credit-note-eligibility.sql`, `phase5u-demo-sandbox-two-branch-scope.sql` |
| G | `diagnose-login.sql`, `phase5e-preflight-checks.sql`, `zatca-production-debug-samples.sql` |
| H | `seed-super-admin.sql` |
| I | `regenerate-qr-codes.sql` |
| J | `cleanup-roles.sql`, `fix-onboarding-v2.sql`, `fix-trigger.sql`, `fix-trigger-v2.sql`, `onboarding-function.sql`, `phase2-pos-checkout-rpc.sql`, `phase2-pos-checkout-rpc-fix.sql`, `phase4b-delete-simple-purchase-bill.sql`, `update-roles.sql` |

Some later hotfixes are retained as D rather than J because they may change signatures or grants in addition to replacing a function. A disposable apply is needed before any can be safely collapsed.

## Candidate dependency spine (not yet runnable)

The repository's add-commit history establishes the only defensible starting order:

1. Corrected `schema.sql` with Supabase-managed `auth.users` already present.
2. Early structural wave: branches, products, customers, expenses, inventory, tenants, ZATCA columns, employees, day closing, invoice settings, customer type, POS sessions, branch isolation, invoice counter.
3. Role boundary: `update-roles-part1.sql` must commit before role-using SQL; migrate rows with a sanitized replacement for `update-roles-part2.sql`.
4. Apply only the final onboarding trigger/function definitions, not every historical replacement.
5. Apply canonical Phase 3A RLS after all tables it enumerates exist; historical RLS fixes should be consolidated or omitted only after policy-equivalence testing.
6. Apply Phase 1/2 transactional POS and credit-note structures, then Phase 3B/3C security/audit foundations.
7. Apply Phase 4 purchase, subscription, billing, limits, and setup migrations in commit order.
8. Apply Phase 5 reporting, POS settings, register, branch security, stock, credit-note, SKU, expense, refund, and document-language migrations in commit order, selecting final function signatures deliberately.
9. Keep production credential/debug and fixed-demo migrations outside the generic baseline.
10. Correct and retain Phase 6A as a final separate migration only after all prerequisites pass static and disposable runtime checks.

Filename lexical order is not valid: Phase 3B username work was committed after Phase 5C, enum additions require commit boundaries, and multiple hotfixes replace earlier signatures.

## Phase 6A prerequisites

| Prerequisite | Expected source |
| --- | --- |
| `public.tenants(id)` | corrected `schema.sql` |
| `public.branches(id, tenant_id, name, name_ar, phone, email, updated_at)` | corrected `schema.sql` |
| Branch branding/address columns (`display_name`, `logo_url`, `show_logo`, `website`, `show_email`, `show_website`, `receipt_footer`, `show_footer`, `invoice_language`) | `update-branches.sql`, `update-invoice-settings.sql`, then `phase5x-document-language-snapshot.sql` |
| Branch template/module columns consumed or extended by later RPCs | Phase 4E and Phase 5 settings migrations |
| `public.invoices(id, tenant_id, branch_id, document_language)` | corrected `schema.sql`, then Phase 5X |
| `public.user_profiles(id, tenant_id, branch_id, role, is_active)` | corrected `schema.sql` plus resolved role migration |
| `public.audit_events` and `record_audit_event(...)` | `phase3c-rate-limit-audit.sql` |
| `get_my_tenant_id()`, `get_my_branch_id()`, `get_my_role()` | baseline, replaced by Phase 5B |
| `authenticated`, `anon`, `service_role`, `auth.uid()` | local Supabase managed roles/schema |
| UUID generation (`uuid-ossp`, `pgcrypto`) | corrected `schema.sql` |
| Existing invoice insert/update trigger compatibility | Phase 5X plus an audit of all earlier invoice triggers |

Missing/unresolved prerequisite: a canonical role contract. The schema history removes manager/cashier in favor of `branch`, does not create `admin`, but Phase 6A contains an enum comparison with `admin`.

## Exclusions

Never include or execute in the generic baseline: `seed-super-admin.sql`, `regenerate-qr-codes.sql`, `diagnose-login.sql`, `phase5e-preflight-checks.sql`, `zatca-production-debug-samples.sql`, fixed-demo Phase 5T/5U, or production onboarding/disconnect operations. Phase 5Q/R/S need a separate decision: their schema may be useful for isolated synthetic sandbox testing, but no credentials or operational rows may be copied.

## Static findings

- `schema.sql` is not a complete current baseline: it lacks expenses, purchases, register sessions, subscription operations, audit/rate-limit tables, reporting objects, later stock/credit-note structures, and Phase 5 document settings.
- It references Supabase-managed `auth.users` but does not create Auth or Storage internals, which is appropriate for a Supabase migration.
- It includes RLS, helper functions, triggers, ZATCA structures, and generic subscription-plan seed rows; it includes no customer rows.
- The duplicate `sync_queue.created_at` makes it invalid on an empty database.
- Standalone scripts repeatedly replace the same RLS policies and RPC signatures. Historical addition order is known from Git, but final-equivalence is not proven.
- Data-changing SQL exists in role, plan, branch-isolation, tax-rate, purchase, sandbox, and refund scripts. These require empty-database behavior review or removal from a consolidated baseline.
- Enum additions need separate committed migrations. No `CREATE INDEX CONCURRENTLY`, `VACUUM`, or database-creation statement was found.
- Fixed UUID literals occur in Phase 5T/5U. Other UUID examples are comments; they must remain non-executable.
- No embedded real private key, CSID, OTP, certificate, or production service-role key was found. `seed-super-admin.sql` contains a real-looking email and password placeholder and is excluded.

## Local workflow and safety

Use `scripts/phase3-local-db.sh check` before any local command. It rejects targets other than `127.0.0.1` or `localhost` and never prints credentials.

Storage, Imgproxy, and Pooler remain excluded. Start with:

```sh
scripts/phase3-local-db.sh start
```

Do not reset/apply yet. After the blockers are corrected, migrations are reviewed, and a `supabase/migrations/PHASE3_BASELINE_READY` marker is intentionally added, the disposable command is:

```sh
DAFRA_ALLOW_LOCAL_RESET=YES scripts/phase3-local-db.sh reset
```

That command is the rollback as well: it destroys and recreates only the localhost database from reviewed migrations. Until the marker exists the script refuses to run. Synthetic seed data should live in a future `supabase/seed.sql`, use generated UUIDs and `@example.test` identities, and contain no ZATCA credentials or copied records.
