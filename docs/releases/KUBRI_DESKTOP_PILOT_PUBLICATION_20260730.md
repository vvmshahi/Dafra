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
- Download integration commit: `9ff4c4b7f73d6feb1c09b60aecb75c9ddb9dfe30`
- Production deployment: `dpl_GY3KHT7FYawuCBy3ffrXNY2bhFjg`
- Production deployment URL: `https://dafra-drugehzi6-mohammed-shahin-v-vs-projects.vercel.app`
- Production alias: `https://www.kubri.shop`

The production deployment was created from the clean checkout at the pushed
frontend commit. The production smoke confirmed Version 1.0.3, Apple Silicon
DMG and ZIP buttons, Windows installer button, Pilot and Unsigned labels,
checksum link, Gatekeeper and SmartScreen guidance, English/Arabic strings,
and absence of a recommended 1.0.2 or active Intel download.

## Limitations

- Packages are unsigned and not notarised.
- macOS support in this pilot is Apple Silicon arm64 only.
- Windows runtime and authentication require genuine Windows validation.
- Physical-printer validation remains pending where applicable.
- No binaries were committed to Git history.
- Frontend links use public browser download URLs only; no private token or
  authenticated API URL is used.
- No production invoice, payment, stock, customer, credential, ZATCA, or fiscal
  state was modified.
