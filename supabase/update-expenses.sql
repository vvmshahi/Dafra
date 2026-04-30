-- ============================================================
-- update-expenses.sql
-- Creates expense_categories, expenses, fixed_expenses tables.
-- Creates expense-receipts Storage bucket.
-- Seeds 9 default system categories.
-- Run AFTER schema.sql has been applied.
-- ============================================================

-- ── 1. expense_categories ────────────────────────────────────
-- tenant_id IS NULL  → system/global category (shared)
-- tenant_id = <uuid> → custom tenant category
CREATE TABLE IF NOT EXISTS public.expense_categories (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    name_ar     VARCHAR(100),
    color       VARCHAR(20)  DEFAULT '#6b7280',
    icon        VARCHAR(10)  DEFAULT '💰',
    is_system   BOOLEAN      NOT NULL DEFAULT FALSE,
    sort_order  INT          NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- Partial unique index: system category names must be unique
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_system_name_uq
    ON public.expense_categories(name) WHERE tenant_id IS NULL;

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

-- Read: system categories (NULL tenant) + own tenant categories
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expense_categories'
      AND policyname = 'expense_categories_read'
  ) THEN
    CREATE POLICY "expense_categories_read" ON public.expense_categories
      FOR SELECT USING (
        tenant_id IS NULL
        OR tenant_id = get_my_tenant_id()
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expense_categories'
      AND policyname = 'expense_categories_insert'
  ) THEN
    CREATE POLICY "expense_categories_insert" ON public.expense_categories
      FOR INSERT WITH CHECK (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expense_categories'
      AND policyname = 'expense_categories_update'
  ) THEN
    CREATE POLICY "expense_categories_update" ON public.expense_categories
      FOR UPDATE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
        AND is_system = FALSE
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expense_categories'
      AND policyname = 'expense_categories_delete'
  ) THEN
    CREATE POLICY "expense_categories_delete" ON public.expense_categories
      FOR DELETE USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
        AND is_system = FALSE
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expense_categories'
      AND policyname = 'expense_categories_super_admin'
  ) THEN
    CREATE POLICY "expense_categories_super_admin" ON public.expense_categories
      FOR ALL USING (is_super_admin());
  END IF;
END $$;

-- ── 2. expenses (daily / variable) ───────────────────────────
-- vat_treatment:
--   no_vat    → amount is the total; vat_amount = 0
--   included  → amount is total (VAT inside); vat_amount = amount×15÷115
--   on_top    → amount is pre-VAT; vat_amount = amount×0.15
-- total_paid = amount + (on_top ? vat_amount : 0)
CREATE TABLE IF NOT EXISTS public.expenses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
    branch_id       UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    category_id     UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
    added_by        UUID REFERENCES public.user_profiles(id)      ON DELETE SET NULL,

    expense_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
    description     VARCHAR(500) NOT NULL,
    vendor_name     VARCHAR(255),
    amount          NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    vat_treatment   VARCHAR(20)  NOT NULL DEFAULT 'no_vat'
                        CHECK (vat_treatment IN ('no_vat', 'included', 'on_top')),
    vat_amount      NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
    total_paid      NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
    payment_method  VARCHAR(20)  NOT NULL DEFAULT 'cash'
                        CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'other')),
    receipt_url     TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expenses_branch_date_idx
    ON public.expenses(branch_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS expenses_tenant_idx
    ON public.expenses(tenant_id, expense_date DESC);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='expenses' AND policyname='expenses_super_admin'
  ) THEN
    CREATE POLICY "expenses_super_admin" ON public.expenses
      FOR ALL USING (is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='expenses' AND policyname='expenses_read'
  ) THEN
    CREATE POLICY "expenses_read" ON public.expenses
      FOR SELECT USING (tenant_id = get_my_tenant_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='expenses' AND policyname='expenses_owner_write'
  ) THEN
    CREATE POLICY "expenses_owner_write" ON public.expenses
      FOR ALL USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() = 'owner'
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='expenses' AND policyname='expenses_staff_write'
  ) THEN
    CREATE POLICY "expenses_staff_write" ON public.expenses
      FOR ALL USING (
        tenant_id  = get_my_tenant_id()
        AND branch_id = get_my_branch_id()
        AND get_my_role() IN ('manager', 'cashier')
      );
  END IF;
END $$;

-- ── 3. fixed_expenses (monthly recurring) ────────────────────
CREATE TABLE IF NOT EXISTS public.fixed_expenses (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id)  ON DELETE CASCADE,
    branch_id       UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    category_id     UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,

    name            VARCHAR(255) NOT NULL,
    monthly_amount  NUMERIC(12, 2) NOT NULL CHECK (monthly_amount >= 0),
    payment_method  VARCHAR(20)  NOT NULL DEFAULT 'cash'
                        CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'other')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.fixed_expenses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='fixed_expenses' AND policyname='fixed_expenses_super_admin'
  ) THEN
    CREATE POLICY "fixed_expenses_super_admin" ON public.fixed_expenses
      FOR ALL USING (is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='fixed_expenses' AND policyname='fixed_expenses_read'
  ) THEN
    CREATE POLICY "fixed_expenses_read" ON public.fixed_expenses
      FOR SELECT USING (tenant_id = get_my_tenant_id());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='fixed_expenses' AND policyname='fixed_expenses_write'
  ) THEN
    CREATE POLICY "fixed_expenses_write" ON public.fixed_expenses
      FOR ALL USING (
        tenant_id = get_my_tenant_id()
        AND get_my_role() IN ('owner', 'manager')
      );
  END IF;
END $$;

-- ── 4. Storage bucket: expense-receipts ──────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  FALSE,   -- private: served via signed URL
  10485760, -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='expense-receipts: tenant read'
  ) THEN
    CREATE POLICY "expense-receipts: tenant read"
      ON storage.objects FOR SELECT
      USING (
        bucket_id = 'expense-receipts'
        AND auth.role() = 'authenticated'
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='expense-receipts: tenant write'
  ) THEN
    CREATE POLICY "expense-receipts: tenant write"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'expense-receipts'
        AND auth.role() = 'authenticated'
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='expense-receipts: tenant delete'
  ) THEN
    CREATE POLICY "expense-receipts: tenant delete"
      ON storage.objects FOR DELETE
      USING (
        bucket_id = 'expense-receipts'
        AND auth.role() = 'authenticated'
      );
  END IF;
END $$;

-- ── 5. Seed default system categories ────────────────────────
INSERT INTO public.expense_categories
    (name, name_ar, color, icon, is_system, sort_order)
VALUES
    ('Rent',             'إيجار',        '#6366f1', '🏢', TRUE, 1),
    ('Salaries',         'رواتب',         '#8b5cf6', '👤', TRUE, 2),
    ('Utilities',        'مرافق',         '#f59e0b', '⚡', TRUE, 3),
    ('Supplies',         'مستلزمات',      '#10b981', '📦', TRUE, 4),
    ('Marketing',        'تسويق',         '#3b82f6', '📢', TRUE, 5),
    ('Government Fees',  'رسوم حكومية',   '#ef4444', '🏛️', TRUE, 6),
    ('Maintenance',      'صيانة',         '#f97316', '🔧', TRUE, 7),
    ('Insurance',        'تأمين',         '#14b8a6', '🛡️', TRUE, 8),
    ('Other',            'أخرى',          '#6b7280', '💰', TRUE, 9)
ON CONFLICT (name) WHERE tenant_id IS NULL DO NOTHING;

-- ── Verification ──────────────────────────────────────────────
-- SELECT name, icon FROM expense_categories WHERE is_system = TRUE ORDER BY sort_order;
