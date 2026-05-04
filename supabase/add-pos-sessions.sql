-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)

-- 1. Create pos_sessions table
CREATE TABLE IF NOT EXISTS pos_sessions (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id               UUID          NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  tenant_id               UUID          NOT NULL,
  opened_by               UUID          REFERENCES user_profiles(id),
  opened_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  opening_cash            NUMERIC(12,2) NOT NULL DEFAULT 0,
  closed_by               UUID          REFERENCES user_profiles(id),
  closed_at               TIMESTAMPTZ,
  closing_cash_expected   NUMERIC(12,2),
  closing_cash_actual     NUMERIC(12,2),
  closing_cash_difference NUMERIC(12,2),
  total_cash_sales        NUMERIC(12,2) DEFAULT 0,
  total_card_sales        NUMERIC(12,2) DEFAULT 0,
  total_expenses          NUMERIC(12,2) DEFAULT 0,
  total_invoices          INTEGER       DEFAULT 0,
  notes                   TEXT,
  status                  TEXT          NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS pos_sessions_branch_id_idx     ON pos_sessions(branch_id);
CREATE INDEX IF NOT EXISTS pos_sessions_branch_status_idx ON pos_sessions(branch_id, status);

-- 3. Add session_id foreign key to invoices and expenses
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES pos_sessions(id);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES pos_sessions(id);

-- 4. Indexes on the new FKs
CREATE INDEX IF NOT EXISTS invoices_session_id_idx ON invoices(session_id);
CREATE INDEX IF NOT EXISTS expenses_session_id_idx ON expenses(session_id);

-- 5. Enable RLS
ALTER TABLE pos_sessions ENABLE ROW LEVEL SECURITY;

-- 6. RLS policies

-- Branch users: read/write sessions for their own branch
DROP POLICY IF EXISTS "branch_pos_sessions_select" ON pos_sessions;
CREATE POLICY "branch_pos_sessions_select" ON pos_sessions
  FOR SELECT USING (
    branch_id IN (
      SELECT branch_id FROM user_profiles
      WHERE id = auth.uid() AND branch_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "branch_pos_sessions_insert" ON pos_sessions;
CREATE POLICY "branch_pos_sessions_insert" ON pos_sessions
  FOR INSERT WITH CHECK (
    branch_id IN (
      SELECT branch_id FROM user_profiles
      WHERE id = auth.uid() AND branch_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "branch_pos_sessions_update" ON pos_sessions;
CREATE POLICY "branch_pos_sessions_update" ON pos_sessions
  FOR UPDATE USING (
    branch_id IN (
      SELECT branch_id FROM user_profiles
      WHERE id = auth.uid() AND branch_id IS NOT NULL
    )
  );

-- Owners: read all sessions for their tenant (for dashboard)
DROP POLICY IF EXISTS "owner_pos_sessions_select" ON pos_sessions;
CREATE POLICY "owner_pos_sessions_select" ON pos_sessions
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM user_profiles
      WHERE id = auth.uid() AND role = 'owner'
    )
  );
