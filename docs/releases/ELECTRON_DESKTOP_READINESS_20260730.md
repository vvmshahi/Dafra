# Kubri Electron desktop readiness — 30 July 2026

## Verdict and authoritative source

**Status: BLOCKED — provisional Electron audit complete; final desktop release
packaging is not authorized.**

The audited base is provisional SHA `d9c5e7e79fd8d837027c6642b7cd9d9c116f3715`
on `release/electron-desktop-20260730`, containing the readiness history through
`d9c5e7e`. No locked web release SHA, release tag, or approved production web
deployment incorporating the readiness commits exists. The primary feature
branch remains at `7b0bd54`; readiness commits `5c0e0ac` and `d9c5e7e` have not
been merged into it. Before final packaging, the approved web release must
incorporate those commits and record a single locked source SHA.

This branch is not a final installer source and no Electron installer was built
or published.

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

Not yet complete for release: a dedicated Electron-native barcode printer
assignment/test/copy pipeline and physical device calibration certification.
Current barcode calibration remains part of the existing label workflow and
must be verified as device-local before desktop release.

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

## Packaging and signing

Configured targets are macOS DMG/ZIP for x64 and arm64 and Windows x64 NSIS.
No signing, notarization, publishing, auto-update, or valid Apple/Windows
signing credentials are configured. Any future package must be labelled
unsigned/internal until launch, install, uninstall, Gatekeeper, SmartScreen,
and native-printer checks pass on both operating systems.

The current `1.0.2` version is not a locked desktop release version because the
web source SHA is not locked.

## Tests

Passed:

- Electron main/preload/printer syntax checks;
- focused Electron security contract (`13` IPC handlers);
- `npm test` with local Supabase environment variables;
- `npm run build`;
- `git diff --check`.

Not run: Electron packaging, macOS notarization, Windows packaging validation,
native printer tests, physical QR/barcode scans, authenticated lifecycle
testing, or fiscal pilots.

## Findings

### P0

None confirmed after the IPC sender/origin guard was added.

### P1

- No locked web SHA incorporating readiness commits; final desktop packaging is
  blocked.
- Physical printer and Windows validation are absent.
- Native barcode printer assignment/test pipeline is not complete for the stated
  desktop scope.

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
- `scripts/test-electron-security.mjs`: focused Electron security/navigation/
  bridge/sidebar contract test.

## Remaining release gates

1. Approve and lock the final web SHA after incorporating `5c0e0ac` and `d9c5e7e`.
2. Rebase or recreate this Electron branch from that exact locked SHA.
3. Complete native macOS and Windows launch/install/uninstall/session tests.
4. Complete physical 58 mm, 80 mm, A4, and barcode printer certification.
5. Complete the native barcode printer mapping/calibration pipeline.
6. Obtain and verify signing/notarization credentials, or explicitly label
   internal unsigned builds.
7. Only then build clearly labelled internal release candidates.

Electron does not bypass server-side Atomic, Legacy, demo, or fiscal-readiness
decisions. No invoice, payment, checkout, stock, customer, credential,
reporting, clearance, chain, or ZATCA state was modified during this audit.
