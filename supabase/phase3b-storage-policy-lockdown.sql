-- ============================================================
-- Phase 3B Supabase Storage policy lockdown
-- Apply manually in Supabase SQL editor after Phase 3A.
-- ============================================================
--
-- Goals:
--   - Replace broad bucket-wide authenticated storage policies.
--   - Preserve current product image and branch logo display.
--   - Keep expense receipts and purchase bills private.
--   - Scope upload/update/delete by tenant and branch where the object path
--     contains tenant_id/branch_id.
--   - Keep compatibility with existing production paths that only contain
--     tenant_id or branch_id, then document the safer canonical path model.
--
-- Important:
--   - Do not run automatically from CI.
--   - Do not delete existing files.
--   - Do not call ZATCA.
--   - This patch does not modify ZATCA XML/signing/hash/QR/canonicalization.
--   - This patch does not change onboarding, OTPs, or credentials.
--
-- Buckets covered:
--   product-images    public read, tenant-scoped writes
--   branch-assets     public read for invoice/logo compatibility, branch-scoped writes
--   expense-receipts  private, tenant/branch-scoped reads and writes
--   purchases-bills   private, tenant/branch-scoped reads and writes
--   invoice-pdfs      optional/future private bucket, branch-scoped reads and writes
--
-- Canonical path model for new uploads:
--   product-images/{tenant_id}/{branch_id}/products/{object_id}.{ext}
--   branch-assets/{tenant_id}/{branch_id}/logo.{ext}
--   expense-receipts/{tenant_id}/{branch_id}/expenses/{object_id}.{ext}
--   purchases-bills/{tenant_id}/{branch_id}/purchases/{object_id}.{ext}
--   invoice-pdfs/{tenant_id}/{branch_id}/invoices/{invoice_id}.pdf
--
-- Compatibility paths currently found in the frontend:
--   product-images/{tenant_id}/{timestamp}.{ext}
--   branch-assets/{tenant_id}/{branch_id}/logo.{ext}
--   branch-assets/{branch_id}/logo.{ext}
--   expense-receipts/{tenant_id}/{timestamp}.{ext}
--   purchases-bills/{tenant_id}/{timestamp}.{ext}
--
-- The tenant-root compatibility paths keep current flows working but cannot
-- provide storage-only branch isolation. Phase 3B should be followed by a
-- frontend migration to canonical tenant/branch paths for private files and
-- by storing object paths instead of long-lived signed URLs.

BEGIN;

-- ============================================================
-- Helper functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.storage_path_segment(p_name TEXT, p_position INT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(split_part(COALESCE(p_name, ''), '/', p_position), '')
$$;

CREATE OR REPLACE FUNCTION public.storage_path_uuid_segment(p_name TEXT, p_position INT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_segment TEXT;
BEGIN
  v_segment := public.storage_path_segment(p_name, p_position);

  IF v_segment IS NULL
     OR v_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN
    RETURN NULL;
  END IF;

  RETURN v_segment::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.storage_name_has_extension(
  p_name TEXT,
  p_extensions TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(p_extensions) AS ext
    WHERE lower(COALESCE(p_name, '')) LIKE '%.' || lower(ext)
  )
$$;

CREATE OR REPLACE FUNCTION public.storage_branch_exists(
  p_tenant_id UUID,
  p_branch_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.tenant_id = p_tenant_id
  )
$$;

CREATE OR REPLACE FUNCTION public.storage_can_access_scoped_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT
      public.storage_path_uuid_segment(p_name, 1) AS tenant_id,
      public.storage_path_uuid_segment(p_name, 2) AS branch_id
  )
  SELECT COALESCE(
    CASE
      WHEN tenant_id IS NULL THEN FALSE
      WHEN branch_id IS NOT NULL
           AND public.storage_branch_exists(tenant_id, branch_id)
        THEN public.rls_can_access_branch(tenant_id, branch_id)
      ELSE public.rls_can_access_tenant(tenant_id)
    END,
    FALSE
  )
  FROM ids
$$;

CREATE OR REPLACE FUNCTION public.storage_can_write_scoped_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT
      public.storage_path_uuid_segment(p_name, 1) AS tenant_id,
      public.storage_path_uuid_segment(p_name, 2) AS branch_id
  )
  SELECT COALESCE(
    CASE
      WHEN tenant_id IS NULL THEN FALSE
      WHEN branch_id IS NOT NULL
           AND public.storage_branch_exists(tenant_id, branch_id)
        THEN public.rls_can_write_branch(tenant_id, branch_id)
      ELSE public.rls_can_access_tenant(tenant_id)
    END,
    FALSE
  )
  FROM ids
$$;

CREATE OR REPLACE FUNCTION public.storage_can_access_branch_scoped_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT
      public.storage_path_uuid_segment(p_name, 1) AS tenant_id,
      public.storage_path_uuid_segment(p_name, 2) AS branch_id
  )
  SELECT COALESCE(
    tenant_id IS NOT NULL
    AND branch_id IS NOT NULL
    AND public.storage_branch_exists(tenant_id, branch_id)
    AND public.rls_can_access_branch(tenant_id, branch_id),
    FALSE
  )
  FROM ids
$$;

CREATE OR REPLACE FUNCTION public.storage_can_write_branch_scoped_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT
      public.storage_path_uuid_segment(p_name, 1) AS tenant_id,
      public.storage_path_uuid_segment(p_name, 2) AS branch_id
  )
  SELECT COALESCE(
    tenant_id IS NOT NULL
    AND branch_id IS NOT NULL
    AND public.storage_branch_exists(tenant_id, branch_id)
    AND public.rls_can_write_branch(tenant_id, branch_id),
    FALSE
  )
  FROM ids
$$;

CREATE OR REPLACE FUNCTION public.storage_branch_asset_tenant_id(p_name TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT
      public.storage_path_uuid_segment(p_name, 1) AS first_id,
      public.storage_path_uuid_segment(p_name, 2) AS second_id
  )
  SELECT COALESCE(
    (
      SELECT ids.first_id
      FROM ids
      JOIN public.branches b
        ON b.tenant_id = ids.first_id
       AND b.id = ids.second_id
      LIMIT 1
    ),
    (
      SELECT b.tenant_id
      FROM ids
      JOIN public.branches b
        ON b.id = ids.first_id
      LIMIT 1
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.storage_branch_asset_branch_id(p_name TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT
      public.storage_path_uuid_segment(p_name, 1) AS first_id,
      public.storage_path_uuid_segment(p_name, 2) AS second_id
  )
  SELECT COALESCE(
    (
      SELECT ids.second_id
      FROM ids
      JOIN public.branches b
        ON b.tenant_id = ids.first_id
       AND b.id = ids.second_id
      LIMIT 1
    ),
    (
      SELECT b.id
      FROM ids
      JOIN public.branches b
        ON b.id = ids.first_id
      LIMIT 1
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.storage_can_write_branch_asset(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.rls_can_write_branch(
      public.storage_branch_asset_tenant_id(p_name),
      public.storage_branch_asset_branch_id(p_name)
    ),
    FALSE
  )
$$;

REVOKE ALL ON FUNCTION public.storage_path_segment(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_path_uuid_segment(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_name_has_extension(TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_branch_exists(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_can_access_scoped_object(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_can_write_scoped_object(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_can_access_branch_scoped_object(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_can_write_branch_scoped_object(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_branch_asset_tenant_id(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_branch_asset_branch_id(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.storage_can_write_branch_asset(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.storage_path_segment(TEXT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_path_uuid_segment(TEXT, INT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_name_has_extension(TEXT, TEXT[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_branch_exists(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_can_access_scoped_object(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_can_write_scoped_object(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_can_access_branch_scoped_object(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_can_write_branch_scoped_object(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_branch_asset_tenant_id(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_branch_asset_branch_id(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.storage_can_write_branch_asset(TEXT) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.storage_can_access_scoped_object(TEXT) IS
  'Storage path access helper. Canonical paths are tenant/branch scoped; tenant-root paths are legacy compatibility.';

COMMENT ON FUNCTION public.storage_can_write_branch_asset(TEXT) IS
  'Allows branch asset writes for canonical tenant/branch paths and legacy branch_id/logo paths.';

-- ============================================================
-- Bucket metadata
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'product-images',
    'product-images',
    TRUE,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
  ),
  (
    'branch-assets',
    'branch-assets',
    TRUE,
    5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'expense-receipts',
    'expense-receipts',
    FALSE,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']::text[]
  ),
  (
    'purchases-bills',
    'purchases-bills',
    FALSE,
    10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']::text[]
  )
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- If an invoice PDF bucket already exists, lock it down without creating a
-- new bucket or changing invoice PDF functionality.
UPDATE storage.buckets
SET
  public = FALSE,
  file_size_limit = COALESCE(file_size_limit, 10485760),
  allowed_mime_types = ARRAY['application/pdf']::text[]
WHERE id IN ('invoice-pdfs', 'invoice-pdf', 'invoice-pdfs-private');

-- ============================================================
-- Drop drifted broad policies for covered buckets
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        policyname LIKE 'phase3b_%'
        OR policyname IN (
          'product-images: public read',
          'product-images: authenticated write',
          'product-images: authenticated update',
          'product-images: authenticated delete',
          'branch_assets_public_read',
          'branch_assets_insert',
          'branch_assets_update',
          'branch_assets_delete',
          'expense-receipts: tenant read',
          'expense-receipts: tenant write',
          'expense-receipts: tenant delete',
          'purchases-bills: authenticated read',
          'purchases-bills: authenticated write',
          'purchases-bills: authenticated delete'
        )
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- ============================================================
-- Canonical storage policies
-- ============================================================

-- Service-role Edge Functions/admin operations remain unrestricted.
CREATE POLICY phase3b_storage_service_all
  ON storage.objects
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- product-images: product photos are public display assets, but writes are
-- restricted to the caller's tenant path.
CREATE POLICY phase3b_product_images_public_read
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY phase3b_product_images_insert
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND public.storage_can_write_scoped_object(name)
    AND public.storage_name_has_extension(name, ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif'])
  );

CREATE POLICY phase3b_product_images_update
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND public.storage_can_write_scoped_object(name)
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND public.storage_can_write_scoped_object(name)
    AND public.storage_name_has_extension(name, ARRAY['jpg', 'jpeg', 'png', 'webp', 'gif'])
  );

CREATE POLICY phase3b_product_images_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND public.storage_can_write_scoped_object(name)
  );

-- branch-assets: public logo display is preserved for invoice/reprint
-- compatibility. Future uploads no longer allow SVG.
CREATE POLICY phase3b_branch_assets_public_read
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'branch-assets');

CREATE POLICY phase3b_branch_assets_insert
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'branch-assets'
    AND public.storage_can_write_branch_asset(name)
    AND public.storage_name_has_extension(name, ARRAY['jpg', 'jpeg', 'png', 'webp'])
  );

CREATE POLICY phase3b_branch_assets_update
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'branch-assets'
    AND public.storage_can_write_branch_asset(name)
  )
  WITH CHECK (
    bucket_id = 'branch-assets'
    AND public.storage_can_write_branch_asset(name)
    AND public.storage_name_has_extension(name, ARRAY['jpg', 'jpeg', 'png', 'webp'])
  );

CREATE POLICY phase3b_branch_assets_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'branch-assets'
    AND public.storage_can_write_branch_asset(name)
  );

-- Private receipts: authenticated users can create short-lived signed URLs
-- only for objects in their tenant/branch path. Current tenant-root paths are
-- allowed for compatibility until the frontend stores canonical paths.
CREATE POLICY phase3b_expense_receipts_select
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.storage_can_access_scoped_object(name)
  );

CREATE POLICY phase3b_expense_receipts_insert
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND public.storage_can_write_scoped_object(name)
    AND public.storage_name_has_extension(name, ARRAY['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'])
  );

CREATE POLICY phase3b_expense_receipts_update
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.storage_can_write_scoped_object(name)
  )
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND public.storage_can_write_scoped_object(name)
    AND public.storage_name_has_extension(name, ARRAY['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'])
  );

CREATE POLICY phase3b_expense_receipts_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.storage_can_write_scoped_object(name)
  );

-- Private purchase bills: same compatibility model as receipts.
CREATE POLICY phase3b_purchases_bills_select
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'purchases-bills'
    AND public.storage_can_access_scoped_object(name)
  );

CREATE POLICY phase3b_purchases_bills_insert
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'purchases-bills'
    AND public.storage_can_write_scoped_object(name)
    AND public.storage_name_has_extension(name, ARRAY['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'])
  );

CREATE POLICY phase3b_purchases_bills_update
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'purchases-bills'
    AND public.storage_can_write_scoped_object(name)
  )
  WITH CHECK (
    bucket_id = 'purchases-bills'
    AND public.storage_can_write_scoped_object(name)
    AND public.storage_name_has_extension(name, ARRAY['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'])
  );

CREATE POLICY phase3b_purchases_bills_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'purchases-bills'
    AND public.storage_can_write_scoped_object(name)
  );

-- Optional/future invoice PDF buckets: no tenant-root compatibility because no
-- current frontend flow was found. Require tenant/branch paths from day one.
CREATE POLICY phase3b_invoice_pdfs_select
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('invoice-pdfs', 'invoice-pdf', 'invoice-pdfs-private')
    AND public.storage_can_access_branch_scoped_object(name)
  );

CREATE POLICY phase3b_invoice_pdfs_insert
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('invoice-pdfs', 'invoice-pdf', 'invoice-pdfs-private')
    AND public.storage_can_write_branch_scoped_object(name)
    AND public.storage_name_has_extension(name, ARRAY['pdf'])
  );

CREATE POLICY phase3b_invoice_pdfs_update
  ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id IN ('invoice-pdfs', 'invoice-pdf', 'invoice-pdfs-private')
    AND public.storage_can_write_branch_scoped_object(name)
  )
  WITH CHECK (
    bucket_id IN ('invoice-pdfs', 'invoice-pdf', 'invoice-pdfs-private')
    AND public.storage_can_write_branch_scoped_object(name)
    AND public.storage_name_has_extension(name, ARRAY['pdf'])
  );

CREATE POLICY phase3b_invoice_pdfs_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('invoice-pdfs', 'invoice-pdf', 'invoice-pdfs-private')
    AND public.storage_can_write_branch_scoped_object(name)
  );

COMMIT;

-- ============================================================
-- Verification queries
-- ============================================================
--
-- 1) Confirm bucket visibility, size limits, and MIME allowlists:
--
-- SELECT id, name, public, file_size_limit, allowed_mime_types
-- FROM storage.buckets
-- ORDER BY id;
--
-- Expected for known buckets:
--   product-images public = true
--   branch-assets public = true and no image/svg+xml in allowed_mime_types
--   expense-receipts public = false
--   purchases-bills public = false
--
-- 2) Confirm Phase 3B storage policies are installed:
--
-- SELECT policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'storage'
--   AND tablename = 'objects'
--   AND policyname LIKE 'phase3b_%'
-- ORDER BY policyname;
--
-- 3) Confirm old broad policies are gone:
--
-- SELECT policyname
-- FROM pg_policies
-- WHERE schemaname = 'storage'
--   AND tablename = 'objects'
--   AND policyname IN (
--     'product-images: authenticated write',
--     'product-images: authenticated update',
--     'product-images: authenticated delete',
--     'branch_assets_insert',
--     'branch_assets_update',
--     'branch_assets_delete',
--     'expense-receipts: tenant read',
--     'expense-receipts: tenant write',
--     'expense-receipts: tenant delete',
--     'purchases-bills: authenticated read',
--     'purchases-bills: authenticated write',
--     'purchases-bills: authenticated delete'
--   )
-- ORDER BY policyname;
--
-- Expected: zero rows.
--
-- 4) Find existing object path shapes before frontend migration:
--
-- SELECT bucket_id,
--        CASE
--          WHEN name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}/' THEN 'tenant/branch'
--          WHEN name ~* '^[0-9a-f-]{36}/' THEN 'tenant-root-or-branch-root'
--          ELSE 'other'
--        END AS path_shape,
--        COUNT(*) AS object_count
-- FROM storage.objects
-- WHERE bucket_id IN (
--   'product-images',
--   'branch-assets',
--   'expense-receipts',
--   'purchases-bills',
--   'invoice-pdfs',
--   'invoice-pdf',
--   'invoice-pdfs-private'
-- )
-- GROUP BY bucket_id, path_shape
-- ORDER BY bucket_id, path_shape;
--
-- 5) Find stored long-lived signed URLs that need frontend/DB follow-up:
--
-- SELECT 'expenses.receipt_url' AS source, COUNT(*) AS signed_url_count
-- FROM public.expenses
-- WHERE receipt_url ILIKE '%/storage/v1/object/sign/%'
--    OR receipt_url ILIKE '%token=%'
-- UNION ALL
-- SELECT 'purchases.bill_url' AS source, COUNT(*) AS signed_url_count
-- FROM public.purchases
-- WHERE bill_url ILIKE '%/storage/v1/object/sign/%'
--    OR bill_url ILIKE '%token=%';
--
-- 6) Branch user negative test template:
--    Run authenticated as a branch user. Replace UUIDs with that user's tenant
--    and a different branch in the same tenant. These should fail or return
--    storage unauthorized unless using a documented tenant-root legacy path.
--
-- -- Upload should be rejected for another branch canonical path:
-- -- bucket: expense-receipts
-- -- path: {caller_tenant_id}/{other_branch_id}/expenses/test.pdf
--
-- 7) Tenant isolation negative test template:
--    Run authenticated as any non-super-admin tenant user. Upload/select for
--    another tenant prefix should fail:
--
-- -- bucket: purchases-bills
-- -- path: {other_tenant_id}/{any_branch_id}/purchases/test.pdf

-- ============================================================
-- Manual test checklist after applying SQL
-- ============================================================
--
-- Owner/admin:
--   - Product image upload and product card/POS display still work.
--   - Branch logo upload in Settings > Branches still works.
--   - Existing branch logos still display on invoice detail/reprint.
--   - Expense receipt upload/view still works if used.
--   - Purchase bill upload/view still works if used.
--
-- Branch user:
--   - Branch invoice settings logo upload still works for own branch.
--   - Product image upload still works where branch product management is allowed.
--   - Cannot upload to another tenant prefix.
--   - Cannot upload to another branch canonical tenant/branch path.
--
-- Security checks:
--   - SVG upload to branch-assets is rejected for new uploads.
--   - expense-receipts and purchases-bills remain private buckets.
--   - Existing public product/branch image URLs continue to render.
--
-- Follow-up recommended before AI/OCR bill scanning:
--   - Change private file uploads to canonical tenant/branch paths.
--   - Store object path columns instead of one-year signed URLs.
--   - Generate short-lived signed URLs on demand through frontend helper,
--     safe RPC, or Edge Function.
