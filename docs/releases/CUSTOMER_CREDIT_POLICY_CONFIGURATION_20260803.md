# Customer Credit Policy Configuration — 2026-08-03

## Root cause

The manual Preview message, “Credit is unavailable until an owner configures a
policy,” was accurate but not actionable. The reviewed source showed that
`customer_credit_policies` is scoped to `(tenant_id, receivable_account_id)`,
not to the tenant. No tenant-wide policy row existed, an unlinked legacy
customer had no receivable account, and the only existing customer-policy
writer was hidden behind a collapsed control on the customer screen.

The policy RPC itself was correctly server-authoritative; the missing model and
discoverable owner path were the blocker. Customer type is not used to infer
credit approval. A walk-in sale has no customer ID and therefore cannot enter
the credit path.

## Authoritative model

Migration `20260803000800_customer_credit_policy_configuration_v1.sql` adds
`tenant_customer_credit_policies`:

- No row is an explicit disabled state. Reads never create one.
- An active Owner/admin, derived from `auth.uid()`, is the only actor that can
  create or update the row.
- Global controls include enablement, unpaid/partial permission, default limit,
  hard-limit/hold enforcement, warning threshold, manager override,
  allocation default, internal terms, and optional due-date days.
- New tenants use the same safe no-row/default-disabled behaviour. The chosen
  strategy is lazy, authorised setup rather than provisioning-time inserts;
  therefore no existing tenant is touched or silently enabled.

Customer policies remain explicit per receivable account. They support enable,
hold/reason, custom or tenant-default limit, terms, warning, overdue block,
owner approval and optional due-date days. `configured_*` fields preserve the
chosen customer policy; existing `credit_limit`/`hold` fields retain compatible
effective values for the reviewed checkout path. Changing a tenant default only
propagates to customers explicitly using that default.

`ensure_customer_receivable_account_v1(jsonb)` gives Owner/admin a visible,
idempotent **Set up credit account** action for a real legacy customer. It
creates only the empty account and customer link. It never backfills invoices,
payments, receivables, or historical debt.

## Security and runtime behaviour

- All policy/account writes are `SECURITY DEFINER`, `postgres`-owned, use
  `search_path = public, pg_temp` and `row_security = off`, derive actor and
  tenant server-side, and audit successful writes.
- The scope helper accepts operational roles in their authorised tenant/branch
  scope. Only Owner/admin can write tenant or customer policy/account setup.
  Cashier/branch/manager cannot configure policy; cashiers can request and use
  an already approved credit checkout.
- POS eligibility is read-only. It returns stable `AR_*` outcomes for missing
  tenant policy, missing account/policy, hold, owner approval, limit and
  overdue states. The checkout wrapper checks tenant policy before the existing
  AR checkout can create an account; the existing inner checkout remains the
  final financial authority.
- Policy save publishes a same-tab and cross-tab refresh hint. POS re-runs
  eligibility when it receives the hint and again immediately before Charge.
- A global allocation default applies only when a receipt caller omits an
  explicit allocation preference; an explicit caller choice remains intact.

## UI

Owner/admin receives a first-class **Customer credit** Settings tab, with a
clear **Set up customer credit** state, save/reload feedback, English/Arabic
copy, responsive controls and advanced safeguards. The customer workspace no
longer presents a dead-end message:

1. If tenant policy is missing/disabled, Owner/admin gets a direct Settings
   action; other roles receive the concise unavailable state.
2. If the customer is unlinked, Owner/admin sees **Set up credit account**.
3. Once tenant policy and account exist, Owner/admin sees **Set up credit for
   this customer**, then the individual approval, limit/default, hold, terms
   and due-date controls.

## Certification evidence

- Clean local database replay reached `20260803000800` after the repository’s
  two historical local-bootstrap compatibility prerequisites (the initial
  storage bucket upsert and a pre-allowlist invoice privilege baseline). These
  were applied only in the disposable local database; no source or remote
  schema was changed to accommodate them.
- `npm test` passed with disposable non-secret local Vite SSR values.
- `npm run test:receivables-certification` components passed on the final
  schema: static contracts, XLSX, rejection paths and rollback-only stateful
  three-branch fixture. The Supabase CLI later developed a transient local
  connection timeout after historical schema replay; direct prior fixture
  passes and the final migration head remain recorded.
- `npm run build` and `git diff --check` passed.
- Stateful coverage adds missing-policy, owner setup, explicit account setup,
  customer enable/disable, hold, cashier eligibility and cashier configuration
  denial. Rejection coverage adds invalid tenant-policy/account-setup payloads
  and confirms no retained AR/configuration row.

## Remote rollout completion

Remote parity was exact through `20260803000700`, with only
`20260803000800_customer_credit_policy_configuration_v1.sql` pending. After
the targeted metadata preflight passed, that sole forward-only migration was
applied to `bkbphkpqcxuejozayrsy`. Linked history now matches through 00800
with no pending or remote-only migration.

Post-application metadata confirms the tenant policy relation, its RLS and
revoked authenticated direct writes, and all reviewed public configuration,
workspace, eligibility, checkout, and receipt RPCs. The public RPCs are
`postgres`-owned `SECURITY DEFINER` functions with
`search_path = public, pg_temp`; `anon` is denied and `authenticated` has only
the intended public execution surface. The internal helpers and raw receipt
body remain unavailable to client roles.

The remote guaranteed-rejection fixture submitted only malformed or empty
payloads. It completed successfully and asserted unchanged aggregate counts
across configuration, account, operation, receipt, allocation, ledger, and
adjustment rows. No real customer policy, account, invoice, payment, stock,
fiscal, Atomic, Legacy, or ZATCA record was created, enabled, altered, or
backfilled.

The migration execution creates configuration schema/functions and normalizes
existing **policy metadata only**. It does not insert or update an invoice,
payment, stock row, AR ledger entry, receipt, allocation, Atomic contract,
Legacy checkout path or ZATCA credential/artifact. Its credit-checkout wrapper
adds the required global guard while retaining the reviewed commercial/AR
checkout as final authority.

## Interruption recovery

The verification run was interrupted by model capacity after the web build and
remote rollout. No task process was left running: the direct local
rollback-only three-branch fixture later exited 0, and its preflight completed.
The Supabase CLI path still reports a local Postgres connection timeout because
the disposable database container is unhealthy during catalog health checks;
the same rejection and stateful fixtures passed directly inside that container.
The final aggregate count is zero for tenant policies, customer policies,
accounts, operations, receipts, allocations, entries and adjustments. The
protected checkout remains unchanged.

## Preview status

A clean Preview-only deployment was built from this feature branch and reached
`READY`. The deployment is not production-targeted and no production alias was
updated. The exact final deployment ID, URL and source SHA are recorded in the
handoff report.
