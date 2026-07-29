# Kubri Branch mobile UI redesign — 2026-07-29

## Scope and design

This review branch replaces the engineering POC presentation with a dedicated, mobile-first Branch workspace. The visual system uses the production Kubri deep green (`#0F2419`), primary green (`#1B6B3A`), cream, paper white and restrained gold. Operational screens use a “branch ledger” hierarchy: a dark branded frame, readable paper surfaces and gold only for emphasis.

The full Owner workspace redesign is intentionally deferred. Owner authentication routes to a branded boundary screen so the role is not broken or confused with the completed Branch experience.

## Reused production assets

- Android launcher source and web launch icon: `public/brand/kubiri-app-icon.png`
- Adaptive foreground, native splash and compact header mark: `public/brand/kubiri-logo-mark.png`
- Sign-in and launch wordmark: `public/brand/kubiri-wordmark.png`
- Sign-in texture: the code-native geometric treatment used by the production authentication experience
- Arabic font: `public/fonts/NotoNaskhArabic-Regular.ttf`
- Approved WhatsApp contact: `+971 56 137 3210` (`971561373210`)

Android density launchers, round launchers, adaptive foregrounds and portrait/landscape splash images are generated from those approved sources. Adaptive icons use a Kubri deep-green background and provide a monochrome layer.

## Entry, authentication and session

The production-style sign-in is the default. It supports email and the existing Branch username resolver, then signs in through Supabase and loads the authoritative profile. Role selection is never trusted from the UI. Active account, tenant status and Branch access are checked; Super Admin is blocked with a web-workspace message.

Supabase session persistence and token auto-refresh provide “Keep me signed in” behavior without storing a raw password. Android autofill/password-manager attributes are present. Cold launch restores and revalidates the session; foreground resume revalidates it again. Logout clears the supported Supabase session.

No credentials or environment URL are committed. Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, real sign-in is visibly unavailable. Fixture entry exists only when `VITE_MOBILE_DEMO_MODE=true`; normal builds contain no role bypass.

The no-account action opens the approved Kubri WhatsApp number with localized English or Arabic text. It never sends automatically.

## Branch experience

The permanent rounded navigation contains exactly Home, New Sale and Invoices, with New Sale as the central till action. The top bar shows the Branch and register/connection state. The drawer preserves Home, New Sale, Invoices, Products, Stock, Customers, Purchases, Suppliers, Expenses, Register/Session, Reports, Settings/Profile, Help/Support and logout.

Home includes a featured Today’s Sales ledger, compact KPI cards, open-register session visibility, quick actions, recent invoices and low-stock attention.

New Sale includes product/barcode search, category chips, stock-aware product cards, repeated-add quantity behavior, scanner entry and a persistent cart dock. The scanner plugin owns the real native camera surface and cannot safely embed its preview inside the WebView; the app therefore uses a polished in-app scanner sheet that explains and launches the native camera. Static or fake camera imagery is not used.

The cart includes customer switching, quantity controls, VAT-aware preview totals and Cash, Card, Split and permitted Credit presentation. The success review includes print, native share, WhatsApp and New Sale/Home actions.

Invoices uses mobile cards, search, date, payment and session filters, summary/status presentation and an action affordance. Production invoice detail, return/refund, reprint and fiscal actions remain integration boundaries; the review fixture must not be mistaken for an authorized return implementation.

## Register, checkout and network boundaries

The review fixture shows a clearly open fixture session. Register open/close mutation remains dependent on the existing authoritative backend contract; no local-only register is created in a normal build.

Calculations in this branch are previews only. The mobile UI does not choose Simplified/Standard paths and does not call a production checkout function. Checkout is disabled offline, nothing is queued, the cart/request boundary is retained locally, and success is never presented as server-confirmed. Product, stock, customer, register and session state must be revalidated by the real integration after reconnect before a production attempt.

Printing continues through `SystemPrintAdapter`; native sharing uses Capacitor Share. Bluetooth ESC/POS and network printer interfaces remain abstractions and are not claimed as hardware-verified.

## Localization and accessibility

English and Arabic direction switching is supported, including right-side RTL drawer behavior. Safe-area padding protects top bars and the three-item bottom navigation. Controls have visible focus, disabled states, minimum touch sizing, semantic labels and reduced-motion handling.

## Integration status and known limitations

Fully implemented for review: shared entry branding, sign-in architecture, role routing, Branch Home, bottom navigation, drawer, quick POS, native scanner launch, persisted unsent cart, payment review, simulated success, invoice list/filter presentation, English/Arabic direction and offline enforcement.

Pending authoritative production integration or hardware validation: live dashboard/report data, register mutations, checkout, fiscal receipt/PDF, invoice detail/return actions, real Branch/Owner credentials, printer hardware, and embedded native camera overlay. No production invoice, payment, stock or database mutation is part of this branch.

