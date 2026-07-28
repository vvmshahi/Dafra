# Dafra credit-note model audit

Date: 2026-07-26
Scope: architecture, workflow, finance, VAT, inventory, ZATCA, authorization,
data contracts, UX, and tests
Mode: read-only audit; no production code or database changes

## Executive findings

1. A credit note is created as a new, immediately posted commercial document.
   The original invoice and its lines are not edited.
2. The authoritative commercial operation is
   `create_partial_credit_note_with_refund(jsonb)`, which delegates to the
   package-aware `create_partial_credit_note(jsonb)` dispatcher. The operation
   writes the credit-note invoice, its lines, refund ledger rows, payment rows,
   and any selected stock restoration in one PostgreSQL transaction.
3. Partial values are derived from the original stored invoice-line amounts.
   VAT, discount, subtotal, and total are apportioned by returned quantity,
   rounded to two decimals, and capped by the remaining stored amounts. A final
   return consumes the exact remaining amount, preventing rounding residue.
4. The application records a completed refund allocation in Dafra. It does not
   call a card processor, bank, or cash drawer and therefore does not prove that
   money was physically returned to the customer.
5. Repeated partial credits are concurrency-serialized and cannot exceed the
   remaining line quantity or original paid total.
6. Product-unit sales retain immutable Piece/Carton and conversion snapshots.
   Package returns restore base stock using those snapshots. Legacy lines do
   not have equivalent immutable stock metadata and still consult current
   product flags.
7. Stock restoration is optional for eligible physical goods, mandatory as a
   user decision when eligible lines are selected, and suppressed for service
   businesses, stock-disabled branches, services, and untracked products.
8. Simplified production credit notes can use the atomic checkout/finalization
   path. Other paths create the local commercial document first and then submit
   it to ZATCA. Remote reporting/clearance failure does not undo the local
   credit note.
9. There is no supported draft, cancellation, reversal, or credit-of-credit
   workflow. The UI correctly describes creation as irreversible.
10. The modal visibly prints the original invoice UUID and also exposes it in a
    DOM data attribute. The UUID is operationally required internally, but it
    is not useful to normal employees and should not be visible in the UI.
11. Authorization is inconsistent: frontend eligibility includes
    `owner`, `admin`, and `branch`, while the effective base RPC and refundable
    item RPC allow only `owner` and `branch`. An admin can see the action but
    the backend rejects it.

## Evidence and authority order

The repository contains historical phase SQL and a consolidated schema
snapshot. This audit uses the following effective order:

1. `supabase/migrations/20260721000100_dafra_current_schema_and_security.sql`
   for the consolidated base schema and reviewed legacy commercial functions.
2. `supabase/migrations/20260724000100_atomic_simplified_checkout_v2.sql` for
   atomic simplified commercial finalization and durable reporting.
3. `supabase/migrations/20260725000600_product_units_phase1_foundation.sql` for
   immutable product-unit snapshot columns.
4. `supabase/migrations/20260725000700_product_units_commercial_workflow.sql`
   for the current package-aware credit-note dispatcher and refundable-items
   v2 function.
5. `scripts/sql/zatca-phase2-finalization-v2/01_artifact_lifecycle.sql` and the
   coordinated ZATCA release contract for prerequisite artifact/lifecycle
   columns consumed by the later atomic migration.
6. Current frontend calls in `CreateCreditNoteModal.tsx`, plus current ZATCA
   submission code.

Standalone phase files were used as design history or corroboration, not as a
claim that they are independently deployed after the ordered migrations.

## 1. Current user workflow

### Entry points

The modal opens from:

- an invoice row on `/invoices`, through the second row action;
- the invoice detail page, through its refund/credit-note section.

The invoice list computes eligibility with `creditNoteDisabledReason`. The
detail page computes a parallel disabled reason.

### Eligible source documents

Frontend and backend agree on the principal document rules:

- the source must be an original `simplified` or `standard` invoice;
- a credit note cannot itself be credited;
- the source invoice must be `posted`;
- a cancelled invoice is rejected;
- the source ZATCA status must be `reported` or `cleared`;
- the source total must be greater than zero;
- at least one line must have remaining refundable quantity.

Demo sandbox presentation additionally treats validated demo states as
submitted. Production creation remains governed by the backend and ZATCA
contracts.

### Roles

| Layer | Allowed by inspected code |
| --- | --- |
| Invoice-list frontend | `owner`, `admin`, `branch` |
| Detail frontend | action availability is derived from document state; modal still relies on backend |
| `get_invoice_refundable_items` | active `owner` in same tenant; active `branch` in exact tenant and branch |
| legacy commercial credit RPC | active `owner` in same tenant; active `branch` in exact tenant and branch |
| `admin` | exposed by list UI but rejected by effective base RPC |
| other roles | rejected |

This mismatch is a real workflow defect. It requires an authorization/product
decision and a backend contract change or a frontend restriction; it should not
be “fixed” only by redesigning the modal.

### Loading

When opened, all transient state is reset and the modal captures an immutable
identity tuple: invoice ID, branch ID, and invoice number. It then:

1. reads original `payments` (`method`, `amount`) ordered chronologically;
2. calls `get_invoice_refundable_items_v2(p_invoice_id)`;
3. initializes every return quantity to zero;
4. inspects an invoice-scoped pending atomic checkout for safe replay.

Stale asynchronous results are ignored with an effect cancellation flag.

### Already credited and remaining quantities

The backend aggregates non-cancelled linked credit-note lines by
`original_invoice_item_id`:

- `credited_quantity = SUM(credit line quantity)`;
- equivalent credited subtotal, discount, tax, and total are also summed;
- `remaining_quantity = GREATEST(original - credited, 0)`;
- remaining monetary fields are likewise original stored values minus credited
  stored values.

The modal displays original, credited, and remaining quantities from this RPC.
The browser does not authoritatively calculate cumulative eligibility.

### Full and manual returns

- The current “Return full quantity” checkbox sets the quantity to the exact
  remaining quantity.
- Clearing it sets quantity to zero.
- Manual numeric entry is allowed from zero to the displayed remaining value.
- Legacy lines step by `1` when originally integral, otherwise `0.001`.
- Product-unit lines step from their stored package quantity scale.
- Zero means unselected.

### Validation

Frontend validation covers:

- modal/source identity has not changed;
- reason selected;
- at least one positive line;
- quantity does not exceed remaining quantity (tolerance `0.0005`);
- product-unit fractions produce exact package and base quantities;
- stock-return choice is made when eligible physical lines are selected;
- combined reason/remarks does not exceed 500 characters;
- cash/card allocation is positive and equals the displayed credit total within
  one halala (`0.01`).

Backend validation independently covers authentication, active profile, tenant
and branch scope, document type/status/ZATCA state, reason length `3..500`,
idempotency key length `8..120`, item ownership, duplicate items, positive
quantities, package precision, remaining quantities, refund allocation, and
cumulative paid-total limits.

### Confirmation, progress, failure, and success

- There is no separate confirmation dialog. The modal shows an irreversible
  warning and the final button executes immediately.
- `creating` and `submitting` are separate states. Inputs and close/cancel
  controls are disabled while busy.
- Known backend errors are converted to merchant-facing localized messages.
  Raw backend errors are logged to the console, not shown to the employee.
- On commercial success, the modal attempts or observes ZATCA finalization,
  builds a presentation-safe result, invokes `onCreated`, closes, and shows a
  status-specific toast.
- The invoice list/detail cache is reconciled by invoice ID. The original is
  marked partial/full from refreshed refundable quantities and the linked
  credit note is inserted into history.

### Original-document immutability

The original invoice and original invoice items remain unchanged. Links are
stored on the new document:

- `invoices.original_invoice_id`;
- `invoices.invoice_reference`;
- `invoice_items.original_invoice_item_id`.

## 2. Authoritative data model

### Original and credit-note document: `public.invoices`

Relevant fields:

| Purpose | Fields |
| --- | --- |
| identity/scope | `id`, `tenant_id`, `branch_id`, `session_id`, `customer_id`, `created_by` |
| visible identity | `invoice_number`, `invoice_reference` |
| source link | `original_invoice_id` |
| reason/idempotency | `credit_reason`, `credit_note_idempotency_key`, `credit_note_request_fingerprint` |
| document type | `zatca_invoice_type`, `zatca_type_code` |
| commercial state | `status`, `payment_status`, `payment_method` |
| values | `subtotal`, `discount_amount`, `taxable_amount`, `tax_amount`, `total_amount`, `currency_code` |
| dates/notes | `invoice_date`, `created_at`, `notes` |
| ZATCA identity/submission | `zatca_uuid`, `zatca_status`, `zatca_submission_id`, `zatca_submitted_at`, `zatca_reporting_response`, `zatca_clearance_status`, `zatca_clearance_response`, `zatca_warnings` |
| ZATCA immutable output | `zatca_xml`, `zatca_xml_hash`, `zatca_signature`, `zatca_qr_code`, `zatca_lifecycle_state`, `zatca_artifact_stage`, `zatca_cleared_xml`, `zatca_cleared_xml_hash`, `zatca_cleared_signature`, `zatca_cleared_qr` |

Created credit notes use:

- `zatca_invoice_type = 'credit_note'`;
- `zatca_type_code = '381'`;
- `status = 'posted'`;
- initial `zatca_status = 'pending'`;
- `payment_status = 'refunded'`;
- original invoice number in `invoice_reference`;
- combined reason/details in both `credit_reason` and `notes`.

### Original and credit lines: `public.invoice_items`

Commercial fields copied from the original line include:

- `product_id`, names, description, SKU, legacy unit;
- quantity and unit price;
- discount percent/amount;
- subtotal;
- tax rate/category/amount;
- total and sort order;
- `original_invoice_item_id` on the credit line.

Product-unit snapshot fields are nullable for legacy lines:

- `product_unit_id`, `product_unit_version`;
- selling unit name/Arabic name/code;
- `package_quantity`, `package_quantity_scale`;
- `conversion_to_base`, `base_quantity`;
- base unit name/Arabic name/code and scale;
- package pricing method, base price, package price;
- `stock_tracked_at_sale`, `service_item_at_sale`.

### Refund and payment ledgers

`public.payment_refunds` stores:

- tenant/branch;
- original and credit-note invoice IDs;
- optional source payment ID;
- method, amount, reason, status;
- creator and timestamp.

The explicit allocation wrapper replaces its preliminary refund row with one or
two completed cash/card rows and creates corresponding `payments` rows against
the credit note. These are Dafra accounting/register records, not payment
gateway operations.

### Inventory

Stock restoration updates `products.stock_quantity` and writes
`pos_stock_movements` with:

- tenant, branch, product, credit-note invoice;
- positive `quantity_delta`;
- reason `refund_return`;
- creator;
- product-unit/version, package quantity, conversion, base quantity, and unit
  names for package-aware lines.

Opening stock and purchase inventory tables are not involved.

## 3. Financial and VAT behavior

### Historical values

The backend uses original stored invoice-line values. It does not look up the
current product price, discount, or VAT rate to price a return.

### Partial allocation

For each monetary component:

```text
round(original stored amount × returned quantity / original quantity, 2)
```

The result is capped at the remaining component. If the return quantity equals
the remaining quantity within tolerance, the exact remaining component is used.

This is applied independently to subtotal, discount, tax, and total. Document
totals are the rounded sums of the returned line components.

### Discounts and reconciliation

Discount amount and percent are copied from the original line; the returned
discount amount is proportional. The credit-note header stores the aggregate
discount. The design preserves the original line total rather than rebuilding
it from current catalogue rules.

One modeling detail should remain explicit in future backend work:
`taxable_amount` is populated with the returned subtotal in the inspected
legacy implementation, while discount is stored separately. The current
behavior is established and must not be changed by a UI redesign.

### Reporting impact

Posted credit notes receive accounting sign `-1` in reporting views. They:

- reduce net revenue;
- reduce VAT;
- reduce item/revenue aggregates;
- appear as credited totals;
- remain separate linked documents.

Cancelled documents are not counted, though there is no supported user-facing
credit-note cancellation flow.

## 4. Payment/refund behavior

The action records a completed refund allocation. It does **not**:

- refund a card through an acquirer;
- initiate a bank transfer;
- open a cash drawer;
- prove cash was handed to the customer;
- reconcile an external settlement.

The label “Create Credit Note / Refund” overstates automation. A safer current
label is “Create credit note” with a summary line such as:
“Record refund allocation: Cash SAR X · Card SAR Y.” If the employee must
physically issue money, the UI should say so explicitly.

The backend prevents cumulative non-failed refund rows from exceeding the
original payment total plus `0.01`. The wrapper requires one or two unique,
positive cash/card allocations equal to the credit-note total within `0.01`.
Bank transfer is supported by the legacy refund method enum but is not offered
by the current explicit allocation UI.

## 5. Inventory behavior

### When stock moves

Stock is restored only when all are true:

- the document-level `return_stock` choice is true;
- the branch is effectively stock-enabled;
- the selected line has a product;
- it was/currently is stock tracked according to the applicable contract;
- it is not a service.

The choice is optional in commercial semantics—`false` creates a financial
credit without stock movement—but the current UI requires an explicit yes/no
answer whenever selected eligible stock lines exist.

### Atomicity and retry

Credit creation, refund ledger writes, payments, and stock restoration are in
one database transaction. A stock update failure rolls back the entire call.

The source invoice is row-locked and an invoice-specific advisory transaction
lock serializes cumulative-return decisions. Idempotent replay returns before
stock restoration, so the same successful request does not restore twice.
Package requests also persist a SHA-256 request fingerprint and reject reuse of
the same idempotency key with a different payload.

Legacy direct requests prevent duplicate documents by idempotency key, but do
not provide the same stored fingerprint mismatch guarantee. Reusing a legacy
key with changed input replays the prior result rather than creating another
credit. Atomic checkout adds a cart fingerprint at its boundary.

## 6. Piece and Carton behavior

Product-unit sales snapshot the exact commercial unit and conversion at sale.
A return quantity remains expressed in the sold package unit:

- Piece line: returned pieces;
- Carton line: returned cartons or an allowed carton fraction;
- stock movement: returned base quantity.

Both package quantity and converted base quantity must conform to their stored
decimal scales. Example: if one carton equals 24 pieces, `0.5` cartons is valid
when the package scale permits it and produces exactly 12 pieces; `0.333`
cartons is rejected when it cannot produce an exact base quantity.

The credit line copies the original product-unit version, names, conversion,
prices, and sale-time stock/service flags. Current product-unit configuration
cannot reprice or reconvert the historical return.

## 7. Services, non-stock items, and missing metadata

- Service businesses cannot enable stock restoration.
- Service lines and untracked products receive a financial credit only.
- Lines without a product identity are value-only and never move stock.
- A mixed credit can restore eligible physical lines while leaving service and
  non-stock lines financial-only.
- Legacy invoice lines have nullable unit snapshots. Their financial amounts
  remain historical, but `track_stock` and `is_service` are resolved from the
  current product row.
- Package restoration combines stored and current safety flags. Current
  configuration can conservatively block restoration (for example, a product
  now marked service/untracked). It cannot safely be treated as a fully
  immutable historical stock decision.

Therefore “missing historical stock metadata” must not expose an optimistic
stock toggle. The safe current outcome is financial-only, or a clearly
identified review state backed by a future server decision.

## 8. Lifecycle and ZATCA

### Commercial lifecycle

There is no credit-note draft. Creation inserts a posted, refund-recorded,
pending-ZATCA document immediately.

There is no supported:

- deletion;
- cancellation;
- reversal;
- edit after creation;
- credit note against a credit note.

The audit trigger records a `credit_note_created` event. Source and credit
documents remain linked through foreign keys and invoice history.

### Simplified production

Eligible non-demo simplified credit notes use the atomic path:

1. prepare and fingerprint the scoped request;
2. create a preview inside a rolled-back preparation context;
3. generate/store the immutable signed candidate;
4. commit the commercial document, chain head, artifact, receipt snapshot, and
   durable reporting outbox entry together;
5. report asynchronously.

A committed intent replays the stored result. ZATCA unavailability does not
undo the local document.

### Standard and non-atomic paths

The local credit document is created first, then `submitInvoiceForBranch`
attempts reporting/clearance. The submitter verifies:

- source link exists;
- source is reported/cleared;
- type code is `381`;
- reason is non-empty.

Simplified output may remain printable while reporting is pending or rejected
according to the presentation contract. Standard output remains unavailable
until clearance. Retry state is surfaced on document/detail/list workflows.

Remote reporting/clearance and the commercial database transaction are not one
atomic operation.

## 9. Security findings

### Confirmed protections

- unauthenticated RPC calls are rejected;
- caller profile must be active;
- branch callers are restricted to exact tenant and branch;
- owner callers are tenant-scoped;
- source invoice is loaded and locked server-side;
- item IDs must belong to the source invoice;
- cross-document and duplicate line IDs are rejected;
- cumulative over-credit and over-refund are rejected;
- helper functions for product-unit internals are not browser-executable;
- service-role/private ZATCA fields are excluded from safe browser read
  surfaces;
- commercial state changes occur through security-definer RPCs rather than
  direct browser inserts.

### Risks and inconsistencies

1. **Admin mismatch:** frontend allows admin, base RPC denies admin.
2. **Legacy stock history:** current product flags influence old returns.
3. **Legacy replay mismatch detection:** idempotency prevents duplication, but
   package/atomic fingerprints are stronger than legacy direct replay.
4. **Visible UUID:** not an authorization secret, but it is unnecessary
   internal/debug information and increases employee confusion.
5. **No reversal workflow:** operational mistakes require support/database
   intervention rather than a controlled compensating document.

## 10. Reason model

### Current contract

- Backend storage type: free text.
- Required: yes, `3..500` characters.
- ZATCA significance: `credit_reason` is included as the credit-note reason.
- Notes are not semantically separate: the frontend concatenates the selected
  reason and optional remarks, then stores the result in both `credit_reason`
  and `notes`.
- Frontend canonical values are English strings:
  `Test sale`, `Customer refund`, `Cancelled order`, `Billing mistake`.
- English and Arabic labels are localized, but the stored canonical value
  remains English.

### Safe mapping assessment

| Proposed merchant category | Current safe mapping | Status |
| --- | --- | --- |
| Customer return | `Customer refund` | frontend-safe label change if canonical stored value stays unchanged |
| Invoice correction | `Billing mistake` | frontend-safe label change if meaning is approved |
| Cancelled order | `Cancelled order` | supported now |
| Test/void sale | `Test sale` | supported now; access/policy decision recommended |
| Damaged item | no exact canonical value | product/legal decision; backend accepts text but reporting semantics are undefined |
| Wrong item | no exact canonical value | product/legal decision |
| Pricing correction | could be `Billing mistake` but is not exact | product decision |
| Other | no canonical value | requires required detail and product decision |

The modern long-term model should store a stable reason code plus separate
human details while continuing to emit a compliant human-readable ZATCA reason.
That requires a migration and compatibility mapping. A frontend-only redesign
must preserve the current stored canonical strings.

## 11. UX and accessibility audit

| Before/current issue | Recommended direction | Why |
| --- | --- | --- |
| Internal UUID printed in invoice context | remove visible UUID; retain internal state/data only where diagnostics require it | employees recognize invoice numbers, not database IDs |
| One large four-column card per line | compact selection row plus expandable detail | reduces scrolling and repeated financial noise |
| Checkbox and quantity input both select a line | quantity `0` means unselected; “Return all” sets maximum | one state model instead of two competing controls |
| Per-line subtotal, VAT, and total always visible | show calculated line credit; put breakdown in disclosure/summary | total is the employee’s primary decision value |
| Refund controls imply money movement | label as refund allocation/recording and show physical-settlement disclaimer | backend records but does not transmit funds |
| Stock question is document-level but repeated impact is separate | keep one contextual stock decision beside the selected physical items | makes scope explicit |
| Long single scrolling column | desktop main/summary split; stacked mobile flow | keeps decision and consequence visible together |
| No `role="dialog"` or `aria-modal` | add dialog semantics, labelled title/description | current overlay is not announced as a modal |
| No focus trap, initial focus, Escape handling, or focus restoration | implement complete modal focus lifecycle | prevents keyboard users entering background content |
| Error block is not a live region | use `role="alert"` or assertive live region and focus first error | errors must be announced |
| Close icon and several controls lack explicit focus-visible rings | standardize visible keyboard focus | hover-only feedback is insufficient |
| Fixed `max-w-4xl` with dense line grids | responsive two-panel desktop and single-column mobile | current tablet layout is especially scroll-heavy |
| English canonical reason values shown through localization | keep localized labels but document canonical storage | preserves backend/ZATCA semantics |

The UUID should be removed from normal UI. It may remain in scoped diagnostic
logging guarded by `import.meta.env.DEV`, and as an internal request identity.
The DOM `data-original-invoice-id` should also be removed unless a verified
runtime/test integration requires it; DOM visibility provides no security
boundary.

## 12. Test inventory and gaps

### Existing relevant automated tests

- `scripts/test-credit-note-ux.mjs`
  - simplified/standard ZATCA presentation states;
  - scoped pending checkout cleanup/replay;
  - stock-choice frontend contract;
  - over-credit/stock guards by static contract;
  - localization keys.
- `scripts/test-credit-note-modal-invoice-identity.mjs`
  - source invoice identity and stale modal state.
- `scripts/test-zatca-atomic-simplified-checkout.mjs`
  - atomic credit creation, idempotency, durable reporting, print behavior.
- `scripts/test-zatca-invoice-read-surface.mjs`
  - browser-safe invoice reads.
- `scripts/test-zatca-durable-reporting-recovery.mjs`
  - outbox/retry/recovery.
- `scripts/test-product-units-commercial-workflow.mjs`
  - Piece/Carton snapshots, exact fractions, base stock restoration,
    fingerprints, mixed legacy/package behavior.
- `scripts/test-branch-stock-enabled-rule.mjs`
  - service/stock-disabled branch behavior and stock-choice visibility.
- document view-model and runtime presentation tests
  - credit-note formatting and saved unit presentation.

### Coverage assessment

| Scenario | Coverage | Gap |
| --- | --- | --- |
| full credit | architecture/static scenarios | needs database integration fixture against current wrapper |
| partial credit | static and deterministic logic | needs persisted row/totals integration assertion |
| repeated partial credit | lock/remaining contracts tested statically | needs concurrent two-session database test |
| over-credit | guards asserted | needs hostile RPC integration request |
| Piece | product-unit deterministic tests | needs end-to-end credit fixture |
| Carton/fraction | strong deterministic/static coverage | needs persisted stock and movement fixture |
| service/non-stock | truth tables/static guards | needs mixed-document integration fixture |
| stock restoration | SQL contract tests | needs commit/rollback and replay database fixture |
| financial-only correction | stock false path asserted indirectly | needs explicit integration test |
| VAT rounding | formulas inspected | missing boundary matrix for repeated fractional credits |
| discounts | fields/contracts inspected | missing repeated partial discount reconciliation fixture |
| ZATCA success/failure/retry | strong deterministic coverage | live sandbox remains an operational smoke test |
| duplicate submission | atomic/package coverage strong | legacy direct changed-payload/same-key behavior needs explicit test |
| branch/tenant security | static RPC checks | missing hostile authenticated cross-scope integration matrix |
| admin authorization | missing | add a test that resolves the frontend/backend mismatch |
| Arabic | key-presence coverage | missing real modal layout and native-language review |
| mobile | source/screenshot follow-up only | missing 360/390px interaction test |
| accessibility | missing | add dialog semantics, focus trap, Escape, restoration, error announcement tests |
| payment settlement wording | missing | product/content acceptance test or documented smoke check |

## Audit conclusion

The commercial core is substantially safer than the modal suggests: it is
server-authoritative, cumulative-return guarded, transactional, and
package-aware. The highest-value redesign is therefore not to expose more
controls, but to communicate the existing decisions accurately:

- what is being credited;
- how much remains;
- whether physical stock returns;
- how Dafra records the refund allocation;
- that external payment settlement is still an employee/merchant operation;
- what ZATCA will do after local creation.

Authorization parity, legacy stock-history certainty, reason codes, external
refund execution, and reversibility cannot be solved by frontend redesign.
