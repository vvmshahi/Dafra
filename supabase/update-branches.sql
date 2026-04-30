-- ============================================================
-- update-branches.sql
-- Adds invoice/branding/ZATCA columns to branches table
-- and creates the branch-assets Storage bucket.
-- Safe to run multiple times (all statements are idempotent).
-- Run in Supabase SQL Editor.
-- ============================================================

-- ── 1. New columns on branches ────────────────────────────────

ALTER TABLE branches
  -- Branch identity (shown on every invoice)
  ADD COLUMN IF NOT EXISTS business_name     VARCHAR(255),        -- brand name on invoice (may differ from system name)
  ADD COLUMN IF NOT EXISTS business_name_ar  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS vat_number        VARCHAR(15),         -- branch-level VAT (falls back to tenant.vat_number if NULL)
  ADD COLUMN IF NOT EXISTS cr_number         VARCHAR(20),         -- branch-level CR  (falls back to tenant.cr_number  if NULL)
  ADD COLUMN IF NOT EXISTS logo_url          TEXT,                -- public URL in branch-assets bucket
  -- Contact
  ADD COLUMN IF NOT EXISTS website           VARCHAR(255),
  -- Invoice settings
  ADD COLUMN IF NOT EXISTS vat_mode          VARCHAR(20)  DEFAULT 'exclusive'
                                             CHECK (vat_mode IN ('exclusive', 'inclusive')),
  ADD COLUMN IF NOT EXISTS invoice_prefix    VARCHAR(10)  DEFAULT 'INV',
  ADD COLUMN IF NOT EXISTS receipt_footer    TEXT,
  ADD COLUMN IF NOT EXISTS show_logo         BOOLEAN      DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS invoice_language  VARCHAR(10)  DEFAULT 'both'
                                             CHECK (invoice_language IN ('en', 'ar', 'both')),
  -- ZATCA
  ADD COLUMN IF NOT EXISTS zatca_phase       SMALLINT     DEFAULT 1
                                             CHECK (zatca_phase IN (1, 2));

-- ── 2. Refresh the updated_at trigger (already exists globally) ──
-- No action needed — the existing trg_branches_updated_at covers new columns.

-- ── 3. Storage bucket: branch-assets ─────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'branch-assets',
  'branch-assets',
  TRUE,                                         -- public read (logo shown on invoices)
  5242880,                                      -- 5 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- ── 4. Storage RLS policies ───────────────────────────────────

-- Allow anyone to read logos (invoices are sent to customers)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'branch_assets_public_read'
  ) THEN
    CREATE POLICY "branch_assets_public_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'branch-assets');
  END IF;
END $$;

-- Authenticated users can upload/replace logos for their tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'branch_assets_insert'
  ) THEN
    CREATE POLICY "branch_assets_insert"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'branch-assets');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'branch_assets_update'
  ) THEN
    CREATE POLICY "branch_assets_update"
      ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id = 'branch-assets');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'branch_assets_delete'
  ) THEN
    CREATE POLICY "branch_assets_delete"
      ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id = 'branch-assets');
  END IF;
END $$;

-- ── 5. Verification ───────────────────────────────────────────
-- Run this block to confirm the migration succeeded:
--
-- SELECT column_name, data_type, column_default
-- FROM   information_schema.columns
-- WHERE  table_name = 'branches'
-- ORDER  BY ordinal_position;
--
-- SELECT id, name, public FROM storage.buckets WHERE id = 'branch-assets';
