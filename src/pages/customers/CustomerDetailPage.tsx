import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, MapPin, Building2, User,
  FileText, Download, Receipt,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { Customer, InvoiceStatus, PaymentStatus } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CustomerFull extends Customer {
  company_name: string | null
}

interface InvoiceRow {
  id: string
  invoice_number: string
  invoice_date: string
  total_amount: number
  tax_amount: number
  status: InvoiceStatus
  payment_status: PaymentStatus
  invoice_items: { id: string }[]
}

// ── Badge mappings ────────────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'gold'

const STATUS_MAP: Record<InvoiceStatus, { variant: BadgeVariant; label: string }> = {
  draft:     { variant: 'neutral', label: 'Draft' },
  posted:    { variant: 'success', label: 'Posted' },
  cancelled: { variant: 'danger',  label: 'Cancelled' },
}

const PAYMENT_MAP: Record<PaymentStatus, { variant: BadgeVariant; label: string }> = {
  pending:  { variant: 'warning', label: 'Pending' },
  paid:     { variant: 'success', label: 'Paid' },
  partial:  { variant: 'info',    label: 'Partial' },
  refunded: { variant: 'danger',  label: 'Refunded' },
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ icon: Icon, value }: { icon: React.ElementType; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <Icon size={14} className="text-gray-400 flex-shrink-0" />
      <span className="truncate">{value}</span>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex-1 min-w-0 bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-card">
      <p className="text-xs text-gray-400 font-medium">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-0.5">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CustomerDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [customer,  setCustomer]  = useState<CustomerFull | null>(null)
  const [invoices,  setInvoices]  = useState<InvoiceRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [notFound,  setNotFound]  = useState(false)

  const load = useCallback(async () => {
    if (!id) { setNotFound(true); setLoading(false); return }

    const [{ data: cust }, { data: invs }] = await Promise.all([
      supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('invoices')
        .select('id, invoice_number, invoice_date, total_amount, tax_amount, status, payment_status, invoice_items(id)')
        .eq('customer_id', id)
        .order('invoice_date', { ascending: false }),
    ])

    if (!cust) { setNotFound(true); setLoading(false); return }

    setCustomer(cust as unknown as CustomerFull)
    setInvoices((invs ?? []) as unknown as InvoiceRow[])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex justify-center items-center py-32">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (notFound || !customer) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <User size={24} className="text-gray-400" />
        </div>
        <p className="text-gray-700 font-semibold">Customer not found</p>
        <p className="text-gray-400 text-sm mt-1">This customer may have been deleted.</p>
        <Button variant="secondary" className="mt-5" onClick={() => navigate('/customers')}>
          <ArrowLeft size={15} />
          Back to Customers
        </Button>
      </div>
    )
  }

  const isBusiness   = customer.customer_type === 'business'
  const displayName  = isBusiness && customer.company_name
    ? customer.company_name
    : customer.name
  const contactName  = isBusiness && customer.company_name ? customer.name : null

  const postedInvoices    = invoices.filter(i => i.status === 'posted')
  const totalSpent        = postedInvoices.reduce((s, i) => s + i.total_amount, 0)
  const totalVat          = postedInvoices.reduce((s, i) => s + i.tax_amount, 0)
  const lastInvoiceDate   = postedInvoices[0]?.invoice_date ?? null

  return (
    <div className="space-y-5 max-w-4xl">

      {/* ── Back nav ──────────────────────────────────────── */}
      <button
        onClick={() => navigate('/customers')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
      >
        <ArrowLeft size={15} />
        Back to Customers
      </button>

      {/* ── Customer info card ───────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
            isBusiness ? 'bg-gold-500/10 text-gold-700' : 'bg-primary-50 text-primary-600'
          }`}>
            {isBusiness
              ? <Building2 size={20} />
              : <span className="text-lg font-bold">{displayName.charAt(0).toUpperCase()}</span>
            }
          </div>

          {/* Name + type */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-gray-900 leading-none">{displayName}</h2>
              <Badge variant={isBusiness ? 'gold' : 'neutral'}>
                {isBusiness ? 'Business' : 'Individual'}
              </Badge>
            </div>
            {contactName && (
              <p className="text-sm text-gray-500 mt-1">Contact: {contactName}</p>
            )}
            {customer.name_ar && (
              <p className="text-sm text-gray-400 mt-1" dir="rtl">{customer.name_ar}</p>
            )}

            {/* Contact details */}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              <InfoRow icon={Phone}   value={customer.phone} />
              <InfoRow icon={Mail}    value={customer.email} />
              <InfoRow icon={MapPin}  value={customer.city} />
              {isBusiness && customer.vat_number && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <FileText size={14} className="text-gray-400" />
                  <span className="font-mono text-xs">VAT: {customer.vat_number}</span>
                </div>
              )}
              {isBusiness && customer.cr_number && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Building2 size={14} className="text-gray-400" />
                  <span className="font-mono text-xs">CR: {customer.cr_number}</span>
                </div>
              )}
            </div>

            {customer.notes && (
              <p className="mt-3 text-xs text-gray-400 italic leading-relaxed">
                {customer.notes}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Summary stats ─────────────────────────────────── */}
      <div className="flex gap-3 flex-wrap">
        <StatCard
          label="Total Spent"
          value={<Rial amount={totalSpent} />}
          sub="from posted invoices"
        />
        <StatCard
          label="Total VAT Paid"
          value={<Rial amount={totalVat} />}
        />
        <StatCard
          label="Invoice Count"
          value={String(invoices.length)}
          sub={`${postedInvoices.length} posted`}
        />
        <StatCard
          label="Last Purchase"
          value={lastInvoiceDate
            ? new Date(lastInvoiceDate).toLocaleDateString('en-SA', {
                day: '2-digit', month: 'short', year: 'numeric',
              })
            : '—'
          }
        />
      </div>

      {/* ── Purchase history ──────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">Purchase History</h3>
          <button
            disabled
            title="PDF export coming soon"
            className="flex items-center gap-2 text-xs font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 opacity-60 cursor-not-allowed select-none"
          >
            <Download size={13} />
            Download PDF
          </button>
        </div>

        {invoices.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center mb-3">
              <Receipt size={20} className="text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium text-sm">No purchase history yet</p>
            <p className="text-gray-400 text-xs mt-1">
              Invoices created for this customer will appear here
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
              <div className="w-36 flex-shrink-0">Invoice #</div>
              <div className="w-28 flex-shrink-0">Date</div>
              <div className="w-16 flex-shrink-0 text-center hidden sm:block">Items</div>
              <div className="flex-1 text-right">Total (SAR)</div>
              <div className="w-24 flex-shrink-0 text-right hidden md:block">VAT (SAR)</div>
              <div className="w-20 flex-shrink-0 text-center">Status</div>
              <div className="w-20 flex-shrink-0 text-center hidden sm:block">Payment</div>
            </div>

            {invoices.map(inv => {
              const statusInfo  = STATUS_MAP[inv.status]   ?? { variant: 'neutral', label: inv.status }
              const payInfo     = PAYMENT_MAP[inv.payment_status] ?? { variant: 'neutral', label: inv.payment_status }
              const itemCount   = Array.isArray(inv.invoice_items) ? inv.invoice_items.length : 0

              return (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50/70 transition-colors border-b border-gray-100 last:border-0"
                >
                  {/* Invoice number */}
                  <div className="w-36 flex-shrink-0">
                    <p className="text-sm font-semibold text-primary-600 font-mono">
                      {inv.invoice_number}
                    </p>
                  </div>

                  {/* Date */}
                  <div className="w-28 flex-shrink-0">
                    <p className="text-sm text-gray-600">
                      {new Date(inv.invoice_date).toLocaleDateString('en-SA', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      })}
                    </p>
                  </div>

                  {/* Item count */}
                  <div className="w-16 flex-shrink-0 text-center hidden sm:block">
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                      {itemCount} item{itemCount !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Total */}
                  <div className="flex-1 text-right">
                    <p className="text-sm font-bold text-gray-900 tabular-nums">
                      {inv.total_amount.toLocaleString('en-US', {
                        minimumFractionDigits: 2, maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>

                  {/* VAT */}
                  <div className="w-24 flex-shrink-0 text-right hidden md:block">
                    <p className="text-sm text-gray-500 tabular-nums">
                      {inv.tax_amount.toLocaleString('en-US', {
                        minimumFractionDigits: 2, maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>

                  {/* Invoice status */}
                  <div className="w-20 flex-shrink-0 flex justify-center">
                    <Badge variant={statusInfo.variant as BadgeVariant}>
                      {statusInfo.label}
                    </Badge>
                  </div>

                  {/* Payment status */}
                  <div className="w-20 flex-shrink-0 flex justify-center hidden sm:flex">
                    <Badge variant={payInfo.variant as BadgeVariant}>
                      {payInfo.label}
                    </Badge>
                  </div>
                </div>
              )
            })}

            {/* Total row */}
            <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-t border-gray-100">
              <div className="w-36 flex-shrink-0" />
              <div className="w-28 flex-shrink-0" />
              <div className="w-16 flex-shrink-0 hidden sm:block" />
              <div className="flex-1 text-right">
                <p className="text-sm font-bold text-primary-600 tabular-nums">
                  <Rial amount={totalSpent} />
                </p>
                <p className="text-[10px] text-gray-400">posted invoices total</p>
              </div>
              <div className="w-24 flex-shrink-0 text-right hidden md:block">
                <p className="text-sm font-semibold text-gray-600 tabular-nums">
                  {totalVat.toLocaleString('en-US', {
                    minimumFractionDigits: 2, maximumFractionDigits: 2,
                  })}
                </p>
              </div>
              <div className="w-20 flex-shrink-0" />
              <div className="w-20 flex-shrink-0 hidden sm:block" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
