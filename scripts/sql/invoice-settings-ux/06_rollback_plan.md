# V1 contract rollback plan

Do not execute the reconciliation package without first exporting the exact hosted definitions of:

- `public.v1_default_invoice_presentation_settings(uuid)`
- `public.v1_canonicalize_invoice_presentation_settings(jsonb, uuid)` if already present
- `public.v1_merge_invoice_presentation_settings(jsonb, jsonb)` if already present
- `public.get_branch_invoice_settings(uuid)`
- `public.update_branch_invoice_settings(jsonb)`

If verification is not clean, restore the captured `get_branch_invoice_settings` and
`update_branch_invoice_settings` definitions with `CREATE OR REPLACE FUNCTION`. The
helper functions may then be dropped only if they did not exist before execution.

This package does not modify invoices, checkout, identity, Storage objects, buckets,
policies, or migration history. No invoice or Storage rollback is required.

The V1 mutable logo path convention (`<branch_id>/logo.<extension>`) remains active.
Immutable/versioned logo storage is deferred hardening and is not part of rollback.
