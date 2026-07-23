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
    'retryAvailable', v_invoice.zatca_lifecycle_state IN (
      'not_started', 'finalization_failed', 'reporting_failed', 'clearance_failed', 'retrying'
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
