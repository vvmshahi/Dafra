-- Stage 6E.B2: a narrowly-scoped, authenticated activation operation for a
-- future controlled new-branch Atomic Simplified rollout.  It is function-only
-- and deliberately unreferenced by POS, Atomic preparation, or Edge code.
--
-- No table, column, constraint, data, XML, signing, reporting, clearance, or
-- global rollout state is changed by this migration.  The sole possible write
-- when this function is explicitly called is one eligible branch-gate row.

BEGIN;
CREATE OR REPLACE FUNCTION public.activate_atomic_simplified_for_ready_branch_v1(
  p_branch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_profile record;
  v_branch record;
  v_gate_enabled boolean;
  v_chain_seeded_from text;
  v_historical_invoice_exists boolean := false;
  v_plan jsonb;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reasonCode', 'AUTHENTICATION_REQUIRED'
    );
  END IF;

  -- Gate activation is owner/admin governance, narrower than ordinary branch
  -- checkout authorization.  A client cannot write the gate table directly.
  SELECT p.id, p.tenant_id, p.role::text AS role
  INTO v_profile
  FROM public.user_profiles p
  WHERE p.id = v_actor_user_id
    AND p.is_active = true;

  IF NOT FOUND OR v_profile.role NOT IN ('owner', 'admin') THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reasonCode', 'ATOMIC_ACTIVATION_OWNER_OR_ADMIN_REQUIRED'
    );
  END IF;

  SELECT
    b.id,
    b.tenant_id,
    b.is_active AS branch_active,
    COALESCE(t.is_active, true) AS tenant_active,
    t.suspended_at
  INTO v_branch
  FROM public.branches b
  JOIN public.tenants t ON t.id = b.tenant_id
  WHERE b.id = p_branch_id
  FOR UPDATE OF b;

  IF NOT FOUND OR v_branch.tenant_id IS DISTINCT FROM v_profile.tenant_id THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reasonCode', 'CHECKOUT_BRANCH_FORBIDDEN'
    );
  END IF;

  IF v_branch.branch_active IS NOT TRUE
     OR v_branch.tenant_active IS NOT TRUE
     OR v_branch.suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'rejected',
      'branchId', v_branch.id,
      'reasonCode', 'CHECKOUT_BRANCH_NOT_ACTIVE'
    );
  END IF;

  -- Match Atomic preparation's branch serialization key.  This makes the
  -- read-only plan and the one gate write mutually exclusive with a concurrent
  -- Atomic prepare on this branch.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_branch.tenant_id::text || ':' || v_branch.id::text,
    0
  ));

  SELECT g.enabled
  INTO v_gate_enabled
  FROM public.zatca_atomic_checkout_branch_gates_v2 g
  WHERE g.tenant_id = v_branch.tenant_id
    AND g.branch_id = v_branch.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'rejected',
      'branchId', v_branch.id,
      'reasonCode', 'ATOMIC_BRANCH_GATE_MISSING'
    );
  END IF;

  -- Activation is new-compliance-unit-only.  A reconciled/unknown chain or
  -- any historical invoice leaves the branch untouched, even if other
  -- readiness signals currently look healthy.
  SELECT h.seeded_from
  INTO v_chain_seeded_from
  FROM public.zatca_chain_heads_v2 h
  WHERE h.tenant_id = v_branch.tenant_id
    AND h.branch_id = v_branch.id;

  IF v_chain_seeded_from IS DISTINCT FROM 'new_compliance_unit' THEN
    RETURN jsonb_build_object(
      'status', 'rejected',
      'branchId', v_branch.id,
      'reasonCode', 'ATOMIC_BRANCH_NOT_FRESH'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.tenant_id = v_branch.tenant_id
      AND i.branch_id = v_branch.id
  ) INTO v_historical_invoice_exists;

  IF v_historical_invoice_exists THEN
    RETURN jsonb_build_object(
      'status', 'rejected',
      'branchId', v_branch.id,
      'reasonCode', 'ATOMIC_BRANCH_NOT_FRESH'
    );
  END IF;

  -- B1 owns classification and every Atomic safety rule.  The walk-in input
  -- intentionally proves the Simplified capability of 0100/1100 only; it
  -- never changes valid B2B routing, which remains Standard clearance.
  v_plan := public.plan_new_branch_atomic_checkout_internal_v1(
    v_actor_user_id,
    v_branch.id,
    NULL
  );

  IF v_plan->>'status' = 'allowed'
     AND v_plan->>'documentType' = 'simplified'
     AND v_plan->>'reasonCode' = 'ATOMIC_ELIGIBLE'
     AND v_gate_enabled IS TRUE THEN
    RETURN jsonb_build_object(
      'status', 'already_active',
      'branchId', v_branch.id,
      'reasonCode', 'ATOMIC_ALREADY_ACTIVE',
      'executionFamily', v_plan->>'executionFamily',
      'plannerReasonCode', v_plan->>'reasonCode'
    );
  END IF;

  IF v_plan->>'status' IS DISTINCT FROM 'allowed'
     OR v_plan->>'documentType' IS DISTINCT FROM 'simplified'
     OR v_plan->>'reasonCode' IS DISTINCT FROM 'ATOMIC_BRANCH_GATE_DISABLED'
     OR v_gate_enabled IS TRUE THEN
    RETURN jsonb_build_object(
      'status', 'rejected',
      'branchId', v_branch.id,
      'reasonCode', COALESCE(
        v_plan->>'reasonCode',
        'ATOMIC_ACTIVATION_ELIGIBILITY_UNKNOWN'
      ),
      'executionFamily', v_plan->>'executionFamily',
      'plannerReasonCode', v_plan->>'reasonCode'
    );
  END IF;

  -- The branch gate is the only state this function can enable.  Global
  -- rollout, readiness, capability, chain, idempotency, outbox, and document
  -- routing remain owned by their existing server contracts.
  UPDATE public.zatca_atomic_checkout_branch_gates_v2 g
  SET enabled = true,
      enabled_at = clock_timestamp(),
      enabled_by = v_actor_user_id,
      updated_at = clock_timestamp()
  WHERE g.tenant_id = v_branch.tenant_id
    AND g.branch_id = v_branch.id
    AND g.enabled IS FALSE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATOMIC_BRANCH_GATE_ACTIVATION_CONCURRENCY_FAILURE'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'status', 'activated',
    'branchId', v_branch.id,
    'reasonCode', 'ATOMIC_ACTIVATED',
    'executionFamily', 'simplified_atomic',
    'plannerReasonCode', v_plan->>'reasonCode'
  );
END
$function$;
ALTER FUNCTION public.activate_atomic_simplified_for_ready_branch_v1(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.activate_atomic_simplified_for_ready_branch_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_atomic_simplified_for_ready_branch_v1(uuid)
  TO authenticated;
COMMENT ON FUNCTION public.activate_atomic_simplified_for_ready_branch_v1(uuid)
  IS 'Authenticated owner/admin-only, idempotent new-compliance-unit Atomic Simplified branch activation. Re-evaluates B1 planner safety and changes only one currently-disabled branch gate.';
DO $activation_catalog_assertions$
DECLARE
  v_function_oid oid := to_regprocedure(
    'public.activate_atomic_simplified_for_ready_branch_v1(uuid)'
  );
  v_owner_oid oid;
  v_anon_oid oid;
  v_authenticated_oid oid;
  v_service_role_oid oid;
  v_function pg_proc%ROWTYPE;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'ATOMIC_READY_BRANCH_ACTIVATION_SIGNATURE_MISSING';
  END IF;

  SELECT oid INTO v_owner_oid FROM pg_roles WHERE rolname = 'postgres';
  SELECT oid INTO v_anon_oid FROM pg_roles WHERE rolname = 'anon';
  SELECT oid INTO v_authenticated_oid FROM pg_roles WHERE rolname = 'authenticated';
  SELECT oid INTO v_service_role_oid FROM pg_roles WHERE rolname = 'service_role';
  SELECT * INTO v_function FROM pg_proc WHERE oid = v_function_oid;

  IF v_owner_oid IS NULL
     OR v_anon_oid IS NULL
     OR v_authenticated_oid IS NULL
     OR v_service_role_oid IS NULL
     OR v_function.proowner IS DISTINCT FROM v_owner_oid
     OR v_function.prosecdef IS DISTINCT FROM true
     OR v_function.prorettype IS DISTINCT FROM 'jsonb'::regtype::oid
     OR v_function.proretset IS DISTINCT FROM false
     OR v_function.pronargdefaults IS DISTINCT FROM 0
     OR v_function.proargtypes IS DISTINCT FROM ARRAY[
       'uuid'::regtype::oid
     ]::oidvector
     OR v_function.proargnames IS DISTINCT FROM ARRAY[
       'p_branch_id'
     ]::text[] THEN
    RAISE EXCEPTION 'ATOMIC_READY_BRANCH_ACTIVATION_CONTRACT_MISMATCH';
  END IF;

  IF v_function.proconfig IS NULL
     OR cardinality(v_function.proconfig) IS DISTINCT FROM 2
     OR NOT ('search_path=public, pg_temp' = ANY(v_function.proconfig))
     OR NOT ('row_security=off' = ANY(v_function.proconfig)) THEN
    RAISE EXCEPTION 'ATOMIC_READY_BRANCH_ACTIVATION_RUNTIME_CONFIGURATION_MISMATCH';
  END IF;

  IF has_function_privilege(0, v_function_oid, 'EXECUTE')
     OR has_function_privilege(v_anon_oid, v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(v_authenticated_oid, v_function_oid, 'EXECUTE')
     OR has_function_privilege(v_service_role_oid, v_function_oid, 'EXECUTE')
     OR NOT has_function_privilege(v_owner_oid, v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ATOMIC_READY_BRANCH_ACTIVATION_ACL_MISMATCH';
  END IF;
END
$activation_catalog_assertions$;
COMMIT;
