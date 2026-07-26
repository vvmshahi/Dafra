import type { Invoice } from '@/types/database'

/**
 * Canonical browser-readable `public.invoices` contract.
 *
 * Keep this list aligned with
 * `04a_safe_invoice_read_surface.sql`. Raw compliance artifacts and operational
 * finalization state are intentionally absent; customer-output state and the
 * permitted final QR come from `getInvoiceZatcaOutputState` instead.
 */
export const INVOICE_SAFE_COLUMNS = [
  'id',
  'tenant_id',
  'branch_id',
  'customer_id',
  'created_by',
  'invoice_number',
  'invoice_reference',
  'zatca_invoice_type',
  'zatca_status',
  'zatca_submitted_at',
  'subtotal',
  'discount_amount',
  'taxable_amount',
  'tax_amount',
  'total_amount',
  'currency_code',
  'invoice_date',
  'supply_date',
  'due_date',
  'status',
  'payment_status',
  'notes',
  'notes_ar',
  'cancelled_at',
  'cancellation_reason',
  'created_at',
  'updated_at',
  'session_id',
  'payment_method',
  'original_invoice_id',
  'credit_reason',
  'document_language',
] as const satisfies readonly (keyof Invoice)[]

export type InvoiceSafeColumn = typeof INVOICE_SAFE_COLUMNS[number]
export type InvoiceSafeRow = Pick<Invoice, InvoiceSafeColumn>

/** PostgREST selector for a complete browser-safe invoice row. */
export const INVOICE_SAFE_SELECT: string = INVOICE_SAFE_COLUMNS.join(', ')
