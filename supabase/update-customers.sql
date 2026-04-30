-- ============================================================
-- update-customers.sql
-- Adds company_name column to customers table.
-- Everything else (name_ar, customer_type, cr_number, city,
-- notes) already exists in schema.sql.
-- Run in Supabase SQL Editor AFTER schema.sql has been applied.
-- ============================================================

-- company_name: legal entity name for business customers,
-- separate from `name` which is the contact person's name.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);

-- ── Verification ──────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'customers' AND column_name = 'company_name';
