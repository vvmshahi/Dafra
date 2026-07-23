-- PREPARED ONLY. Execute only after migration, Edge, frontend, seed, and
-- capability checks in the coordinated deployment runbook are complete.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

DO $guard$
DECLARE
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
BEGIN
  SELECT * INTO v_runtime
  FROM public.zatca_finalization_runtime
  WHERE singleton = true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ZATCA_RUNTIME_MISSING'; END IF;
  IF v_runtime.immutable_finalization_enabled
     OR v_runtime.simplified_enabled
     OR v_runtime.standard_enabled THEN
    RAISE EXCEPTION 'ZATCA_FLAGS_ALREADY_ENABLED';
  END IF;
  IF v_runtime.minimum_edge_version <> '2.1.0'
     OR v_runtime.minimum_client_version <> '2.1.0' THEN
    RAISE EXCEPTION 'ZATCA_BRANCH_GATE_VERSION_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.zatca_client_capabilities_v2
    WHERE expires_at <= clock_timestamp()
  ) THEN RAISE EXCEPTION 'EXPIRED_CAPABILITY_ROWS_REQUIRE_REVIEWED_CLEANUP'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.zatca_chain_heads_v2 h
    JOIN public.zatca_branch_readiness_v2 r USING (tenant_id, branch_id)
    WHERE h.branch_id = '371dee75-6e46-496e-89e7-1a7492b51a3c'::uuid
      AND h.last_committed_counter = 860
      AND h.last_committed_hash =
        '0rt4rBEZvug668xBtEWMyKjvip70PJip0H9Fq2TkQSo='
      AND r.readiness_status = 'ready'
  ) THEN RAISE EXCEPTION 'BRANCH_1_REVIEWED_READINESS_MISSING'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.zatca_chain_heads_v2
    WHERE branch_id = 'b2b4fd13-b6db-4baa-b353-4eaab842ed50'::uuid
  ) OR NOT EXISTS (
    SELECT 1 FROM public.zatca_branch_readiness_v2
    WHERE branch_id = 'b2b4fd13-b6db-4baa-b353-4eaab842ed50'::uuid
      AND readiness_status = 'blocked'
  ) THEN RAISE EXCEPTION 'BRANCH_2_MUST_REMAIN_BLOCKED_WITHOUT_HEAD'; END IF;
END
$guard$;

UPDATE public.zatca_finalization_runtime
SET immutable_finalization_enabled = true,
    simplified_enabled = true,
    standard_enabled = false,
    updated_at = clock_timestamp()
WHERE singleton = true;

DO $postcondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.zatca_finalization_runtime
    WHERE singleton = true
      AND immutable_finalization_enabled
      AND simplified_enabled
      AND NOT standard_enabled
  ) THEN RAISE EXCEPTION 'SIMPLIFIED_ONLY_ACTIVATION_FAILED'; END IF;
END
$postcondition$;

COMMIT;
