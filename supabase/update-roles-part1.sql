-- ============================================================
-- Dafra — Role migration PART 1 of 2
-- Run this first, then commit/close the session before running part2.
--
-- PostgreSQL requires enum ADD VALUE to be committed before the
-- new value can be used anywhere in the same connection.
-- ============================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'branch';
