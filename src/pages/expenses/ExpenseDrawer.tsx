import { useState, useEffect, useRef } from 'react'
import { X, ImagePlus, CreditCard, Banknote, Building, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import type { ExpenseCategory, ExpensePaymentMethod, Supplier } from '@/types'
import type { ExpenseRow } from './DailyExpensesTab'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MoneyInput } from '@/components/ui/MoneyInput'
import {
  SIMPLE_EXPENSE_VAT_OPTIONS,
  calculateExpenseVat,
  expenseVatConsistency,
  isValidSaudiVatNumber,
  resolveExpenseVatChoice,
  type SimpleExpenseVatChoice,
} from '@/lib/utils/expenseVat'
import { useTranslation } from 'react-i18next'

// ── Payment method options ────────────────────────────────────────────────────

const PAY_OPTIONS: { value: ExpensePaymentMethod; icon: React.ElementType }[] = [
  { value: 'cash', icon: Banknote }, { value: 'card', icon: CreditCard }, { value: 'bank_transfer', icon: Building },
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
  const { t } = useTranslation(['expenses', 'common'])
  const fileRef     = useRef<HTMLInputElement>(null)

  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const [imageFile,    setImageFile]    = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  // Form state
  const [date,        setDate]        = useState('')
  const [description, setDescription] = useState('')
  const [vendorName,  setVendorName]  = useState('')
  const [categoryId,  setCategoryId]  = useState('')
  const [amount,      setAmount]      = useState('')
  const [vatChoice,   setVatChoice]   = useState<SimpleExpenseVatChoice>('not_claimable')
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState('')
  const [supplierVatNumber, setSupplierVatNumber] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [supplierCrNumber, setSupplierCrNumber] = useState('')
  const [supplierContact, setSupplierContact] = useState('')
  const [invoiceTime, setInvoiceTime] = useState('')
  const [taxableAmount, setTaxableAmount] = useState('')
  const [vatAmountInput, setVatAmountInput] = useState('')
  const [vatAmountsManual, setVatAmountsManual] = useState(false)
  const [payMethod,   setPayMethod]   = useState<ExpensePaymentMethod>('cash')
  const [notes,       setNotes]       = useState('')

  // Reset form
  useEffect(() => {
    if (open && expense) {
      setDate(expense.expense_date)
      setDescription(expense.description)
      setVendorName(expense.vendor_name ?? '')
      setCategoryId(expense.category_id ?? '')
      setAmount(String(expense.total_paid ?? expense.amount))
      setVatChoice(resolveExpenseVatChoice(
        expense.vat_claim_status,
        expense.vat_treatment,
        expense.vat_amount,
      ))
      setTaxInvoiceNumber(expense.tax_invoice_number ?? '')
      setSupplierVatNumber(expense.supplier_vat_number ?? '')
      setSupplierId(expense.supplier_id ?? '')
      setSupplierCrNumber(expense.supplier_cr_number ?? '')
      setSupplierContact(expense.supplier_contact ?? '')
      setInvoiceTime(expense.invoice_time?.slice(0, 5) ?? '')
      setTaxableAmount(String(expense.expense_before_vat ?? expense.amount))
      setVatAmountInput(String(expense.vat_amount ?? 0))
      setVatAmountsManual(true)
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
      setVatChoice('not_claimable')
      setTaxInvoiceNumber('')
      setSupplierVatNumber('')
      setSupplierId('')
      setSupplierCrNumber('')
      setSupplierContact('')
      setInvoiceTime('')
      setTaxableAmount('')
      setVatAmountInput('')
      setVatAmountsManual(false)
      setPayMethod('cash')
      setNotes('')
      setImagePreview(null)
    }
    setImageFile(null)
    setError('')
  }, [open, expense])

  useEffect(() => {
    if (!open || !profile?.tenant_id || !profile?.branch_id) return
    supabase
      .from('suppliers')
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('branch_id', profile.branch_id)
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setSuppliers((data ?? []) as Supplier[]))
  }, [open, profile?.tenant_id, profile?.branch_id])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  // Live VAT preview
  const amountNum = parseFloat(amount) || 0
  const defaultVat = calculateExpenseVat(amountNum, vatChoice)
  const taxableAmountNum = parseFloat(taxableAmount) || 0
  const vatAmountNum = parseFloat(vatAmountInput) || 0
  const vatCheck = expenseVatConsistency(amountNum, taxableAmountNum, vatAmountNum)
  const supplierVatValid = !supplierVatNumber || isValidSaudiVatNumber(supplierVatNumber)

  useEffect(() => {
    if (vatChoice !== 'claimable' || vatAmountsManual) return
    const calculated = calculateExpenseVat(parseFloat(amount) || 0, 'claimable')
    setTaxableAmount(calculated.expenseBeforeVat ? calculated.expenseBeforeVat.toFixed(2) : '')
    setVatAmountInput(calculated.vatAmount ? calculated.vatAmount.toFixed(2) : '')
  }, [amount, vatChoice, vatAmountsManual])

  const selectSupplier = (id: string) => {
    setSupplierId(id)
    const supplier = suppliers.find(item => item.id === id)
    if (!supplier) return
    setVendorName(supplier.name)
    setSupplierVatNumber(supplier.vat_number ?? '')
    setSupplierCrNumber(supplier.cr_number ?? '')
    setSupplierContact(supplier.contact_person || supplier.phone || supplier.email || '')
  }

  const calculateFifteenPercentVat = () => {
    const calculated = calculateExpenseVat(amountNum, 'claimable')
    setTaxableAmount(calculated.expenseBeforeVat.toFixed(2))
    setVatAmountInput(calculated.vatAmount.toFixed(2))
    setVatAmountsManual(false)
  }

  const useTaxableAndVatTotal = () => {
    setAmount((taxableAmountNum + vatAmountNum).toFixed(2))
    setVatAmountsManual(true)
  }
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description.trim()) { setError(t('expenses:errors.descriptionRequired')); return }
    if (!amount || amountNum <= 0) { setError(t('expenses:errors.amountPositive')); return }
    if (!date) { setError(t('expenses:errors.dateRequired')); return }
    if (vatChoice === 'claimable') {
      if (!vendorName.trim()) { setError(t('expenses:errors.supplierRequired')); return }
      if (!categoryId) { setError(t('expenses:errors.categoryRequired')); return }
      if (!taxInvoiceNumber.trim()) { setError(t('expenses:errors.invoiceRequired')); return }
      if (taxableAmountNum < 0 || vatAmountNum <= 0) { setError(t('expenses:errors.vatAmountsInvalid')); return }
      if (vatAmountNum > amountNum) { setError(t('expenses:errors.vatExceeds')); return }
      if (!vatCheck.consistent) { setError(t('expenses:errors.vatMismatch')); return }
      if (!supplierVatValid) { setError(t('expenses:errors.supplierVatInvalid')); return }
    }

    setSaving(true)
    setError('')

    try {
      const tid = profile?.tenant_id!
      const bid = profile?.branch_id!

      let receiptUrl: string | null = expense?.receipt_url ?? null

      if (imageFile) {
        const ext  = imageFile.name.split('.').pop() ?? 'jpg'
        const path = `${tid}/${bid}/expenses/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('expense-receipts')
          .upload(path, imageFile, { upsert: true })
        if (upErr) { console.error('Expense receipt upload failed', upErr); setError(t('expenses:errors.uploadFailed')); return }
        const { data: { signedUrl } } = await supabase.storage
          .from('expense-receipts')
          .createSignedUrl(path, 60 * 60 * 24 * 365)  // 1-year signed URL
        receiptUrl = signedUrl
      } else if (imagePreview === null) {
        receiptUrl = null
      }

      const calculatedVat = vatChoice === 'claimable'
        ? {
            amount: Number(taxableAmountNum.toFixed(2)),
            expenseBeforeVat: Number(taxableAmountNum.toFixed(2)),
            vatTreatment: 'included',
            vatClaimStatus: 'claimable',
            vatAmount: Number(vatAmountNum.toFixed(2)),
            totalPaid: Number(amountNum.toFixed(2)),
          }
        : defaultVat

      const payload: Record<string, unknown> = {
        tenant_id:      tid,
        branch_id:      bid,
        added_by:       profile?.id ?? null,
        category_id:    categoryId  || null,
        expense_date:   date,
        description:    description.trim(),
        vendor_name:    vendorName.trim() || null,
        amount:         calculatedVat.amount,
        vat_treatment:  calculatedVat.vatTreatment,
        vat_claim_status: calculatedVat.vatClaimStatus,
        expense_before_vat: calculatedVat.expenseBeforeVat,
        vat_amount:     calculatedVat.vatAmount,
        total_paid:     calculatedVat.totalPaid,
        payment_method: payMethod,
        tax_invoice_number: vatChoice === 'claimable' ? taxInvoiceNumber.trim() || null : null,
        supplier_vat_number: vatChoice === 'claimable' ? supplierVatNumber.trim() || null : null,
        supplier_id: vatChoice === 'claimable' ? supplierId || null : null,
        supplier_cr_number: vatChoice === 'claimable' ? supplierCrNumber.trim() || null : null,
        supplier_contact: vatChoice === 'claimable' ? supplierContact.trim() || null : null,
        invoice_time: vatChoice === 'claimable' ? invoiceTime || null : null,
        receipt_url:    receiptUrl,
        notes:          notes.trim() || null,
      }

      const q = supabase as unknown as { from: (t: string) => any }

      if (expense) {
        const { error: err } = await q.from('expenses').update(payload).eq('id', expense.id)
        if (err) { console.error('Expense update failed', err); setError(t('expenses:errors.saveFailed')); return }
      } else {
        const { error: err } = await q.from('expenses').insert(payload)
        if (err) { console.error('Expense creation failed', err); setError(t('expenses:errors.saveFailed')); return }
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
                {t(expense ? 'expenses:edit' : 'expenses:add')}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {t('expenses:ui.drawerHint')}
              </p>
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
              <SectionLabel>{t('expenses:sections.details')}</SectionLabel>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('expenses:fields.date')} <span className="text-red-500">*</span></label>
                  <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">
                    {t('expenses:fields.category')} {vatChoice === 'claimable' && <span className="text-red-500">*</span>}
                  </label>
                  <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                    <option value="">— {t('expenses:placeholders.uncategorized')} —</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">{t('expenses:fields.description')} <span className="text-red-500">*</span></label>
                <input className="input" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder={t('expenses:placeholders.description')} dir="auto" />
              </div>

              <div>
                <label className="label">{t('expenses:ui.savedSupplier')}</label>
                <select className="input" value={supplierId} onChange={e => selectSupplier(e.target.value)}>
                  <option value="">{t('expenses:ui.manualSupplier')}</option>
                  {suppliers.map(supplier => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">
                  {t('expenses:fields.vendor')} {vatChoice === 'claimable' && <span className="text-red-500">*</span>}
                </label>
                <input className="input" value={vendorName} onChange={e => setVendorName(e.target.value)}
                  placeholder={t('expenses:placeholders.vendor')} dir="auto" />
              </div>
            </div>

            {/* ── Amount & VAT ─────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>{t('expenses:sections.amountVat')}</SectionLabel>

              <div>
                <label className="label">{t('expenses:fields.amountSar')} <span className="text-red-500">*</span></label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium pointer-events-none">
                    SAR
                  </span>
                  <MoneyInput
                    className="input pl-12"
                    value={amount}
                    onValueChange={setAmount}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('expenses:fields.vat')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {SIMPLE_EXPENSE_VAT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVatChoice(opt.value)}
                      className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                        vatChoice === opt.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <p className="text-xs font-semibold">{t(`expenses:vat.${opt.value}`)}</p>
                    </button>
                  ))}
                </div>
              </div>

              {vatChoice === 'claimable' && (
                <div className="space-y-3 rounded-xl border border-primary-100 bg-primary-50/30 p-3">
                  <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('expenses:fields.taxInvoice')} <span className="text-red-500">*</span></label>
                    <input
                      className="input"
                      value={taxInvoiceNumber}
                      onChange={e => setTaxInvoiceNumber(e.target.value)}
                      placeholder={t('expenses:placeholders.taxInvoice')}
                    />
                  </div>
                  <div>
                    <label className="label">{t('expenses:fields.supplierVat')}</label>
                    <input
                      className="input"
                      value={supplierVatNumber}
                      onChange={e => setSupplierVatNumber(e.target.value.replace(/\D/g, '').slice(0, 15))}
                      inputMode="numeric"
                      placeholder="15 digits (optional)"
                    />
                    {supplierVatNumber && (
                      <p className={`mt-1 text-[10px] ${supplierVatValid ? 'text-emerald-600' : 'text-red-600'}`}>
                        {supplierVatValid
                          ? t('expenses:ui.formatValid')
                          : t('expenses:ui.vatFormatInvalid')}
                      </p>
                    )}
                  </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">{t('expenses:fields.supplierCr')}</label>
                      <input className="input" value={supplierCrNumber}
                        onChange={e => setSupplierCrNumber(e.target.value)} placeholder={t('expenses:placeholders.optional')} />
                    </div>
                    <div>
                      <label className="label">{t('expenses:fields.invoiceTime')}</label>
                      <input className="input" type="time" value={invoiceTime}
                        onChange={e => setInvoiceTime(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="label">{t('expenses:fields.supplierContact')}</label>
                    <input className="input" value={supplierContact}
                      onChange={e => setSupplierContact(e.target.value)} placeholder={t('expenses:placeholders.supplierContact')} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">{t('expenses:fields.taxableAmount')} <span className="text-red-500">*</span></label>
                      <MoneyInput className="input" value={taxableAmount}
                        onValueChange={value => { setTaxableAmount(value); setVatAmountsManual(true) }} placeholder="0.00" />
                    </div>
                    <div>
                      <label className="label">{t('expenses:fields.vatAmount')} <span className="text-red-500">*</span></label>
                      <MoneyInput className="input" value={vatAmountInput}
                        onValueChange={value => { setVatAmountInput(value); setVatAmountsManual(true) }} placeholder="0.00" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <button type="button" onClick={calculateFifteenPercentVat}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700">
                      {t('expenses:ui.calculateIncluded')}
                    </button>
                    <button type="button" onClick={useTaxableAndVatTotal}
                      className="text-xs font-medium text-primary-600 hover:text-primary-700">
                      {t('expenses:ui.setGross')}
                    </button>
                  </div>
                  {!vatCheck.consistent && amountNum > 0 && (
                    <p className="flex items-center gap-1.5 text-xs text-red-600">
                      <AlertTriangle size={13} /> {t('expenses:errors.vatMismatch')}
                    </p>
                  )}
                  {vatCheck.consistent && vatCheck.unusualRate && (
                    <p className="flex items-center gap-1.5 text-xs text-amber-700">
                      <AlertTriangle size={13} /> {t('expenses:ui.vatRateWarning')}
                    </p>
                  )}
                </div>
              )}

              {/* Live VAT preview */}
              {amountNum > 0 && (
                <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                  {vatChoice === 'claimable' && (
                    <>
                      <div className="flex justify-between text-gray-500">
                        <span>{t('expenses:fields.taxableAmount')}</span>
                        <span className="tabular-nums font-medium"><Rial amount={taxableAmountNum} /></span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>{t('expenses:vat.claimable')}</span>
                        <span className="tabular-nums font-medium"><Rial amount={vatAmountNum} /></span>
                      </div>
                    </>
                  )}
                  {vatChoice !== 'claimable' && (
                    <div className="flex justify-between text-gray-500">
                      <span>{t('expenses:fields.amount')}</span>
                      <span className="tabular-nums font-medium"><Rial amount={defaultVat.expenseBeforeVat} /></span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1.5">
                    <span>{t('expenses:fields.amount')}</span>
                    <span className="tabular-nums text-primary-600"><Rial amount={amountNum} /></span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Payment method ────────────────────────────── */}
            <div className="space-y-3">
              <SectionLabel>{t('expenses:fields.paymentMethod')}</SectionLabel>
              <div className="flex gap-2">
                {PAY_OPTIONS.map(({ value, icon: Icon }) => (
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
                    {t(`expenses:payment.${value}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Receipt upload ────────────────────────────── */}
            <div className="space-y-3">
              <SectionLabel>{t('expenses:sections.receipt')}</SectionLabel>
              <p className="text-xs text-gray-400">{t('expenses:ui.receiptHint')}</p>
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
                    <img src={imagePreview} alt={t('expenses:fields.receipt')}
                      className="w-full h-40 object-cover rounded-xl border border-gray-200" />
                  ) : (
                    <div className="w-full h-20 flex items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
                      <p className="text-sm text-gray-500">📄 {t('expenses:ui.receiptAttached')}</p>
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/20 rounded-xl">
                    <button type="button" onClick={() => fileRef.current?.click()}
                      className="bg-white text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg shadow">
                      {t('expenses:ui.change')}
                    </button>
                    <button type="button" onClick={() => {
                      if (window.confirm(t('expenses:ui.removeConfirm'))) {
                        setImageFile(null)
                        setImagePreview(null)
                      }
                    }}
                      className="bg-white text-red-500 text-xs font-medium px-3 py-1.5 rounded-lg shadow">
                      {t('expenses:ui.remove')}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full h-24 flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-xl hover:border-primary-400 hover:bg-primary-50/20 transition-colors group/up">
                  <ImagePlus size={20} className="text-gray-300 group-hover/up:text-primary-400" />
                  <p className="text-xs text-gray-400 group-hover/up:text-primary-500">{t('expenses:ui.attachReceipt')}</p>
                </button>
              )}
              {vatChoice === 'claimable' && !imagePreview && !imageFile && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle size={14} /> {t('expenses:ui.supportMissing')}
                </div>
              )}
              {vatChoice === 'claimable' && (imagePreview || imageFile) && (
                <div className="flex items-center gap-2 text-xs text-emerald-600">
                  <CheckCircle2 size={14} /> {t('expenses:ui.supportAttached')}
                </div>
              )}
            </div>

            {/* ── Notes ─────────────────────────────────────── */}
            <div>
              <label className="label">{t('expenses:fields.notes')}</label>
              <textarea className="input resize-none" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)} placeholder={t('expenses:placeholders.notes')} dir="auto" />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>{t('common:cancel')}</Button>
            <Button type="submit" className="flex-1" loading={saving}>
              {t(expense ? 'expenses:actions.saveChanges' : 'expenses:add')}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
