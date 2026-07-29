# Kubri mobile production integration — 2026-07-29

## Result and safety mode

The Capacitor client now supports the existing production Supabase authentication and read contracts. The review APK is built in **production authentication + read-only data** mode. No production write or fiscal checkout was executed.

The other supported configuration modes are `operational-writes` and `production-checkout`. Both require an exact authorised tenant and Branch ID. Fiscal checkout additionally requires its explicit flag, an online connection and an open register. The mobile client does not currently call checkout; enabling the configuration flag alone cannot issue an invoice.

## Environment

Use `apps/mobile/.env.example`. Required public settings are the Supabase URL, anonymous/publishable key and application environment. Support URLs, WhatsApp number and access mode are public configuration. Local values belong in an ignored `.env.local` or the build environment.

Never provide a service-role key, database password, JWT signing secret, ZATCA private key/certificate secret, CLI token or deployment-management token. Missing required public configuration produces a safe disabled sign-in state.

## Authentication and session storage

The client reuses `resolve-branch-username` for Branch usernames and `signInWithPassword` for email/password authentication. It loads `user_profiles`, validates active state, verifies tenant active/suspension state, calls `get_tenant_subscription_access`, validates Branch state and routes from the authoritative role. Super Admin and unsupported roles are blocked.

Branch identifier handling exactly mirrors the web contract: trim leading/trailing whitespace, lowercase, then accept only 3–32 ASCII lowercase letters, numbers, underscore or hyphen. Internal spaces are not removed and display names are not converted into usernames. Resolver failure, post-resolution password rejection, network failure and profile/tenant/Branch state failures now produce separate safe messages and sanitised category-only diagnostics.

The July 29 authentication investigation confirmed that the spaced identifier “Kubri Trading” is not accepted by the authoritative username contract. The corresponding unspaced normalized identifier resolves through the production Edge Function, while the observed phone attempt then reached Supabase Auth and was rejected in the invalid-credentials category. No password or mapped email was captured, and no account was changed.

Supabase session JSON is stored through Capacitor Preferences under `kubri-mobile-auth-v1`, in Android application-private storage. It is not a raw password and is never logged or displayed. Supabase refreshes tokens; cold start and app resume reload the profile and tenant/Branch scope. Logout clears both Supabase state and the native preference. Capacitor Preferences is application-private storage, not hardware-backed encryption; a keystore-backed storage plugin remains a hardening option before store release.

## Reused production data contracts

- Owner: `get_dashboard_summary`, scoped `branches`, and `get_register_session_summary`.
- Branch dashboard: `get_dashboard_summary` and `get_register_session_summary`.
- Products: Branch- and tenant-scoped active/available product query.
- Customers: Branch- and tenant-scoped active customer query.
- Invoices: Branch- and tenant-scoped recent invoice query including customer, payments, lifecycle and ZATCA state.
- Register mutations: `open_register_session` and `close_register_session`.
- Barcode: exact barcode query constrained by authenticated tenant and Branch.

Five requests load the initial Branch workspace concurrently: dashboard, register, products, customers and invoices. Owner load uses three concurrent requests. Product/customer limits are 200 and invoice limit is 50. No service-role access, unscoped tenant download or N+1 barcode lookup is used.

## Mutations and checkout

Register Open/Close wrappers reuse the web RPC parameter names. They throw before network access unless access mode permits writes and the authenticated tenant and Branch exactly match the configured authorisation boundary.

Product/customer mutation implementations, checkout submission, lost-response reconciliation and returns are intentionally not enabled by this read-only integration. Production checkout must consume the existing server classification and retain an idempotency identifier; it must never be queued offline or independently classify the document in mobile code.

Before any production write, the user must identify an existing authorised test account, tenant and Branch. The user types the password directly into the app. Fiscal implications and synthetic test records must be agreed before enabling operational writes. A permanent invoice requires a separate explicit approval.

## Invoice, print and return boundaries

Real invoice cards consume server lifecycle, ZATCA state, payment methods and print eligibility. Standard final output is eligible only when cleared. Complete immutable receipt retrieval, PDF/reprint/share integration and credit-note/return execution remain blocked until an authorised account and safe test record are provided.

## Physical review

The production-configured read-only APK installed successfully on the authorised Xiaomi device. It displayed an enabled production sign-in with no environment warning and no fixture bypass. Credentials were not supplied, so authenticated Owner/Branch data, cold restoration and logout were not exercised physically.

Remaining checks: authorised real login, KPI comparison with web for the same Riyadh date/Branch, Arabic real-data labels, secure share/print, keystore storage assessment, and all separately approved mutations.
