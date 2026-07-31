# Stable Kubri web/Desktop rollback milestone — 31 July 2026

## Immutable sources

This milestone deliberately uses separate immutable refs because the web and
Electron products are built from different source commits.

- Web production source: `549138965417c6343abf9775590464d17c0d9f4a`
- Web tag: `web-stable-20260731`
- Web maintenance branch: `release/stable-web-desktop-v1.0.3`
- Vercel deployment: `dpl_UHxqvdsKVUwuiKW8xX97SpXbZJSz`
- Production alias: `https://www.kubri.shop`
- Production deployment URL: `https://dafra-bqu6q2dmg-mohammed-shahin-v-vs-projects.vercel.app`
- Electron source: `85158b9c0cd85aa1ebd0f1b2323b9f301af6c100`
- Electron tag: `electron-desktop-v1.0.3`
- Electron release: `desktop-pilot-v1.0.3-20260730`
- Release repository: `vvmshahi/kubri-downloads`

The web source currently serving production contains the simplified Mac and
Windows Desktop 1.0.3 download actions. It does not contain the later
Printing & Documents reconciliation; that remains an explicitly separate
unpromoted branch and is not misrepresented by this stable tag.

## Electron artifacts

- macOS Apple Silicon DMG: SHA-256
  `4405459480766b35cbff9e0d51b09ad9c20bfbcb90dcffb7c9e62ee655bbda1a`
- macOS Apple Silicon ZIP: SHA-256
  `ba20ab49e0d661d2d32770e59a90d3053fe5e63e8aec296bdabad4c154adcd93`
- Windows x64 installer: SHA-256
  `3efa7bce1566d12af3f303f6c109b7ad857aa317352e39ba40c9e646cee0d56a`
- Public assets are anonymous-downloadable from the GitHub release.
- Packages were not rebuilt or republished during this milestone task.

## Database and rollback state

The stable web source contains migrations through
`20260729000400_grant_demo_invoice_read.sql`. Remote migration parity,
latest applied migration, PITR/backup availability, Edge Function versions,
and production environment configuration require authenticated Supabase
project access and were not independently verified in this audit. No database
backup was created or restored.

The later printing reconciliation contains forward migrations through
`20260730000500`; this stable rollback milestone does not reverse or rewrite
those database migrations.

## Rollback runbook

1. To restore the stable web source, deploy the exact commit
   `549138965417c6343abf9775590464d17d9f4a` from
   `release/stable-web-desktop-v1.0.3` and verify the `www.kubri.shop` alias.
2. Restore stable desktop links by serving the immutable GitHub release
   `desktop-pilot-v1.0.3-20260730`; do not rebuild installers for rollback.
3. A source rollback does not reverse database migrations. First verify schema
   compatibility with the target source and keep forward migrations applied.
4. Database recovery is required only for data corruption, destructive schema
   change, or an explicitly approved PITR event; coordinate that separately
   with Supabase before changing production state.
5. Treat printing/A4/artwork and compatibility migrations as forward-only
   unless a separately reviewed rollback migration exists.

## Known limitations

- Electron packages are unsigned and macOS packages are not notarised.
- macOS support is Apple Silicon arm64 for this pilot release.
- The production web source is the stable simplified-download line, not the
  unpromoted Printing & Documents restoration.
- Supabase/PITR/Edge Function metadata remains an access-gated follow-up.

No production business, fiscal, invoice, payment, checkout, stock, customer,
credential, reporting, clearance, chain, or ZATCA data was modified.
