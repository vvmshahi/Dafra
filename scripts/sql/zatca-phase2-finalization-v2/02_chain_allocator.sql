-- ZATCA Phase 2 immutable finalization v2
-- 02_chain_allocator.sql
-- One compliance-unit head and at most one unresolved reservation per branch.

BEGIN;

CREATE TABLE IF NOT EXISTS public.zatca_chain_heads_v2 (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  last_committed_counter bigint NOT NULL CHECK (last_committed_counter >= 0),
  last_committed_hash text NOT NULL,
  seeded_from text NOT NULL CHECK (seeded_from IN ('new_compliance_unit', 'controlled_reconciliation')),
  seed_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS public.zatca_chain_reservations_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  claim_token uuid NOT NULL,
  counter_number bigint NOT NULL CHECK (counter_number > 0),
  previous_hash text NOT NULL,
  committed_artifact_hash text,
  state text NOT NULL CHECK (state IN ('allocated', 'committed')),
  allocated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  committed_at timestamptz,
  UNIQUE (invoice_id),
  UNIQUE (tenant_id, branch_id, counter_number),
  FOREIGN KEY (tenant_id, branch_id)
    REFERENCES public.zatca_chain_heads_v2(tenant_id, branch_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS zatca_chain_one_open_reservation_v2
ON public.zatca_chain_reservations_v2(tenant_id, branch_id)
WHERE state = 'allocated';

ALTER TABLE public.zatca_chain_heads_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zatca_chain_reservations_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_chain_heads_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.zatca_chain_reservations_v2 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zatca_chain_heads_v2 TO service_role;
GRANT ALL ON public.zatca_chain_reservations_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.seed_zatca_chain_head_v2(
  p_branch_id uuid,
  p_last_committed_counter bigint,
  p_last_committed_hash text,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_last_committed_counter < 0
     OR NULLIF(btrim(p_last_committed_hash), '') IS NULL
     OR NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_CHAIN_SEED';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM public.branches WHERE id = p_branch_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_tenant_id::text || ':' || p_branch_id::text, 0
  ));

  INSERT INTO public.zatca_chain_heads_v2 (
    tenant_id, branch_id, last_committed_counter, last_committed_hash,
    seeded_from, seed_reason
  ) VALUES (
    v_tenant_id, p_branch_id, p_last_committed_counter,
    btrim(p_last_committed_hash), 'controlled_reconciliation', btrim(p_reason)
  ) ON CONFLICT (tenant_id, branch_id) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAIN_HEAD_ALREADY_EXISTS'; END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.allocate_zatca_chain_v2(
  p_invoice_id uuid,
  p_claim_token uuid
) RETURNS TABLE (
  allocation_status text,
  reservation_id uuid,
  counter_number bigint,
  previous_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_head public.zatca_chain_heads_v2%ROWTYPE;
  v_existing public.zatca_chain_reservations_v2%ROWTYPE;
  v_open_invoice_id uuid;
  v_first_hash constant text :=
    'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
BEGIN
  SELECT * INTO v_invoice FROM public.invoices
  WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2' THEN
    RAISE EXCEPTION 'LEGACY_INVOICE_NOT_ALLOCATABLE';
  END IF;

  SELECT * INTO v_existing
  FROM public.zatca_chain_reservations_v2
  WHERE invoice_id = p_invoice_id
  FOR UPDATE;

  -- A committed reservation is immutable. The claimant that committed it may
  -- retry and receive the original allocation even though artifact persistence
  -- has already cleared the invoice lease. No other token receives it.
  IF FOUND AND v_existing.state = 'committed' THEN
    IF v_existing.claim_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'STALE_CHAIN_CLAIM_TOKEN';
    END IF;
    RETURN QUERY SELECT
      'committed'::text,
      v_existing.id, v_existing.counter_number, v_existing.previous_hash;
    RETURN;
  END IF;

  -- Allocation and reuse are owned by the invoice's current, live local
  -- finalization claim. claim_zatca_finalization_v2 is the only path that may
  -- transfer an allocated reservation during an expired-lease reclaim.
  IF p_claim_token IS NULL
     OR v_invoice.zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token
     OR v_invoice.zatca_finalization_lease_expires_at_v2 IS NULL
     OR v_invoice.zatca_finalization_lease_expires_at_v2 <= clock_timestamp()
     OR v_invoice.zatca_lifecycle_state NOT IN ('claiming', 'retrying') THEN
    RAISE EXCEPTION 'STALE_CHAIN_CLAIM_TOKEN';
  END IF;

  IF FOUND THEN
    IF v_existing.claim_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'STALE_CHAIN_CLAIM_TOKEN';
    END IF;
    RETURN QUERY SELECT 'reused'::text,
      v_existing.id, v_existing.counter_number, v_existing.previous_hash;
    RETURN;
  END IF;

  -- Serialize the empty-head case as well as the normal row-lock case. The
  -- advisory lock is transaction-scoped and keyed to this compliance unit, so
  -- two first allocations cannot race on a missing primary-key row.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_invoice.tenant_id::text || ':' || v_invoice.branch_id::text, 0
  ));

  SELECT * INTO v_head
  FROM public.zatca_chain_heads_v2
  WHERE tenant_id = v_invoice.tenant_id AND branch_id = v_invoice.branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Automatic first-hash initialization is allowed only for a genuinely new
    -- compliance unit. Existing branches require an explicit reviewed seed;
    -- legacy reported status is never trusted as chain proof.
    IF EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.tenant_id = v_invoice.tenant_id
        AND i.branch_id = v_invoice.branch_id
        AND i.id <> p_invoice_id
    ) THEN
      RAISE EXCEPTION 'CHAIN_HEAD_RECONCILIATION_REQUIRED';
    END IF;

    INSERT INTO public.zatca_chain_heads_v2 (
      tenant_id, branch_id, last_committed_counter, last_committed_hash, seeded_from
    ) VALUES (
      v_invoice.tenant_id, v_invoice.branch_id, 0, v_first_hash, 'new_compliance_unit'
    ) ON CONFLICT (tenant_id, branch_id) DO NOTHING;

    -- Reread under a row lock whether this transaction inserted the head or a
    -- concurrent deterministic initializer completed first.
    SELECT * INTO v_head
    FROM public.zatca_chain_heads_v2
    WHERE tenant_id = v_invoice.tenant_id AND branch_id = v_invoice.branch_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CHAIN_HEAD_INITIALIZATION_FAILED'; END IF;
  END IF;

  SELECT invoice_id INTO v_open_invoice_id
  FROM public.zatca_chain_reservations_v2
  WHERE tenant_id = v_invoice.tenant_id
    AND branch_id = v_invoice.branch_id
    AND state = 'allocated'
  LIMIT 1;

  IF v_open_invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'CHAIN_PREDECESSOR_PENDING:%', v_open_invoice_id;
  END IF;

  INSERT INTO public.zatca_chain_reservations_v2 (
    tenant_id, branch_id, invoice_id, claim_token, counter_number,
    previous_hash, state
  ) VALUES (
    v_invoice.tenant_id, v_invoice.branch_id, p_invoice_id, p_claim_token,
    v_head.last_committed_counter + 1, v_head.last_committed_hash, 'allocated'
  ) RETURNING * INTO v_existing;

  RETURN QUERY SELECT 'allocated'::text, v_existing.id,
    v_existing.counter_number, v_existing.previous_hash;
END
$function$;

CREATE OR REPLACE FUNCTION public.commit_zatca_chain_v2(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_artifact_hash text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_reservation public.zatca_chain_reservations_v2%ROWTYPE;
  v_head public.zatca_chain_heads_v2%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_artifact_hash), '') IS NULL THEN
    RAISE EXCEPTION 'EMPTY_ARTIFACT_HASH';
  END IF;

  -- Keep the same invoice -> reservation -> head lock order used by claims and
  -- allocation, avoiding a claim-transfer/commit deadlock.
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  SELECT * INTO v_reservation
  FROM public.zatca_chain_reservations_v2
  WHERE invoice_id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAIN_RESERVATION_NOT_FOUND'; END IF;

  IF v_reservation.state = 'committed' THEN
    IF v_reservation.claim_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'STALE_CHAIN_CLAIM_TOKEN';
    END IF;
    IF v_reservation.committed_artifact_hash = btrim(p_artifact_hash) THEN RETURN; END IF;
    RAISE EXCEPTION 'CHAIN_ALREADY_COMMITTED_WITH_DIFFERENT_HASH';
  END IF;

  IF p_claim_token IS NULL
     OR v_reservation.claim_token IS DISTINCT FROM p_claim_token
     OR v_invoice.zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token
     OR v_invoice.zatca_finalization_lease_expires_at_v2 IS NULL
     OR v_invoice.zatca_finalization_lease_expires_at_v2 <= clock_timestamp()
     OR v_invoice.zatca_lifecycle_state NOT IN ('claiming', 'retrying') THEN
    RAISE EXCEPTION 'STALE_CHAIN_CLAIM_TOKEN';
  END IF;

  SELECT * INTO v_head
  FROM public.zatca_chain_heads_v2
  WHERE tenant_id = v_reservation.tenant_id AND branch_id = v_reservation.branch_id
  FOR UPDATE;

  IF v_head.last_committed_counter + 1 <> v_reservation.counter_number
     OR v_head.last_committed_hash IS DISTINCT FROM v_reservation.previous_hash THEN
    RAISE EXCEPTION 'CHAIN_HEAD_MISMATCH';
  END IF;

  UPDATE public.zatca_chain_heads_v2 SET
    last_committed_counter = v_reservation.counter_number,
    last_committed_hash = btrim(p_artifact_hash),
    updated_at = clock_timestamp()
  WHERE tenant_id = v_reservation.tenant_id AND branch_id = v_reservation.branch_id;

  UPDATE public.zatca_chain_reservations_v2 SET
    state = 'committed',
    committed_artifact_hash = btrim(p_artifact_hash),
    committed_at = clock_timestamp()
  WHERE id = v_reservation.id;

  UPDATE public.invoices SET
    zatca_counter_number = v_reservation.counter_number,
    zatca_prev_invoice_hash = v_reservation.previous_hash
  WHERE id = p_invoice_id;
END
$function$;

REVOKE ALL ON FUNCTION public.seed_zatca_chain_head_v2(uuid, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_zatca_chain_v2(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_zatca_chain_v2(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_zatca_chain_head_v2(uuid, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_zatca_chain_v2(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_zatca_chain_v2(uuid, uuid, text) TO service_role;

COMMIT;
