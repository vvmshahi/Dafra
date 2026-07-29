import type { Customer, Product } from './domain'
import type { MobileProfile } from './mobileAuth'
import { supabase } from './mobileAuth'

export type AccessMode = 'read-only' | 'operational-writes' | 'production-checkout'
export const accessMode = (import.meta.env.VITE_MOBILE_ACCESS_MODE || 'read-only') as AccessMode
const authorisedTenant = import.meta.env.VITE_MOBILE_AUTHORISED_TENANT_ID || ''
const authorisedBranch = import.meta.env.VITE_MOBILE_AUTHORISED_BRANCH_ID || ''
const checkoutFlag = import.meta.env.VITE_MOBILE_PRODUCTION_CHECKOUT === 'true'

export interface RegisterSummary {
  sessionId: string
  status: 'open' | 'closed'
  openedAt: string | null
  openingCash: number
  expectedCash: number
  cashTotal: number
  cardTotal: number
  totalSales: number
  invoiceCount: number
}

export interface MobileInvoice {
  id: string
  number: string
  createdAt: string
  status: string
  zatcaStatus: string
  documentType: string
  customer: string
  total: number
  tax: number
  paymentMethods: string[]
  printEligible: boolean
}

export interface BranchData {
  dashboard: Record<string, unknown>
  register: RegisterSummary | null
  products: Product[]
  customers: Customer[]
  invoices: MobileInvoice[]
  lowStock: Product[]
}

function client() {
  if (!supabase) throw new Error('The production service is not configured.')
  return supabase
}

function number(value: unknown) {
  const result = Number(value ?? 0)
  return Number.isFinite(result) ? result : 0
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeRegister(value: unknown): RegisterSummary | null {
  const outer = record(value)
  const row = record(outer.session ?? value)
  const id = String(row.session_id ?? row.sessionId ?? row.id ?? '')
  if (!id) return null
  return {
    sessionId: id,
    status: row.status === 'closed' ? 'closed' : 'open',
    openedAt: typeof (row.opened_at ?? row.openedAt) === 'string' ? String(row.opened_at ?? row.openedAt) : null,
    openingCash: number(row.opening_cash ?? row.openingCash),
    expectedCash: number(row.expected_cash ?? row.expectedCash ?? row.closing_cash_expected),
    cashTotal: number(row.cash_total ?? row.cashTotal ?? row.total_cash_sales),
    cardTotal: number(row.card_total ?? row.cardTotal ?? row.total_card_sales),
    totalSales: number(row.total_sales ?? row.totalSales ?? row.total_session_sales),
    invoiceCount: number(row.invoice_count ?? row.invoiceCount ?? row.total_invoices),
  }
}

function productFromRow(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.name_ar || row.name,
    barcode: row.barcode || '',
    category: row.categories?.name || 'Other',
    price: number(row.price),
    stock: row.is_service ? 999999 : number(row.stock_quantity),
    taxRate: row.vat_treatment === 'zero_rated' || row.vat_treatment === 'exempt' ? 0 : 15,
  }
}

export function isAuthorisedOperationalScope(profile: MobileProfile) {
  return accessMode !== 'read-only'
    && Boolean(authorisedTenant && authorisedBranch)
    && profile.tenantId === authorisedTenant
    && profile.branchId === authorisedBranch
}

export function productionCheckoutGate(profile: MobileProfile, register: RegisterSummary | null, online: boolean) {
  if (!checkoutFlag || accessMode !== 'production-checkout') return { allowed: false, reason: 'Production checkout is not enabled for this build.' }
  if (!isAuthorisedOperationalScope(profile)) return { allowed: false, reason: 'This tenant and branch are not authorised for mobile checkout.' }
  if (!online) return { allowed: false, reason: 'Connect to the internet before checkout.' }
  if (register?.status !== 'open') return { allowed: false, reason: 'Open the register before checkout.' }
  return { allowed: true, reason: '' }
}

export async function loadBranchData(profile: MobileProfile): Promise<BranchData> {
  if (!profile.branchId) throw new Error('Branch scope is unavailable.')
  const db = client()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
  const [dashboard, register, productRows, customerRows, invoiceRows] = await Promise.all([
    db.rpc('get_dashboard_summary', { p_start_date: today, p_end_date: today, p_branch_id: profile.branchId }),
    db.rpc('get_register_session_summary', { p_branch_id: profile.branchId }),
    db.from('products')
      .select('id,name,name_ar,barcode,price,stock_quantity,vat_treatment,is_service,categories(name,name_ar)')
      .eq('tenant_id', profile.tenantId).eq('branch_id', profile.branchId)
      .eq('is_active', true).eq('is_available', true)
      .order('sort_order').order('name').limit(200),
    db.from('customers')
      .select('id,name,name_ar,phone,customer_type,vat_number,cr_number')
      .eq('tenant_id', profile.tenantId).eq('branch_id', profile.branchId)
      .eq('is_active', true).order('name').limit(200),
    db.from('invoices')
      .select('id,invoice_number,created_at,status,zatca_status,zatca_invoice_type,total_amount,tax_amount,customers(name),payments(method)')
      .eq('tenant_id', profile.tenantId).eq('branch_id', profile.branchId)
      .order('created_at', { ascending: false }).limit(50),
  ])
  for (const result of [dashboard, register, productRows, customerRows, invoiceRows]) {
    if (result.error) throw new Error('Production data could not be loaded safely.')
  }
  const products = (productRows.data ?? []).map(productFromRow)
  return {
    dashboard: record(dashboard.data),
    register: normalizeRegister(register.data),
    products,
    customers: (customerRows.data ?? []).map((row: any): Customer => ({
      id: row.id, name: row.name, mobile: row.phone || '', kind: row.customer_type === 'business' ? 'business' : 'individual',
      vatNumber: row.vat_number || undefined, crNumber: row.cr_number || undefined,
    })),
    invoices: (invoiceRows.data ?? []).map((row: any): MobileInvoice => ({
      id: row.id, number: row.invoice_number, createdAt: row.created_at, status: row.status,
      zatcaStatus: row.zatca_status || 'not_applicable', documentType: row.zatca_invoice_type || 'simplified',
      customer: row.customers?.name || 'Walk-in customer', total: number(row.total_amount), tax: number(row.tax_amount),
      paymentMethods: (row.payments ?? []).map((payment: any) => String(payment.method)),
      printEligible: row.status !== 'cancelled' && (row.zatca_invoice_type !== 'standard' || row.zatca_status === 'cleared'),
    })),
    lowStock: products.filter(product => product.stock <= 5).slice(0, 5),
  }
}

export async function loadOwnerData(profile: MobileProfile) {
  const db = client()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
  const [summary, branches, registers] = await Promise.all([
    db.rpc('get_dashboard_summary', { p_start_date: today, p_end_date: today, p_branch_id: null }),
    db.from('branches').select('id,name,name_ar,is_active,zatca_phase').eq('tenant_id', profile.tenantId).order('created_at'),
    db.rpc('get_register_session_summary'),
  ])
  if (summary.error || branches.error || registers.error) throw new Error('Owner data could not be loaded safely.')
  return { summary: record(summary.data), branches: branches.data ?? [], registers: registers.data ?? [] }
}

export async function openRegister(profile: MobileProfile, openingCash: number) {
  if (!isAuthorisedOperationalScope(profile) || !profile.branchId) throw new Error('Operational writes are not authorised for this branch.')
  if (!Number.isFinite(openingCash) || openingCash < 0) throw new Error('Enter a valid opening cash amount.')
  const result = await client().rpc('open_register_session', { p_branch_id: profile.branchId, p_opening_cash: openingCash })
  if (result.error) throw new Error('The register could not be opened.')
  return normalizeRegister(result.data)
}

export async function closeRegister(profile: MobileProfile, sessionId: string, actualCash: number, notes = '') {
  if (!isAuthorisedOperationalScope(profile)) throw new Error('Operational writes are not authorised for this branch.')
  const result = await client().rpc('close_register_session', {
    p_session_id: sessionId, p_actual_cash: actualCash, p_closing_checks: {}, p_notes: notes,
  })
  if (result.error) throw new Error('The register could not be closed.')
  return normalizeRegister(result.data)
}

export async function resolveProductBarcode(profile: MobileProfile, barcode: string) {
  if (!profile.branchId) return null
  const { data, error } = await client().from('products')
    .select('id,name,name_ar,barcode,price,stock_quantity,vat_treatment,is_service,categories(name,name_ar)')
    .eq('tenant_id', profile.tenantId).eq('branch_id', profile.branchId)
    .eq('barcode', barcode).eq('is_active', true).eq('is_available', true).maybeSingle()
  if (error || !data) return null
  return productFromRow(data)
}
