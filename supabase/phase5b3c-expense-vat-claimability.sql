-- ============================================================
-- Phase 5B-3C hotfix: expense VAT claimability and cash correctness
-- Apply manually after Phase 5B-3B reporting foundation and later
-- reporting hotfixes.
-- ============================================================
--
-- Goals:
--   - Keep expense entered amount as the actual amount paid.
--   - Store claimable VAT separately when VAT is included in the paid amount.
--   - Keep cash/bank/card movement based on total_paid.
--   - Count only explicitly claimable expense VAT as input VAT.
--   - Keep non-claimable/no-VAT expenses fully in expense/profit totals.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify production data.
--   - Do not call ZATCA.
--   - Do not modify ZATCA XML/signing/hash/QR/canonicalization.

BEGIN;

-- ============================================================
-- Expense VAT claimability fields
-- ============================================================

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vat_claim_status TEXT,
  ADD COLUMN IF NOT EXISTS expense_before_vat NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS tax_invoice_number TEXT,
  ADD COLUMN IF NOT EXISTS supplier_vat_number TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND conname = 'expenses_vat_claim_status_check'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_vat_claim_status_check
      CHECK (
        vat_claim_status IS NULL
        OR vat_claim_status IN ('no_vat', 'claimable', 'not_claimable', 'needs_review')
      )
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.expenses'::regclass
      AND conname = 'expenses_expense_before_vat_check'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_expense_before_vat_check
      CHECK (expense_before_vat IS NULL OR expense_before_vat >= 0)
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS expenses_vat_claim_status_idx
  ON public.expenses(branch_id, vat_claim_status, expense_date DESC);

COMMENT ON COLUMN public.expenses.total_paid IS
  'Actual amount paid by cash/card/bank. Cash drawer and expense totals use this value.';

COMMENT ON COLUMN public.expenses.amount IS
  'Expense amount before claimable VAT for new Phase 5B-3C rows; legacy rows may have stored the entered amount.';

COMMENT ON COLUMN public.expenses.expense_before_vat IS
  'Expense amount excluding claimable VAT. For no-VAT/not-claimable rows this should equal total_paid.';

COMMENT ON COLUMN public.expenses.vat_claim_status IS
  'Expense VAT status: no_vat, claimable, not_claimable, or needs_review. Only claimable feeds expense input VAT.';

COMMENT ON COLUMN public.expenses.tax_invoice_number IS
  'Optional supplier tax invoice number for manually-entered claimable expenses.';

COMMENT ON COLUMN public.expenses.supplier_vat_number IS
  'Optional supplier VAT number for manually-entered claimable expenses.';

-- ============================================================
-- Reporting expense view
-- ============================================================

CREATE OR REPLACE VIEW public.reporting_expenses_v AS
SELECT
  x.id,
  x.tenant_id,
  x.branch_id,
  x.category_id,
  x.expense_date,
  x.description,
  x.payment_method,
  x.vat_treatment,
  x.amount,
  x.vat_amount,
  x.total_paid,
  CASE
    WHEN x.vat_claim_status = 'claimable' THEN x.vat_amount
    ELSE 0
  END AS input_vat_amount,
  CASE
    WHEN x.vat_claim_status = 'claimable'
      THEN GREATEST(COALESCE(x.raw_expense_before_vat, x.total_paid - x.vat_amount), 0)
    ELSE x.total_paid
  END AS profit_expense_amount,
  x.created_at,
  x.vat_claim_status,
  CASE
    WHEN x.vat_claim_status = 'claimable'
      THEN GREATEST(COALESCE(x.raw_expense_before_vat, x.total_paid - x.vat_amount), 0)
    ELSE COALESCE(x.raw_expense_before_vat, x.total_paid)
  END AS expense_before_vat,
  x.tax_invoice_number,
  x.supplier_vat_number
FROM (
  SELECT
    e.id,
    e.tenant_id,
    e.branch_id,
    e.category_id,
    e.expense_date,
    e.description,
    COALESCE(e.payment_method, 'cash') AS payment_method,
    COALESCE(e.vat_treatment, 'no_vat') AS vat_treatment,
    COALESCE(e.amount, 0) AS amount,
    COALESCE(e.vat_amount, 0) AS vat_amount,
    COALESCE(e.total_paid, e.amount, 0) AS total_paid,
    CASE
      WHEN e.vat_claim_status IN ('no_vat', 'claimable', 'not_claimable', 'needs_review')
        THEN e.vat_claim_status
      WHEN COALESCE(e.vat_amount, 0) > 0
        OR COALESCE(e.vat_treatment, 'no_vat') <> 'no_vat'
        THEN 'needs_review'
      ELSE 'no_vat'
    END AS vat_claim_status,
    e.expense_before_vat AS raw_expense_before_vat,
    e.tax_invoice_number,
    e.supplier_vat_number,
    e.created_at
  FROM public.expenses e
) x;

REVOKE ALL ON TABLE public.reporting_expenses_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.reporting_expenses_v TO service_role;

-- Force Supabase/PostgREST to see the added expense columns for browser writes.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- 1) Confirm new columns exist:
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'expenses'
--   AND column_name IN (
--     'vat_claim_status',
--     'expense_before_vat',
--     'tax_invoice_number',
--     'supplier_vat_number'
--   )
-- ORDER BY column_name;
--
-- 2) Confirm reporting view keeps expense totals on total_paid and only
--    claimable rows feed expense input VAT:
--
-- SELECT
--   id,
--   total_paid,
--   vat_claim_status,
--   vat_amount,
--   input_vat_amount,
--   profit_expense_amount
-- FROM public.reporting_expenses_v
-- WHERE tenant_id = '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid
--   AND branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
-- ORDER BY expense_date DESC, created_at DESC
-- LIMIT 20;
--
-- Expected:
--   claimable rows: input_vat_amount = vat_amount, profit = total_paid - VAT.
--   no_vat/not_claimable/needs_review rows: input_vat_amount = 0,
--   profit_expense_amount = total_paid.
