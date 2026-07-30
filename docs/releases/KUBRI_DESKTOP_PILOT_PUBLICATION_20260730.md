# Kubri Desktop 1.0.3 pilot publication — 30 July 2026

## Published release

- Public repository: `vvmshahi/kubri-downloads`
- Release: [Kubri Desktop 1.0.3 Pilot](https://github.com/vvmshahi/kubri-downloads/releases/tag/desktop-pilot-v1.0.3-20260730)
- Tag: `desktop-pilot-v1.0.3-20260730`
- State: published prerelease, not draft
- Electron source: `release/electron-final-20260730` @ `85158b9c0cd85aa1ebd0f1b2323b9f301af6c100`
- Supabase project host: `bkbphkpqcxuejozayrsy.supabase.co`

Published assets:

- macOS Apple Silicon arm64 DMG — SHA-256 `4405459480766b35cbff9e0d51b09ad9c20bfbcb90dcffb7c9e62ee655bbda1a`
- macOS Apple Silicon arm64 ZIP — SHA-256 `ba20ab49e0d661d2d32770e59a90d3053fe5e63e8aec296bdabad4c154adcd93`
- Windows x64 installer — SHA-256 `3efa7bce1566d12af3f303f6c109b7ad857aa317352e39ba40c9e646cee0d56a`
- [SHA-256 checksums](https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/SHA256SUMS.txt)
- [Build manifest](https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/build-manifest.json)

## Download URLs

- [macOS Apple Silicon DMG](https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-macOS-arm64-unsigned.dmg)
- [macOS Apple Silicon ZIP](https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-macOS-arm64-unsigned.zip)
- [Windows x64 installer](https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.3-20260730/Kubri-Desktop-1.0.3-Windows-x64-unsigned-setup.exe)

The prior `desktop-pilot-v1.0.2-20260730` release remains intact and is marked
**SUPERSEDED — DO NOT INSTALL** because it embedded an invalid placeholder
Supabase endpoint.

## Frontend publication and production deployment

- Frontend branch: `release/electron-desktop-20260730`
- Download integration commit: `b1443e4dd0315ff7deaf8047ebb496ba3c86d66d`
- Production deployment: `dpl_4dCoTTMtiwGv81EDVCvsZBMYbgvV`
- Production deployment URL: `https://dafra-cbx1wr5lw-mohammed-shahin-v-vs-projects.vercel.app`
- Production alias: `https://www.kubri.shop`

The homepage download section was subsequently simplified to exactly two
primary actions: `Download for Mac` (Apple Silicon DMG) and `Download for
Windows` (Windows 10/11 installer). Pilot, unsigned, version, checksum,
release, ZIP, Intel, warning, printer, and feature-card details remain
available only in internal configuration/release documentation, not in the
public section.

The production deployment was created from the tested frontend commit. Its
anonymous smoke confirmed HTTP 200, the two expected English/Arabic-capable
download actions, responsive mobile/desktop layout, visible keyboard focus
state, and absence of the removed technical desktop copy. Anonymous range
requests to both public GitHub assets returned HTTP 206. No Electron packages
were rebuilt or republished.

Vercel production follows `main`; the simplified implementation was aligned
there at `549138965417c6343abf9775590464d17c0d9f4a` without rewriting history.

## Limitations

- Packages are unsigned and not notarised.
- macOS support in this pilot is Apple Silicon arm64 only.
- Windows runtime and authentication require genuine Windows validation.
- Physical-printer validation remains pending where applicable.
- No binaries were committed to Git history.
- Frontend links use public browser download URLs only; no private token or
  authenticated API URL is used.
- The public homepage intentionally exposes only Mac and Windows primary
  actions; ZIP/checksum metadata remains typed internal configuration.
- No production invoice, payment, stock, customer, credential, ZATCA, or fiscal
  state was modified.
