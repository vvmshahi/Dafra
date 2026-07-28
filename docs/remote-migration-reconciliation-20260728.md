# Remote migration reconciliation — 2026-07-28

## Scope and safety

Production was inspected only through the linked Supabase Management API. Every
SQL request began with `BEGIN READ ONLY` and ended with `ROLLBACK`. No migration,
DDL, DML, grant, history repair, function deployment, or frontend deployment
was performed.

## Ambiguous migration resolution

Migration `20260725000700_product_units_commercial_workflow.sql` had two
committed definitions:

- Candidate A: commit `286ea59`, SHA-256
  `1125bd3149b56a86f3c07c78933c9576defeb3cad69d4968917a2566c6b150f4`.
- Candidate B: commit `7af5417`, SHA-256
  `c4514e80fa6d39effa27025911106a3e6d356cfe77c059919e3e47b1f90111d4`.

The public `receive_product_stock(jsonb)` wrapper is identical in both
candidates. The distinguishing definition is its private helper,
`receive_product_stock_with_units_v1(jsonb)`.

Production exactly contains Candidate B's meaningful logic:

- JSON-number validation for `package_quantity`;
- JSON-number validation for `unit_cost`;
- JSON-number validation for `expected_product_unit_version`;
- tenant-scoped owner/admin authorization;
- tenant-and-branch-scoped authorization for branch, manager, cashier, and
  accountant roles;
- the explicit super-admin branch.

Candidate A lacks those validations and permits only the branch role in the
branch-scoped path. No other semantic difference existed between the two
migration files.

Production metadata:

| Function | Definition MD5 | Owner | Security | Search path | ACL |
|---|---|---|---|---|---|
| `receive_product_stock(jsonb)` | `449b0f8bf1e7615b2decda139bee81fe` | `postgres` | `SECURITY DEFINER`, volatile | `public, pg_temp`; row security off | postgres, authenticated, service role execute |
| `receive_product_stock_with_units_v1(jsonb)` | `3de60854cf8f69f5edbceca9151a6f09` | `postgres` | `SECURITY DEFINER`, volatile | `public, pg_temp`; row security off | postgres execute only |
| `receive_product_stock_legacy_base_v1(jsonb)` | `61817bbdc810c3dd899dce02c5fe1788` | `postgres` | `SECURITY DEFINER`, volatile | `public`; row security off | postgres and service role execute |

Result: `EXACT_MATCH_CANDIDATE_B`.

## Restored source

All ten remote-applied migrations were restored byte-for-byte from commit
`e133c3f97c3f55d2fbc4d7f18363ecccf7762917`, the tagged backend-freeze
lineage. Candidate B is the `20260725000700` file in that commit. No SQL body
was edited, combined, or renumbered.

## Clean-install prerequisite

A clean database exposed one additional historical gap before Candidate B:
the preceding repository baseline produced legacy
`receive_product_stock(jsonb)` MD5 `20676b116d9001c6eedf7179e5e9ba64`,
while Candidate B intentionally requires the production-hardened MD5
`78c5524f0f0ccef32740ca5453aaaa68`.

The exact authoritative definition already exists in the committed manual
deployment source `supabase/phase5m-product-stock-receipts.sql`, introduced by
commit `282f18cfbf56dd04143610cb9f4bd5260da199f8`. Applying that source to a
disposable database produced the required MD5 exactly. It was therefore copied
unchanged to the earlier compatibility migration
`20260725000650_restore_product_stock_receiving_prerequisite.sql`. A bytewise
`cmp` confirms the migration equals the committed source. Candidate B remains
untouched.

This compatibility migration must not later be executed blindly on production,
where its objects already exist. Production deployment requires an exact
read-only comparison and migration-history treatment for the already-installed
manual source.
