# Kubri mobile checkpoint audit — 31 July 2026

## Checkpoint and framework

- Checkpoint branch: `checkpoint/mobile-20260729`
- Checkpoint commit: `e7c2723cbf251897a1afa0931acdc89dc22996d6`
- Audit branch: `audit/mobile-readiness-20260731`
- Framework: Capacitor 8.4.2 with React 18, Vite 8, TypeScript, and native
  Android/iOS projects
- Android application ID: `com.kubri.pos.dev`
- iOS bundle ID: `com.kubri.pos.dev`
- Mobile package version: `0.1.0`

The checkpoint is a real Capacitor project, not a web-only mock. It contains
Supabase authentication/API code, Preferences-backed session/cart state,
barcode scanning, network state, share, and platform printer adapters.

## Previous APK

The requested previous APK was not present in the repository or audited
worktrees at `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
Consequently its expected SHA-256
`a08b62f2cd883c12db706ba6e5e730da8ea10ab25dc4e000a014a61dcabd6069`, debug
metadata, and package metadata could not be independently verified.

## Android state and build

- Gradle wrapper: 8.14.3
- Java: OpenJDK 21.0.11
- compile/target SDK: 36
- minimum SDK: 26
- debug version: `versionName 1.0`, `versionCode 1`
- Build preparation: `npm run cap:sync`
- Build command: `apps/mobile/android/gradlew assembleDebug`
- Result: passed
- APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- Size: 47,273,464 bytes
- SHA-256: `2680e4f3ee89ee1d35d872647516f2e687b17a2e8d655935d559fe0bba1592a6`
- Package: `com.kubri.pos.dev`

Warnings were limited to flatDir usage, an SDK XML version mismatch, and
native libraries that could not be stripped in a debug package. No signed
release APK/AAB was produced or published.

## iOS state

An iOS Capacitor target exists with an Xcode project, AppDelegate, Info.plist,
storyboards, and Swift Package Manager support. It declares iOS 15.0,
`com.kubri.pos.dev`, marketing version `1.0`, and build `1`. Xcode is not
installed/selected on this machine (only Command Line Tools are active), so
the iOS project was not built. Signing, entitlements, permissions, URL
schemes, and device validation remain follow-up work.

## Contract and architecture findings

Passing mobile contracts cover email/branch username authentication,
authoritative role/profile resolution, tenant and Branch scoped reads/writes,
demo non-fiscal checkout gating, register guards, invoice filters, barcode
resolution, RTL, Android back handling, and Preferences persistence.

The mobile checkpoint does not contain the web `DocumentStudioShell`, six A4
invoice themes, the web Printing & Documents section rail, or the full web
barcode configuration workspace. Mobile printing is a receipt preview/system
print adapter with physical-device adapters requiring validation. This is a
scope difference, not a reason to copy desktop UI into mobile.

Reusable source includes React/domain/API/auth logic and Capacitor abstractions.
Android and iOS still require separate native builds, permissions, signing,
and platform testing. Barcode camera, Bluetooth/USB printing, notifications,
hardware back behavior, performance, and vendor printer drivers need physical
device validation.

Explicit compatibility answers:

- An iPhone build cannot be copied to Android.
- An Android build cannot be copied to iPhone.
- Shared React/business source can produce both only through separate native
  Capacitor builds.

## Findings and next steps

- P0: none found in the static/contract audit.
- P1: none found in the static/contract audit; Android debug build passes.
- P2: previous APK artifact is unavailable; remote authenticated runtime,
  physical printing/scanning, and iOS build/signing are unverified.
- P3: web bundle warning and debug native-strip warnings are non-blocking.

No Android phone is required for the source/build audit. An emulator can cover
launch, authentication, navigation, forms, ordinary API calls, responsive
layouts, and basic file/PDF behavior, but no emulator is configured here and
`adb`/`emulator` are not on PATH. A physical Android device is recommended for
camera scanning, Bluetooth/USB printing, notifications, hardware back, and
vendor performance. An iPhone is not required now; it is required for the
iOS build/signing/device phase once Xcode is available.

Recommended development sequence:

1. Preserve this checkpoint and obtain authenticated Supabase test credentials
   plus a non-production tenant/Branch fixture.
2. Add emulator CI/device smoke coverage for auth, Branch selection, read
   parity, demo checkout guards, invoices, RTL, and barcode scanning.
3. Validate Android camera and printer adapters on representative hardware.
4. Install Xcode, configure iOS signing/permissions/callbacks, then run the
   same contract suite on an iOS simulator and physical device.
5. Only after parity evidence, plan narrowly scoped mobile UI refinements;
   do not transplant the desktop Printing & Documents studio wholesale.

No production business, fiscal, invoice, payment, checkout, stock, customer,
credential, reporting, clearance, chain, or ZATCA data was modified.
