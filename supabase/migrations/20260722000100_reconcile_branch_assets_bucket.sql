-- Phase 5B: additive reconciliation for existing hosted environments.
-- Do not replay the canonical baseline migration on a populated database.
-- This migration preserves every existing object and invoice snapshot.

BEGIN;

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('branch-assets','branch-assets',TRUE,2097152,ARRAY['image/jpeg','image/png','image/webp']::TEXT[])
ON CONFLICT (id) DO UPDATE
SET public=EXCLUDED.public,
    file_size_limit=EXCLUDED.file_size_limit,
    allowed_mime_types=EXCLUDED.allowed_mime_types;

-- A public bucket is deliberately retained for logo retrieval on issued documents.
-- Remove only policies that govern this bucket, then recreate the one immutable
-- versioned-insert policy. No unrelated Storage bucket or object is changed.
DO $$
DECLARE p RECORD;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  FOR p IN SELECT policyname FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND (COALESCE(qual,'') ILIKE '%branch-assets%' OR COALESCE(with_check,'') ILIKE '%branch-assets%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects',p.policyname);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_invoice_branding_asset_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF OLD.bucket_id='branch-assets' AND OLD.name LIKE 'invoice-branding/%' THEN
    RAISE EXCEPTION 'Versioned invoice-branding assets are immutable' USING ERRCODE='42501';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END; $$;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  DROP TRIGGER IF EXISTS storage_invoice_branding_immutable ON storage.objects;
  CREATE TRIGGER storage_invoice_branding_immutable
    BEFORE UPDATE OR DELETE ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION public.prevent_invoice_branding_asset_mutation();
  CREATE POLICY phase5b_invoice_branding_insert ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (
      bucket_id='branch-assets'
      AND (storage.foldername(name))[1]='invoice-branding'
      AND (storage.foldername(name))[2]=public.get_my_tenant_id()::TEXT
      AND ((public.get_my_role()::TEXT='owner') OR ((storage.foldername(name))[3]=public.get_my_branch_id()::TEXT))
      AND name ~ '^invoice-branding/[0-9a-f-]{36}/[0-9a-f-]{36}/[1-9][0-9]*/logo\.(png|jpg|jpeg|webp)$'
    );
END $$;

COMMIT;
