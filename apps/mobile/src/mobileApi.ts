import type { Customer, Product } from "./domain";
import type { MobileProfile } from "./mobileAuth";
import { supabase } from "./mobileAuth";

export type AccessMode =
  | "read-only"
  | "operational-writes"
  | "production-checkout";
export const accessMode = (import.meta.env.VITE_MOBILE_ACCESS_MODE ||
  "read-only") as AccessMode;
const authorisedTenant = import.meta.env.VITE_MOBILE_AUTHORISED_TENANT_ID || "";
const authorisedBranch = import.meta.env.VITE_MOBILE_AUTHORISED_BRANCH_ID || "";
const checkoutFlag = import.meta.env.VITE_MOBILE_PRODUCTION_CHECKOUT === "true";

export interface RegisterSummary {
  sessionId: string;
  status: "open" | "closed";
  openedAt: string | null;
  openingCash: number;
  expectedCash: number;
  cashTotal: number;
  cardTotal: number;
  totalSales: number;
  invoiceCount: number;
}

export interface MobileInvoice {
  isDemo: boolean;
  id: string;
  number: string;
  createdAt: string;
  status: string;
  zatcaStatus: string;
  documentType: string;
  customer: string;
  total: number;
  tax: number;
  paymentMethods: string[];
  printEligible: boolean;
}

export type InvoiceDatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "custom";

export interface InvoiceFilters {
  search: string;
  datePreset: InvoiceDatePreset;
  startDate: string;
  endDate: string;
  sessionId: string;
  paymentMethod: "all" | "cash" | "card" | "split";
  documentType: string;
  status: string;
  paymentStatus: string;
  zatcaStatus: string;
  returnStatus: "all" | "original" | "credit_note";
}

export interface InvoiceListResult {
  rows: MobileInvoice[];
  count: number;
}

export interface InvoiceSessionOption {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
}

export interface InvoiceOutputState {
  invoiceId: string;
  documentKind: "simplified" | "standard" | null;
  finalizationStatus: string;
  reportingDisplayState: string;
  canPrint: boolean;
  canShare: boolean;
  qrPresent: boolean;
  immutableFinalizationEnabled: boolean;
}

export interface InvoiceDetail extends MobileInvoice {
  subtotal: number;
  discount: number;
  sessionId: string | null;
  paymentStatus: string;
  taxable: number;
  originalInvoiceId: string | null;
  returnState:
    | "not_returned"
    | "partially_returned"
    | "fully_returned"
    | "credit_note";
  payments: Array<{
    id: string;
    method: string;
    amount: number;
    received: number | null;
    change: number | null;
  }>;
  output: InvoiceOutputState | null;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unit: string;
    price: number;
    discount: number;
    tax: number;
    total: number;
  }>;
}

function invoiceFromRow(row: any): MobileInvoice {
  const payments = Array.isArray(row.payments) ? row.payments : [];
  return {
    id: row.id,
    isDemo: row.is_demo === true,
    number: row.invoice_number,
    createdAt: row.created_at,
    status: row.status,
    zatcaStatus: row.zatca_status || "not_applicable",
    documentType: row.zatca_invoice_type || "simplified",
    customer: row.customers?.name || "Walk-in Customer",
    total: number(row.total_amount),
    tax: number(row.tax_amount),
    paymentMethods:
      payments.some((payment: any) => payment.method === "cash") &&
      payments.some((payment: any) => payment.method === "card")
        ? ["split"]
        : payments.map((payment: any) => String(payment.method)),
    printEligible:
      row.status !== "cancelled" &&
      (row.zatca_invoice_type !== "standard" || row.zatca_status === "cleared"),
  };
}

export interface DemoCheckoutResult {
  invoiceId: string;
  invoiceNumber: string;
  createdAt: string;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: "cash" | "card" | "split";
  isDemo: true;
  nonFiscal: true;
  receiptLabel: string;
  receiptLabelAr: string;
}

export async function checkoutAuthoritativeDemo(params: {
  profile: MobileProfile;
  register: RegisterSummary | null;
  online: boolean;
  customerId: string | null;
  payment: "cash" | "card" | "split";
  requestId: string;
  expectedTotal: number;
  items: Array<{ productId: string; quantity: number }>;
}): Promise<DemoCheckoutResult> {
  if (!params.online) throw new Error("Connect to the internet before checkout.");
  if (!params.profile.branchId) throw new Error("Branch scope is unavailable.");
  if (params.register?.status !== "open") throw new Error("Open the register before checkout.");
  if (!params.items.length) throw new Error("The cart is empty.");

  const db = client();
  const decision = await db.rpc("resolve_pos_checkout_document_v1", {
    p_branch_id: params.profile.branchId,
    p_customer_id: params.customerId,
  });
  if (decision.error) throw new Error(decision.error.message);
  const policy = record(decision.data);
  if (
    policy.status !== "allowed" ||
    policy.checkoutPath !== "demo" ||
    policy.isDemo !== true ||
    policy.nonFiscal !== true
  ) {
    throw new Error(String(policy.code || "Demo checkout is not authorised for this branch."));
  }

  const split = params.payment === "split";
  const result = await db.rpc("pos_checkout", {
    p_payload: {
      branch_id: params.profile.branchId,
      customer_id: params.customerId,
      session_id: params.register.sessionId,
      payment_method: split ? "other" : params.payment,
      ...(split
        ? {
            payments: [
              { method: "cash", amount: Math.round(params.expectedTotal * 50) / 100 },
              { method: "card", amount: Math.round((params.expectedTotal - Math.round(params.expectedTotal * 50) / 100) * 100) / 100 },
            ],
          }
        : {}),
      idempotency_key: params.requestId,
      items: params.items.map((item) => ({
        product_id: item.productId,
        quantity: item.quantity,
      })),
    },
  });
  if (result.error) throw new Error(result.error.message);
  const row = record(result.data);
  if (row.is_demo !== true || row.non_fiscal !== true || row.checkout_path !== "demo")
    throw new Error("Server did not confirm a non-fiscal demo result.");
  return {
    invoiceId: String(row.invoice_id),
    invoiceNumber: String(row.invoice_number),
    createdAt: String(row.created_at),
    subtotal: number(row.subtotal),
    tax: number(row.tax_amount),
    total: number(row.total),
    paymentMethod: params.payment,
    isDemo: true,
    nonFiscal: true,
    receiptLabel: String(row.receipt_label),
    receiptLabelAr: String(row.receipt_label_ar),
  };
}

function escapePostgrest(value: string) {
  return value.replace(/[(),.%]/g, " ").trim();
}

export function saudiInvoiceRange(
  preset: InvoiceDatePreset,
  startDate = "",
  endDate = "",
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const today = new Date(`${parts}T00:00:00+03:00`);
  const start = new Date(today);
  const end = new Date(today);
  if (preset === "yesterday") {
    start.setUTCDate(start.getUTCDate() - 1);
    end.setUTCDate(end.getUTCDate() - 1);
  } else if (preset === "this_week") {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Riyadh",
      weekday: "short",
    }).format(today);
    const offset = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      weekday,
    );
    start.setUTCDate(start.getUTCDate() - offset);
  } else if (preset === "this_month") {
    start.setUTCDate(1);
  } else if (preset === "custom" && startDate && endDate) {
    return {
      start: new Date(`${startDate}T00:00:00+03:00`).toISOString(),
      end: new Date(`${endDate}T23:59:59.999+03:00`).toISOString(),
    };
  }
  end.setUTCHours(20, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

export type OperationalModule =
  | "products"
  | "customers"
  | "purchases"
  | "suppliers"
  | "expenses";

export interface BranchData {
  dashboard: Record<string, unknown>;
  register: RegisterSummary | null;
  products: Product[];
  customers: Customer[];
  invoices: MobileInvoice[];
  lowStock: Product[];
}

function client() {
  if (!supabase) throw new Error("The production service is not configured.");
  return supabase;
}

function number(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeRegister(value: unknown): RegisterSummary | null {
  const outer = record(value);
  const row = record(outer.session ?? value);
  const id = String(row.session_id ?? row.sessionId ?? row.id ?? "");
  if (!id) return null;
  return {
    sessionId: id,
    status: row.status === "closed" ? "closed" : "open",
    openedAt:
      typeof (row.opened_at ?? row.openedAt) === "string"
        ? String(row.opened_at ?? row.openedAt)
        : null,
    openingCash: number(row.opening_cash ?? row.openingCash),
    expectedCash: number(
      row.expected_cash ?? row.expectedCash ?? row.closing_cash_expected,
    ),
    cashTotal: number(row.cash_total ?? row.cashTotal ?? row.total_cash_sales),
    cardTotal: number(row.card_total ?? row.cardTotal ?? row.total_card_sales),
    totalSales: number(
      row.total_sales ?? row.totalSales ?? row.total_session_sales,
    ),
    invoiceCount: number(
      row.invoice_count ?? row.invoiceCount ?? row.total_invoices,
    ),
  };
}

function productFromRow(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.name_ar || row.name,
    barcode: row.barcode || "",
    category: row.categories?.name || "Other",
    price: number(row.price),
    stock: row.is_service ? 999999 : number(row.stock_quantity),
    taxRate:
      row.vat_treatment === "zero_rated" || row.vat_treatment === "exempt"
        ? 0
        : 15,
  };
}

export function isAuthorisedOperationalScope(profile: MobileProfile) {
  return (
    accessMode !== "read-only" &&
    Boolean(authorisedTenant && authorisedBranch) &&
    profile.tenantId === authorisedTenant &&
    profile.branchId === authorisedBranch
  );
}

export function productionCheckoutGate(
  profile: MobileProfile,
  register: RegisterSummary | null,
  online: boolean,
) {
  if (!checkoutFlag || accessMode !== "production-checkout")
    return {
      allowed: false,
      reason: "Production checkout is not enabled for this build.",
    };
  if (!isAuthorisedOperationalScope(profile))
    return {
      allowed: false,
      reason: "This tenant and branch are not authorised for mobile checkout.",
    };
  if (!online)
    return {
      allowed: false,
      reason: "Connect to the internet before checkout.",
    };
  if (register?.status !== "open")
    return { allowed: false, reason: "Open the register before checkout." };
  return { allowed: true, reason: "" };
}

export async function loadBranchData(
  profile: MobileProfile,
): Promise<BranchData> {
  if (!profile.branchId) throw new Error("Branch scope is unavailable.");
  const db = client();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
  }).format(new Date());
  const [dashboard, register, productRows, customerRows, invoiceRows] =
    await Promise.all([
      db.rpc("get_dashboard_summary", {
        p_start_date: today,
        p_end_date: today,
        p_branch_id: profile.branchId,
      }),
      db.rpc("get_register_session_summary", { p_branch_id: profile.branchId }),
      db
        .from("products")
        .select(
          "id,name,name_ar,barcode,price,stock_quantity,vat_treatment,is_service,categories(name,name_ar)",
        )
        .eq("tenant_id", profile.tenantId)
        .eq("branch_id", profile.branchId)
        .eq("is_active", true)
        .eq("is_available", true)
        .order("sort_order")
        .order("name")
        .limit(200),
      db
        .from("customers")
        .select("id,name,name_ar,phone,customer_type,vat_number,cr_number")
        .eq("tenant_id", profile.tenantId)
        .eq("branch_id", profile.branchId)
        .eq("is_active", true)
        .order("name")
        .limit(200),
      db
        .from("invoices")
        .select(
          "id,is_demo,invoice_number,created_at,status,zatca_status,zatca_invoice_type,total_amount,tax_amount,customers(name),payments(method)",
        )
        .eq("tenant_id", profile.tenantId)
        .eq("branch_id", profile.branchId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
  for (const result of [
    dashboard,
    register,
    productRows,
    customerRows,
    invoiceRows,
  ]) {
    if (result.error)
      throw new Error("Production data could not be loaded safely.");
  }
  const products = (productRows.data ?? []).map(productFromRow);
  return {
    dashboard: record(dashboard.data),
    register: normalizeRegister(register.data),
    products,
    customers: (customerRows.data ?? []).map(
      (row: any): Customer => ({
        id: row.id,
        name: row.name,
        mobile: row.phone || "",
        kind: row.customer_type === "business" ? "business" : "individual",
        vatNumber: row.vat_number || undefined,
        crNumber: row.cr_number || undefined,
      }),
    ),
    invoices: (invoiceRows.data ?? []).map(invoiceFromRow),
    lowStock: products.filter((product) => product.stock <= 5).slice(0, 5),
  };
}

export async function loadInvoices(
  profile: MobileProfile,
  filters: InvoiceFilters,
): Promise<InvoiceListResult> {
  if (!profile.branchId) throw new Error("Branch scope is unavailable.");
  const db = client();
  const range = saudiInvoiceRange(
    filters.datePreset,
    filters.startDate,
    filters.endDate,
  );
  let customerIds: string[] = [];
  let paymentInvoiceIds: string[] | null = null;
  const search = escapePostgrest(filters.search);
  if (search) {
    const customers = await db
      .from("customers")
      .select("id")
      .eq("tenant_id", profile.tenantId)
      .eq("branch_id", profile.branchId)
      .ilike("name", `%${search}%`)
      .limit(50);
    if (customers.error) throw new Error("Invoice customer search failed.");
    customerIds = (customers.data ?? []).map((row: any) => String(row.id));
  }
  if (filters.paymentMethod !== "all") {
    const methods =
      filters.paymentMethod === "split"
        ? ["cash", "card"]
        : [filters.paymentMethod];
    const payments = await db
      .from("payments")
      .select(
        "invoice_id,method,invoices!inner(tenant_id,branch_id,created_at)",
      )
      .in("method", methods)
      .eq("invoices.tenant_id", profile.tenantId)
      .eq("invoices.branch_id", profile.branchId)
      .gte("invoices.created_at", range.start)
      .lte("invoices.created_at", range.end)
      .limit(500);
    if (payments.error) throw new Error("Invoice payment filter failed.");
    const byInvoice = new Map<string, Set<string>>();
    for (const row of payments.data ?? []) {
      const id = String((row as any).invoice_id);
      const set = byInvoice.get(id) ?? new Set<string>();
      set.add(String((row as any).method));
      byInvoice.set(id, set);
    }
    paymentInvoiceIds = [...byInvoice]
      .filter(([, values]) =>
        filters.paymentMethod === "split"
          ? values.has("cash") && values.has("card")
          : true,
      )
      .map(([id]) => id);
  }
  let query: any = db
    .from("invoices")
    .select(
      "id,is_demo,invoice_number,invoice_reference,created_at,status,payment_status,zatca_status,zatca_invoice_type,total_amount,tax_amount,original_invoice_id,customers(name),payments(method)",
      { count: "exact" },
    )
    .eq("tenant_id", profile.tenantId)
    .eq("branch_id", profile.branchId)
    .gte("created_at", range.start)
    .lte("created_at", range.end);
  if (filters.sessionId) query = query.eq("session_id", filters.sessionId);
  if (search) {
    const clauses = [
      `invoice_number.ilike.%${search}%`,
      `invoice_reference.ilike.%${search}%`,
      ...customerIds.map((id) => `customer_id.eq.${id}`),
    ];
    query = query.or(clauses.join(","));
  }
  if (paymentInvoiceIds)
    query =
      paymentInvoiceIds.length > 0
        ? query.in("id", paymentInvoiceIds)
        : query.eq("id", "00000000-0000-0000-0000-000000000000");
  if (filters.documentType !== "all")
    query = query.eq("zatca_invoice_type", filters.documentType);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.paymentStatus !== "all")
    query = query.eq("payment_status", filters.paymentStatus);
  if (filters.zatcaStatus !== "all")
    query = query.eq("zatca_status", filters.zatcaStatus);
  if (filters.returnStatus === "credit_note")
    query = query.eq("zatca_invoice_type", "credit_note");
  if (filters.returnStatus === "original")
    query = query.is("original_invoice_id", null);
  const result = await query
    .order("created_at", { ascending: false })
    .range(0, 99);
  if (result.error) throw new Error("Filtered invoices could not be loaded.");
  return {
    rows: (result.data ?? []).map(invoiceFromRow),
    count: result.count ?? 0,
  };
}

export async function loadInvoiceSessions(
  profile: MobileProfile,
): Promise<InvoiceSessionOption[]> {
  if (!profile.branchId) throw new Error("Branch scope is unavailable.");
  const result = await client()
    .from("pos_sessions")
    .select("id,status,opened_at,closed_at")
    .eq("tenant_id", profile.tenantId)
    .eq("branch_id", profile.branchId)
    .order("opened_at", { ascending: false })
    .limit(30);
  if (result.error) throw new Error("Register sessions could not be loaded.");
  return (result.data ?? []).map((row: any) => ({
    id: String(row.id),
    status: String(row.status),
    openedAt: String(row.opened_at),
    closedAt: row.closed_at ? String(row.closed_at) : null,
  }));
}

async function loadInvoiceOutput(
  invoiceId: string,
  branchId: string,
): Promise<InvoiceOutputState | null> {
  const { data, error } = await client().functions.invoke("zatca-submit", {
    body: {
      invoiceId,
      branchId,
      action: "status",
      clientVersion: "mobile-read-parity-v1",
    },
  });
  if (error) return null;
  if (String(data?.invoiceId ?? "") !== invoiceId) return null;
  return {
    invoiceId,
    documentKind:
      data?.documentKind === "simplified" || data?.documentKind === "standard"
        ? data.documentKind
        : null,
    finalizationStatus: String(data?.finalizationStatus ?? "not_started"),
    reportingDisplayState: String(
      data?.reportingDisplayState ?? "reporting_pending",
    ),
    canPrint: data?.canPrint === true,
    canShare: data?.canShare === true,
    qrPresent: data?.canPrint === true && typeof data?.qrCode === "string",
    immutableFinalizationEnabled: data?.immutableFinalizationEnabled === true,
  };
}

export async function loadOwnerData(profile: MobileProfile) {
  const db = client();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
  }).format(new Date());
  const [summary, branches, registers] = await Promise.all([
    db.rpc("get_dashboard_summary", {
      p_start_date: today,
      p_end_date: today,
      p_branch_id: null,
    }),
    db
      .from("branches")
      .select("id,name,name_ar,is_active,zatca_phase")
      .eq("tenant_id", profile.tenantId)
      .order("created_at"),
    db.rpc("get_register_session_summary"),
  ]);
  if (summary.error || branches.error || registers.error)
    throw new Error("Owner data could not be loaded safely.");
  return {
    summary: record(summary.data),
    branches: branches.data ?? [],
    registers: registers.data ?? [],
  };
}

export async function openRegister(
  profile: MobileProfile,
  openingCash: number,
) {
  if (!isAuthorisedOperationalScope(profile) || !profile.branchId)
    throw new Error("Operational writes are not authorised for this branch.");
  if (!Number.isFinite(openingCash) || openingCash < 0)
    throw new Error("Enter a valid opening cash amount.");
  const result = await client().rpc("open_register_session", {
    p_branch_id: profile.branchId,
    p_opening_cash: openingCash,
  });
  if (result.error) throw new Error("The register could not be opened.");
  return normalizeRegister(result.data);
}

export async function closeRegister(
  profile: MobileProfile,
  sessionId: string,
  actualCash: number,
  notes = "",
) {
  if (!isAuthorisedOperationalScope(profile))
    throw new Error("Operational writes are not authorised for this branch.");
  const result = await client().rpc("close_register_session", {
    p_session_id: sessionId,
    p_actual_cash: actualCash,
    p_closing_checks: {},
    p_notes: notes,
  });
  if (result.error) throw new Error("The register could not be closed.");
  return normalizeRegister(result.data);
}

export async function resolveProductBarcode(
  profile: MobileProfile,
  barcode: string,
) {
  if (!profile.branchId) return null;
  const { data, error } = await client()
    .from("products")
    .select(
      "id,name,name_ar,barcode,price,stock_quantity,vat_treatment,is_service,categories(name,name_ar)",
    )
    .eq("tenant_id", profile.tenantId)
    .eq("branch_id", profile.branchId)
    .eq("barcode", barcode)
    .eq("is_active", true)
    .eq("is_available", true)
    .maybeSingle();
  if (error || !data) return null;
  return productFromRow(data);
}

export async function loadInvoiceDetail(
  profile: MobileProfile,
  invoiceId: string,
): Promise<InvoiceDetail> {
  if (!profile.branchId) throw new Error("Branch scope is unavailable.");
  const db = client();
  const { data, error } = await db
    .from("invoices")
    .select(
      "id,is_demo,invoice_number,created_at,status,zatca_status,zatca_invoice_type,subtotal,discount_amount,taxable_amount,tax_amount,total_amount,payment_status,session_id,original_invoice_id,customers(name),payments(id,method,amount,amount_received,change_amount),invoice_items(id,name,quantity,unit,unit_price,discount_amount,tax_amount,total)",
    )
    .eq("tenant_id", profile.tenantId)
    .eq("branch_id", profile.branchId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error || !data) throw new Error("Invoice details could not be loaded.");
  const row: any = data;
  const [credits, refundable, output] = await Promise.all([
    row.zatca_invoice_type === "credit_note"
      ? Promise.resolve({ data: [] })
      : db
          .from("invoices")
          .select("id")
          .eq("tenant_id", profile.tenantId)
          .eq("branch_id", profile.branchId)
          .eq("original_invoice_id", row.id)
          .eq("zatca_invoice_type", "credit_note")
          .neq("status", "cancelled"),
    row.zatca_invoice_type === "credit_note"
      ? Promise.resolve({ data: [] })
      : db.rpc("get_invoice_refundable_items", { p_invoice_id: row.id }),
    loadInvoiceOutput(row.id, profile.branchId),
  ]);
  const refundableRows = (refundable.data ?? []) as any[];
  const remaining = refundableRows.reduce(
    (sum, item) => sum + number(item.remaining_quantity),
    0,
  );
  const original = refundableRows.reduce(
    (sum, item) => sum + number(item.original_quantity),
    0,
  );
  const creditCount = (credits.data ?? []).length;
  const returnState: InvoiceDetail["returnState"] =
    row.zatca_invoice_type === "credit_note"
      ? "credit_note"
      : creditCount === 0
        ? "not_returned"
        : original > 0 && remaining <= 0.0005
          ? "fully_returned"
          : "partially_returned";
  return {
    isDemo: row.is_demo === true,
    id: row.id,
    number: row.invoice_number,
    createdAt: row.created_at,
    status: row.status,
    zatcaStatus: row.zatca_status || "not_applicable",
    documentType: row.zatca_invoice_type || "simplified",
    customer: row.customers?.name || "Walk-in customer",
    total: number(row.total_amount),
    tax: number(row.tax_amount),
    subtotal: number(row.subtotal),
    discount: number(row.discount_amount),
    taxable: number(row.taxable_amount),
    sessionId: row.session_id || null,
    originalInvoiceId: row.original_invoice_id || null,
    returnState,
    paymentStatus: row.payment_status || "unknown",
    paymentMethods: (row.payments ?? []).map((payment: any) =>
      String(payment.method),
    ),
    printEligible: output?.canPrint === true,
    output,
    payments: (row.payments ?? []).map((payment: any) => ({
      id: String(payment.id),
      method: String(payment.method),
      amount: number(payment.amount),
      received:
        payment.amount_received == null
          ? null
          : number(payment.amount_received),
      change:
        payment.change_amount == null ? null : number(payment.change_amount),
    })),
    items: (row.invoice_items ?? []).map((item: any) => ({
      id: item.id,
      name: item.name,
      quantity: number(item.quantity),
      unit: item.unit || "",
      price: number(item.unit_price),
      discount: number(item.discount_amount),
      tax: number(item.tax_amount),
      total: number(item.total),
    })),
  };
}

export async function loadOperationalModule(
  profile: MobileProfile,
  module: OperationalModule,
) {
  if (!profile.branchId) throw new Error("Branch scope is unavailable.");
  const db = client();
  let result;
  if (module === "products")
    result = await db
      .from("products")
      .select(
        "id,name,name_ar,barcode,price,stock_quantity,is_active,is_available,vat_treatment",
      )
      .eq("tenant_id", profile.tenantId)
      .eq("branch_id", profile.branchId)
      .order("name")
      .limit(200);
  else if (module === "customers")
    result = await db
      .from("customers")
      .select(
        "id,name,name_ar,phone,customer_type,vat_number,cr_number,is_active",
      )
      .eq("tenant_id", profile.tenantId)
      .eq("branch_id", profile.branchId)
      .order("name")
      .limit(200);
  else if (module === "purchases")
    result = await db
      .from("purchases")
      .select(
        "id,purchase_number,purchase_date,status,total_amount,suppliers(name),purchase_items(id)",
      )
      .eq("tenant_id", profile.tenantId)
      .eq("branch_id", profile.branchId)
      .order("purchase_date", { ascending: false })
      .limit(100);
  else if (module === "suppliers")
    result = await db
      .from("suppliers")
      .select("id,name,name_ar,phone,email,vat_number,cr_number,is_active")
      .eq("tenant_id", profile.tenantId)
      .eq("branch_id", profile.branchId)
      .eq("is_active", true)
      .order("name")
      .limit(200);
  else
    result = await db
      .from("expenses")
      .select(
        "id,expense_date,description,vendor_name,total_paid,payment_method,vat_amount",
      )
      .eq("tenant_id", profile.tenantId)
      .eq("branch_id", profile.branchId)
      .order("expense_date", { ascending: false })
      .limit(100);
  if (result.error)
    throw new Error("Branch records could not be loaded safely.");
  return result.data ?? [];
}
