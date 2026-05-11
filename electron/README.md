# Meem Desktop App (Electron)

Wraps `https://dafra.vercel.app` in a native Windows desktop window.
No React code is bundled — all updates happen automatically via Vercel.

---

## First-time setup

From the project root, install Electron dependencies using the separate package file:

```bash
npm install --prefix . \
  electron@^28.0.0 \
  electron-builder@^24.9.1 \
  electron-store@^8.1.0 \
  electron-updater@^6.1.7
```

Or copy `package-electron.json` to a clean directory and run `npm install` there.

---

## Run in development

```bash
npx electron .
```

The window opens, loads `https://dafra.vercel.app`, and maximises automatically.

---

## Build Windows installer

```bash
npx electron-builder --win
```

Output: `dist-electron/Meem Setup 1.0.0.exe`

Distribute this file to branch staff — double-click installs, creates desktop shortcut
"Meem POS" and a Start Menu entry.

---

## Icons

| File | Purpose |
|---|---|
| `electron/assets/icon.svg` | Source (gold م on rounded square) |
| `electron/assets/icon.ico` | Required for Windows `.exe` and installer |
| `electron/assets/icon.png` | Required by electron-builder for some targets |

**Generating icon.ico from the SVG:**

1. Open `electron/assets/icon.svg` in a browser, screenshot at 256×256
2. Convert at https://convertico.com (upload PNG → download .ico)
3. OR install `electron-icon-builder` and run:
   ```bash
   npx electron-icon-builder --input=electron/assets/icon.svg --output=electron/assets
   ```

---

## Auto-updates

The app checks GitHub Releases on startup (after 5 s).
Release channel is configured in `package-electron.json`:

```json
"publish": {
  "provider": "github",
  "owner": "vvmshahi",
  "repo": "Dafra"
}
```

To ship a new version:

1. Bump `version` in `package-electron.json`
2. Build: `npx electron-builder --win`
3. Create a GitHub Release tagged `v1.0.x`
4. Upload `dist-electron/Meem Setup 1.0.x.exe` and `dist-electron/latest.yml` as release assets
5. Running clients will detect and download the update automatically

---

## Printer setup (for branch staff)

After installing, open **Settings → Printer** in the app and select the thermal printer.
Receipts will then print silently (no dialog) from the POS and invoice views.

---

## Changing the target URL

Edit `electron/main.js`:

```js
const APP_URL = 'https://your-new-url.vercel.app'
```

Rebuild and redistribute.

---

## File structure

```
electron/
  main.js        – Main process (window, IPC, auto-updater)
  preload.js     – Secure bridge between web page and Node
  printer.js     – Printer helper utilities
  updater.js     – Auto-updater setup helper
  assets/
    icon.svg     – Source icon (generate .ico/.png from this)
    icon.ico     – Windows icon (must be generated — see above)

package-electron.json  – Separate package.json for Electron builds
src/lib/electron.ts    – Web-side helper (isElectron, printSilent, …)
src/components/PrinterSetupModal.tsx – Printer selection UI
src/pages/settings/PrinterTab.tsx   – Settings tab (Electron-only)
```
