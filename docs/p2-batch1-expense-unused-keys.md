# Expenses translation unused-key candidates

These keys are retained because their use through dynamic translation paths or
older supported screens is uncertain:

- `deleteConfirm`
- `deleteFixedConfirm`
- `ui.removeConfirm`
- `ui.drawerHint`
- `actions.uploadReceipt`
- `actions.removeReceipt`
- `type.recurring`
- `type.one_time`
- `type.taxable`
- `type.non_taxable`
- `status.paused`
- `status.completed`
- `status.pending`
- `status.overdue`

The duplicate top-level `fixed` string and ambiguous top-level `daily` tab
string were removed. Tab labels now live only at `tabs.daily` and `tabs.fixed`;
the remaining `fixed` key is exclusively the Fixed Expense object namespace.
