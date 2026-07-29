# Kubri mobile checkpoint — 2026-07-29

## 1. Current status

- Checkpoint branch: `checkpoint/mobile-20260729`
- Checkpoint source commit: `46017f6406884cccca94e969560afe6ee1886463`
- Checkpoint document commit: branch `HEAD` containing this file
- Current main commit at checkpoint creation: `46017f6406884cccca94e969560afe6ee1886463`
- The source commit is pushed to `origin/main`.

## 2. Working features

- Capacitor mobile app with native Android project and package ID `com.kubri.pos.dev`.
- Production Supabase authentication, persisted session handling, and authoritative Owner/Branch role resolution.
- Redesigned Branch mobile workspace, production read integration, register state, products, customers, invoices, KPIs, and invoice detail.
- Native barcode scanner integration, locally preserved unsent cart, and online/offline detection with online-only billing enforcement.
- Server-authorized safe demo checkout support with Cash, Card, and Split UI paths, idempotency retention, authoritative result reconciliation, demo receipt labels, and a persistent server-derived Demo/Sandbox/non-fiscal banner.

## 3. Partial features

- The demo checkout database and mobile paths are deployed and focused tests pass, but the final physical-device demo sale and post-sale delta verification were not completed after the latest APK reinstall cleared the authenticated session.
- Android print preview, native share, WhatsApp, barcode, success, history, and KPI-refresh paths are implemented but still need the final authenticated physical-device review.

## 4. Remaining work

- Sign in normally on the authorized Xiaomi and complete exactly one controlled Kubri Trading Demo Cash sale.
- Verify its invoice, payment, stock, register, KPI/history, bilingual demo receipt, no production QR, and no ZATCA/outbox/chain mutations.
- Safely review Card/Split, selected-customer, barcode, print, native share, and WhatsApp paths without creating unapproved transactions or sending customer data.
- Continue Android MVP hardening and release packaging only after the controlled demo workflow is closed.
- Important blockers: normal Demo-account sign-in is required; MIUI rejects ADB touch injection, so credential entry and any protected physical interaction must be performed on-device.

## 5. Production safety boundaries

- Checkout is online-only; no offline invoice, payment, stock mutation, fiscal queue, or delayed submission exists.
- Mobile writes require the exact build-authorized tenant and Branch, an online connection, and an open register.
- Demo eligibility and checkout routing are derived server-side from authoritative tenant/Branch state; client-supplied demo flags are ignored.
- Demo output is explicitly non-fiscal, has no valid production QR, and cannot invoke production ZATCA reporting or clearance.
- Real unconfigured branches remain blocked by `INVOICE_CAPABILITY_NOT_CONFIGURED`; configured real branches retain their existing production route.

## 6. APK and device

- APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- File exists: yes
- Size: `47,561,931` bytes
- SHA-256: `a08b62f2cd883c12db706ba6e5e730da8ea10ab25dc4e000a014a61dcabd6069`
- Source commit: `46017f6406884cccca94e969560afe6ee1886463`
- Android package ID: `com.kubri.pos.dev`
- Physical device used: authorized Xiaomi `M2010J19CI` (`citrus`), ADB serial `66d9585e0c20`
- The APK is a local build artifact and is not committed to Git.

## 7. Restart commands

```sh
cd /Users/admin/Desktop/Dafra-ui-refinement
git fetch --all --tags --prune
git checkout checkpoint/mobile-20260729
git pull --ff-only

cd apps/mobile
npm ci
npm test
npm run typecheck
npm run build
npx cap sync android

cd android
./gradlew assembleDebug
```

## 8. Next mobile task

Resume with the single controlled authenticated Kubri Trading Demo Cash checkout on the authorized Xiaomi, then capture the read-only before/after database deltas and physical receipt/share-path evidence without issuing any real fiscal invoice.
