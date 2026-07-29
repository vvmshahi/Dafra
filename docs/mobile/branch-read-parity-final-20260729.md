# Branch authenticated read parity — 2026-07-29

## Safety boundary

This branch is built with production checkout disabled and production access in read-only mode. Register, catalog, customer, purchase, supplier, expense, return, stock and checkout mutations remain guarded. This review did not modify a production row.

## KPI comparison

The mobile and web applications use `get_dashboard_summary(p_start_date, p_end_date, p_branch_id)` for the current `Asia/Riyadh` calendar day and `get_register_session_summary(p_branch_id)` for the current register. The RPC defines posted-document, credit-note, payment and VAT treatment.

| KPI | Web source | Mobile mapping | Web value | Mobile value | Result |
|---|---|---|---|---|---|
| Today sales | dashboard `totalSales` | `totalSales` / `total_sales` | Not captured | Not captured | Physical authenticated comparison pending |
| Invoice count | dashboard `totalCount` | `totalCount` / `total_count` | Not captured | Not captured | Mapping aligned; physical comparison pending |
| Cash sales | dashboard `totalCash` | `totalCash` / `total_cash` | Not captured | Not captured | Physical comparison pending |
| Card sales | register `cardTotal` | normalized register `cardTotal` | Not captured | Not captured | Physical comparison pending |
| Expected cash | register `expectedCash` | normalized register `expectedCash` | Not captured | Not captured | Physical comparison pending |
| Opening cash | register `openingCash` | normalized register `openingCash` | Not captured | Not captured | Physical comparison pending |
| VAT | dashboard `totalVat` | `totalVat` / `total_vat` | Not captured | Not captured | Physical comparison pending |
| Average invoice | total/count | same calculation | Not captured | Not captured | Physical comparison pending |
| Register state | register summary | normalized open/closed state | Not captured | Not captured | Physical comparison pending |
| Recent count | recent scoped query | bounded scoped invoice rows | Not captured | Not captured | Physical comparison pending |

No value was hardcoded to manufacture parity.

## Invoice list and filters

`loadInvoices` constrains every query by authenticated tenant and branch, then by a Riyadh-derived UTC range. Results are ordered newest-first and capped at 100. Supported server filters are invoice/reference or customer search, today, yesterday, this week, this month, custom dates, session UUID, Cash, Card, Split, document type, lifecycle status, payment status, ZATCA status, original invoices and credit notes. Payment filtering first resolves payment invoice IDs through a date- and branch-scoped relation query.

The mobile screen includes active-filter chips, per-filter removal, clear-all, result count, loading, empty, error and retry states.

The schema has no efficient single read contract for distinguishing partially returned from fully returned invoices in a list. The smallest forward-only proposal is an authenticated, tenant/branch-scoped `get_mobile_invoice_list_v1(jsonb)` RPC returning paginated safe columns plus `return_state` derived from non-cancelled credit-note items. It should accept all current filters, validate a maximum page size, use Riyadh date bounds, and expose no fiscal artifacts. No migration was created or applied.

## Recent invoices and detail

Home recent cards and invoice-list cards call the same `loadInvoiceDetail(profile, invoiceId)` path. That query requires tenant ID, branch ID and invoice ID. Detail state lives at the Branch application boundary, clears before a new request and closes first on Android Back.

Detail includes issue time, customer/Walk-in, lines, quantities, units, unit prices, line discounts, subtotal, invoice discount, taxable amount, VAT, total, payment rows and split breakdown, document/lifecycle/payment/ZATCA states, session, linked return state, output eligibility and final-QR presence. Return calculation uses the existing scoped refundable-items RPC and linked non-cancelled credit notes. Returns remain disabled.

## Final receipt read

The existing `zatca-submit` status action is used read-only to obtain immutable-finalization capability, document kind, reporting/clearance state, QR presence and authoritative `canPrint`/`canShare` flags. Standard documents therefore remain gated until the backend reports clearance.

There is no authenticated read RPC returning the committed immutable final receipt snapshot. `prepared_snapshot` is internal checkout state and must not be queried directly, while rebuilding a receipt from mutable invoice tables would be a prohibited substitute. Receipt view, print preview and share are therefore disabled with an exact explanation.

The smallest forward-only proposal is `get_final_receipt_snapshot_v1(p_invoice_id uuid)`, security-definer with fixed search path, authenticated tenant/branch authorization, immutable finalized snapshot only, explicit Simplified/Standard readiness, safe seller/customer/item/payment fields, final QR, snapshot hash, and `can_print`/`can_share`. It must never return signatures, private keys, credentials or internal chain state. No migration was applied.

## Arabic and RTL

Arabic labels were added for changed Home KPIs, register state, recent invoices, invoice date presets, filters, detail metadata, empty/loading/error states, drawer modules, logout and offline state. Logical CSS properties and the existing Arabic font/RTL document direction remain in use; directional detail controls mirror under RTL. Credentialed on-device clipping, currency and Android Back review remains pending.

## Authentication and timings

The authenticated shell renders after authoritative role/scope validation and before the non-critical dashboard request completes. Tenant, subscription and branch checks now execute in parallel after profile resolution. Safe duration-only logs cover username resolution, Supabase sign-in, profile/scope validation, total authentication and KPI completion. No credential, token or account identifier is logged. Physical timing values remain pending user-entered authentication.

## Guarded writes and next phase

Still guarded: Open/Close Register, Add/Edit Product, stock adjustment, Add/Edit Customer, purchase creation/editing, supplier creation/editing, expense creation/editing, returns and checkout. The next non-fiscal-write phase requires one exact authorized tenant/branch or disposable environment, RLS verification, duplicate/stale mutation tests, server-confirmed refresh tests, and user approval for those writes. Fiscal checkout remains a separate later authorization.

## Physical findings

The final APK build/install result and SHA are recorded in the final report. Authenticated data comparison, receipt preview/share, English/Arabic review and session restoration cannot be claimed until the user enters credentials directly on the connected phone.
