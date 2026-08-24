-- The Generation finalizer invokes the canonical invoice snapshot RPC with the
-- service-role client. Keep the RPC private to that server-side role: the
-- function is SECURITY DEFINER and must not be callable from browser roles.

BEGIN;

REVOKE ALL ON FUNCTION public.build_zatca_atomic_receipt_snapshot_v2(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.build_zatca_atomic_receipt_snapshot_v2(uuid)
  TO service_role;

-- The checkout idempotency key is not a credential. It is exposed only on an
-- already-authorized invoice row so the detail screen can invoke the same
-- idempotent Generation finalizer safely; policy revision remains server-
-- derived from the branch.
REVOKE SELECT (checkout_idempotency_key)
  ON TABLE public.invoices
  FROM anon, authenticated;

GRANT SELECT (checkout_idempotency_key)
  ON TABLE public.invoices
  TO authenticated;

COMMIT;
