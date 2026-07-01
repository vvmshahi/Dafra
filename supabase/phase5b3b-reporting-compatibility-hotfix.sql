-- ============================================================
-- Phase 5B-3B hotfix: reporting compatibility follow-up
-- Apply manually after phase5b3b-reporting-foundation.sql.
-- ============================================================
--
-- Goals:
--   - Keep server-side reporting foundation.
--   - Ensure pending receive-stock purchases never count as purchases.
--   - Preserve legacy detailed_receiving/not_applicable posted purchases.
--   - Add verification notes for authenticated RPC testing.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not apply automatically to production.
--   - Do not modify stock quantities.
--   - Do not call ZATCA.
--   - This patch does not modify ZATCA XML/signing/hash/QR/canonicalization.

BEGIN;

CREATE OR REPLACE VIEW public.reporting_counted_purchases_v AS
SELECT
  p.id,
  p.tenant_id,
  p.branch_id,
  p.supplier_id,
  p.purchase_date,
  COALESCE(p.purchase_mode, 'detailed_receiving') AS purchase_mode,
  COALESCE(p.status, 'posted') AS status,
  COALESCE(p.receiving_status, 'not_applicable') AS receiving_status,
  COALESCE(p.subtotal, 0) AS subtotal,
  COALESCE(p.vat_amount, 0) AS vat_amount,
  COALESCE(p.total_amount, 0) AS total_amount,
  (
    COALESCE(p.status, 'posted') = 'cancelled'
    OR COALESCE(p.receiving_status, 'not_applicable') IN ('cancelled', 'reversed')
  ) AS is_deleted_or_reversed,
  (
    COALESCE(p.status, 'posted') <> 'cancelled'
    AND COALESCE(p.receiving_status, 'not_applicable') NOT IN ('cancelled', 'reversed')
    AND (
      (
        COALESCE(p.purchase_mode, 'detailed_receiving') IN ('simple_bill', 'bill_only')
        AND COALESCE(p.status, 'posted') = 'posted'
      )
      OR (
        COALESCE(p.purchase_mode, 'detailed_receiving') IN ('detailed_receiving', 'receive_stock')
        AND COALESCE(p.receiving_status, 'not_applicable') IN ('confirmed', 'confirmed_legacy')
      )
      OR (
        COALESCE(p.purchase_mode, 'detailed_receiving') = 'detailed_receiving'
        AND COALESCE(p.receiving_status, 'not_applicable') = 'not_applicable'
        AND COALESCE(p.status, 'posted') = 'posted'
      )
    )
  ) AS is_counted
FROM public.purchases p;

REVOKE ALL ON TABLE public.reporting_counted_purchases_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.reporting_counted_purchases_v TO service_role;

COMMIT;

-- ============================================================
-- Verification notes
-- ============================================================
--
-- SQL Editor note:
--   SELECT auth.uid();
--   In Supabase SQL Editor this is normally NULL, so direct RPC calls that
--   depend on auth.uid() are expected to raise Unauthorized unless an
--   authenticated request context is provided.
--
-- 1) Confirm July 1 posted invoice documents are visible in the internal view:
--
-- SELECT invoice_number, zatca_invoice_type, status, invoice_date,
--        signed_total_amount, signed_tax_amount, is_counted
-- FROM public.reporting_invoice_documents_v
-- WHERE tenant_id = '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid
--   AND branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
--   AND invoice_date = '2026-07-01'::date
-- ORDER BY invoice_number;
--
-- Expected examples:
--   INV-0018       simplified   posted   counted positive
--   INV-CN-0010    credit_note  posted   counted negative
--
-- 2) Confirm pending receive-stock purchases are not counted:
--
-- SELECT id, purchase_mode, status, receiving_status, purchase_date, total_amount, is_counted
-- FROM public.reporting_counted_purchases_v
-- WHERE tenant_id = '630f6faf-fc0e-4523-a569-1179fe13de1a'::uuid
--   AND branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
-- ORDER BY purchase_date DESC, id DESC
-- LIMIT 20;
--
-- Expected:
--   pending receive-stock/detailed_receiving rows are is_counted = false.
--   confirmed/confirmed_legacy receive-stock rows are is_counted = true.
--
-- 3) Authenticated app/RPC smoke tests:
--
-- SELECT public.get_sales_report_summary(
--   '2026-07-01'::date,
--   '2026-07-01'::date,
--   '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
-- );
--
-- SELECT public.get_vat_support_summary(
--   '2026-07-01'::date,
--   '2026-07-01'::date,
--   '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
-- );
--
-- SELECT public.get_purchase_report_summary(
--   '2026-07-01'::date,
--   '2026-07-01'::date,
--   '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
-- );
