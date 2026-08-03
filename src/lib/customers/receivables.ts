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
  creditLimit: number
  terms: string | null
  hold: boolean
  holdReason: string | null
  overdueBlock: boolean
  warnThresholdPercent: number
  requiresOwnerApproval: boolean
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

const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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
  hold: boolean
  holdReason?: string | null
  terms?: string | null
  overdueBlock?: boolean
  warnThresholdPercent?: number
  requiresOwnerApproval: boolean
}) {
  const { data, error } = await supabase.rpc('set_customer_credit_policy_v1' as never, {
    p_payload: {
      customer_id: input.customerId,
      credit_enabled: input.creditEnabled,
      credit_limit: input.creditLimit,
      hold: input.hold,
      hold_reason: input.holdReason ?? null,
      terms: input.terms ?? null,
      overdue_block: input.overdueBlock ?? false,
      warn_threshold_percent: input.warnThresholdPercent ?? 80,
      requires_owner_approval: input.requiresOwnerApproval,
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

export function createReceivableOperationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  throw new Error('Secure operation IDs are unavailable in this browser.')
}

type PersistedReceivableOperation = { operationId: string; fingerprint: string }

export function getPersistentReceivableOperation(input: {
  branchId: string
  customerId: string
  fingerprint: string
  kind?: 'credit-checkout' | 'payment-receipt' | 'credit-note-settlement'
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

export function clearPersistentReceivableOperation(branchId: string, customerId: string, kind: 'credit-checkout' | 'payment-receipt' | 'credit-note-settlement' = 'credit-checkout') {
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
  page?: number
  pageSize?: number
}) {
  const { data, error } = await supabase.rpc('get_customer_receivables_report_v1' as never, {
    p_payload: input,
  } as never)
  if (error) throw error
  return data as any
}
