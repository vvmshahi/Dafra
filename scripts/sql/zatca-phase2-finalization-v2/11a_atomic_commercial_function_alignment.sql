\set ON_ERROR_STOP on

-- Canonical guarded compatibility alignment. Run after the durable outbox
-- step and before atomic simplified checkout v2.
\ir ../../../supabase/migrations/20260724000000_atomic_commercial_function_compatibility_alignment.sql
