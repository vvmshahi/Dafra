import { supabase } from '@/lib/supabase'

export type ReceivableTenderMethod = 'cash' | 'card' | 'bank_transfer' | 'other'
export interface ReceivableTender { method: ReceivableTenderMethod; amount: number; reference?: string | null }

export interface ReceivableLedgerRow {
  id: string
  type: string
  sourceKind: string
  sourceId: string
  branchId: string
  debit: number
  credit: number
  effectiveAt: string
  description: string
  runningBalance: number
}

export interface ReceivableOpenInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate: string | null
  total: number
  outstanding: number
  branchId: string
  isOverdue: boolean
  ageDays: number
}

export interface ReceivablePolicy {
  creditEnabled: boolean
  creditLimit: number | null
  terms: string | null
  hold: boolean
  holdReason: string | null
  overdueBlock: boolean
  warnThresholdPercent: number
  requiresOwnerApproval: boolean
  useTenantDefault: boolean
  dueDateDays: number | null
  hardLimitEnforced: boolean
  tenantCreditEnabled: boolean
}

export interface TenantCustomerCreditPolicy {
  exists: boolean
  creditEnabled: boolean
  allowUnpaidInvoices: boolean
  allowPartialInitialPayments: boolean
  defaultCreditLimit: number
  hardLimitEnforced: boolean
  warnThresholdPercent: number
  enforceCustomerHold: boolean
  allowManagerOverride: boolean
  defaultAllocationMode: 'oldest_first' | 'manual'
  internalTerms: string | null
  dueDateDays: number | null
}

export interface BranchCustomerCreditSettings {
  branchId: string
  branchName: string
  branchNameAr: string | null
  tenantCreditEnabled: boolean
  branchChoice: boolean | null
  branchCreditEnabled: boolean
  explicit: boolean
  inherited: boolean
  tenantPolicyConfigured: boolean
  canEdit: boolean
}

export interface CustomerReceivableWorkspace {
  customer: { id: string; name: string; nameAr: string | null; receivableAccountId?: string | null }
  summary: {
    balance: number
    totalInvoiced: number
    totalCollected: number
    unpaidAmount: number
    partialAmount: number
    accountCredit: number
    unappliedCredit: number
    unappliedReceipts: number
    openInvoiceCount: number
    lastPaymentAt: string | null
    lastInvoiceAt: string | null
  }
  policy: ReceivablePolicy | null
  openInvoices: ReceivableOpenInvoice[]
  ledger: ReceivableLedgerRow[]
  aging: { current: number; days1to30: number; days31to60: number; days61to90: number; over90: number; overdue: number }
  statement: { openingBalance: number; closingBalance: number; startDate: string; endDate: string }
  scope: { tenantId: string; branchId: string | null; ownerConsolidated: boolean }
}

export interface CustomerCreditCheckoutEligibility {
  allowed: boolean
  reasonCode: string
  businessEnabled: boolean
  branchEnabled: boolean
  customerEnabled: boolean
  accountReady: boolean
  customerActive: boolean
  branchActive: boolean
  eligible: boolean
  creditEnabled: boolean
  accountLinked: boolean
  accountLinkable: boolean
  onHold: boolean
  creditLimit: number | null
  currentBalance: number
  availableCredit: number | null
  overdueAmount: number
  requiresOwnerApproval: boolean
  tenantCreditEnabled: boolean
  tenantPolicyConfigured: boolean
  hardLimitEnforced: boolean
}

export interface PaymentReceiptResult {
  receiptId: string
  receiptNumber: string
  amount: number
  allocatedAmount: number
  unappliedAmount: number
  status: 'completed' | 'reversed'
  customerId: string
  receivableAccountId: string
  balance: number
}

export interface UnappliedCustomerPaymentReceipt {
  id: string
  number: string
  amount: number
  receivedAt: string | null
  unappliedAmount: number
  allocations: Array<{ invoiceId: string; amount: number }>
}

const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableWholeNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeTenantCustomerCreditPolicy(value: any): TenantCustomerCreditPolicy {
  return {
    exists: value?.exists === true,
    creditEnabled: value?.creditEnabled === true,
    allowUnpaidInvoices: value?.allowUnpaidInvoices !== false,
    allowPartialInitialPayments: value?.allowPartialInitialPayments !== false,
    defaultCreditLimit: numberValue(value?.defaultCreditLimit),
    hardLimitEnforced: value?.hardLimitEnforced !== false,
    warnThresholdPercent: numberValue(value?.warnThresholdPercent ?? 80),
    enforceCustomerHold: value?.enforceCustomerHold !== false,
    allowManagerOverride: value?.allowManagerOverride === true,
    defaultAllocationMode: value?.defaultAllocationMode === 'manual' ? 'manual' : 'oldest_first',
    internalTerms: typeof value?.internalTerms === 'string' && value.internalTerms.trim() ? value.internalTerms : null,
    dueDateDays: nullableWholeNumber(value?.dueDateDays),
  }
}

export const CUSTOMER_CREDIT_POLICY_CHANGED_EVENT = 'kubri:customer-credit-policy-changed'
const CUSTOMER_CREDIT_POLICY_CHANGED_STORAGE_KEY = 'kubri:customer-credit-policy-changed'

export function notifyCustomerCreditPolicyChanged(detail: { customerId?: string | null } = {}) {
  if (typeof window === 'undefined') return
  const change = { customerId: detail.customerId ?? null, at: Date.now() }
  window.dispatchEvent(new CustomEvent(CUSTOMER_CREDIT_POLICY_CHANGED_EVENT, { detail: change }))
  try {
    window.localStorage.setItem(CUSTOMER_CREDIT_POLICY_CHANGED_STORAGE_KEY, JSON.stringify(change))
  } catch {
    // Storage is only a cross-tab refresh hint; server preflight remains authoritative.
  }
}

export function isCustomerCreditPolicyStorageChange(event: StorageEvent) {
  return event.key === CUSTOMER_CREDIT_POLICY_CHANGED_STORAGE_KEY
}

function normalizeWorkspace(value: any): CustomerReceivableWorkspace {
  return {
    ...value,
    customer: value?.customer ?? { id: '', name: '—', nameAr: null },
    summary: {
      balance: numberValue(value?.summary?.balance),
      totalInvoiced: numberValue(value?.summary?.totalInvoiced),
      totalCollected: numberValue(value?.summary?.totalCollected),
      unpaidAmount: numberValue(value?.summary?.unpaidAmount),
      partialAmount: numberValue(value?.summary?.partialAmount),
      accountCredit: numberValue(value?.summary?.accountCredit ?? Math.max(-numberValue(value?.summary?.balance), 0)),
      unappliedCredit: numberValue(value?.summary?.unappliedCredit),
      unappliedReceipts: numberValue(value?.summary?.unappliedReceipts ?? value?.summary?.unappliedCredit),
      openInvoiceCount: numberValue(value?.summary?.openInvoiceCount),
      lastPaymentAt: value?.summary?.lastPaymentAt ?? null,
      lastInvoiceAt: value?.summary?.lastInvoiceAt ?? null,
    },
    policy: value?.policy
      ? {
        creditEnabled: Boolean(value.policy.creditEnabled),
        creditLimit: numberValue(value.policy.creditLimit),
          terms: value.policy.terms ?? null,
          hold: Boolean(value.policy.hold),
          holdReason: value.policy.holdReason ?? null,
          overdueBlock: Boolean(value.policy.overdueBlock),
          warnThresholdPercent: numberValue(value.policy.warnThresholdPercent ?? 80),
          requiresOwnerApproval: Boolean(value.policy.requiresOwnerApproval),
          useTenantDefault: Boolean(value.policy.useTenantDefault),
          dueDateDays: nullableWholeNumber(value.policy.dueDateDays),
          hardLimitEnforced: value.policy.hardLimitEnforced !== false,
          tenantCreditEnabled: value.policy.tenantCreditEnabled !== false,
        }
      : null,
    openInvoices: (value?.openInvoices ?? []).map((row: any) => ({
      ...row,
      total: numberValue(row.total),
      outstanding: numberValue(row.outstanding),
      isOverdue: Boolean(row.isOverdue),
      ageDays: numberValue(row.ageDays),
      dueDate: row.dueDate ?? null,
    })),
    ledger: (value?.ledger ?? []).map((row: any) => ({
      ...row,
      debit: numberValue(row.debit),
      credit: numberValue(row.credit),
      runningBalance: numberValue(row.runningBalance),
    })),
    aging: {
      current: numberValue(value?.aging?.current),
      days1to30: numberValue(value?.aging?.days1to30),
      days31to60: numberValue(value?.aging?.days31to60),
      days61to90: numberValue(value?.aging?.days61to90),
      over90: numberValue(value?.aging?.over90),
      overdue: numberValue(value?.aging?.overdue),
    },
    statement: {
      openingBalance: numberValue(value?.statement?.openingBalance),
      closingBalance: numberValue(value?.statement?.closingBalance),
      startDate: String(value?.statement?.startDate ?? ''),
      endDate: String(value?.statement?.endDate ?? ''),
    },
    scope: {
      tenantId: String(value?.scope?.tenantId ?? ''),
      branchId: value?.scope?.branchId ?? null,
      ownerConsolidated: Boolean(value?.scope?.ownerConsolidated),
    },
  }
}

export async function loadCustomerReceivableWorkspace(input: {
  customerId: string
  branchId?: string | null
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
}) {
  const { data, error } = await supabase.rpc('get_customer_receivable_workspace_v1' as never, {
    p_payload: {
      customer_id: input.customerId,
      branch_id: input.branchId ?? null,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      page: input.page ?? 1,
      page_size: input.pageSize ?? 50,
    },
  } as never)
  if (error) throw error
  return normalizeWorkspace(data)
}

export async function loadCustomerCreditCheckoutEligibility(input: {
  branchId: string
  customerId: string
  proposedCreditAmount: number
}) : Promise<CustomerCreditCheckoutEligibility> {
  const { data, error } = await supabase.rpc('get_customer_credit_checkout_eligibility_v1' as never, {
    p_payload: {
      branch_id: input.branchId,
      customer_id: input.customerId,
      proposed_credit_amount: input.proposedCreditAmount.toFixed(2),
    },
  } as never)
  if (error) throw error
  const value = data as any
  return {
    allowed: value?.allowed === true,
    reasonCode: String(value?.reason_code ?? value?.effectiveReasonCode ?? value?.reasonCode ?? 'CREDIT_UNAVAILABLE'),
    businessEnabled: value?.businessEnabled === true || value?.business_enabled === true,
    branchEnabled: value?.branchEnabled === true || value?.branch_enabled === true,
    customerEnabled: value?.customerEnabled === true || value?.customer_enabled === true,
    accountReady: value?.accountReady === true || value?.account_ready === true,
    customerActive: value?.customerActive !== false && value?.customer_active !== false,
    branchActive: value?.branchActive !== false && value?.branch_active !== false,
    eligible: value?.eligible === true || value?.allowed === true,
    creditEnabled: value?.creditEnabled === true,
    accountLinked: value?.accountLinked === true,
    accountLinkable: value?.accountLinkable === true,
    onHold: value?.onHold === true,
    creditLimit: value?.creditLimit == null ? null : numberValue(value.creditLimit),
    currentBalance: numberValue(value?.currentBalance),
    availableCredit: value?.availableCredit == null ? null : numberValue(value.availableCredit),
    overdueAmount: numberValue(value?.overdueAmount),
    requiresOwnerApproval: value?.requiresOwnerApproval === true,
    tenantCreditEnabled: value?.tenantCreditEnabled === true,
    tenantPolicyConfigured: value?.tenantPolicyConfigured === true,
    hardLimitEnforced: value?.hardLimitEnforced !== false,
  }
}

export async function loadTenantCustomerCreditPolicy() : Promise<TenantCustomerCreditPolicy> {
  const { data, error } = await supabase.rpc('get_tenant_customer_credit_policy_v1' as never)
  if (error) throw error
  return normalizeTenantCustomerCreditPolicy(data)
}

export async function saveTenantCustomerCreditPolicy(input: {
  creditEnabled: boolean
}) : Promise<TenantCustomerCreditPolicy> {
  const { data, error } = await supabase.rpc('set_tenant_customer_credit_policy_v1' as never, {
    p_payload: { credit_enabled: input.creditEnabled },
  } as never)
  if (error) throw error
  return normalizeTenantCustomerCreditPolicy(data)
}

function normalizeBranchCustomerCreditSettings(value: any): BranchCustomerCreditSettings {
  return {
    branchId: String(value?.branchId ?? ''),
    branchName: String(value?.branchName ?? ''),
    branchNameAr: typeof value?.branchNameAr === 'string' && value.branchNameAr.trim() ? value.branchNameAr : null,
    tenantCreditEnabled: value?.tenantCreditEnabled === true,
    branchChoice: typeof value?.branchChoice === 'boolean' ? value.branchChoice : null,
    branchCreditEnabled: value?.branchCreditEnabled === true,
    explicit: value?.explicit === true,
    inherited: value?.inherited === true,
    tenantPolicyConfigured: value?.tenantPolicyConfigured === true,
    canEdit: value?.canEdit !== false,
  }
}

export async function loadBranchCustomerCreditSettings(branchId: string): Promise<BranchCustomerCreditSettings> {
  const { data, error } = await supabase.rpc('get_branch_customer_credit_policy_v1' as never, {
    p_branch_id: branchId,
  } as never)
  if (error) throw error
  return normalizeBranchCustomerCreditSettings(data)
}

export async function saveBranchCustomerCreditSettings(input: { branchId: string; creditEnabled: boolean }): Promise<BranchCustomerCreditSettings> {
  const { data, error } = await supabase.rpc('set_branch_customer_credit_policy_v1' as never, {
    p_payload: { branch_id: input.branchId, credit_enabled: input.creditEnabled },
  } as never)
  if (error) throw error
  return normalizeBranchCustomerCreditSettings(data)
}

export async function ensureCustomerReceivableAccount(customerId: string) {
  const { data, error } = await supabase.rpc('ensure_customer_credit_account_v1' as never, {
    p_payload: { customer_id: customerId },
  } as never)
  if (error) throw error
  return data as { customerId: string; receivableAccountId: string; created: boolean; historicalBalanceBackfilled: false }
}

export async function saveCustomerCreditAccess(input: { customerId: string; creditEnabled: boolean }) {
  const { data, error } = await supabase.rpc('set_customer_credit_access_v1' as never, {
    p_payload: { customer_id: input.customerId, credit_enabled: input.creditEnabled },
  } as never)
  if (error) throw error
  return data as { customerId: string; receivableAccountId: string; creditEnabled: boolean; historicalBalanceBackfilled: false }
}

export async function recordCustomerPaymentReceipt(input: {
  operationId: string
  branchId: string
  customerId: string
  amount: number
  method?: ReceivableTenderMethod
  tenders?: ReceivableTender[]
  reference?: string | null
  notes?: string | null
  autoAllocate?: boolean
  allocations?: Array<{ invoiceId: string; amount: number }>
}) {
  const tenders = input.tenders?.length
    ? input.tenders
    : [{ method: input.method ?? 'cash', amount: input.amount, reference: input.reference ?? null }]
  const { data, error } = await supabase.rpc('record_customer_payment_receipt_v1' as never, {
    p_payload: {
      operation_id: input.operationId,
      branch_id: input.branchId,
      customer_id: input.customerId,
      amount: input.amount,
      tenders: tenders.map(tender => ({ method: tender.method, amount: tender.amount, reference: tender.reference ?? null })),
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      auto_allocate: input.autoAllocate ?? true,
      allocations: (input.allocations ?? []).map(allocation => ({
        invoice_id: allocation.invoiceId,
        amount: allocation.amount,
      })),
    },
  } as never)
  if (error) throw error
  const result = data as any
  return {
    receiptId: String(result.receipt_id),
    receiptNumber: String(result.receipt_number),
    amount: numberValue(result.amount),
    allocatedAmount: numberValue(result.allocated_amount),
    unappliedAmount: numberValue(result.unapplied_amount),
    status: result.status === 'reversed' ? 'reversed' : 'completed',
    customerId: String(result.customer_id),
    receivableAccountId: String(result.receivable_account_id),
    balance: numberValue(result.balance),
  } satisfies PaymentReceiptResult
}

export async function saveCustomerCreditPolicy(input: {
  customerId: string
  creditEnabled: boolean
  creditLimit: number
  useTenantDefault?: boolean
  hold: boolean
  holdReason?: string | null
  terms?: string | null
  overdueBlock?: boolean
  warnThresholdPercent?: number
  requiresOwnerApproval: boolean
  dueDateDays?: number | null
}) {
  const { data, error } = await supabase.rpc('set_customer_credit_policy_v1' as never, {
    p_payload: {
      customer_id: input.customerId,
      credit_enabled: input.creditEnabled,
      credit_limit: input.creditLimit,
      use_tenant_default: input.useTenantDefault ?? false,
      hold: input.hold,
      hold_reason: input.holdReason ?? null,
      terms: input.terms ?? null,
      overdue_block: input.overdueBlock ?? false,
      warn_threshold_percent: input.warnThresholdPercent ?? 80,
      requires_owner_approval: input.requiresOwnerApproval,
      due_date_days: input.dueDateDays ?? null,
    },
  } as never)
  if (error) throw error
  return data
}

export async function loadCustomerPaymentReceiptDocument(receiptId: string) {
  const { data, error } = await supabase.rpc('get_customer_payment_receipt_document_v1' as never, {
    p_receipt_id: receiptId,
  } as never)
  if (error) throw error
  return data as any
}

/**
 * Read-only, RLS-scoped receipt headers used to apply an existing unapplied
 * receipt after the original payment screen has closed. Financial writes stay
 * exclusively inside the reallocation RPC.
 */
export async function loadUnappliedCustomerPaymentReceipts(input: {
  customerId: string
  branchId?: string | null
}) {
  let query = (supabase as any)
    .from('customer_payment_receipts')
    .select('id, receipt_number, amount, received_at, customer_payment_allocations(invoice_id, amount)')
    .eq('customer_id', input.customerId)
    .eq('status', 'completed')
    .order('received_at', { ascending: false })
    .limit(100)
  if (input.branchId) query = query.eq('branch_id', input.branchId)
  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as any[]).map(receipt => {
    const allocations = (receipt.customer_payment_allocations ?? []).map((allocation: any) => ({
      invoiceId: String(allocation?.invoice_id ?? ''),
      amount: numberValue(allocation?.amount),
    })).filter((allocation: { invoiceId: string; amount: number }) => allocation.invoiceId && allocation.amount > 0)
    const allocated = allocations.reduce((sum: number, allocation: { amount: number }) => sum + allocation.amount, 0)
    return {
      id: String(receipt.id ?? ''),
      number: String(receipt.receipt_number ?? '—'),
      amount: numberValue(receipt.amount),
      receivedAt: typeof receipt.received_at === 'string' ? receipt.received_at : null,
      unappliedAmount: Math.max(0, numberValue(receipt.amount) - allocated),
      allocations,
    } satisfies UnappliedCustomerPaymentReceipt
  }).filter(receipt => receipt.id && receipt.unappliedAmount > 0.01)
}

export function createReceivableOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  throw new Error('Secure operation IDs are unavailable in this browser.')
}

type PersistedReceivableOperation = { operationId: string; fingerprint: string }

export function getPersistentReceivableOperation(input: {
  branchId: string
  customerId: string
  fingerprint: string
  kind?: 'credit-checkout' | 'payment-receipt' | 'credit-note-settlement' | 'payment-reallocation' | 'receivable-adjustment'
}) {
  if (typeof localStorage === 'undefined') return createReceivableOperationId()
  const key = `kubri:ar-${input.kind ?? 'credit-checkout'}:${input.branchId}:${input.customerId}`
  try {
    const existing = JSON.parse(localStorage.getItem(key) ?? 'null') as PersistedReceivableOperation | null
    if (existing?.operationId && existing.fingerprint === input.fingerprint) return existing.operationId
    const operationId = createReceivableOperationId()
    localStorage.setItem(key, JSON.stringify({ operationId, fingerprint: input.fingerprint }))
    return operationId
  } catch {
    return createReceivableOperationId()
  }
}

export function clearPersistentReceivableOperation(branchId: string, customerId: string, kind: 'credit-checkout' | 'payment-receipt' | 'credit-note-settlement' | 'payment-reallocation' | 'receivable-adjustment' = 'credit-checkout') {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(`kubri:ar-${kind}:${branchId}:${customerId}`) } catch { /* storage may be unavailable */ }
}

export async function reallocateCustomerPayment(input: {
  operationId: string
  receiptId: string
  allocations: Array<{ invoiceId: string; amount: number }>
}) {
  const { data, error } = await supabase.rpc('reallocate_customer_payment_v1' as never, {
    p_payload: {
      operation_id: input.operationId,
      receipt_id: input.receiptId,
      allocations: input.allocations.map(row => ({ invoice_id: row.invoiceId, amount: row.amount })),
    },
  } as never)
  if (error) throw error
  return data as any
}

export async function postCustomerReceivableAdjustment(input: {
  operationId: string
  branchId: string
  customerId: string
  direction: 'debit' | 'credit'
  amount: number
  reason: string
  reference?: string | null
}) {
  const { data, error } = await supabase.rpc('post_customer_receivable_adjustment_v1' as never, {
    p_payload: {
      operation_id: input.operationId,
      branch_id: input.branchId,
      customer_id: input.customerId,
      direction: input.direction,
      amount: input.amount,
      reason: input.reason,
      reference: input.reference ?? null,
    },
  } as never)
  if (error) throw error
  return data as any
}

export async function reverseCustomerPaymentReceipt(input: {
  operationId: string
  receiptId: string
  reason: string
}) {
  const { data, error } = await supabase.rpc('reverse_customer_payment_receipt_v1' as never, {
    p_payload: { operation_id: input.operationId, receipt_id: input.receiptId, reason: input.reason },
  } as never)
  if (error) throw error
  return data as { receipt_id: string; receipt_number: string; status: 'reversed'; balance: number }
}

export async function createCustomerCreditNoteSettlement(input: {
  operationId: string
  originalInvoiceId: string
  reason: string
  returnStock: boolean
  items: Array<{ originalInvoiceItemId: string; quantity: number }>
  refundTenders?: ReceivableTender[]
}) {
  const { data, error } = await supabase.rpc('create_customer_credit_note_settlement_v1' as never, {
    p_payload: {
      operation_id: input.operationId,
      original_invoice_id: input.originalInvoiceId,
      reason: input.reason,
      return_stock: input.returnStock,
      items: input.items.map(item => ({ original_invoice_item_id: item.originalInvoiceItemId, quantity: item.quantity })),
      refund_tenders: (input.refundTenders ?? []).map(tender => ({ method: tender.method, amount: tender.amount })),
    },
  } as never)
  if (error) throw error
  return data as {
    credit_note_invoice_id: string
    credit_note_invoice_number: string
    created_at?: string
    total?: number
    refund_status?: string
    refund_method?: ReceivableTenderMethod | 'split'
    zatca_status?: 'pending' | 'reported' | 'cleared' | 'failed'
    idempotent_replay?: boolean
    applied_to_original_invoice: number
    refunded_amount: number
    unapplied_customer_credit: number
  }
}

export async function loadCustomerReceivablesReport(input: {
  branchId?: string | null
  startDate?: string
  endDate?: string
  asOfDate?: string
  page?: number
  pageSize?: number
}) {
  const { data, error } = await supabase.rpc('get_customer_receivables_report_v1' as never, {
    p_payload: input,
  } as never)
  if (error) throw error
  return data as any
}
