-- Phase 5I: invoice list read-performance indexes
--
-- Apply manually after reviewing query plans on staging.
-- This migration only adds indexes. It does not change invoice data, RLS,
-- ZATCA logic, credit note logic, or report calculations.

CREATE INDEX IF NOT EXISTS invoices_branch_date_created_idx
  ON public.invoices (tenant_id, branch_id, invoice_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS invoices_branch_zatca_status_created_idx
  ON public.invoices (tenant_id, branch_id, zatca_status, created_at DESC);

CREATE INDEX IF NOT EXISTS invoices_credit_notes_by_original_idx
  ON public.invoices (tenant_id, branch_id, original_invoice_id, created_at DESC)
  WHERE original_invoice_id IS NOT NULL
    AND zatca_invoice_type = 'credit_note'
    AND status <> 'cancelled';

COMMENT ON INDEX public.invoices_branch_date_created_idx IS
  'Supports invoice list filtering by tenant, branch, invoice_date range, newest first.';

COMMENT ON INDEX public.invoices_branch_zatca_status_created_idx IS
  'Supports branch invoice list and retry/status scans by ZATCA status.';

COMMENT ON INDEX public.invoices_credit_notes_by_original_idx IS
  'Supports invoice list lookup of linked full credit notes for displayed original invoices.';
