-- ============================================================
-- Phase 5V: Structured expense VAT-supporting details
-- Apply manually after Phase 5U.
--
-- Attachments remain optional. These nullable snapshot fields let
-- a claimable expense retain the supplier/document details used at
-- entry time even if the supplier record later changes.
-- ============================================================

BEGIN;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_cr_number TEXT,
  ADD COLUMN IF NOT EXISTS supplier_contact TEXT,
  ADD COLUMN IF NOT EXISTS invoice_time TIME;

CREATE INDEX IF NOT EXISTS expenses_supplier_id_idx
  ON public.expenses (supplier_id)
  WHERE supplier_id IS NOT NULL;

COMMENT ON COLUMN public.expenses.supplier_id IS
  'Optional branch supplier link. Vendor and registration fields remain point-in-time snapshots.';
COMMENT ON COLUMN public.expenses.supplier_cr_number IS
  'Optional supplier commercial-registration snapshot from the supporting document.';
COMMENT ON COLUMN public.expenses.supplier_contact IS
  'Optional supplier contact snapshot relevant to the expense record.';
COMMENT ON COLUMN public.expenses.invoice_time IS
  'Optional time printed on the supplier tax invoice; expense_date remains the single accounting date.';

NOTIFY pgrst, 'reload schema';

COMMIT;
