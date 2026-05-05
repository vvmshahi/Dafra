-- ============================================================
-- FIX: Invoice numbers unique per branch (not per tenant)
--
-- Problem: UNIQUE (tenant_id, invoice_number) prevents two branches
-- in the same tenant from both having e.g. INV-0001.
-- Fix: Change unique constraint to (branch_id, invoice_number).
-- The get_next_invoice_counter() function already increments
-- branches.invoice_counter per branch — no function change needed.
-- ============================================================

-- ── 1. Drop old tenant-level unique constraint and index ──────

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS invoices_tenant_id_invoice_number_key;

DROP INDEX IF EXISTS idx_invoices_number;

-- ── 2. Add branch-level unique constraint ─────────────────────

ALTER TABLE invoices
  ADD CONSTRAINT invoices_branch_id_invoice_number_key
  UNIQUE (branch_id, invoice_number);

-- ── 3. Recreate supporting index ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invoices_number
  ON invoices (branch_id, invoice_number);
