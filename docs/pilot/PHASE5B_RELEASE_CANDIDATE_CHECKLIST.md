# Phase 5B release-candidate checklist

## Repository

- [ ] Release branch is clean and every intended Phase 4G/5B file is reviewed.
- [ ] No generated visual artifacts, local credentials, or local service output is staged.
- [ ] Canonical migrations are retained for fresh environments only.
- [ ] `20260722000100_reconcile_branch_assets_bucket.sql` is reviewed as the additive hosted migration.

## Database and safety

- [ ] Backup and rollback owner are recorded before any hosted migration.
- [ ] Existing production databases receive only the additive migration, never the canonical baseline replay.
- [ ] `branch-assets` is public only for issued-document logo retrieval, with 2 MB JPEG/PNG/WebP limits.
- [ ] Immutable `invoice-branding/{tenant}/{branch}/{version}/logo.{ext}` inserts work; overwrite, update and delete do not.

## Application regression

- [ ] Build and all F3–Phase 5B audits/tests pass.
- [ ] Owner and assigned branch-user Invoice Settings paths pass; foreign branch access is denied.
- [ ] Official Seller mutation remains owner-only.
- [ ] Snapshot v1/v2, legacy best-effort, full credits and partial credits render deterministically.
- [ ] English and Arabic invoice/credit-note labels are reviewed.

## Staff pilot

- [ ] Pilot branch, owner and branch-user accounts are named.
- [ ] 58 mm and 80 mm printer checks are assigned.
- [ ] A4/PDF, QR scan, Arabic, split-payment and credit-note checks are assigned.
- [ ] Every issue is recorded with the staff issue-report template.
