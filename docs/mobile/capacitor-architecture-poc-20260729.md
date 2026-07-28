# Kubri Capacitor mobile architecture POC

Date: 29 July 2026
Status: local fixture proof of concept; no production API or checkout connection

## Decision

Kubri Mobile is a dedicated package at `apps/mobile`, not a route inside the desktop Vite application. This makes the exclusion boundary structural: public pages, Super Admin, desktop Owner pages, tenant provisioning, and ZATCA onboarding are neither imported nor bundled.

The POC uses React, Vite and Capacitor 8.4.2. It establishes an Android-first native container while keeping platform services behind TypeScript interfaces for later iOS support. The temporary development identifier is `com.kubri.pos.dev`; it must be replaced only after the company approves a permanent bundle identifier.

## Structure

```text
apps/mobile/
  android/                     generated Android native project
  ios/                         generated iOS native project
  src/
    App.tsx                    mobile screens and navigation
    domain.ts                  safe mobile domain/view contracts
    fixtures.ts                typed, non-production fixtures
    platform/
      cartStorage.ts           unsent cart and request-id persistence
      network.ts               connection observation
      printer.ts               printer abstraction
      scanner.ts               native camera barcode adapter
      share.ts                 native share adapter
    styles.css                 dedicated design system
  tests/
    mobile-contracts.test.ts
  capacitor.config.ts
  package.json
```

## Shared versus mobile-only

Shared conceptually with the web product:

- Existing backend role values: `owner`, `branch`, and excluded `super_admin`.
- Product barcode and package-resolution rules.
- Exact customer-mobile normalization behavior.
- Server-owned tenant/branch scope and financial totals.
- Existing report RPC, checkout, receipt, and ZATCA status contracts planned for the MVP.
- Kubri primary green `#1B6B3A`, sidebar ink `#0F2419`, and restrained gold `#C8A96E`.

Deliberately not shared or imported:

- `src/App.tsx` and the desktop route graph.
- Super Admin and marketing screens.
- Owner onboarding, branch provisioning, and ZATCA onboarding.
- Browser checkout implementation.
- Desktop tables, sidebar, print dialogs, and keyboard-wedge scanner UI.
- Supabase client in the POC. Typed fixtures guarantee that demonstration cannot mutate production.

Future extraction should be incremental: validated request/response types, customer normalization, barcode resolution types, receipt view models, and localization keys can move to small `packages/` modules when live integration begins. Large web modules should not be moved merely to create a monorepo shape.

## Mobile design

The design is a “pocket register”: dark Kubri app bars, quiet neutral work surfaces, primary-green actions, and gold only for attention and active sales signals. The signature component is the POS cart dock, shaped and positioned like a physical till drawer. Phone controls meet a 44-pixel minimum target, focus is visible, reduced motion is respected, safe-area insets are used, and forms use native input modes.

Dark mode is deferred. Kubri’s controlled light work surface has better proof-of-concept consistency for receipts, charts, and daylight retail use. It should be evaluated with physical devices during MVP accessibility testing.

English and Arabic direction switch at the document root. Production localization should reuse reviewed translation resources through a small shared i18n package; the POC demonstrates the layout contract without copying the entire desktop catalogue.

## Roles and navigation

Owner/Admin tabs: Home, Branches, Reports, Activity, More.

Owner Home includes sales, invoices, expected cash, payment split, active registers, recent transactions, attention states, branch/date filters, and read-only ZATCA health.

Branch tabs: POS, Sales, Products, Customers, More. “Sales” is used because there is no separate Orders domain.

The mobile resolver accepts only real backend roles `owner` and `branch`. It rejects `super_admin` and any unknown/stale value. Hidden navigation is not treated as authorization; production integration must obtain profile and scope from authenticated server contracts.

## POS and checkout boundary

The POC provides product search, barcode action, category filters, stock feedback, persistent cart, quantity control, customer selection, total/VAT preview, and a simulated receipt.

It does not issue invoices. Classification is labelled `SIMPLIFIED_PREVIEW`, never presented as authoritative, and `serverConfirmed` is always false. Production MVP must submit a validated request to the existing authoritative server contract and render only the committed response. It must never copy the `0100/1000/1100` classifier into the app.

## Online-only policy

Offline invoicing is excluded from the POC and Android MVP.

The app observes connectivity, warns visibly, blocks billing while offline, and can preserve only an unsent cart. If a connection disappears during checkout, the original request/idempotency identifier must be retained. On reconnect, the app must:

1. Block another attempt.
2. Revalidate product, stock, customer, register, and session state.
3. Reconcile the retained identifier against the authoritative server result.
4. Render success only for a confirmed committed result.
5. Permit retry only when the server confirms that no commit exists.

It must never queue an invoice, number an invoice locally, mutate stock/payment locally, report to ZATCA later, or automatically submit a stored checkout.

## Barcode strategy

The POC uses the official `@capacitor/barcode-scanner` plugin, one scan at a time, rear camera, adaptive orientation, and a 1.5-second duplicate guard. Unknown, out-of-stock, denied-permission, and camera-unavailable states return explicit feedback. Browser preview can use manual barcode search.

The MVP resolver must call the existing authenticated product/package barcode contract and derive branch scope from the authenticated profile. Physical Android tests must cover EAN-13, package barcodes, low light, rapid repeated scans, denial/recovery, and camera interruption.

## Sharing and printing

The POC demonstrates the native share sheet with a clearly simulated, non-sensitive receipt message. WhatsApp uses the native share chooser; no customer message is sent automatically.

`PrinterAdapter` defines receipt printing, discovery, connection, disconnection, and status. Implementations are reserved for:

- `SystemPrintAdapter` — safely testable browser/system print path.
- `BluetoothEscPosAdapter` — interface only until real 58/80 mm devices are tested.
- `NetworkPrinterAdapter` — interface only until reachable hardware is tested.

MVP hardware testing must validate Arabic shaping, QR fidelity, line width, reconnect behavior, ESC/POS dialects, Android Bluetooth permissions, network timeouts, and vendor SDK constraints. No single printer vendor should become the domain interface.

## Authentication and session architecture

The fixture POC stores no session or password. Production integration should use Supabase Auth with:

- A native secure-storage adapter for refresh credentials, never plain Preferences.
- Bounded refresh with one in-flight refresh operation.
- Cold-start restoration followed by fresh profile/scope validation.
- App resume revalidation and expired-session recovery.
- No token, password, OTP, or credential logging.
- No request when the access token is missing.
- Route construction only after the verified profile resolves to `owner` or `branch`.
- Server/RLS-derived tenant and branch scope; never a client-provided override.

Deep-link lifecycle support is prepared by the Capacitor App dependency. Production URL schemes and universal/app links require the approved permanent bundle identifier and owned-domain configuration.

## ZATCA boundary

Mobile supports only safe status: connected/disconnected/attention, reporting state, last update, and branch capability. It excludes OTP, CSR/certificate creation, credential creation/removal, secret inspection, onboarding, and migration/admin utilities.

## Environment configuration

The POC contains no API URL or secret. Future local and production configuration must use build-time public values only, such as the Supabase URL and anon key; service-role keys, private credentials, and ZATCA secrets must never enter the bundle. Environment files containing real values remain untracked.

## Commands and paths

```bash
cd apps/mobile
npm install
npm run dev             # http://127.0.0.1:5186
npm run build
npm run test
npm run cap:sync
npm run android:open
npm run android:run
npm run ios:open
```

Android project: `apps/mobile/android`
Future/initial iOS project: `apps/mobile/ios`

Capacitor 8 requires Node 22 or newer; this machine has Node 26.5.0. Java, Android SDK/ADB, and full Xcode are absent, so native compilation and simulator/device execution were not possible.

## Performance baseline

The production mobile web build contains 23.73 kB CSS (5.40 kB gzip) and a 560.57 kB main JavaScript entry (170.08 kB gzip), plus small platform-web adapter chunks. Vite reports the main entry above its 500 kB advisory threshold. Route-level lazy loading is therefore an Android MVP task; it is not addressed by moving code back into the desktop app.

Fixture query count is zero. Live dashboard query count, report latency, cold-start time, product-list performance and real barcode-resolution latency cannot be measured until the authenticated read-only integration and an Android device exist. The POC uses simple bounded fixture lists; production lists must use server-side filtering/pagination or virtualization based on measured catalogue size.

## POC limitations and MVP stages

1. Authentication integration: secure native session adapter, live role/profile routing, resume/cold-start testing.
2. Read-only backend: live products, customers, dashboards, reports and safe ZATCA status.
3. Mobile mutations: product/customer add/edit with existing permissions and validation.
4. Checkout integration: online-only preflight, server classification, Atomic B2C and legacy B2B, retained idempotency reconciliation.
5. Device workflows: barcode hardware matrix, PDF/share/WhatsApp, printer adapters and physical receipt tests.
6. Release engineering: crash reporting with redaction, approved application ID, signing, CI, internal testing APK/AAB, Play internal track.
7. Later iOS: Xcode build, keychain-backed session storage, camera/share/print validation, associated domains, signing only after approval.

The separate manual `0100` live pilot remains a production checkpoint and is not a dependency of this POC. Production mobile checkout validation remains a later, explicitly authorized activity.
