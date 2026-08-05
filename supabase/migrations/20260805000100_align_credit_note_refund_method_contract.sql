-- Align the atomic Credit Note refund wrapper with the deployed contract.
-- The UI label is Bank transfer; its persisted payment/refund method is the
-- existing public.payment_method value bank_transfer.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_partial_credit_note_with_refund(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_allocations jsonb := p_payload -> 'refund_allocations';
  v_legacy_payload jsonb;
  v_result jsonb;
  v_credit_note_id uuid;
  v_original_invoice_id uuid;
  v_tenant_id uuid;
  v_branch_id uuid;
  v_reason text;
  v_total numeric(12,2);
  v_allocation_total numeric(12,2);
  v_allocation_count integer;
  v_method text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF lower(coalesce(p_payload ->> 'apply_receivables_settlement', 'false')) = 'true' THEN
    RAISE EXCEPTION 'CREDIT_NOTE_RECEIVABLES_NOT_APPLICABLE' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR v_allocations IS NULL OR jsonb_typeof(v_allocations) <> 'array'
     OR jsonb_array_length(v_allocations) NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'CREDIT_NOTE_REFUND_ALLOCATION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric)
    WHERE a.method NOT IN ('cash', 'bank_transfer') OR a.amount IS NULL OR a.amount <= 0
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric)
    GROUP BY a.method HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'CREDIT_NOTE_REFUND_ALLOCATION_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT count(*), round(sum(a.amount), 2) INTO v_allocation_count, v_allocation_total
  FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric);
  v_method := CASE WHEN v_allocation_count = 1 THEN v_allocations -> 0 ->> 'method' ELSE 'other' END;
  v_legacy_payload := jsonb_set(p_payload - 'refund_allocations', '{refund_method}', to_jsonb(v_method), true);
  v_result := public.create_partial_credit_note(v_legacy_payload);
  v_credit_note_id := (v_result ->> 'credit_note_invoice_id')::uuid;
  v_total := round((v_result ->> 'total')::numeric, 2);
  IF abs(v_allocation_total - v_total) > 0.01 THEN
    RAISE EXCEPTION 'CREDIT_NOTE_REFUND_ALLOCATION_INVALID' USING ERRCODE = '23514';
  END IF;
  IF coalesce((v_result ->> 'idempotent_replay')::boolean, false) THEN
    RETURN v_result;
  END IF;

  SELECT cn.original_invoice_id, cn.tenant_id, cn.branch_id, cn.credit_reason
    INTO v_original_invoice_id, v_tenant_id, v_branch_id, v_reason
  FROM public.invoices cn WHERE cn.id = v_credit_note_id FOR UPDATE;
  DELETE FROM public.payment_refunds WHERE credit_note_invoice_id = v_credit_note_id;
  INSERT INTO public.payment_refunds (
    tenant_id, branch_id, original_invoice_id, credit_note_invoice_id, payment_id,
    method, amount, reason, status, created_by, created_at
  )
  SELECT v_tenant_id, v_branch_id, v_original_invoice_id, v_credit_note_id, NULL,
    a.method::public.payment_method, round(a.amount, 2), v_reason, 'completed', v_user_id, now()
  FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric);
  INSERT INTO public.payments (
    tenant_id, invoice_id, recorded_by, amount, amount_received, change_amount, method, paid_at
  )
  SELECT v_tenant_id, v_credit_note_id, v_user_id, round(a.amount, 2), round(a.amount, 2), 0,
    a.method::public.payment_method, now()
  FROM jsonb_to_recordset(v_allocations) AS a(method text, amount numeric);
  UPDATE public.invoices SET payment_method = v_method::public.payment_method WHERE id = v_credit_note_id;
  RETURN v_result || jsonb_build_object(
    'refund_method', CASE WHEN v_allocation_count = 2 THEN 'split' ELSE v_method END,
    'refund_allocations', v_allocations
  );
END
$function$;

ALTER FUNCTION public.create_partial_credit_note_with_refund(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_partial_credit_note_with_refund(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note_with_refund(jsonb)
  TO authenticated, service_role;

COMMIT;
