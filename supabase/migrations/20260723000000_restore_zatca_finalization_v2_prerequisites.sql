-- Restored versioned copy of the historically deployed ZATCA v2 prerequisite package.

-- Source: scripts/sql/zatca-phase2-finalization-v2 steps 01-05, 04a, 09, and 11.

-- Disabled by default; no historical invoice classification or data rewrite.

-- BEGIN RESTORED SOURCE: 01_artifact_lifecycle.sql
-- ZATCA Phase 2 immutable finalization v2
-- 01_artifact_lifecycle.sql
-- ADDITIVE / DISABLED BY DEFAULT / NO HISTORICAL CLASSIFICATION

BEGIN;

CREATE TABLE IF NOT EXISTS public.zatca_finalization_runtime (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  immutable_finalization_enabled boolean NOT NULL DEFAULT false,
  simplified_enabled boolean NOT NULL DEFAULT false,
  standard_enabled boolean NOT NULL DEFAULT false,
  schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version = 2),
  minimum_edge_version text NOT NULL DEFAULT '2.0.0',
  minimum_client_version text NOT NULL DEFAULT '2.0.0',
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NULL REFERENCES auth.users(id)
);

INSERT INTO public.zatca_finalization_runtime (
  singleton,
  immutable_finalization_enabled,
  simplified_enabled,
  standard_enabled
) VALUES (true, false, false, false)
ON CONFLICT (singleton) DO NOTHING;

ALTER TABLE public.zatca_finalization_runtime ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_finalization_runtime FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zatca_finalization_runtime TO service_role;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS zatca_finalization_version integer,
  ADD COLUMN IF NOT EXISTS zatca_artifact_provenance text,
  ADD COLUMN IF NOT EXISTS zatca_document_kind text,
  ADD COLUMN IF NOT EXISTS zatca_lifecycle_state text,
  ADD COLUMN IF NOT EXISTS zatca_artifact_stage text,
  ADD COLUMN IF NOT EXISTS zatca_finalized_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_finalization_error_v2 jsonb,

  ADD COLUMN IF NOT EXISTS zatca_simplified_xml text,
  ADD COLUMN IF NOT EXISTS zatca_simplified_xml_hash text,
  ADD COLUMN IF NOT EXISTS zatca_simplified_signature text,
  ADD COLUMN IF NOT EXISTS zatca_simplified_qr text,

  ADD COLUMN IF NOT EXISTS zatca_provisional_xml text,
  ADD COLUMN IF NOT EXISTS zatca_provisional_xml_hash text,
  ADD COLUMN IF NOT EXISTS zatca_provisional_signature text,
  ADD COLUMN IF NOT EXISTS zatca_provisional_qr text,

  ADD COLUMN IF NOT EXISTS zatca_cleared_xml text,
  ADD COLUMN IF NOT EXISTS zatca_cleared_xml_hash text,
  ADD COLUMN IF NOT EXISTS zatca_cleared_signature text,
  ADD COLUMN IF NOT EXISTS zatca_cleared_qr text,
  ADD COLUMN IF NOT EXISTS zatca_clearance_metadata_v2 jsonb,
  ADD COLUMN IF NOT EXISTS zatca_network_response_v2 jsonb;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_finalization_version_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_finalization_version_v2_check
      CHECK (zatca_finalization_version IS NULL OR zatca_finalization_version = 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_artifact_provenance_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_artifact_provenance_v2_check
      CHECK (zatca_artifact_provenance IS NULL OR zatca_artifact_provenance = 'server_v2');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_document_kind_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_document_kind_v2_check
      CHECK (zatca_document_kind IS NULL OR zatca_document_kind IN ('simplified', 'standard'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_lifecycle_state_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_lifecycle_state_v2_check
      CHECK (zatca_lifecycle_state IS NULL OR zatca_lifecycle_state IN (
        'not_started', 'claiming', 'locally_finalized', 'reporting_pending', 'reported',
        'provisional_signed', 'clearance_pending', 'cleared_final',
        'finalization_failed', 'reporting_failed', 'clearance_failed', 'retrying',
        'reconciliation_required'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_artifact_stage_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_artifact_stage_v2_check
      CHECK (zatca_artifact_stage IS NULL OR zatca_artifact_stage IN (
        'none', 'simplified_final', 'standard_provisional', 'standard_cleared'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_artifact_shape_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_artifact_shape_v2_check CHECK (
      zatca_finalization_version IS NULL
      OR (
        zatca_artifact_provenance = 'server_v2'
        AND zatca_document_kind IN ('simplified', 'standard')
        AND zatca_lifecycle_state IS NOT NULL
        AND zatca_artifact_stage IS NOT NULL
        AND (
          zatca_artifact_stage = 'none'
          OR (zatca_artifact_stage = 'simplified_final'
            AND zatca_document_kind = 'simplified'
            AND NULLIF(zatca_simplified_xml, '') IS NOT NULL
            AND NULLIF(zatca_simplified_xml_hash, '') IS NOT NULL
            AND NULLIF(zatca_simplified_signature, '') IS NOT NULL
            AND NULLIF(zatca_simplified_qr, '') IS NOT NULL)
          OR (zatca_artifact_stage = 'standard_provisional'
            AND zatca_document_kind = 'standard'
            AND NULLIF(zatca_provisional_xml, '') IS NOT NULL
            AND NULLIF(zatca_provisional_xml_hash, '') IS NOT NULL
            AND NULLIF(zatca_provisional_signature, '') IS NOT NULL)
          OR (zatca_artifact_stage = 'standard_cleared'
            AND zatca_document_kind = 'standard'
            AND NULLIF(zatca_provisional_xml, '') IS NOT NULL
            AND NULLIF(zatca_provisional_xml_hash, '') IS NOT NULL
            AND NULLIF(zatca_cleared_xml, '') IS NOT NULL
            AND NULLIF(zatca_cleared_xml_hash, '') IS NOT NULL
            AND NULLIF(zatca_cleared_signature, '') IS NOT NULL
            AND NULLIF(zatca_cleared_qr, '') IS NOT NULL)
        )
      )
    ) NOT VALID;
  END IF;
END
$constraints$;

COMMENT ON COLUMN public.invoices.zatca_finalization_version IS
  'NULL means legacy/unclassified. Value 2 is set only for new feature-gated invoices; never backfilled.';
COMMENT ON COLUMN public.invoices.zatca_artifact_provenance IS
  'NULL means legacy_unverified. server_v2 means the v2 server state machine created the artifact.';
COMMENT ON COLUMN public.invoices.zatca_simplified_qr IS
  'Authoritative immutable customer QR only for artifact_stage=simplified_final.';
COMMENT ON COLUMN public.invoices.zatca_provisional_xml IS
  'Immutable standard clearance request. It is never a customer-output artifact.';
COMMENT ON COLUMN public.invoices.zatca_cleared_xml IS
  'Authoritative standard customer XML returned by and validated from ZATCA clearance.';

-- Deliberately no UPDATE statement exists in this migration. Existing rows retain
-- NULL version/provenance/lifecycle and therefore remain legacy_unverified.
CREATE OR REPLACE FUNCTION public.initialize_zatca_finalization_v2_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_enabled boolean := false;
  v_original_kind text;
BEGIN
  SELECT immutable_finalization_enabled
  INTO v_enabled
  FROM public.zatca_finalization_runtime
  WHERE singleton = true;

  IF COALESCE(v_enabled, false) THEN
    NEW.zatca_finalization_version := 2;
    NEW.zatca_artifact_provenance := 'server_v2';
    NEW.zatca_lifecycle_state := 'not_started';
    NEW.zatca_artifact_stage := 'none';
    v_original_kind := CASE
      WHEN NEW.zatca_invoice_type = 'simplified' THEN 'simplified'
      WHEN NEW.zatca_invoice_type = 'standard' THEN 'standard'
      ELSE NULL
    END;
    IF v_original_kind IS NULL AND NEW.original_invoice_id IS NOT NULL THEN
      SELECT CASE
        WHEN zatca_invoice_type = 'simplified' THEN 'simplified'
        WHEN zatca_invoice_type = 'standard' THEN 'standard'
        ELSE NULL
      END INTO v_original_kind
      FROM public.invoices
      WHERE id = NEW.original_invoice_id AND tenant_id = NEW.tenant_id;
    END IF;
    IF v_original_kind IS NULL THEN RAISE EXCEPTION 'UNRESOLVED_DOCUMENT_KIND'; END IF;
    NEW.zatca_document_kind := v_original_kind;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.initialize_zatca_finalization_v2_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zatca_v2_20_initialize_invoice ON public.invoices;
CREATE TRIGGER zatca_v2_20_initialize_invoice
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.initialize_zatca_finalization_v2_invoice();

COMMIT;
-- END RESTORED SOURCE: 01_artifact_lifecycle.sql

-- BEGIN RESTORED SOURCE: 02_chain_allocator.sql
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
-- END RESTORED SOURCE: 02_chain_allocator.sql

-- BEGIN RESTORED SOURCE: 03_claims_and_idempotency.sql
-- ZATCA Phase 2 immutable finalization v2
-- 03_claims_and_idempotency.sql
-- Leased local claims, leased single-writer network claims, token-checked writes.

BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS zatca_finalization_claim_token_v2 uuid,
  ADD COLUMN IF NOT EXISTS zatca_finalization_claimed_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_finalization_lease_expires_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_finalization_claimed_by_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_finalization_attempt_v2 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zatca_network_claim_token_v2 uuid,
  ADD COLUMN IF NOT EXISTS zatca_network_claimed_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_network_lease_expires_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_network_claimed_by_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_network_operation_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_network_attempt_v2 integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zatca_network_idempotency_key_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_network_request_hash_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_network_request_started_at_v2 timestamptz,
  ADD COLUMN IF NOT EXISTS zatca_network_ack_state_v2 text,
  ADD COLUMN IF NOT EXISTS zatca_reconciliation_reason_v2 text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_network_operation_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_network_operation_v2_check
      CHECK (zatca_network_operation_v2 IS NULL OR zatca_network_operation_v2 IN ('report', 'clear'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_zatca_network_ack_state_v2_check'
  ) THEN
    ALTER TABLE public.invoices ADD CONSTRAINT invoices_zatca_network_ack_state_v2_check
      CHECK (zatca_network_ack_state_v2 IS NULL OR zatca_network_ack_state_v2 IN (
        'idle', 'claimed', 'request_started', 'response_persisted', 'reconciliation_required'
      ));
  END IF;
END
$constraints$;

CREATE OR REPLACE FUNCTION public.zatca_v2_document_kind(p_invoice public.invoices)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_original_type text;
BEGIN
  IF p_invoice.zatca_invoice_type IN ('simplified', 'standard') THEN
    RETURN p_invoice.zatca_invoice_type;
  END IF;
  IF p_invoice.original_invoice_id IS NOT NULL THEN
    SELECT zatca_invoice_type INTO v_original_type
    FROM public.invoices
    WHERE id = p_invoice.original_invoice_id
      AND tenant_id = p_invoice.tenant_id;
  END IF;
  IF v_original_type IN ('simplified', 'standard') THEN RETURN v_original_type; END IF;
  RAISE EXCEPTION 'UNRESOLVED_DOCUMENT_KIND';
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_zatca_finalization_v2(
  p_invoice_id uuid,
  p_claimed_by text,
  p_lease_seconds integer DEFAULT 90
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_kind text;
  v_token uuid;
  v_now timestamptz := clock_timestamp();
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  SELECT * INTO v_runtime FROM public.zatca_finalization_runtime WHERE singleton = true;
  IF NOT COALESCE(v_runtime.immutable_finalization_enabled, false) THEN
    RAISE EXCEPTION 'IMMUTABLE_FINALIZATION_DISABLED';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2' THEN
    RAISE EXCEPTION 'LEGACY_UNVERIFIED_INVOICE';
  END IF;
  v_kind := public.zatca_v2_document_kind(v_invoice);
  IF v_kind = 'simplified' AND NOT v_runtime.simplified_enabled THEN
    RAISE EXCEPTION 'SIMPLIFIED_FINALIZATION_DISABLED';
  END IF;
  IF v_kind = 'standard' AND NOT v_runtime.standard_enabled THEN
    RAISE EXCEPTION 'STANDARD_FINALIZATION_DISABLED';
  END IF;

  IF (v_kind = 'simplified' AND v_invoice.zatca_artifact_stage = 'simplified_final')
     OR (v_kind = 'standard' AND v_invoice.zatca_artifact_stage IN ('standard_provisional', 'standard_cleared')) THEN
    RETURN jsonb_build_object(
      'status', 'already_finalized', 'documentKind', v_kind,
      'lifecycleState', v_invoice.zatca_lifecycle_state,
      'artifactStage', v_invoice.zatca_artifact_stage
    );
  END IF;

  IF v_invoice.zatca_finalization_claim_token_v2 IS NOT NULL
     AND v_invoice.zatca_finalization_lease_expires_at_v2 > v_now THEN
    RETURN jsonb_build_object(
      'status', 'in_progress', 'documentKind', v_kind,
      'leaseExpiresAt', v_invoice.zatca_finalization_lease_expires_at_v2
    );
  END IF;

  v_token := gen_random_uuid();
  UPDATE public.invoices SET
    zatca_document_kind = v_kind,
    zatca_lifecycle_state = CASE WHEN zatca_lifecycle_state = 'not_started' THEN 'claiming' ELSE 'retrying' END,
    zatca_finalization_claim_token_v2 = v_token,
    zatca_finalization_claimed_at_v2 = v_now,
    zatca_finalization_lease_expires_at_v2 = v_now + make_interval(secs => p_lease_seconds),
    zatca_finalization_claimed_by_v2 = left(COALESCE(NULLIF(p_claimed_by, ''), 'unknown'), 120),
    zatca_finalization_attempt_v2 = zatca_finalization_attempt_v2 + 1,
    zatca_finalization_error_v2 = NULL
  WHERE id = p_invoice_id;

  -- An expired claim transfers only its still-open reservation. A committed
  -- reservation is immutable and retries simply reuse it.
  UPDATE public.zatca_chain_reservations_v2 SET claim_token = v_token
  WHERE invoice_id = p_invoice_id AND state = 'allocated';

  RETURN jsonb_build_object(
    'status', 'claimed', 'claimToken', v_token, 'documentKind', v_kind,
    'leaseExpiresAt', v_now + make_interval(secs => p_lease_seconds)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.persist_zatca_simplified_final_v2(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_signed_xml text,
  p_xml_hash text,
  p_signature text,
  p_qr text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NULLIF(p_signed_xml, '') IS NULL OR NULLIF(p_xml_hash, '') IS NULL
     OR NULLIF(p_signature, '') IS NULL OR NULLIF(p_qr, '') IS NULL THEN
    RAISE EXCEPTION 'INCOMPLETE_SIMPLIFIED_ARTIFACT';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token
     OR v_invoice.zatca_finalization_lease_expires_at_v2 <= clock_timestamp() THEN
    RAISE EXCEPTION 'STALE_FINALIZATION_CLAIM_TOKEN';
  END IF;
  IF v_invoice.zatca_document_kind IS DISTINCT FROM 'simplified'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'ILLEGAL_SIMPLIFIED_TRANSITION';
  END IF;

  PERFORM public.commit_zatca_chain_v2(p_invoice_id, p_claim_token, p_xml_hash);
  UPDATE public.invoices SET
    zatca_simplified_xml = p_signed_xml,
    zatca_simplified_xml_hash = p_xml_hash,
    zatca_simplified_signature = p_signature,
    zatca_simplified_qr = p_qr,
    zatca_artifact_stage = 'simplified_final',
    zatca_lifecycle_state = 'locally_finalized',
    zatca_finalized_at_v2 = clock_timestamp(),
    zatca_finalization_claim_token_v2 = NULL,
    zatca_finalization_lease_expires_at_v2 = NULL,
    zatca_finalization_error_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object('status', 'locally_finalized', 'artifactStage', 'simplified_final');
END
$function$;

CREATE OR REPLACE FUNCTION public.persist_zatca_standard_provisional_v2(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_signed_xml text,
  p_xml_hash text,
  p_signature text,
  p_qr text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NULLIF(p_signed_xml, '') IS NULL OR NULLIF(p_xml_hash, '') IS NULL
     OR NULLIF(p_signature, '') IS NULL THEN RAISE EXCEPTION 'INCOMPLETE_STANDARD_PROVISIONAL_ARTIFACT'; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token
     OR v_invoice.zatca_finalization_lease_expires_at_v2 <= clock_timestamp() THEN
    RAISE EXCEPTION 'STALE_FINALIZATION_CLAIM_TOKEN';
  END IF;
  IF v_invoice.zatca_document_kind IS DISTINCT FROM 'standard'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'ILLEGAL_STANDARD_PROVISIONAL_TRANSITION';
  END IF;

  PERFORM public.commit_zatca_chain_v2(p_invoice_id, p_claim_token, p_xml_hash);
  UPDATE public.invoices SET
    zatca_provisional_xml = p_signed_xml,
    zatca_provisional_xml_hash = p_xml_hash,
    zatca_provisional_signature = p_signature,
    zatca_provisional_qr = NULLIF(p_qr, ''),
    zatca_artifact_stage = 'standard_provisional',
    zatca_lifecycle_state = 'provisional_signed',
    zatca_finalization_claim_token_v2 = NULL,
    zatca_finalization_lease_expires_at_v2 = NULL,
    zatca_finalization_error_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object('status', 'provisional_signed', 'artifactStage', 'standard_provisional');
END
$function$;

CREATE OR REPLACE FUNCTION public.fail_zatca_finalization_v2(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_safe_error jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.invoices SET
    zatca_lifecycle_state = 'finalization_failed',
    zatca_finalization_error_v2 = COALESCE(p_safe_error, '{"code":"FINALIZATION_FAILED"}'::jsonb),
    zatca_finalization_claim_token_v2 = NULL,
    zatca_finalization_lease_expires_at_v2 = NULL
  WHERE id = p_invoice_id AND zatca_finalization_claim_token_v2 = p_claim_token;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_FINALIZATION_CLAIM_TOKEN'; END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_zatca_network_v2(
  p_invoice_id uuid,
  p_claimed_by text,
  p_lease_seconds integer DEFAULT 120
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_token uuid;
  v_operation text;
  v_hash text;
  v_key text;
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN RAISE EXCEPTION 'INVALID_LEASE'; END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  IF v_invoice.zatca_lifecycle_state IN ('reported', 'cleared_final') THEN
    RETURN jsonb_build_object('status', 'already_complete');
  END IF;
  IF v_invoice.zatca_lifecycle_state = 'reconciliation_required'
     OR v_invoice.zatca_network_ack_state_v2 = 'reconciliation_required' THEN
    RETURN jsonb_build_object('status', 'reconciliation_required');
  END IF;

  IF v_invoice.zatca_artifact_stage = 'simplified_final' THEN
    v_operation := 'report'; v_hash := v_invoice.zatca_simplified_xml_hash;
  ELSIF v_invoice.zatca_artifact_stage = 'standard_provisional' THEN
    v_operation := 'clear'; v_hash := v_invoice.zatca_provisional_xml_hash;
  ELSE
    RAISE EXCEPTION 'NO_SUBMITTABLE_ARTIFACT';
  END IF;

  IF v_invoice.zatca_network_claim_token_v2 IS NOT NULL
     AND v_invoice.zatca_network_lease_expires_at_v2 > v_now THEN
    RETURN jsonb_build_object('status', 'in_progress', 'leaseExpiresAt', v_invoice.zatca_network_lease_expires_at_v2);
  END IF;

  -- Once request bytes may have reached ZATCA, an expired lease cannot be
  -- automatically replayed. A controlled reconciliation must establish the
  -- remote outcome first.
  IF v_invoice.zatca_network_request_started_at_v2 IS NOT NULL
     AND v_invoice.zatca_network_ack_state_v2 = 'request_started' THEN
    UPDATE public.invoices SET
      zatca_lifecycle_state = 'reconciliation_required',
      zatca_network_ack_state_v2 = 'reconciliation_required',
      zatca_reconciliation_reason_v2 = 'network lease expired after request start',
      zatca_network_claim_token_v2 = NULL,
      zatca_network_lease_expires_at_v2 = NULL
    WHERE id = p_invoice_id;
    RETURN jsonb_build_object('status', 'reconciliation_required');
  END IF;

  v_token := gen_random_uuid();
  v_key := 'zatca-v2:' || v_invoice.zatca_uuid::text || ':' || v_operation || ':' || v_hash;
  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE WHEN v_operation = 'report' THEN 'reporting_pending' ELSE 'clearance_pending' END,
    zatca_network_claim_token_v2 = v_token,
    zatca_network_claimed_at_v2 = v_now,
    zatca_network_lease_expires_at_v2 = v_now + make_interval(secs => p_lease_seconds),
    zatca_network_claimed_by_v2 = left(COALESCE(NULLIF(p_claimed_by, ''), 'unknown'), 120),
    zatca_network_operation_v2 = v_operation,
    zatca_network_attempt_v2 = zatca_network_attempt_v2 + 1,
    zatca_network_idempotency_key_v2 = v_key,
    zatca_network_request_hash_v2 = v_hash,
    zatca_network_request_started_at_v2 = NULL,
    zatca_network_ack_state_v2 = 'claimed',
    zatca_reconciliation_reason_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object(
    'status', 'claimed', 'networkToken', v_token, 'operation', v_operation,
    'idempotencyKey', v_key, 'artifactHash', v_hash,
    'leaseExpiresAt', v_now + make_interval(secs => p_lease_seconds)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.mark_zatca_network_request_started_v2(
  p_invoice_id uuid,
  p_network_token uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.invoices SET
    zatca_network_request_started_at_v2 = clock_timestamp(),
    zatca_network_ack_state_v2 = 'request_started'
  WHERE id = p_invoice_id
    AND zatca_network_claim_token_v2 = p_network_token
    AND zatca_network_lease_expires_at_v2 > clock_timestamp()
    AND zatca_network_ack_state_v2 = 'claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_NETWORK_CLAIM_TOKEN'; END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.persist_zatca_reporting_result_v2(
  p_invoice_id uuid,
  p_network_token uuid,
  p_reported boolean,
  p_safe_response jsonb,
  p_safe_warnings jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.zatca_network_claim_token_v2 IS DISTINCT FROM p_network_token
     OR v_invoice.zatca_network_operation_v2 IS DISTINCT FROM 'report' THEN
    RAISE EXCEPTION 'STALE_NETWORK_CLAIM_TOKEN';
  END IF;
  IF v_invoice.zatca_artifact_stage IS DISTINCT FROM 'simplified_final' THEN
    RAISE EXCEPTION 'SIMPLIFIED_FINAL_ARTIFACT_MISSING';
  END IF;
  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE WHEN p_reported THEN 'reported' ELSE 'reporting_failed' END,
    zatca_status = (
      CASE WHEN p_reported THEN 'reported' ELSE 'failed' END
    )::public.zatca_status,
    zatca_submitted_at = clock_timestamp(),
    zatca_network_response_v2 = COALESCE(p_safe_response, '{}'::jsonb),
    zatca_reporting_response = COALESCE(p_safe_response, '{}'::jsonb),
    zatca_warnings = COALESCE(p_safe_warnings, zatca_warnings),
    zatca_network_ack_state_v2 = 'response_persisted',
    zatca_network_claim_token_v2 = NULL,
    zatca_network_lease_expires_at_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object('status', CASE WHEN p_reported THEN 'reported' ELSE 'reporting_failed' END);
END
$function$;

CREATE OR REPLACE FUNCTION public.adopt_zatca_cleared_artifact_v2(
  p_invoice_id uuid,
  p_network_token uuid,
  p_cleared_xml text,
  p_cleared_xml_hash text,
  p_cleared_signature text,
  p_cleared_qr text,
  p_clearance_metadata jsonb,
  p_safe_response jsonb,
  p_safe_warnings jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE;
BEGIN
  IF NULLIF(p_cleared_xml, '') IS NULL OR NULLIF(p_cleared_xml_hash, '') IS NULL
     OR NULLIF(p_cleared_signature, '') IS NULL OR NULLIF(p_cleared_qr, '') IS NULL THEN
    RAISE EXCEPTION 'INCOMPLETE_CLEARED_ARTIFACT';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.zatca_network_claim_token_v2 IS DISTINCT FROM p_network_token
     OR v_invoice.zatca_network_operation_v2 IS DISTINCT FROM 'clear' THEN
    RAISE EXCEPTION 'STALE_NETWORK_CLAIM_TOKEN';
  END IF;
  IF v_invoice.zatca_artifact_stage IS DISTINCT FROM 'standard_provisional'
     OR NULLIF(v_invoice.zatca_provisional_xml, '') IS NULL THEN
    RAISE EXCEPTION 'STANDARD_PROVISIONAL_ARTIFACT_MISSING';
  END IF;

  UPDATE public.invoices SET
    zatca_cleared_xml = p_cleared_xml,
    zatca_cleared_xml_hash = p_cleared_xml_hash,
    zatca_cleared_signature = p_cleared_signature,
    zatca_cleared_qr = p_cleared_qr,
    zatca_clearance_metadata_v2 = COALESCE(p_clearance_metadata, '{}'::jsonb),
    zatca_network_response_v2 = COALESCE(p_safe_response, '{}'::jsonb),
    zatca_clearance_response = COALESCE(p_safe_response, '{}'::jsonb),
    zatca_warnings = COALESCE(p_safe_warnings, zatca_warnings),
    zatca_artifact_stage = 'standard_cleared',
    zatca_lifecycle_state = 'cleared_final',
    zatca_status = 'cleared',
    zatca_clearance_status = 'CLEARED',
    zatca_submitted_at = clock_timestamp(),
    zatca_finalized_at_v2 = clock_timestamp(),
    zatca_network_ack_state_v2 = 'response_persisted',
    zatca_network_claim_token_v2 = NULL,
    zatca_network_lease_expires_at_v2 = NULL
  WHERE id = p_invoice_id;
  RETURN jsonb_build_object('status', 'cleared_final', 'artifactStage', 'standard_cleared');
END
$function$;

CREATE OR REPLACE FUNCTION public.fail_zatca_network_v2(
  p_invoice_id uuid,
  p_network_token uuid,
  p_ambiguous boolean,
  p_safe_reason text,
  p_safe_response jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_operation text;
BEGIN
  SELECT zatca_network_operation_v2 INTO v_operation
  FROM public.invoices
  WHERE id = p_invoice_id AND zatca_network_claim_token_v2 = p_network_token
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_NETWORK_CLAIM_TOKEN'; END IF;
  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE
      WHEN p_ambiguous THEN 'reconciliation_required'
      WHEN v_operation = 'report' THEN 'reporting_failed'
      ELSE 'clearance_failed'
    END,
    zatca_status = CASE WHEN p_ambiguous THEN zatca_status ELSE 'failed' END,
    zatca_network_response_v2 = COALESCE(p_safe_response, zatca_network_response_v2),
    zatca_network_ack_state_v2 = CASE WHEN p_ambiguous THEN 'reconciliation_required' ELSE 'response_persisted' END,
    zatca_reconciliation_reason_v2 = CASE WHEN p_ambiguous THEN left(COALESCE(p_safe_reason, 'ambiguous network outcome'), 240) ELSE NULL END,
    zatca_finalization_error_v2 = jsonb_build_object('code', CASE WHEN p_ambiguous THEN 'RECONCILIATION_REQUIRED' ELSE 'ZATCA_REJECTED' END, 'message', left(COALESCE(p_safe_reason, 'submission failed'), 240)),
    zatca_network_claim_token_v2 = NULL,
    zatca_network_lease_expires_at_v2 = NULL
  WHERE id = p_invoice_id;
END
$function$;

DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'zatca_v2_document_kind', 'claim_zatca_finalization_v2',
      'persist_zatca_simplified_final_v2', 'persist_zatca_standard_provisional_v2',
      'fail_zatca_finalization_v2', 'claim_zatca_network_v2',
      'mark_zatca_network_request_started_v2', 'persist_zatca_reporting_result_v2',
      'adopt_zatca_cleared_artifact_v2', 'fail_zatca_network_v2'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.signature);
  END LOOP;
END
$grants$;

COMMIT;
-- END RESTORED SOURCE: 03_claims_and_idempotency.sql

-- BEGIN RESTORED SOURCE: 04_lock_compliance_fields.sql
-- ZATCA Phase 2 immutable finalization v2
-- 04_lock_compliance_fields.sql
-- Browser ownership denial plus lifecycle-aware server immutability.

BEGIN;

-- Hosted preflight must be reviewed before this migration. If either legacy
-- policy still exists, accept only the exact historical QR-backfill contract:
-- permissive UPDATE, authenticated only, branch access, NULL QR, non-cancelled.
-- A reused name or altered predicate is a hard stop rather than a silent drop.
DO $policy_contract$
DECLARE
  v_policy record;
  v_authenticated oid := to_regrole('authenticated')::oid;
  v_using text;
  v_check text;
BEGIN
  IF v_authenticated IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_ROLE_MISSING:authenticated';
  END IF;

  FOR v_policy IN
    SELECT p.*
    FROM pg_policy p
    WHERE p.polrelid = 'public.invoices'::regclass
      AND p.polname IN (
        'phase3a_invoices_qr_backfill_update',
        'invoices_qr_backfill_update'
      )
  LOOP
    v_using := replace(replace(
      regexp_replace(lower(pg_get_expr(v_policy.polqual, v_policy.polrelid)),
        '[[:space:]"()]', '', 'g'),
      'public.', ''), '::text', '');
    v_check := replace(replace(
      regexp_replace(lower(pg_get_expr(v_policy.polwithcheck, v_policy.polrelid)),
        '[[:space:]"()]', '', 'g'),
      'public.', ''), '::text', '');

    IF v_policy.polpermissive IS DISTINCT FROM true
       OR v_policy.polcmd IS DISTINCT FROM 'w'
       OR v_policy.polroles IS DISTINCT FROM ARRAY[v_authenticated]::oid[]
       OR v_using IS DISTINCT FROM 'rls_can_access_branch(tenant_id,branch_id)andzatca_qr_codeisnullandstatus<>''cancelled'''
       OR v_check IS DISTINCT FROM 'rls_can_access_branch(tenant_id,branch_id)andstatus<>''cancelled''' THEN
      RAISE EXCEPTION 'POLICY_DEFINITION_DRIFT:%', v_policy.polname
        USING DETAIL = format(
          'permissive=%s command=%s roles=%s using=%s with_check=%s',
          v_policy.polpermissive, v_policy.polcmd, v_policy.polroles,
          pg_get_expr(v_policy.polqual, v_policy.polrelid),
          pg_get_expr(v_policy.polwithcheck, v_policy.polrelid)
        ),
        HINT = 'Stop. Compare 00_hosted_preflight.sql with the reviewed legacy policy contract.';
    END IF;
  END LOOP;
END
$policy_contract$;

DROP POLICY IF EXISTS phase3a_invoices_qr_backfill_update ON public.invoices;
DROP POLICY IF EXISTS invoices_qr_backfill_update ON public.invoices;

-- Expected pre-04 grants are either the current locked-down state (no browser
-- UPDATE) or the historical authenticated UPDATE(zatca_qr_code) grant only.
-- anon has no invoice UPDATE grant; service_role retains its existing trusted
-- table access. Reject broader hosted grants before revoking the named columns.
DO $privilege_contract$
DECLARE
  v_protected_columns constant text[] := ARRAY[
    'zatca_qr_code', 'zatca_xml', 'zatca_xml_hash', 'zatca_signature',
    'zatca_uuid', 'zatca_counter_number', 'zatca_prev_invoice_hash',
    'zatca_finalization_version', 'zatca_artifact_provenance',
    'zatca_document_kind', 'zatca_lifecycle_state', 'zatca_artifact_stage',
    'zatca_finalized_at_v2', 'zatca_finalization_error_v2',
    'zatca_simplified_xml', 'zatca_simplified_xml_hash',
    'zatca_simplified_signature', 'zatca_simplified_qr',
    'zatca_provisional_xml', 'zatca_provisional_xml_hash',
    'zatca_provisional_signature', 'zatca_provisional_qr',
    'zatca_cleared_xml', 'zatca_cleared_xml_hash',
    'zatca_cleared_signature', 'zatca_cleared_qr',
    'zatca_clearance_metadata_v2', 'zatca_network_response_v2',
    'zatca_finalization_claim_token_v2', 'zatca_finalization_claimed_at_v2',
    'zatca_finalization_lease_expires_at_v2', 'zatca_finalization_claimed_by_v2',
    'zatca_finalization_attempt_v2', 'zatca_network_claim_token_v2',
    'zatca_network_claimed_at_v2', 'zatca_network_lease_expires_at_v2',
    'zatca_network_claimed_by_v2', 'zatca_network_operation_v2',
    'zatca_network_attempt_v2', 'zatca_network_idempotency_key_v2',
    'zatca_network_request_hash_v2', 'zatca_network_request_started_at_v2',
    'zatca_network_ack_state_v2', 'zatca_reconciliation_reason_v2'
  ];
  v_browser_grants text[];
BEGIN
  IF has_table_privilege('anon', 'public.invoices', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.invoices', 'UPDATE') THEN
    RAISE EXCEPTION 'UNEXPECTED_BROWSER_INVOICE_TABLE_UPDATE_GRANT'
      USING HINT = 'Stop. Review 00_hosted_preflight.sql; 04 revokes only named compliance columns.';
  END IF;

  SELECT COALESCE(array_agg(grantee || '.' || column_name ORDER BY grantee, column_name), ARRAY[]::text[])
  INTO v_browser_grants
  FROM information_schema.role_column_grants
  WHERE table_schema = 'public'
    AND table_name = 'invoices'
    AND privilege_type = 'UPDATE'
    AND grantee IN ('anon', 'authenticated')
    AND column_name = ANY(v_protected_columns);

  IF v_browser_grants <> ARRAY[]::text[]
     AND v_browser_grants <> ARRAY['authenticated.zatca_qr_code']::text[] THEN
    RAISE EXCEPTION 'UNEXPECTED_BROWSER_COMPLIANCE_UPDATE_GRANTS:%', v_browser_grants
      USING HINT = 'Stop. Review and resolve hosted privilege drift explicitly.';
  END IF;
END
$privilege_contract$;

REVOKE UPDATE (
  zatca_qr_code, zatca_xml, zatca_xml_hash, zatca_signature,
  zatca_uuid, zatca_counter_number, zatca_prev_invoice_hash,
  zatca_finalization_version, zatca_artifact_provenance,
  zatca_document_kind, zatca_lifecycle_state, zatca_artifact_stage,
  zatca_finalized_at_v2, zatca_finalization_error_v2,
  zatca_simplified_xml, zatca_simplified_xml_hash,
  zatca_simplified_signature, zatca_simplified_qr,
  zatca_provisional_xml, zatca_provisional_xml_hash,
  zatca_provisional_signature, zatca_provisional_qr,
  zatca_cleared_xml, zatca_cleared_xml_hash,
  zatca_cleared_signature, zatca_cleared_qr,
  zatca_clearance_metadata_v2, zatca_network_response_v2,
  zatca_finalization_claim_token_v2, zatca_finalization_claimed_at_v2,
  zatca_finalization_lease_expires_at_v2, zatca_finalization_claimed_by_v2,
  zatca_finalization_attempt_v2, zatca_network_claim_token_v2,
  zatca_network_claimed_at_v2, zatca_network_lease_expires_at_v2,
  zatca_network_claimed_by_v2, zatca_network_operation_v2,
  zatca_network_attempt_v2, zatca_network_idempotency_key_v2,
  zatca_network_request_hash_v2, zatca_network_request_started_at_v2,
  zatca_network_ack_state_v2, zatca_reconciliation_reason_v2
) ON TABLE public.invoices FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.assert_zatca_compliance_write_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role text := COALESCE(auth.role(), '');
  v_server boolean := v_role IN ('service_role', 'supabase_admin')
    OR current_user IN ('postgres', 'supabase_admin')
    OR session_user IN ('postgres', 'supabase_admin');
  v_protected_changed boolean;
BEGIN
  v_protected_changed :=
    NEW.zatca_qr_code IS DISTINCT FROM OLD.zatca_qr_code
    OR NEW.zatca_xml IS DISTINCT FROM OLD.zatca_xml
    OR NEW.zatca_xml_hash IS DISTINCT FROM OLD.zatca_xml_hash
    OR NEW.zatca_signature IS DISTINCT FROM OLD.zatca_signature
    OR NEW.zatca_uuid IS DISTINCT FROM OLD.zatca_uuid
    OR NEW.zatca_counter_number IS DISTINCT FROM OLD.zatca_counter_number
    OR NEW.zatca_prev_invoice_hash IS DISTINCT FROM OLD.zatca_prev_invoice_hash
    OR NEW.zatca_finalization_version IS DISTINCT FROM OLD.zatca_finalization_version
    OR NEW.zatca_artifact_provenance IS DISTINCT FROM OLD.zatca_artifact_provenance
    OR NEW.zatca_document_kind IS DISTINCT FROM OLD.zatca_document_kind
    OR NEW.zatca_lifecycle_state IS DISTINCT FROM OLD.zatca_lifecycle_state
    OR NEW.zatca_artifact_stage IS DISTINCT FROM OLD.zatca_artifact_stage
    OR NEW.zatca_finalized_at_v2 IS DISTINCT FROM OLD.zatca_finalized_at_v2
    OR NEW.zatca_simplified_xml IS DISTINCT FROM OLD.zatca_simplified_xml
    OR NEW.zatca_simplified_xml_hash IS DISTINCT FROM OLD.zatca_simplified_xml_hash
    OR NEW.zatca_simplified_signature IS DISTINCT FROM OLD.zatca_simplified_signature
    OR NEW.zatca_simplified_qr IS DISTINCT FROM OLD.zatca_simplified_qr
    OR NEW.zatca_provisional_xml IS DISTINCT FROM OLD.zatca_provisional_xml
    OR NEW.zatca_provisional_xml_hash IS DISTINCT FROM OLD.zatca_provisional_xml_hash
    OR NEW.zatca_provisional_signature IS DISTINCT FROM OLD.zatca_provisional_signature
    OR NEW.zatca_provisional_qr IS DISTINCT FROM OLD.zatca_provisional_qr
    OR NEW.zatca_cleared_xml IS DISTINCT FROM OLD.zatca_cleared_xml
    OR NEW.zatca_cleared_xml_hash IS DISTINCT FROM OLD.zatca_cleared_xml_hash
    OR NEW.zatca_cleared_signature IS DISTINCT FROM OLD.zatca_cleared_signature
    OR NEW.zatca_cleared_qr IS DISTINCT FROM OLD.zatca_cleared_qr
    OR NEW.zatca_clearance_metadata_v2 IS DISTINCT FROM OLD.zatca_clearance_metadata_v2
    OR NEW.zatca_finalization_claim_token_v2 IS DISTINCT FROM OLD.zatca_finalization_claim_token_v2
    OR NEW.zatca_finalization_claimed_at_v2 IS DISTINCT FROM OLD.zatca_finalization_claimed_at_v2
    OR NEW.zatca_finalization_lease_expires_at_v2 IS DISTINCT FROM OLD.zatca_finalization_lease_expires_at_v2
    OR NEW.zatca_finalization_claimed_by_v2 IS DISTINCT FROM OLD.zatca_finalization_claimed_by_v2
    OR NEW.zatca_finalization_attempt_v2 IS DISTINCT FROM OLD.zatca_finalization_attempt_v2
    OR NEW.zatca_network_claim_token_v2 IS DISTINCT FROM OLD.zatca_network_claim_token_v2
    OR NEW.zatca_network_claimed_at_v2 IS DISTINCT FROM OLD.zatca_network_claimed_at_v2
    OR NEW.zatca_network_lease_expires_at_v2 IS DISTINCT FROM OLD.zatca_network_lease_expires_at_v2
    OR NEW.zatca_network_claimed_by_v2 IS DISTINCT FROM OLD.zatca_network_claimed_by_v2
    OR NEW.zatca_network_operation_v2 IS DISTINCT FROM OLD.zatca_network_operation_v2
    OR NEW.zatca_network_attempt_v2 IS DISTINCT FROM OLD.zatca_network_attempt_v2
    OR NEW.zatca_network_idempotency_key_v2 IS DISTINCT FROM OLD.zatca_network_idempotency_key_v2
    OR NEW.zatca_network_request_hash_v2 IS DISTINCT FROM OLD.zatca_network_request_hash_v2
    OR NEW.zatca_network_request_started_at_v2 IS DISTINCT FROM OLD.zatca_network_request_started_at_v2
    OR NEW.zatca_network_ack_state_v2 IS DISTINCT FROM OLD.zatca_network_ack_state_v2
    OR NEW.zatca_reconciliation_reason_v2 IS DISTINCT FROM OLD.zatca_reconciliation_reason_v2;

  IF NOT v_server AND v_protected_changed THEN
    RAISE EXCEPTION 'ZATCA compliance fields are server-owned' USING ERRCODE = '42501';
  END IF;

  IF v_server AND OLD.zatca_finalization_version = 2 THEN
    -- The v2 path never writes the ambiguous legacy artifact columns. They are
    -- retained only so disabled old-code deployments remain additive.
    IF NEW.zatca_qr_code IS DISTINCT FROM OLD.zatca_qr_code
       OR NEW.zatca_xml IS DISTINCT FROM OLD.zatca_xml
       OR NEW.zatca_xml_hash IS DISTINCT FROM OLD.zatca_xml_hash
       OR NEW.zatca_signature IS DISTINCT FROM OLD.zatca_signature THEN
      RAISE EXCEPTION 'V2 invoices cannot use legacy artifact columns' USING ERRCODE = '55000';
    END IF;

    IF NEW.zatca_finalization_version IS DISTINCT FROM OLD.zatca_finalization_version
       OR NEW.zatca_artifact_provenance IS DISTINCT FROM OLD.zatca_artifact_provenance
       OR NEW.zatca_document_kind IS DISTINCT FROM OLD.zatca_document_kind
       OR NEW.zatca_uuid IS DISTINCT FROM OLD.zatca_uuid THEN
      RAISE EXCEPTION 'V2 invoice identity/provenance is immutable' USING ERRCODE = '55000';
    END IF;

    IF (OLD.zatca_artifact_stage, NEW.zatca_artifact_stage) NOT IN (
      ('none', 'none'), ('none', 'simplified_final'), ('none', 'standard_provisional'),
      ('simplified_final', 'simplified_final'),
      ('standard_provisional', 'standard_provisional'),
      ('standard_provisional', 'standard_cleared'),
      ('standard_cleared', 'standard_cleared')
    ) THEN
      RAISE EXCEPTION 'Illegal ZATCA artifact-stage transition' USING ERRCODE = '55000';
    END IF;

    IF OLD.zatca_artifact_stage = 'simplified_final' AND (
      NEW.zatca_simplified_xml IS DISTINCT FROM OLD.zatca_simplified_xml
      OR NEW.zatca_simplified_xml_hash IS DISTINCT FROM OLD.zatca_simplified_xml_hash
      OR NEW.zatca_simplified_signature IS DISTINCT FROM OLD.zatca_simplified_signature
      OR NEW.zatca_simplified_qr IS DISTINCT FROM OLD.zatca_simplified_qr
      OR NEW.zatca_counter_number IS DISTINCT FROM OLD.zatca_counter_number
      OR NEW.zatca_prev_invoice_hash IS DISTINCT FROM OLD.zatca_prev_invoice_hash
    ) THEN
      RAISE EXCEPTION 'Simplified final artifact is immutable' USING ERRCODE = '55000';
    END IF;

    IF OLD.zatca_artifact_stage IN ('standard_provisional', 'standard_cleared') AND (
      NEW.zatca_provisional_xml IS DISTINCT FROM OLD.zatca_provisional_xml
      OR NEW.zatca_provisional_xml_hash IS DISTINCT FROM OLD.zatca_provisional_xml_hash
      OR NEW.zatca_provisional_signature IS DISTINCT FROM OLD.zatca_provisional_signature
      OR NEW.zatca_provisional_qr IS DISTINCT FROM OLD.zatca_provisional_qr
      OR NEW.zatca_counter_number IS DISTINCT FROM OLD.zatca_counter_number
      OR NEW.zatca_prev_invoice_hash IS DISTINCT FROM OLD.zatca_prev_invoice_hash
    ) THEN
      RAISE EXCEPTION 'Standard provisional request artifact is immutable' USING ERRCODE = '55000';
    END IF;

    IF OLD.zatca_artifact_stage = 'standard_cleared' AND (
      NEW.zatca_cleared_xml IS DISTINCT FROM OLD.zatca_cleared_xml
      OR NEW.zatca_cleared_xml_hash IS DISTINCT FROM OLD.zatca_cleared_xml_hash
      OR NEW.zatca_cleared_signature IS DISTINCT FROM OLD.zatca_cleared_signature
      OR NEW.zatca_cleared_qr IS DISTINCT FROM OLD.zatca_cleared_qr
      OR NEW.zatca_clearance_metadata_v2 IS DISTINCT FROM OLD.zatca_clearance_metadata_v2
    ) THEN
      RAISE EXCEPTION 'Standard cleared artifact is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_zatca_compliance_write_v2() FROM PUBLIC, anon, authenticated;

-- Replace the unsafe v1 guard if it was installed in a non-production review DB.
DROP TRIGGER IF EXISTS invoices_zatca_compliance_write_guard ON public.invoices;
DROP TRIGGER IF EXISTS invoices_zatca_compliance_write_guard_v2 ON public.invoices;
CREATE TRIGGER invoices_zatca_compliance_write_guard_v2
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.assert_zatca_compliance_write_v2();

COMMIT;
-- END RESTORED SOURCE: 04_lock_compliance_fields.sql

-- BEGIN RESTORED SOURCE: 04a_safe_invoice_read_surface.sql
-- ZATCA Phase 2 immutable finalization v2
-- 04a_safe_invoice_read_surface.sql
-- Replace browser table-wide invoice SELECT with an explicit safe allowlist.
-- RLS policies and invoice rows are intentionally unchanged.

BEGIN;

DO $invoice_read_contract$
DECLARE
  v_safe_columns constant text[] := ARRAY[
    'id', 'tenant_id', 'branch_id', 'customer_id', 'created_by',
    'invoice_number', 'invoice_reference', 'zatca_invoice_type',
    'zatca_status', 'zatca_submitted_at', 'subtotal', 'discount_amount',
    'taxable_amount', 'tax_amount', 'total_amount', 'currency_code',
    'invoice_date', 'supply_date', 'due_date', 'status', 'payment_status',
    'notes', 'notes_ar', 'cancelled_at', 'cancellation_reason',
    'created_at', 'updated_at', 'session_id', 'payment_method',
    'original_invoice_id', 'credit_reason', 'document_language'
  ];
  v_server_only_columns constant text[] := ARRAY[
    'zatca_uuid', 'zatca_type_code', 'zatca_counter_number',
    'zatca_prev_invoice_hash', 'zatca_xml', 'zatca_xml_hash',
    'zatca_signature', 'zatca_qr_code', 'zatca_submission_id',
    'zatca_clearance_status', 'zatca_clearance_response',
    'zatca_reporting_response', 'zatca_warnings',
    'checkout_idempotency_key', 'credit_note_idempotency_key',
    'zatca_finalization_version', 'zatca_artifact_provenance',
    'zatca_document_kind', 'zatca_lifecycle_state', 'zatca_artifact_stage',
    'zatca_finalized_at_v2', 'zatca_finalization_error_v2',
    'zatca_simplified_xml', 'zatca_simplified_xml_hash',
    'zatca_simplified_signature', 'zatca_simplified_qr',
    'zatca_provisional_xml', 'zatca_provisional_xml_hash',
    'zatca_provisional_signature', 'zatca_provisional_qr',
    'zatca_cleared_xml', 'zatca_cleared_xml_hash',
    'zatca_cleared_signature', 'zatca_cleared_qr',
    'zatca_clearance_metadata_v2', 'zatca_network_response_v2',
    'zatca_finalization_claim_token_v2', 'zatca_finalization_claimed_at_v2',
    'zatca_finalization_lease_expires_at_v2', 'zatca_finalization_claimed_by_v2',
    'zatca_finalization_attempt_v2', 'zatca_network_claim_token_v2',
    'zatca_network_claimed_at_v2', 'zatca_network_lease_expires_at_v2',
    'zatca_network_claimed_by_v2', 'zatca_network_operation_v2',
    'zatca_network_attempt_v2', 'zatca_network_idempotency_key_v2',
    'zatca_network_request_hash_v2', 'zatca_network_request_started_at_v2',
    'zatca_network_ack_state_v2', 'zatca_reconciliation_reason_v2'
  ];
  v_reviewed_legacy_columns constant text[] := ARRAY[
    'checkout_idempotency_key', 'credit_note_idempotency_key',
    'zatca_clearance_status', 'zatca_counter_number',
    'zatca_prev_invoice_hash', 'zatca_qr_code', 'zatca_submission_id',
    'zatca_type_code', 'zatca_uuid', 'zatca_warnings', 'zatca_xml_hash'
  ];
  v_missing text[];
  v_unsafe_grants text[];
  v_count bigint;
  v_table_select boolean;
  v_column_list text;
BEGIN
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_SUPABASE_ROLE_MISSING'
      USING HINT = 'Stop. This patch requires anon, authenticated, and service_role.';
  END IF;

  IF to_regclass('public.invoices') IS NULL THEN
    RAISE EXCEPTION 'EXPECTED_TABLE_MISSING:public.invoices';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoices'::regclass) THEN
    RAISE EXCEPTION 'INVOICE_RLS_NOT_ENABLED'
      USING HINT = 'Stop. This grant patch assumes the existing invoice RLS policies remain authoritative.';
  END IF;

  SELECT array_agg(required.column_name ORDER BY required.column_name)
  INTO v_missing
  FROM unnest(v_safe_columns || v_server_only_columns) required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    WHERE a.attrelid = 'public.invoices'::regclass
      AND a.attname = required.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped
  );
  IF COALESCE(cardinality(v_missing), 0) <> 0 THEN
    RAISE EXCEPTION 'INVOICE_READ_CONTRACT_COLUMNS_MISSING:%', v_missing
      USING HINT = 'Apply this file only after 01-04 and resolve schema drift explicitly.';
  END IF;

  -- PUBLIC is a pseudo-role (ACL grantee 0), so inspect relation and column
  -- ACLs directly instead of pretending it is a pg_roles row.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
    WHERE c.oid = 'public.invoices'::regclass
      AND acl.grantee = 0
      AND acl.privilege_type = 'SELECT'
  ) OR EXISTS (
    SELECT 1
    FROM pg_attribute a
    CROSS JOIN LATERAL aclexplode(a.attacl) acl
    WHERE a.attrelid = 'public.invoices'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND acl.grantee = 0
      AND acl.privilege_type = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'UNEXPECTED_PUBLIC_INVOICE_SELECT_GRANT'
      USING HINT = 'Stop. Resolve PUBLIC privilege drift before applying the reviewed browser allowlist.';
  END IF;

  SELECT has_table_privilege('anon', 'public.invoices', 'SELECT') INTO v_table_select;
  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('anon', 'public.invoices', a.attname, 'SELECT');
  IF v_table_select OR v_count <> 0 THEN
    RAISE EXCEPTION 'UNEXPECTED_ANON_INVOICE_SELECT_GRANT:table=%,columns=%', v_table_select, v_count
      USING HINT = 'Stop. The reviewed hosted contract gives anon no invoice read privilege.';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.invoices', 'SELECT') THEN
    RAISE EXCEPTION 'SERVICE_ROLE_INVOICE_TABLE_SELECT_MISSING'
      USING HINT = 'Stop. The service-role compliance path must retain table-wide invoice reads.';
  END IF;

  SELECT has_table_privilege('authenticated', 'public.invoices', 'SELECT') INTO v_table_select;
  IF NOT v_table_select THEN
    SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO v_missing
    FROM unnest(v_safe_columns) required(column_name)
    WHERE NOT has_column_privilege(
      'authenticated', 'public.invoices', required.column_name, 'SELECT'
    );
    IF COALESCE(cardinality(v_missing), 0) <> 0
       AND v_missing IS DISTINCT FROM ARRAY['document_language']::text[] THEN
      RAISE EXCEPTION 'UNEXPECTED_AUTHENTICATED_INVOICE_SELECT_STATE:safe_missing=%', v_missing
        USING HINT = 'Expected table-wide legacy access, the complete 04a allowlist, or the reviewed pre-04a allowlist missing only document_language.';
    END IF;

    SELECT array_agg(a.attname ORDER BY a.attname)
    INTO v_unsafe_grants
    FROM pg_attribute a
    WHERE a.attrelid = 'public.invoices'::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
      AND NOT (a.attname = ANY(v_safe_columns))
      AND has_column_privilege('authenticated', 'public.invoices', a.attname, 'SELECT');
    IF COALESCE(cardinality(v_unsafe_grants), 0) <> 0
       AND v_unsafe_grants IS DISTINCT FROM v_reviewed_legacy_columns THEN
      RAISE EXCEPTION 'UNEXPECTED_AUTHENTICATED_UNSAFE_COLUMN_GRANTS:%', v_unsafe_grants
        USING HINT = 'Expected no unsafe column grants or the exact reviewed legacy set that this migration revokes.';
    END IF;
  END IF;

  -- Removing the table grant is what makes column privileges authoritative.
  -- The named server-only revoke also clears any historical direct grants.
  REVOKE SELECT ON TABLE public.invoices FROM authenticated, anon;

  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinality)
  INTO v_column_list
  FROM unnest(v_server_only_columns) WITH ORDINALITY columns(column_name, ordinality);
  EXECUTE format(
    'REVOKE SELECT (%s) ON TABLE public.invoices FROM authenticated, anon',
    v_column_list
  );

  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinality)
  INTO v_column_list
  FROM unnest(v_safe_columns) WITH ORDINALITY columns(column_name, ordinality);
  EXECUTE format(
    'GRANT SELECT (%s) ON TABLE public.invoices TO authenticated',
    v_column_list
  );

  IF has_table_privilege('authenticated', 'public.invoices', 'SELECT')
     OR has_table_privilege('anon', 'public.invoices', 'SELECT') THEN
    RAISE EXCEPTION 'BROWSER_INVOICE_TABLE_SELECT_REMAINS'
      USING HINT = 'An inherited or PUBLIC table grant remains; the transaction will roll back.';
  END IF;

  SELECT count(*) INTO v_count
  FROM unnest(v_safe_columns) required(column_name)
  WHERE NOT has_column_privilege(
    'authenticated', 'public.invoices', required.column_name, 'SELECT'
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AUTHENTICATED_SAFE_INVOICE_COLUMNS_MISSING:%', v_count;
  END IF;

  -- This intentionally covers all non-safe current and future columns, not
  -- only the known raw-v2 list. Adding a column never expands browser access.
  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND NOT (a.attname = ANY(v_safe_columns))
    AND has_column_privilege('authenticated', 'public.invoices', a.attname, 'SELECT');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AUTHENTICATED_NON_SAFE_INVOICE_COLUMNS_REMAIN:%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND has_column_privilege('anon', 'public.invoices', a.attname, 'SELECT');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'ANON_INVOICE_COLUMNS_REMAIN:%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_attribute a
  WHERE a.attrelid = 'public.invoices'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND NOT has_column_privilege('service_role', 'public.invoices', a.attname, 'SELECT');
  IF NOT has_table_privilege('service_role', 'public.invoices', 'SELECT') OR v_count <> 0 THEN
    RAISE EXCEPTION 'SERVICE_ROLE_INVOICE_READ_CONTRACT_BROKEN:missing_columns=%', v_count;
  END IF;
END
$invoice_read_contract$;

COMMIT;
-- END RESTORED SOURCE: 04a_safe_invoice_read_surface.sql

-- BEGIN RESTORED SOURCE: 05_capabilities_and_status.sql
-- ZATCA Phase 2 immutable finalization v2
-- 05_capabilities_and_status.sql
-- Safe capability handshake and authoritative read-only output gate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.zatca_client_capabilities_v2 (
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  client_version text NOT NULL,
  edge_version text NOT NULL,
  schema_version integer NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, branch_id)
);

ALTER TABLE public.zatca_client_capabilities_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_client_capabilities_v2 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zatca_client_capabilities_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.get_zatca_finalization_capabilities_v2()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'schemaVersion', schema_version,
    'immutableFinalizationEnabled', immutable_finalization_enabled,
    'simplifiedEnabled', simplified_enabled,
    'standardEnabled', standard_enabled,
    'minimumEdgeVersion', minimum_edge_version,
    'minimumClientVersion', minimum_client_version,
    'supportsLocalSimplifiedFinalization', true,
    'supportsStandardClearanceGating', true,
    'supportsLeasedClaims', true,
    'supportsSerializedChainAllocator', true
  )
  FROM public.zatca_finalization_runtime
  WHERE singleton = true
$function$;

CREATE OR REPLACE FUNCTION public.acknowledge_zatca_client_capability_v2(
  p_user_id uuid,
  p_branch_id uuid,
  p_client_version text,
  p_edge_version text,
  p_ttl_seconds integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_user_tenant uuid;
  v_branch_tenant uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_ttl_seconds < 60 OR p_ttl_seconds > 600 THEN RAISE EXCEPTION 'INVALID_CAPABILITY_TTL'; END IF;
  SELECT * INTO v_runtime FROM public.zatca_finalization_runtime WHERE singleton = true;
  SELECT tenant_id INTO v_user_tenant FROM public.user_profiles WHERE id = p_user_id;
  SELECT tenant_id INTO v_branch_tenant FROM public.branches WHERE id = p_branch_id;
  IF v_user_tenant IS NULL OR v_branch_tenant IS NULL OR v_user_tenant <> v_branch_tenant THEN
    RAISE EXCEPTION 'CAPABILITY_SCOPE_MISMATCH';
  END IF;
  IF p_client_version IS DISTINCT FROM v_runtime.minimum_client_version
     OR p_edge_version IS DISTINCT FROM v_runtime.minimum_edge_version THEN
    RAISE EXCEPTION 'CAPABILITY_VERSION_MISMATCH';
  END IF;

  INSERT INTO public.zatca_client_capabilities_v2 (
    user_id, branch_id, client_version, edge_version, schema_version,
    acknowledged_at, expires_at
  ) VALUES (
    p_user_id, p_branch_id, p_client_version, p_edge_version,
    v_runtime.schema_version, v_now, v_now + make_interval(secs => p_ttl_seconds)
  )
  ON CONFLICT (user_id, branch_id) DO UPDATE SET
    client_version = EXCLUDED.client_version,
    edge_version = EXCLUDED.edge_version,
    schema_version = EXCLUDED.schema_version,
    acknowledged_at = EXCLUDED.acknowledged_at,
    expires_at = EXCLUDED.expires_at;

  RETURN jsonb_build_object('acknowledged', true, 'expiresAt', v_now + make_interval(secs => p_ttl_seconds));
END
$function$;

CREATE OR REPLACE FUNCTION public.require_zatca_client_capability_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_kind text;
BEGIN
  SELECT * INTO v_runtime FROM public.zatca_finalization_runtime WHERE singleton = true;
  IF NOT COALESCE(v_runtime.immutable_finalization_enabled, false) THEN RETURN NEW; END IF;

  v_kind := CASE
    WHEN NEW.zatca_invoice_type = 'simplified' THEN 'simplified'
    WHEN NEW.zatca_invoice_type = 'standard' THEN 'standard'
    ELSE NULL
  END;
  IF v_kind IS NULL AND NEW.original_invoice_id IS NOT NULL THEN
    SELECT CASE
      WHEN zatca_invoice_type = 'simplified' THEN 'simplified'
      WHEN zatca_invoice_type = 'standard' THEN 'standard'
      ELSE NULL
    END INTO v_kind
    FROM public.invoices
    WHERE id = NEW.original_invoice_id AND tenant_id = NEW.tenant_id;
  END IF;
  IF v_kind = 'simplified' AND NOT v_runtime.simplified_enabled THEN
    RAISE EXCEPTION 'SIMPLIFIED_FINALIZATION_DISABLED' USING ERRCODE = 'P0001';
  ELSIF v_kind = 'standard' AND NOT v_runtime.standard_enabled THEN
    RAISE EXCEPTION 'STANDARD_FINALIZATION_DISABLED' USING ERRCODE = 'P0001';
  ELSIF v_kind IS NULL THEN
    RAISE EXCEPTION 'UNRESOLVED_DOCUMENT_KIND' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.created_by IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.zatca_client_capabilities_v2 c
    WHERE c.user_id = NEW.created_by
      AND c.branch_id = NEW.branch_id
      AND c.client_version = v_runtime.minimum_client_version
      AND c.edge_version = v_runtime.minimum_edge_version
      AND c.schema_version = v_runtime.schema_version
      AND c.expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'ZATCA_CLIENT_CAPABILITY_REQUIRED'
      USING ERRCODE = 'P0001',
        HINT = 'Refresh the POS so capability negotiation completes before checkout.';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS zatca_v2_10_require_client_capability ON public.invoices;
CREATE TRIGGER zatca_v2_10_require_client_capability
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.require_zatca_client_capability_v2();

CREATE OR REPLACE FUNCTION public.get_zatca_output_state_v2(
  p_invoice_id uuid,
  p_tenant_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE; v_can_output boolean := false; v_qr text;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices
  WHERE id = p_invoice_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2' THEN
    v_can_output := v_invoice.zatca_status IN ('reported', 'cleared')
      AND NULLIF(BTRIM(v_invoice.zatca_qr_code), '') IS NOT NULL;
    RETURN jsonb_build_object(
      'invoiceId', v_invoice.id,
      'invoiceStatus', COALESCE(v_invoice.zatca_status, 'not_submitted'),
      'contractMode', 'legacy', 'legacyCompatible', true,
      'finalizationStatus', 'legacy_' || COALESCE(v_invoice.zatca_status, 'not_submitted'),
      'artifactStage', CASE WHEN v_can_output THEN 'legacy_final' ELSE 'legacy_pending' END,
      'documentKind', CASE
        WHEN v_invoice.zatca_invoice_type IN ('simplified', 'standard')
          THEN v_invoice.zatca_invoice_type
        ELSE NULL
      END,
      'canPrint', v_can_output, 'canShare', v_can_output,
      'retryAvailable', v_invoice.zatca_status IN ('pending', 'failed'),
      'reconciliationRequired', false,
      'qrCode', CASE WHEN v_can_output THEN v_invoice.zatca_qr_code ELSE NULL END,
      'error', NULL
    );
  END IF;

  IF v_invoice.zatca_document_kind = 'simplified'
     AND v_invoice.zatca_artifact_stage = 'simplified_final' THEN
    v_can_output := true; v_qr := v_invoice.zatca_simplified_qr;
  ELSIF v_invoice.zatca_document_kind = 'standard'
     AND v_invoice.zatca_artifact_stage = 'standard_cleared'
     AND v_invoice.zatca_lifecycle_state = 'cleared_final' THEN
    v_can_output := true; v_qr := v_invoice.zatca_cleared_qr;
  END IF;

  RETURN jsonb_build_object(
    'invoiceId', v_invoice.id,
    'invoiceStatus', COALESCE(v_invoice.zatca_status, 'pending'),
    'contractMode', 'v2', 'legacyCompatible', false,
    'finalizationStatus', v_invoice.zatca_lifecycle_state,
    'artifactStage', v_invoice.zatca_artifact_stage,
    'documentKind', v_invoice.zatca_document_kind,
    'canPrint', v_can_output, 'canShare', v_can_output,
    'retryAvailable', (
      v_invoice.zatca_lifecycle_state IN (
        'not_started', 'finalization_failed', 'reporting_failed', 'clearance_failed', 'retrying'
      )
      OR (
        v_invoice.zatca_document_kind = 'simplified'
        AND v_invoice.zatca_artifact_stage = 'simplified_final'
        AND v_invoice.zatca_lifecycle_state IN ('locally_finalized', 'reporting_pending')
      )
    ),
    'reconciliationRequired', v_invoice.zatca_lifecycle_state = 'reconciliation_required',
    'qrCode', CASE WHEN v_can_output THEN v_qr ELSE NULL END,
    'error', CASE
      WHEN v_invoice.zatca_lifecycle_state = 'reconciliation_required'
        THEN COALESCE(v_invoice.zatca_reconciliation_reason_v2, 'Remote outcome requires reconciliation.')
      ELSE v_invoice.zatca_finalization_error_v2 ->> 'message'
    END
  );
END
$function$;

DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'get_zatca_finalization_capabilities_v2',
      'acknowledge_zatca_client_capability_v2',
      'require_zatca_client_capability_v2',
      'get_zatca_output_state_v2'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
  END LOOP;
END
$grants$;

GRANT EXECUTE ON FUNCTION public.get_zatca_finalization_capabilities_v2() TO service_role;
GRANT EXECUTE ON FUNCTION public.acknowledge_zatca_client_capability_v2(uuid, uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_zatca_output_state_v2(uuid, uuid) TO service_role;

COMMIT;
-- END RESTORED SOURCE: 05_capabilities_and_status.sql

-- BEGIN RESTORED SOURCE: 09_branch_readiness_gate.sql
-- ZATCA Phase 2 immutable finalization v2
-- 09_branch_readiness_gate.sql
-- Server-authoritative per-branch readiness and legacy fallback gate.

BEGIN;

DO $flags_must_be_false$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.zatca_finalization_runtime
    WHERE singleton = true
      AND (
        immutable_finalization_enabled
        OR simplified_enabled
        OR standard_enabled
      )
  ) THEN
    RAISE EXCEPTION 'ZATCA_FLAGS_MUST_BE_FALSE_FOR_BRANCH_GATE_MIGRATION';
  END IF;
END
$flags_must_be_false$;

CREATE TABLE IF NOT EXISTS public.zatca_branch_readiness_v2 (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  readiness_status text NOT NULL CHECK (readiness_status IN ('ready', 'blocked')),
  readiness_source text NOT NULL CHECK (
    readiness_source IN ('production_onboarding', 'controlled_reconciliation', 'operator_block')
  ),
  reason text NOT NULL CHECK (NULLIF(btrim(reason), '') IS NOT NULL),
  approved_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, branch_id)
);

ALTER TABLE public.zatca_branch_readiness_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_branch_readiness_v2 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zatca_branch_readiness_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.get_zatca_branch_readiness_v2(
  p_branch_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
  v_status text;
  v_head_exists boolean := false;
  v_production_connected boolean := false;
  v_client_acknowledged boolean := false;
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM public.branches
  WHERE id = p_branch_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  SELECT * INTO v_runtime
  FROM public.zatca_finalization_runtime
  WHERE singleton = true;

  SELECT readiness_status INTO v_status
  FROM public.zatca_branch_readiness_v2
  WHERE tenant_id = v_tenant_id AND branch_id = p_branch_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.zatca_chain_heads_v2 h
    WHERE h.tenant_id = v_tenant_id
      AND h.branch_id = p_branch_id
      AND h.last_committed_counter >= 0
      AND NULLIF(btrim(h.last_committed_hash), '') IS NOT NULL
  ) INTO v_head_exists;

  SELECT EXISTS (
    SELECT 1
    FROM public.zatca_production_credentials c
    WHERE c.tenant_id = v_tenant_id
      AND c.branch_id = p_branch_id
      AND c.environment = 'production'
      AND c.onboarding_status = 'production_connected'
      AND NULLIF(c.encrypted_production_csid, '') IS NOT NULL
      AND NULLIF(c.encrypted_production_secret, '') IS NOT NULL
  ) INTO v_production_connected;

  SELECT EXISTS (
    SELECT 1
    FROM public.zatca_client_capabilities_v2 c
    WHERE c.user_id = p_user_id
      AND c.branch_id = p_branch_id
      AND c.client_version = v_runtime.minimum_client_version
      AND c.edge_version = v_runtime.minimum_edge_version
      AND c.schema_version = v_runtime.schema_version
      AND c.expires_at > clock_timestamp()
  ) INTO v_client_acknowledged;

  RETURN jsonb_build_object(
    'branchId', p_branch_id,
    'branchReady', v_status = 'ready',
    'branchBlocked', v_status = 'blocked',
    'readinessStatus', COALESCE(v_status, 'missing'),
    'chainHeadExists', v_head_exists,
    'productionConnected', v_production_connected,
    'clientAcknowledged', v_client_acknowledged,
    'structurallyReady',
      v_status = 'ready' AND v_head_exists AND v_production_connected
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.acknowledge_zatca_client_capability_v2(
  p_user_id uuid,
  p_branch_id uuid,
  p_client_version text,
  p_edge_version text,
  p_ttl_seconds integer DEFAULT 300
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_user_tenant uuid;
  v_branch_tenant uuid;
  v_gate jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_ttl_seconds < 60 OR p_ttl_seconds > 600 THEN RAISE EXCEPTION 'INVALID_CAPABILITY_TTL'; END IF;
  SELECT * INTO v_runtime FROM public.zatca_finalization_runtime WHERE singleton = true;
  SELECT tenant_id INTO v_user_tenant FROM public.user_profiles WHERE id = p_user_id AND is_active = true;
  SELECT tenant_id INTO v_branch_tenant FROM public.branches WHERE id = p_branch_id;
  IF v_user_tenant IS NULL OR v_branch_tenant IS NULL OR v_user_tenant <> v_branch_tenant THEN
    RAISE EXCEPTION 'CAPABILITY_SCOPE_MISMATCH';
  END IF;
  IF p_client_version IS DISTINCT FROM v_runtime.minimum_client_version
     OR p_edge_version IS DISTINCT FROM v_runtime.minimum_edge_version THEN
    RETURN jsonb_build_object('acknowledged', false, 'reason', 'version_mismatch');
  END IF;

  v_gate := public.get_zatca_branch_readiness_v2(p_branch_id, p_user_id);
  IF NOT COALESCE(v_runtime.immutable_finalization_enabled, false)
     OR NOT COALESCE(v_runtime.simplified_enabled, false)
     OR COALESCE((v_gate->>'structurallyReady')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('acknowledged', false, 'reason', 'branch_or_global_not_ready');
  END IF;

  INSERT INTO public.zatca_client_capabilities_v2 (
    user_id, branch_id, client_version, edge_version, schema_version,
    acknowledged_at, expires_at
  ) VALUES (
    p_user_id, p_branch_id, p_client_version, p_edge_version,
    v_runtime.schema_version, v_now, v_now + make_interval(secs => p_ttl_seconds)
  )
  ON CONFLICT (user_id, branch_id) DO UPDATE SET
    client_version = EXCLUDED.client_version,
    edge_version = EXCLUDED.edge_version,
    schema_version = EXCLUDED.schema_version,
    acknowledged_at = EXCLUDED.acknowledged_at,
    expires_at = EXCLUDED.expires_at;

  RETURN jsonb_build_object(
    'acknowledged', true,
    'expiresAt', v_now + make_interval(secs => p_ttl_seconds)
  );
END
$function$;

-- This trigger is now a fail-safe compatibility check. A missing/stale branch
-- gate deliberately leaves the new row legacy instead of rejecting checkout.
CREATE OR REPLACE FUNCTION public.require_zatca_client_capability_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.initialize_zatca_finalization_v2_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_kind text;
  v_gate jsonb;
BEGIN
  SELECT * INTO v_runtime
  FROM public.zatca_finalization_runtime
  WHERE singleton = true;
  IF NOT COALESCE(v_runtime.immutable_finalization_enabled, false) THEN RETURN NEW; END IF;

  v_kind := CASE
    WHEN NEW.zatca_invoice_type = 'simplified' THEN 'simplified'
    WHEN NEW.zatca_invoice_type = 'standard' THEN 'standard'
    ELSE NULL
  END;
  IF v_kind IS NULL AND NEW.original_invoice_id IS NOT NULL THEN
    SELECT CASE
      WHEN zatca_invoice_type = 'simplified' THEN 'simplified'
      WHEN zatca_invoice_type = 'standard' THEN 'standard'
      ELSE NULL
    END INTO v_kind
    FROM public.invoices
    WHERE id = NEW.original_invoice_id AND tenant_id = NEW.tenant_id;
  END IF;
  IF v_kind IS NULL THEN RETURN NEW; END IF;
  IF v_kind = 'simplified' AND NOT COALESCE(v_runtime.simplified_enabled, false) THEN RETURN NEW; END IF;
  IF v_kind = 'standard' AND NOT COALESCE(v_runtime.standard_enabled, false) THEN RETURN NEW; END IF;
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;

  v_gate := public.get_zatca_branch_readiness_v2(NEW.branch_id, NEW.created_by);
  IF COALESCE((v_gate->>'structurallyReady')::boolean, false) IS NOT TRUE
     OR COALESCE((v_gate->>'clientAcknowledged')::boolean, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  NEW.zatca_finalization_version := 2;
  NEW.zatca_artifact_provenance := 'server_v2';
  NEW.zatca_document_kind := v_kind;
  NEW.zatca_lifecycle_state := 'not_started';
  NEW.zatca_artifact_stage := 'none';
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.approve_zatca_branch_readiness_v2(
  p_branch_id uuid,
  p_source text,
  p_reason text,
  p_approved_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_source NOT IN ('production_onboarding', 'controlled_reconciliation')
     OR NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_BRANCH_READINESS_APPROVAL';
  END IF;
  SELECT tenant_id INTO v_tenant_id FROM public.branches WHERE id = p_branch_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_tenant_id::text || ':' || p_branch_id::text, 0
  ));
  IF NOT EXISTS (
    SELECT 1 FROM public.zatca_chain_heads_v2
    WHERE tenant_id = v_tenant_id AND branch_id = p_branch_id
      AND last_committed_counter >= 0
      AND NULLIF(btrim(last_committed_hash), '') IS NOT NULL
  ) THEN RAISE EXCEPTION 'VALID_CHAIN_HEAD_REQUIRED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.zatca_production_credentials
    WHERE tenant_id = v_tenant_id AND branch_id = p_branch_id
      AND environment = 'production' AND onboarding_status = 'production_connected'
      AND NULLIF(encrypted_production_csid, '') IS NOT NULL
      AND NULLIF(encrypted_production_secret, '') IS NOT NULL
  ) THEN RAISE EXCEPTION 'PRODUCTION_ONBOARDING_INCOMPLETE'; END IF;

  INSERT INTO public.zatca_branch_readiness_v2 (
    tenant_id, branch_id, readiness_status, readiness_source,
    reason, approved_by, approved_at
  ) VALUES (
    v_tenant_id, p_branch_id, 'ready', p_source,
    btrim(p_reason), p_approved_by, clock_timestamp()
  )
  ON CONFLICT (tenant_id, branch_id) DO UPDATE SET
    readiness_status = 'ready',
    readiness_source = EXCLUDED.readiness_source,
    reason = EXCLUDED.reason,
    approved_by = EXCLUDED.approved_by,
    approved_at = EXCLUDED.approved_at,
    updated_at = clock_timestamp();
END
$function$;

CREATE OR REPLACE FUNCTION public.block_zatca_branch_v2(
  p_branch_id uuid,
  p_reason text,
  p_approved_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'BLOCK_REASON_REQUIRED'; END IF;
  SELECT tenant_id INTO v_tenant_id FROM public.branches WHERE id = p_branch_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_tenant_id::text || ':' || p_branch_id::text, 0
  ));

  INSERT INTO public.zatca_branch_readiness_v2 (
    tenant_id, branch_id, readiness_status, readiness_source,
    reason, approved_by, approved_at
  ) VALUES (
    v_tenant_id, p_branch_id, 'blocked', 'operator_block',
    btrim(p_reason), p_approved_by, clock_timestamp()
  )
  ON CONFLICT (tenant_id, branch_id) DO UPDATE SET
    readiness_status = 'blocked',
    readiness_source = 'operator_block',
    reason = EXCLUDED.reason,
    approved_by = EXCLUDED.approved_by,
    approved_at = EXCLUDED.approved_at,
    updated_at = clock_timestamp();
END
$function$;

CREATE OR REPLACE FUNCTION public.initialize_zatca_new_branch_chain_v2(
  p_branch_id uuid,
  p_reason text,
  p_approved_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
  v_first_hash constant text :=
    'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
  v_head public.zatca_chain_heads_v2%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'INITIALIZATION_REASON_REQUIRED'; END IF;
  SELECT tenant_id INTO v_tenant_id FROM public.branches WHERE id = p_branch_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_tenant_id::text || ':' || p_branch_id::text, 0
  ));
  IF NOT EXISTS (
    SELECT 1 FROM public.zatca_production_credentials
    WHERE tenant_id = v_tenant_id AND branch_id = p_branch_id
      AND environment = 'production' AND onboarding_status = 'production_connected'
      AND NULLIF(encrypted_production_csid, '') IS NOT NULL
      AND NULLIF(encrypted_production_secret, '') IS NOT NULL
  ) THEN RAISE EXCEPTION 'PRODUCTION_ONBOARDING_INCOMPLETE'; END IF;

  SELECT * INTO v_head
  FROM public.zatca_chain_heads_v2
  WHERE tenant_id = v_tenant_id AND branch_id = p_branch_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_head.last_committed_counter = 0
       AND v_head.last_committed_hash = v_first_hash
       AND v_head.seeded_from = 'new_compliance_unit' THEN
      PERFORM public.approve_zatca_branch_readiness_v2(
        p_branch_id, 'production_onboarding', p_reason, p_approved_by
      );
      RETURN jsonb_build_object('initialized', true, 'idempotent', true, 'branchReady', true);
    END IF;
    RETURN jsonb_build_object(
      'initialized', false, 'branchReady', false, 'reason', 'existing_head_requires_review'
    );
  END IF;

  -- Invoice existence is used only to reject automatic new-unit initialization;
  -- it is never used to derive a counter or PIH.
  IF EXISTS (
    SELECT 1 FROM public.invoices
    WHERE tenant_id = v_tenant_id AND branch_id = p_branch_id
  ) THEN
    PERFORM public.block_zatca_branch_v2(
      p_branch_id, 'Historical invoices require controlled chain reconciliation.', p_approved_by
    );
    RETURN jsonb_build_object(
      'initialized', false, 'branchReady', false, 'reason', 'historical_reconciliation_required'
    );
  END IF;

  INSERT INTO public.zatca_chain_heads_v2 (
    tenant_id, branch_id, last_committed_counter, last_committed_hash,
    seeded_from, seed_reason
  ) VALUES (
    v_tenant_id, p_branch_id, 0, v_first_hash,
    'new_compliance_unit', btrim(p_reason)
  );
  PERFORM public.approve_zatca_branch_readiness_v2(
    p_branch_id, 'production_onboarding', p_reason, p_approved_by
  );
  RETURN jsonb_build_object('initialized', true, 'idempotent', false, 'branchReady', true);
END
$function$;

-- Claims are also hidden behind the same branch lock/gate so a blocked branch
-- cannot enter claiming/retrying before the allocator rejects it.
DO $wrap_claim$
BEGIN
  IF to_regprocedure('public.claim_zatca_finalization_v2_unchecked(uuid,text,integer)') IS NULL THEN
    ALTER FUNCTION public.claim_zatca_finalization_v2(uuid, text, integer)
      RENAME TO claim_zatca_finalization_v2_unchecked;
  END IF;
END
$wrap_claim$;

CREATE OR REPLACE FUNCTION public.claim_zatca_finalization_v2(
  p_invoice_id uuid,
  p_claimed_by text,
  p_lease_seconds integer DEFAULT 90
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
  v_branch_id uuid;
BEGIN
  SELECT tenant_id, branch_id INTO v_tenant_id, v_branch_id
  FROM public.invoices
  WHERE id = p_invoice_id;
  IF v_branch_id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_tenant_id::text || ':' || v_branch_id::text, 0
  ));
  PERFORM 1
  FROM public.zatca_branch_readiness_v2 r
  JOIN public.zatca_chain_heads_v2 h
    ON h.tenant_id = r.tenant_id AND h.branch_id = r.branch_id
  WHERE r.tenant_id = v_tenant_id
    AND r.branch_id = v_branch_id
    AND r.readiness_status = 'ready'
    AND h.last_committed_counter >= 0
    AND NULLIF(btrim(h.last_committed_hash), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.zatca_production_credentials c
      WHERE c.tenant_id = v_tenant_id AND c.branch_id = v_branch_id
        AND c.environment = 'production' AND c.onboarding_status = 'production_connected'
        AND NULLIF(c.encrypted_production_csid, '') IS NOT NULL
        AND NULLIF(c.encrypted_production_secret, '') IS NOT NULL
    )
  FOR SHARE OF r, h;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_V2_NOT_READY'; END IF;

  RETURN public.claim_zatca_finalization_v2_unchecked(
    p_invoice_id, p_claimed_by, p_lease_seconds
  );
END
$function$;

-- Keep the original allocator implementation private behind a readiness
-- wrapper. The wrapper locks the branch gate before the legacy implementation
-- can allocate or auto-initialize anything.
DO $wrap_allocator$
BEGIN
  IF to_regprocedure('public.allocate_zatca_chain_v2_unchecked(uuid,uuid)') IS NULL THEN
    ALTER FUNCTION public.allocate_zatca_chain_v2(uuid, uuid)
      RENAME TO allocate_zatca_chain_v2_unchecked;
  END IF;
END
$wrap_allocator$;

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
  v_tenant_id uuid;
  v_branch_id uuid;
BEGIN
  SELECT tenant_id, branch_id INTO v_tenant_id, v_branch_id
  FROM public.invoices
  WHERE id = p_invoice_id;
  IF v_branch_id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_tenant_id::text || ':' || v_branch_id::text, 0
  ));
  PERFORM 1
  FROM public.zatca_branch_readiness_v2 r
  JOIN public.zatca_chain_heads_v2 h
    ON h.tenant_id = r.tenant_id AND h.branch_id = r.branch_id
  WHERE r.tenant_id = v_tenant_id
    AND r.branch_id = v_branch_id
    AND r.readiness_status = 'ready'
    AND h.last_committed_counter >= 0
    AND NULLIF(btrim(h.last_committed_hash), '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.zatca_production_credentials c
      WHERE c.tenant_id = v_tenant_id AND c.branch_id = v_branch_id
        AND c.environment = 'production' AND c.onboarding_status = 'production_connected'
        AND NULLIF(c.encrypted_production_csid, '') IS NOT NULL
        AND NULLIF(c.encrypted_production_secret, '') IS NOT NULL
    )
  FOR SHARE OF r, h;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRANCH_V2_NOT_READY'; END IF;

  RETURN QUERY
  SELECT *
  FROM public.allocate_zatca_chain_v2_unchecked(p_invoice_id, p_claim_token);
END
$function$;

REVOKE ALL ON FUNCTION public.get_zatca_branch_readiness_v2(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_zatca_branch_readiness_v2(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_zatca_branch_v2(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.initialize_zatca_new_branch_chain_v2(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_zatca_finalization_v2_unchecked(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_zatca_finalization_v2(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_zatca_chain_v2_unchecked(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.allocate_zatca_chain_v2(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_zatca_branch_readiness_v2(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_zatca_branch_readiness_v2(uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.block_zatca_branch_v2(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.initialize_zatca_new_branch_chain_v2(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_zatca_finalization_v2(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_zatca_chain_v2(uuid, uuid) TO service_role;

UPDATE public.zatca_finalization_runtime
SET minimum_edge_version = '2.1.0',
    minimum_client_version = '2.1.0',
    updated_at = clock_timestamp()
WHERE singleton = true;

COMMIT;
-- END RESTORED SOURCE: 09_branch_readiness_gate.sql

-- BEGIN RESTORED SOURCE: 11_durable_simplified_reporting_outbox.sql
-- ZATCA Phase 2 immutable finalization v2
-- 11_durable_simplified_reporting_outbox.sql
-- Additive transactional outbox for server-side simplified reporting.
--
-- This file is safe to install while all finalization flags are false. It does
-- not enqueue historical rows. The two known incident rows are handled only by
-- the separately authenticated, hard-coded recovery path.
--
-- Retry policy: at most four transient dispatch attempts. Backoff after the
-- first three transient failures is 60, 120, then 240 seconds. A fourth
-- transient failure is blocked as MAX_TRANSIENT_ATTEMPTS_REACHED. Definite
-- ZATCA rejections and ambiguous post-send outcomes are never auto-retried.

BEGIN;

CREATE TABLE IF NOT EXISTS public.zatca_reporting_outbox_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  operation text NOT NULL DEFAULT 'report' CHECK (operation = 'report'),
  artifact_hash text NOT NULL CHECK (NULLIF(btrim(artifact_hash), '') IS NOT NULL),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'retryable', 'accepted', 'blocked')
  ),
  source text NOT NULL DEFAULT 'finalization',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  claimed_by text,
  last_outcome text,
  last_error text,
  safe_response jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_at timestamptz,
  UNIQUE (invoice_id, operation)
);

ALTER TABLE public.zatca_reporting_outbox_v2
  ADD COLUMN IF NOT EXISTS last_outcome text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.zatca_reporting_outbox_v2'::regclass
      AND conname = 'zatca_reporting_outbox_v2_last_outcome_check'
  ) THEN
    ALTER TABLE public.zatca_reporting_outbox_v2
      ADD CONSTRAINT zatca_reporting_outbox_v2_last_outcome_check
      CHECK (
        last_outcome IS NULL OR last_outcome IN (
          'accepted', 'transient_failure', 'definite_rejection', 'ambiguous_outcome'
        )
      );
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS zatca_reporting_outbox_v2_dispatch_idx
ON public.zatca_reporting_outbox_v2(status, available_at, created_at)
WHERE status IN ('pending', 'retryable');

CREATE INDEX IF NOT EXISTS zatca_reporting_outbox_v2_branch_idx
ON public.zatca_reporting_outbox_v2(tenant_id, branch_id, created_at);

ALTER TABLE public.zatca_reporting_outbox_v2 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zatca_reporting_outbox_v2 FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.zatca_reporting_outbox_v2 TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_zatca_reporting_outbox_v2(
  p_invoice_id uuid,
  p_source text DEFAULT 'server_retry'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_reservation public.zatca_chain_reservations_v2%ROWTYPE;
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
BEGIN
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;

  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2'
     OR v_invoice.zatca_document_kind IS DISTINCT FROM 'simplified'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'simplified_final'
     OR NULLIF(v_invoice.zatca_simplified_xml, '') IS NULL
     OR NULLIF(v_invoice.zatca_simplified_xml_hash, '') IS NULL
     OR NULLIF(v_invoice.zatca_simplified_signature, '') IS NULL
     OR NULLIF(v_invoice.zatca_simplified_qr, '') IS NULL THEN
    RAISE EXCEPTION 'SIMPLIFIED_FINAL_ARTIFACT_MISSING';
  END IF;
  IF v_invoice.zatca_lifecycle_state = 'reconciliation_required'
     OR v_invoice.zatca_network_ack_state_v2 = 'reconciliation_required' THEN
    RAISE EXCEPTION 'RECONCILIATION_REQUIRED';
  END IF;

  SELECT * INTO v_reservation
  FROM public.zatca_chain_reservations_v2
  WHERE invoice_id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_reservation.state IS DISTINCT FROM 'committed'
     OR v_reservation.counter_number IS DISTINCT FROM v_invoice.zatca_counter_number
     OR v_reservation.previous_hash IS DISTINCT FROM v_invoice.zatca_prev_invoice_hash
     OR v_reservation.committed_artifact_hash IS DISTINCT FROM v_invoice.zatca_simplified_xml_hash THEN
    RAISE EXCEPTION 'COMMITTED_ARTIFACT_IDENTITY_MISMATCH';
  END IF;

  SELECT * INTO v_outbox
  FROM public.zatca_reporting_outbox_v2
  WHERE invoice_id = p_invoice_id AND operation = 'report'
  FOR UPDATE;

  IF FOUND THEN
    IF v_outbox.artifact_hash IS DISTINCT FROM v_invoice.zatca_simplified_xml_hash
       OR v_outbox.tenant_id IS DISTINCT FROM v_invoice.tenant_id
       OR v_outbox.branch_id IS DISTINCT FROM v_invoice.branch_id THEN
      RAISE EXCEPTION 'OUTBOX_ARTIFACT_IDENTITY_MISMATCH';
    END IF;
    IF v_outbox.status = 'accepted' OR v_invoice.zatca_status = 'reported' THEN
      UPDATE public.zatca_reporting_outbox_v2 SET
        status = 'accepted',
        accepted_at = COALESCE(accepted_at, clock_timestamp()),
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
      WHERE id = v_outbox.id;
      RETURN jsonb_build_object('status', 'accepted', 'outboxId', v_outbox.id);
    END IF;
    IF v_outbox.status = 'blocked' THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'outboxId', v_outbox.id,
        'error', COALESCE(v_outbox.last_error, 'REPORTING_OUTBOX_BLOCKED')
      );
    END IF;
    IF v_outbox.status = 'processing'
       AND v_outbox.lease_expires_at > clock_timestamp() THEN
      RETURN jsonb_build_object(
        'status', 'in_progress',
        'outboxId', v_outbox.id,
        'leaseExpiresAt', v_outbox.lease_expires_at
      );
    END IF;

    UPDATE public.zatca_reporting_outbox_v2 SET
      status = 'pending',
      source = left(COALESCE(NULLIF(p_source, ''), 'server_retry'), 80),
      available_at = clock_timestamp(),
      lease_token = NULL,
      lease_expires_at = NULL,
      claimed_by = NULL,
      last_error = NULL,
      updated_at = clock_timestamp()
    WHERE id = v_outbox.id;
    RETURN jsonb_build_object('status', 'pending', 'outboxId', v_outbox.id);
  END IF;

  INSERT INTO public.zatca_reporting_outbox_v2 (
    tenant_id, branch_id, invoice_id, operation, artifact_hash, status, source
  ) VALUES (
    v_invoice.tenant_id,
    v_invoice.branch_id,
    v_invoice.id,
    'report',
    v_invoice.zatca_simplified_xml_hash,
    CASE WHEN v_invoice.zatca_status = 'reported' THEN 'accepted' ELSE 'pending' END,
    left(COALESCE(NULLIF(p_source, ''), 'server_retry'), 80)
  )
  RETURNING * INTO v_outbox;

  RETURN jsonb_build_object('status', v_outbox.status, 'outboxId', v_outbox.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.claim_zatca_reporting_outbox_v2(
  p_claimed_by text,
  p_lease_seconds integer DEFAULT 120,
  p_invoice_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_reservation public.zatca_chain_reservations_v2%ROWTYPE;
  v_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_lease_seconds < 30 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'INVALID_LEASE';
  END IF;

  SELECT o.* INTO v_outbox
  FROM public.zatca_reporting_outbox_v2 o
  JOIN public.invoices i ON i.id = o.invoice_id
  WHERE (p_invoice_id IS NULL OR o.invoice_id = p_invoice_id)
    AND (
      (o.status IN ('pending', 'retryable') AND o.available_at <= v_now)
      OR (o.status = 'processing' AND o.lease_expires_at <= v_now)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.zatca_reporting_outbox_v2 earlier
      JOIN public.invoices earlier_invoice ON earlier_invoice.id = earlier.invoice_id
      WHERE earlier.tenant_id = o.tenant_id
        AND earlier.branch_id = o.branch_id
        AND earlier_invoice.zatca_counter_number < i.zatca_counter_number
        AND earlier.status <> 'accepted'
    )
  ORDER BY i.zatca_counter_number, o.created_at
  FOR UPDATE OF o SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_work'); END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_outbox.invoice_id
  FOR UPDATE;
  SELECT * INTO v_reservation
  FROM public.zatca_chain_reservations_v2
  WHERE invoice_id = v_outbox.invoice_id
  FOR UPDATE;

  IF v_invoice.zatca_status = 'reported'
     AND v_invoice.zatca_lifecycle_state = 'reported' THEN
    UPDATE public.zatca_reporting_outbox_v2 SET
      status = 'accepted',
      accepted_at = COALESCE(accepted_at, v_now),
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
    WHERE id = v_outbox.id;
    RETURN jsonb_build_object(
      'status', 'already_accepted',
      'invoiceId', v_outbox.invoice_id,
      'outboxId', v_outbox.id
    );
  END IF;

  -- attempt_count counts actual claimed dispatch attempts. A legacy or
  -- manually-corrupted retryable row can never receive a fifth attempt.
  IF v_outbox.attempt_count >= 4 THEN
    UPDATE public.zatca_reporting_outbox_v2 SET
      status = 'blocked',
      last_outcome = 'transient_failure',
      last_error = 'MAX_TRANSIENT_ATTEMPTS_REACHED',
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
    WHERE id = v_outbox.id;
    UPDATE public.invoices SET
      zatca_lifecycle_state = 'reporting_failed',
      zatca_status = 'failed',
      zatca_finalization_error_v2 = jsonb_build_object(
        'code', 'MAX_TRANSIENT_ATTEMPTS_REACHED',
        'message', 'Maximum transient reporting attempts reached.'
      )
    WHERE id = v_outbox.invoice_id;
    RETURN jsonb_build_object(
      'status', 'blocked',
      'invoiceId', v_outbox.invoice_id,
      'outboxId', v_outbox.id,
      'error', 'MAX_TRANSIENT_ATTEMPTS_REACHED'
    );
  END IF;

  IF v_invoice.zatca_finalization_version IS DISTINCT FROM 2
     OR v_invoice.zatca_artifact_provenance IS DISTINCT FROM 'server_v2'
     OR v_invoice.zatca_document_kind IS DISTINCT FROM 'simplified'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'simplified_final'
     OR NULLIF(v_invoice.zatca_simplified_xml, '') IS NULL
     OR v_invoice.zatca_simplified_xml_hash IS DISTINCT FROM v_outbox.artifact_hash
     OR v_reservation.state IS DISTINCT FROM 'committed'
     OR v_reservation.committed_artifact_hash IS DISTINCT FROM v_outbox.artifact_hash
     OR v_reservation.counter_number IS DISTINCT FROM v_invoice.zatca_counter_number
     OR v_reservation.previous_hash IS DISTINCT FROM v_invoice.zatca_prev_invoice_hash THEN
    UPDATE public.zatca_reporting_outbox_v2 SET
      status = 'blocked',
      last_error = 'COMMITTED_ARTIFACT_IDENTITY_MISMATCH',
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
    WHERE id = v_outbox.id;
    RETURN jsonb_build_object(
      'status', 'blocked',
      'invoiceId', v_outbox.invoice_id,
      'outboxId', v_outbox.id,
      'error', 'COMMITTED_ARTIFACT_IDENTITY_MISMATCH'
    );
  END IF;

  UPDATE public.zatca_reporting_outbox_v2 SET
    status = 'processing',
    attempt_count = attempt_count + 1,
    lease_token = v_token,
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
    claimed_by = left(COALESCE(NULLIF(p_claimed_by, ''), 'unknown'), 120),
    updated_at = v_now
  WHERE id = v_outbox.id;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'outboxId', v_outbox.id,
    'outboxToken', v_token,
    'invoiceId', v_invoice.id,
    'tenantId', v_invoice.tenant_id,
    'branchId', v_invoice.branch_id,
    'counterNumber', v_invoice.zatca_counter_number,
    'artifactHash', v_outbox.artifact_hash
  );
END
$function$;

-- Remove the unsafe boolean contract if an earlier review build installed it.
DROP FUNCTION IF EXISTS public.persist_zatca_reporting_outbox_result_v2(
  uuid, uuid, uuid, boolean, jsonb, jsonb
);

CREATE OR REPLACE FUNCTION public.persist_zatca_reporting_outbox_result_v2(
  p_outbox_id uuid,
  p_outbox_token uuid,
  p_network_token uuid,
  p_outcome text,
  p_safe_response jsonb,
  p_safe_warnings jsonb DEFAULT NULL,
  p_safe_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice_id uuid;
  v_invoice public.invoices%ROWTYPE;
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
  v_reservation public.zatca_chain_reservations_v2%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_reason text;
  v_backoff_seconds integer;
  v_attempts_exhausted boolean;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN (
    'accepted', 'transient_failure', 'definite_rejection', 'ambiguous_outcome'
  ) THEN
    RAISE EXCEPTION 'INVALID_REPORTING_OUTCOME';
  END IF;

  SELECT invoice_id INTO v_invoice_id
  FROM public.zatca_reporting_outbox_v2
  WHERE id = p_outbox_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUTBOX_NOT_FOUND'; END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_invoice_id
  FOR UPDATE;
  SELECT * INTO v_outbox
  FROM public.zatca_reporting_outbox_v2
  WHERE id = p_outbox_id
  FOR UPDATE;
  SELECT * INTO v_reservation
  FROM public.zatca_chain_reservations_v2
  WHERE invoice_id = v_invoice_id
  FOR UPDATE;

  IF v_outbox.status IS DISTINCT FROM 'processing'
     OR v_outbox.lease_token IS DISTINCT FROM p_outbox_token
     OR v_outbox.lease_expires_at <= v_now
     OR v_invoice.zatca_network_claim_token_v2 IS DISTINCT FROM p_network_token
     OR v_invoice.zatca_network_operation_v2 IS DISTINCT FROM 'report'
     OR COALESCE(v_invoice.zatca_network_ack_state_v2, '') NOT IN ('claimed', 'request_started')
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'simplified_final'
     OR v_invoice.zatca_simplified_xml_hash IS DISTINCT FROM v_outbox.artifact_hash
     OR v_reservation.state IS DISTINCT FROM 'committed'
     OR v_reservation.committed_artifact_hash IS DISTINCT FROM v_outbox.artifact_hash THEN
    RAISE EXCEPTION 'STALE_OR_MISMATCHED_REPORTING_OUTCOME';
  END IF;

  IF p_outcome IN ('accepted', 'ambiguous_outcome')
     AND v_invoice.zatca_network_ack_state_v2 IS DISTINCT FROM 'request_started' THEN
    RAISE EXCEPTION 'REMOTE_OUTCOME_REQUIRES_STARTED_REQUEST';
  END IF;

  v_attempts_exhausted := p_outcome = 'transient_failure'
    AND v_outbox.attempt_count >= 4;
  v_backoff_seconds := LEAST(
    900,
    60 * power(2, GREATEST(v_outbox.attempt_count - 1, 0))::integer
  );
  v_status := CASE
    WHEN p_outcome = 'accepted' THEN 'accepted'
    WHEN p_outcome = 'transient_failure' AND NOT v_attempts_exhausted THEN 'retryable'
    ELSE 'blocked'
  END;
  v_reason := CASE
    WHEN p_outcome = 'accepted' THEN NULL
    WHEN v_attempts_exhausted THEN 'MAX_TRANSIENT_ATTEMPTS_REACHED'
    WHEN p_outcome = 'definite_rejection' THEN
      COALESCE(NULLIF(p_safe_reason, ''), 'ZATCA_DEFINITE_REJECTION')
    WHEN p_outcome = 'ambiguous_outcome' THEN
      COALESCE(NULLIF(p_safe_reason, ''), 'AMBIGUOUS_REMOTE_OUTCOME')
    ELSE COALESCE(NULLIF(p_safe_reason, ''), 'TRANSIENT_REPORTING_FAILURE')
  END;

  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE
      WHEN p_outcome = 'accepted' THEN 'reported'
      WHEN p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'
      ELSE 'reporting_failed'
    END,
    zatca_status = CASE
      WHEN p_outcome = 'accepted' THEN 'reported'
      WHEN p_outcome = 'transient_failure' AND NOT v_attempts_exhausted THEN 'pending'
      WHEN p_outcome = 'ambiguous_outcome' THEN zatca_status
      ELSE 'failed'
    END,
    zatca_submitted_at = v_now,
    zatca_network_response_v2 = COALESCE(p_safe_response, zatca_network_response_v2),
    zatca_reporting_response = COALESCE(p_safe_response, zatca_reporting_response),
    zatca_warnings = COALESCE(p_safe_warnings, zatca_warnings),
    zatca_network_ack_state_v2 = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'
      ELSE 'response_persisted'
    END,
    zatca_reconciliation_reason_v2 = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN left(v_reason, 240)
      ELSE NULL
    END,
    zatca_finalization_error_v2 = CASE
      WHEN p_outcome = 'accepted' THEN NULL
      ELSE jsonb_build_object(
        'code', CASE
          WHEN v_attempts_exhausted THEN 'MAX_TRANSIENT_ATTEMPTS_REACHED'
          WHEN p_outcome = 'definite_rejection' THEN 'ZATCA_DEFINITE_REJECTION'
          WHEN p_outcome = 'ambiguous_outcome' THEN 'RECONCILIATION_REQUIRED'
          ELSE 'REPORTING_TRANSIENT_FAILURE'
        END,
        'message', left(v_reason, 240)
      )
    END,
    zatca_network_claim_token_v2 = NULL,
    zatca_network_lease_expires_at_v2 = NULL
  WHERE id = v_invoice_id;

  UPDATE public.zatca_reporting_outbox_v2 SET
    status = v_status,
    last_outcome = p_outcome,
    safe_response = COALESCE(p_safe_response, safe_response),
    last_error = left(v_reason, 240),
    available_at = CASE
      WHEN v_status = 'retryable'
        THEN v_now + make_interval(secs => v_backoff_seconds)
      ELSE available_at
    END,
    accepted_at = CASE WHEN p_outcome = 'accepted' THEN v_now ELSE NULL END,
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = v_now
  WHERE id = p_outbox_id;

  RETURN jsonb_build_object(
    'status', v_status,
    'outcome', p_outcome,
    'invoiceId', v_invoice_id,
    'attemptCount', v_outbox.attempt_count,
    'retryAfterSeconds', CASE WHEN v_status = 'retryable' THEN v_backoff_seconds ELSE NULL END,
    'reason', v_reason
  );
END
$function$;

DROP FUNCTION IF EXISTS public.fail_zatca_reporting_outbox_attempt_v2(
  uuid, uuid, boolean, boolean, text
);

CREATE OR REPLACE FUNCTION public.fail_zatca_reporting_outbox_attempt_v2(
  p_outbox_id uuid,
  p_outbox_token uuid,
  p_outcome text,
  p_safe_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_outbox public.zatca_reporting_outbox_v2%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_status text;
  v_reason text;
  v_backoff_seconds integer;
  v_attempts_exhausted boolean;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN (
    'transient_failure', 'definite_rejection', 'ambiguous_outcome'
  ) THEN
    RAISE EXCEPTION 'INVALID_PREFLIGHT_REPORTING_OUTCOME';
  END IF;
  SELECT * INTO v_outbox
  FROM public.zatca_reporting_outbox_v2
  WHERE id = p_outbox_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_outbox.status IS DISTINCT FROM 'processing'
     OR v_outbox.lease_token IS DISTINCT FROM p_outbox_token THEN
    RAISE EXCEPTION 'STALE_OUTBOX_CLAIM_TOKEN';
  END IF;

  v_attempts_exhausted := p_outcome = 'transient_failure'
    AND v_outbox.attempt_count >= 4;
  v_backoff_seconds := LEAST(
    900,
    60 * power(2, GREATEST(v_outbox.attempt_count - 1, 0))::integer
  );
  v_status := CASE
    WHEN p_outcome = 'transient_failure' AND NOT v_attempts_exhausted THEN 'retryable'
    ELSE 'blocked'
  END;
  v_reason := CASE
    WHEN v_attempts_exhausted THEN 'MAX_TRANSIENT_ATTEMPTS_REACHED'
    ELSE COALESCE(NULLIF(p_safe_reason, ''), upper(p_outcome))
  END;

  UPDATE public.zatca_reporting_outbox_v2 SET
    status = v_status,
    last_outcome = p_outcome,
    available_at = CASE
      WHEN v_status = 'retryable'
        THEN v_now + make_interval(secs => v_backoff_seconds)
      ELSE available_at
    END,
    last_error = left(v_reason, 240),
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = v_now
  WHERE id = p_outbox_id
    AND status = 'processing';

  UPDATE public.invoices SET
    zatca_lifecycle_state = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'
      ELSE 'reporting_failed'
    END,
    zatca_status = CASE
      WHEN p_outcome = 'transient_failure' AND NOT v_attempts_exhausted THEN 'pending'
      WHEN p_outcome = 'ambiguous_outcome' THEN zatca_status
      ELSE 'failed'
    END,
    zatca_network_ack_state_v2 = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN 'reconciliation_required'
      ELSE zatca_network_ack_state_v2
    END,
    zatca_reconciliation_reason_v2 = CASE
      WHEN p_outcome = 'ambiguous_outcome' THEN left(v_reason, 240)
      ELSE zatca_reconciliation_reason_v2
    END,
    zatca_finalization_error_v2 = jsonb_build_object(
      'code', CASE
        WHEN v_attempts_exhausted THEN 'MAX_TRANSIENT_ATTEMPTS_REACHED'
        WHEN p_outcome = 'definite_rejection' THEN 'REPORTING_PREFLIGHT_BLOCKED'
        WHEN p_outcome = 'ambiguous_outcome' THEN 'RECONCILIATION_REQUIRED'
        ELSE 'REPORTING_TRANSIENT_FAILURE'
      END,
      'message', left(v_reason, 240)
    )
  WHERE id = v_outbox.invoice_id;

  RETURN jsonb_build_object(
    'status', v_status,
    'outcome', p_outcome,
    'attemptCount', v_outbox.attempt_count,
    'retryAfterSeconds', CASE WHEN v_status = 'retryable' THEN v_backoff_seconds ELSE NULL END,
    'reason', v_reason
  );
END
$function$;

-- Replace only the simplified persistence function. Chain commit, immutable
-- artifact persistence, and outbox insertion remain one PostgreSQL transaction.
CREATE OR REPLACE FUNCTION public.persist_zatca_simplified_final_v2(
  p_invoice_id uuid,
  p_claim_token uuid,
  p_signed_xml text,
  p_xml_hash text,
  p_signature text,
  p_qr text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_outbox_id uuid;
BEGIN
  IF NULLIF(p_signed_xml, '') IS NULL OR NULLIF(p_xml_hash, '') IS NULL
     OR NULLIF(p_signature, '') IS NULL OR NULLIF(p_qr, '') IS NULL THEN
    RAISE EXCEPTION 'INCOMPLETE_SIMPLIFIED_ARTIFACT';
  END IF;
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.zatca_finalization_claim_token_v2 IS DISTINCT FROM p_claim_token
     OR v_invoice.zatca_finalization_lease_expires_at_v2 <= clock_timestamp() THEN
    RAISE EXCEPTION 'STALE_FINALIZATION_CLAIM_TOKEN';
  END IF;
  IF v_invoice.zatca_document_kind IS DISTINCT FROM 'simplified'
     OR v_invoice.zatca_artifact_stage IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'ILLEGAL_SIMPLIFIED_TRANSITION';
  END IF;

  PERFORM public.commit_zatca_chain_v2(p_invoice_id, p_claim_token, p_xml_hash);
  UPDATE public.invoices SET
    zatca_simplified_xml = p_signed_xml,
    zatca_simplified_xml_hash = p_xml_hash,
    zatca_simplified_signature = p_signature,
    zatca_simplified_qr = p_qr,
    zatca_artifact_stage = 'simplified_final',
    zatca_lifecycle_state = 'locally_finalized',
    zatca_finalized_at_v2 = clock_timestamp(),
    zatca_finalization_claim_token_v2 = NULL,
    zatca_finalization_lease_expires_at_v2 = NULL,
    zatca_finalization_error_v2 = NULL
  WHERE id = p_invoice_id;

  INSERT INTO public.zatca_reporting_outbox_v2 (
    tenant_id, branch_id, invoice_id, operation, artifact_hash, status, source
  ) VALUES (
    v_invoice.tenant_id, v_invoice.branch_id, p_invoice_id,
    'report', btrim(p_xml_hash), 'pending', 'finalization'
  )
  ON CONFLICT (invoice_id, operation) DO NOTHING
  RETURNING id INTO v_outbox_id;
  IF v_outbox_id IS NULL THEN
    RAISE EXCEPTION 'DURABLE_REPORTING_OUTBOX_ALREADY_EXISTS';
  END IF;

  RETURN jsonb_build_object(
    'status', 'locally_finalized',
    'artifactStage', 'simplified_final',
    'reportingDispatch', 'durably_queued',
    'outboxId', v_outbox_id
  );
END
$function$;

DO $grants$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'enqueue_zatca_reporting_outbox_v2',
      'claim_zatca_reporting_outbox_v2',
      'persist_zatca_reporting_outbox_result_v2',
      'fail_zatca_reporting_outbox_attempt_v2',
      'persist_zatca_simplified_final_v2'
    )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.signature);
  END LOOP;
END
$grants$;

COMMIT;
-- END RESTORED SOURCE: 11_durable_simplified_reporting_outbox.sql

