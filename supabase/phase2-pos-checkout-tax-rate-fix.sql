-- ============================================================
-- Phase 2 POS checkout tax_rate compatibility fix
-- Apply manually in Supabase SQL editor after phase2-pos-checkout-rpc-fix.sql.
-- ============================================================
--
-- Fixes:
--   1. public.pos_checkout must store invoice_items.tax_rate as the existing
--      ZATCA-facing decimal fraction convention: 0.15 for 15% VAT.
--   2. Repair only the already-created failed invoice INV-0005 item tax_rate
--      from 15.00 to 0.15.
--
-- This patch does not change invoice totals, ZATCA credentials, signing,
-- XML generation, QR generation, onboarding, or production credentials.
-- It does not call ZATCA.

BEGIN;

DO $$
DECLARE
  v_function_sql TEXT;
BEGIN
  SELECT pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)
    INTO v_function_sql;

  IF v_function_sql IS NULL THEN
    RAISE EXCEPTION 'public.pos_checkout(jsonb) not found'
      USING ERRCODE = '42883';
  END IF;

  IF position('''tax_rate'', v_rate_percent' IN v_function_sql) > 0 THEN
    v_function_sql := replace(
      v_function_sql,
      '''tax_rate'', v_rate_percent',
      '''tax_rate'', v_rate'
    );
    EXECUTE v_function_sql;
  ELSIF position('''tax_rate'', v_rate' IN v_function_sql) = 0 THEN
    RAISE EXCEPTION 'Could not confirm pos_checkout tax_rate assignment pattern'
      USING ERRCODE = '22023';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.pos_checkout(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb) TO authenticated;

COMMENT ON FUNCTION public.pos_checkout(jsonb) IS
  'Backend-controlled POS checkout. Recalculates totals, writes invoice/items/payment transactionally, supports idempotency, and optionally decrements tracked product stock.';

UPDATE public.invoice_items
SET tax_rate = 0.15
WHERE invoice_id = '51e1087d-461b-4143-9ce0-f209c99a1090'::uuid
  AND tax_rate = 15.00;

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm the repaired INV-0005 item tax_rate uses the decimal fraction:
--
-- SELECT invoice_id, tax_rate, tax_category, subtotal, tax_amount, total
-- FROM public.invoice_items
-- WHERE invoice_id = '51e1087d-461b-4143-9ce0-f209c99a1090'::uuid;
--
-- Expected:
--   tax_rate = 0.15
--   tax_category = S
--   subtotal/tax_amount/total unchanged
--
-- 2) Confirm the deployed RPC now stores the derived fraction instead of the
--    product percentage:
--
-- SELECT position('''tax_rate'', v_rate_percent' IN pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)) AS old_assignment_pos,
--        position('''tax_rate'', v_rate' IN pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)) AS new_assignment_pos;
--
-- Expected:
--   old_assignment_pos = 0
--   new_assignment_pos > 0
