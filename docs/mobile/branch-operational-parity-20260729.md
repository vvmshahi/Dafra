# Branch operational parity — 2026-07-29

## Release boundary

This branch remains an online-only, production read-only mobile build. `VITE_MOBILE_ACCESS_MODE=read-only`, no tenant/branch write scope is configured, and `VITE_MOBILE_PRODUCTION_CHECKOUT=false`. No checkout RPC is called and no invoice, payment, stock, fiscal, register, customer, supplier, purchase, or expense record was created or changed during this work.

## Web/mobile matrix

| Feature | Web route/component and contract | Mobile state | Permission / write risk | This phase / deferred |
|---|---|---|---|---|
| Dashboard | `/branch/dashboard`, `BranchDashboardPage`, `get_dashboard_summary` | Working read | Branch, none | Riyadh-day scoped RPC and branch-scoped reads wired; physical value comparison remains |
| Open/Close register | `usePosSession`, `open_register_session`, `close_register_session` | Implemented, guarded | Branch, non-fiscal write | Forms, summaries, refresh and exact tenant/branch build guard added; execution requires an explicitly authorized target |
| New Sale | `/pos`, product/customer/register contracts | Partial | Branch, fiscal at submit | Real scoped catalog, scanner, cart and customer data; production submit intentionally disabled |
| Invoices/Sales | `/invoices`, `InvoicesPage`, scoped `invoices` query | Partial | Branch, read | Recent bounded list and number/customer search; complete backend filter sheet deferred |
| Invoice detail | `/invoices/:id`, `InvoiceDetailPage` | Working read | Branch, read | Branch/tenant-scoped items, totals, payment and lifecycle detail |
| Receipt / print / reprint | Invoice detail receipt contracts | Disabled with reason | Branch, read/native | Native share summary is safe; authoritative fiscal receipt rendering/print remains deferred |
| Returns | Invoice detail + `get_invoice_refundable_items` | Intentionally excluded | Branch, fiscal/stock write | Deferred until full return contract is integrated |
| Products | `/products`, `ProductsPage`, scoped products/barcode/unit contracts | Working read, mutations blocked | Branch, inventory write | Real list/search; add/edit/unit/stock adjustment require disposable or explicit authorized scope |
| Stock | Products/stock-adjustment contract | Disabled with reason | Branch, inventory write | No direct `stock_quantity` mutation; dedicated mobile contract deferred |
| Customers | `/customers`, `CustomersPage`, customer modal contracts | Working read, mutations blocked | Branch, non-fiscal write | Real list/search; add/edit/duplicate validation deferred pending authorized test target |
| Purchases | `/purchases`, `PurchaseHistoryTab`, `purchases`/`purchase_items` | Working read | Branch, inventory write | Real branch-scoped read-only list; create/details deferred |
| Suppliers | `/suppliers`, supplier table + `get_supplier_purchase_totals` | Working read | Branch, non-fiscal write | Real branch-scoped read-only list; create/edit deferred |
| Expenses | `/expenses`, `expenses` + categories | Working read | Branch, non-fiscal write | Real branch-scoped read-only list; filters/create/edit/attachment deferred |
| Reports | Branch reports routes/RPCs | Disabled with reason | Branch, read/export | No approved consolidated mobile contract |
| ZATCA status | Dashboard/invoice status fields | Partial read | Branch, fiscal visibility | Invoice status shown; attention aggregation deferred |
| Help/Support | Help routes/support link | Disabled with reason | Branch, none | Login WhatsApp contact remains real; workspace help contract deferred |
| Profile | Settings/profile | Disabled with reason | Branch, account write | Deferred |
| Logout | Supabase Auth sign-out | Working | Authenticated user | Real local/server sign-out |
| Owner/Admin | Admin dashboard contracts | Partial foundation | Owner/Admin | Generic routing and read foundation preserved; separate phase |

Visible drawer shells were replaced by real read-only screens for products, customers, purchases, suppliers and expenses. Stock, reports, settings and help show an accurate unavailable-contract explanation. The redundant Register drawer destination was removed; register state/actions remain on Home. Notification, advanced invoice filters, summary, receipt printing and production confirmation are disabled with reasons.

## Data and KPI contracts

The dashboard uses `get_dashboard_summary(p_start_date, p_end_date, p_branch_id)` with both dates set to the current `Asia/Riyadh` calendar day. The backend remains authoritative for posted/cancelled documents, payment and VAT treatment. Mobile also calls `get_register_session_summary(p_branch_id)` for opening cash, cash/card totals, expected cash, session sales and count. Products, customers, invoices and low-stock reads include both authenticated `tenant_id` and `branch_id`.

Displayed today metrics are total sales, invoice count/average, VAT, expected cash, opening cash and current-session card sales. Register status and recent invoices are server backed. Session duration, latest-transaction timestamp and aggregated ZATCA attention still require implementation/physical parity comparison.

## Invoice and register details

The list fetch is bounded to 50 recent branch invoices. Search currently operates on that bounded set and is therefore not a complete backend-filter implementation. Detail retrieval is independently constrained by tenant, branch and invoice ID and includes items, units, subtotal, discount, VAT, total, payments, document/status fields, session ID and print eligibility.

Register mutations reuse the web RPCs and require all of: non-read-only access mode, configured authorized tenant, configured authorized branch, and an exact authenticated profile match. RLS/backend permissions remain authoritative. The current build cannot execute them.

## Products, customers, purchases, suppliers and expenses

All five destinations now load real branch/tenant-scoped records and expose no misleading mutation buttons. Products and customers reuse the production list shapes. Purchases include supplier and item count, suppliers include contact/VAT/CR fields, and expenses include date/vendor/amount/payment/VAT. Mutation parity, validation and disposable-environment tests remain blockers.

## Cart and payment

The cart persists locally without storing or queueing an invoice/payment. Walk-in is the default customer. Only Cash, Card and Split exist; Credit was removed. Offline mode blocks billing/checkout. Production confirmation is disabled and clearly labelled. No simulated production success is reachable; fixture success is limited to an explicit demo build.

## Authentication and performance

Email and authoritative branch-username login remain generic; role/profile/tenant/branch/subscription validation is unchanged and Super Admin remains excluded. The authenticated shell renders after authoritative profile resolution while dashboard reads load afterward. No credentialed physical timing capture was performed in this phase, so no before/after millisecond claim is made.

## Controlled checkout prerequisites

Before checkout can be considered: complete backend invoice filters; integrate authoritative receipt/print and return eligibility; complete and disposable-test product/customer/register and permitted operational mutations; validate every changed Arabic screen on-device; compare KPIs against web for the same branch/date/session; implement authoritative payload/idempotency/reconciliation against the existing fiscal service; then authorize one exact tenant/branch through backend permission and build configuration. Offline invoice issuance and queuing remain out of scope.

## Verification status

Static contracts, TypeScript, web build, Capacitor Android sync, Gradle debug assembly and APK hashing are recorded by the release report. Physical authenticated review requires the user-entered credentials and is not claimed by this document.
