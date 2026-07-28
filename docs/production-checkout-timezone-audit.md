# Production checkout and timezone safety audit

Date: 2026-07-26
Scope: repository and schema audit only
Worktree: `feature/ui-refinement-20260726`

## Executive conclusion

The reported India-time invoice display is real and explainable from the
frontend: the invoice list formats `createdAt` with `toLocaleTimeString`
without a `timeZone`, so it uses the browser/device timezone. Several
customer, supplier, report, operational and day-closing displays have the same
class of defect.

The reviewed checkout transaction does **not** use the browser timezone to
choose a register session, create an invoice date, allocate a counter, or
produce the ZATCA issue timestamp. The browser sends no commercial timestamp.
PostgreSQL creates the authoritative instant. The active commercial functions
derive `invoice_date` using `AT TIME ZONE 'Asia/Riyadh'`; atomic checkout uses
server `clock_timestamp()` for issue time, expiry and leases.

Therefore:

- Asia/Kolkata versus Asia/Riyadh can directly change affected displays;
- it does not directly explain the reviewed checkout rejection;
- a severely incorrect device clock may disturb Supabase client token refresh
  or browser TLS, but that should normally surface as authentication/network
  failure, not a business-date rejection;
- the generic checkout message hides many materially different database,
  atomic preparation, network and authorization errors, so the incident cannot
  be identified from the toast alone.

The leading transaction-affecting candidates are a cart/product-unit or stock
validation failure, a stale/closed register ID, authorization/scope failure, a
network or cached-client problem, or an atomic-checkout state/error. Capture the
failed Network response before changing timezone code.

## 1. Timezone constants and helpers

### Canonical Saudi helpers

| Location | Behavior | Classification | Notes |
| --- | --- | --- | --- |
| `src/lib/utils/date.ts` | Fixed `UTC+3` arithmetic for `saudiNow`, `saudiDateStr`, `saudiTimeStr`, and Saudi day query ranges | Explicit Saudi | Saudi Arabia has no DST. The display helpers explicitly use `Asia/Riyadh`. |
| `src/localization/documents.ts` | `documentDate` and `documentDateTime` specify `Asia/Riyadh` | Explicit Asia/Riyadh | Used by invoice-detail document presentation. |
| `src/components/print/A4Document.tsx` | Date, time and supply date use `Intl.DateTimeFormat(... timeZone: 'Asia/Riyadh')` | Explicit Asia/Riyadh | Safe for invoice/credit-note printing. |
| `src/components/print/ThermalReceipt.tsx` | Receipt date/time explicitly use `Asia/Riyadh` | Explicit Asia/Riyadh | A fallback `new Date().toISOString()` exists only when no issue timestamp is supplied; it is an absolute UTC instant. |
| `src/pages/pos/POSPage.tsx` | `formatSessionDateTimeLocalized` and open-since display use `Asia/Riyadh` | Explicit Asia/Riyadh | Session duration uses epoch subtraction, not timezone. |
| `src/lib/registerSessions.ts` | `formatSaudiSessionDateTime` specifies `Asia/Riyadh` | Explicit Asia/Riyadh | Reports use it for session ranges. |
| Owner and Branch dashboards | Register opened/closed values explicitly specify `Asia/Riyadh` | Explicit Asia/Riyadh | Duration uses absolute instants. |
| `supabase/functions/zatca-submit*` and `zatca-validate-sandbox-demo` | Converts stored `created_at` to fixed UTC+3 before IssueDate/IssueTime construction | Explicit Saudi | Edge runtime timezone does not determine invoice issue fields. |
| Atomic migration | `issue_at AT TIME ZONE 'Asia/Riyadh'` | Explicit Asia/Riyadh | Authoritative invoice business date. |

### Browser/device-timezone display call sites

These calls parse an instant and format it without `timeZone`. They can show
India time on an India-configured laptop.

| Surface | Location | Risk |
| --- | --- | --- |
| Invoice list time | `src/pages/invoices/InvoicesPage.tsx`, `fmtTime` | **Confirmed unsafe:** `createdAt` displays in browser timezone. This directly fits the observation. |
| Credit-note list time | Same invoice-list helper | Same defect because invoices and credit notes share the list. |
| Create-credit-note context date | `src/pages/invoices/CreateCreditNoteModal.tsx`, `invoiceDate` | Browser timezone when the input is an instant; date-only input is less affected. |
| Generic display helpers | `src/lib/utils/display.ts`, `fmtDate`/`fmtTime` | Unsafe for absolute timestamps unless callers pass date-only values intentionally. |
| Customer detail history | `src/pages/customers/CustomerDetailPage.tsx`, `formatDate` | Browser timezone, including the `withTime` variant. |
| Supplier detail history | `src/pages/suppliers/SupplierDetailPage.tsx`, `formatDate` | Browser timezone. |
| Customer intelligence print | `src/lib/customers/customerIntelligencePrint.ts`, `localDate` | Browser timezone, including time. |
| Supplier intelligence print | `src/lib/suppliers/supplierIntelligencePrint.ts`, `localDate` | Browser timezone, including time. |
| Customer/Supplier intelligence reports | `src/pages/reports/*IntelligenceReportsPage.tsx`, `formatDate` | Browser timezone. Date-only RPC fields may also shift when parsed as UTC midnight in western timezones. |
| Operations page | `src/pages/operations/OperationsPage.tsx`, local `formatDateTime` | Browser timezone. |
| ZATCA settings | `src/pages/settings/ZatcaTab.tsx`, local formatter | Browser timezone. |
| Day-closing closed-at time | `src/pages/day-closing/DayClosingPage.tsx` | `created_at` formatted without a timezone. |
| Report utilities and PDF theme | `src/pages/reports/reportUtils.tsx`, `src/pages/reports/pdf/reportPdfTheme.ts` | Browser timezone for timestamp inputs; date-only/month labels need separate date-only handling. |
| Sales chart labels | `src/pages/reports/SalesReport.tsx` | Browser timezone parsing of date values. |
| Profile/account creation dates | Profile, Account and Subscription settings | Browser timezone; mostly date-only informational display. |
| Branch detail “today” header | `src/pages/admin/BranchDetailPage.tsx` | Uses browser current day. |
| Branch dashboard date header | `src/pages/branch/BranchDashboardPage.tsx` | Uses browser current day. |
| Day-closing current date | `src/pages/day-closing/DayClosingPage.tsx` | Uses browser current day and is operationally significant if used to label/choose a closing date. |
| Barcode print date default | `src/lib/barcodes/labelPrint.ts` | Browser date (`en-CA`) rather than Saudi date. |

Date-only fields such as `purchase_date`, report start/end dates and
subscription due dates are not absolute instants. Constructing them with
`new Date('YYYY-MM-DD')` and then formatting in the browser timezone is still
unsafe: ECMAScript treats the string as UTC midnight, which can render the
previous date west of UTC. It is not the cause of the checkout incident.

### Explicit UTC and clock-only uses

- `new Date().toISOString()` in Edge functions and diagnostics produces an
  absolute UTC instant and is safe where the database/API expects an instant.
- `Date.now()` in session-duration and cache-age calculations compares epoch
  milliseconds. Timezone does not matter, but a wrong physical clock makes the
  displayed duration/cache age wrong.
- The fallback checkout idempotency key contains `Date.now()` plus randomness.
  It is treated as an opaque string; no backend date is parsed from it.
- `Date.now()` in invoice-list cache staleness can make a device cache refresh
  too often or too rarely if its physical clock jumps. It does not validate a
  sale.

No `getTimezoneOffset`, date-fns timezone, Day.js timezone, or Luxon timezone
dependency is used in the reviewed checkout path.

## 2. Relevant database types

The consolidated schema and subsequent atomic migrations define:

| Entity/field | SQL type | Source of value | Assessment |
| --- | --- | --- | --- |
| `invoices.created_at` | `timestamptz` | Server `NOW()` or atomic `issue_at` | Correct absolute instant. |
| `invoices.invoice_date` | `date` | Active checkout explicitly derives Saudi date | Correct for checkout. Table default `CURRENT_DATE` is database-session-date dependent for other direct insert paths. |
| `invoices.supply_date`, `due_date` | `date` | Document/business inputs | Date-only. |
| `invoices.zatca_submitted_at` | `timestamptz` | Server/Edge completion instant | Correct absolute instant. |
| Invoice/cancellation/update timestamps | `timestamptz` | Database | Correct absolute instants. |
| Credit-note creation | Stored in `invoices`; no separate credit-note table | Server | Same types as invoices. |
| `invoice_items.created_at` | `timestamptz` | Database | Correct. |
| `payments.paid_at`, `created_at`, `updated_at` | `timestamptz` | Database/checkout server instant | Correct. |
| `payment_refunds.created_at` | `timestamptz` | Database | Correct. |
| `pos_sessions.opened_at`, `closed_at`, `created_at` | `timestamptz` | Database `now()` | Correct; no business-day field. |
| `purchases.purchase_date` | `date` | User/business date, default `CURRENT_DATE` | Date-only. Default depends on database session timezone, not browser timezone. |
| `purchases.received_at`, `created_at`, `updated_at` | `timestamptz` | Database | Correct. |
| Stock movement/receipt timestamps | `timestamptz` | Database | Correct. |
| Atomic intent `issue_at`, `expires_at`, lease expiry, created/updated/claimed/committed | `timestamptz` | PostgreSQL `clock_timestamp()` | Correct and server-controlled. |
| Atomic response evidence `received_at` | `timestamptz` | PostgreSQL | Correct. |
| Durable reporting outbox lifecycle timestamps | `timestamptz` | PostgreSQL | Correct. |
| ZATCA artifact/finalization lifecycle timestamps | `timestamptz` | PostgreSQL/Edge | Correct absolute instants. |
| Branch invoice/credit counters | `bigint` columns | Transactional database update | Not date-based. |

No reviewed production commercial field uses `timestamp without time zone` as
an absolute instant. Generated TypeScript maps PostgreSQL dates/timestamps to
`string`, so the generated type alone does not retain SQL timezone semantics.

Important caveat: table defaults using `CURRENT_DATE` follow the PostgreSQL
session timezone. Active POS and atomic checkout override `invoice_date` with
Saudi date, but purchase edit-window functions and any unreviewed direct
invoice insert using the default should be checked against the hosted database
timezone.

## 3. Checkout request and transaction path

### Frontend

`POSPage.charge()`:

1. blocks empty/in-flight/suspended checkout;
2. reads any pending atomic request from local storage;
3. creates an opaque idempotency key with `crypto.randomUUID()` (or a
   `Date.now()`/random fallback);
4. builds the payload;
5. for production simplified invoices, fingerprints and persists the payload,
   then calls `checkoutSimplifiedAtomically`;
6. otherwise calls `pos_checkout(p_payload)`;
7. performs ZATCA finalization/submission after or around the commercial path
   according to the existing atomic/legacy mode;
8. maps unknown errors to `validation:checkoutFailed`.

Browser payload:

```text
branch_id
customer_id
session_id
payment_method
amount_paid
payments[] (split only)
note
idempotency_key
items[]:
  product_id
  quantity
  OR product_unit_id, package_quantity, expected_product_unit_version
```

It does **not** send:

- invoice date or issue time;
- business/register/counter date;
- `created_at`;
- ZATCA issue or signing timestamp;
- idempotency creation time as a separate field.

### Legacy/package-aware commercial RPC

The current `pos_checkout` dispatcher routes package payloads to
`pos_checkout_with_product_units_v1` and base-unit payloads to the reviewed
legacy base function. The commercial behavior:

- authenticates `auth.uid()` and active profile;
- validates branch, tenant and role scope;
- validates optional session ID belongs to the branch/tenant and is still
  `status = 'open'`;
- validates product availability, unit version/eligibility, quantity,
  stock, payment totals and branch capabilities;
- serializes idempotency by branch/key;
- gets the branch’s monotonic counter;
- assigns one server instant;
- inserts `invoice_date = (server instant AT TIME ZONE 'Asia/Riyadh')::date`;
- returns the server `created_at`.

There is no comparison between a browser timestamp and database time.

### Atomic simplified checkout

Atomic preparation:

- validates the branch, actor, document type, fingerprint and opaque key;
- allocates branch document and ZATCA counters transactionally;
- stores `issue_at = clock_timestamp()`;
- stores `expires_at = clock_timestamp() + server TTL`;
- validates expiry and signing leases exclusively with server
  `clock_timestamp()`;
- forces the final invoice’s `created_at` to the intent `issue_at`;
- forces `invoice_date` to the Riyadh date of `issue_at`.

The browser clock is not used for intent expiry or lease validation.

### Can Kolkata versus Riyadh fail checkout?

Not through the reviewed commercial date, session, counter or ZATCA timestamp
logic. Both devices send the same semantic payload regardless of timezone.
Kolkata changes unsafe display formatting only.

A wrong *physical clock* remains relevant to TLS and the Supabase client’s
token refresh scheduling. That is distinct from timezone. It should be tested,
but an HTTP/auth failure is expected rather than a Saudi-day validation error.

## 4. Register-session behavior

- `usePosSession.fetchActiveSession` queries `pos_sessions` by exact branch,
  `status = 'open'`, ordered by `opened_at DESC`, limit one.
- It does not filter by browser date or “today.”
- The session is not read from local storage. The current session ID comes from
  React state populated by the database query/RPC.
- `open_register_session` checks for any open session for the scoped branch,
  without a day boundary, and inserts with database `now()`.
- Checkout accepts `session_id = null`; when a session ID is supplied it must
  still be open and match tenant/branch.
- Midnight does not close or invalidate a session. A long-open session may
  span days.
- Session age is displayed client-side with
  `Date.now() - Date.parse(opened_at)`. Timezone does not affect epoch
  subtraction; a wrong physical clock affects only the displayed duration.
- A session can become stale between the initial query and checkout if another
  device closes it. The database then raises
  `POS session is not open for this branch` with SQLSTATE `42501`. The current
  generic mapping classifies text containing `not found`/authorization terms,
  but this exact message may fall through to the generic checkout failure.

This stale-session race is a plausible two-device incident cause and is not a
timezone issue.

## 5. Invoice numbering and business day

- Invoice numbers use a per-branch monotonic `bigint` counter. They do not reset
  daily.
- Credit-note and ZATCA counters are also monotonic, not date-keyed.
- Legacy checkout allocates the next counter inside the transaction.
- Atomic preparation reserves the counter and final commit reuses it.
- Counter allocation cannot select different dates for different clients.
- Active checkout’s business date is the Saudi date of the server-created
  instant.
- Daily sequence allocation is not present in the reviewed invoice-numbering
  path, so a browser-day mismatch cannot reject it.

The schema-level default `invoice_date DEFAULT CURRENT_DATE` is ambiguous for
direct insert paths, but POS does not rely on that default.

## 6. ZATCA date/time behavior

- ZATCA source data is the persisted invoice/atomic issue instant.
- Production and sandbox Edge functions convert the stored UTC instant to
  fixed Saudi UTC+3 and generate `IssueDate` and `IssueTime`.
- Atomic checkout fixes `created_at`, `invoice_date`, invoice UUID/counter and
  chain position from the server-owned intent.
- Submission timestamps use Edge/database current UTC instants.
- The browser does not generate or validate ZATCA issue timestamps during
  checkout.
- ZATCA remote submission can fail after local commercial creation in legacy
  flows; the code intentionally distinguishes local sale creation from later
  output readiness, although generic failures before receipt construction can
  still obscure which phase failed.

## 7. Authentication and device-clock dependence

Application auth code:

- delegates session storage and refresh to `@supabase/supabase-js`;
- configures `persistSession: true`, `autoRefreshToken: true`, and
  `detectSessionInUrl: true`;
- does not compare JWT expiry with application `Date.now()`;
- reacts to Supabase `SIGNED_IN`, `SIGNED_OUT`, and `TOKEN_REFRESHED` events.

The Supabase client necessarily schedules refresh using token expiry and local
timers. A severely incorrect device clock can plausibly affect refresh timing;
an incorrect timezone with the correct instant cannot. Server JWT validation
uses server time.

Expected symptoms of an expired/invalid token are HTTP 401, PostgREST/Edge
authentication errors, `PGRST`/JWT messages, or SQLSTATE `42501`, not an invoice
date conflict. `safeCheckoutErrorKey` may collapse some authentication error
shapes to the generic message if the available `message` lacks its recognized
keywords.

## 8. Generic error masking

The exact text comes from:

- `src/localization/locales/en/validation.json`;
- duplicated POS translation key in `src/localization/locales/en/pos.json`.

`POSPage.charge()` catches every error, calls `safeCheckoutErrorKey`, logs the
raw object to the browser console, and shows the localized key. The mapping
recognizes suspended billing, tender/split errors, insufficient stock,
idempotency/fingerprint conflict, unit version/availability/precision, generic
unavailable items, and some authorization terms. Everything else becomes:

> Checkout failed. Review the cart and try again.

Potentially hidden categories include:

- `POS session is not open for this branch`;
- atomic chain/preparation/lease/capability errors;
- PostgREST/network failures whose message does not match the regex;
- SQL constraint errors not explicitly mapped;
- unexpected RPC response shape;
- ZATCA finalization errors thrown before the code records an attention state;
- database function drift or deployment mismatch.

The raw Supabase `code`, `message`, `details`, and `hint` are not extracted into
a structured diagnostic event. There is only `console.warn`, with no durable
correlation/request ID and no sanitized production incident identifier.

Recommended diagnostic improvement, not implemented:

1. generate a non-sensitive checkout attempt UUID;
2. log attempt ID, branch ID, actor role, item count, package/non-package flag,
   session ID presence, checkout mode, Supabase error `code`, sanitized
   category, HTTP status and atomic phase;
3. show the attempt ID to the employee with a safe category-specific message;
4. never log customer data, prices, JWTs, ZATCA XML, certificates or cart
   contents;
5. preserve the full server error only in controlled telemetry.

## 9. Fix categories

### Display-only

- centralize Saudi instant formatting and replace browser-timezone formatting
  for invoice list, customer/supplier histories, operations, ZATCA settings,
  day-closing timestamp, and report timestamps;
- create a separate safe date-only formatter that never round-trips
  `YYYY-MM-DD` through an unintended timezone;
- use Saudi current date for operational headers and barcode print dates.

### Transaction-critical

- confirm hosted database timezone and audit every path that relies on
  `CURRENT_DATE`, especially purchases/edit windows and direct insert paths;
- decide whether checkout must require a register session, then return a
  specific stale/closed-session error and refresh it before retry;
- verify deployed RPC hashes/capability gates and atomic intent state for the
  failing branch;
- do not change transaction timing based on browser timezone.

### Diagnostics/error messages

- preserve sanitized SQLSTATE/PostgREST/atomic categories;
- add an attempt/correlation ID;
- map stale register, network/offline, JWT, capability, chain reconciliation
  and unexpected-RPC-result errors separately;
- add server-side structured logging around atomic preparation/commit.
