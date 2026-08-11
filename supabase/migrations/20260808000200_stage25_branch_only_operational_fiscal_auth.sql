-- Stage 2.5: restrict existing operational fiscal contracts to the assigned
-- active Branch user. This migration changes authorization only.
BEGIN;
-- This private classifier is the gate reached by every public checkout
-- wrapper before it delegates to the existing commercial implementation.
CREATE OR REPLACE FUNCTION public.resolve_pos_checkout_document_internal_v1(
  p_actor_user_id uuid,
  p_branch_id uuid,
  p_customer_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $function$
DECLARE
  v_decision jsonb;
  v_tenant_id uuid;
  v_demo_mode text;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id IS DISTINCT FROM auth.uid()
     OR NOT EXISTS (
       SELECT 1
       FROM public.user_profiles p
       JOIN public.branches b ON b.id = p_branch_id
       WHERE p.id = p_actor_user_id
         AND p.is_active = true
         AND p.role = 'branch'
         AND p.tenant_id = b.tenant_id
         AND p.branch_id = b.id
     ) THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'code', 'CHECKOUT_BRANCH_FORBIDDEN'
    );
  END IF;

  v_decision := public.resolve_pos_checkout_document_internal_base_20260803(
    p_actor_user_id, p_branch_id, p_customer_id
  );

  IF v_decision->>'status' IS DISTINCT FROM 'allowed'
     OR v_decision->>'checkoutPath' IS DISTINCT FROM 'demo' THEN
    RETURN v_decision || jsonb_build_object('demoMode', 'not_demo');
  END IF;

  SELECT b.tenant_id INTO v_tenant_id
  FROM public.branches b
  WHERE b.id = p_branch_id;
  v_demo_mode := public.zatca_demo_checkout_mode_internal_v1(v_tenant_id, p_branch_id);

  IF v_demo_mode = 'sandbox_compliance' THEN
    -- The deployed sandbox capability has compliance validation only. Standard
    -- invoice clearance is intentionally blocked until a separately certified
    -- sandbox-clearance capability exists.
    IF v_decision->>'documentType' = 'standard' THEN
      RETURN jsonb_build_object(
        'status', 'blocked',
        'code', 'SANDBOX_STANDARD_CLEARANCE_UNAVAILABLE',
        'demoMode', 'sandbox_compliance'
      );
    END IF;

    RETURN v_decision || jsonb_build_object(
      'checkoutPath', 'sandbox',
      'atomicEligible', false,
      'atomicEligibilityReason', 'sandbox_compliance_validation',
      'readinessStatus', 'sandbox_compliance_active',
      'readinessReason', 'sandbox_compliance_validation_only',
      'productionConnected', false,
      'isDemo', false,
      'nonFiscal', false,
      'demoMode', 'sandbox_compliance'
    );
  END IF;

  RETURN v_decision || jsonb_build_object('demoMode', 'non_fiscal');
END
$function$;
-- Keep the existing evaluator and rollout synchronization intact; only its
-- actor/branch authorization predicates become Branch-only.
CREATE OR REPLACE FUNCTION public.evaluate_zatca_atomic_checkout_eligibility_v2(
  p_branch_id uuid,
  p_client_version text,
  p_edge_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
SET row_security TO off
AS $function$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_expected_schema_version constant integer := 2;
  v_expected_client_version constant text := '2.1.0';
  v_expected_edge_version constant text := '2.1.0';
  v_profile record;
  v_branch record;
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_runtime_found boolean := false;
  v_sync record;
  v_sync_count integer := 0;
  v_reason text;
  v_legacy_reason text;
BEGIN
  -- Deterministic lock order: authenticated actor profile, requested branch,
  -- then the recovered synchronizer's advisory lock and gate-row lock. The
  -- checkout prepare RPC runs in a later network transaction, so its
  -- idempotency/chain locks cannot overlap this order.
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'unauthenticated'
    );
  END IF;

  IF p_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'branch_access_denied'
    );
  END IF;

  SELECT p.id, p.tenant_id, p.branch_id, p.role::text AS role
  INTO v_profile
  FROM public.user_profiles p
  WHERE p.id = v_actor_user_id
    AND p.is_active = true
  FOR UPDATE;

  IF NOT FOUND OR v_profile.role <> 'branch' THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'caller_profile_not_found'
    );
  END IF;

  SELECT b.id, b.tenant_id
  INTO v_branch
  FROM public.branches b
  WHERE b.id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR v_profile.branch_id IS DISTINCT FROM v_branch.id THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'branch_access_denied'
    );
  END IF;

  SELECT *
  INTO v_runtime
  FROM public.zatca_finalization_runtime r
  WHERE r.singleton = true;
  v_runtime_found := FOUND;

  IF p_client_version IS DISTINCT FROM v_expected_client_version
     OR p_edge_version IS DISTINCT FROM v_expected_edge_version THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'reason', 'version_incompatible'
    );
  END IF;

  IF v_runtime_found AND (
    v_runtime.schema_version IS DISTINCT FROM v_expected_schema_version
    OR v_runtime.minimum_client_version IS DISTINCT FROM v_expected_client_version
    OR v_runtime.minimum_edge_version IS DISTINCT FROM v_expected_edge_version
  ) THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'reason', 'version_incompatible'
    );
  END IF;

  -- The locked rows prevent profile reassignment/deactivation and branch
  -- reassignment between authorization and the privileged gate write.
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles p
    JOIN public.branches b ON b.id = p_branch_id
    WHERE p.id = v_actor_user_id
      AND p.is_active = true
      AND p.tenant_id = v_profile.tenant_id
      AND p.role::text = 'branch'
      AND p.branch_id = v_branch.id
      AND b.tenant_id = v_branch.tenant_id
  ) THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_AUTHORIZATION_CHANGED'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_sync IN
    SELECT *
    FROM public.sync_zatca_atomic_checkout_branch_gates_v2(
      p_branch_id,
      v_actor_user_id
    )
  LOOP
    v_sync_count := v_sync_count + 1;
  END LOOP;

  IF v_sync_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_CARDINALITY_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sync.branch_id IS DISTINCT FROM p_branch_id
     OR v_sync.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR v_sync.action NOT IN ('inserted', 'updated', 'unchanged')
     OR v_sync.resulting_gate_state IS NULL
     OR v_sync.readiness_result IS NULL
     OR NULLIF(btrim(v_sync.blocking_reason), '') IS NULL THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_CONTRACT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sync.blocking_reason NOT IN (
    'eligible',
    'inactive_branch',
    'inactive_tenant',
    'tenant_suspended',
    'runtime_missing',
    'immutable_finalization_disabled',
    'simplified_finalization_disabled',
    'atomic_global_disabled',
    'schema_version_incompatible',
    'edge_version_incompatible',
    'client_version_incompatible',
    'explicitly_blocked',
    'readiness_missing',
    'branch_not_ready',
    'missing_chain_head',
    'missing_production_credentials',
    'missing_client_acknowledgement'
  ) THEN
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_REASON_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sync.readiness_result IS TRUE THEN
    IF v_sync.resulting_gate_state IS NOT TRUE
       OR v_sync.blocking_reason <> 'eligible' THEN
      RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_STATE_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_sync.resulting_gate_state IS FALSE THEN
    IF v_sync.blocking_reason = 'eligible' THEN
      RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_STATE_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_sync.resulting_gate_state IS TRUE THEN
    IF v_sync.blocking_reason <> 'missing_client_acknowledgement' THEN
      RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_STATE_INVALID'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    RAISE EXCEPTION 'FINAL_ELIGIBILITY_SYNC_STATE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_sync.readiness_result IS TRUE
     AND v_sync.resulting_gate_state IS TRUE
     AND v_sync.blocking_reason = 'eligible' THEN
    RETURN jsonb_build_object(
      'status', 'eligible',
      'branchId', v_sync.branch_id,
      'blockingReason', NULL,
      'gateSyncAction', v_sync.action
    );
  END IF;

  v_reason := v_sync.blocking_reason;
  v_legacy_reason := CASE
    WHEN v_reason IN (
      'runtime_missing',
      'immutable_finalization_disabled',
      'simplified_finalization_disabled',
      'atomic_global_disabled',
      'schema_version_incompatible',
      'edge_version_incompatible',
      'client_version_incompatible'
    ) THEN 'atomic_rollout_disabled'
    ELSE 'atomic_branch_not_ready'
  END;

  RETURN jsonb_build_object(
    'status', 'legacy_required',
    'branchId', v_sync.branch_id,
    'reason', v_legacy_reason,
    'blockingReason', v_reason,
    'gateSyncAction', v_sync.action
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status', 'dependency_failed',
    'reason', 'final_eligibility_dependency_failed'
  );
END
$function$;
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

  PERFORM 1
  FROM public.user_profiles p
  WHERE p.id = v_user_id
    AND p.is_active = true
    AND p.role = 'branch';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: branch role required' USING ERRCODE = '42501';
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
-- The public base remains available to trusted server callers only; authenticated
-- product users must use the Branch-only wrapper above.
REVOKE EXECUTE ON FUNCTION public.create_partial_credit_note(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_partial_credit_note(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.open_register_session(
  p_branch_id UUID,
  p_opening_cash NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_scope RECORD;
  v_existing RECORD;
  v_session_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_opening_cash, 0) < 0 THEN
    RAISE EXCEPTION 'Opening cash cannot be negative' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(p_branch_id);

  IF v_scope.caller_role <> 'branch' THEN
    RAISE EXCEPTION 'Forbidden: branch role required' USING ERRCODE = '42501';
  END IF;

  IF v_scope.scope_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch is required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = v_scope.scope_tenant_id
      AND (
        COALESCE(t.is_active, TRUE) IS NOT TRUE
        OR t.suspended_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Account is suspended. New register sessions cannot be opened.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, opened_at
    INTO v_existing
  FROM public.pos_sessions
  WHERE tenant_id = v_scope.scope_tenant_id
    AND branch_id = v_scope.scope_branch_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Register is already open for this branch since %', v_existing.opened_at
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.pos_sessions (
    tenant_id,
    branch_id,
    opened_by,
    opening_cash,
    status
  ) VALUES (
    v_scope.scope_tenant_id,
    v_scope.scope_branch_id,
    v_user_id,
    ROUND(COALESCE(p_opening_cash, 0), 2),
    'open'
  )
  RETURNING id INTO v_session_id;

  RETURN public.get_register_session_summary(v_scope.scope_branch_id, v_session_id) -> 'session';
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Register is already open for this branch. Close the existing register before opening a new one.'
      USING ERRCODE = '23505';
END;
$function$;
CREATE OR REPLACE FUNCTION public.close_register_session(
  p_session_id UUID,
  p_actual_cash NUMERIC,
  p_closing_checks JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_scope RECORD;
  v_session RECORD;
  v_cash_total NUMERIC := 0;
  v_card_total NUMERIC := 0;
  v_total_expenses NUMERIC := 0;
  v_cash_expenses NUMERIC := 0;
  v_invoice_count INTEGER := 0;
  v_expected_cash NUMERIC := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Register session is required' USING ERRCODE = '22023';
  END IF;

  IF p_actual_cash IS NULL OR p_actual_cash < 0 THEN
    RAISE EXCEPTION 'Actual cash must be zero or greater' USING ERRCODE = '22023';
  END IF;

  IF p_closing_checks IS NOT NULL AND jsonb_typeof(p_closing_checks) <> 'object' THEN
    RAISE EXCEPTION 'Closing checks must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_session
  FROM public.pos_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Register session not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_scope FROM public.reporting_resolve_scope(v_session.branch_id);

  IF v_scope.caller_role <> 'branch' THEN
    RAISE EXCEPTION 'Forbidden: branch role required' USING ERRCODE = '42501';
  END IF;

  IF v_session.tenant_id IS DISTINCT FROM v_scope.scope_tenant_id
     OR v_session.branch_id IS DISTINCT FROM v_scope.scope_branch_id
  THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'Register session is already closed' USING ERRCODE = '23514';
  END IF;

  WITH inv AS (
    SELECT
      i.id,
      COALESCE(i.payment_method::text, 'other') AS invoice_payment_method,
      CASE WHEN i.zatca_invoice_type::text = 'credit_note' THEN -1 ELSE 1 END AS accounting_sign,
      COALESCE(i.total_amount, 0) AS total_amount
    FROM public.invoices i
    WHERE i.session_id = v_session.id
      AND i.status::text = 'posted'
      AND i.zatca_invoice_type::text IN ('simplified', 'standard', 'credit_note')
  ),
  payment_rows AS (
    SELECT
      COALESCE(p.method::text, inv.invoice_payment_method, 'other') AS method,
      CASE
        WHEN p.id IS NULL THEN inv.accounting_sign * inv.total_amount
        ELSE inv.accounting_sign * ABS(COALESCE(p.amount, 0))
      END AS signed_amount
    FROM inv
    LEFT JOIN public.payments p ON p.invoice_id = inv.id
  ),
  exp AS (
    SELECT
      COALESCE(SUM(COALESCE(e.total_paid, e.amount, 0)), 0) AS total_expenses,
      COALESCE(SUM(CASE WHEN e.payment_method::text = 'cash' THEN COALESCE(e.total_paid, e.amount, 0) ELSE 0 END), 0) AS cash_expenses
    FROM public.expenses e
    WHERE e.session_id = v_session.id
  )
  SELECT
    COALESCE((SELECT COUNT(*)::integer FROM inv), 0),
    COALESCE((SELECT SUM(CASE WHEN method = 'cash' THEN signed_amount ELSE 0 END) FROM payment_rows), 0),
    COALESCE((SELECT SUM(CASE WHEN method = 'card' THEN signed_amount ELSE 0 END) FROM payment_rows), 0),
    COALESCE(exp.total_expenses, 0),
    COALESCE(exp.cash_expenses, 0)
  INTO
    v_invoice_count,
    v_cash_total,
    v_card_total,
    v_total_expenses,
    v_cash_expenses
  FROM exp;

  v_expected_cash := ROUND(COALESCE(v_session.opening_cash, 0) + v_cash_total - v_cash_expenses, 2);

  UPDATE public.pos_sessions
  SET
    closed_by = v_user_id,
    closed_at = NOW(),
    closing_cash_expected = v_expected_cash,
    closing_cash_actual = ROUND(p_actual_cash, 2),
    closing_cash_difference = ROUND(p_actual_cash, 2) - v_expected_cash,
    total_cash_sales = ROUND(v_cash_total, 2),
    total_card_sales = ROUND(v_card_total, 2),
    total_expenses = ROUND(v_total_expenses, 2),
    total_invoices = v_invoice_count,
    closing_checks = COALESCE(p_closing_checks, '{}'::jsonb),
    notes = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    status = 'closed'
  WHERE id = v_session.id;

  RETURN public.get_register_session_summary(v_session.branch_id, v_session.id) -> 'session';
END;
$function$;
-- Branch settings continue through their explicit RPCs. Direct branch-row
-- updates are restricted to the existing owner-governance contract.
DROP POLICY IF EXISTS phase3a_branches_update ON public.branches;
CREATE POLICY phase3a_branches_update
  ON public.branches
  FOR UPDATE TO authenticated
  USING (public.rls_can_manage_tenant(tenant_id))
  WITH CHECK (public.rls_can_manage_tenant(tenant_id));
-- Direct operational session/day-closing table writes must be from the active
-- assigned Branch user. The existing SECURITY DEFINER register RPCs remain the
-- normal write path.
DROP POLICY IF EXISTS phase3a_day_closings_insert ON public.day_closings;
CREATE POLICY phase3a_day_closings_insert
  ON public.day_closings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.rls_current_role_text() = 'branch'
    AND tenant_id = public.rls_current_tenant_id()
    AND branch_id = public.rls_current_branch_id()
  );
DROP POLICY IF EXISTS phase3a_day_closings_update ON public.day_closings;
CREATE POLICY phase3a_day_closings_update
  ON public.day_closings
  FOR UPDATE TO authenticated
  USING (
    public.rls_current_role_text() = 'branch'
    AND tenant_id = public.rls_current_tenant_id()
    AND branch_id = public.rls_current_branch_id()
  )
  WITH CHECK (
    public.rls_current_role_text() = 'branch'
    AND tenant_id = public.rls_current_tenant_id()
    AND branch_id = public.rls_current_branch_id()
  );
DROP POLICY IF EXISTS phase3a_day_closings_delete ON public.day_closings;
CREATE POLICY phase3a_day_closings_delete
  ON public.day_closings
  FOR DELETE TO authenticated
  USING (
    public.rls_current_role_text() = 'branch'
    AND tenant_id = public.rls_current_tenant_id()
    AND branch_id = public.rls_current_branch_id()
  );
DROP POLICY IF EXISTS branch_pos_sessions_insert ON public.pos_sessions;
CREATE POLICY branch_pos_sessions_insert
  ON public.pos_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles p
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND p.role = 'branch'
        AND p.tenant_id = pos_sessions.tenant_id
        AND p.branch_id = pos_sessions.branch_id
    )
  );
DROP POLICY IF EXISTS branch_pos_sessions_select ON public.pos_sessions;
CREATE POLICY branch_pos_sessions_select
  ON public.pos_sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles p
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND p.role = 'branch'
        AND p.tenant_id = pos_sessions.tenant_id
        AND p.branch_id = pos_sessions.branch_id
    )
  );
DROP POLICY IF EXISTS branch_pos_sessions_update ON public.pos_sessions;
CREATE POLICY branch_pos_sessions_update
  ON public.pos_sessions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles p
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND p.role = 'branch'
        AND p.tenant_id = pos_sessions.tenant_id
        AND p.branch_id = pos_sessions.branch_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.user_profiles p
      WHERE p.id = auth.uid()
        AND p.is_active = true
        AND p.role = 'branch'
        AND p.tenant_id = pos_sessions.tenant_id
        AND p.branch_id = pos_sessions.branch_id
    )
  );
COMMIT;
