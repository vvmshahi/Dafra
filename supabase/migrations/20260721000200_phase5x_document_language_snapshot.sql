-- Canonicalized from:
-- supabase/phase5x-document-language-snapshot.sql
-- Phase 5X: issued-document language snapshots
-- Apply manually after Phase 5W. This migration is additive and does not backfill history.
-- Ordinary invoices and credit notes share public.invoices in Kubri. The
-- document_language column therefore applies to both; credit notes are
-- identified by zatca_invoice_type = 'credit_note' and original_invoice_id.
BEGIN;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS document_language TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_document_language_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_document_language_check
      CHECK (document_language IS NULL OR document_language IN ('en', 'ar', 'both'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.invoices.document_language IS
  'Language snapshot for an issued invoice or credit note. NULL preserves legacy branch-setting fallback.';

CREATE OR REPLACE FUNCTION public.snapshot_invoice_document_language()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_language TEXT;
  v_original_language TEXT;
BEGIN
  IF NEW.document_language IS NOT NULL
     AND NEW.document_language NOT IN ('en', 'ar', 'both') THEN
    RAISE EXCEPTION 'Invalid invoice document language' USING ERRCODE = '22023';
  END IF;

  IF NEW.document_language IS NOT NULL AND NEW.zatca_invoice_type IS DISTINCT FROM 'credit_note' THEN
    RETURN NEW;
  END IF;

  SELECT invoice_language INTO v_branch_language
  FROM public.branches
  WHERE id = NEW.branch_id
    AND tenant_id = NEW.tenant_id
    AND is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice branch does not match tenant or is inactive' USING ERRCODE = '23503';
  END IF;

  IF NEW.zatca_invoice_type = 'credit_note' AND NEW.original_invoice_id IS NOT NULL THEN
    SELECT document_language INTO v_original_language
    FROM public.invoices
    WHERE id = NEW.original_invoice_id
      AND tenant_id = NEW.tenant_id
      AND branch_id = NEW.branch_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Credit-note original invoice does not match tenant and branch' USING ERRCODE = '23503';
    END IF;
  END IF;

  -- This read occurs inside the inserting transaction. The branch setting is
  -- snapshotted at trigger execution; later branch changes cannot alter it.
  NEW.document_language := COALESCE(v_original_language, v_branch_language, 'both');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_snapshot_document_language ON public.invoices;
CREATE TRIGGER invoices_snapshot_document_language
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.snapshot_invoice_document_language();

-- Replace the existing narrow settings RPC so all invoice settings, including
-- invoice_language, commit or roll back together in one database transaction.
CREATE OR REPLACE FUNCTION public.update_branch_invoice_settings(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_profile RECORD;
  v_branch RECORD;
  v_branch_id UUID;
  v_invoice_language TEXT;
  v_display_name TEXT;
  v_phone TEXT;
  v_logo_url TEXT;
  v_website TEXT;
  v_email TEXT;
  v_receipt_footer TEXT;
  v_print_mode TEXT;
  v_show_logo BOOLEAN;
  v_show_website BOOLEAN;
  v_show_email BOOLEAN;
  v_show_footer BOOLEAN;
  v_show_cash_change BOOLEAN;
  v_updated_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid invoice settings payload' USING ERRCODE = '22023';
  END IF;

  v_branch_id := NULLIF(TRIM(COALESCE(p_payload ->> 'branch_id', '')), '')::UUID;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Missing branch_id' USING ERRCODE = '22023';
  END IF;

  -- Explicit NULL/missing validation is intentional: SQL NULL NOT IN (...) is
  -- not TRUE and must not be relied upon for validation.
  v_invoice_language := p_payload ->> 'invoice_language';
  IF v_invoice_language IS NULL OR v_invoice_language NOT IN ('en', 'ar', 'both') THEN
    RAISE EXCEPTION 'Invalid invoice_language' USING ERRCODE = '22023';
  END IF;

  SELECT id, role::TEXT AS role, tenant_id, branch_id, is_active INTO v_profile
  FROM public.user_profiles WHERE id = v_user_id;
  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Caller profile not found or inactive' USING ERRCODE = '42501';
  END IF;

  SELECT id, tenant_id, branch_code, is_active INTO v_branch
  FROM public.branches WHERE id = v_branch_id FOR UPDATE;
  IF NOT FOUND OR v_branch.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Branch not found or inactive' USING ERRCODE = '42501';
  END IF;

  IF v_profile.role = 'owner' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF v_profile.role = 'branch' THEN
    IF v_profile.tenant_id IS DISTINCT FROM v_branch.tenant_id
       OR v_profile.branch_id IS DISTINCT FROM v_branch.id THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  v_display_name := NULLIF(TRIM(COALESCE(p_payload ->> 'display_name', '')), '');
  v_phone := NULLIF(TRIM(COALESCE(p_payload ->> 'phone', '')), '');
  v_logo_url := NULLIF(TRIM(COALESCE(p_payload ->> 'logo_url', '')), '');
  v_website := NULLIF(TRIM(COALESCE(p_payload ->> 'website', '')), '');
  v_email := NULLIF(TRIM(COALESCE(p_payload ->> 'email', '')), '');
  v_receipt_footer := NULLIF(TRIM(COALESCE(p_payload ->> 'receipt_footer', '')), '');
  v_print_mode := COALESCE(NULLIF(TRIM(COALESCE(p_payload ->> 'print_mode', '')), ''), 'thermal');
  v_show_logo := COALESCE((p_payload ->> 'show_logo')::BOOLEAN, TRUE);
  v_show_website := COALESCE((p_payload ->> 'show_website')::BOOLEAN, FALSE);
  v_show_email := COALESCE((p_payload ->> 'show_email')::BOOLEAN, FALSE);
  v_show_footer := COALESCE((p_payload ->> 'show_footer')::BOOLEAN, TRUE);
  v_show_cash_change := COALESCE((p_payload ->> 'show_cash_change')::BOOLEAN, TRUE);

  IF v_print_mode NOT IN ('thermal', 'pdf', 'both') THEN RAISE EXCEPTION 'Invalid print_mode' USING ERRCODE = '22023'; END IF;
  IF v_display_name IS NOT NULL AND length(v_display_name) > 160 THEN RAISE EXCEPTION 'Display name is too long' USING ERRCODE = '22023'; END IF;
  IF v_phone IS NOT NULL AND length(v_phone) > 50 THEN RAISE EXCEPTION 'Phone is too long' USING ERRCODE = '22023'; END IF;
  IF v_logo_url IS NOT NULL AND length(v_logo_url) > 1000 THEN RAISE EXCEPTION 'Logo URL is too long' USING ERRCODE = '22023'; END IF;
  IF v_website IS NOT NULL AND length(v_website) > 255 THEN RAISE EXCEPTION 'Website is too long' USING ERRCODE = '22023'; END IF;
  IF v_email IS NOT NULL AND length(v_email) > 255 THEN RAISE EXCEPTION 'Email is too long' USING ERRCODE = '22023'; END IF;
  IF v_receipt_footer IS NOT NULL AND length(v_receipt_footer) > 500 THEN RAISE EXCEPTION 'Receipt footer is too long' USING ERRCODE = '22023'; END IF;

  UPDATE public.branches SET
    invoice_language = v_invoice_language,
    display_name = v_display_name,
    phone = v_phone,
    show_logo = v_show_logo,
    logo_url = v_logo_url,
    website = v_website,
    email = v_email,
    show_website = v_show_website,
    show_email = v_show_email,
    receipt_footer = v_receipt_footer,
    show_footer = v_show_footer,
    show_cash_change = v_show_cash_change,
    print_mode = v_print_mode,
    updated_at = v_updated_at
  WHERE id = v_branch.id;

  IF to_regprocedure('public.record_audit_event(text, uuid, uuid, uuid, text, text, uuid, text, text, jsonb, text, text)') IS NOT NULL THEN
    PERFORM public.record_audit_event(
      'branch_invoice_settings_updated', v_branch.tenant_id, v_branch.id,
      v_user_id, v_profile.role, 'branch', v_branch.id, 'info', 'succeeded',
      jsonb_build_object(
        'branch_code', v_branch.branch_code,
        'invoice_language', v_invoice_language,
        'print_mode', v_print_mode,
        'show_logo', v_show_logo,
        'show_website', v_show_website,
        'show_email', v_show_email,
        'show_footer', v_show_footer,
        'show_cash_change', v_show_cash_change,
        'has_logo_url', v_logo_url IS NOT NULL,
        'has_receipt_footer', v_receipt_footer IS NOT NULL
      ), NULL, NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE, 'branch_id', v_branch.id,
    'invoice_language', v_invoice_language, 'updated_at', v_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_branch_invoice_settings(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_branch_invoice_settings(JSONB) TO authenticated;
COMMENT ON FUNCTION public.update_branch_invoice_settings(JSONB) IS
  'Atomically updates authorized branch invoice/receipt settings, including invoice_language.';

-- Remove the superseded two-call companion if an earlier development copy of
-- Phase 5X created it. Normal saves use update_branch_invoice_settings only.
DROP FUNCTION IF EXISTS public.update_branch_invoice_document_language(UUID, TEXT);

-- Preserve the installed checkout implementation byte-for-byte except for the
-- response projection. Both a fresh checkout and an idempotent replay return
-- the document_language persisted on public.invoices by the BEFORE INSERT
-- trigger. The guarded rewrite deliberately fails if the expected active Phase
-- 5C-2 shape is not installed, rather than replacing unknown business logic.
DO $phase5x_checkout_patch$
DECLARE
  v_definition TEXT;
  v_replay_select TEXT := 'payment_method, zatca_invoice_type, payment_status';
  v_replay_select_with_language TEXT := 'payment_method, zatca_invoice_type, payment_status, document_language';
  v_replay_json TEXT := '''invoice_number'', v_existing.invoice_number,';
  v_replay_json_with_language TEXT := '''invoice_number'', v_existing.invoice_number,' || E'\n      ' || '''document_language'', v_existing.document_language,';
  v_fresh_json TEXT := '''invoice_number'', v_invoice_number,';
  v_fresh_json_with_language TEXT := '''invoice_number'', v_invoice_number,' || E'\n    ' || '''document_language'', (SELECT document_language FROM public.invoices WHERE id = v_invoice_id),';
BEGIN
  SELECT pg_get_functiondef('public.pos_checkout(jsonb)'::regprocedure) INTO v_definition;

  IF position('''document_language''' IN v_definition) = 0 THEN
    IF position(v_replay_select IN v_definition) = 0
       OR position(v_replay_json IN v_definition) = 0
       OR position(v_fresh_json IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Phase 5X expected checkout return anchors were not found; inspect the active pos_checkout before applying';
    END IF;

    v_definition := replace(v_definition, v_replay_select, v_replay_select_with_language);
    v_definition := replace(v_definition, v_replay_json, v_replay_json_with_language);
    v_definition := replace(v_definition, v_fresh_json, v_fresh_json_with_language);
    EXECUTE v_definition;
  END IF;
END;
$phase5x_checkout_patch$;

REVOKE ALL ON FUNCTION public.pos_checkout(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_checkout(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- ============================================================
-- Historical behavior and locking notes
-- ============================================================
-- Existing invoices remain NULL and are intentionally not backfilled. Rendering
-- those rows follows the current branch.invoice_language. Rows inserted after
-- this migration retain their issue-time snapshot.
--
-- ADD COLUMN takes the normal PostgreSQL ALTER TABLE lock but has no DEFAULT and
-- rewrites no rows. The guarded constraint addition scans existing rows only on
-- first application. Function replacement and trigger recreation take brief
-- catalog/table locks. Schedule the migration in the normal maintenance window.
--
-- ============================================================
-- Manual rollback (documentation only; do not run automatically)
-- ============================================================
-- 1. DROP TRIGGER IF EXISTS invoices_snapshot_document_language ON public.invoices;
-- 2. Restore public.pos_checkout(JSONB) and
--    public.update_branch_invoice_settings(JSONB) from their immediately prior
--    approved migration definitions (Phase 5C-2 and Phase 3C respectively).
-- 3. DROP FUNCTION IF EXISTS public.snapshot_invoice_document_language();
-- 4. DROP FUNCTION IF EXISTS public.update_branch_invoice_document_language(UUID, TEXT);
-- 5. ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_document_language_check;
-- 6. Only with explicit data-loss approval:
--      ALTER TABLE public.invoices DROP COLUMN IF EXISTS document_language;
--
-- WARNING: dropping document_language after invoices or credit notes have been
-- issued permanently loses their stored language snapshots.
