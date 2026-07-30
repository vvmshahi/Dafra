# Printing & Documents production source regression — 30 July 2026

## Status

The regression has been identified and reconciled in
`hotfix/restore-printing-documents-20260730`, but production promotion is
blocked pending authenticated Preview verification and remote Supabase
migration parity.

## Source comparison

- Production alias before repair: `https://www.kubri.shop`
- Actual production deployment before repair: `dpl_UHxqvdsKVUwuiKW8xX97SpXbZJSz`
- Production deployment URL: `https://dafra-bqu6q2dmg-mohammed-shahin-v-vs-projects.vercel.app`
- Production source branch: Vercel `main` target
- Production source line: `origin/main` at `549138965417c6343abf9775590464d17c0d9f4a`
- Known-good Printing & Documents source: `9000bc1f741a6f6090eb1c84868be2d16ef1afa6`
- Known-good branch: `feature/final-web-printing-ui-refinements-20260729`

`origin/main` forked from `59b134179c51229331bd2a686fca927089abda6e` and
contained the later desktop-download alignment, but not the ordered printing
refinement commits `4e56eab` through `9000bc1`. The download alignment was
therefore based on an older source line and retained the legacy Printing &
Documents tree. This explains why the Electron/source refinement worktree was
newer while production showed the old stacked workspace.

## Reconciliation

The isolated branch was based on current `origin/main` and cherry-picked the
complete ordered range `4e56eab^..9000bc1`, followed by readiness contract
coverage `fb00f1c`. This restored the shared `DocumentStudioShell`, bounded
full-height studio, section navigation, invoice/receipt settings, A4
renderers, artwork controls, thermal compositions, barcode designer and
related translations, tests, and migrations. No existing worktree was reset,
cleaned, rebased, or overwritten.

The prevention test is `scripts/test-printing-documents-production-regression.mjs`.
It asserts the shared shell, all three current workspaces, current navigation
markers, absence of legacy workspace markers, and preservation of the typed
Desktop 1.0.3 download configuration.

## Verification

- Reconciliation branch: `hotfix/restore-printing-documents-20260730`
- Tested source commit: `a0fdf2215373e9ced4b2c205e3a163cd66b2e72a`
- Regression prevention test: passed
- Printing Documents workspace suite: passed
- Barcode workflow and printing UX suites: passed
- Final web printing refinement suite: passed
- Thermal matrix: passed, 192 SSR renders
- `npm test`: passed
- `npm run build`: passed
- `git diff --check`: passed
- Authenticated A4 artwork RLS test: not run; it is opt-in and credentials
  were not available.

All required printing migrations through
`20260730000500_restore_v1_invoice_settings_compatibility_helpers.sql` are
present in the reconciled source. Remote migration status could not be run
because this worktree is not linked and the Supabase CLI requires the remote
database password to link it. No migration was reapplied or edited.

Preview deployment `dpl_HH6b6JqjBxZKhjZe9GLnxcc5YzFF` reached `READY`, but
Preview protection redirected anonymous requests to Vercel SSO. Authenticated
Owner/Branch verification was therefore unavailable. Main and production were
not changed or redeployed.

## Preserved scope

The public homepage retains exactly the current Mac and Windows Desktop 1.0.3
download actions and public URLs. Electron packages and GitHub release assets
were not rebuilt or modified. No invoice, payment, checkout, stock, customer,
credential, reporting, clearance, chain, or ZATCA state was modified.
