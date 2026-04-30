import { useState, useEffect, useRef } from 'react'
import { X, ImagePlus, CreditCard, Banknote, Building } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import type { ExpenseCategory, VatExpenseTreatment, ExpensePaymentMethod } from '@/types'
import type { ExpenseRow } from './DailyExpensesTab'
import { Rial } from '@/components/ui/RiyalSymbol'

// ── VAT helpers ───────────────────────────────────────────────────────────────

function calcVat(amount: number, treatment: VatExpenseTreatment) {
  if (treatment === 'no_vat')  return { vatAmount: 0, totalPaid: amount }
  if (treatment === 'included') {
    const vat = (amount * 15) / 115
    return { vatAmount: vat, totalPaid: amount }
  }
  // on_top: amount is net, total = amount + vat
  const vat = amount * 0.15
  return { vatAmount: vat, totalPaid: amount + vat }
}

// ── Payment method options ────────────────────────────────────────────────────

const PAY_OPTIONS: { value: ExpensePaymentMethod; label: string; icon: React.ElementType }[] = [
  { value: 'cash',          label: 'Cash',          icon: Banknote  },
  { value: 'card',          label: 'Card',          icon: CreditCard },
  { value: 'bank_transfer', label: 'Bank Transfer', icon: Building  },
]

// ── VAT options ───────────────────────────────────────────────────────────────

const VAT_OPTIONS: { value: VatExpenseTreatment; label: string; desc: string }[] = [
  { value: 'no_vat',   label: 'No VAT',          desc: 'Non-taxable expense'        },
  { value: 'included', label: 'VAT Included',    desc: 'Extract 15% from amount'    },
  { value: 'on_top',   label: 'VAT on Top',      desc: 'Add 15% to amount'          },
]

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest pt-1">
      {children}
    </p>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  expense: ExpenseRow | null
  categories: ExpenseCategory[]
  onClose: () => void
  onSaved: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExpenseDrawer({ open, expense, categories, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const fileRef     = useRef<HTMLInputElement>(null)

  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const [imageFile,    setImageFile]    = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  // Form state
  const [date,        setDate]        = useState('')
  const [description, setDescription] = useState('')
  const [vendorName,  setVendorName]  = useState('')
  const [categoryId,  setCategoryId]  = useState('')
  const [amount,      setAmount]      = useState('')
  const [vatTreat,    setVatTreat]    = useState<VatExpenseTreatment>('no_vat')
  const [payMethod,   setPayMethod]   = useState<ExpensePaymentMethod>('cash')
  const [notes,       setNotes]       = useState('')

  // Reset form
  useEffect(() => {
    if (open && expense) {
      setDate(expense.expense_date)
      setDescription(expense.description)
      setVendorName(expense.vendor_name ?? '')
      setCategoryId(expense.category_id ?? '')
      setAmount(String(expense.amount))
      setVatTreat((expense.vat_treatment as VatExpenseTreatment) ?? 'no_vat')
      setPayMethod((expense.payment_method as ExpensePaymentMethod) ?? 'cash')
      setNotes(expense.notes ?? '')
      setImagePreview(expense.receipt_url)
    } else {
      const today = new Date().toISOString().split('T')[0]
      setDate(today)
      setDescription('')
      setVendorName('')
      setCategoryId('')
      setAmount('')
      setVatTreat('no_vat')
      setPayMethod('cash')
      setNotes('')
      setImagePreview(null)
    }
    setImageFile(null)
    setError('')
  }, [open, expense])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  // Live VAT preview
  const amountNum = parseFloat(amount) || 0
  const { vatAmount, totalPaid } = calcVat(amountNum, vatTreat)
  const fmt = (n: number) => n.toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description.trim()) { setError('Description is required'); return }
    if (!amount || amountNum <= 0) { setError('Enter a valid amount'); return }

    setSaving(true)
    setError('')

    try {
      const tid = profile?.tenant_id!
      const bid = profile?.branch_id!

      let receiptUrl: string | null = expense?.receipt_url ?? null

      if (imageFile) {
        const ext  = imageFile.name.split('.').pop() ?? 'jpg'
        const path = `${tid}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('expense-receipts')
          .upload(path, imageFile, { upsert: true })
        if (upErr) { setError('Receipt upload failed: ' + upErr.message); return }
        const { data: { signedUrl } } = await supabase.storage
          .from('expense-receipts')
          .createSignedUrl(path, 60 * 60 * 24 * 365)  // 1-year signed URL
        receiptUrl = signedUrl
      } else if (imagePreview === null) {
        receiptUrl = null
      }

      const { vatAmount: va, totalPaid: tp } = calcVat(amountNum, vatTreat)

      const payload: Record<string, unknown> = {
        tenant_id:      tid,
        branch_id:      bid,
        added_by:       profile?.id ?? null,
        category_id:    categoryId  || null,
        expense_date:   date,
        description:    description.trim(),
        vendor_name:    vendorName.trim() || null,
        amount:         amountNum,
        vat_treatment:  vatTreat,
        vat_amount:     parseFloat(va.toFixed(2)),
        total_paid:     parseFloat(tp.toFixed(2)),
        payment_method: payMethod,
        receipt_url:    receiptUrl,
        notes:          notes.trim() || null,
      }

      const q = supabase as unknown as { from: (t: string) => any }

      if (expense) {
        const { error: err } = await q.from('expenses').update(payload).eq('id', expense.id)
        if (err) { setError(err.message); return }
      } else {
        const { error: err } = await q.from('expenses').insert(payload)
        if (err) { setError(err.message); return }
      }

      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-full max-w-[540px] bg-white shadow-2xl z-50 flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                {expense ? 'Edit Expense' : 'Add Daily Expense'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">Branch expense record</p>
            </div>
            <button type="button" onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* ── Basic details ────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>Expense Details</SectionLabel>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Date <span className="text-red-500">*</span></label>
                  <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Category</label>
                  <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                    <option value="">— Uncategorised —</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Description <span className="text-red-500">*</span></label>
                <input className="input" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Office cleaning supplies" />
              </div>

              <div>
                <label className="label">Vendor / Payee Name</label>
                <input className="input" value={vendorName} onChange={e => setVendorName(e.target.value)}
                  placeholder="e.g. Al-Othaim Market" />
              </div>
            </div>

            {/* ── Amount & VAT ─────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>Amount &amp; VAT</SectionLabel>

              <div>
                <label className="label">Amount (SAR) <span className="text-red-500">*</span></label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium pointer-events-none">
                    SAR
                  </span>
                  <input
                    className="input pl-12"
                    type="number"
                    step="0.01"
                    min="0"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="label">VAT Treatment</label>
                <div className="grid grid-cols-3 gap-2">
                  {VAT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVatTreat(opt.value)}
                      className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                        vatTreat === opt.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <p className="text-xs font-semibold">{opt.label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Live VAT preview */}
              {amountNum > 0 && (
                <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                  {vatTreat !== 'no_vat' && (
                    <div className="flex justify-between text-gray-500">
                      <span>VAT (15%)</span>
                      <span className="tabular-nums font-medium"><Rial amount={vatAmount} /></span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1.5">
                    <span>Total Paid</span>
                    <span className="tabular-nums text-primary-600"><Rial amount={totalPaid} /></span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Payment method ────────────────────────────── */}
            <div className="space-y-3">
              <SectionLabel>Payment Method</SectionLabel>
              <div className="flex gap-2">
                {PAY_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPayMethod(value)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                      payMethod === value
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Receipt upload ────────────────────────────── */}
            <div className="space-y-3">
              <SectionLabel>Receipt (optional)</SectionLabel>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="hidden"
                onChange={handleImageChange}
              />
              {imagePreview ? (
                <div className="relative group/img">
                  {imagePreview.startsWith('blob:') || imagePreview.match(/\.(jpg|jpeg|png|webp|heic)/i) ? (
                    <img src={imagePreview} alt="Receipt"
                      className="w-full h-40 object-cover rounded-xl border border-gray-200" />
                  ) : (
                    <div className="w-full h-20 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
                      <p className="text-sm text-gray-500">📄 Receipt attached</p>
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/20 rounded-xl">
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="bg-white text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg shadow">
                      Change
                    </button>
                    <button type="button" onClick={() => { setImageFile(null); setImagePreview(null) }}
                      className="bg-white text-red-500 text-xs font-medium px-3 py-1.5 rounded-lg shadow">
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full h-24 flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-xl hover:border-primary-400 hover:bg-primary-50/20 transition-colors group/up">
                  <ImagePlus size={20} className="text-gray-300 group-hover/up:text-primary-400" />
                  <p className="text-xs text-gray-400 group-hover/up:text-primary-500">Attach receipt photo or PDF</p>
                </button>
              )}
            </div>

            {/* ── Notes ─────────────────────────────────────── */}
            <div>
              <label className="label">Notes</label>
              <textarea className="input resize-none" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)} placeholder="Optional notes..." />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" loading={saving}>
              {expense ? 'Save Changes' : 'Add Expense'}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
