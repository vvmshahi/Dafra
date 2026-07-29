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

Only four selections are exposed:

- **Compact Price** is a true top-to-bottom price composition at 30 × 20 or
  40 × 25 mm.
- **Standard Product** separates product information, a scan-safe barcode
  region, and a side price block at 50 × 30 or 60 × 40 mm.
- **Detailed Product** uses an identity band, details row, bordered scan panel,
  and independent price panel at 70 × 40 or 80 × 50 mm.
- **Carton** is a wide split composition at 100 × 50 or 100 × 75 mm for an
  internal carton/package
  identifier with a large scan region. It does not claim courier or shipping
  support.

Previously saved `a4_sheet` and `custom` values normalize to Standard Product
without deleting stored history. The large Branch-default explanation banner
was removed. Content and appearance controls are compact; device offsets and
scale remain behind the collapsed **Printer adjustment** disclosure.

The default retail content is product name, black-on-white barcode graphic,
human-readable barcode number, and price. Unit/package, SKU, Branch/company
name, and secondary-language name are optional and disabled by default.
Carton price is also disabled by default. The strict four-entry renderer
registry is shared by preview and print; unknown/deprecated layout IDs resolve
to Standard rather than falling through to another valid renderer.

Barcode SVGs preserve their aspect ratio and include a library-owned quiet
zone plus physical white padding. EAN/UPC output receives wider quiet-zone
padding; barcode height never falls below the scan-safe minimum. The fit
contract reserves the scan region before optional text, warns for undersized
symbology/label combinations, and never applies accent colour to bars.

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
record. Migration
`20260730000400_make_inline_barcode_generation_idempotent.sql` serializes
generation on the exact product unit. Concurrent requests return the existing
active barcode after the lock instead of creating duplicates; no existing
active barcode is overwritten.

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

### Thermal receipt layouts

The focused audit found that the three saved thermal density values previously
shared one JSX composition and relied mainly on conditional CSS. They now map
compatibly to independent monochrome renderers. For the manual comparison
phase, the pre-refinement composition from parent commit `3af4277` is also
available as the explicitly selected `classic` layout:

- **Classic Receipt:** the original familiar top-to-bottom Kubri composition
  with centred identity, linear metadata and items, stacked totals, centred QR,
  and simple footer.
- **Compact Retail:** centred compact identity, inline metadata, dense rows,
  grand-total-led summary, centred QR, and short footer.
- **Structured Detail:** grouped seller data, bordered metadata, divided items,
  accounting totals, side QR on 80 mm and centred fallback on 58 mm.
- **Branded Modern:** framed identity, grouped item cards, highlighted payment,
  dedicated plain-background verification panel, and branded thank-you footer.

Thermal previews expose the use case, colour treatment, and width selection.
All four preserve cash/card/split payments, VAT, long names, demo labels,
Arabic/RTL, and the original QR eligibility/data.

All four temporary receipt choices continue to use the same immutable
`DocumentViewModel`:
the settings preview, POS success receipt, invoice history, dedicated receipt
route, browser print, supported PDF flow, and reprint therefore share the saved
layout and width. The existing `compact`, `standard`, and `detailed` stored IDs
remain unchanged, existing branches are not switched to Classic, and no layout
was removed. Migration
`20260730000300_allow_classic_thermal_receipt_layout.sql` admits only the
explicit `classic` value in the closed presentation validator; it performs no
row rewrite. Branch and tenant scope continue through the established
invoice-presentation settings contract.

Thermal seller blocks no longer render the redundant `Bill From`, `From`, or
`صادرة من` heading. Registered seller name, VAT, CR, address, enabled contacts,
document title, number, date, and time remain unchanged. The buyer model now
carries an authoritative Walk-in state derived from a null stored customer ID,
a null atomic customer snapshot, or the absence of a selected POS customer.
All four shared thermal compositions omit that complete buyer section without
a divider or reserved gap. Selected Individual and Business customers remain
visible, including applicable Business VAT and RTL content.

At 80 mm, Structured Detail places verification beside the fuller footer; at
58 mm it stacks a centred scan-safe QR. Classic and Compact Retail keep centred
QR blocks near the footer, while Branded Modern uses a dedicated double-rule
verification panel. Demo non-fiscal fixtures omit QR, and unavailable preview
fixtures no longer imply a printable QR. Arabic, RTL and bilingual fixtures use
isolated numeric/currency runs and wrapping name containers to avoid
narrow-paper clipping.

This work is presentation-only: it does not change calculations, VAT,
classification, QR payload/eligibility, signing, XML, checkout, finalisation,
reporting or clearance. Browser fixture captures verify the renderer at both
paper widths; compatibility with specific physical printer models remains
deferred until hardware testing.

The four-layout set is temporary. The final one- or two-layout reduction will
be chosen only after manual review in the feature-branch preview.

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

## Corrective A4 invoice-layout editor redesign

### Root-cause report

| Symptom | Root cause | Correction |
| --- | --- | --- |
| Save bar appeared roughly one quarter of the viewport above the browser bottom | The invoice workspace subtracted header height from a content region whose parent had already done that sizing | The application content owns the available height once; the A4 editor uses `height: 100%`, `min-height: 0`, and one internal scrolling canvas |
| Layouts 4–6 looked like repeated copies | The settings-facing runtime registry contained only the first three IDs, causing unsupported selections to fall through to shared/default rendering | One strict six-entry registry now maps every saved ID to a dedicated renderer, thumbnail, landmarks, and QR region |
| QR never appeared in the editor | The live preview explicitly passed `qrImageUrl: null` | The preview now generates deterministic fixture-only QR data for eligible simplified and standard states, while demo/unavailable states intentionally render none |
| A valid, modest JPEG reported a misleading 2 MB error | MIME, byte size, decodability, dimensions, and aspect-ratio checks were collapsed into one rejection message | The client sniffs file signatures, decodes the source, reports real filename/size/dimensions, separates hard validation from print-quality warnings, and never mislabels a dimension warning as a byte-size failure |
| Artwork upload returned a row-level-security error | The browser attempted to upload a document header immediately to a public bucket using a path/policy contract that did not match tenant and branch authorization | Extracted derivatives use a private bucket and authoritative tenant/branch path; the forward migration contains explicit role-aware insert, read, update, and delete policies |

The affected source layers were the A4 presentation model and normalizer,
settings editor, runtime renderer dispatch, shared document view model, print
CSS, storage path helper, storage migration, and focused verification scripts.
Receipt, barcode-label, invoice-calculation, payment, stock, customer, ZATCA,
Electron, and fiscal-data paths were not changed.

### Six materially distinct layouts

The editor and every actual A4 output surface consume the same
`DocumentViewModel`, strict template registry, colour tokens, artwork settings,
and QR eligibility:

1. **Classic Business** — top identity accent, balanced seller and invoice
   metadata, conventional buyer block, full table, lower-left QR, and
   lower-right totals.
2. **Modern Statement** — horizontal identity, statement-style metadata,
   top-right verification QR, restrained row rules, and a highlighted total.
3. **Minimal Editorial** — strong typographic hierarchy, open whitespace,
   quiet rules, oversized amount due, and centred footer verification.
4. **Executive Frame** — formal perimeter, framed seller/buyer regions,
   upper-right verification module, and a structured contact strip.
5. **Accounting Ledger** — dense party/metadata cells, explicit VAT columns,
   ledger summary, and lower-left accounting verification.
6. **Contemporary Modular** — large identity, independent buyer/metadata
   modules, framed items, total card, and a lower verification/payment card.

The card thumbnail is a compact compositional diagram of the corresponding
renderer rather than a reduced document screenshot. The expandable comparison
renders all six real A4 components from the same fixture, making accidental
fallback or repetition visually obvious.

`Bill From / صادرة من` remains a mandatory live-text seller section in every
layout. Artwork may decorate the page but cannot replace seller identity, VAT,
CR, buyer, totals, or verification data.

### QR, colour, type, and print rules

Preview QR content is marked `KUBRI_PREVIEW_ONLY` and can never be mistaken for
production invoice data. Eligible simplified and standard fixtures show it in
the layout-specific region; demo, ineligible, and unavailable fixtures do not.
Issued invoices continue to use their existing authoritative QR data and
eligibility contract.

Accent, heading, and body colours are independent saved settings. Presets
include Kubri green, black, white, navy, royal blue, emerald, burgundy, violet,
orange, teal, and charcoal. Custom values are normalized six-digit hex colours.
Unsafe heading/body contrast is blocked; accent foreground is chosen
automatically when requested. A white accent gains visible outlines and QR
quiet zones remain pure black on white.

All layouts use a stronger company-name and invoice-title hierarchy, tabular
numeric alignment, repeated table headers, non-splitting item/summary blocks,
and low-ink print overrides. Long tables paginate naturally without scaling
the entire invoice below a legible size.

### Safe letterhead extraction

The browser accepts source PNG, JPEG, WebP, or single-page PDF files up to
12 MB. It validates magic bytes rather than trusting the extension, rejects
corrupt/unsupported/encrypted PDFs and multi-page PDFs, and applies a small
minimum-decodable-dimension threshold. Sources below the recommended
approximately 1600 px print width receive a quality warning but remain usable.

The crop workspace shows the real source name, byte size, decoded dimensions,
zoom, and independently adjustable header/footer bands. A single-page PDF is
rasterized locally with PDF.js before cropping. Only high-quality WebP/PNG
derivatives are uploaded (maximum 8 MB each); the original file is never
stored. A branch can enable or disable each band, choose contain/cover,
height/spacing, and apply artwork to the selected layout or all layouts.

This workflow deliberately does not infer an arbitrary invoice layout from
pixels. Uploaded artwork is untrusted decorative content without reliable
field semantics; generating a layout from it could omit or obscure structured
seller, buyer, VAT, total, or QR information. Kubri therefore extracts only
bounded header/footer bands and keeps the six reviewed document compositions
authoritative.

Artwork objects use immutable paths:

`tenant/{tenant_id}/branch/{branch_id}/invoice-artwork/{uuid}/{header|footer}.{ext}`

The private `invoice-artwork` bucket is accompanied by authenticated
tenant/branch insert, select, update, and delete policies. The runtime resolves
short-lived signed URLs. Removing artwork from settings clears future use
without rewriting issued invoice snapshots; object deletion remains a separate
authorized operation.

## Controlled A4 migration rollout

The production rollout used branch
`feature/final-web-printing-ui-refinements-20260729`, starting from
`7f30ae66ede50c184f8517b4b6e421ffebd553d1`. The feature branch was not merged
or publicly deployed.

The ordered migration chain was retained rather than squashed:

- `20260729000500_extend_a4_invoice_themes.sql` extends a legacy validator's
  layout allowlist when that legacy function exists. It now safely defers to
  the final validator when a hosted database does not contain the legacy
  function.
- `20260729000600_extend_a4_invoice_branding.sql` extends the legacy branding
  validator and its historical public branding-upload policy when those
  objects exist. Migration 007 replaces the final presentation contract.
- `20260729000700_complete_a4_letterhead_presentation.sql` installs the complete
  six-layout validator, defaults, resolver and Branch-scoped settings-update
  RPC, and creates the private `invoice-artwork` bucket and initial policies.
- `20260729000800_harden_invoice_artwork_storage_policies.sql` replaces every
  invoice-artwork policy with one exact canonical-path expression, qualifies
  the outer `storage.objects.name`, and prevents UPDATE-based object
  relocation.
- `20260729000900_tolerate_optional_branch_presentation_columns.sql` makes the
  presentation default resolver compatible with the hosted schema's optional
  legacy Branch columns by reading them through `to_jsonb`. It does not add,
  drop or rewrite business data.

Review found that 007's SELECT, UPDATE-USING and DELETE predicates did not all
apply the same exact path validation as INSERT and UPDATE-WITH-CHECK. An
unqualified `name` inside a Branch `EXISTS` subquery could also bind to
`branches.name` instead of the Storage object name. Migration 008 applies the
same exact seven-segment UUID/region/extension pattern to INSERT, SELECT,
UPDATE-USING, UPDATE-WITH-CHECK and DELETE, and checks authoritative
tenant/Branch access. Branch profiles are limited to their own Branch;
Owner/Admin profiles may access Branches in their tenant. Anonymous,
unrelated, sibling-Branch and cross-tenant access is denied.

The relocation trigger function is `SECURITY INVOKER` with
`search_path=pg_catalog`; execute is revoked from `PUBLIC`, `anon` and
`authenticated`. The validator and presentation default/resolver helpers are
not browser-callable. Only the Branch-scoped update RPC retains authenticated
execute access.

Clean-database verification passed the complete migration history through
009. A second disposable run removed the optional hosted Branch columns before
applying 009; validator, SQL RLS and real local Storage API tests still passed.
The Storage matrix covered Owner and Branch create/read/replace/delete,
sibling-Branch, cross-tenant and anonymous rejection, malformed paths, invalid
regions/extensions, and attempted path relocation.

Production project `bkbphkpqcxuejozayrsy` records migrations 005, 006, 007, 008
and 009 in order. A post-deploy dry-run reports no pending migrations. The
`invoice-artwork` bucket is private, limited to 8 MiB derivatives and
JPEG/PNG/WebP MIME types. No invoice, payment, stock, customer, checkout, VAT,
QR, reporting, clearance or finalisation data is addressed by these migrations.

The local production build at `http://127.0.0.1:4173`, using source commit
`8c382b85f6ec99916cd7ff5d64c44cf286dcd993`, loaded an authorised Branch's
existing invoice settings and all six A4 layouts through the deployed
presentation RPC. The saved Minimal Editorial layout and the existing
bilingual/receipt-and-A4 settings rendered without mutation. Full production
artwork CRUD, re-login persistence, Owner/Admin UI coverage and existing-invoice
print/PDF/reprint checks remain live-session gates; no completion claim is made
for those checks until authorised user-entered sessions and approved artwork
fixtures are exercised.

### Persistence and issued-invoice stability

Migration `20260729000700_complete_a4_letterhead_presentation.sql` is a forward
migration and was intentionally not applied by this task. It creates the
private bucket and policies, expands the strict presentation validator/default,
and updates the existing branch-scoped settings RPC. It does not insert,
update, or delete invoice business rows.

New settings persist layout, language, print mode, accent/heading/body colour,
automatic foreground preference, header and footer derivative references,
crop/fit/size/spacing settings, and selected/all-layout scope. New invoices
snapshot the resolved presentation in their existing immutable identity
snapshot. Reprints use that snapshot. Existing V1 snapshots and invoices
without a presentation snapshot retain their compatibility fallback, so a
later branch preference change does not mutate previously issued documents.

The optional runtime storage-policy script
`npm run test:a4-artwork-rls` verifies owner insert/read/update/delete plus
foreign-branch, cross-tenant, and anonymous rejection when explicit test
credentials are supplied. It is not run against an unspecified environment.

Applying the forward migration and executing that authenticated runtime policy
test remain deployment-stage work. Multi-page, password-protected, and
encrypted PDF sources remain explicitly unsupported in this first extraction
version. Physical Electron printer validation is still deferred to the separate
Electron release-candidate task.
