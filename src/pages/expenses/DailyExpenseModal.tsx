import { useState, useEffect, useRef } from 'react'
import { ImagePlus, CreditCard, Banknote, Building, AlertTriangle, Check, CheckCircle2, Plus, ReceiptText } from 'lucide-react'
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
import ExpenseModalShell from './ExpenseModalShell'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

// ── Payment method options ────────────────────────────────────────────────────

const PAY_OPTIONS: { value: ExpensePaymentMethod; icon: React.ElementType }[] = [
  { value: 'cash', icon: Banknote }, { value: 'card', icon: CreditCard }, { value: 'bank_transfer', icon: Building },
]

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="rounded-md border border-[#B5943E]/55 bg-[#fffdf5] px-1.5 py-0.5 text-[10px] font-black tracking-wide text-[#0F2419]" aria-hidden="true">{number}</span>
      <p className="text-[11px] font-black uppercase tracking-widest text-[#1B6B3A]">{children}</p>
    </div>
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

export default function DailyExpenseModal({ open, expense, categories, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const { t } = useTranslation(['expenses', 'common'])
  const fileRef     = useRef<HTMLInputElement>(null)
  const operationIdRef = useRef<string | null>(null)

  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState('')
  const [imageFile,    setImageFile]    = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [confirmRemoveReceipt, setConfirmRemoveReceipt] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierSource, setSupplierSource] = useState<'none' | 'saved' | 'manual'>('none')
  const [showSupplierDetails, setShowSupplierDetails] = useState(false)

  // Form state
  const [date,        setDate]        = useState('')
  const [description, setDescription] = useState('')
  const [vendorName,  setVendorName]  = useState('')
  const [categoryId,  setCategoryId]  = useState('')
  const [amount,      setAmount]      = useState('')
  const [vatChoice,   setVatChoice]   = useState<SimpleExpenseVatChoice | ''>('')
  const [priceTreatment, setPriceTreatment] = useState<'included' | 'exclusive' | ''>('')
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState('')
  const [supplierVatNumber, setSupplierVatNumber] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [supplierCrNumber, setSupplierCrNumber] = useState('')
  const [supplierContact, setSupplierContact] = useState('')
  const [invoiceTime, setInvoiceTime] = useState('')
  const [taxableAmount, setTaxableAmount] = useState('')
  const [vatAmountInput, setVatAmountInput] = useState('')
  const [vatAmountsManual, setVatAmountsManual] = useState(false)
  const [payMethod,   setPayMethod]   = useState<ExpensePaymentMethod | ''>('')
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
      setPriceTreatment(expense.vat_treatment === 'on_top' ? 'exclusive' : 'included')
      setTaxInvoiceNumber(expense.tax_invoice_number ?? '')
      setSupplierVatNumber(expense.supplier_vat_number ?? '')
      setSupplierId(expense.supplier_id ?? '')
      setSupplierCrNumber(expense.supplier_cr_number ?? '')
      setSupplierContact(expense.supplier_contact ?? '')
      setInvoiceTime(expense.invoice_time?.slice(0, 5) ?? '')
      setTaxableAmount(String(expense.expense_before_vat ?? expense.amount))
      setVatAmountInput(String(expense.vat_amount ?? 0))
      setVatAmountsManual(true)
      setPayMethod((expense.payment_method as ExpensePaymentMethod) ?? '')
      setNotes(expense.notes ?? '')
      setImagePreview(expense.receipt_url)
      setSupplierSource(expense.supplier_id ? 'saved' : expense.vendor_name ? 'manual' : 'none')
      setShowSupplierDetails(Boolean(expense.supplier_id || expense.vendor_name))
    } else {
      const today = new Date().toISOString().split('T')[0]
      setDate(today)
      setDescription('')
      setVendorName('')
      setCategoryId('')
      setAmount('')
      setVatChoice('')
      setPriceTreatment('')
      setTaxInvoiceNumber('')
      setSupplierVatNumber('')
      setSupplierId('')
      setSupplierCrNumber('')
      setSupplierContact('')
      setInvoiceTime('')
      setTaxableAmount('')
      setVatAmountInput('')
      setVatAmountsManual(false)
      setPayMethod('')
      setNotes('')
      setImagePreview(null)
      setSupplierSource('none')
      setShowSupplierDetails(false)
      operationIdRef.current = crypto.randomUUID()
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
  const defaultVat = calculateExpenseVat(amountNum, vatChoice || 'not_claimable')
  const taxableAmountNum = parseFloat(taxableAmount) || 0
  const vatAmountNum = parseFloat(vatAmountInput) || 0
  const totalPaidNum = vatChoice === 'claimable' && priceTreatment === 'exclusive'
    ? Number((amountNum + vatAmountNum).toFixed(2))
    : amountNum
  const vatCheck = expenseVatConsistency(totalPaidNum, taxableAmountNum, vatAmountNum)
  const supplierVatValid = !supplierVatNumber || isValidSaudiVatNumber(supplierVatNumber)

  useEffect(() => {
    if (vatChoice !== 'claimable' || !priceTreatment || vatAmountsManual) return
    const entered = parseFloat(amount) || 0
    const taxable = priceTreatment === 'included' ? entered / 1.15 : entered
    const vatAmount = taxable * 0.15
    setTaxableAmount(taxable ? taxable.toFixed(2) : '')
    setVatAmountInput(vatAmount ? vatAmount.toFixed(2) : '')
  }, [amount, vatChoice, priceTreatment, vatAmountsManual])

  const selectSupplier = (id: string) => {
    setSupplierSource('saved')
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
    if (saving) return
    if (!description.trim()) { setError(t('expenses:errors.descriptionRequired')); return }
    if (!amount || amountNum <= 0) { setError(t('expenses:errors.amountPositive')); return }
    if (!date) { setError(t('expenses:errors.dateRequired')); return }
    if (!vatChoice) { setError(t('expenses:errors.vatTreatmentRequired')); return }
    if (!payMethod) { setError(t('expenses:errors.paymentMethodRequired')); return }
    if (vatChoice === 'claimable') {
      if (!priceTreatment) { setError(t('expenses:errors.priceTreatmentRequired')); return }
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

      const totalPaid = Number(totalPaidNum.toFixed(2))
      const calculatedVat = vatChoice === 'claimable'
        ? {
            amount: Number(taxableAmountNum.toFixed(2)),
            expenseBeforeVat: Number(taxableAmountNum.toFixed(2)),
            vatTreatment: priceTreatment === 'exclusive' ? 'on_top' : 'included',
            vatClaimStatus: 'claimable',
            vatAmount: Number(vatAmountNum.toFixed(2)),
            totalPaid,
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
        supplier_vat_number: supplierVatNumber.trim() || null,
        supplier_id: supplierId || null,
        supplier_cr_number: supplierCrNumber.trim() || null,
        supplier_contact: supplierContact.trim() || null,
        invoice_time: invoiceTime || null,
        receipt_url:    receiptUrl,
        notes:          notes.trim() || null,
      }

      const q = supabase as unknown as { from: (t: string) => any }

      if (expense) {
        const { error: err } = await q.from('expenses').update(payload).eq('id', expense.id)
        if (err) { console.error('Expense update failed', err); setError(t('expenses:errors.saveFailed')); return }
      } else {
        const createPayload = {
          branch_id: bid,
          expense_date: date,
          description: description.trim(),
          amount: amountNum,
          vat_treatment: vatChoice,
          vat_amount_mode: vatChoice === 'claimable' ? priceTreatment : null,
          payment_method: payMethod,
          category_id: categoryId || null,
          supplier_id: supplierId || null,
          vendor_name: vendorName.trim() || null,
          tax_invoice_number: taxInvoiceNumber.trim() || null,
          supplier_vat_number: supplierVatNumber.trim() || null,
          supplier_cr_number: supplierCrNumber.trim() || null,
          supplier_contact: supplierContact.trim() || null,
          invoice_time: invoiceTime || null,
          receipt_url: receiptUrl,
          notes: notes.trim() || null,
          operation_id: operationIdRef.current ?? crypto.randomUUID(),
        }
        operationIdRef.current = createPayload.operation_id
        const { error: err } = await (supabase as any).rpc('create_expense_v1', { p_payload: createPayload })
        if (err) { console.error('Expense creation failed', err); setError(t('expenses:errors.saveFailed')); return }
      }

      toast.success(t(expense ? 'expenses:success.updated' : 'expenses:success.dailyAdded'))
      onSaved()
      onClose()
    } catch {
      setError(t('expenses:errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  if (!expense && !vatChoice) {
    return (
      <ExpenseModalShell open={open} kind="daily" editing={false} saving={saving} canSubmit={false} compact showSubmit={false} onClose={onClose} onSubmit={event => event.preventDefault()}>
        <section className="mx-auto max-w-[560px] py-1" aria-labelledby="expense-vat-choice-heading">
          <div className="flex items-center gap-2.5">
            <span className="rounded-md border border-[#B5943E]/55 bg-[#fffdf5] px-1.5 py-0.5 text-[10px] font-black tracking-wide text-[#0F2419]" aria-hidden="true">01</span>
            <div><h3 id="expense-vat-choice-heading" className="text-sm font-black text-slate-950">{t('expenses:fields.vatTreatment')}</h3><p className="mt-0.5 text-xs text-gray-500">{t('expenses:ui.chooseVatTreatment')}</p></div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {SIMPLE_EXPENSE_VAT_OPTIONS.map(option => {
              const Icon = option.value === 'claimable' ? CheckCircle2 : ReceiptText
              return <button key={option.value} type="button" onClick={() => setVatChoice(option.value)}
                className="group rounded-xl border border-gray-200 bg-white p-4 text-start shadow-sm transition hover:border-[#B5943E] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B6B3A]">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#eff6ef] text-[#1B6B3A] group-hover:bg-[#0F2419] group-hover:text-[#F3D98B]"><Icon size={17} aria-hidden="true" /></span>
                <p className="mt-3 text-sm font-black text-[#0F2419]">{t(`expenses:vat.${option.value}`)}</p>
                <p className="mt-1 text-xs leading-5 text-gray-600">{t(`expenses:vatHelp.${option.value}`)}</p>
              </button>
            })}
          </div>
        </section>
      </ExpenseModalShell>
    )
  }

  return (
    <ExpenseModalShell open={open} kind="daily" editing={Boolean(expense)} saving={saving}
      subtitle={vatChoice === 'claimable' ? t('expenses:vatHelp.claimable') : t('expenses:vatHelp.not_claimable')}
      canSubmit={Boolean(date && description.trim() && amountNum > 0 && vatChoice && payMethod && (vatChoice !== 'claimable' || priceTreatment))} onClose={onClose} onSubmit={handleSubmit}>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)]">
        <div className="min-w-0 space-y-5">

            {/* ── Basic details ────────────────────────────── */}
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <SectionLabel number="01">{t('expenses:sections.details')}</SectionLabel>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('expenses:fields.date')} <span className="text-red-500">*</span></label>
                  <input data-autofocus className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
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

              <button type="button" onClick={() => setVatChoice('')} className="text-xs font-semibold text-[#173f2a] hover:text-[#22563b]">
                {t('expenses:actions.changeVatTreatment')}
              </button>
              <div>
                <label className="label">{t('expenses:fields.expenseName')} <span className="text-red-500">*</span></label>
                <input className="input" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder={t('expenses:placeholders.description')} dir="auto" />
              </div>

              {!showSupplierDetails ? (
                <button type="button" onClick={() => setShowSupplierDetails(true)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#173f2a] hover:text-[#22563b]">
                  <Plus size={14} /> {t('expenses:actions.linkSupplier')}
                </button>
              ) : <>
              <div>
                <label className="label">{t('expenses:ui.supplierSource')}</label>
                <select className="input" value={supplierSource}
                  onChange={e => {
                    const source = e.target.value as 'none' | 'saved' | 'manual'
                    setSupplierSource(source)
                    if (source === 'none') { setSupplierId(''); setVendorName('') }
                    if (source === 'manual') { setSupplierId(''); setVendorName('') }
                    if (e.target.value === 'saved' && suppliers[0]) selectSupplier(suppliers[0].id)
                  }}>
                  <option value="none">{t('expenses:ui.noSupplier')}</option>
                  <option value="manual">{t('expenses:ui.manualSupplier')}</option>
                  <option value="saved">{t('expenses:ui.savedSupplier')}</option>
                </select>
              </div>
              {supplierId && (
                <div>
                  <label className="label">{t('expenses:ui.savedSupplier')}</label>
                  <select className="input" value={supplierId} onChange={e => selectSupplier(e.target.value)}>
                  {suppliers.map(supplier => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
                </div>
              )}
              {supplierSource === 'manual' && (
              <div>
                <label className="label">
                  {t('expenses:fields.vendor')} {vatChoice === 'claimable' && <span className="text-red-500">*</span>}
                </label>
                <input className="input" value={vendorName} onChange={e => setVendorName(e.target.value)}
                  placeholder={t('expenses:placeholders.vendor')} dir="auto" />
              </div>
              )}
              </>}
            </section>

            {/* ── Amount & VAT ─────────────────────────────── */}
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <SectionLabel number="02">{t('expenses:sections.amountVat')}</SectionLabel>

              <div>
                <label className="label">{t('expenses:fields.amountSar')} <span className="text-red-500">*</span></label>
                <div className="relative">
                  <span className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-gray-400">
                    SAR
                  </span>
                  <MoneyInput
                    className="input ps-12"
                    value={amount}
                    onValueChange={setAmount}
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('expenses:fields.vatTreatment')} <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {SIMPLE_EXPENSE_VAT_OPTIONS.map(opt => (
                    <label
                      key={opt.value}
                      className={`cursor-pointer text-start px-3 py-2.5 rounded-xl border focus-within:ring-2 focus-within:ring-primary-500 active:scale-[0.99] ${
                        vatChoice === opt.value
                          ? 'border-[#173f2a] bg-primary-50 text-primary-800'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <input className="sr-only" type="radio" name="expense-vat" value={opt.value}
                        checked={vatChoice === opt.value} onChange={() => { setVatChoice(opt.value); setPriceTreatment(''); setVatAmountsManual(false); setError('') }} />
                      <p className="flex items-center gap-2 text-xs font-semibold">
                        {vatChoice === opt.value && <Check size={13} aria-hidden="true" />}
                        {t(`expenses:vat.${opt.value}`)}
                      </p>
                      <p className="mt-1 text-[10px] text-gray-500">{t(`expenses:vatHelp.${opt.value}`)}</p>
                    </label>
                  ))}
                </div>
              </div>

              {vatChoice === 'claimable' && (
                <div className="space-y-3 rounded-xl border border-primary-100 bg-primary-50/30 p-3">
                  <div>
                    <label className="label">{t('expenses:fields.priceTreatment')} <span className="text-red-500">*</span></label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(['included', 'exclusive'] as const).map(value => (
                        <label key={value} className={`cursor-pointer rounded-xl border px-3 py-2.5 text-xs font-semibold focus-within:ring-2 focus-within:ring-primary-500 ${
                          priceTreatment === value ? 'border-[#173f2a] bg-white text-[#173f2a]' : 'border-gray-200 bg-white text-gray-600'
                        }`}>
                          <input className="sr-only" type="radio" name="expense-price-treatment" value={value}
                            checked={priceTreatment === value} onChange={() => { setPriceTreatment(value); setVatAmountsManual(false); setError('') }} />
                          {t(`expenses:vat.${value}`)}
                        </label>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">{t('expenses:ui.priceTreatmentHint')}</p>
                  </div>
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
                    <span>{t('expenses:preview.totalPaid')}</span>
                    <span className="tabular-nums text-primary-600"><Rial amount={totalPaidNum} /></span>
                  </div>
                </div>
              )}
            </section>

            {/* ── Payment method ────────────────────────────── */}
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <SectionLabel number="03">{t('expenses:fields.paymentMethod')} <span className="text-red-500">*</span></SectionLabel>
              <div className="flex gap-2">
                {PAY_OPTIONS.map(({ value, icon: Icon }) => (
                  <label
                    key={value}
                    className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium focus-within:ring-2 focus-within:ring-primary-500 active:scale-[0.97] ${
                      payMethod === value
                        ? 'border-[#173f2a] bg-primary-50 text-primary-800'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <input className="sr-only" type="radio" name="expense-payment" value={value}
                      checked={payMethod === value} onChange={() => { setPayMethod(value); setError('') }} />
                    {payMethod === value ? <Check size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
                    {t(`expenses:payment.${value}`)}
                  </label>
                ))}
              </div>
            </section>

            {/* ── Receipt upload ────────────────────────────── */}
            <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <SectionLabel number="04">{t('expenses:sections.receipt')}</SectionLabel>
              <p className="text-xs text-gray-400">{vatChoice === 'claimable' ? t('expenses:ui.taxInvoiceHint') : t('expenses:ui.receiptHint')}</p>
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
                    <button type="button" onClick={() => setConfirmRemoveReceipt(true)}
                      className="bg-white text-red-500 text-xs font-medium px-3 py-1.5 rounded-lg shadow">
                      {t('expenses:ui.remove')}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="w-full h-24 flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-xl hover:border-primary-400 hover:bg-primary-50/20 transition-colors group/up">
                  <ImagePlus size={20} className="text-gray-300 group-hover/up:text-primary-400" />
                  <p className="text-xs text-gray-400 group-hover/up:text-primary-500">{vatChoice === 'claimable' ? t('expenses:ui.attachTaxInvoice') : t('expenses:ui.attachReceipt')}</p>
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
            </section>

            {/* ── Notes ─────────────────────────────────────── */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <label className="label">{t('expenses:fields.notes')}</label>
              <textarea className="input resize-none" rows={2} value={notes}
                onChange={e => setNotes(e.target.value)} placeholder={t('expenses:placeholders.notes')} dir="auto" />
            </section>

            {error && (
              <div role="alert" aria-live="assertive" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
        </div>
        <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <section aria-live="polite" className="rounded-xl border border-white/10 bg-[#173f2a] p-4 text-[#fff8e7] shadow-lg">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#fff8e7]/65">{t('expenses:preview.financial')}</p>
            <div className="mt-4 space-y-2 text-sm">
              <PreviewLine label={vatChoice === 'claimable' ? t('expenses:preview.beforeVat') : t('expenses:preview.expenseAmount')} value={vatChoice === 'claimable' ? taxableAmountNum : defaultVat.expenseBeforeVat} />
              <PreviewLine label={t('expenses:preview.inputVat')} value={vatChoice === 'claimable' ? vatAmountNum : 0} note={vatChoice === 'not_claimable' ? t('expenses:vat.notClaimableShort') : undefined} />
              <div className="border-t border-white/15 pt-3">
                <p className="text-xs text-[#fff8e7]/65">{t('expenses:preview.totalPaid')}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums"><Rial amount={totalPaidNum} /></p>
              </div>
              <p className="border-t border-white/15 pt-3 text-xs text-[#fff8e7]/80">{payMethod ? t(`expenses:payment.${payMethod}`) : t('expenses:payment.notSelected')}</p>
              {vendorName && <p className="break-words text-xs" dir="auto">{vendorName}</p>}
            </div>
          </section>
        </aside>
      </div>
      <ConfirmDialog
        open={confirmRemoveReceipt}
        kind="removeReceipt"
        onClose={() => setConfirmRemoveReceipt(false)}
        onConfirm={() => {
          setImageFile(null)
          setImagePreview(null)
          setConfirmRemoveReceipt(false)
        }}
      />
    </ExpenseModalShell>
  )
}

function PreviewLine({ label, value, note }: { label: string; value: number; note?: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-[#fff8e7]/75">{label}</span><span className="font-semibold tabular-nums">{note ?? <Rial amount={value} />}</span></div>
}
