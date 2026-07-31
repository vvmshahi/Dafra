# Purchase Posting Idempotency Reconciliation — 31 July 2026

## Decision

**NO-GO — `KUBRI_PURCHASE_LINEAGE_RECONCILIATION_BLOCKED`**

The purchase-posting migration is locally certified on the authoritative
production migration lineage and has exact migration-history parity with the
linked project. Remote schema preflight found unreviewed schema-definition
differences in objects the migration reads or replaces. No remote migration was
applied and no production data was modified.

## Sources and lineage

- Stale purchase source:
  `feature/purchase-posting-idempotency-20260731` at
  `0e630b36aca882f987a9a0ccbbf2713ec411edce`.
- Authoritative base:
  `readiness/final-web-certification-20260730` at
  `d9c5e7e79fd8d837027c6642b7cd9d9c116f3715`.
- The base is a reviewed descendant of final certification
  `7b0bd54a63b7fd1f7cf9c58d338379a3a833bdb8`; it adds only readiness
  documentation and the lower-case local Supabase project identifier, with no
  later migration file.
- Reconciled branch:
  `feature/purchase-posting-idempotency-reconciled-20260731`.

The authoritative base contains the complete remote history through
`20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql`.

## Missing lineage integrity

Every missing historical migration was found in the authoritative base and is
byte-identical to the final certification commit.

| Migration | SHA-256 | Introduction commit |
| --- | --- | --- |
| `20260729000500_extend_a4_invoice_themes.sql` | `f5ec7104e700f156f849431cfd860d63dd13fc3362ae1c6cbde6a490a6e8718a` | `4e56eab59f77fddb5791a06e27232065e3d44677` |
| `20260729000600_extend_a4_invoice_branding.sql` | `846b2c50be3d85e8746f1bfd486fedc8c4e4a44936c42b2645bf6f5d5033dc35` | `1d7170ff68cb91524f5eacd065d5b2e8a435864f` |
| `20260729000700_complete_a4_letterhead_presentation.sql` | `49c1aada6b994ce376f6508993abead651dff9a817524b2eea1ae85797bb6723` | `7f30ae66ede50c184f8517b4b6e421ffebd553d1` |
| `20260729000800_harden_invoice_artwork_storage_policies.sql` | `c99627dcd6ad19fb5d5e7e9a2d4e9b71f7c61fb90c69547fb4b4df91d85c60f3` | `5a1f0023da1ea523086e962e423cce1cfa43e380` |
| `20260729000900_tolerate_optional_branch_presentation_columns.sql` | `677d9ffd8aaea928189f2c7514d12538671ea8048639a1f2845db9dab765fc38` | `8c382b85f6ec99916cd7ff5d64c44cf286dcd993` |
| `20260730000000_restore_legacy_invoice_logo_path_compatibility.sql` | `ea48935426bd833ff2da2fe22dda16c0c0c1662a8e3c3c774dc48956e9124f32` | `35bca3413ec19111e30eba22887debfb49dd8c35` |
| `20260730000100_preserve_complete_a4_settings_on_read.sql` | `7ebee974944bc86afab7ec5da49b2c11cc485ef6d4add7d1dad9a42878d0c4c2` | `fc8c9b516709085be459463b3f64baa76b9f65d3` |
| `20260730000200_add_a4_standard_branding_visibility.sql` | `cc2e49a9d93d200f9dfad52bf002c7f56bcf465fe35237decab0ab380e8ec1af` | `3af4277d51aa0e6ddc61ea28283aa84d1003ee35` |
| `20260730000300_allow_classic_thermal_receipt_layout.sql` | `241a852b76bc2b2534baa0f699f886d9b089cf454a51fe267cc01e9db5b915c8` | `a3aa74f0b299acc79749b80b68861838cdc07227` |
| `20260730000400_make_inline_barcode_generation_idempotent.sql` | `f2376e774cdd1fc5ecbbe36624d8b0439fe20465e9b0acfe359b393b9a024eb6` | `a6519998d9bec150ce76b3de7642ce014be5f1cc` |
| `20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql` | `706ba88d2ddadb105f8acc26fe461511c0c234ad37887081f616644542dc4df4` | `fb00f1c9506ec66328038d0a69eed02bb7bd561f` |

## Purchase-contract port

Only the reviewed purchase commits were cherry-picked, in order, onto the
authoritative base: the new migration, static contract test, release document,
non-stock/service correction, and stateful SQL test. No old migration file was
copied from the stale branch and no historical timestamp was renamed.

No purchase migration adjustment was required: the authoritative base compiled
the reviewed `20260731000100_purchase_posting_idempotency.sql` unchanged.

## Local certification

An isolated, lowercase local project using unused `5952x` ports was reset from
the first migration with no seed. The normal all-service health gate exceeded
the 4 GiB Docker allocation, so certification used the healthy database-only
stack; this did not change any tracked configuration.

- Clean reset passed all 47 migrations through `20260731000100`.
- `post_purchase_receiving_v1(jsonb)` compiled with `SECURITY DEFINER`,
  `search_path=public, pg_temp`, and `row_security=off`.
- Stateful SQL assertions passed for base-unit receiving, package conversion,
  stock/service mixes, identical retries, PPC06 conflicts, rollback, stock and
  movement counts, tenant/branch/supplier authority failures, stale units, and
  unauthenticated execution.
- Concurrent identical submissions produced one purchase and one replay;
  concurrent conflicting submissions produced one purchase and one PPC06.
- Persisted synthetic-fixture results after concurrency were six purchases, six
  completed operations, stock `47`, five receipts, and five purchase movements.
- The existing browser `simple_bill` insert succeeded under the authenticated
  role inside a transaction and was rolled back; zero probe rows remained.
- Static purchase contract, purchase UI, product-unit commercial workflow,
  stock-page, final-printing, and Phase 4G readiness tests passed.

The existing invoice-settings expected-key test remains stale because the
authoritative source correctly contains `show_standard_branding`; the test has
not been weakened. Its runtime counterpart also requires a configured local API
URL and was not run against the intentional database-only stack.

## Linked remote parity and preflight

The reconciled worktree is linked to `bkbphkpqcxuejozayrsy`.

Migration parity is exact through `20260730000500`; the only pending local
migration is `20260731000100_purchase_posting_idempotency.sql`.

Metadata-only preflight found no missing dependency object and confirmed that
the new purchase RPC does not yet exist remotely. It also found these remote
schema differences relative to the authoritative local base:

- `public.branches` has 50 remote columns versus 59 local columns.
- The remote target-table metadata set has 475 entries versus 484 locally.
- The remote has four `tenants` indexes versus three locally.
- Constraint definitions differ for `branches`, `inventory_items`, `products`,
  `purchases`, and `suppliers`.
- `public.cancel_purchase_receiving(uuid, text, boolean)` has a different
  definition hash remotely (`60065c4facfb2b9a1b675a07cd58597f`) than on the
  authoritative base (`66c29233d4705d280c0b2aaf1c0afa8c`). The purchase
  migration replaces this function, so applying it would overwrite an
  unreviewed remote implementation.

Policies, RLS flags, and the signatures/security settings for
`auth.uid`, `extensions.digest`, `branch_effective_stock_enabled`,
`receive_product_stock_with_units_v1`, `mark_product_unit_used`, and
`record_audit_event` were present. The differences above are sufficient to
block application until the remote schema lineage is reconciled by an approved
separate change.

The local Supabase advisor also reported a pre-existing critical RLS finding on
`public.barcode_function_contracts_v1`, `public.product_sku_counters`, and
`public.product_units_commercial_function_contracts_v1`. No remediation was
applied because enabling RLS without approved policies could break access.

## Safety boundary

No remote migration was applied, no migration history was edited, no production
business rows were queried or modified, and no mobile, web deployment, or main
branch changes were made.
