-- Customer credit and accounts-receivable foundation.
--
-- This migration is additive. It intentionally does not derive, rewrite, or
-- otherwise fabricate receivable balances from historical invoices/payments.
-- Only invoices and settlements posted through the v1 receivables RPCs create
-- this ledger. Existing fiscal columns and ZATCA artefacts remain untouched.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- The legacy application only used owner/branch profiles.  Receivables needs
-- explicit operational roles so permission is decided by the server rather
-- than by a navigation label or a client-supplied role string.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'accountant';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'cashier';

CREATE TABLE IF NOT EXISTS public.customer_receivable_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_number text NOT NULL,
  display_name text NOT NULL,
  display_name_ar text,
  customer_type text NOT NULL DEFAULT 'individual'
    CHECK (customer_type IN ('individual', 'business')),
  vat_number varchar(15),
  cr_number varchar(20),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, account_number)
);

COMMENT ON TABLE public.customer_receivable_accounts IS
  'Tenant-scoped customer receivable identities. Accounts are created lazily for new AR activity; this table never implies a historical opening balance.';

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS receivable_account_id uuid;

DO $customer_receivable_account_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_receivable_account_id_fkey'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_receivable_account_id_fkey
      FOREIGN KEY (receivable_account_id)
      REFERENCES public.customer_receivable_accounts(id)
      ON DELETE RESTRICT;
  END IF;
END
$customer_receivable_account_fk$;

CREATE INDEX IF NOT EXISTS customers_receivable_account_idx
  ON public.customers (tenant_id, receivable_account_id)
  WHERE receivable_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.customer_credit_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  receivable_account_id uuid NOT NULL REFERENCES public.customer_receivable_accounts(id) ON DELETE RESTRICT,
  credit_enabled boolean NOT NULL DEFAULT false,
  credit_limit numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  terms text,
  hold boolean NOT NULL DEFAULT false,
  hold_reason text,
  overdue_block boolean NOT NULL DEFAULT false,
  warn_threshold_percent numeric(5,2) NOT NULL DEFAULT 80
    CHECK (warn_threshold_percent BETWEEN 0 AND 100),
  requires_owner_approval boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receivable_account_id),
  CHECK ((hold IS TRUE AND nullif(btrim(coalesce(hold_reason, '')), '') IS NOT NULL) OR hold IS FALSE)
);

ALTER TABLE public.customer_credit_policies
  ADD COLUMN IF NOT EXISTS terms text,
  ADD COLUMN IF NOT EXISTS overdue_block boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warn_threshold_percent numeric(5,2) NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS requires_owner_approval boolean NOT NULL DEFAULT false;

COMMENT ON TABLE public.customer_credit_policies IS
  'Explicit tenant-level credit controls. Absence of a policy means credit is disabled; no customer receives an inferred limit.';

CREATE TABLE IF NOT EXISTS public.customer_receivable_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN (
    'credit_checkout', 'payment_receipt', 'payment_reversal',
    'payment_reallocation', 'credit_note_settlement',
    'receivable_adjustment', 'account_link'
  )),
  payload_fingerprint text NOT NULL CHECK (length(payload_fingerprint) = 32),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  response jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, operation_id)
);

COMMENT ON TABLE public.customer_receivable_operations IS
  'Completed server-authoritative financial operations. The tenant + operation_id uniqueness and immutable payload fingerprint implement replay safety.';

CREATE TABLE IF NOT EXISTS public.customer_payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  receivable_account_id uuid NOT NULL REFERENCES public.customer_receivable_accounts(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  receipt_number text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency_code char(3) NOT NULL DEFAULT 'SAR' CHECK (currency_code = upper(currency_code)),
  method text NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'other', 'split')),
  reference varchar(255),
  notes text,
  origin text NOT NULL CHECK (origin IN (
    'checkout_initial', 'receive_payment', 'legacy_invoice_payment', 'adjustment'
  )),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'reversed')),
  operation_id uuid NOT NULL,
  recorded_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  received_at timestamptz NOT NULL DEFAULT now(),
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (tenant_id, operation_id),
  CHECK ((status = 'reversed' AND reversed_at IS NOT NULL AND nullif(btrim(coalesce(reversal_reason, '')), '') IS NOT NULL)
      OR (status = 'completed' AND reversed_at IS NULL AND reversal_reason IS NULL))
);

COMMENT ON TABLE public.customer_payment_receipts IS
  'Authoritative AR receipt headers. This is distinct from legacy invoice tender rows because a receipt may allocate across invoices and can be reversed without rewriting fiscal documents.';

CREATE TABLE IF NOT EXISTS public.customer_payment_receipt_tenders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.customer_payment_receipts(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'other')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reference varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id, method)
);

CREATE TABLE IF NOT EXISTS public.customer_receivable_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  receivable_account_id uuid NOT NULL REFERENCES public.customer_receivable_accounts(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN (
    'invoice', 'payment_receipt', 'credit_note', 'debit_note',
    'payment_reversal', 'credit_note_refund', 'adjustment'
  )),
  source_kind text NOT NULL CHECK (source_kind IN (
    'invoice', 'payment_receipt', 'credit_note', 'payment_reversal',
    'credit_note_refund', 'debit_note', 'adjustment'
  )),
  source_id uuid NOT NULL,
  debit_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  currency_code char(3) NOT NULL DEFAULT 'SAR' CHECK (currency_code = upper(currency_code)),
  effective_at timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL,
  created_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)),
  UNIQUE (tenant_id, source_kind, source_id)
);

COMMENT ON TABLE public.customer_receivable_entries IS
  'Append-only customer AR ledger. Balance is derived as debits less credits; clients never write or maintain an authoritative balance field.';

CREATE TABLE IF NOT EXISTS public.customer_receivable_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  receivable_account_id uuid NOT NULL REFERENCES public.customer_receivable_accounts(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  reference text,
  approved_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

COMMENT ON TABLE public.customer_receivable_adjustments IS
  'Explicit, approved non-fiscal AR adjustments. Debit notes remain fiscal invoices and must use the existing ZATCA credit/debit-note pathway.';

CREATE TABLE IF NOT EXISTS public.customer_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  receivable_account_id uuid NOT NULL REFERENCES public.customer_receivable_accounts(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  receipt_id uuid REFERENCES public.customer_payment_receipts(id) ON DELETE RESTRICT,
  credit_note_invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  allocated_by uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((receipt_id IS NOT NULL AND credit_note_invoice_id IS NULL)
      OR (receipt_id IS NULL AND credit_note_invoice_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (receipt_id, credit_note_invoice_id, invoice_id)
);

COMMENT ON TABLE public.customer_payment_allocations IS
  'Receipt and credit-note allocations to AR-managed invoices. Allocation rows do not replace the ledger; they explain settlement of invoice debits.';

CREATE INDEX IF NOT EXISTS customer_receivable_accounts_tenant_idx
  ON public.customer_receivable_accounts (tenant_id, is_active, display_name);
CREATE INDEX IF NOT EXISTS customer_credit_policies_tenant_idx
  ON public.customer_credit_policies (tenant_id, receivable_account_id);
CREATE INDEX IF NOT EXISTS customer_receivable_operations_lookup_idx
  ON public.customer_receivable_operations (tenant_id, operation_id);
CREATE INDEX IF NOT EXISTS customer_payment_receipts_scope_idx
  ON public.customer_payment_receipts (tenant_id, branch_id, receivable_account_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_payment_receipts_customer_idx
  ON public.customer_payment_receipts (tenant_id, customer_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_receivable_entries_scope_idx
  ON public.customer_receivable_entries (tenant_id, receivable_account_id, effective_at, created_at, id);
CREATE INDEX IF NOT EXISTS customer_receivable_entries_branch_idx
  ON public.customer_receivable_entries (tenant_id, branch_id, effective_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS customer_receivable_entries_invoice_idx
  ON public.customer_receivable_entries (source_id)
  WHERE source_kind = 'invoice';
CREATE INDEX IF NOT EXISTS customer_payment_allocations_invoice_idx
  ON public.customer_payment_allocations (invoice_id, created_at, id);
CREATE INDEX IF NOT EXISTS customer_payment_allocations_receipt_idx
  ON public.customer_payment_allocations (receipt_id)
  WHERE receipt_id IS NOT NULL;

-- AR tables are server-written. Authenticated users may read only records that
-- already lie inside their existing tenant/branch RLS scope.
ALTER TABLE public.customer_receivable_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_credit_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_receivable_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payment_receipt_tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_receivable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_receivable_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_receivable_accounts_owner_select_v1
  ON public.customer_receivable_accounts FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role()::text = 'owner');

CREATE POLICY customer_credit_policies_owner_select_v1
  ON public.customer_credit_policies FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_role()::text = 'owner');

CREATE POLICY customer_receivable_operations_scope_select_v1
  ON public.customer_receivable_operations FOR SELECT TO authenticated
  USING (public.rls_can_access_branch(tenant_id, branch_id));

CREATE POLICY customer_payment_receipts_scope_select_v1
  ON public.customer_payment_receipts FOR SELECT TO authenticated
  USING (public.rls_can_access_branch(tenant_id, branch_id));

CREATE POLICY customer_payment_receipt_tenders_scope_select_v1
  ON public.customer_payment_receipt_tenders FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.customer_payment_receipts r
    WHERE r.id = receipt_id
      AND public.rls_can_access_branch(r.tenant_id, r.branch_id)
  ));

CREATE POLICY customer_receivable_entries_scope_select_v1
  ON public.customer_receivable_entries FOR SELECT TO authenticated
  USING (public.rls_can_access_branch(tenant_id, branch_id));

CREATE POLICY customer_payment_allocations_scope_select_v1
  ON public.customer_payment_allocations FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.id = invoice_id
      AND public.rls_can_access_branch(i.tenant_id, i.branch_id)
  ));

CREATE POLICY customer_receivable_adjustments_scope_select_v1
  ON public.customer_receivable_adjustments FOR SELECT TO authenticated
  USING (public.rls_can_access_branch(tenant_id, branch_id));

REVOKE ALL ON TABLE public.customer_receivable_accounts,
                    public.customer_credit_policies,
                    public.customer_receivable_operations,
                    public.customer_payment_receipts,
                    public.customer_payment_receipt_tenders,
                    public.customer_receivable_entries,
                    public.customer_payment_allocations,
                    public.customer_receivable_adjustments
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.customer_receivable_accounts,
                      public.customer_credit_policies,
                      public.customer_receivable_operations,
                      public.customer_payment_receipts,
                      public.customer_payment_receipt_tenders,
                      public.customer_receivable_entries,
                      public.customer_payment_allocations,
                      public.customer_receivable_adjustments
  TO authenticated;

COMMENT ON COLUMN public.invoices.due_date IS
  'Optional commercial due date. Receivables aging falls back to invoice_date when absent; an invoice is overdue only when an explicit due_date is past.';
