-- ============================================================
-- add-customer-type.sql
-- Adds B2B customer support fields to the customers table.
-- Run in Supabase SQL Editor AFTER schema.sql has been applied.
-- Safe to run multiple times (IF NOT EXISTS).
-- ============================================================

-- customer_type: 'individual' (B2C) or 'business' (B2B)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_type TEXT
    NOT NULL DEFAULT 'individual'
    CHECK (customer_type IN ('individual', 'business'));

-- business_name: English legal entity name (required for B2B)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS business_name TEXT;

-- business_name_ar: Arabic legal entity name (optional for B2B)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS business_name_ar TEXT;

-- Backfill: copy existing company_name → business_name for any
-- rows already tagged as business
UPDATE public.customers
  SET business_name = company_name
  WHERE customer_type = 'business'
    AND business_name IS NULL
    AND company_name IS NOT NULL;
