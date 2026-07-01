# Pending Deploy Order

Use this order for Phase 5B-3C, Phase 5B-3D, and Phase 5C-1 pilot hardening.

1. Apply `supabase/phase5b3c-expense-vat-claimability.sql` manually if not already applied.
2. Apply `supabase/phase5b3d-business-type-reporting-mode.sql` manually if not already applied.
3. Deploy the `create-owner-account` Edge Function.
4. Deploy the frontend.
5. Hard refresh the browser.
6. Run `docs/pilot-smoke-checklist.md`.

Do not deploy frontend code that depends on new SQL columns before the SQL has been applied.

