# Final web printing refinements — 29 July 2026

## Dashboard corrections

The low-stock cards previously compared `stock_quantity` with
`min_stock_alert` without first establishing that the product was
inventory-managed. This allowed active service and non-stock products with zero
values to appear as low stock.

The shared warning rule now requires an active, available, non-service product
with `track_stock = true`, a positive alert threshold, and quantity at or below
that threshold. Package/unit definitions do not create independent stock
balances; they inherit the inventory-managed base product. Both Branch and
Owner Branch-detail dashboard queries apply the same tenant/Branch-scoped rule.

Recent invoices now display the authoritative `created_at` timestamp as a
locale-aware Saudi date and time. English and Arabic use the existing
Asia/Riyadh formatting contract; sorting is unchanged.

## Printing & Documents navigation

Receipts is the default area. Valid `?tab=` links persist through refresh and
browser history, while invalid values return to Receipts. The connected
secondary settings bar uses the authoritative Kubri dark green with distinct
selected, hover, and keyboard-focus states and supports horizontal overflow and
RTL layouts.

Printer Setup is hidden on the web because its printer enumeration, physical
printer selection, silent printing, and test-print controls require the native
Electron bridge. Browser-safe label calibration remains available under Barcode
Labels. Electron continues to expose the existing Printer Setup component,
saved receipt/A4 printer preferences, paper-width settings, silent-print
preference, enumeration, and test print. No Electron source, version, package,
or installer was changed.

## Barcode Labels audit

The intended workflow is functional: product and unit/package barcode loading,
copy quantity, label preset and dimensions, bilingual names, price fields,
preview, A4 sheets, thermal layouts, browser print/PDF output, missing-barcode
handling, and print-batch recording are connected. Device calibration remains
local to the device and browser-safe. No new inventory or barcode backend was
introduced and no confirmed workflow defect required a backend change.

## A4 themes

The existing themes were refined without changing invoice data:

- **Classic** improves hierarchy, table readability, buyer emphasis, and totals.
- **Modern Split** corrects dark-green text contrast and retains a clear
  monochrome print treatment.
- **Minimal Professional** strengthens invoice identity, spacing, tables, VAT,
  and totals.

Three additional themes are available:

- **Executive Green** — restrained Kubri branding and a strong summary.
- **Clean Ledger** — accounting-led table structure and numeric alignment.
- **Contemporary Border** — lighter framed sections and clear totals.

The selection grid provides localized names and descriptions, representative
thumbnails, keyboard-accessible radio semantics, an explicit selected state,
and the existing live A4 preview. All six use the same typed document renderer
and therefore preserve Arabic/RTL, invoice and credit-note states, pagination,
VAT, QR eligibility, and demo non-fiscal labelling.

## Persistence and safety

Theme selection continues through the authoritative Branch-scoped invoice
presentation settings contract; the preview and print routes consume that same
saved configuration. Migration
`20260729000500_extend_a4_invoice_themes.sql` only extends the existing
presentation validator's theme allowlist. It does not rewrite business rows,
broaden privileges, alter fiscal calculations, or add local-only production
persistence. Existing tenant and Branch authorization remains unchanged.

No invoice calculation, classification, Standard clearance gate, QR generation,
ZATCA state, atomic receipt behavior, payment, stock, or customer record was
changed.

## Verification

Passed:

- `npm test`
- `npm run test:printing-documents-workspace`
- `npm run test:phase4f-a4-templates`
- `node scripts/test-barcode-printing-ux.mjs`
- `npm run build`
- `git diff --check`

Focused contracts cover stock-warning eligibility and scope, Saudi English and
Arabic timestamps, URL/default navigation, web/Electron visibility, browser
calibration, the complete barcode workflow, all six themes, persistence
allowlisting, RTL/bilingual rendering, demo labelling, Standard gating,
pagination, and Modern Split print contrast.

The remaining deferred check is physical Electron printer hardware
compatibility. It requires the later dedicated Electron release-candidate task;
no such compatibility is claimed here.
