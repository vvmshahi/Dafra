# Remote schema drift audit — 2026-07-31

## Decision

20260731000100_purchase_posting_idempotency.sql is **not safe to apply to
production as it stands**. It replaces the deployed
public.cancel_purchase_receiving(uuid, text, boolean) and removes production
roles that can presently reverse receiving. No remote schema, function,
policy, grant, migration-history, or business-data change was made for this
audit.

Recommended path: **Option A, adapted conservatively**. Preserve the remote
cancellation function, revise the never-remotely-applied purchase migration
only after confirming no shared environment applied its current checksum, and
split any necessary package-reversal support into separately reviewed work.
Option B is required instead if the organisation wants the deployed
ZATCA/manual foundation and other intentional production differences fully
captured in migration history first.

## Source, parity, and reproducibility

| Item | Value |
| --- | --- |
| Audit worktree | feature/purchase-posting-idempotency-reconciled-20260731 |
| Starting commit | fcaef8c0b3a105f4ff086da6bdb7fffda2f13552 |
| Migration-derived authority | readiness/final-web-certification-20260730 at d9c5e7e79fd8d837027c6642b7cd9d9c116f3715 |
| Remote project | bkbphkpqcxuejozayrsy |
| Baseline | clean local database through 20260730000500; 20260731000100 excluded |
| Parity at capture | exact through 20260730000500; only 20260731000100_purchase_posting_idempotency.sql pending locally |

Schema-only raw snapshots and the full structured record are intentionally
ignored under .artifacts/remote-schema-drift-20260731/. They contain no table
rows. SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| Remote schema dump | 1403226e02f209de9a85a68a58473e5ffa1d5fda92af2e5fd829276796ea5a48 |
| Local baseline schema dump | 6ad53fd5e368c5aaa8a622816dc4d5a4a65bb956cb03a322235398246d17d6ea |
| Local post-purchase review dump | 5fc536b34cd8d7ab01313b24080a4d5e665246c62fa0498ebdf3cbe766e8941c |
| Remote structured metadata | e9e6a43498ffad4b2449b262049a28c239bb6c11f2c4684766df6361b6fc909c |
| Local structured metadata | 7fc13a2865890eb0187e6a9c18aacaeea6acf875f6598349c0f63857aecf1377 |

Committed read-only tooling:

    supabase db query --linked --file scripts/sql/schema-drift-metadata-snapshot.sql --output-format json > remote.json
    supabase db query --local --file scripts/sql/schema-drift-metadata-snapshot.sql --output-format json > local.json
    node scripts/audit-schema-drift.mjs remote.json local.json > drift.json

The generated ignored drift.json is the complete per-object inventory. Every
record has its local and remote definition, category, risk, dependency,
provenance status, and proposed action. Environment-generated functions and
default-ACL entries remain records but are not presumed business behavior.

## Complete drift inventory

The inventory has **1,340** differences, including infrastructure metadata.

| Category | Total | Remote only | Local only | Different |
| --- | ---: | ---: | ---: | ---: |
| A/B schemas | 3 | 1 | 2 | 0 |
| A extensions | 1 | 1 | 0 | 0 |
| A/B relations | 24 | 11 | 10 | 3 |
| C/D columns | 271 | 149 | 94 | 28 |
| E constraints | 102 | 71 | 21 | 10 |
| F indexes | 46 | 27 | 19 | 0 |
| G functions | 145 | 36 | 16 | 93 |
| H triggers | 13 | 9 | 4 | 0 |
| I policies | 30 | 24 | 1 | 5 |
| I grants | 705 | 179 | 510 | 16 |

Category J covers non-behavioural generated/rendering differences: extension
and realtime implementation functions, default ACL entries including MAINTAIN,
and cast-only constraint rendering. A generated constraint/index name is not
functional drift when its normalized definition is equal.

High-risk remote-only application objects are the manual Phase 5Q ZATCA
sandbox foundation: pg_cron, sandbox credential/chain/reservation relations,
sandbox functions and guards, storage policies, and
tenants_single_permanent_demo_uidx. They match
supabase/phase5q-secure-zatca-demo-foundation.sql, introduced by 1d72524 as a
manual script rather than a migration. Preserve them.

Local-only identity/presentation objects come principally from
20260721000300_phase6a_identity_foundation.sql and
20260721000400_invoice_presentation_settings.sql. Those migrations are
recorded remotely, but their deployed effects are absent. No tracked forward
drop explains the state; it is unknown-origin deployed drift, not an automatic
repair candidate.

## Branches: exact column drift

Remote public.branches has 50 columns; the authority has 59. There are no
remote-only columns and no substantive type/default/nullability difference in
the 50 shared columns. The shared id default renders as
extensions.uuid_generate_v4() remotely and uuid_generate_v4() locally.

| Local-only column | Local definition | Migration and application impact |
| --- | --- | --- |
| invoice_display_heading | text nullable | 20260721000300; invoice presentation helper/snapshot read. |
| invoice_display_subheading | text nullable | 20260721000300; invoice presentation helper read. |
| show_company_display_name | boolean not null default false | 20260721000300; document identity/presentation. |
| show_branch_display_name | boolean not null default false | 20260721000300; document identity/snapshot. |
| thermal_density | text not null default standard | 20260721000300; thermal presentation. |
| a4_template_id | text not null default classic | 20260721000300; A4 presentation. |
| document_template_version | integer not null default 1 | 20260721000300; identity/snapshot versioning. |
| logo_asset_version | integer not null default 1 | 20260721000300; branding cache/version trigger. |
| compliance_identity_mode | text not null default legacy | 20260721000300; local protected identity workflow. |

Local functions also rely on these fields: bump_branch_logo_asset_version, the
identity snapshot/immutability functions, and the branch compliance-profile
RPC family. Current web type declarations and invoice helpers use the
presentation fields; the audited Android paths had no direct matches.
20260729000900_tolerate_optional_branch_presentation_columns.sql deliberately
uses JSON/fallback values, explaining how some production functions can
tolerate absence. It does not prove every direct application path is safe.

Risk: **high**. Preserve remote pending an application compatibility decision;
do not add all nine columns or delete local behavior automatically.

## Constraint audit

Primary keys, foreign keys, unique constraints, referential actions,
deferrability, and validation status agree for the listed purchase-related
tables. The apparent differences are cast rendering only, apart from the
local-only compliance constraint.

| Table | Remote/local normalized result | Risk/action |
| --- | --- | --- |
| branches | invoice_language remains en/ar/both; vat_mode remains exclusive/inclusive. Local has branches_compliance_identity_mode_check for the absent column. | High for missing feature; preserve remote. |
| inventory_items | unit_type allows pieces, kg, grams, liters, ml, boxes, bags, other in both. | Cosmetic; no action. |
| products | vat_treatment allows inherit, exclusive, inclusive, exempt in both. | Cosmetic; no action. |
| purchases | payment_method allows cash, card, bank_transfer in both; other mode/status checks and NOT VALID state match. | Cosmetic; no action. |
| suppliers | payment_terms allows cash, credit_30, credit_60 in both. | Cosmetic; no action. |

Supplier/branch isolation and purchase receiving dependencies used by the
planned posting RPC are present remotely. The comparison does not justify
normalizing production while preparing idempotency.

## Tenants index audit

Both sides have tenants_pkey, tenants_vat_number_key, and idx_tenants_vat.
Remote additionally has:

    CREATE UNIQUE INDEX tenants_single_permanent_demo_uidx
      ON public.tenants (is_demo) WHERE is_demo IS TRUE;

It is a partial uniqueness rule, not a duplicate VAT index: at most one
permanent demo tenant. It matches the Phase 5Q manual foundation from 1d72524.
Preserve it; it is harmless to normal tenant lookup and material to demo
isolation. Do not remove or recreate it in the purchase rollout.

## Critical cancellation comparison

Both definitions have the same signature and jsonb return, are SECURITY
DEFINER volatile PL/pgSQL, set search_path=public, revoke public execution,
and grant authenticated/service_role execution. Both retain authentication and
profile checks, advisory transaction locking, purchases FOR UPDATE,
confirmation/reason/status validation, repeat-cancel rejection, detailed
receiving checks, ledger reversal checks, inventory row locks, reversal
movement inserts, item/purchase updates, audits, and the same 42501/22023/23514
error families.

The complete normalized behavior differs in one authority block:

| Caller scope | Local | Remote |
| --- | --- | --- |
| Tenant-wide | owner | owner, admin |
| Branch-scoped | branch | branch, manager, cashier, accountant |

Replacing remote with the pending local definition would remove cancellation
authority from four deployed roles. The remote function does not contain the
pending migration's saleable_product/product_unit reversal branch. That
replacement is needed only if new movements must be cancellable; it is not
needed for the idempotency table or posting RPC.

The local baseline body traces to
20260721000100_dafra_current_schema_and_security.sql. The remote role expansion
has no matching forward migration across the inspected branches/tags.
20260725000700_product_units_commercial_workflow.sql and follow-up 7af5417 show
that preserving production receiving roles was an explicit release concern,
but do not provide a migration that exactly explains remote cancellation.
Origin: **unknown untracked production behavior**. Treat it as contract to
preserve, not as a safe hotfix to overwrite.

## Purchase migration dependency and safe options

20260731000100 contains four separable concerns:

1. purchase_posting_operations, scoped uniqueness/index, comments, RLS,
   service-role policy and grants.
2. post_purchase_receiving_v1(jsonb).
3. Nullable legacy purchase_stock_movements.inventory_item_id plus a NOT VALID
   target-reference check for product-unit movements.
4. A replacement cancel_purchase_receiving that adds package-aware reversal but
   replaces remote authorisation.

Items 1 and 2 do not require cancellation replacement. Items 3 and 4 couple
only when saleable-product movements need cancellation. A future cancellation
migration must begin from the remote body, retain all six remote roles, and
add only a proved product-unit reversal branch.

### Option A — adapt pending purchase migration to remote

First prove every shared environment has not applied 20260731000100 or relied
on its checksum. Then retain remote schema/cancellation, keep the idempotency
table and posting RPC, and remove or split cancellation replacement. Fully
rerun local certification. This is the recommended smallest blast-radius path.

### Option B — capture production drift first

Create a forward, reviewable migration series recording intentional Phase 5Q
manual behavior and any accepted production authorization/schema behavior,
certify it against a production-shaped baseline, then place a revised purchase
migration after it. Do not blindly recreate all 1,340 metadata records. This
is larger scope but gives migration-managed lineage.

Hard stop: use Option B if shared-environment checksum non-use cannot be
proven, or if governance requires a complete production lineage first.

## RLS advisory audit

| Table | Purpose/access path | Local vs remote | Classification |
| --- | --- | --- | --- |
| barcode_function_contracts_v1 | Immutable barcode function fingerprints; service-role read only | local RLS off; remote RLS on, not forced, no policies | Grants-only reference table; preserve remote. |
| product_sku_counters | Tenant SKU sequence; next_product_sku/peek_product_sku are service-role SECURITY DEFINER with row_security=off | local RLS off; remote RLS on, not forced, no policies | RLS required for direct access; no automatic change. |
| product_units_commercial_function_contracts_v1 | Immutable commercial function fingerprints; service-role read only | local RLS off; remote RLS on, not forced, no policies | Grants-only reference table; preserve remote. |

No remote anon/authenticated read/write policy exists on these tables. Enabling
RLS locally or changing grants without validating SECURITY DEFINER call paths
could break tooling. It is independent of purchase posting and needs a
dedicated security migration only after policy/access-path review.

## Required regression and release gates

1. Prove cancellation authority/denial for all remote roles and scopes.
2. Test cancellation idempotency, locks, audits, statuses, and exact legacy
   inventory reversal.
3. If package reversal remains, test conversion, ledger, insufficient-stock,
   and duplicate-reversal paths under the preserved authority block.
4. Rerun normal, retry, fingerprint-conflict, concurrency, rollback, and
   no-partial-row purchase-posting certification.
5. Exercise legacy web purchase receiving/product-unit flows and all supported
   branch presentation paths.
6. Test tenant/branch/supplier/product constraints and idempotency uniqueness
   in an authorised disposable tenant only.
7. Test direct and SECURITY DEFINER access before any RLS/policy/grant change.

No production mutation test is authorised by this audit.

## Result

- Remote schema/data changed: **no**.
- Remote migration applied: **no**.
- Mobile, web, main, and deployment changed: **no**.
- Purchase migration remote-ready: **no** — blocked by cancellation
  reconciliation and shared-environment checksum confirmation.
