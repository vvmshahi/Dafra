# Kubri Desktop App

This Electron wrapper packages the local Vite build as a Windows desktop POS app.
It does not load the public marketing website in production.

## Behavior

- Browser users keep the normal public website flow.
- Electron users start at the desktop app entry route.
- Logged-out Electron users are sent to `/login`.

<!-- TODO(Electron v1.0.5): when the Sign In screen is shown, provide browser-style Back navigation. -->
- Logged-in Electron users are redirected by existing role behavior:
  - branch users: `/branch`
  - owners/admins: `/dashboard`
  - super admins: `/super-admin`
- Public marketing routes such as `/pricing` and `/faq` are not shown inside Electron.

## Development

```bash
npm run desktop:dev
```

This starts Vite on `http://127.0.0.1:5175` and opens Electron against that local dev server.

## Preview Bundled App

```bash
npm run desktop:preview
```

This builds the React app, then opens Electron against the bundled `dist` output through the
`kubri://app/` protocol.

## Windows Build

```bash
npm run desktop:build
```

Output is written to `dist-electron/`.

## Files

```text
electron/
  main.cjs       Main process, window security, bundled app loading, IPC
  preload.cjs    Safe bridge exposed as window.electronAPI
  printer.cjs    Existing printer IPC helper compatibility
  run.cjs        Cross-platform local launcher for npm desktop scripts
  assets/
    icon.svg
    icon.png
    icon.ico
```

## Notes

- Auto-update is intentionally not implemented in Phase 7A-1.
- Silent/direct receipt printing is intentionally left for Phase 7B.
- Supabase auth persistence remains handled by the existing browser client.
