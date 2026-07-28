-- Authenticated atomic simplified checkout preflight v2.
-- Additive and disabled at the Edge layer. This function does not prepare,
-- sign, store, commit, report, print, or otherwise create an invoice.

BEGIN;

CREATE OR REPLACE FUNCTION public.preflight_zatca_atomic_checkout_v2(
  p_branch_id uuid,
  p_document_type text,
  p_idempotency_key text,
  p_cart_fingerprint text,
  p_client_version text,
  p_edge_version text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_profile public.user_profiles%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_runtime public.zatca_finalization_runtime%ROWTYPE;
  v_intent public.zatca_atomic_checkout_intents_v2%ROWTYPE;
  v_readiness jsonb;
  v_acknowledgement jsonb;
  v_legacy_invoice_id uuid;
  v_idempotency_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_cart_fingerprint text := lower(NULLIF(btrim(COALESCE(p_cart_fingerprint, '')), ''));
  v_expected_schema_version constant integer := 2;
  v_expected_client_version constant text := '2.1.0';
  v_expected_edge_version constant text := '2.1.0';
BEGIN
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'unauthenticated'
    );
  END IF;

  IF p_branch_id IS NULL
     OR p_document_type IS NULL
     OR p_document_type NOT IN ('invoice', 'credit_note')
     OR v_idempotency_key IS NULL
     OR length(v_idempotency_key) NOT BETWEEN 8 AND 120
     OR v_cart_fingerprint IS NULL
     OR v_cart_fingerprint !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object(
      'status', 'conflict',
      'code', 'INVALID_ATOMIC_CHECKOUT_REQUEST'
    );
  END IF;

  SELECT *
  INTO v_profile
  FROM public.user_profiles
  WHERE id = v_actor_user_id
    AND is_active = true;

  IF NOT FOUND OR v_profile.role::text NOT IN ('owner', 'admin', 'branch') THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'caller_profile_not_found'
    );
  END IF;

  SELECT *
  INTO v_branch
  FROM public.branches
  WHERE id = p_branch_id;

  IF NOT FOUND
     OR v_profile.tenant_id IS NULL
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR (
       v_profile.role::text = 'branch'
       AND v_profile.branch_id IS DISTINCT FROM v_branch.id
     ) THEN
    RETURN jsonb_build_object(
      'status', 'authorization_failed',
      'reason', 'branch_access_denied'
    );
  END IF;

  SELECT *
  INTO v_runtime
  FROM public.zatca_finalization_runtime
  WHERE singleton = true;

  IF NOT FOUND
     OR v_runtime.schema_version IS DISTINCT FROM v_expected_schema_version
     OR v_runtime.minimum_client_version IS DISTINCT FROM v_expected_client_version
     OR v_runtime.minimum_edge_version IS DISTINCT FROM v_expected_edge_version
     OR p_client_version IS DISTINCT FROM v_expected_client_version
     OR p_edge_version IS DISTINCT FROM v_expected_edge_version THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'code', 'ATOMIC_SIMPLIFIED_CHECKOUT_UNAVAILABLE'
    );
  END IF;

  SELECT *
  INTO v_intent
  FROM public.zatca_atomic_checkout_intents_v2
  WHERE actor_user_id = v_actor_user_id
    AND branch_id = v_branch.id
    AND idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_intent.cart_fingerprint IS DISTINCT FROM v_cart_fingerprint
       OR v_intent.document_type IS DISTINCT FROM p_document_type THEN
      RETURN jsonb_build_object(
        'status', 'conflict',
        'code', 'ATOMIC_CHECKOUT_IDEMPOTENCY_CONFLICT'
      );
    END IF;
    IF v_intent.state = 'committed' AND v_intent.receipt_payload IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', 'committed',
        'invoiceId', v_intent.invoice_id,
        'actorUserId', v_actor_user_id,
        'tenantId', v_branch.tenant_id,
        'branchId', v_branch.id,
        'actorRole', v_profile.role::text,
        'idempotentReplay', true
      );
    END IF;
    RETURN jsonb_build_object(
      'status', 'conflict',
      'code', 'ATOMIC_CHECKOUT_IDEMPOTENCY_IN_PROGRESS'
    );
  END IF;

  BEGIN
    IF p_document_type = 'credit_note' THEN
      SELECT id
      INTO v_legacy_invoice_id
      FROM public.invoices
      WHERE tenant_id = v_branch.tenant_id
        AND branch_id = v_branch.id
        AND credit_note_idempotency_key = v_idempotency_key;
    ELSE
      SELECT id
      INTO v_legacy_invoice_id
      FROM public.invoices
      WHERE tenant_id = v_branch.tenant_id
        AND branch_id = v_branch.id
        AND checkout_idempotency_key = v_idempotency_key;
    END IF;
  EXCEPTION
    WHEN TOO_MANY_ROWS OR UNDEFINED_COLUMN OR UNDEFINED_TABLE THEN
      RETURN jsonb_build_object(
        'status', 'conflict',
        'code', 'ATOMIC_CHECKOUT_IDEMPOTENCY_LOOKUP_FAILED'
      );
  END;

  IF v_legacy_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'reason', 'existing_legacy_idempotency'
    );
  END IF;

  IF NOT COALESCE(v_runtime.immutable_finalization_enabled, false)
     OR NOT COALESCE(v_runtime.simplified_enabled, false)
     OR NOT COALESCE(v_runtime.atomic_simplified_checkout_enabled, false) THEN
    RETURN jsonb_build_object(
      'status', 'unavailable',
      'reason', 'atomic_rollout_disabled',
      'blockingReason',
        CASE
          WHEN NOT COALESCE(v_runtime.atomic_simplified_checkout_enabled, false)
            THEN 'atomic_global_disabled'
          ELSE 'atomic_rollout_disabled'
        END
    );
  END IF;

  v_readiness := public.get_zatca_branch_readiness_v2(
    v_branch.id,
    v_actor_user_id
  );

  IF COALESCE((v_readiness->>'structurallyReady')::boolean, false)
     AND NOT COALESCE((v_readiness->>'clientAcknowledged')::boolean, false) THEN
    v_acknowledgement := public.acknowledge_zatca_client_capability_v2(
      v_actor_user_id,
      v_branch.id,
      p_client_version,
      p_edge_version,
      300
    );
    IF COALESCE((v_acknowledgement->>'acknowledged')::boolean, false) THEN
      v_readiness := public.get_zatca_branch_readiness_v2(
        v_branch.id,
        v_actor_user_id
      );
    END IF;
  END IF;

  -- Partial preflight stops here. Edge must still enforce its environment kill switch,
  -- run eligibility synchronization, reload rollout/readiness, consume the
  -- existing rate limit, and write the attempt audit before prepare. This RPC
  -- never returns "proceed" and therefore cannot authorize checkout alone.
  RETURN jsonb_build_object(
    'status', 'preflight_ok',
    'actorUserId', v_actor_user_id,
    'tenantId', v_branch.tenant_id,
    'branchId', v_branch.id,
    'actorRole', v_profile.role::text
  );
EXCEPTION WHEN OTHERS THEN
  -- Never expose database exception text or details through this public RPC.
  RETURN jsonb_build_object(
    'status', 'dependency_failed',
    'code', 'ATOMIC_CHECKOUT_PREFLIGHT_FAILED'
  );
END
$function$;

REVOKE ALL ON FUNCTION public.preflight_zatca_atomic_checkout_v2(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.preflight_zatca_atomic_checkout_v2(
  uuid, text, text, text, text, text
) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.preflight_zatca_atomic_checkout_v2(
  uuid, text, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.preflight_zatca_atomic_checkout_v2(
  uuid, text, text, text, text, text
) IS
  'Authenticated, additive atomic checkout preflight. Disabled at the Edge layer; performs no invoice preparation, signing, storage, commit, reporting, or printing.';

COMMIT;
