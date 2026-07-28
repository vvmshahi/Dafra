# Credit-note workflow redesign proposal

Date: 2026-07-26
Status: proposal only; not implemented

## Product definition

**Audience:** a branch employee handling a customer return while other
customers may be waiting.
**Single job:** select what is being credited, record stock and refund
consequences accurately, then create the linked legal document.

The interface should feel like an operational return worksheet, not a tax form
or developer console. The distinctive element is a continuously visible
“What will happen” summary that separates document creation, stock movement,
refund recording, and ZATCA processing.

## Design direction

### Compact tokens

| Token | Value | Use |
| --- | --- | --- |
| Forest ink | `#0F2419` | primary action and selected state |
| Slate ink | `#334155` | headings and document context |
| Paper | `#FFFFFF` | working surface |
| Mist | `#F8FAFC` | quiet groups and unselected rows |
| Return amber | `#B7791F` | credit values and consequential notices |
| Safe green | `#1B6B3A` | confirmed physical stock return |

Use the existing application typefaces. Employ the body face for instructions,
the existing data/monospace treatment for document identifiers, and tabular
numerals for quantities and money. No decorative animation is warranted.
Press feedback may use the existing short `scale(0.97)` treatment; keyboard
activation should remain immediate.

## Recommendation classification

- **Supported safely now:** frontend-only change using existing payload and
  backend semantics.
- **Requires backend change:** cannot be represented truthfully or safely with
  the current contract.
- **Requires product decision:** code can support it, but commercial/legal or
  operational intent is not settled.
- **Defer:** adds complexity without resolving a current employee problem.

## Desktop architecture

```text
┌──────────────── Create credit note — INV-0835 ────────────────┐
│ Original total · remaining credit · ZATCA/source status        │
├─────────────────────────────────────┬───────────────────────────┤
│ MAIN                                │ WHAT WILL HAPPEN          │
│ Reason                              │ 3 selected items          │
│ Optional details                    │ Subtotal                  │
│                                     │ VAT                       │
│ Search/filter only if many lines    │ Total credit              │
│ ┌ Product ─ Purchased/Credited/Max ┐│                           │
│ │ −   quantity   +   Return all    ││ Stock                     │
│ │ Calculated credit               ││ + 12 Piece / No movement  │
│ └──────────────────────────────────┘│                           │
│ ...                                 │ Refund record              │
│                                     │ Cash / Card allocation     │
│                                     │ Physical payout notice     │
│                                     │                           │
│                                     │ ZATCA next step            │
├─────────────────────────────────────┴───────────────────────────┤
│ Cancel                                  Create credit note       │
└─────────────────────────────────────────────────────────────────┘
```

### Header and invoice context

Show:

- “Create credit note”;
- human invoice number;
- original total;
- remaining refundable total/line count;
- a short immutable-source notice.

Remove:

- visible invoice UUID;
- repeated internal identity text;
- technical artifact/fingerprint information.

Classification: **supported safely now**.

### Main panel

1. Reason selector.
2. Conditional details field.
3. Item list with compact quantity control.
4. One stock-treatment section shown only when selected lines are eligible.

Do not show subtotal/VAT/total three times on every line. Show one calculated
line credit and reserve the detailed breakdown for the summary or an optional
disclosure.

Classification: **supported safely now**.

### Summary panel

Use a sticky panel within the modal viewport, not the page:

- selected line count;
- selected quantities with exact Piece/Carton labels;
- subtotal, discount when nonzero, VAT, total credit;
- stock impact in base units, with package context;
- refund allocation recorded in Dafra;
- explicit settlement disclaimer;
- ZATCA next step;
- final action.

Suggested payment copy:

> Dafra will record this refund allocation. Complete any cash handover or card
> refund using your normal payment process.

Classification:

- summary and truthful copy: **supported safely now**;
- actual payment-gateway refund: **requires backend change**.

### Final action

Rename from “Create Credit Note / Refund” to:

> Create credit note

When busy:

- “Creating credit note” during the commercial transaction;
- “Submitting to ZATCA” during non-atomic follow-up.

For simplified atomic creation, present local completion and reporting status
according to the existing presentation state.

Classification: **supported safely now**.

## Mobile architecture

```text
Create credit note
INV-0835 · original / remaining

Reason
Details (optional)

Items
[Product]
Purchased · Credited · Available
[−] [ quantity ] [+] [Return all]
Credit SAR X

Stock treatment (only when applicable)
Refund allocation

┌──── sticky summary/footer ────┐
│ 2 items · Total SAR X         │
│ Create credit note            │
└───────────────────────────────┘
```

Requirements:

- one stacked reading order;
- no horizontal line-item grid;
- sticky footer must not hide focused inputs or errors;
- summary expands into a bottom sheet/disclosure, but the total and action
  remain visible;
- respect safe-area insets;
- quantities and identifiers use controlled LTR isolation inside RTL;
- no entrance animations for frequently adjusted quantity controls.

Classification: **supported safely now**, subject to manual 360/390px and
Arabic testing.

## Simplified item component

### Proposed component

```text
Product name                         Credit SAR 34.50
Purchased 3 Carton · Credited 1 · Available 2
1 Carton = 24 Piece

[ − ] [ 1.0 Carton ] [ + ]       [ Return all ]
```

### State model

- quantity `0` = unselected;
- positive quantity = selected;
- “Return all” sets exact remaining quantity;
- minus/plus use `quantityStep(item)`;
- manual input remains available;
- max and invalid package fraction messages are inline;
- fully credited rows are disabled or moved to a collapsed “Unavailable”
  group.

### Can the checkbox be removed?

Yes. It duplicates the quantity state and currently behaves as “set maximum”
rather than an independent commercial choice. Replacing it with a button
preserves the exact payload.

Classification: **supported safely now**.

### Decimal quantity behavior

Increment/decrement controls must:

- use the stored package scale;
- never exceed remaining quantity;
- never go below zero;
- validate exact conversion to the stored base-unit scale;
- avoid floating-point accumulation by stepping in scaled integers or by using
  the existing normalized formatting helpers;
- preserve keyboard numeric entry.

The server remains authoritative.

Classification: **supported safely now**.

## Stock-impact model

Never offer a choice the backend cannot honor.

| Item condition | Proposed UI | Current support |
| --- | --- | --- |
| Stock-enabled physical goods with safe metadata | require “Returned to sellable stock” or “Do not return to stock” | supported safely now |
| Non-stock product | show “Financial credit only · no stock movement” | supported safely now |
| Service | show “Service credit · no stock movement” | supported safely now |
| Stock-disabled branch/service business | hide choice; show no-stock explanation | supported safely now |
| Product-unit/Carton | show package quantity and resulting base quantity | supported safely now from snapshots |
| Mixed physical and service lines | one document-level choice explicitly scoped to eligible physical lines | supported now; per-line control requires backend change |
| Missing historical stock metadata | do not guess; show “Stock treatment unavailable for this historical item” and default financial-only | requires backend confirmation for a reliable metadata flag |
| Damaged/discarded physical return | choose “Do not return to stock” | supported safely now |
| Financial-only pricing correction | no stock movement | current payload supports `return_stock=false`, but selecting a quantity still represents an item credit; product decision required |

### Per-line versus document-level stock choice

The backend accepts one `return_stock` boolean for the document. Do not render a
per-line stock toggle. A mixed choice such as “return line A to stock but not
line B” is not representable today.

Per-line stock treatment requires:

- payload changes;
- server validation;
- line-level stock movement decisions;
- idempotency fingerprint changes;
- audit and reporting tests.

Classification: **requires backend change**.

## Reason model

### Frontend-safe phase

Keep canonical stored values unchanged and improve merchant labels:

| Display label | Stored value |
| --- | --- |
| Customer return | `Customer refund` |
| Cancelled order | `Cancelled order` |
| Invoice correction | `Billing mistake` |
| Test sale correction | `Test sale` |

Show optional details for all, and strongly prompt for details on invoice/test
corrections. Do not silently store localized reason text.

Classification: **supported safely now**, after product/legal copy approval.

### Structured phase

Introduce:

- stable reason code;
- localized label mapping;
- separate required/optional detail;
- generated compliant human-readable ZATCA reason;
- backward compatibility for existing free text.

Classification: **requires backend migration and product/legal decision**.

### Proposed categories not safely mapped today

Damaged item, wrong item, pricing correction, and other should not be added as
mere frontend labels until the canonical stored meaning, required details, and
reporting implications are approved.

## Refund allocation model

### Supported now

- default allocation from original cash/card proportions;
- allow cash, card, or split;
- require allocation to equal the credit total;
- label this as a record, not an automated payout;
- show original payment as context, not as proof of refundability through an
  external processor.

### Backend-dependent

- card acquirer refunds;
- bank-transfer initiation;
- external settlement state (`requested`, `processing`, `settled`, `failed`);
- reconciliation identifiers;
- retry/reversal for external money movement.

The current `completed` refund status means Dafra recorded the allocation. The
redesign must not present it as gateway confirmation.

## Accessibility and interaction contract

The redesigned modal should include:

- `role="dialog"` and `aria-modal="true"`;
- title and description IDs;
- initial focus on the reason selector or modal heading;
- focus trap;
- Escape to close only when not busy;
- return focus to the invoking control;
- announced loading states;
- error `role="alert"` and focus to the first invalid section;
- visible focus rings on every control;
- 44px mobile touch targets for minus/plus/return-all;
- keyboard-operable quantity controls and manual input;
- correct fieldset/radio semantics for stock and refund decisions;
- `bdi dir="ltr"` for document numbers, quantities, and money in Arabic;
- no color-only state;
- reduced-motion-safe busy indicators.

Classification: **supported safely now**.

## Error recovery

Keep user input after correctable errors. Map errors to their owning section:

- identity/stale data → reload invoice context;
- quantity exceeded → affected line;
- invalid Carton fraction → quantity control;
- stock choice missing → stock section;
- refund mismatch → allocation section;
- ZATCA failure after local creation → close creation form and show the created
  document with retry status; never invite duplicate creation.

Atomic pending state must remain scoped to invoice and branch. Do not add a
generic “try again” that generates a new idempotency key after an uncertain
response.

## Implementation boundary

### Frontend-only and safe now

- remove visible UUID and unnecessary DOM exposure after verifying tests;
- two-panel desktop and stacked mobile layout;
- sticky summary/footer;
- simplified item rows;
- replace checkbox with Return all button;
- minus/plus controls using existing precision helpers;
- reduce per-line financial detail;
- accurate “Create credit note” wording;
- refund-recording disclaimer;
- existing reason-value relabeling;
- accessibility/focus management;
- contextual stock summaries using current v2 fields;
- preserve all existing payload fields and functions.

### Requires backend changes

- resolve admin authorization parity in either direction;
- stable reason codes and separate notes;
- reliable historical stock metadata for legacy rows;
- per-line stock disposition;
- automated external payment refunds and settlement states;
- supported credit-note reversal/correction flow;
- stronger changed-payload fingerprint enforcement for all legacy direct
  credit requests;
- a server-provided authoritative preview if the client/server calculation
  display must be guaranteed byte-for-byte before submission.

### Product decisions required

1. Should `admin` be allowed to create credit notes, or should the UI hide the
   action?
2. Which roles may issue test-sale corrections?
3. Does “completed refund” mean recorded internally or physically settled in
   merchant operations?
4. Which reason taxonomy and Arabic legal wording are approved?
5. Should stock treatment remain one decision for all eligible lines?
6. How should damaged-but-physically-returned goods be represented—no stock,
   quarantine stock, or sellable stock?
7. Is a controlled credit-note reversal required, and who may perform it?
8. Should financial-only price corrections select item quantity, amount, or a
   separate adjustment workflow?
9. Should historical items with uncertain stock metadata always be
   financial-only?

### Defer

- animation beyond basic press/loading feedback;
- per-line tax editing;
- current product-price lookup;
- arbitrary custom VAT changes;
- drag-and-drop item ordering;
- bulk cross-invoice credit notes;
- inline ZATCA technical payloads;
- employee-visible UUIDs/fingerprints.

## Proposed delivery sequence

### Phase A: frontend-safe workflow

1. Preserve payload and all calls.
2. Remove UUID from normal presentation.
3. Add dialog/focus semantics.
4. Implement compact item controls and summary.
5. Correct refund wording.
6. Retain document-level stock choice.
7. Add English/Arabic and responsive tests.

### Phase B: contract corrections

1. Decide and align admin authorization.
2. Add integration tests for concurrent repeated partial credits.
3. Add legacy stock-metadata policy.
4. Add stable reason-code contract.

### Phase C: optional operational expansion

1. External refund integration.
2. Per-line stock disposition/quarantine.
3. Controlled reversal/compensating-document workflow.

## Acceptance criteria for a future implementation

- no calculation or payload changes in Phase A;
- original invoice remains unchanged;
- full/partial/repeated credits produce identical RPC requests;
- Piece/Carton precision and base conversion remain exact;
- service/non-stock lines never show a stock choice;
- refund copy never claims external settlement;
- ZATCA pending/failure never invites duplicate creation;
- English and Arabic fit at 360px;
- complete keyboard modal lifecycle passes;
- the UI and backend agree on eligible roles before release.
