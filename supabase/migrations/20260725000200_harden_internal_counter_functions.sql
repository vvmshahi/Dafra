-- Counter allocators are internal mutable primitives, not browser RPCs.

CREATE OR REPLACE FUNCTION public.get_next_zatca_counter(
  p_branch_id uuid,
  p_env varchar DEFAULT 'sandbox'
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_counter bigint;
BEGIN
  UPDATE public.zatca_certificates
  SET invoice_counter = invoice_counter + 1
  WHERE branch_id = p_branch_id
    AND environment = p_env
  RETURNING invoice_counter INTO v_counter;

  RETURN v_counter;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_next_invoice_counter(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_next_invoice_counter(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_next_invoice_counter(uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.get_next_zatca_counter(uuid, varchar) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_next_zatca_counter(uuid, varchar) FROM anon;
REVOKE ALL ON FUNCTION public.get_next_zatca_counter(uuid, varchar) FROM authenticated;

COMMENT ON FUNCTION public.get_next_invoice_counter(uuid) IS
  'Internal invoice-number allocator; callable only through trusted database flows.';

COMMENT ON FUNCTION public.get_next_zatca_counter(uuid, varchar) IS
  'Internal legacy certificate/environment counter allocator; not a browser RPC.';
