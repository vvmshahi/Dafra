-- Stage B1: fiscal-policy foundation and immutable document metadata.
-- Source-only in B1. Do not apply to Production without the migration gate.

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS fiscal_regime text,
  ADD COLUMN IF NOT EXISTS integration_environment text,
  ADD COLUMN IF NOT EXISTS fiscal_policy_revision bigint,
  ADD COLUMN IF NOT EXISTS fiscal_activation_state text,
  ADD COLUMN IF NOT EXISTS fiscal_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS fiscal_activated_by uuid REFERENCES auth.users(id);

-- Existing branches are Phase 2 businesses. Their legacy environment is
-- preserved; no existing branch may become Generation by adding this schema.
UPDATE public.branches
SET fiscal_regime = 'integration',
    integration_environment = CASE
      WHEN zatca_environment IN ('sandbox', 'production') THEN zatca_environment
      ELSE 'production'
    END,
    fiscal_policy_revision = COALESCE(fiscal_policy_revision, 1),
    fiscal_activation_state = COALESCE(fiscal_activation_state, 'integration_active')
WHERE fiscal_regime IS NULL
   OR integration_environment IS NULL
   OR fiscal_policy_revision IS NULL
   OR fiscal_activation_state IS NULL;

ALTER TABLE public.branches
  ALTER COLUMN fiscal_regime SET DEFAULT 'integration',
  ALTER COLUMN integration_environment SET DEFAULT 'production',
  ALTER COLUMN fiscal_policy_revision SET DEFAULT 1,
  ALTER COLUMN fiscal_activation_state SET DEFAULT 'integration_active',
  ALTER COLUMN fiscal_regime SET NOT NULL,
  ALTER COLUMN integration_environment SET NOT NULL,
  ALTER COLUMN fiscal_policy_revision SET NOT NULL,
  ALTER COLUMN fiscal_activation_state SET NOT NULL;

ALTER TABLE public.branches
  DROP CONSTRAINT IF EXISTS branches_fiscal_regime_check,
  DROP CONSTRAINT IF EXISTS branches_integration_environment_check,
  DROP CONSTRAINT IF EXISTS branches_fiscal_policy_revision_check,
  DROP CONSTRAINT IF EXISTS branches_fiscal_activation_state_check,
  ADD CONSTRAINT branches_fiscal_regime_check
    CHECK (fiscal_regime IN ('generation', 'integration')),
  ADD CONSTRAINT branches_integration_environment_check
    CHECK (integration_environment IN ('sandbox', 'production')),
  ADD CONSTRAINT branches_fiscal_policy_revision_check
    CHECK (fiscal_policy_revision > 0),
  ADD CONSTRAINT branches_fiscal_activation_state_check
    CHECK (fiscal_activation_state IN ('generation_active', 'integration_setup', 'integration_active'));

CREATE INDEX IF NOT EXISTS idx_branches_fiscal_policy
  ON public.branches (tenant_id, fiscal_regime, integration_environment, fiscal_policy_revision);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS fiscal_regime_at_issue text,
  ADD COLUMN IF NOT EXISTS fiscal_policy_revision_at_issue bigint,
  ADD COLUMN IF NOT EXISTS fiscal_policy_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS fiscal_lifecycle_state text,
  ADD COLUMN IF NOT EXISTS fiscal_artifact_stage text,
  ADD COLUMN IF NOT EXISTS fiscal_qr_payload text,
  ADD COLUMN IF NOT EXISTS fiscal_issued_at timestamptz;

-- Metadata-only compatibility backfill. No XML, QR, signature, UUID, ICV,
-- PIH, status history, or Phase 2 artifact is rewritten.
UPDATE public.invoices i
SET fiscal_regime_at_issue = COALESCE(i.fiscal_regime_at_issue, 'integration'),
    fiscal_policy_revision_at_issue = COALESCE(i.fiscal_policy_revision_at_issue, b.fiscal_policy_revision, 1),
    fiscal_policy_snapshot = COALESCE(i.fiscal_policy_snapshot, jsonb_build_object(
      'regime', 'integration',
      'integrationEnvironment', CASE WHEN b.zatca_environment = 'sandbox' THEN 'sandbox' ELSE 'production' END,
      'legacyPhase', COALESCE(b.zatca_phase, 2),
      'backfilled', true
    )),
    fiscal_lifecycle_state = COALESCE(i.fiscal_lifecycle_state, CASE
      WHEN i.zatca_status = 'reported' THEN 'reported'
      WHEN i.zatca_status = 'cleared' THEN 'cleared'
      WHEN i.zatca_status = 'failed' THEN 'failed'
      WHEN i.status = 'posted' THEN 'not_submitted'
      ELSE 'not_submitted'
    END),
    fiscal_artifact_stage = COALESCE(i.fiscal_artifact_stage, CASE
      WHEN i.zatca_status IN ('reported', 'cleared') THEN 'integration_final'
      ELSE 'none'
    END),
    fiscal_issued_at = COALESCE(i.fiscal_issued_at, CASE WHEN i.status = 'posted' THEN i.created_at END)
FROM public.branches b
WHERE b.id = i.branch_id
  AND (i.fiscal_regime_at_issue IS NULL
    OR i.fiscal_policy_revision_at_issue IS NULL
    OR i.fiscal_policy_snapshot IS NULL
    OR i.fiscal_lifecycle_state IS NULL
    OR i.fiscal_artifact_stage IS NULL
    OR (i.status = 'posted' AND i.fiscal_issued_at IS NULL));

ALTER TABLE public.invoices
  ALTER COLUMN fiscal_regime_at_issue SET DEFAULT 'integration',
  ALTER COLUMN fiscal_policy_revision_at_issue SET DEFAULT 1,
  ALTER COLUMN fiscal_policy_snapshot SET DEFAULT '{}'::jsonb,
  ALTER COLUMN fiscal_lifecycle_state SET DEFAULT 'not_submitted',
  ALTER COLUMN fiscal_artifact_stage SET DEFAULT 'none',
  ALTER COLUMN fiscal_regime_at_issue SET NOT NULL,
  ALTER COLUMN fiscal_policy_revision_at_issue SET NOT NULL,
  ALTER COLUMN fiscal_policy_snapshot SET NOT NULL,
  ALTER COLUMN fiscal_lifecycle_state SET NOT NULL,
  ALTER COLUMN fiscal_artifact_stage SET NOT NULL;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_fiscal_regime_at_issue_check,
  DROP CONSTRAINT IF EXISTS invoices_fiscal_policy_revision_at_issue_check,
  DROP CONSTRAINT IF EXISTS invoices_fiscal_lifecycle_state_check,
  DROP CONSTRAINT IF EXISTS invoices_fiscal_artifact_stage_check,
  ADD CONSTRAINT invoices_fiscal_regime_at_issue_check
    CHECK (fiscal_regime_at_issue IN ('generation', 'integration')),
  ADD CONSTRAINT invoices_fiscal_policy_revision_at_issue_check
    CHECK (fiscal_policy_revision_at_issue > 0),
  ADD CONSTRAINT invoices_fiscal_lifecycle_state_check
    CHECK (fiscal_lifecycle_state IN (
      'generation_issued', 'generation_failed',
      'not_submitted', 'pending', 'reported', 'cleared', 'failed'
    )),
  ADD CONSTRAINT invoices_fiscal_artifact_stage_check
    CHECK (fiscal_artifact_stage IN ('none', 'generation_final', 'integration_final'));

CREATE INDEX IF NOT EXISTS idx_invoices_fiscal_issue
  ON public.invoices (tenant_id, branch_id, fiscal_regime_at_issue, fiscal_lifecycle_state);

CREATE OR REPLACE FUNCTION public.prevent_fiscal_issue_metadata_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'posted' OR OLD.fiscal_issued_at IS NOT NULL THEN
    IF NEW.fiscal_regime_at_issue IS DISTINCT FROM OLD.fiscal_regime_at_issue
       OR NEW.fiscal_policy_revision_at_issue IS DISTINCT FROM OLD.fiscal_policy_revision_at_issue
       OR NEW.fiscal_policy_snapshot IS DISTINCT FROM OLD.fiscal_policy_snapshot
       OR NEW.fiscal_qr_payload IS DISTINCT FROM OLD.fiscal_qr_payload
       OR NEW.fiscal_issued_at IS DISTINCT FROM OLD.fiscal_issued_at THEN
      RAISE EXCEPTION 'Fiscal issue metadata is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_fiscal_issue_metadata_immutable ON public.invoices;
CREATE TRIGGER trg_invoices_fiscal_issue_metadata_immutable
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.prevent_fiscal_issue_metadata_mutation();

CREATE OR REPLACE FUNCTION public.resolve_fiscal_policy(p_branch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_profile record;
  v_branch record;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'FISCAL_POLICY_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, role::text AS role, branch_id, is_active
    INTO v_profile
  FROM public.user_profiles
  WHERE id = v_actor;

  SELECT b.id, b.tenant_id, b.fiscal_regime, b.integration_environment,
         b.fiscal_policy_revision, b.fiscal_activation_state,
         b.fiscal_activated_at, b.fiscal_activated_by
    INTO v_branch
  FROM public.branches b
  WHERE b.id = p_branch_id AND b.is_active IS TRUE;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE
     OR v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
     OR NOT (
       v_profile.role = 'super_admin'
       OR (v_profile.role IN ('owner') AND v_profile.branch_id IS NULL)
       OR (v_profile.branch_id = p_branch_id)
     ) THEN
    RAISE EXCEPTION 'BRANCH_ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;

  IF v_branch.fiscal_regime = 'integration'
     AND v_branch.integration_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'FISCAL_POLICY_INVALID' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'branchId', v_branch.id,
    'tenantId', v_branch.tenant_id,
    'regime', v_branch.fiscal_regime,
    'integrationEnvironment', CASE WHEN v_branch.fiscal_regime = 'integration' THEN v_branch.integration_environment ELSE NULL END,
    'policyRevision', v_branch.fiscal_policy_revision,
    'activationState', v_branch.fiscal_activation_state,
    'effectiveAt', v_branch.fiscal_activated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_fiscal_policy(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_fiscal_policy(uuid) TO authenticated;

COMMENT ON FUNCTION public.resolve_fiscal_policy(uuid) IS
'B1 authoritative branch-scoped fiscal policy projection. Client mode/environment inputs are not accepted.';

REVOKE ALL ON FUNCTION public.prevent_fiscal_issue_metadata_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_fiscal_issue_metadata_mutation() TO service_role;
