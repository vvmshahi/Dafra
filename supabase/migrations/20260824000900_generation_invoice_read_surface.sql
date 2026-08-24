-- Generation pending/final state is customer-facing invoice state, not a raw
-- fiscal artifact.  The browser invoice list already uses these fields to
-- distinguish a pending Generation sale from a Generation-issued document.
-- Keep policy snapshots, QR payloads, and all signing/network material denied.

BEGIN;

REVOKE SELECT (fiscal_regime_at_issue, fiscal_lifecycle_state, fiscal_artifact_stage)
  ON TABLE public.invoices
  FROM anon, authenticated;

GRANT SELECT (fiscal_regime_at_issue, fiscal_lifecycle_state, fiscal_artifact_stage)
  ON TABLE public.invoices
  TO authenticated;

COMMIT;
