import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Camera, Plus, RefreshCw, Save, Search } from "lucide-react";
import type { Locale } from "./domain";
import type { MobileProfile } from "./mobileAuth";
import { loadOperationalModule, type OperationalModule as ReadModule } from "./mobileApi";
import {
  loadCategories,
  loadProductUnits,
  saveCategory,
  saveCustomer,
  saveExpense,
  saveProduct,
  saveProductBarcode,
  saveProductUnit,
  saveSupplier,
  adjustProductStock,
  type OperationalModule,
} from "./operationalApi";
import { scanSingleBarcode } from "./platform/scanner";

const modules = new Set<OperationalModule>(["categories", "products", "units", "barcodes", "stock", "customers", "suppliers", "purchases", "expenses"]);

const labels: Record<OperationalModule, [string, string]> = {
  categories: ["Categories", "الفئات"], products: ["Products", "المنتجات"], units: ["Units & packages", "الوحدات والعبوات"],
  barcodes: ["Product barcodes", "باركود المنتجات"], stock: ["Stock", "المخزون"], customers: ["Customers", "العملاء"],
  suppliers: ["Suppliers", "الموردون"], purchases: ["Purchases", "المشتريات"], expenses: ["Expenses", "المصروفات"],
};

function fieldValue(form: HTMLFormElement, name: string) {
  return String(new FormData(form).get(name) ?? "");
}

export function OperationalWorkflowScreen({ locale, profile, module, back }: { locale: Locale; profile: MobileProfile; module: OperationalModule; back: () => void }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [units, setUnits] = useState<Record<string, unknown>[]>([]);
  const [categories, setCategories] = useState<Record<string, unknown>[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const readModule = module === "categories" ? null : module === "units" || module === "barcodes" ? "products" : module as ReadModule;

  const reload = async () => {
    setError("");
    try {
      if (module === "categories") setRows(await loadCategories(profile));
      else if (readModule) {
        const result = await loadOperationalModule(profile, readModule);
        setRows(result);
        if (module === "products" || module === "stock" || module === "units" || module === "barcodes")
          setCategories(await loadCategories(profile));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Records could not be loaded."); }
  };
  useEffect(() => { void reload(); }, [module, profile]);
  useEffect(() => {
    const productId = selectedProductId || String(rows[0]?.id ?? "");
    if ((module === "units" || module === "barcodes") && productId) void loadProductUnits(profile, productId).then(setUnits).catch(() => setUnits([]));
    else setUnits([]);
  }, [module, rows, profile, selectedProductId]);

  const visible = useMemo(() => rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const title = labels[module][locale === "ar" ? 1 : 0];
  const unsupportedPurchase = module === "purchases";

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
    setBusy(true); setError(""); setNotice("");
    const form = event.currentTarget;
    try {
      if (module === "categories") await saveCategory(profile, { name: fieldValue(form, "name"), nameAr: fieldValue(form, "nameAr") });
      else if (module === "products") await saveProduct(profile, { name: fieldValue(form, "name"), nameAr: fieldValue(form, "nameAr"), categoryId: fieldValue(form, "categoryId") || null, price: Number(fieldValue(form, "price")), vatTreatment: fieldValue(form, "vatTreatment"), sku: fieldValue(form, "sku"), isService: formDataBool(form, "isService"), trackStock: formDataBool(form, "trackStock"), openingStockQuantity: Number(fieldValue(form, "openingStockQuantity") || 0) });
      else if (module === "customers") await saveCustomer(profile, { name: fieldValue(form, "name"), kind: fieldValue(form, "kind") === "business" ? "business" : "individual", phone: fieldValue(form, "phone"), vatNumber: fieldValue(form, "vatNumber") });
      else if (module === "suppliers") await saveSupplier(profile, { name: fieldValue(form, "name"), phone: fieldValue(form, "phone"), vatNumber: fieldValue(form, "vatNumber") });
      else if (module === "expenses") await saveExpense(profile, { date: fieldValue(form, "date"), description: fieldValue(form, "description"), amount: Number(fieldValue(form, "amount")), paymentMethod: fieldValue(form, "paymentMethod") });
      else if (module === "stock") await adjustProductStock(profile, fieldValue(form, "productId"), Number(fieldValue(form, "quantity")), fieldValue(form, "reason"));
      else if (module === "units") await saveProductUnit(profile, { productId: fieldValue(form, "productId"), name: fieldValue(form, "name"), conversionToBase: Number(fieldValue(form, "conversion")) });
      else if (module === "barcodes") await saveProductBarcode(profile, { unitId: fieldValue(form, "unitId"), barcode: fieldValue(form, "barcode") });
      setShowForm(false); setNotice(locale === "ar" ? "تم الحفظ" : "Saved"); await reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Save failed."); }
    finally { setBusy(false); }
  }

  const productOptions = rows.filter(row => row.id && (row.name || row.barcode));
  const unitOptions = units.filter(unit => unit.id);
  return <section className="operational-module">
    <header className="invoice-heading">
      <button className="round-button" onClick={back} aria-label="Back"><ArrowLeft /></button>
      <div><p>{locale === "ar" ? "العمليات" : "Operational workflows"}</p><h1>{title}</h1></div>
      <button className="round-button" onClick={() => void reload()} aria-label="Refresh"><RefreshCw /></button>
    </header>
    <div className="invoice-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={locale === "ar" ? "بحث" : "Search records"} /></div>
    <div className="workflow-actions">
      <button className="green-action" onClick={() => { setShowForm(true); setError(""); }} disabled={unsupportedPurchase}><Plus />{locale === "ar" ? "إضافة" : "Add"}</button>
      {notice && <span role="status">{notice}</span>}
    </div>
    {unsupportedPurchase && <div className="simulation-box"><b>{locale === "ar" ? "المشتريات تحتاج عقداً آمناً" : "Purchase posting is gated"}</b><span>{locale === "ar" ? "يتطلب النشر عقد حماية من التكرار على الخادم." : "The web insert/receiving path has no purchase-level idempotency key; mobile will not invent one."}</span></div>}
    {error && <p className="blocked-note" role="alert">{error}</p>}
    <div className="operational-list">{visible.map(row => <article key={String(row.id ?? JSON.stringify(row))}><span><b>{String(row.name ?? row.description ?? row.purchase_number ?? row.vendor_name ?? "Record")}</b><small>{String(row.barcode ?? row.phone ?? row.purchase_date ?? row.expense_date ?? row.status ?? "—")}</small></span><b>{row.total_amount != null ? String(row.total_amount) : row.total_paid != null ? String(row.total_paid) : row.stock_quantity != null ? String(row.stock_quantity) : ""}</b></article>)}{!visible.length && !error && <p className="blocked-note">{locale === "ar" ? "لا توجد سجلات." : "No records found."}</p>}</div>
    {showForm && <form className="workflow-form" onSubmit={submit}>
      <h2>{locale === "ar" ? `إضافة ${title}` : `Add ${title}`}</h2>
      {module === "categories" && <><label>Name<input name="name" required /></label><label>Arabic name<input name="nameAr" /></label></>}
      {(module === "products" || module === "customers" || module === "suppliers") && <><label>Name<input name="name" required /></label><label>Arabic name<input name="nameAr" /></label><label>Phone<input name="phone" inputMode="tel" /></label>{module !== "products" && <label>VAT number<input name="vatNumber" /></label>}</>}
      {module === "products" && <><label>Category<select name="categoryId" defaultValue=""><option value="">Uncategorised</option>{categories.map(category => <option key={String(category.id)} value={String(category.id)}>{String(category.name)}</option>)}</select></label><label>Selling price<input name="price" type="number" min="0" step="0.01" required /></label><label>SKU<input name="sku" /></label><label>VAT treatment<select name="vatTreatment" defaultValue="inherit"><option value="inherit">Inherit</option><option value="standard">Standard</option><option value="zero_rated">Zero rated</option><option value="exempt">Exempt</option></select></label><label>Opening stock<input name="openingStockQuantity" type="number" min="0" step="0.001" defaultValue="0" /></label><label><input name="trackStock" type="checkbox" /> Track stock</label><label><input name="isService" type="checkbox" /> Service product</label></>}
      {module === "customers" && <label>Type<select name="kind" defaultValue="individual"><option value="individual">Individual</option><option value="business">Business</option></select></label>}
      {module === "expenses" && <><label>Date<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Description<input name="description" required /></label><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Payment method<select name="paymentMethod" defaultValue="cash"><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label></>}
      {module === "stock" && <><label>Product<select name="productId" required>{productOptions.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label><label>Adjustment<input name="quantity" type="number" step="0.001" required /></label><label>Reason<input name="reason" required /></label></>}
      {module === "units" && <><label>Product<select name="productId" required value={selectedProductId || String(productOptions[0]?.id ?? "")} onChange={event => setSelectedProductId(event.target.value)}>{productOptions.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label><label>Package name<input name="name" required /></label><label>Conversion to base<input name="conversion" type="number" min="0.001" step="0.001" required /></label></>}
      {module === "barcodes" && <><label>Product<select name="productId" required value={selectedProductId || String(productOptions[0]?.id ?? "")} onChange={event => setSelectedProductId(event.target.value)}>{productOptions.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}</select></label><label>Unit<select name="unitId" required>{unitOptions.map(unit => <option key={String(unit.id)} value={String(unit.id)}>{String(unit.name ?? unit.unit_code)}</option>)}</select></label><label>Barcode<input name="barcode" inputMode="numeric" value={barcodeValue} onChange={event => setBarcodeValue(event.target.value)} required /></label><button type="button" className="text-button" onClick={() => void scanBarcode()}><Camera /> Scan with camera</button><small>Camera denied? Enter the barcode manually.</small></>}
      <div className="workflow-form-actions"><button type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="green-action" type="submit" disabled={busy}><Save />{busy ? "Saving…" : "Save"}</button></div>
    </form>}
  </section>;
}

function formDataBool(form: HTMLFormElement, name: string) { return new FormData(form).get(name) === "on"; }

export function isOperationalWorkflowModule(value: string): value is OperationalModule { return modules.has(value as OperationalModule); }
