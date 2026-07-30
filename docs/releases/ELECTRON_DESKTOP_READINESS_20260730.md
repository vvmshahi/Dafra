# Kubri Electron desktop readiness — 30 July 2026

## Verdict and authoritative source

**Status: IMPLEMENTED — native printer software scope complete; physical and
signing gates remain open.**

The locked web source is commit `6a81a4f47bdc128508736d6e245c347cbe2826db` on
`release/electron-desktop-20260730`, referenced by the pushed annotated tag
`web-production-20260730`. The implementation branch is
`release/electron-final-20260730`, created from that exact source.

The implementation source was locked at `83eed6a218eced4c461c33c76a3c138d21e4aea7`
before packaging. The unsigned internal/pilot artifacts are retained outside
Git at `/Users/admin/Desktop/Kubri-Pilot-Desktop-Apps/Kubri-Desktop-1.0.2-20260730`.

The pushed annotated desktop tag `desktop-pilot-v1.0.2-20260730` points to that
exact source commit. This tag identifies the package source; the subsequent
documentation commit on this branch records the packaging outcome.

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
sender/origin validation. All 14 handlers now require the trusted main window
webContents and an internal packaged/dev origin. The Electron security and
native-printing contract tests cover this guard and the renderer bridge.

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

The Electron-only Printer Settings workspace now has Receipts, Invoices, and
Barcode Labels tabs. Barcode documents carry an internal geometry marker and
are sent through a bounded, sender-validated `print-barcode` IPC contract.
Barcode batch, quick-print, designer, and calibration actions use native
printing in Electron and retain the browser adapter on the web.

Barcode calibration remains device-local in the reviewed local calibration
store. The barcode job passes copies once at the native boundary so expanded
label batches are not double printed.

## Printing coverage

Source-contract and web rendering coverage exists for four thermal layouts, six
A4 layouts, four barcode layouts, English, Arabic/RTL, demo warning paths,
stored QR rules, artwork, and multi-page document models. The Electron native
pipeline uses hidden routes for receipts and existing current-window A4 output.

Native 58 mm/80 mm geometry, actual copies, Arabic shaping, QR scanability,
hardware cut/feed, A4 pagination on devices, barcode scanability, macOS launch,
Windows install, and offline printer behaviour remain pending physical/OS
validation.

Test fixtures are clearly marked as printer tests and do not create invoices or
fiscal QR state. No physical printer or Windows VM was available in this audit.

## Packaging and signing

Configured targets are macOS DMG/ZIP for x64 and arm64 and Windows x64 NSIS.
No signing, notarization, publishing, auto-update, or valid Apple/Windows
signing credentials are configured. Any package from this run is labelled
unsigned/internal.

### 30 July 2026 pilot package

Built from source commit `83eed6a218eced4c461c33c76a3c138d21e4aea7`:

- macOS arm64 DMG and ZIP were produced. The DMG integrity and bundle identity
  were checked, and a packaged process launch smoke test passed with an
  isolated user-data directory. Manual GUI route verification remains open.
- Windows x64 NSIS was produced and its unpacked `Kubri.exe` payload was
  statically verified as PE32+ x86-64. Windows install, launch, uninstall,
  SmartScreen, and printer runtime validation remain open.
- macOS x64 was not built in this run because the host had less than 1 GiB free
  space after retaining the other package artifacts.
- The package path scan found no bundled `.env`, `.git`, private-key,
  certificate, credential, token, or log paths. No signing or notarization
  claim is made; macOS reported only an ad hoc bundle signature.
- SHA-256 values, exact byte sizes, and per-artifact validation status are in
  the external `checksums/build-manifest.json` and `checksums/SHA256SUMS.txt`.
- The GitHub prerelease is available at
  `https://github.com/vvmshahi/Dafra/releases/tag/desktop-pilot-v1.0.2-20260730`;
  the external `release-notes/frontend-download-links.json` records only
  verified asset URLs and leaves macOS x64 empty.

The current `1.0.2` version is an internal implementation version; packaging
remains pending the OS, hardware, and signing gates above.

## Tests

Passed:

- Electron main/preload/printer syntax checks;
- focused Electron security and native barcode contract (`14` IPC handlers);
- Electron native printing contract (local settings, safe barcode markup,
  geometry, copies and browser fallback);
- `npm test` with local Supabase environment variables;
- `npm run build`;
- `git diff --check`.
- Electron packaging completed for macOS arm64 DMG/ZIP and Windows x64 NSIS;
  package inspection logs and checksums are retained in the external pilot
  release directory.

Not run or still pending: macOS x64 packaging, macOS manual GUI route review,
macOS notarization, Windows runtime installation/launch/uninstall validation,
native printer hardware tests, physical QR/barcode scans, authenticated
lifecycle testing, or fiscal pilots.

## Findings

### P0

None confirmed after the IPC sender/origin guard was added.

### P1

- Physical printer and Windows validation are absent.
- Signing/notarization credentials and distributable package validation are
  absent.

### P2/P3

- Electron 28.3.3 and electron-builder 24.13.3 should be reviewed after the
  release rather than upgraded automatically here.
- No auto-update channel is configured.
- Unsigned/notarization and SmartScreen limitations remain until credentials and
  OS validation are available.

## Files changed

- `electron/main.cjs`, `electron/preload.cjs`, `electron/printer.cjs`: secure
  native print contracts, barcode validation, copies and device settings.
- `src/pages/settings/PrinterTab.tsx`: three-tab Electron Printer Settings
  workspace.
- `src/lib/barcodes/labelPrint.ts` and barcode print callers: native barcode
  pipeline with browser fallback.
- `src/lib/electron.ts`: typed barcode IPC bridge and local settings fields.
- `src/lib/barcodes/nativePrint.ts`: native/browser barcode print adapter.
- `src/localization/locales/en/printing.json`,
  `src/localization/locales/ar-SA/printing.json`: translated printer labels and
  statuses.
- `scripts/test-electron-security.mjs`: focused Electron security/native
  barcode/navigation/bridge/sidebar contract test.
- `scripts/test-electron-native-printing.mjs`: native printing contract test.

## Remaining release gates

1. Complete native macOS and Windows launch/install/uninstall/session tests.
2. Complete physical 58 mm, 80 mm, A4, and barcode printer certification.
3. Obtain and verify signing/notarization credentials, or explicitly label
   internal unsigned builds.
4. Only then build clearly labelled internal release candidates.

Electron does not bypass server-side Atomic, Legacy, demo, or fiscal-readiness
decisions. No invoice, payment, checkout, stock, customer, credential,
reporting, clearance, chain, or ZATCA state was modified during this audit.
