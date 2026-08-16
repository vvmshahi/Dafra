-- Checkout is register-bound. Keep this guard at the public dispatcher so it
-- covers the normal RPC, the legacy Edge flow, and the atomic commit path.
BEGIN;

ALTER FUNCTION public.pos_checkout(jsonb)
  RENAME TO pos_checkout_before_open_register_v1;

REVOKE ALL ON FUNCTION public.pos_checkout_before_open_register_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pos_checkout(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_branch_id uuid;
  v_customer_id uuid;
  v_session_id uuid;
  v_decision jsonb;
  v_code text;
  v_session public.pos_sessions%ROWTYPE;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CHECKOUT_PAYLOAD' USING ERRCODE = '22023';
  END IF;

  v_branch_id := NULLIF(btrim(COALESCE(p_payload->>'branch_id', '')), '')::uuid;
  v_customer_id := NULLIF(btrim(COALESCE(p_payload->>'customer_id', '')), '')::uuid;
  v_session_id := NULLIF(btrim(COALESCE(p_payload->>'session_id', '')), '')::uuid;

  -- Preserve the existing, authoritative document and actor authorization
  -- before looking at a register row.
  v_decision := public.resolve_pos_checkout_document_internal_v1(
    auth.uid(), v_branch_id, v_customer_id
  );
  IF v_decision->>'status' IS DISTINCT FROM 'allowed' THEN
    v_code := COALESCE(v_decision->>'code', 'CHECKOUT_DOCUMENT_BLOCKED');
    RAISE EXCEPTION '%', v_code USING ERRCODE = 'P0001';
  END IF;

  IF v_session_id IS NULL THEN
    RAISE EXCEPTION 'NO_SESSION' USING ERRCODE = 'P0001';
  END IF;

  -- FOR SHARE conflicts with the row update used to close a register. The
  -- lock lives for this checkout transaction, so a close cannot win between
  -- validation and the authoritative commercial commit.
  SELECT * INTO v_session
  FROM public.pos_sessions
  WHERE id = v_session_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_SESSION' USING ERRCODE = 'P0001';
  END IF;

  IF v_session.tenant_id IS DISTINCT FROM (
       SELECT tenant_id FROM public.branches WHERE id = v_branch_id
     )
     OR v_session.branch_id IS DISTINCT FROM v_branch_id THEN
    RAISE EXCEPTION 'CROSS_BRANCH_SESSION' USING ERRCODE = 'P0001';
  END IF;

  IF v_session.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'CLOSED_SESSION' USING ERRCODE = 'P0001';
  END IF;

  RETURN public.pos_checkout_before_open_register_v1(p_payload);
END
$function$;

ALTER FUNCTION public.pos_checkout(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pos_checkout(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_checkout(jsonb) TO authenticated;
COMMENT ON FUNCTION public.pos_checkout(jsonb) IS
  'Authoritative POS checkout. Requires an authenticated, authorized actor and an open same-tenant, same-branch register session held through commercial commit.';

-- Keep the function-contract registry aligned for later release checks.
INSERT INTO public.product_units_commercial_function_contracts_v1 (
  function_signature, definition_md5, registered_at
)
VALUES (
  'public.pos_checkout(jsonb)',
  md5(pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure)),
  clock_timestamp()
)
ON CONFLICT (function_signature) DO UPDATE
SET definition_md5 = EXCLUDED.definition_md5,
    registered_at = EXCLUDED.registered_at;

NOTIFY pgrst, 'reload schema';
COMMIT;
