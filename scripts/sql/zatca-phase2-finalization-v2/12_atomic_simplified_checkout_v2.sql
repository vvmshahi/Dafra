\set ON_ERROR_STOP on

-- Canonical versioned migration. \ir resolves relative to this package file
-- when executed by the protected operator runner.
\ir ../../../supabase/migrations/20260724000100_atomic_simplified_checkout_v2.sql
