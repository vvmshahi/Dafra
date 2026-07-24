\set ON_ERROR_STOP on

-- Apply only after atomic simplified checkout v2 has installed successfully
-- with all rollout flags still false.
\ir ../../../supabase/migrations/20260724000200_pos_sessions_authenticated_select.sql
