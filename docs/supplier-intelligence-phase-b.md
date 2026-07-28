# Supplier Intelligence Phase B

## Architecture audit

### Supplier model and workflows

- `public.suppliers` is a tenant- and branch-scoped master record. It stores English and Arabic names, VAT/CR identifiers, contact fields, payment terms, notes, and `is_active`.
- The existing `/suppliers` screen lists active suppliers, searches the loaded branch list, opens `SupplierDrawer` for create/edit, and deactivates with `is_active = false`. Phase B keeps those mutations unchanged and adds navigation to `/suppliers/:id`.
- A supplier is branch-local. Existing purchase write guards require the purchase and supplier to share both tenant and branch.
- Phase B reads supplier identity through scoped reporting RPCs. The edit action still uses the existing RLS-protected supplier query and drawer.

### Purchase and receiving model

- `public.purchases` is the commercial document header. Stored truth used by reporting is `subtotal`, `vat_amount`, and `total_amount`; the intelligence functions never recalculate historical totals from current product prices.
- `public.purchase_items` belongs to a purchase and stores name, quantity, unit cost, line total, VAT, discount, receiving state, and optional inventory/product matches.
- Product Units Phase 1 added immutable package snapshots to purchase items: `product_id`, `product_unit_id`, unit version, package/base quantity, conversion, unit names/codes, and package/base cost.
- The current detailed purchase drawer still writes legacy inventory-item lines and does not always populate the newer product/unit snapshot columns. Product names and costs remain stored, but a historical unit or localized product name is not reliable for every legacy line. Intelligence reports show a neutral unit fallback and only show base quantity when every grouped row has a stored base quantity.
- `purchase_stock_movements` records confirmed receiving and its stock reversal. It is not purchase-total truth and is never aggregated by Phase B.
- `product_stock_receipts` is a separate direct product receiving workflow. It can reference a supplier and mutates stock through its own RPC, but it is not a `purchases` document and has no authoritative supplier purchase-document total. Phase B therefore does not count it as supplier commercial activity.
- Purchase receiving changes stock only through the existing confirmation RPC. Pending detailed purchases do not change stock. A confirmed receiving cancellation writes reversal movement rows and marks the purchase reversed/cancelled.

### Authoritative purchase states

The existing `reporting_counted_purchases_v.is_counted` rule remains the single qualification contract:

- Count a `simple_bill` or legacy `bill_only` purchase only when document `status = 'posted'`.
- Count a `detailed_receiving` or legacy `receive_stock` purchase when `receiving_status IN ('confirmed', 'confirmed_legacy')`.
- Preserve the compatibility case where a detailed purchase has `receiving_status = 'not_applicable'` and `status = 'posted'`.
- Exclude `status = 'cancelled'`.
- Exclude `receiving_status IN ('cancelled', 'reversed')`.
- Draft and `pending_confirmation` detailed purchases are incomplete and excluded.
- The schema has no purchase `failed`/`voided` status. Unknown future states do not become counted unless the trusted view is deliberately changed.

All Phase B summary, trend, timeline, history, payment, product, and report-list queries join this view and require `is_counted IS TRUE`.

### Supplier returns and payment status

- There is no supplier return, supplier debit/credit document, or commercial purchase-return table.
- A receiving reversal only undoes stock; it is not an authoritative supplier credit. Reversed documents are excluded rather than subtracted.
- Phase B exposes Gross Purchases and does not expose Returned Amount or Net Purchases.
- `purchases.payment_status` is constrained to `paid`, `partial`, or `unpaid`. It is entered and editable in the purchase workflow and is not derived from payment allocations or a ledger.
- Payment-status filters and breakdowns are informational only. They do not calculate outstanding balances, aging, allocations, or payables.

### Existing reports, print, and export

- Existing purchase reporting uses `reporting_counted_purchases_v` through reporting summaries.
- Customer intelligence provides the closest hardened pattern: scoped JSON RPCs, bounded histories, server-side list totals, browser-print PDF, local Arabic/Riyal fonts, HTML escaping, and RTL layout.
- General reports also have jsPDF infrastructure, while customer-specific reporting already uses browser print. Supplier Phase B follows the browser-print pattern and adds no PDF dependency.
- There is no safe generic CSV/XLSX supplier export utility. Spreadsheet export remains deferred; PDF is the supported bounded export.

### Authorization and visibility

- `reporting_resolve_scope(uuid)` is the trusted resolver.
- Owner: no requested branch means tenant-wide report scope; a requested branch must belong to the owner tenant.
- Branch User: scope is forced to the assigned branch; another branch is rejected.
- Superadmin: follows the existing trusted resolver. A branch can establish the target tenant. A tenant-bound superadmin profile can use tenant scope; otherwise a branch is required.
- Supplier identity is revalidated inside every RPC against resolved tenant/branch scope.
- Product and product-unit filters are also validated inside every RPC.
- The three new functions are `SECURITY DEFINER`, use `search_path = public, pg_temp` and `row_security = off`, revoke all default/public execution, and grant only `authenticated`.
- Phase B adds no base-table grants and uses no browser service-role credential.

## Authoritative metrics

- Gross Purchases: sum of stored `purchases.total_amount` for qualifying counted documents after all selected filters.
- Purchase Count: count of the same qualifying documents.
- Average Purchase: Gross Purchases divided by Purchase Count; zero when the count is zero.
- Last Purchase: most recent qualifying document by purchase date, creation time, then ID. It includes supplier bill reference when recorded, branch, total, document/receiving state, and informational payment status.
- Purchase Frequency: average calendar-day gap between qualifying purchase dates. It is absent for zero or one purchase.
- Days Since Last Purchase: Saudi-local current date minus the latest qualifying purchase date in the selected result.
- Recent Activity: rolling current 30 days versus the preceding 30 days, using the selected scope/product/unit/payment dimensions. Percentage change is absent when the previous value is zero.
- Top Products: stored purchase-item grouping by product and product unit, with snapshot-name/unit fallbacks, package quantity, base quantity only when meaningful, stored line amount, distinct purchase count, latest purchase, and quantity-weighted stored unit cost.
- Timeline: daily buckets through 62 days, weekly buckets through 730 days, and monthly buckets beyond that. It uses qualifying stored document totals and reconciles with Gross Purchases.
- Payment Status Summary: document count and gross stored total for recorded `paid`, `partial`, and `unpaid` states. It remains informational.

Product or unit filters select qualifying documents that contain the requested stored item identity; Gross Purchases continues to use each selected document's stored final total. Top-product amounts continue to use stored item rows.

## API contracts

- `get_supplier_intelligence(jsonb) -> jsonb`: supplier identity, summary, rolling comparison, informational payment summary, top products, timeline, most-active branch, normalized filters, and resolved scope.
- `get_supplier_intelligence_history(jsonb) -> jsonb`: stable purchase history with page metadata; maximum page size 100 so PDF can request one bounded page.
- `list_supplier_intelligence(jsonb) -> jsonb`: server-side supplier search, activity/minimum/payment/product/unit/date/branch filters, stable whitelisted sorting, page rows, and totals across the full filtered set; maximum page size 50.

The contracts accept only documented JSON keys. Identifiers, dates, payment status, sort values, direction, page, page size, and minimum gross are validated. No dynamic SQL is used.

## Index rationale

`supplier_intelligence_documents_scope_idx` begins with tenant, branch, supplier, and descending deterministic purchase order. It includes lifecycle, payment, total, and bill reference fields used by reporting. Its predicate removes documents already known to be cancelled/reversed.

The existing `purchase_items_purchase_idx` already supports document-to-item joins, so Phase B does not add a duplicate purchase-item index.

## UI and accessibility

- `/suppliers/:id` provides supplier identity, edit/PDF/report actions, six core metrics, shared filters, accessible HTML timeline, recent comparison, transparent insights, product/unit table, informational payment breakdown, and server-paginated history.
- `/reports/suppliers` provides debounced search, shared filters, activity/minimum filters, stable server sorting, full-filter totals, responsive desktop table/mobile cards, and filter-preserving detail links.
- Tables use real headers, filters are labelled, preset controls announce pressed state, loading/error content uses live/alert regions, sorting changes are announced, and chart meaning is available in screen-reader text rather than color alone.
- English and Arabic resources have exact key parity. Long identity/product names wrap; directional data uses `dir="auto"` or isolated LTR values.
- Motion is limited to existing quick state/press feedback. Reporting interactions do not add decorative or blocking animation.

## Manual test checklist

### Supplier detail

- [ ] Supplier with no purchases shows zero-safe metrics and directed empty state.
- [ ] Supplier with one purchase shows no fabricated frequency.
- [ ] Supplier with many purchases reconciles summary, timeline, and history.
- [ ] Piece and Carton appear as separate unit rows.
- [ ] Long English and Arabic supplier/product names wrap without overlap.
- [ ] Today, Last 7 days, Last 30 days, This month, Previous month, This year, and Custom work.
- [ ] Custom range validates start/end behavior.
- [ ] Product and unit filters update every surface consistently.
- [ ] Owner branch filter stays within allowed tenant branches.
- [ ] Branch User cannot select or request another branch.
- [ ] Paid, partially paid, and unpaid filters remain informational.
- [ ] Empty product/unit result shows a useful state.
- [ ] Missing supplier bill reference shows “Not recorded,” not a UUID.
- [ ] Inactive supplier retains historical activity and shows inactive notice.
- [ ] RPC failure shows localized safe copy, not a database message.
- [ ] Existing edit drawer still saves supplier fields.

### Supplier reports

- [ ] Name, Arabic name, phone, VAT, and email search.
- [ ] Page size remains 25 and next/previous pages are stable.
- [ ] Every supported sort works in ascending and descending order.
- [ ] Page totals represent the full filtered set, not the visible page.
- [ ] Active/no-activity filters return the expected suppliers.
- [ ] Minimum gross and payment status combine with other filters.
- [ ] Row navigation preserves date/branch/product/unit/payment filters.
- [ ] Mobile cards remain readable and keyboard links remain visible.
- [ ] Arabic RTL controls, table, names, amounts, and arrows are usable.

### PDF

- [ ] English print preview and Save as PDF.
- [ ] Arabic RTL print preview and Save as PDF.
- [ ] Local Arabic and Saudi Riyal fonts load.
- [ ] Long names wrap.
- [ ] Multiple pages repeat table headers and avoid split rows where practical.
- [ ] Applied filters and selected scope are shown.
- [ ] Latest-100 history notice appears when required.
- [ ] Summary totals still represent the full filtered range.
- [ ] Required accounts-payable/accounting disclaimer is present.

### Security

- [ ] Owner tenant-wide access.
- [ ] Owner allowed branch access.
- [ ] Branch User assigned-branch access.
- [ ] Manipulated cross-branch supplier/filter rejected.
- [ ] Manipulated cross-tenant supplier rejected.
- [ ] Anonymous execution rejected.
- [ ] Superadmin behavior matches the trusted resolver and requires a target scope where applicable.

## Production rollout and containment

1. Confirm the release starts from `v1.4.0` / `d7bb7a4`.
2. Run `01_preflight.sql` unchanged in the intended database and require a PASS summary with zero FAIL. Save all four preservation fingerprints.
3. Review all REVIEW/INFO rows, especially real status distributions and current grants.
4. Apply the single migration in a controlled maintenance window.
5. Run `02_post_migration_verification.sql`; require zero FAIL and compare every fingerprint with the saved preflight output.
6. Run `03_isolated_runtime_test.sql`; review PASS/SKIP results and investigate any error. It always rolls back.
7. Deploy the application only after database verification and the local regression/build suite pass.
8. Manually test Owner, Branch User, Arabic, mobile, and PDF workflows.

If verification fails before commit, stop and investigate; do not deploy the UI. If containment is needed after migration, remove authenticated execution from the three new RPCs to disable the new read surfaces immediately, then deploy the prior application release. The index and functions are additive and can be dropped in a separately reviewed rollback migration. Historical supplier, purchase, item, stock, product-unit, invoice, barcode, checkout, and ZATCA rows require no data rollback because Phase B does not mutate them.
