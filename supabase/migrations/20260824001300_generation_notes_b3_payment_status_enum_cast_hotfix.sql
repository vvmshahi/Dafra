-- Forward-only B3 hotfix: the note RPC's payment_status CASE expression was
-- text, while invoices.payment_status is the public.payment_status enum.
DO $$
DECLARE
  v_definition text;
  v_updated text;
  v_target text := 'CASE WHEN v_kind = ''credit_note'' THEN ''refunded'' ELSE ''pending'' END,';
  v_replacement text := '(CASE WHEN v_kind = ''credit_note'' THEN ''refunded'' ELSE ''pending'' END)::public.payment_status,';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'create_generation_note_v1'
    AND p.pronargs = 1;

  IF v_definition IS NULL OR position('v_kind::public.invoice_type' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'B3 enum-cast predecessor is not installed';
  END IF;

  v_updated := replace(v_definition, v_target, v_replacement);
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'B3 payment_status enum cast target was not found';
  END IF;

  EXECUTE v_updated;
END;
$$;
