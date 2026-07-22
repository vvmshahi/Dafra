# V1 rollback

Keep `presentation_settings` in place; it is nullable and does not affect issued invoices. If an RPC issue appears, roll back the frontend deployment or hide Invoice Settings, then restore the prior `update_branch_invoice_settings(jsonb)` implementation from the verified hosted definition. Do not alter invoices, Storage, checkout, or Phase 5X. No historical data rollback is required.
