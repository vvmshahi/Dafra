# Kubri mobile core functional audit — 31 July 2026

## Executive result

- Mobile source: `audit/mobile-readiness-20260731`
- Starting checkpoint: `e7c2723cbf251897a1afa0931acdc89dc22996d6`
- Audit/build source: `0717547eb8bc26dbb7a9b3674d5218c34159d2e0`
- Framework: Capacitor 8.4.2, React 18.3, Vite 8.1, TypeScript
- Android wrapper: Gradle 8.14.3, Java 21, compile/target SDK 36, min SDK 26
- iOS wrapper: Capacitor Xcode project, iOS 15 target; Xcode unavailable

The connected device audit confirms the installed app launches, restores its
existing authenticated demo session after upgrade/restart, reaches the Branch
dashboard, displays the DEMO/non-fiscal boundary, and reads existing dashboard
and invoice data. No financial or fiscal mutation was performed.

## Connected device and installation

- Device: Xiaomi `M2010J19CI`, Android 12/API 31, arm64-v8a
- Display: 1080×2340, density 440
- Storage: approximately 2.4 GB free of 47 GB in `/data` (95% used)
- Device ID: `66d958…20` (redacted)
- Package: `com.kubri.pos.dev`
- Installed version: `1.0`, code `1`
- Camera permission: granted
- Install method: `adb install -r`; existing app data was retained
- Launch result: `MainActivity` resumed successfully
- Post-upgrade screen: authenticated `Kubri Trading Demo`, register open,
  DEMO/non-fiscal banner, dashboard KPIs, invoice list, and low-stock state

ADB shell input injection was rejected by the Xiaomi device with
`INJECT_EVENTS` permission denied. Therefore tap-driven navigation, camera
capture, and hardware-back injection could not be completed from the host.

## Backend and safety configuration

The rebuilt debug artifact was created with the existing local public
environment values injected at build time. The embedded bundle contains the
expected host `bkbphkpqcxuejozayrsy.supabase.co`; no service-role string was
found. The source has no committed mobile `.env` file, so builds without an
explicit environment fail closed with authentication unavailable. The
`http://localhost:9999` string found in the bundle belongs to the Supabase
client library's internal lock/debug fallback, not the configured API host.

The mobile defaults are intentionally safe: access mode defaults to
`read-only`, production checkout is disabled unless explicitly enabled, and
authorised tenant/Branch IDs are not committed. No ZATCA private key or
production credential was bundled.

## Feature matrix

| Module | Screen/read | Create/edit/delete | Server/authority | Device result | Gap / priority |
|---|---|---|---|---|---|
| Dashboard | Branch dashboard and Owner summary code | N/A | `get_dashboard_summary`, tenant/Branch filters | Branch dashboard verified | Owner device path untested; P2 |
| Categories | No mobile route/API | Absent | Web only | Not testable | P2 web workaround |
| Products | Branch-scoped list/search and POS load | Absent | `products`, tenant + Branch | Existing dashboard/POS data visible | P2 write workflow |
| Units/packages | No mobile unit model or conversion path | Absent | Web contracts only | Not testable | P2 |
| Barcodes | Exact Branch-scoped lookup and camera plugin | Generate/edit absent | `products` exact barcode query | Camera permission granted; scan not injectable | P2 physical scan |
| Stock | Drawer label only; no API screen | Absent | No mobile stock mutation | Not testable | P2 |
| Customers | Branch-scoped list and POS selection | Create/edit absent | `customers`, tenant + Branch | Existing data path present | P2 write workflow |
| Suppliers | Branch-scoped read list | Create/edit absent | `suppliers`, tenant + Branch | Not navigated | P2 |
| Purchases | Branch-scoped read list | Create/receive/edit absent | `purchases`, tenant + Branch | Not navigated | P2 |
| Expenses | Branch-scoped read list | Create/edit/delete absent | `expenses`, tenant + Branch | Not navigated | P2 |
| Register | Open/close flows and restore | Guarded RPC mutations present | `open_register_session`, `close_register_session`, summary RPC | Existing register-open state visible; no mutation run | Implemented, mutation test pending |
| POS/payments | Search, cart, quantity, barcode, Cash/Card/Split | Demo checkout only | `resolve_pos_checkout_document_v1`, `pos_checkout`, idempotency key | No checkout mutation run | Implemented safe path |
| Invoices | List, filters, detail, payment/status/return fields | Returns/credit-note creation absent | Branch-scoped invoice queries; refundable-items RPC | Existing invoice list/detail data visible | P2 returns |
| ZATCA | Status/output capability read | Retry action absent | `zatca-submit` status invocation | Demo states visible; no submission | P2 retry/status controls |
| Reports | Dashboard summary only | N/A | Owner/Branch report screens absent | Not testable | P2 summary/report workflow |
| Receipt/PDF/share | Demo receipt preview/system print adapter; invoice output capability read | Invoice action disabled | Server output capability | No share/print mutation tested | P2 document output |
| Documents | No mobile Printing & Documents studio | Absent by design | Web settings are the approved source | Not testable | P2 settings consumption |
| Settings | Locale, logout, support entry | Profile/document settings absent | Auth/Preferences | Session persistence verified | P2 |
| Android lifecycle | Splash, restore, network listener, back listener code | N/A | Capacitor App/Network/Preferences | Launch/restart verified; injected back unavailable | P2 device coverage |

## Authentication and fiscal pathway

Static contracts cover Owner email, Branch email, Branch username resolution,
session persistence in Capacitor Preferences, profile/tenant/Branch activity,
subscription access, logout, local session clearing, and safe error
classification. The connected phone's retained demo session survived the
debug upgrade and restart.

The checkout path is server-authoritative and explicitly requires online state,
an open register, a Branch scope, and a server decision of demo/non-fiscal.
The client does not set demo flags, readiness, Atomic mode, credentials, QR,
XML, signatures, reporting, clearance, or chain state. Standard/Atomic
production pathways are not client-forced. No ZATCA submission or fiscal
mutation was attempted.

## Printing, PDF, and lifecycle status

Mobile currently supports a receipt preview and a system-print adapter. It does
not reuse Electron printer IPC, and it has no direct Bluetooth/USB/network
printer implementation. Invoice detail receipt/share controls remain disabled
because the authenticated final snapshot/PDF read contract is not yet exposed
to mobile. The full Printing & Documents studio remains a web responsibility.

The app uses Capacitor Share, Preferences, Network, App, and Barcode Scanner.
No storage permission is requested; scoped app storage and the share plugin are
the intended file boundary. Android camera permission is declared and granted.

## Findings

- P0: none found. No credential exposure, cross-tenant query, fiscal bypass,
  or client-side duplicate financial finalizer was found.
- P1: none confirmed by static contracts or safe device checks. Auth, Branch
  dashboard, invoice reads, register guards, POS contract gating, and demo
  boundary are present.
- P2: write workflows for categories/products/units/stock/customers/suppliers/
  purchases/expenses, returns/credit notes, report detail, ZATCA retry, final
  invoice output, and Branch document-settings consumption remain incomplete.
  These require reviewed contracts and an authorised non-fiscal test tenant.
- P3: visual refinement, wider device matrix, Android input automation, and
  iOS signing/build setup.

## Tests and artifact

- `npm test`: passed
- `npm run typecheck`: passed
- `npm run build`: passed
- `npm run cap:sync`: passed
- `android/gradlew assembleDebug`: passed
- `git diff --check`: passed
- APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`
- APK SHA-256: `865aa10c48cf679c1075a2ebc63edc6917edd31d5bccd281fdb19c3e64fc1a9d`
- APK size: 47,547,341 bytes

## Recommended next work

The next functional milestone should be a narrow, authorised non-fiscal
Branch workflow: consume saved Branch document settings read-only, expose
invoice output/share when the server capability permits it, and add invoice
status refresh/retry only through the existing `zatca-submit` authoritative
actions. After that, implement suppliers/purchases/expenses and stock/unit
contracts one reviewed server surface at a time. The next UI-refinement phase
should begin only after these contracts have device coverage.

No unauthorised production or fiscal data was created, changed, submitted, or
cleared.
