-- ============================================================
-- add-branch-email.sql
--
-- Adds branch_email column to branches table.
-- Stores the POS login email so the owner can see which
-- email address was set up for each branch.
--
-- Safe to run multiple times (IF NOT EXISTS).
-- ============================================================

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS branch_email TEXT DEFAULT NULL;

COMMENT ON COLUMN public.branches.branch_email
  IS 'Email address of the branch POS login account (set during branch creation)';
