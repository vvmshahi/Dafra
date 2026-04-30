-- ============================================================
-- update-products.sql
-- Adds new columns to categories (color, icon) and products
-- (vat_treatment, is_available, sort_order, notes).
-- Creates product-images Storage bucket with RLS.
-- Run in Supabase SQL Editor AFTER schema.sql has been applied.
-- ============================================================

-- ── categories: visual display columns ───────────────────────
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#6b7280',
  ADD COLUMN IF NOT EXISTS icon  VARCHAR(10) DEFAULT '📦';

-- ── products: new operational columns ────────────────────────
-- vat_treatment: how VAT is applied to this product
--   inherit    = follow the branch vat_mode setting (default)
--   exclusive  = price is always pre-VAT
--   inclusive  = price is always VAT-inclusive
--   exempt     = zero-rated or exempt item (tax overridden to 0)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS vat_treatment VARCHAR(20) DEFAULT 'inherit'
    CONSTRAINT products_vat_treatment_check
    CHECK (vat_treatment IN ('inherit','exclusive','inclusive','exempt')),
  ADD COLUMN IF NOT EXISTS is_available  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sort_order    INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes         TEXT;

-- ── Storage: product-images bucket ────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  TRUE,
  5242880,   -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp','image/gif']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Public read (images are served on product cards, POS, receipts)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product-images: public read'
  ) THEN
    CREATE POLICY "product-images: public read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'product-images');
  END IF;
END $$;

-- Authenticated write
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product-images: authenticated write'
  ) THEN
    CREATE POLICY "product-images: authenticated write"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'product-images'
        AND auth.role() = 'authenticated'
      );
  END IF;
END $$;

-- Authenticated update
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product-images: authenticated update'
  ) THEN
    CREATE POLICY "product-images: authenticated update"
      ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'product-images'
        AND auth.role() = 'authenticated'
      );
  END IF;
END $$;

-- Authenticated delete
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product-images: authenticated delete'
  ) THEN
    CREATE POLICY "product-images: authenticated delete"
      ON storage.objects FOR DELETE
      USING (
        bucket_id = 'product-images'
        AND auth.role() = 'authenticated'
      );
  END IF;
END $$;

-- ── Verification ──────────────────────────────────────────────
-- After running, confirm with:
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'categories' AND column_name IN ('color','icon');
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'products'
--   AND column_name IN ('vat_treatment','is_available','sort_order','notes');
