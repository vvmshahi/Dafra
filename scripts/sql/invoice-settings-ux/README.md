# Invoice Settings UX RPC reconciliation

Review the authenticated hosted definitions first. The current V1 contract package is:

1. `06_stabilize_v1_settings_contract.sql`
2. `07_verify_v1_settings_contract.sql`

Execute the verification file only after reviewing the reconciliation SQL. The
package is additive and intentionally has not been executed against hosted Supabase.
