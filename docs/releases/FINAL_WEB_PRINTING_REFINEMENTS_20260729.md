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

Recent invoices now display the authoritative `created_at` timestamp in
separate Date and Time columns. English and Arabic use the existing
Asia/Riyadh formatting contract; sorting and row navigation are unchanged.
The Branch-title block is physically anchored to the content's left edge while
the title itself retains `dir="auto"`, so Arabic, English, and mixed names keep
the same placement without corrupting their reading direction.

## Printing & Documents navigation

Receipts is the default area. Valid `?tab=` links persist through refresh and
browser history, while invalid values return to Receipts. The connected
secondary settings bar is now a light compact segmented control with a Kubri
green active segment, distinct hover/focus states, horizontal overflow, and RTL
keyboard behavior.

Printer Setup is hidden on the web because its printer enumeration, physical
printer selection, silent printing, and test-print controls require the native
Electron bridge. Browser-safe label calibration remains available under Barcode
Labels. Electron continues to expose the existing Printer Setup component,
saved receipt/A4 printer preferences, paper-width settings, silent-print
preference, enumeration, and test print. No Electron source, version, package,
or installer was changed.

## Barcode Labels contract

Product and unit records remain the only owners of barcode identity,
product/unit association, active state, price, and product data. Printing &
Documents owns Branch-wide presentation defaults. Product and batch flows own
the selected unit, copies, and per-job selection. Barcode values are never
duplicated into presentation settings.

Only four new selections are exposed:

- **Compact Sticker** prioritises price and scanning in a 38 × 25 mm layout.
- **Standard Product Sticker** balances Branch, product, unit, barcode, and
  price in a 50 × 30 mm centred layout.
- **Detailed Product Sticker** uses bordered information regions for SKU,
  unit, bilingual names, price, and barcode.
- **Carton Label** is a 100 × 50 mm landscape internal carton/package
  identifier with a large scan region. It does not claim courier or shipping
  support.

Previously saved `a4_sheet` and `custom` values normalize to Standard Product
without deleting stored history. The large Branch-default explanation banner
was removed. Content and appearance controls are compact; device offsets and
scale remain behind the collapsed **Printer adjustment** disclosure.

The batch dialog is centred inside the application workspace using
`--app-sidebar-width`, bounded in both dimensions, and keeps its branded header
and footer fixed while only its body scrolls. Existing focus trapping, Escape,
ordered queues, copy counts, preview, browser print/PDF, and print auditing are
preserved.

Missing unit barcodes now offer **Generate barcode** inline. The action calls
the existing `generate_internal_product_unit_barcode` security-definer RPC with
the exact selected unit ID. That server contract derives tenant/Branch/product
scope, generates a Code 128 value, enforces Branch uniqueness, and persists
through `create_product_unit_barcode`. The queue reloads authoritative unit
barcodes and selects the created primary value, so Product Edit sees the same
record. Existing active barcodes are never overwritten.

## Print-layout research and design map

Research reviewed accounting-ledger invoices, asymmetric corporate invoices,
minimal professional layouts, Arabic-first RTL composition, A4 HTML pagination,
and 58/80 mm thermal receipt practices. Reference categories included bilingual
Arabic invoice generators, multi-layout invoice datasets, HTML print guidance,
and thermal-width receipt tools. No template assets, third-party logos, or
copyrighted layouts were copied.

The extracted principles are: composition must mirror in RTL; semantic table
headers repeat across pages; line rows, totals, and verification regions avoid
page breaks; QR codes stay on plain quiet-zone backgrounds; and grayscale
hierarchy must remain understandable without colour.

The six A4 layouts now use materially different component compositions:

- **Classic Formal:** seller/logo header, metadata rail, buyer block, formal
  table, and QR beside payment and totals.
- **Modern Split:** a narrow seller/metadata/QR side rail and a separate white
  transactional column with minimal table dividers.
- **Minimal Professional:** opposing title and seller, open party blocks,
  oversized total, and bottom metadata/QR/payment row.
- **Executive Green:** branded top band, invoice/total summary card, unequal
  party columns, and QR between totals and payment.
- **Clean Ledger:** compact metadata grid, ledger-cell parties, dense numeric
  table, ledger summary, and lower verification row.
- **Contemporary Frame:** floating title, separate seller/buyer/metadata cards,
  framed table, totals card, and independent QR/payment card.

All six consume the same immutable `DocumentViewModel` primitives, but no longer
share one layout wrapper. They vary metadata, party, table, total, QR, and footer
placement. Semantic tables repeat headers; rows and summary/verification blocks
avoid splitting. Print CSS removes high-ink Modern Split and Executive
backgrounds while preserving borders and hierarchy in grayscale.

The three saved thermal density values now map compatibly to distinct layouts:

- **Compact Retail:** centred compact identity, inline metadata, dense rows,
  grand-total-led summary, centred QR, and short footer.
- **Structured Detail:** grouped seller data, bordered metadata, divided items,
  accounting totals, side QR on 80 mm and centred fallback on 58 mm.
- **Branded Modern:** framed identity, grouped item cards, highlighted payment,
  dedicated plain-background verification panel, and branded thank-you footer.

Thermal previews expose the use case, colour treatment, and width selection.
All three preserve cash/card/split payments, VAT, long names, demo labels,
Arabic/RTL, and the original QR eligibility/data.

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
Arabic Date/Time columns, stable title placement, URL/default navigation,
web/Electron visibility, four label compositions, deprecated-value fallback,
authoritative barcode generation, browser calibration, all six A4
compositions, all three thermal configurations, persistence allowlisting,
RTL/bilingual rendering, demo labelling, Standard gating, pagination, and
grayscale contrast.

The remaining deferred check is physical Electron printer hardware
compatibility. It requires the later dedicated Electron release-candidate task;
no such compatibility is claimed here.

## Final A4 workspace redesign

The Invoices workspace now uses compact primary and secondary segmented
navigation, a two-pane editor with a bounded sticky preview, page-fit and zoom
controls (including fit-page and fit-width), and a persistent save/reset status
bar. The primary navigation, document section navigation, and actions remain
visible while only the configuration/preview canvas scrolls. The six layouts are labelled
Classic Business, Modern Split Panel, Minimal Editorial, Executive Frame,
Accounting Ledger, and Contemporary Cards; each retains its distinct document
composition and QR placement.

Classic Business uses a conventional identity/title split with QR at lower
left and totals at lower right. Modern Split Panel uses an asymmetric branded
side rail with its verification block in the rail. Minimal Editorial uses
typographic rules, generous whitespace, and a centred footer QR. Executive
Frame places QR in its upper information frame. Accounting Ledger uses dense
party and numeric grids with a lower verification row. Contemporary Cards uses
separate party, metadata, total, and bottom verification cards. Party headings
use Bill From/Bill To (صادرة من/صادرة إلى) while retaining every authoritative
seller and buyer field.

A branch may now save an A4 accent colour independently from its layout, using
ten presets or a validated custom hex value. Contrast-safe foreground colour is
derived at render time and the QR remains monochrome. Optional first-page
header artwork accepts only PNG, JPEG, and WebP up to 2 MB, uses immutable
branch-scoped storage paths, and saves enablement, contain/cover fit, height,
and spacing. It remains decorative: seller, buyer, tax, total, and verification
details continue to render as document text.

Migration `20260729000600_extend_a4_invoice_branding.sql` extends only the
strict presentation validator and existing branch-assets insert policy for
immutable header images. It does not change invoice issuance, fiscal data,
customer data, QR payload generation, ZATCA behavior, or production rows.

Design research covered ZATCA’s current e-invoice specifications and QR
requirements, W3C paged-media and fragmentation guidance, WCAG contrast
guidance, and reputable accounting invoice examples. The applied principles
are a fixed A4 page box, repeated table headers, non-splitting rows and summary
blocks, a white QR quiet zone, explicit seller/buyer hierarchy, tabular numeric
alignment, low-ink colour use, and contrast-safe accent foregrounds. PDF header
upload remains deferred because the web application has no authoritative
server-side PDF rasterisation path; PNG, JPEG, and WebP are supported.
