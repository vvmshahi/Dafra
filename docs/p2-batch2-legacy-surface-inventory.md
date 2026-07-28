# P2 Batch 2 legacy surface inventory

| Component | Route / workflow | Reachable | Unique business logic | Centered replacement | Action |
| --- | --- | --- | --- | --- | --- |
| `StockItemModal` (formerly `StockItemDrawer`) | Stock → Materials & Supplies → Add/Edit | Yes | `inventory_items` create/update plus audited quantity RPC | This batch | Migrated; one centered Add/Edit component |
| `ProductDrawer` main editor | Products and Stock product actions | Yes | Product, stock settings, units, and barcode orchestration | Already centered | Retain; filename is historical |
| `ProductDrawer` tracked-product success subflow | Product create → opening stock choice | Yes | Routes the created product to Add Stock | This batch | Migrated from 480px right panel to centered dialog |
| `ProductStockReceiptDrawer` | Stock → Add Stock | Yes | `receive_product_stock` contract and receiving-unit validation | Already centered | Retain; filename is historical |
| `PurchaseBillModal` | Purchases → New/Edit supplier bill | Yes | Version 1 supplier-bill payload | Yes | Retain as active Version 1 entry point |
| `PurchaseDrawer` | Legacy detailed purchase receiving | No active new-purchase entry point; referenced by regression/contract audits | Historical receiving payload and inventory contracts | N/A | Retain temporarily; changing/removing it risks historical/backend-dependent behavior |
| `PurchaseDetailModal` | Purchases → View historical record | Yes | Read-only detailed lines and bill attachment | Already centered | Retain |
| `BarcodeBatchPrintDrawer` | Products → Print labels | Yes | Batch queue, barcode validation, preview, print audit | Already centered | Retain; filename is historical |
| `EmployeeDrawer` | Employees Add/Edit | Yes | Employee and auth/user workflow | No | Retain; outside named Batch 2 primary targets |
| `BranchDrawer` | Settings → Branch Add/Edit | Yes | Branch, login, module and policy settings | No | Retain; broad settings workflow deferred |
| Official seller confirmation overlay | Settings → Official seller profile | Yes | Acknowledgement and official-profile mutation | No shared conversion yet | Retain; outside target flows and requires a focused settings pass |

No component was removed solely because its filename contains `Drawer`.
