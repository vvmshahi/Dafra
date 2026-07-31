import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, Camera, Pencil, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import type { Locale } from "./domain";
import type { MobileProfile } from "./mobileAuth";
import { loadOperationalModule, type OperationalModule as ReadModule } from "./mobileApi";
import {
  adjustProductStock,
  createOperationId,
  deleteExpense,
  loadCategories,
  loadProductUnits,
  loadStockMovementHistory,
  saveCategory,
  saveCustomer,
  saveExpense,
  saveProduct,
  saveProductBarcode,
  saveProductUnit,
  saveSupplier,
  setCategoryActive,
  setCustomerActive,
  setProductActive,
  setSupplierActive,
  type OperationalModule,
} from "./operationalApi";
import { scanSingleBarcode } from "./platform/scanner";

type Row = Record<string, unknown>;

const modules = new Set<OperationalModule>([
  "categories", "products", "units", "barcodes", "stock", "customers", "suppliers", "purchases", "expenses",
]);

const labels: Record<OperationalModule, [string, string]> = {
  categories: ["Categories", "الفئات"],
  products: ["Products", "المنتجات"],
  units: ["Units & packages", "الوحدات والعبوات"],
  barcodes: ["Product barcodes", "باركود المنتجات"],
  stock: ["Stock", "المخزون"],
  customers: ["Customers", "العملاء"],
  suppliers: ["Suppliers", "الموردون"],
  purchases: ["Purchases", "المشتريات"],
  expenses: ["Expenses", "المصروفات"],
};

function fieldValue(form: HTMLFormElement, name: string) {
  return String(new FormData(form).get(name) ?? "");
}

function rowText(row: Row | null, field: string, fallback = "") {
  const value = row?.[field];
  return value == null ? fallback : String(value);
}

function rowBool(row: Row | null, field: string, fallback = false) {
  return typeof row?.[field] === "boolean" ? Boolean(row[field]) : fallback;
}

function rowId(row: Row | null) {
  return rowText(row, "id");
}

function displayName(row: Row) {
  return rowText(row, "name") || rowText(row, "description") || rowText(row, "purchase_number") || rowText(row, "vendor_name") || "Record";
}

function displayDetail(row: Row) {
  return rowText(row, "barcode") || rowText(row, "phone") || rowText(row, "purchase_date") || rowText(row, "expense_date") || rowText(row, "status") || "—";
}

function displayAmount(row: Row) {
  for (const field of ["total_amount", "total_paid", "stock_quantity"]) {
    if (row[field] != null) return String(row[field]);
  }
  return "";
}

export function OperationalWorkflowScreen({
  locale,
  profile,
  module,
  back,
}: {
  locale: Locale;
  profile: MobileProfile;
  module: OperationalModule;
  back: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [units, setUnits] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [movements, setMovements] = useState<Row[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [operationId, setOperationId] = useState("");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const readModule: ReadModule | null = module === "categories" || module === "units" || module === "barcodes"
    ? module === "categories" ? null : "products"
    : module as ReadModule;
  const unsupportedPurchase = module === "purchases";
  const title = labels[module][locale === "ar" ? 1 : 0];

  const reload = async () => {
    setError("");
    try {
      if (module === "categories") {
        setRows(await loadCategories(profile));
        setMovements([]);
        return;
      }
      if (module === "stock") {
        const [products, loadedCategories, history] = await Promise.all([
          loadOperationalModule(profile, "stock"),
          loadCategories(profile),
          loadStockMovementHistory(profile),
        ]);
        setRows(products);
        setCategories(loadedCategories);
        setMovements(history);
        return;
      }
      if (readModule) {
        const result = await loadOperationalModule(profile, readModule);
        setRows(result);
        setMovements([]);
        if (module === "products" || module === "units" || module === "barcodes")
          setCategories(await loadCategories(profile));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Records could not be loaded.");
    }
  };

  useEffect(() => {
    setShowForm(false);
    setEditing(null);
    setSelectedProductId("");
    setOperationId("");
    void reload();
  }, [module, profile]);

  useEffect(() => {
    const productId = selectedProductId || rowText(rows[0] ?? null, "id");
    if ((module === "units" || module === "barcodes") && productId) {
      void loadProductUnits(profile, productId).then(setUnits).catch(() => setUnits([]));
    } else {
      setUnits([]);
    }
  }, [module, profile, rows, selectedProductId]);

  const visible = useMemo(
    () => rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())),
    [rows, query],
  );
  const visibleMovements = useMemo(
    () => movements.filter((movement) => JSON.stringify(movement).toLowerCase().includes(query.toLowerCase())),
    [movements, query],
  );
  const productOptions = rows.filter((row) => row.id && (row.name || row.barcode));
  const unitOptions = units.filter((unit) => unit.id);
  const editable = ["categories", "products", "customers", "suppliers", "expenses"].includes(module);
  const canToggleActive = ["categories", "products", "customers", "suppliers"].includes(module);

  function openForm(row: Row | null = null) {
    setEditing(row);
    setBarcodeValue("");
    setError("");
    setNotice("");
    if (module === "stock") setOperationId(createOperationId("stock"));
    setShowForm(true);
  }

  function closeForm(force = false) {
    if (busy && !force) return;
    setShowForm(false);
    setEditing(null);
    setBarcodeValue("");
    setOperationId("");
  }

  async function scanBarcode() {
    try {
      const value = await scanSingleBarcode();
      if (value) setBarcodeValue(value);
      else setError(locale === "ar" ? "لم يتم التقاط باركود." : "No barcode was captured.");
    } catch {
      setError(locale === "ar" ? "يلزم السماح للكاميرا. يمكنك إدخال الباركود يدوياً." : "Camera permission is required. Enter the barcode manually instead.");
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || unsupportedPurchase) return;
    setBusy(true);
    setError("");
    setNotice("");
    const form = event.currentTarget;
    const id = rowId(editing) || undefined;
    try {
      if (module === "categories") {
        await saveCategory(profile, {
          id,
          name: fieldValue(form, "name"),
          nameAr: fieldValue(form, "nameAr"),
          description: fieldValue(form, "description"),
          color: rowText(editing, "color", "#1c5c2e"),
          icon: rowText(editing, "icon"),
          sortOrder: Number(rowText(editing, "sort_order", "0")),
        });
      } else if (module === "products") {
        const trackStock = formDataBool(form, "trackStock");
        const isService = formDataBool(form, "isService");
        if (trackStock && isService) throw new Error("Service products cannot track stock.");
        await saveProduct(profile, {
          id,
          name: fieldValue(form, "name"),
          nameAr: fieldValue(form, "nameAr"),
          categoryId: fieldValue(form, "categoryId") || null,
          price: Number(fieldValue(form, "price")),
          vatTreatment: fieldValue(form, "vatTreatment"),
          sku: fieldValue(form, "sku"),
          description: fieldValue(form, "description"),
          isAvailable: formDataBool(form, "isAvailable"),
          isService,
          trackStock,
          previousTrackStock: rowBool(editing, "track_stock"),
          openingStockQuantity: Number(fieldValue(form, "openingStockQuantity") || 0),
        });
      } else if (module === "customers") {
        const kind = fieldValue(form, "kind") === "business" ? "business" : "individual";
        await saveCustomer(profile, {
          id,
          name: fieldValue(form, "name"),
          nameAr: fieldValue(form, "nameAr"),
          businessName: fieldValue(form, "businessName"),
          kind,
          phone: fieldValue(form, "phone"),
          email: fieldValue(form, "email"),
          vatNumber: fieldValue(form, "vatNumber"),
          crNumber: fieldValue(form, "crNumber"),
          city: fieldValue(form, "city"),
          address: fieldValue(form, "address"),
          notes: fieldValue(form, "notes"),
        });
      } else if (module === "suppliers") {
        await saveSupplier(profile, {
          id,
          name: fieldValue(form, "name"),
          nameAr: fieldValue(form, "nameAr"),
          contactPerson: fieldValue(form, "contactPerson"),
          phone: fieldValue(form, "phone"),
          email: fieldValue(form, "email"),
          vatNumber: fieldValue(form, "vatNumber"),
          crNumber: fieldValue(form, "crNumber"),
          city: fieldValue(form, "city"),
          address: fieldValue(form, "address"),
          paymentTerms: fieldValue(form, "paymentTerms"),
          notes: fieldValue(form, "notes"),
        });
      } else if (module === "expenses") {
        await saveExpense(profile, {
          id,
          date: fieldValue(form, "date"),
          description: fieldValue(form, "description"),
          vendorName: fieldValue(form, "vendorName"),
          amount: Number(fieldValue(form, "amount")),
          paymentMethod: fieldValue(form, "paymentMethod"),
          notes: fieldValue(form, "notes"),
        });
      } else if (module === "stock") {
        await adjustProductStock(profile, fieldValue(form, "productId"), Number(fieldValue(form, "quantity")), operationId);
      } else if (module === "units") {
        await saveProductUnit(profile, {
          productId: fieldValue(form, "productId"),
          name: fieldValue(form, "name"),
          conversionToBase: Number(fieldValue(form, "conversion")),
        });
      } else if (module === "barcodes") {
        await saveProductBarcode(profile, { unitId: fieldValue(form, "unitId"), barcode: fieldValue(form, "barcode") });
      }
      closeForm(true);
      setNotice(locale === "ar" ? "تم الحفظ" : "Saved");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: Row) {
    const id = rowId(row);
    if (!id || busy) return;
    const active = rowBool(row, "is_active", rowBool(row, "is_available", true));
    setBusy(true);
    setError("");
    try {
      if (module === "categories") await setCategoryActive(profile, id, !active);
      else if (module === "products") await setProductActive(profile, id, !active);
      else if (module === "customers") await setCustomerActive(profile, id, !active);
      else if (module === "suppliers") await setSupplierActive(profile, id, !active);
      setNotice(!active ? "Activated" : "Deactivated");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Status could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeExpense(row: Row) {
    const id = rowId(row);
    if (!id || busy) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this expense? This uses the current web-authorised expense policy.")) return;
    setBusy(true);
    setError("");
    try {
      await deleteExpense(profile, id);
      setNotice("Expense deleted");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Expense could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="operational-module">
      <header className="invoice-heading">
        <button className="round-button" onClick={back} aria-label="Back"><ArrowLeft /></button>
        <div><p>{locale === "ar" ? "العمليات" : "Operational workflows"}</p><h1>{title}</h1></div>
        <button className="round-button" onClick={() => void reload()} aria-label="Refresh"><RefreshCw /></button>
      </header>
      <div className="invoice-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={locale === "ar" ? "بحث" : "Search records"} /></div>
      <div className="workflow-actions">
        <button className="green-action" onClick={() => openForm()} disabled={unsupportedPurchase || busy}><Plus />{locale === "ar" ? "إضافة" : "Add"}</button>
        {notice && <span role="status">{notice}</span>}
      </div>
      {unsupportedPurchase && <div className="simulation-box"><b>{locale === "ar" ? "المشتريات تحتاج عقداً آمناً" : "Purchase posting is gated"}</b><span>{locale === "ar" ? "يتطلب النشر عقد حماية من التكرار على الخادم." : "The web insert/receiving path has no purchase-level idempotency key; mobile will not invent one."}</span></div>}
      {module === "stock" && <div className="simulation-box"><b>Authoritative history coverage</b><span>Inventory adjustments and purchase receiving are read from authenticated ledgers. POS product sale, return, and manual-adjustment rows stay service-only until a reviewed reporting RPC is available.</span></div>}
      {error && <p className="blocked-note" role="alert">{error}</p>}
      <div className="operational-list">
        {visible.map((row) => {
          const active = rowBool(row, "is_active", rowBool(row, "is_available", true));
          return <article key={rowId(row) || JSON.stringify(row)}>
            <span><b>{displayName(row)}</b><small>{displayDetail(row)}</small></span>
            <span className="workflow-row-actions">
              <b>{displayAmount(row)}</b>
              {editable && <button type="button" className="workflow-secondary" onClick={() => openForm(row)} disabled={busy}><Pencil /> Edit</button>}
              {canToggleActive && <button type="button" className="workflow-secondary" onClick={() => void toggleActive(row)} disabled={busy}><Archive /> {active ? "Deactivate" : "Activate"}</button>}
              {module === "expenses" && <button type="button" className="workflow-secondary danger" onClick={() => void removeExpense(row)} disabled={busy}><Trash2 /> Delete</button>}
            </span>
          </article>;
        })}
        {!visible.length && !error && <p className="blocked-note">{locale === "ar" ? "لا توجد سجلات." : "No records found."}</p>}
      </div>
      {module === "stock" && <section className="workflow-history" aria-label="Stock movement history">
        <h2>Movement history</h2>
        {visibleMovements.map((movement) => <article key={rowId(movement)}>
          <span><b>{rowText(movement, "item_name", "Stock item")}</b><small>{rowText(movement, "unit_name", "Base unit")} · {rowText(movement, "source_type")} · {rowText(movement, "reason")} · {rowText(movement, "created_at")}</small><small>{rowText(movement, "source_reference") || "No source reference"}</small></span>
          <span><b>{rowText(movement, "quantity_delta")}</b><small>{rowText(movement, "quantity_before", "—")} → {rowText(movement, "quantity_after", "—")}</small></span>
        </article>)}
        {!visibleMovements.length && !error && <p className="blocked-note">No authorised movement rows found.</p>}
      </section>}
      {showForm && <form className="workflow-form" onSubmit={submit}>
        <h2>{editing ? `Edit ${title}` : `Add ${title}`}</h2>
        {module === "categories" && <><label>Name<input name="name" required defaultValue={rowText(editing, "name")} /></label><label>Arabic name<input name="nameAr" defaultValue={rowText(editing, "name_ar")} /></label><label>Description<input name="description" defaultValue={rowText(editing, "description")} /></label></>}
        {module === "products" && <><label>Name<input name="name" required defaultValue={rowText(editing, "name")} /></label><label>Arabic name<input name="nameAr" defaultValue={rowText(editing, "name_ar")} /></label><label>Category<select name="categoryId" defaultValue={rowText(editing, "category_id")}><option value="">Uncategorised</option>{categories.map((category) => <option key={rowId(category)} value={rowId(category)}>{rowText(category, "name")}</option>)}</select></label><label>Selling price<input name="price" type="number" min="0" step="0.01" required defaultValue={rowText(editing, "price")} /></label><label>SKU<input name="sku" defaultValue={rowText(editing, "sku")} /></label><label>VAT treatment<select name="vatTreatment" defaultValue={rowText(editing, "vat_treatment", "inherit")}><option value="inherit">Inherit</option><option value="exclusive">Exclusive</option><option value="inclusive">Inclusive</option><option value="exempt">Exempt</option></select></label><label>Description<input name="description" defaultValue={rowText(editing, "description")} /></label>{!editing && <label>Opening stock<input name="openingStockQuantity" type="number" min="0" step="0.001" defaultValue="0" /></label>}<label><input name="isAvailable" type="checkbox" defaultChecked={rowBool(editing, "is_available", true)} /> Available for sale</label><label><input name="trackStock" type="checkbox" defaultChecked={rowBool(editing, "track_stock")} /> Track stock</label><label><input name="isService" type="checkbox" defaultChecked={rowBool(editing, "is_service")} /> Service product</label></>}
        {module === "customers" && <><label>Name<input name="name" required defaultValue={rowText(editing, "name")} /></label><label>Arabic name<input name="nameAr" defaultValue={rowText(editing, "name_ar")} /></label><label>Type<select name="kind" defaultValue={rowText(editing, "customer_type", "individual")}><option value="individual">Individual</option><option value="business">Business</option></select></label><label>Business name<input name="businessName" defaultValue={rowText(editing, "business_name", rowText(editing, "company_name"))} /></label><label>VAT number<input name="vatNumber" defaultValue={rowText(editing, "vat_number")} /></label><label>CR number<input name="crNumber" defaultValue={rowText(editing, "cr_number")} /></label><label>Phone<input name="phone" inputMode="tel" defaultValue={rowText(editing, "phone")} /></label><label>Email<input name="email" inputMode="email" defaultValue={rowText(editing, "email")} /></label><label>City<input name="city" defaultValue={rowText(editing, "city")} /></label><label>Address<input name="address" defaultValue={rowText(editing, "address")} /></label><label>Notes<input name="notes" defaultValue={rowText(editing, "notes")} /></label></>}
        {module === "suppliers" && <><label>Name<input name="name" required defaultValue={rowText(editing, "name")} /></label><label>Arabic name<input name="nameAr" defaultValue={rowText(editing, "name_ar")} /></label><label>Contact person<input name="contactPerson" defaultValue={rowText(editing, "contact_person")} /></label><label>VAT number<input name="vatNumber" defaultValue={rowText(editing, "vat_number")} /></label><label>CR number<input name="crNumber" defaultValue={rowText(editing, "cr_number")} /></label><label>Phone<input name="phone" inputMode="tel" defaultValue={rowText(editing, "phone")} /></label><label>Email<input name="email" inputMode="email" defaultValue={rowText(editing, "email")} /></label><label>City<input name="city" defaultValue={rowText(editing, "city")} /></label><label>Address<input name="address" defaultValue={rowText(editing, "address")} /></label><label>Payment terms<select name="paymentTerms" defaultValue={rowText(editing, "payment_terms", "cash")}><option value="cash">Cash</option><option value="credit_30">30 days</option><option value="credit_60">60 days</option></select></label><label>Notes<input name="notes" defaultValue={rowText(editing, "notes")} /></label></>}
        {module === "expenses" && <><label>Date<input name="date" type="date" required defaultValue={rowText(editing, "expense_date", new Date().toISOString().slice(0, 10))} /></label><label>Description<input name="description" required defaultValue={rowText(editing, "description")} /></label><label>Vendor<input name="vendorName" defaultValue={rowText(editing, "vendor_name")} /></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={rowText(editing, "amount", rowText(editing, "total_paid"))} /></label><label>Payment method<select name="paymentMethod" defaultValue={rowText(editing, "payment_method", "cash")}><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label><label>Notes<input name="notes" defaultValue={rowText(editing, "notes")} /></label></>}
        {module === "stock" && <><label>Product<select name="productId" required>{productOptions.map((row) => <option key={rowId(row)} value={rowId(row)}>{rowText(row, "name")}</option>)}</select></label><label>Adjustment<input name="quantity" type="number" step="0.001" required /></label><small>Manual adjustment is recorded by the approved server RPC. Retry after an uncertain response keeps this operation ID: {operationId}</small></>}
        {module === "units" && <><label>Product<select name="productId" required value={selectedProductId || rowId(productOptions[0] ?? null)} onChange={(event) => setSelectedProductId(event.target.value)}>{productOptions.map((row) => <option key={rowId(row)} value={rowId(row)}>{rowText(row, "name")}</option>)}</select></label><label>Package name<input name="name" required /></label><label>Conversion to base<input name="conversion" type="number" min="0.001" step="0.001" required /></label></>}
        {module === "barcodes" && <><label>Product<select name="productId" required value={selectedProductId || rowId(productOptions[0] ?? null)} onChange={(event) => setSelectedProductId(event.target.value)}>{productOptions.map((row) => <option key={rowId(row)} value={rowId(row)}>{rowText(row, "name")}</option>)}</select></label><label>Unit<select name="unitId" required>{unitOptions.map((unit) => <option key={rowId(unit)} value={rowId(unit)}>{rowText(unit, "name", rowText(unit, "unit_code"))}</option>)}</select></label><label>Barcode<input name="barcode" inputMode="numeric" value={barcodeValue} onChange={(event) => setBarcodeValue(event.target.value)} required /></label><button type="button" className="text-button" onClick={() => void scanBarcode()}><Camera /> Scan with camera</button><small>Camera denied? Enter the barcode manually.</small></>}
        <div className="workflow-form-actions"><button type="button" onClick={() => closeForm()}>Cancel</button><button className="green-action" type="submit" disabled={busy}><Save />{busy ? "Saving…" : "Save"}</button></div>
      </form>}
    </section>
  );
}

function formDataBool(form: HTMLFormElement, name: string) {
  return new FormData(form).get(name) === "on";
}

export function isOperationalWorkflowModule(value: string): value is OperationalModule {
  return modules.has(value as OperationalModule);
}
