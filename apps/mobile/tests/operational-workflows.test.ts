import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const api = read("src/operationalApi.ts");
const screen = read("src/OperationalWorkflowScreen.tsx");
const app = read("src/RedesignedApp.tsx");

for (const marker of [
  "loadCategories", "saveCategory", "saveProduct", "create_product_secure",
  "update_product_secure", "update_product_stock_settings", "get_product_units",
  "create_product_unit", "update_product_unit", "create_product_unit_barcode",
  "saveCustomer", "saveSupplier", "saveExpense", "PURCHASE_POSTING_REQUIRES_SERVER_IDEMPOTENCY",
  "setCategoryActive", "setProductActive", "setCustomerActive", "setSupplierActive",
  "deleteExpense", "loadStockMovementHistory", "createOperationId",
]) assert.ok((api + screen).includes(marker), `missing contract marker: ${marker}`);

assert.match(api, /isAuthorisedOperationalScope\(profile\)/);
assert.match(api, /tenant_id.*branch_id/);
assert.match(api, /idempotency_key/);
assert.match(api, /purchase_contract/);
assert.match(screen, /Operational workflows/);
assert.match(api, /duplicate/);
assert.match(screen, /scanSingleBarcode/);
assert.match(screen, /Camera permission is required/);
assert.match(screen, /Movement history/);
assert.match(screen, /unit_name/);
assert.match(screen, /Deactivate/);
assert.match(screen, /Retry after an uncertain response keeps this operation ID/);
for (const module of ["categories", "products", "units", "barcodes", "stock", "customers", "suppliers", "purchases", "expenses"])
  assert.match(screen, new RegExp(`"${module}"`));
assert.match(app, /OperationalWorkflowScreen/);

console.log("Mobile operational workflow contract markers passed");
