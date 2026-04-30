-- ============================================================
-- Day Closing / Cash Register Table
-- Safe to run multiple times (idempotent).
-- ============================================================

CREATE TABLE IF NOT EXISTS day_closings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id        UUID REFERENCES branches(id) ON DELETE SET NULL,
  closing_date     DATE NOT NULL,
  total_sales      DECIMAL(10, 2) NOT NULL DEFAULT 0,
  cash_sales       DECIMAL(10, 2) NOT NULL DEFAULT 0,
  card_sales       DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total_vat        DECIMAL(10, 2) NOT NULL DEFAULT 0,
  invoice_count    INTEGER         NOT NULL DEFAULT 0,
  total_expenses   DECIMAL(10, 2) NOT NULL DEFAULT 0,
  cash_expenses    DECIMAL(10, 2) NOT NULL DEFAULT 0,
  card_expenses    DECIMAL(10, 2) NOT NULL DEFAULT 0,
  expected_cash    DECIMAL(10, 2) NOT NULL DEFAULT 0,
  actual_cash      DECIMAL(10, 2) NOT NULL DEFAULT 0,
  cash_difference  DECIMAL(10, 2) NOT NULL DEFAULT 0,
  notes            TEXT,
  closed_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, closing_date)
);

CREATE INDEX IF NOT EXISTS idx_day_closings_tenant ON day_closings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_day_closings_branch ON day_closings (branch_id);
CREATE INDEX IF NOT EXISTS idx_day_closings_date   ON day_closings (closing_date DESC);

-- RLS
ALTER TABLE day_closings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'day_closings' AND policyname = 'day_closings_super_admin') THEN
    CREATE POLICY "day_closings_super_admin" ON day_closings
      FOR ALL TO authenticated
      USING  (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'))
      WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'super_admin'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'day_closings' AND policyname = 'day_closings_owner_all') THEN
    CREATE POLICY "day_closings_owner_all" ON day_closings
      FOR ALL TO authenticated
      USING  (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'owner'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'day_closings' AND policyname = 'day_closings_manager_all') THEN
    CREATE POLICY "day_closings_manager_all" ON day_closings
      FOR ALL TO authenticated
      USING  (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'))
      WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'day_closings' AND policyname = 'day_closings_staff_read') THEN
    CREATE POLICY "day_closings_staff_read" ON day_closings
      FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));
  END IF;
END $$;
