# Kubri Customer Credit / AR Final Pre-production Audit — 2026-08-03

## Decision

**Verdict: `READY_FOR_MANUAL_ACCEPTANCE` —
`KUBRI_CUSTOMER_RECEIVABLES_READY_FOR_MANUAL_ACCEPTANCE`.** Migration 00500
has been applied and independently verified. A matching Preview is Ready. No
production frontend deployment, `main` merge, mobile/purchase work, desktop
build, historical backfill, or fiscal test transaction occurred.

| Item | Evidence |
| --- | --- |
| Worktree / branch | `/Users/admin/Desktop/DAFRA SUB/Dafra-customer-receivables` / `feature/customer-credit-receivables-20260803` |
| Reviewed starting SHA | `1e176b9828e77aa712b6c92ee2e53bbd68f92854` |
| Final audited code SHA | `846ca7b6d382a401d632edfe16d49cf97094142d` |
| Production project | `bkbphkpqcxuejozayrsy` |
| Acceptance Preview | `dpl_9cB9AKuMqpcnhpyDyDUa3d6jXQXj` — `https://dafra-j0u5qd6sc-mohammed-shahin-v-vs-projects.vercel.app` |
| Preview source metadata | `feature/customer-credit-receivables-20260803` / `f674f8e4802f0f9b0142db32e82430dd2400214a` |
| Production migration head | `20260803000500` |
| Pending AR migration | None |

## Lineage, scope, and production boundary

The target branch started at the stated SHA and adds only narrow review commits:
`13ebed4` (legacy date/XLSX safety), `7c17286` (the content-equivalent
desktop-download production correction), `c73664b` (later receipt-credit
settlement controls), `a74bf9d` (configured local test port), and `846ca7b`
(malformed-payload hardening). `origin/main` has one graph-only exclusive
commit, `5491389`; its desktop-download source correction was cherry-picked as
`7c17286`. No rebase or history rewrite occurred.

The audit is additive to POS, invoices, ZATCA/Atomic/Legacy, stock, printing,
reports, customers, suppliers, expenses, products, and branch entitlement. It
does not backfill or rewrite invoices, payments, stock, fiscal payloads,
ZATCA artifacts, or historical AR rows.

## Feature / regression / compatibility matrix

| Area | Result | Evidence / boundary |
| --- | --- | --- |
| Customer, policy, terms, hold, limit, warning, overdue | Pass locally | Server enforces active non-walk-in customer and policy. |
| Credit and partial checkout | Pass locally | Existing fiscal checkout owns invoice, tax, numbering, stock and ZATCA route; AR is settlement metadata. |
| Cash/card/bank/other and split receipt tenders | Pass locally | RPC-owned append-only receipt, tender and allocation records. |
| Auto/manual allocation and unapplied credit | Pass locally | Stateful fixture covers split/manual allocation and retained unapplied credit. |
| Later reallocation | P1 fixed | Role-gated UI calls `reallocate_customer_payment_v1`; existing allocations are preserved. |
| Authorized reversal | Pass locally | Immutable original plus compensating entry. |
| Credit note / refund / account credit | Pass locally | Existing fiscal credit-note engine remains authoritative; AR settlement is explicit/replay-safe. |
| Approved adjustment | P1 fixed | Role-gated UI calls `post_customer_receivable_adjustment_v1`. |
| Ledger, statement, reports | Pass locally | Server-scoped workspace/report owns balances and branch scope. |
| Receipt and statement printing | Source/SSR pass | Non-fiscal, QR-free settlement documents; physical acceptance remains. |
| Genuine XLSX and formula safety | Pass | OOXML ZIP, typed cells, RTL, frozen header/filter, neutralized formula-leading text. |
| English, Arabic, RTL, responsive | Source contracts pass | Authenticated browser/device review remains. |
| Legacy/null dates and values | P1 fixed | UI prints `—`; XLSX emits safe values rather than invalid date/`NaN`. |
| Existing POS/register/stock/invoice/ZATCA | No regression found | Focused POS, printing, stock, inventory, product, barcode and fiscal suites passed. |

The formerly missing later-settlement UI was a P1 completion gap, not a new
financial feature: its reviewed client/server contracts already existed but
were unreachable from the workspace. Financial writes remain authenticated
RPC-only; the new direct query is RLS-scoped read-only receipt metadata.

## P1 compatibility remediation pending remote approval

The rejection fixture exposed a raw PostgreSQL malformed-UUID response from a
public JSONB AR RPC. Migration 00500 is forward-only compatibility hardening:

- it renames each of ten public JSONB AR implementations to private
  `*_raw_20260803` bodies;
- it recreates the identical public signature as authenticated `SECURITY
  DEFINER` wrappers with `search_path = public, pg_temp` and `row_security=off`;
- it catches only conversion/range/date-overflow errors and returns stable
  controlled `AR_*` validation errors;
- it revokes all client access to raw bodies and grants only authenticated
  execution to public wrappers.

It creates no table/index/trigger/policy/business row, invoice/payment update,
stock movement, checkout alteration, or ZATCA/Atomic/Legacy alteration. The
exception boundary rolls back a rejected call, preventing partial AR mutation.
Local catalog verification found all ten wrappers owned by `postgres`, security
definer, safe-search-path, authenticated-only; raw bodies deny authenticated,
anon and service-role execution.

## Migration parity and read-only production preflight

Linked migration history exactly matches through `20260803000400`, with no
remote-only version and exactly one pending local migration: 00500. It was
deliberately **not applied**.

Read-only production catalog checks found all eight AR tables RLS-enabled and
without authenticated direct writes: policies, accounts, operations, receipt
headers/tenders/allocations, ledger entries, and adjustments. The reviewed
public API has the ten JSONB functions plus
`get_customer_payment_receipt_document_v1(uuid)`; all are owned by `postgres`,
security-definer, safe-search-path, `row_security=off`, anon-denied and
authenticated-executable. The two expected `AFTER INSERT` AR synchronization
triggers on `invoices` and `payments` are enabled. No business data was read.

The only safe next remote action is a separately authorised 00500 application,
then parity/catalog/rejection verification and a new Preview built from the
same source. This audit did not make that change.

## Local technical certification

| Check | Result |
| --- | --- |
| Clean `supabase db reset --local --yes`, including 00500 | Pass |
| `npm run test:customer-receivables` | Pass — 53 checks |
| `npm run test:receivables-xlsx` | Pass |
| `npm run test:receivables-rejection` | Pass — controlled errors and unchanged AR-row aggregate |
| `npm run test:receivables-stateful` | Pass — rollback-only three-branch fixture: allocation, replay, reallocation, reversal, scope, report |
| `npm run test:receivables-certification` | Pass |
| Owner-entitlement migration/runtime suites | Pass after deriving configured local DB port |
| Focused POS/printing/credit-note/customer/stock/product/barcode/inventory/sales-report suites | Pass |
| `npm test` | Pass with non-secret local SSR placeholder config; 192 thermal SSR renders passed |
| `npm run build` | Pass; existing 798 kB gzip main-chunk warning remains |
| `git diff --check` | Pass |
| Independent SheetJS parse of hostile `.xlsx` | Pass — B2 string, no formula, zero-width prefix code point `8203` |

The direct `fflate@0.8.2` export implementation has no audit finding. `npm
audit --omit=dev` has no critical finding, but reports existing unrelated
low/moderate items and a high `ws@8.20.0` transitive advisory through
`@supabase/realtime-js` (and jsdom). That dependency decision needs separate
upgrade/retest; it was not broadened inside this AR compatibility change.

## Security and platform RLS advisory

Secret-marker scans of source and produced web assets found no service-role key
or private-key material. Browser writes remain RPC-mediated.

The local Supabase adviser issued a required critical warning for three
**unrelated local tables**. Do not blindly run its remediation: enabling RLS
without policies can block their internal callers.

```sql
ALTER TABLE public.barcode_function_contracts_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_sku_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_units_commercial_function_contracts_v1 ENABLE ROW LEVEL SECURITY;
```

Their source purposes/dependencies are immutable barcode function-definition
fingerprints; tenant/prefix SKU counters used by `next_product_sku` and
`peek_product_sku`; and immutable Product Units commercial function
fingerprints. Production metadata already has RLS enabled there, with no
anon/authenticated privilege. Treat this as separate P2 local-baseline/security
work, not an AR release mutation.

## Evidence limits and manual acceptance

No authenticated browser session, physical printer, or real fiscal/stock
transaction was available. Browser automation is not installed. Historic
onboarding/owner-routing runtimes require their special disposable Docker
environment; current entitlement runtime passed locally. Two old static tests
expect obsolete dashboard/Document Studio architecture; supported focused
suites pass. Saudi tax-adviser sign-off remains a legal/business gate.

After explicit authorization applies 00500 and a new Preview is built from its
matching source, use an explicitly disposable three-branch tenant with owner
and branch accounts, open register, disposable customer/products:

1. Configure policy and test branch-scoped allowed, warned, held, over-limit
   and overdue credit checkout. Confirm fiscal invoice/ZATCA, stock and register
   behavior are unchanged.
2. Create a **10,000** credit invoice; receive **2,000 cash**, then **3,000
   card**, then **5,000 split/manual allocation**. Reconcile exact invoice,
   ledger, receipt, tender and allocation balances.
3. Make a controlled partial credit note through the existing fiscal path;
   verify stock restoration, source linkage, AR offset, residual
   account-credit/refund choice, fiscal print/clearance and replay safety.
4. Reallocate unapplied credit and reverse an authorized receipt; verify the
   immutable original, compensating ledger entry, invoice refresh and no
   duplicate operation after retry/restart.
5. Check owner, allowed branch, sibling branch, other tenant and anonymous
   workspace/report/document/receipt access; retain evidence and error IDs.
6. Print/reprint English and Arabic RTL receipt/statement at 58 mm, 80 mm and
   A4/PDF; open XLSX in Excel/LibreOffice and verify totals, values, RTL,
   filters and hostile-text display.
7. Obtain written Saudi tax-adviser approval for settlement, credit note,
   refund/account-credit and advance-payment boundaries before any real pilot.

## Release handoff

Do not deploy production web, merge `main`, perform a real purchase/credit
transaction, or apply 00500 without separate authorization. The existing
Preview is pre-hardening source and is not suitable for final acceptance. After
remote 00500 verification, push/deploy only a matching new Preview; production
release still depends on the checklist above.

## Final rollout completion update — 2026-08-03

This section supersedes the former “do not apply 00500” release handoff. After
fresh exact parity/preflight, the only pending migration
`20260803000500_harden_customer_receivables_payload_errors.sql` was applied to
`bkbphkpqcxuejozayrsy` with `supabase db push --linked --yes`. Linked history
now matches through 00500 with no pending migration. A benign post-apply
pg-delta catalog-cache certificate-file warning did not affect the successful
CLI result; live migration history, function metadata, grants, RLS, triggers
and aggregate-only counts were then independently verified.

All aggregate baselines are unchanged after application and rejection testing:
six customers, 4,302 invoices, 4,318 payments, 110 credit-note invoices, and
zero AR accounts, operations, receipts, allocations, ledger entries and
adjustments. The ten public wrappers are `postgres`-owned, JSONB-to-JSONB,
`SECURITY DEFINER`, safe-search-path, anon-denied and authenticated-executable;
their internal raw bodies deny all client execution. The eight AR tables retain
RLS and no direct authenticated writes. The invoice/payment AR sync triggers
remain enabled. The remote rejection fixture passed without a retained business
row, and the no-key RPC boundary returned HTTP 401.

Acceptance Preview `dpl_9cB9AKuMqpcnhpyDyDUa3d6jXQXj` is Ready at
`https://dafra-j0u5qd6sc-mohammed-shahin-v-vs-projects.vercel.app`. Its Vercel
metadata records branch `feature/customer-credit-receivables-20260803` and
exact SHA `f674f8e4802f0f9b0142db32e82430dd2400214a`. It is a Preview only and
does not alter the production alias. A read-only merge-tree rehearsal with
current main was conflict-free and produced the exact feature tree; no merge
occurred. The detailed remote evidence and consolidated owner checklist are in
[`CUSTOMER_CREDIT_AND_RECEIVABLES_20260803.md`](CUSTOMER_CREDIT_AND_RECEIVABLES_20260803.md).

Current technical verdict: **`KUBRI_CUSTOMER_RECEIVABLES_READY_FOR_MANUAL_ACCEPTANCE`**.
The remaining gates are authenticated/disposable-tenant, device/print,
responsive/accessibility, and Saudi tax-adviser manual acceptance—not another
automated migration or production deployment.
