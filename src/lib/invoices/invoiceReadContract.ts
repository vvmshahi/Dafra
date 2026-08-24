import type { Invoice } from '@/types/database'

/**
 * Canonical browser-readable `public.invoices` contract.
 *
 * Keep this list aligned with the hosted safe invoice read surface. Raw
 * compliance artifacts remain absent; customer-facing Generation lifecycle
 * state is safe to read so pending sales remain visible and issued documents
 * can be labelled correctly. The permitted final QR comes from
 * `getInvoiceZatcaOutputState` instead.
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
  'checkout_idempotency_key',
  'payment_method',
  'is_demo',
  'original_invoice_id',
  'credit_reason',
  'document_language',
  'fiscal_regime_at_issue',
  'fiscal_lifecycle_state',
  'fiscal_artifact_stage',
  // Immutable seller/buyer/document identity only; raw ZATCA artifacts stay
  // server-only and are read through the output-state API.
  'identity_snapshot',
] as const satisfies readonly (keyof Invoice)[]

export type InvoiceSafeColumn = typeof INVOICE_SAFE_COLUMNS[number]
export type InvoiceSafeRow = Pick<Invoice, InvoiceSafeColumn>

/** PostgREST selector for a complete browser-safe invoice row. */
export const INVOICE_SAFE_SELECT: string = INVOICE_SAFE_COLUMNS.join(', ')
