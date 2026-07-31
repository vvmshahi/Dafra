import { Preferences } from "@capacitor/preferences";
import type { MobileProfile } from "./mobileAuth";
import { supabase } from "./mobileAuth";
import { isAuthorisedOperationalScope } from "./mobileApi";

export type OperationalRecord = Record<string, unknown> & { id?: string };

export type OperationalModule =
  | "categories"
  | "products"
  | "units"
  | "barcodes"
  | "stock"
  | "customers"
  | "suppliers"
  | "purchases"
  | "expenses";

export class OperationalContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OperationalContractError";
    this.code = code;
  }
}

function db() {
  if (!supabase) throw new OperationalContractError("not_configured", "Mobile data is not configured.");
  return supabase as any;
}

function writeScope(profile: MobileProfile) {
  if (!profile.tenantId || !profile.branchId)
    throw new OperationalContractError("missing_scope", "A tenant and Branch scope are required.");
  if (!isAuthorisedOperationalScope(profile))
    throw new OperationalContractError("unauthorised_scope", "Operational writes are not authorised for this build and Branch.");
  return { tenantId: profile.tenantId, branchId: profile.branchId };
}

function clean(value: string | null | undefined) {
  return value?.trim() || null;
}

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new OperationalContractError("validation", `${field} is required.`);
  return normalized;
}

function requestKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function once(key: string) {
  const storageKey = `kubri-mobile-operation:${key}`;
  const existing = await Preferences.get({ key: storageKey });
  if (existing.value) throw new OperationalContractError("duplicate", "This operation has already been submitted.");
  await Preferences.set({ key: storageKey, value: new Date().toISOString() });
  return storageKey;
}

export async function loadCategories(profile: MobileProfile) {
  if (!profile.branchId) throw new OperationalContractError("missing_scope", "Branch scope is unavailable.");
  const result = await db().from("categories").select("*")
    .eq("tenant_id", profile.tenantId).eq("branch_id", profile.branchId)
    .order("sort_order", { ascending: true }).order("name");
  if (result.error) throw new OperationalContractError("load_failed", "Categories could not be loaded.");
  return (result.data ?? []) as OperationalRecord[];
}

export async function saveCategory(profile: MobileProfile, input: { id?: string; name: string; nameAr?: string; color?: string; icon?: string }) {
  const scope = writeScope(profile);
  const name = requireText(input.name, "Category name");
  const key = await once(requestKey("category"));
  const payload = { tenant_id: scope.tenantId, branch_id: scope.branchId, name, name_ar: clean(input.nameAr), color: input.color || "#1c5c2e", icon: clean(input.icon) };
  const query = input.id
    ? db().from("categories").update(payload).eq("id", input.id).eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId)
    : db().from("categories").insert({ ...payload, sort_order: 0 });
  const result = await query;
  await Preferences.remove({ key });
  if (result.error) throw new OperationalContractError(result.error.code === "23505" ? "duplicate" : "save_failed", "Category could not be saved.");
}

export async function setCategoryActive(profile: MobileProfile, id: string, active: boolean) {
  const scope = writeScope(profile);
  const result = await db().from("categories").update({ is_active: active }).eq("id", id)
    .eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId);
  if (result.error) throw new OperationalContractError("save_failed", "Category state could not be changed.");
}

export async function setProductActive(profile: MobileProfile, id: string, active: boolean) {
  const scope = writeScope(profile);
  const result = await db().from("products").update({ is_active: active, is_available: active })
    .eq("id", id).eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId);
  if (result.error) throw new OperationalContractError("save_failed", "Product state could not be changed.");
}

export interface ProductInput {
  id?: string;
  name: string;
  nameAr?: string;
  description?: string;
  categoryId?: string | null;
  price: number;
  vatTreatment?: string;
  isAvailable?: boolean;
  isService?: boolean;
  trackStock?: boolean;
  openingStockQuantity?: number;
  minStockAlert?: number;
  sku?: string;
  notes?: string;
  adjustmentQuantity?: number;
  adjustmentReason?: string;
}

export async function saveProduct(profile: MobileProfile, input: ProductInput) {
  const scope = writeScope(profile);
  const name = requireText(input.name, "Product name");
  if (!Number.isFinite(input.price) || input.price < 0) throw new OperationalContractError("validation", "Selling price must be zero or greater.");
  const key = await once(requestKey("product"));
  const payload: Record<string, unknown> = {
    name, name_ar: clean(input.nameAr), category_id: input.categoryId || null,
    description: clean(input.description), price: input.price, vat_treatment: input.vatTreatment || "inherit",
    image_url: null, is_available: input.isAvailable !== false, is_service: input.isService === true, sort_order: 0,
    sku: clean(input.sku), notes: clean(input.notes),
  };
  const rpc = input.id ? "update_product_secure" : "create_product_secure";
  const result = await db().rpc(rpc, { p_payload: input.id ? { ...payload, product_id: input.id } : { ...payload, branch_id: scope.branchId } });
  if (result.error) { await Preferences.remove({ key }); throw new OperationalContractError("save_failed", "Product could not be saved."); }
  const productId = String(result.data?.product_id ?? input.id ?? "");
  if (productId && (input.trackStock !== undefined || input.adjustmentQuantity)) {
    const stockPayload: Record<string, unknown> = { product_id: productId };
    if (input.trackStock !== undefined) {
      stockPayload.track_stock = input.trackStock;
      stockPayload.reason = input.trackStock ? "opening_stock" : "tracking_disabled";
      if (input.trackStock) stockPayload.opening_stock_quantity = input.openingStockQuantity ?? 0;
    }
    if (input.adjustmentQuantity) {
      stockPayload.adjustment_quantity = input.adjustmentQuantity;
      stockPayload.reason = "manual_adjustment";
      stockPayload.idempotency_key = key;
    }
    const stock = await db().rpc("update_product_stock_settings", { p_payload: stockPayload });
    if (stock.error) { await Preferences.remove({ key }); throw new OperationalContractError("stock_failed", "Product saved but stock settings were not updated."); }
  }
  await Preferences.remove({ key });
  return productId;
}

export async function loadProductUnits(profile: MobileProfile, productId: string) {
  if (!profile.branchId) throw new OperationalContractError("missing_scope", "Branch scope is unavailable.");
  const result = await db().rpc("get_product_units", { p_product_id: productId });
  if (result.error) throw new OperationalContractError("load_failed", "Product units could not be loaded.");
  return (result.data ?? []) as OperationalRecord[];
}

export async function saveProductUnit(profile: MobileProfile, input: { productId: string; id?: string; name: string; nameAr?: string; conversionToBase: number; pricingMethod?: "calculated" | "custom"; customSellingPrice?: number }) {
  writeScope(profile);
  const name = requireText(input.name, "Unit name");
  if (!Number.isFinite(input.conversionToBase) || input.conversionToBase <= 0) throw new OperationalContractError("validation", "Conversion must be greater than zero.");
  const payload: Record<string, unknown> = {
    product_id: input.productId, name, name_ar: clean(input.nameAr), unit_code: "pkg",
    conversion_to_base: input.conversionToBase, quantity_scale: 3,
    pricing_method: input.pricingMethod || "calculated",
    custom_selling_price: input.pricingMethod === "custom" ? input.customSellingPrice ?? null : null,
    selling_enabled: true, receiving_enabled: true, sort_order: 0,
  };
  if (input.id) { payload.product_unit_id = input.id; payload.expected_version = 1; }
  const result = await db().rpc(input.id ? "update_product_unit" : "create_product_unit", { p_payload: payload });
  if (result.error) throw new OperationalContractError("save_failed", "Unit could not be saved.");
}

export async function saveProductBarcode(profile: MobileProfile, input: { unitId: string; barcode?: string; barcodeType?: string; primary?: boolean }) {
  writeScope(profile);
  const barcode = requireText(input.barcode || "", "Barcode");
  if (!/^[0-9A-Za-z-]{4,64}$/.test(barcode)) throw new OperationalContractError("validation", "Barcode contains unsupported characters.");
  const result = await db().rpc("create_product_unit_barcode", { p_payload: { product_unit_id: input.unitId, barcode, barcode_type: input.barcodeType || "unknown", source: "mobile", is_primary: input.primary !== false } });
  if (result.error) throw new OperationalContractError(result.error.code === "23505" ? "duplicate" : "save_failed", "Barcode could not be saved.");
}

export async function adjustProductStock(profile: MobileProfile, productId: string, quantity: number, reason: string) {
  writeScope(profile);
  if (!Number.isFinite(quantity) || quantity === 0) throw new OperationalContractError("validation", "Enter a non-zero stock adjustment.");
  const key = await once(requestKey("stock"));
  const result = await db().rpc("update_product_stock_settings", { p_payload: { product_id: productId, adjustment_quantity: quantity, reason: requireText(reason, "Adjustment reason"), idempotency_key: key } });
  await Preferences.remove({ key });
  if (result.error) throw new OperationalContractError("save_failed", "Stock adjustment was rejected.");
}

export async function saveCustomer(profile: MobileProfile, input: { id?: string; name: string; nameAr?: string; kind: "individual" | "business"; phone?: string; email?: string; vatNumber?: string; crNumber?: string; address?: string }) {
  const scope = writeScope(profile);
  const name = requireText(input.name, "Customer name");
  if (input.kind === "business" && !clean(input.vatNumber)) throw new OperationalContractError("validation", "Business customers require a VAT number.");
  const payload = { tenant_id: scope.tenantId, branch_id: scope.branchId, name, name_ar: clean(input.nameAr), customer_type: input.kind, business_name: input.kind === "business" ? name : null, phone: clean(input.phone), email: clean(input.email), vat_number: input.kind === "business" ? clean(input.vatNumber) : null, cr_number: input.kind === "business" ? clean(input.crNumber) : null, address: clean(input.address) };
  const key = await once(requestKey("customer"));
  const result = input.id ? await db().from("customers").update(payload).eq("id", input.id).eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId) : await db().from("customers").insert(payload);
  await Preferences.remove({ key });
  if (result.error) throw new OperationalContractError(result.error.code === "23505" ? "duplicate" : "save_failed", "Customer could not be saved.");
}

export async function setCustomerActive(profile: MobileProfile, id: string, active: boolean) {
  const scope = writeScope(profile);
  const result = await db().from("customers").update({ is_active: active })
    .eq("id", id).eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId);
  if (result.error) throw new OperationalContractError("save_failed", "Customer state could not be changed.");
}

export async function saveSupplier(profile: MobileProfile, input: { id?: string; name: string; nameAr?: string; phone?: string; email?: string; vatNumber?: string; crNumber?: string; address?: string }) {
  const scope = writeScope(profile);
  const name = requireText(input.name, "Supplier name");
  const payload = { tenant_id: scope.tenantId, branch_id: scope.branchId, name, name_ar: clean(input.nameAr), phone: clean(input.phone), email: clean(input.email), vat_number: clean(input.vatNumber), cr_number: clean(input.crNumber), address: clean(input.address) };
  const key = await once(requestKey("supplier"));
  const result = input.id ? await db().from("suppliers").update(payload).eq("id", input.id).eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId) : await db().from("suppliers").insert(payload);
  await Preferences.remove({ key });
  if (result.error) throw new OperationalContractError(result.error.code === "23505" ? "duplicate" : "save_failed", "Supplier could not be saved.");
}

export async function setSupplierActive(profile: MobileProfile, id: string, active: boolean) {
  const scope = writeScope(profile);
  const result = await db().from("suppliers").update({ is_active: active })
    .eq("id", id).eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId);
  if (result.error) throw new OperationalContractError("save_failed", "Supplier state could not be changed.");
}

export async function saveExpense(profile: MobileProfile, input: { id?: string; date: string; description: string; amount: number; paymentMethod: string; notes?: string }) {
  const scope = writeScope(profile);
  const description = requireText(input.description, "Expense description");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new OperationalContractError("validation", "Expense amount must be greater than zero.");
  const payload = { tenant_id: scope.tenantId, branch_id: scope.branchId, added_by: profile.id, expense_date: input.date, description, amount: input.amount, vat_treatment: "none", vat_claim_status: "not_claimable", expense_before_vat: input.amount, vat_amount: 0, total_paid: input.amount, payment_method: requireText(input.paymentMethod, "Payment method"), notes: clean(input.notes) };
  const key = await once(requestKey("expense"));
  const result = input.id ? await db().from("expenses").update(payload).eq("id", input.id).eq("tenant_id", scope.tenantId).eq("branch_id", scope.branchId) : await db().from("expenses").insert(payload);
  await Preferences.remove({ key });
  if (result.error) throw new OperationalContractError("save_failed", "Expense could not be saved.");
}

export const PURCHASE_POSTING_REQUIRES_SERVER_IDEMPOTENCY = true;

export function assertPurchasePostingAvailable() {
  throw new OperationalContractError("purchase_contract", "Purchase posting requires a reviewed server idempotency contract; the mobile client will not invent one.");
}
