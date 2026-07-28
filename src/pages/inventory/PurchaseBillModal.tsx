import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Banknote, Building, Check, CreditCard, FileText, ImagePlus, Info, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Rial } from '@/components/ui/RiyalSymbol'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { Purchase, Supplier } from '@/types'

type TaxInputMode = 'included' | 'excluded'
type PaymentStatus = 'paid' | 'unpaid' | 'partial'
type PaymentMethod = 'cash' | 'card' | 'bank_transfer'

interface Props {
  open: boolean
  suppliers: Supplier[]
  tenantId: string
  branchId: string
  editingPurchase?: Purchase | null
  onClose: () => void
  onSaved: () => void
}

const PAY_OPTIONS = [
  { value: 'cash', icon: Banknote },
  { value: 'card', icon: CreditCard },
  { value: 'bank_transfer', icon: Building },
] as const

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

function roundMoney(value: number) {
  return Math.max(0, Math.round(value * 100) / 100)
}

function calculatePurchaseTotals(amountRaw: string, taxMode: TaxInputMode) {
  const amount = Math.max(0, parseFloat(amountRaw) || 0)

  if (taxMode === 'included') {
    const vat = roundMoney(amount * 15 / 115)
    return { subtotal: roundMoney(amount - vat), vat, total: roundMoney(amount) }
  }

  const vat = roundMoney(amount * 0.15)
  return { subtotal: roundMoney(amount), vat, total: roundMoney(amount + vat) }
}

function safeFileName(name: string) {
  const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-')
  return cleaned || 'bill'
}

export default function PurchaseBillModal({
  open,
  suppliers,
  tenantId,
  branchId,
  editingPurchase = null,
  onClose,
  onSaved,
}: Props) {
  const { profile } = useAuth()
  const { t } = useTranslation(['purchases', 'common'])
  const dialogRef = useRef<HTMLDivElement>(null)
  const supplierRef = useRef<HTMLSelectElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const isEditing = Boolean(editingPurchase)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [date, setDate] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [billNumber, setBillNumber] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('paid')
  const [taxMode, setTaxMode] = useState<TaxInputMode>('included')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [billFile, setBillFile] = useState<File | null>(null)
  const [billPreview, setBillPreview] = useState<string | null>(null)
  const [billChanged, setBillChanged] = useState(false)

  const resolvedTenantId = tenantId || profile?.tenant_id || ''
  const resolvedBranchId = branchId || profile?.branch_id || ''
  const branchSuppliers = useMemo(
    () => suppliers.filter(supplier => supplier.branch_id === resolvedBranchId),
    [suppliers, resolvedBranchId],
  )
  const totals = calculatePurchaseTotals(amount, taxMode)
  const selectedSupplier = supplierId
    ? branchSuppliers.find(supplier => supplier.id === supplierId) ?? null
    : null
  const formCanSubmit = Boolean(date && supplierId && selectedSupplier && totals.total > 0)

  const reset = useCallback(() => {
    setSaving(false)
    setError('')
    setDate('')
    setSupplierId('')
    setBillNumber('')
    setPaymentMethod('cash')
    setPaymentStatus('paid')
    setTaxMode('included')
    setAmount('')
    setNotes('')
    setBillFile(null)
    setBillPreview(null)
    setBillChanged(false)
  }, [])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    const nextTaxMode = editingPurchase?.tax_input_mode === 'excluded' ? 'excluded' : 'included'
    setDate(editingPurchase?.purchase_date ?? new Date().toISOString().split('T')[0])
    setSupplierId(editingPurchase?.supplier_id ?? '')
    setBillNumber(editingPurchase?.bill_number ?? '')
    setPaymentMethod((editingPurchase?.payment_method as PaymentMethod) ?? 'cash')
    setPaymentStatus((editingPurchase?.payment_status as PaymentStatus) ?? 'paid')
    setTaxMode(nextTaxMode)
    setAmount(editingPurchase
      ? String(nextTaxMode === 'excluded' ? editingPurchase.subtotal : editingPurchase.total_amount)
      : '')
    setNotes(editingPurchase?.notes ?? '')
    setBillFile(null)
    setBillChanged(false)
    setBillPreview(editingPurchase?.bill_path ? 'attached' : editingPurchase?.bill_url ?? null)
    setError('')
    window.setTimeout(() => (editingPurchase ? supplierRef.current : dateRef.current)?.focus(), 0)
  }, [editingPurchase, open])

  const requestClose = useCallback(() => {
    if (saving) return
    reset()
    onClose()
    window.setTimeout(() => previousFocusRef.current?.focus(), 0)
  }, [onClose, reset, saving])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!nodes.length) return
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault()
        nodes[nodes.length - 1].focus()
      } else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) {
        event.preventDefault()
        nodes[0].focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, requestClose, saving])

  useEffect(() => {
    if (!open || !supplierId) return
    if (!branchSuppliers.some(supplier => supplier.id === supplierId)) setSupplierId('')
  }, [branchSuppliers, open, supplierId])

  const uploadBill = async (purchaseKey: string) => {
    if (!billFile) return null
    const originalName = safeFileName(billFile.name)
    const fallbackExt = billFile.type === 'application/pdf' ? 'pdf' : 'jpg'
    const extension = originalName.includes('.') ? originalName.split('.').pop()! : fallbackExt
    const baseName = originalName.replace(/\.[^.]+$/, '') || 'bill'
    const path = `${resolvedTenantId}/${resolvedBranchId}/purchases/${purchaseKey}/${Date.now()}-${baseName}.${extension}`
    const { error: uploadError } = await supabase.storage
      .from('purchases-bills')
      .upload(path, billFile, { upsert: false })
    if (uploadError) throw uploadError
    return path
  }

  const setPurchaseAttachment = async (purchaseId: string, billPath: string | null) => {
    if (!billChanged) return
    const { error: attachmentError } = await (supabase as any).rpc('set_purchase_bill_attachment', {
      p_purchase_id: purchaseId,
      p_bill_path: billPath,
      p_clear: billPath === null,
    })
    if (attachmentError) throw attachmentError
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return

    if (!date) {
      setError(t('purchases:errors.dateRequired'))
      dateRef.current?.focus()
      return
    }
    if (!supplierId) {
      setError(t('purchases:errors.supplierRequired'))
      supplierRef.current?.focus()
      return
    }
    if (!selectedSupplier) {
      setError(t('purchases:errors.supplierInvalid'))
      supplierRef.current?.focus()
      return
    }
    if (totals.total <= 0) {
      setError(t('purchases:errors.amountPositive'))
      amountRef.current?.focus()
      return
    }

    setSaving(true)
    setError('')

    try {
      if (!resolvedTenantId || !resolvedBranchId) {
        setError(t('purchases:errors.branchRequired'))
        return
      }
      if (selectedSupplier.tenant_id !== resolvedTenantId) {
        setError(t('purchases:errors.supplierBusinessInvalid'))
        return
      }
      if (selectedSupplier.branch_id !== resolvedBranchId) {
        setError(t('purchases:errors.supplierBranchInvalid'))
        return
      }

      const billPath = await uploadBill(editingPurchase?.id ?? crypto.randomUUID())

      if (isEditing && editingPurchase) {
        const { error: editError } = await (supabase as any).rpc('update_purchase_entry', {
          p_payload: {
            purchase_id: editingPurchase.id,
            supplier_id: supplierId,
            purchase_date: date,
            bill_number: billNumber.trim() || null,
            tax_input_mode: taxMode,
            payment_status: paymentStatus,
            payment_method: paymentMethod,
            notes: notes.trim() || null,
            amount: Number(amount),
          },
        })
        if (editError) throw editError
        await setPurchaseAttachment(editingPurchase.id, billPath)
      } else {
        const purchasePayload = {
          tenant_id: resolvedTenantId,
          branch_id: resolvedBranchId,
          supplier_id: supplierId,
          added_by: profile?.id ?? null,
          purchase_date: date,
          purchase_mode: 'simple_bill' as const,
          status: 'posted',
          receiving_status: 'not_applicable',
          bill_number: billNumber.trim() || null,
          tax_input_mode: taxMode,
          payment_status: paymentStatus,
          subtotal: totals.subtotal,
          vat_amount: totals.vat,
          total_amount: totals.total,
          payment_method: paymentMethod,
          bill_url: null,
          bill_path: billPath,
          notes: notes.trim() || null,
        }
        const { error: insertError } = await supabase.from('purchases').insert(purchasePayload)
        if (insertError) throw insertError
      }

      toast.success(t('purchases:success.bill'))
      onSaved()
      reset()
      onClose()
      window.setTimeout(() => previousFocusRef.current?.focus(), 0)
    } catch (saveError) {
      console.error('[PurchaseBillModal] save failed', saveError)
      setError(t('purchases:errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-y-0 left-0 right-0 z-50 flex items-center justify-center bg-black/55 p-2 md:left-[var(--app-sidebar-width)] md:p-5"
      onMouseDown={event => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-modal-title"
        aria-describedby="purchase-modal-description"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-[#fffdf7] shadow-2xl md:max-h-[min(92vh,760px)]"
      >
        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <header className="flex flex-shrink-0 items-center gap-3 border-b border-primary-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
              <FileText size={19} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="purchase-modal-title" className="truncate text-base font-bold text-gray-900">
                {t(isEditing ? 'purchases:edit' : 'purchases:new')}
              </h2>
              <p id="purchase-modal-description" className="mt-0.5 text-xs text-gray-500">
                {t('purchases:modal.billOnlySubtitle')}
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              aria-label={t('common:close')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50 active:scale-[0.97]"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
              <div className="min-w-0 space-y-4">
                <section aria-labelledby="purchase-details-heading">
                  <SectionHeading id="purchase-details-heading">{t('purchases:sections.details')}</SectionHeading>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="purchase-date">{t('purchases:fields.date')} <span className="text-red-600">*</span></label>
                      <input ref={dateRef} id="purchase-date" className="input" type="date" value={date} onChange={event => setDate(event.target.value)} />
                    </div>
                    <div>
                      <label className="label" htmlFor="purchase-supplier">{t('purchases:fields.supplier')} <span className="text-red-600">*</span></label>
                      <select
                        ref={supplierRef}
                        id="purchase-supplier"
                        className="input"
                        value={supplierId}
                        aria-invalid={Boolean(supplierId && !selectedSupplier)}
                        onChange={event => setSupplierId(event.target.value)}
                      >
                        <option value="">— {t('purchases:noSupplier')} —</option>
                        {branchSuppliers.map(supplier => (
                          <option key={supplier.id} value={supplier.id}>{supplier.name_ar || supplier.name}</option>
                        ))}
                      </select>
                      {branchSuppliers.length === 0 && (
                        <p role="status" className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-600">
                          <AlertTriangle size={12} className="flex-shrink-0 text-amber-600" aria-hidden="true" />
                          <span>{t('purchases:modal.supplierCompactEmpty')}</span>
                          <a href="/suppliers" target="_blank" rel="noreferrer" className="font-semibold text-primary-700 underline underline-offset-2">
                            {t('purchases:modal.addSupplier')}
                          </a>
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="label" htmlFor="purchase-bill-number">{t('purchases:fields.billNumber')}</label>
                      <input
                        id="purchase-bill-number"
                        className="input"
                        value={billNumber}
                        onChange={event => setBillNumber(event.target.value)}
                        placeholder={t('purchases:modal.supplierBillNumber')}
                      />
                    </div>
                    <div>
                      <span className="label">{t('purchases:sections.attachment')}</span>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                        className="hidden"
                        onChange={event => {
                          const file = event.target.files?.[0]
                          if (!file) return
                          setBillFile(file)
                          setBillPreview(URL.createObjectURL(file))
                          setBillChanged(true)
                        }}
                      />
                      <div className="flex h-[38px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-2">
                        <button type="button" onClick={() => fileRef.current?.click()}
                          className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-gray-600 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:scale-[0.99]">
                          <ImagePlus size={14} className="flex-shrink-0" aria-hidden="true" />
                          <span className="truncate">{billFile?.name || (billPreview ? t('purchases:billAttached') : t('purchases:attachBill'))}</span>
                        </button>
                        {billPreview && (
                          <button
                            type="button"
                            aria-label={t('purchases:remove')}
                            onClick={() => {
                              setBillFile(null)
                              setBillPreview(null)
                              setBillChanged(true)
                            }}
                            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500 active:scale-[0.97]"
                          >
                            <X size={13} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <section aria-labelledby="purchase-payment-heading">
                  <SectionHeading id="purchase-payment-heading">{t('purchases:sections.payment')}</SectionHeading>
                  <fieldset className="mt-2">
                    <legend className="sr-only">{t('purchases:modal.paymentMethod')}</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {PAY_OPTIONS.map(({ value, icon: Icon }) => (
                        <label key={value} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-center text-xs font-semibold focus-within:ring-2 focus-within:ring-primary-500 active:scale-[0.99] ${
                          paymentMethod === value ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 bg-white text-gray-600'
                        }`}>
                          <input className="sr-only" type="radio" name="payment-method" value={value}
                            checked={paymentMethod === value} onChange={() => setPaymentMethod(value)} />
                          <Icon size={15} aria-hidden="true" />
                          {t(`purchases:paymentMethod.${value}`)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </section>

                <section aria-labelledby="purchase-vat-heading">
                  <SectionHeading id="purchase-vat-heading">{t('purchases:modal.amountAndVat')}</SectionHeading>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="purchase-amount">
                        {t(taxMode === 'excluded' ? 'purchases:fields.subtotalBeforeVat' : 'purchases:fields.totalAmount')} <span className="text-red-600">*</span>
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-xs font-semibold text-gray-500">SAR</span>
                        <MoneyInput ref={amountRef} id="purchase-amount" className="input ps-12" value={amount}
                          onValueChange={setAmount} placeholder="0.00" />
                      </div>
                    </div>
                    <fieldset>
                      <legend className="mb-2 text-xs font-semibold text-gray-600">{t('purchases:sections.vat')}</legend>
                      <div className="grid grid-cols-2 gap-2">
                        {(['included', 'excluded'] as TaxInputMode[]).map(value => (
                          <label key={value} className={`cursor-pointer rounded-lg border px-2.5 py-2 focus-within:ring-2 focus-within:ring-amber-500 active:scale-[0.99] ${
                            taxMode === value ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white'
                          }`}>
                            <input className="sr-only" type="radio" name="tax-mode" value={value}
                              checked={taxMode === value} onChange={() => setTaxMode(value)} />
                            <span className="flex items-center gap-2 text-xs font-bold text-gray-800">
                              {taxMode === value && <Check size={12} className="text-amber-700" aria-hidden="true" />}
                              {t(`purchases:taxMode.${value}`)}
                            </span>
                            <span className="mt-1 block text-[11px] leading-4 text-gray-500">
                              {t(`purchases:modal.vat${value === 'included' ? 'Included' : 'Excluded'}Hint`)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                </section>

                <section aria-label={t('purchases:modal.supportingDetails')}>
                  <label className="label" htmlFor="purchase-notes">{t('purchases:fields.notes')}</label>
                  <textarea id="purchase-notes" className="input resize-none" rows={2} value={notes}
                    onChange={event => setNotes(event.target.value)} placeholder={t('purchases:placeholders.notes')} dir="auto" />
                  <p className="mt-1 text-[11px] text-gray-500">{t('purchases:modal.notesHelper')}</p>
                </section>
              </div>

              <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start" aria-labelledby="purchase-preview-heading">
                <section className="rounded-xl border border-primary-200 bg-primary-50/70 p-4">
                  <h3 id="purchase-preview-heading" className="text-sm font-bold text-[#173f2a]">{t('purchases:modal.financialPreview')}</h3>
                  <dl className="mt-3 divide-y divide-primary-100 text-sm" aria-live="polite">
                    <PreviewMetric label={t('purchases:fields.subtotal')} value={<Rial amount={totals.subtotal} />} />
                    <PreviewMetric label={t('purchases:fields.vat')} value={<Rial amount={totals.vat} />} />
                    <PreviewMetric label={t('purchases:modal.paymentMethod')} value={t(`purchases:paymentMethod.${paymentMethod}`)} />
                  </dl>
                  <div className="mt-3 border-t-2 border-primary-700 pt-3">
                    <div className="flex items-end justify-between gap-3">
                      <span className="text-sm font-bold text-[#173f2a]">{t('purchases:modal.totalBill')}</span>
                      <span className="text-xl font-bold text-primary-800"><Rial amount={totals.total} /></span>
                    </div>
                  </div>
                  <p className="mt-4 flex items-start gap-2 rounded-lg bg-white/70 p-2.5 text-xs leading-5 text-gray-600">
                    <Info size={14} className="mt-0.5 flex-shrink-0 text-primary-700" aria-hidden="true" />
                    <span>
                      {t('purchases:modal.stockGuidance')}{' '}
                      <a href="/inventory" target="_blank" rel="noreferrer" className="font-semibold text-primary-800 underline underline-offset-2">
                        {t('purchases:modal.openAddStock')}
                      </a>
                    </span>
                  </p>
                  <p className="mt-3 text-xs leading-5 text-gray-600" aria-live="polite">
                    {formCanSubmit
                      ? t('purchases:modal.billConfirmation', {
                          amount: totals.total.toFixed(2),
                          vat: totals.vat.toFixed(2),
                        })
                      : t('purchases:modal.completeRequired')}
                  </p>
                </section>
              </aside>
            </div>

            {error && (
              <div id="purchase-form-error" role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <footer className="flex flex-shrink-0 flex-col gap-3 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="text-xs leading-5 text-gray-600 sm:max-w-[65%]" aria-live="polite">
              {!formCanSubmit ? t('purchases:modal.completeRequired') : ''}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="secondary" className="w-full sm:w-auto active:scale-[0.97]" onClick={requestClose} disabled={saving}>
                {t('common:cancel')}
              </Button>
              <Button type="submit" className="w-full bg-[#173f2a] hover:bg-[#22563b] active:scale-[0.97] sm:w-auto"
                loading={saving} disabled={saving || !formCanSubmit}>
                {isEditing ? t('purchases:actions.saveChanges') : t('purchases:actions.recordPurchase')}
              </Button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return <h3 id={id} className="text-xs font-bold uppercase tracking-wide text-gray-600">{children}</h3>
}

function PreviewMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-gray-600">{label}</dt>
      <dd className="text-end font-semibold tabular-nums text-gray-900">{value}</dd>
    </div>
  )
}
