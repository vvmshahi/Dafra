-- ============================================================
-- update-inventory.sql
-- Creates suppliers, inventory_items, purchases, purchase_items.
-- Creates purchases-bills Storage bucket.
-- Adds trigger to auto-update stock on purchase item insert.
-- Run AFTER schema.sql has been applied.
-- ============================================================

-- ── 1. suppliers ─────────────────────────────────────────────
-- Tenant-scoped (shared across all branches of a tenant)
CREATE TABLE IF NOT EXISTS public.suppliers (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name             VARCHAR(255) NOT NULL,
    name_ar          VARCHAR(255),
    vat_number       VARCHAR(20),
    cr_number        VARCHAR(20),
    contact_person   VARCHAR(255),
    phone            VARCHAR(50),
    email            VARCHAR(255),
    city             VARCHAR(100),
    address          TEXT,
    payment_terms    VARCHAR(20) NOT NULL DEFAULT 'cash'
                         CHECK (payment_terms IN ('cash', 'credit_30', 'credit_60')),
    notes            TEXT,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suppliers_tenant_idx ON public.suppliers(tenant_id);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='suppliers' AND policyname='suppliers_super_admin'
  ) THEN
    CREATE POLICY "suppliers_super_admin" ON public.suppliers
      FOR ALL USING (is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='suppliers' AND policyname='suppliers_read'
  ) THEN
    CREATE POLICY "suppliers_read" ON public.suppliers
      FOR SELECT USING (tenant_id = get_my_tenant_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='suppliers' AND policyname='suppliers_write'
  ) THEN
    CREATE POLICY "suppliers_write" ON public.suppliers
      FOR ALL USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
      );
  END IF;
END $$;

-- ── 2. inventory_items ────────────────────────────────────────
-- Branch-scoped stock items (raw materials, supplies, etc.)
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
    branch_id         UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    category_id       UUID REFERENCES public.categories(id)         ON DELETE SET NULL,
    supplier_id       UUID REFERENCES public.suppliers(id)          ON DELETE SET NULL,
    name              VARCHAR(255) NOT NULL,
    name_ar           VARCHAR(255),
    unit_type         VARCHAR(20) NOT NULL DEFAULT 'pieces'
                          CHECK (unit_type IN ('pieces','kg','grams','liters','ml','boxes','bags','other')),
    current_quantity  NUMERIC(12, 3) NOT NULL DEFAULT 0,
    minimum_quantity  NUMERIC(12, 3) NOT NULL DEFAULT 0,
    unit_cost         NUMERIC(12, 2) NOT NULL DEFAULT 0,
    notes             TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_items_branch_idx
    ON public.inventory_items(branch_id);
CREATE INDEX IF NOT EXISTS inventory_items_tenant_idx
    ON public.inventory_items(tenant_id);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='inventory_items' AND policyname='inventory_items_super_admin'
  ) THEN
    CREATE POLICY "inventory_items_super_admin" ON public.inventory_items
      FOR ALL USING (is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='inventory_items' AND policyname='inventory_items_read'
  ) THEN
    CREATE POLICY "inventory_items_read" ON public.inventory_items
      FOR SELECT USING (tenant_id = get_my_tenant_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='inventory_items' AND policyname='inventory_items_write'
  ) THEN
    CREATE POLICY "inventory_items_write" ON public.inventory_items
      FOR ALL USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
      );
  END IF;
END $$;

-- ── 3. purchases ──────────────────────────────────────────────
-- Branch-scoped purchase orders from suppliers
CREATE TABLE IF NOT EXISTS public.purchases (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id        UUID NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
    branch_id        UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    supplier_id      UUID REFERENCES public.suppliers(id)          ON DELETE SET NULL,
    added_by         UUID REFERENCES public.user_profiles(id)      ON DELETE SET NULL,
    purchase_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
    subtotal         NUMERIC(12, 2) NOT NULL DEFAULT 0,
    vat_amount       NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_amount     NUMERIC(12, 2) NOT NULL DEFAULT 0,
    payment_method   VARCHAR(20) NOT NULL DEFAULT 'cash'
                         CHECK (payment_method IN ('cash', 'card', 'bank_transfer')),
    bill_url         TEXT,
    notes            TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchases_branch_date_idx
    ON public.purchases(branch_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS purchases_tenant_date_idx
    ON public.purchases(tenant_id, purchase_date DESC);

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='purchases' AND policyname='purchases_super_admin'
  ) THEN
    CREATE POLICY "purchases_super_admin" ON public.purchases
      FOR ALL USING (is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='purchases' AND policyname='purchases_read'
  ) THEN
    CREATE POLICY "purchases_read" ON public.purchases
      FOR SELECT USING (tenant_id = get_my_tenant_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='purchases' AND policyname='purchases_write'
  ) THEN
    CREATE POLICY "purchases_write" ON public.purchases
      FOR ALL USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager', 'cashier')
      );
  END IF;
END $$;

-- ── 4. purchase_items ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_id         UUID NOT NULL REFERENCES public.purchases(id)      ON DELETE CASCADE,
    inventory_item_id   UUID          REFERENCES public.inventory_items(id) ON DELETE SET NULL,
    name                VARCHAR(255) NOT NULL,
    quantity            NUMERIC(12, 3) NOT NULL,
    unit_cost           NUMERIC(12, 2) NOT NULL,
    total               NUMERIC(12, 2) NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS purchase_items_purchase_idx
    ON public.purchase_items(purchase_id);

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='purchase_items' AND policyname='purchase_items_super_admin'
  ) THEN
    CREATE POLICY "purchase_items_super_admin" ON public.purchase_items
      FOR ALL USING (is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='purchase_items' AND policyname='purchase_items_read'
  ) THEN
    CREATE POLICY "purchase_items_read" ON public.purchase_items
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.purchases p
          WHERE p.id = purchase_id
            AND p.tenant_id = get_my_tenant_id()
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='purchase_items' AND policyname='purchase_items_write'
  ) THEN
    CREATE POLICY "purchase_items_write" ON public.purchase_items
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.purchases p
          WHERE p.id = purchase_id
            AND p.tenant_id = get_my_tenant_id()
            AND get_my_role() IN ('owner', 'manager', 'cashier')
        )
      );
  END IF;
END $$;

-- ── 5. Trigger: auto-update stock on purchase insert ─────────
CREATE OR REPLACE FUNCTION fn_purchase_item_update_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.inventory_item_id IS NOT NULL THEN
    UPDATE public.inventory_items
       SET current_quantity = current_quantity + NEW.quantity,
           updated_at       = NOW()
     WHERE id = NEW.inventory_item_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_item_update_stock ON public.purchase_items;
CREATE TRIGGER trg_purchase_item_update_stock
  AFTER INSERT ON public.purchase_items
  FOR EACH ROW EXECUTE FUNCTION fn_purchase_item_update_stock();

-- ── 6. Storage bucket: purchases-bills ───────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'purchases-bills',
  'purchases-bills',
  FALSE,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='purchases-bills: authenticated read'
  ) THEN
    CREATE POLICY "purchases-bills: authenticated read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'purchases-bills' AND auth.role() = 'authenticated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='purchases-bills: authenticated write'
  ) THEN
    CREATE POLICY "purchases-bills: authenticated write"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'purchases-bills' AND auth.role() = 'authenticated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='purchases-bills: authenticated delete'
  ) THEN
    CREATE POLICY "purchases-bills: authenticated delete"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'purchases-bills' AND auth.role() = 'authenticated');
  END IF;
END $$;

-- ── Verification ──────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('suppliers','inventory_items','purchases','purchase_items');
