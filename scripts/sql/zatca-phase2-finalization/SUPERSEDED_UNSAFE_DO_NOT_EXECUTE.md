# Superseded — unsafe for execution

This Phase 2 package is retained only for review history. **Do not execute any
SQL in this directory.** Its historical classification, generic artifact model,
state-only claim, and unlocked counter/hash lookup do not satisfy the v2 safety
contract.

The additive replacement is
`scripts/sql/zatca-phase2-finalization-v2/`. It is disabled by default and does
not classify, regenerate, or freeze historical invoices.
