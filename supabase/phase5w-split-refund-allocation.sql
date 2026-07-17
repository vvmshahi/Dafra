-- ============================================================
-- Phase 5W: Explicit credit-note refund allocation
-- Apply manually after Phase 5V.
--
-- Reuses the existing atomic/idempotent credit-note RPC, then records the
-- actual cash/card refund allocation as both refund audit rows and signed
-- credit-note payment rows consumed by existing register/reporting logic.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_partial_credit_note_with_refund(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_allocations JSONB := p_payload -> 'refund_allocations';
  v_legacy_payload JSONB;
  v_result JSONB;
  v_credit_note_id UUID;
  v_original_invoice_id UUID;
  v_tenant_id UUID;
  v_branch_id UUID;
  v_reason TEXT;
  v_total NUMERIC(12, 2);
  v_allocation_total NUMERIC(12, 2);
  v_allocation_count INTEGER;
  v_method TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR v_allocations IS NULL OR jsonb_typeof(v_allocations) <> 'array'
     OR jsonb_array_length(v_allocations) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'A cash/card refund allocation is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC)
    WHERE a.method NOT IN ('cash', 'card') OR a.amount IS NULL OR a.amount <= 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC)
    GROUP BY a.method HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Refund allocations must contain unique positive cash/card amounts' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*), ROUND(SUM(a.amount), 2)
    INTO v_allocation_count, v_allocation_total
  FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC);

  v_method := CASE
    WHEN v_allocation_count = 1 THEN v_allocations -> 0 ->> 'method'
    ELSE 'other'
  END;
  v_legacy_payload := jsonb_set(p_payload - 'refund_allocations', '{refund_method}', to_jsonb(v_method), TRUE);
  v_result := public.create_partial_credit_note(v_legacy_payload);
  v_credit_note_id := (v_result ->> 'credit_note_invoice_id')::UUID;
  v_total := ROUND((v_result ->> 'total')::NUMERIC, 2);

  IF ABS(v_allocation_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'Refund allocation must equal the credit-note total' USING ERRCODE = '23514';
  END IF;

  -- Idempotent replay preserves the allocation written by the first call.
  IF COALESCE((v_result ->> 'idempotent_replay')::BOOLEAN, FALSE) THEN
    RETURN v_result;
  END IF;

  SELECT cn.original_invoice_id, cn.tenant_id, cn.branch_id, cn.credit_reason
    INTO v_original_invoice_id, v_tenant_id, v_branch_id, v_reason
  FROM public.invoices cn
  WHERE cn.id = v_credit_note_id
  FOR UPDATE;

  DELETE FROM public.payment_refunds WHERE credit_note_invoice_id = v_credit_note_id;

  INSERT INTO public.payment_refunds (
    tenant_id, branch_id, original_invoice_id, credit_note_invoice_id,
    payment_id, method, amount, reason, status, created_by, created_at
  )
  SELECT
    v_tenant_id, v_branch_id, v_original_invoice_id, v_credit_note_id,
    NULL, a.method::public.payment_method, ROUND(a.amount, 2), v_reason,
    'completed', v_user_id, NOW()
  FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC);

  INSERT INTO public.payments (
    tenant_id, invoice_id, recorded_by, amount, amount_received,
    change_amount, method, paid_at
  )
  SELECT
    v_tenant_id, v_credit_note_id, v_user_id, ROUND(a.amount, 2),
    ROUND(a.amount, 2), 0, a.method::public.payment_method, NOW()
  FROM jsonb_to_recordset(v_allocations) AS a(method TEXT, amount NUMERIC);

  UPDATE public.invoices
  SET payment_method = v_method::public.payment_method
  WHERE id = v_credit_note_id;

  RETURN v_result || jsonb_build_object(
    'refund_method', CASE WHEN v_allocation_count = 2 THEN 'split' ELSE v_method END,
    'refund_allocations', v_allocations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_partial_credit_note_with_refund(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note_with_refund(JSONB) TO authenticated;
ALTER FUNCTION public.create_partial_credit_note_with_refund(JSONB) SET row_security = off;

COMMENT ON FUNCTION public.create_partial_credit_note_with_refund(JSONB) IS
  'Creates an atomic idempotent partial credit note with explicit cash/card refund allocation.';

NOTIFY pgrst, 'reload schema';

COMMIT;
