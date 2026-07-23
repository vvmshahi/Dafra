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
