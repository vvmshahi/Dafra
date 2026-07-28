import { useEffect, useRef, useState } from 'react'
import { Building2, Check, CircleAlert, CircleCheck, User, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import {
  customerDisplayName,
  createPosCustomer,
  findCustomerDuplicate,
  normalizeSaudiMobile,
  type PosCustomerCreateClient,
  type PosCustomerRecord,
} from '@/lib/pos/customerSearch'

const SAUDI_MOBILE_RE = /^05\d{8}$/
const VAT_RE = /^3\d{13}3$/
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function PosCustomerQuickCreateModal({
  customers,
  initialQuery,
  tenantId,
  branchId,
  onClose,
  onCreated,
  onSelectExisting,
}: {
  customers: PosCustomerRecord[]
  initialQuery: string
  tenantId: string
  branchId: string
  onClose: () => void
  onCreated: (customer: PosCustomerRecord) => void
  onSelectExisting: (customer: PosCustomerRecord) => void
}) {
  const { t } = useTranslation(['pos', 'customers', 'common'])
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const vatRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  const [type, setType] = useState<'individual' | 'business'>('individual')
  const initialMobile = normalizeSaudiMobile(initialQuery)
  const [name, setName] = useState(SAUDI_MOBILE_RE.test(initialMobile) ? '' : initialQuery.trim())
  const [phone, setPhone] = useState(SAUDI_MOBILE_RE.test(initialMobile) ? initialMobile : '')
  const [vatNumber, setVatNumber] = useState('')
  const [crNumber, setCrNumber] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState<PosCustomerRecord | null>(null)

  const normalizedPhone = normalizeSaudiMobile(phone)
  const vatValid = !vatNumber.trim() || VAT_RE.test(vatNumber.trim())
  const businessReady = type === 'business' && Boolean(name.trim()) && VAT_RE.test(vatNumber.trim())
  savingRef.current = saving

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => (name ? phoneRef : nameRef).current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const nodes = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!nodes.length) return
      if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault()
        nodes.at(-1)?.focus()
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault()
        nodes[0].focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setError('')
    setDuplicate(null)
    if (!name.trim()) {
      setError(t('pos:customerQuick.nameRequired'))
      nameRef.current?.focus()
      return
    }
    if (!SAUDI_MOBILE_RE.test(normalizedPhone)) {
      setError(t('pos:customerQuick.mobileInvalid'))
      phoneRef.current?.focus()
      return
    }
    if (!vatValid) {
      setError(t('customers:errors.vatInvalid'))
      vatRef.current?.focus()
      return
    }
    const existing = findCustomerDuplicate(customers, { phone: normalizedPhone, vatNumber, crNumber })
    if (existing) {
      setDuplicate(existing)
      setError(t('pos:customerQuick.alreadyExists'))
      return
    }

    setSaving(true)
    const displayName = name.trim()
    const payload = {
      tenant_id: tenantId,
      branch_id: branchId,
      customer_type: type,
      name: type === 'business' ? (contactPerson.trim() || displayName) : displayName,
      name_ar: null,
      business_name: type === 'business' ? displayName : null,
      business_name_ar: null,
      company_name: type === 'business' ? displayName : null,
      phone: normalizedPhone,
      vat_number: type === 'business' ? (vatNumber.trim() || null) : null,
      cr_number: type === 'business' ? (crNumber.trim() || null) : null,
      is_active: true,
    }
    try {
      try {
        const created = await createPosCustomer(supabase as unknown as PosCustomerCreateClient, payload)
        onCreated(created)
      } catch (creationError) {
        const failure = creationError as { code?: string; message?: string }
        const technical = `${failure.code ?? ''} ${failure.message ?? ''}`.toLowerCase()
        setError(technical.includes('duplicate') || technical.includes('23505')
          ? t('pos:customerQuick.alreadyExists')
          : t('pos:customerQuick.saveFailed'))
        return
      }
    } catch {
      setError(t('pos:customerQuick.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-2 sm:p-5"
      onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="pos-customer-modal-title"
        aria-describedby="pos-customer-modal-description"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
            <div>
              <h2 id="pos-customer-modal-title" className="text-base font-bold text-gray-900">{t('pos:customerQuick.title')}</h2>
              <p id="pos-customer-modal-description" className="mt-0.5 text-xs text-gray-500">{t('pos:customerQuick.subtitle')}</p>
            </div>
            <button type="button" onClick={onClose} disabled={saving} aria-label={t('common:close')}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-primary-500">
              <X size={17} aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            <fieldset>
              <legend className="label">{t('customers:fields.type')}</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['individual', 'business'] as const).map(value => {
                  const Icon = value === 'business' ? Building2 : User
                  return (
                    <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 ${
                      type === value ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-600'
                    }`}>
                      <input className="sr-only" type="radio" name="pos-customer-type" value={value}
                        checked={type === value} onChange={() => {
                          setType(value)
                          setVatNumber('')
                          setCrNumber('')
                          setContactPerson('')
                          setError('')
                        }} />
                      <Icon size={15} aria-hidden="true" />
                      <span className="text-sm font-semibold">{t(`customers:${value === 'business' ? 'businessB2b' : 'individual'}`)}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="label">{t('pos:customerQuick.name')} *</span>
                <input ref={nameRef} className="input" value={name} onChange={event => { setName(event.target.value); setError(''); setDuplicate(null) }}
                  dir="auto" aria-invalid={Boolean(error && !name.trim())} />
              </label>
              <label className="block">
                <span className="label">{t('pos:customerQuick.mobile')} *</span>
                <input ref={phoneRef} className="input" type="tel" inputMode="tel" dir="ltr" value={phone}
                  onChange={event => { setPhone(event.target.value); setError(''); setDuplicate(null) }} placeholder="0512345678" />
              </label>
              {type === 'business' && (
                <label className="block">
                  <span className="label">{t('customers:fields.contactPerson')}</span>
                  <input className="input" value={contactPerson} onChange={event => setContactPerson(event.target.value)} dir="auto" />
                </label>
              )}
              {type === 'business' && (
                <>
                  <label className="block">
                    <span className="label">{t('customers:fields.vatNumber')}</span>
                    <input ref={vatRef} className="input" value={vatNumber} onChange={event => { setVatNumber(event.target.value); setError(''); setDuplicate(null) }}
                      inputMode="numeric" maxLength={15} dir="ltr" placeholder="3XXXXXXXXXXXXX3" />
                  </label>
                  <label className="block">
                    <span className="label">{t('customers:fields.crNumber')}</span>
                    <input className="input" value={crNumber} onChange={event => { setCrNumber(event.target.value); setDuplicate(null) }}
                      inputMode="numeric" dir="ltr" />
                  </label>
                  <div role="status" aria-live="polite" className={`sm:col-span-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
                    businessReady ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
                  }`}>
                    {businessReady ? <CircleCheck size={14} aria-hidden="true" /> : <CircleAlert size={14} aria-hidden="true" />}
                    {t(businessReady ? 'pos:customerQuick.b2bReady' : 'pos:customerQuick.vatOptional')}
                  </div>
                </>
              )}
            </div>

            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {duplicate && (
              <button type="button" onClick={() => onSelectExisting(duplicate)}
                className="flex w-full items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 px-3 py-3 text-start text-sm text-primary-800 focus-visible:ring-2 focus-visible:ring-primary-500">
                <Check size={15} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold" dir="auto">{customerDisplayName(duplicate)}</span>
                  <span className="block text-xs" dir="ltr">{duplicate.phone}</span>
                </span>
                <span className="text-xs font-semibold">{t('pos:customerQuick.selectExisting')}</span>
              </button>
            )}
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-gray-100 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>{t('common:cancel')}</Button>
            <Button type="submit" loading={saving} disabled={saving}>{t('pos:customerQuick.add')}</Button>
          </footer>
        </form>
      </div>
    </div>
  )
}
