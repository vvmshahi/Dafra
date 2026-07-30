# Kubri Electron desktop readiness — 30 July 2026

## Verdict and authoritative source

**Status: PILOT PACKAGES AVAILABLE — public download integration verified;
signing, OS runtime, and physical-printer gates remain open.**

The locked production web base is commit
`6a81a4f47bdc128508736d6e245c347cbe2826db`, tagged
`web-production-20260730`. The Electron package source is commit
`83eed6a218eced4c461c33c76a3c138d21e4aea7`, tagged
`desktop-pilot-v1.0.2-20260730`. This branch records the public download
integration on top of that locked web base; deployment remains a separate
release operation.

Unsigned macOS arm64 and Windows x64 pilot packages are published in the
public release-only repository `vvmshahi/kubri-downloads`. The proprietary
source repository remains private.

## Existing architecture

- Electron `28.3.3`; electron-builder `24.13.3`.
- `electron/main.cjs` creates the BrowserWindow, serves packaged `dist` through
  the privileged `kubri://app/` protocol, owns device-local settings, printer
  discovery, hidden print windows, and native print callbacks.
- `electron/preload.cjs` exposes a finite `window.electronAPI` allowlist.
- `electron/printer.cjs` wraps `getPrintersAsync` and `webContents.print`.
- React uses the same receipt/A4 document routes and renderers as the web app;
  Electron-only navigation is controlled by `isElectron()`.
- Auto-update is intentionally absent.
- Version is `1.0.2`, product name `Kubri`, app ID `com.kubri.pos`.

Historical printer work was identified in `66d5a3c`, `9b6d3ef`, and `d9442cf`;
the current implementation was reviewed rather than restoring old files
wholesale.

## Security audit

Passed: context isolation, disabled Node integration, sandboxed renderer,
privileged protocol path containment, restricted navigation and new-window
handling, HTTPS/mailto external allowlist, minimal preload bridge, validated
printer settings, UUID validation for invoice printing, and callback-based
native print success.

One confirmed issue was repaired: the native IPC handlers previously lacked
sender/origin validation. All 13 handlers now require the trusted main window
webContents and an internal packaged/dev origin. The Electron security contract
test covers this guard and the renderer bridge.

No arbitrary shell/native command IPC was found. No production credentials are
bundled or logged by the Electron layer.

## Printer Settings and persistence

Printer Settings is now visible in Electron for Branch and Owner/admin sidebar
users and remains unavailable as a native-settings entry in normal browsers.
Settings are stored in Electron user-data JSON, separate from branch cloud
presentation settings. Receipt and A4 assignments are independent.

Implemented/reviewed: printer discovery, refresh, unavailable-printer status,
receipt 58/80 mm presets, printable width, scale, margins, offsets, receipt and
A4 copies, silent/direct printing, test receipt/A4 actions, safe validation,
hidden print windows, readiness timeout, callback success/failure, and retry
without repeating checkout.

Physical device calibration and certification remain open for release.

## Printing coverage

Source-contract and web rendering coverage exists for four thermal layouts, six
A4 layouts, four barcode layouts, English, Arabic/RTL, demo warning paths,
stored QR rules, artwork, and multi-page document models. The Electron native
pipeline uses hidden routes for receipts and existing current-window A4 output.

Native 58 mm/80 mm geometry, actual copies, Arabic shaping, QR scanability,
hardware cut/feed, A4 pagination on devices, barcode scanability, macOS launch,
Windows install, and offline printer behaviour were not physically verified.

Test fixtures are clearly marked as printer tests and do not create invoices or
fiscal QR state. No physical printer or Windows VM was available in this audit.

## Packaging, signing, and public downloads

Configured targets are macOS DMG/ZIP for x64 and arm64 and Windows x64 NSIS.
No signing, notarization, auto-update, or valid Apple/Windows signing
credentials are configured. Packages remain labelled unsigned/internal.

The private source-repository release was confirmed inaccessible anonymously
(all five asset URLs returned `404` without GitHub credentials). An existing
public release-only repository, `vvmshahi/kubri-downloads`, was used instead;
no application source or credentials were copied there.

The public prerelease is published, not draft, and remains a prerelease:
`desktop-pilot-v1.0.2-20260730`.

Verified anonymous browser-download URLs:

- macOS Apple Silicon DMG: `https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.2-20260730/Kubri-Desktop-1.0.2-macOS-arm64-unsigned.dmg`
- macOS Apple Silicon ZIP: `https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.2-20260730/Kubri-Desktop-1.0.2-macOS-arm64-unsigned.zip`
- Windows x64 installer: `https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.2-20260730/Kubri-Desktop-1.0.2-Windows-x64-unsigned-setup.exe`
- Checksums: `https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.2-20260730/SHA256SUMS.txt`
- Build manifest: `https://github.com/vvmshahi/kubri-downloads/releases/download/desktop-pilot-v1.0.2-20260730/build-manifest.json`
- Release notes: `https://github.com/vvmshahi/kubri-downloads/releases/tag/desktop-pilot-v1.0.2-20260730`

Unauthenticated requests returned `302` to GitHub release storage followed by
`200`, matching the filename and exact local content length for every asset.
No Intel Mac link is provided; macOS x64 is unavailable in this pilot.

The public landing page now uses typed central configuration in
`src/config/desktopDownloads.ts`, with visible Pilot and Unsigned badges,
Apple Silicon DMG/ZIP and Windows x64 choices, file sizes, release notes,
checksums, installation warnings, printer guidance, and English/Arabic copy.

The current `1.0.2` version is the locked desktop pilot version. The public
download surface does not use GitHub API URLs, credentials, or private-source
URLs.

## Tests

Passed:

- Electron main/preload/printer syntax checks;
- focused Electron security contract (`13` IPC handlers);
- `npm test` with local Supabase environment variables;
- `npm run build`;
- `npm run test:desktop-download-links`;
- anonymous `302` → `200` checks for all five public release assets;
- `git diff --check`.

Not run or still pending: macOS notarization, Windows runtime installation and
printer validation, physical QR/barcode scans, authenticated lifecycle testing,
or fiscal pilots.

## Findings

### P0

None confirmed after the IPC sender/origin guard was added.

### P1

- Physical printer and Windows validation are absent.

### P2/P3

- Electron 28.3.3 and electron-builder 24.13.3 should be reviewed after the
  release rather than upgraded automatically here.
- No auto-update channel is configured.
- Unsigned/notarization and SmartScreen limitations remain until credentials and
  OS validation are available.

## Files changed

- `electron/main.cjs`: trusted IPC sender/origin validation.
- `src/components/layout/Sidebar.tsx`: Electron Printer Settings visibility for
  Owner/admin users.
- `src/config/desktopDownloads.ts`: verified public pilot asset configuration.
- `src/pages/landing/LandingPage.tsx`: public desktop download cards, warnings,
  checksums, release notes, and printer guidance.
- `src/localization/locales/en/public.json`,
  `src/localization/locales/ar-SA/public.json`: localized download copy.
- `scripts/test-desktop-download-links.mjs`: URL, architecture, warning, and
  English/Arabic contract test.

## Remaining release gates

1. Deploy the reviewed frontend commit through the normal production process.
2. Complete native macOS and Windows launch/install/uninstall/session tests.
3. Complete physical 58 mm, 80 mm, A4, and barcode printer certification.
4. Obtain and verify signing/notarization credentials, or explicitly label
   internal unsigned builds.
5. Only then promote beyond clearly labelled internal pilot packages.

Electron does not bypass server-side Atomic, Legacy, demo, or fiscal-readiness
decisions. No invoice, payment, checkout, stock, customer, credential,
reporting, clearance, chain, or ZATCA state was modified during this audit.
