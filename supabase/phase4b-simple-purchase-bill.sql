-- ============================================================
-- Phase 4B simple purchase bill entry + receiving groundwork
-- Apply manually after Phase 3C.
-- ============================================================
--
-- Goals:
--   - Allow purchase bill headers without item breakdown.
--   - Preserve existing detailed receiving flow.
--   - Add safe metadata for future draft/OCR/review workflows.
--   - Do not change existing stock quantities or delete purchases.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not call ZATCA.
--   - This patch does not modify ZATCA XML/signing/hash/QR/canonicalization.
--   - This patch does not remove the existing purchase_items stock trigger.
--
-- Stock behavior after this patch:
--   - simple_bill purchases insert no purchase_items and therefore do not
--     increase stock.
--   - detailed_receiving purchases preserve current behavior: inserting a
--     purchase_items row with inventory_item_id still increases stock
--     immediately through trg_purchase_item_update_stock.
--   - Phase 4C should replace that trigger with an explicit
--     confirm_purchase_receiving RPC.

BEGIN;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS purchase_mode TEXT NOT NULL DEFAULT 'detailed_receiving';

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'posted';

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS bill_number TEXT;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS tax_input_mode TEXT NOT NULL DEFAULT 'none';

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchases_purchase_mode_check'
      AND conrelid = 'public.purchases'::regclass
  ) THEN
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_purchase_mode_check
      CHECK (purchase_mode IN ('simple_bill', 'detailed_receiving')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchases_status_check'
      AND conrelid = 'public.purchases'::regclass
  ) THEN
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_status_check
      CHECK (status IN ('draft', 'posted', 'cancelled')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchases_tax_input_mode_check'
      AND conrelid = 'public.purchases'::regclass
  ) THEN
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_tax_input_mode_check
      CHECK (tax_input_mode IN ('none', 'included', 'excluded', 'manual')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchases_payment_status_check'
      AND conrelid = 'public.purchases'::regclass
  ) THEN
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_payment_status_check
      CHECK (payment_status IN ('paid', 'unpaid', 'partial')) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.purchases.purchase_mode IS
  'simple_bill records supplier bill/accounting history only; detailed_receiving may include purchase_items.';

COMMENT ON COLUMN public.purchases.status IS
  'Purchase document lifecycle groundwork. Existing direct-entry purchases remain posted.';

COMMENT ON COLUMN public.purchases.bill_number IS
  'Supplier bill/invoice number when available.';

COMMENT ON COLUMN public.purchases.tax_input_mode IS
  'How VAT was entered: none, included, excluded, or manual.';

COMMENT ON COLUMN public.purchases.payment_status IS
  'Supplier bill payment status: paid, unpaid, or partial.';

CREATE INDEX IF NOT EXISTS purchases_branch_mode_date_idx
  ON public.purchases (branch_id, purchase_mode, purchase_date DESC);

CREATE INDEX IF NOT EXISTS purchases_branch_status_date_idx
  ON public.purchases (branch_id, status, purchase_date DESC);

CREATE OR REPLACE FUNCTION public.audit_purchase_write_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.record_audit_event(
      'purchase_bill_created',
      NEW.tenant_id,
      NEW.branch_id,
      NEW.added_by,
      NULL,
      'purchase',
      NEW.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', NEW.purchase_mode,
        'status', NEW.status,
        'tax_input_mode', NEW.tax_input_mode,
        'payment_status', NEW.payment_status,
        'payment_method', NEW.payment_method,
        'has_bill_number', NEW.bill_number IS NOT NULL,
        'has_bill_url', NEW.bill_url IS NOT NULL,
        'total_amount', NEW.total_amount
      ),
      NULL,
      NULL
    );
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.record_audit_event(
      'purchase_bill_updated',
      NEW.tenant_id,
      NEW.branch_id,
      auth.uid(),
      NULL,
      'purchase',
      NEW.id,
      'info',
      'succeeded',
      jsonb_build_object(
        'purchase_mode', NEW.purchase_mode,
        'status', NEW.status,
        'tax_input_mode', NEW.tax_input_mode,
        'payment_status', NEW.payment_status,
        'payment_method', NEW.payment_method,
        'has_bill_number', NEW.bill_number IS NOT NULL,
        'has_bill_url', NEW.bill_url IS NOT NULL,
        'total_amount', NEW.total_amount
      ),
      NULL,
      NULL
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS phase4b_audit_purchase_write ON public.purchases;
CREATE TRIGGER phase4b_audit_purchase_write
  AFTER INSERT OR UPDATE ON public.purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_purchase_write_event();

REVOKE ALL ON FUNCTION public.audit_purchase_write_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_purchase_write_event() TO service_role;

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm Phase 4B purchase columns:
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'purchases'
--   AND column_name IN (
--     'purchase_mode',
--     'status',
--     'bill_number',
--     'tax_input_mode',
--     'payment_status'
--   )
-- ORDER BY column_name;
--
-- 2) Confirm audit trigger exists:
--
-- SELECT event_object_table, trigger_name, event_manipulation
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'public'
--   AND event_object_table = 'purchases'
--   AND trigger_name = 'phase4b_audit_purchase_write'
-- ORDER BY event_manipulation;
--
-- 3) Confirm direct purchase grants were not broadened by this patch:
--
-- SELECT table_name, grantee, privilege_type
-- FROM information_schema.role_table_grants
-- WHERE table_schema = 'public'
--   AND table_name IN ('purchases', 'purchase_items')
--   AND grantee IN ('anon', 'authenticated')
-- ORDER BY table_name, grantee, privilege_type;
--
-- 4) Existing stock trigger is intentionally still present for Phase 4B:
--
-- SELECT trigger_name, event_object_table, event_manipulation
-- FROM information_schema.triggers
-- WHERE event_object_schema = 'public'
--   AND event_object_table = 'purchase_items'
--   AND trigger_name = 'trg_purchase_item_update_stock';
