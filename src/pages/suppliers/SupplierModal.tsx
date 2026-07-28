import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, CheckCircle2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { Supplier } from '@/types'

interface Props {
  open: boolean
  supplier: Supplier | null
  onClose: () => void
  onSaved: () => void
}

type FieldName = 'name' | 'vatNumber' | 'crNumber' | 'phone' | 'email'
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function SupplierModal({ open, supplier, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const { t } = useTranslation(['suppliers', 'common'])
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const vatRef = useRef<HTMLInputElement>(null)
  const crRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<FieldName | null>(null)
  const [name, setName] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [crNumber, setCrNumber] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('cash')
  const [notes, setNotes] = useState('')

  const resetForm = useCallback(() => {
    setSaving(false)
    setError('')
    setErrorField(null)
    setName('')
    setNameAr('')
    setVatNumber('')
    setCrNumber('')
    setContactPerson('')
    setPhone('')
    setEmail('')
    setCity('')
    setAddress('')
    setPaymentTerms('cash')
    setNotes('')
  }, [])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    setName(supplier?.name ?? '')
    setNameAr(supplier?.name_ar ?? '')
    setVatNumber(supplier?.vat_number ?? '')
    setCrNumber(supplier?.cr_number ?? '')
    setContactPerson(supplier?.contact_person ?? '')
    setPhone(supplier?.phone ?? '')
    setEmail(supplier?.email ?? '')
    setCity(supplier?.city ?? '')
    setAddress(supplier?.address ?? '')
    setPaymentTerms(supplier?.payment_terms ?? 'cash')
    setNotes(supplier?.notes ?? '')
    setError('')
    setErrorField(null)
    window.setTimeout(() => nameRef.current?.focus(), 0)
  }, [open, supplier])

  const requestClose = useCallback(() => {
    if (saving) return
    resetForm()
    onClose()
    window.setTimeout(() => previousFocusRef.current?.focus(), 0)
  }, [onClose, resetForm, saving])

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

  const focusField = (field: FieldName) => {
    const refs = { name: nameRef, vatNumber: vatRef, crNumber: crRef, phone: phoneRef, email: emailRef }
    window.setTimeout(() => refs[field].current?.focus(), 0)
  }

  const handleSaveError = (saveError: { code?: string; message?: string; details?: string }) => {
    const technicalMessage = `${saveError.message ?? ''} ${saveError.details ?? ''}`.toLowerCase()
    if (saveError.code === '23505' || technicalMessage.includes('duplicate')) {
      const field: FieldName = technicalMessage.includes('vat')
        ? 'vatNumber'
        : technicalMessage.includes('cr_') || technicalMessage.includes('cr number')
          ? 'crNumber'
          : technicalMessage.includes('phone')
            ? 'phone'
            : technicalMessage.includes('email')
              ? 'email'
              : 'name'
      setErrorField(field)
      setError(t(`suppliers:errors.duplicate.${field}`))
      focusField(field)
      return
    }
    setErrorField(null)
    setError(t('suppliers:errors.saveFailed'))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!name.trim()) {
      setErrorField('name')
      setError(t('suppliers:errors.nameRequired'))
      nameRef.current?.focus()
      return
    }

    setSaving(true)
    setError('')
    setErrorField(null)

    try {
      const payload: Record<string, unknown> = {
        tenant_id: profile?.tenant_id!,
        branch_id: profile?.branch_id,
        name: name.trim(),
        name_ar: nameAr.trim() || null,
        vat_number: vatNumber.trim() || null,
        cr_number: crNumber.trim() || null,
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        city: city.trim() || null,
        address: address.trim() || null,
        payment_terms: paymentTerms,
        notes: notes.trim() || null,
      }
      const query = supabase as unknown as { from: (table: string) => any }

      if (supplier) {
        const { error: updateError } = await query.from('suppliers').update(payload).eq('id', supplier.id)
        if (updateError) {
          console.error('[SupplierModal] update failed', { code: updateError.code })
          handleSaveError(updateError)
          return
        }
      } else {
        const { error: insertError } = await query.from('suppliers').insert(payload)
        if (insertError) {
          console.error('[SupplierModal] insert failed', { code: insertError.code })
          handleSaveError(insertError)
          return
        }
      }

      toast.success(t(supplier ? 'suppliers:success.updated' : 'suppliers:success.added'))
      onSaved()
      resetForm()
      onClose()
      window.setTimeout(() => previousFocusRef.current?.focus(), 0)
    } catch (saveError) {
      console.error('[SupplierModal] save failed')
      handleSaveError(saveError as { code?: string; message?: string; details?: string })
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
        aria-labelledby="supplier-modal-title"
        aria-describedby="supplier-modal-description"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[900px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-[#fffdf7] shadow-2xl md:max-h-[min(92vh,820px)]"
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-primary-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <Building2 size={18} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 id="supplier-modal-title" className="truncate text-base font-bold text-gray-900">
                  {supplier ? t('suppliers:edit') : t('suppliers:add')}
                </h2>
                <p id="supplier-modal-description" className="mt-0.5 text-xs text-gray-500">{t('suppliers:modal.subtitle')}</p>
              </div>
            </div>
            <button type="button" onClick={requestClose} disabled={saving} aria-label={t('common:close')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50 active:scale-[0.97]">
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(280px,1fr)]">
              <div className="min-w-0 space-y-4">
                <section aria-labelledby="supplier-identity-heading">
                  <SectionHeading id="supplier-identity-heading">{t('suppliers:sections.identity')}</SectionHeading>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field id="supplier-name-en" label={t('suppliers:fields.nameEn')} required
                      helper={t('suppliers:helpers.nameEn')} error={errorField === 'name' ? error : undefined}>
                      <input ref={nameRef} id="supplier-name-en" className="input" value={name}
                        onChange={event => {
                          setName(event.target.value)
                          if (errorField === 'name') {
                            setError('')
                            setErrorField(null)
                          }
                        }}
                        placeholder={t('suppliers:placeholders.name')} aria-invalid={errorField === 'name'}
                        aria-describedby={errorField === 'name' ? 'supplier-name-en-error' : 'supplier-name-en-help'} dir="auto" />
                    </Field>
                    <Field id="supplier-name-ar" label={t('suppliers:fields.nameAr')} helper={t('suppliers:helpers.nameAr')}>
                      <input id="supplier-name-ar" className="input" value={nameAr}
                        onChange={event => setNameAr(event.target.value)}
                        placeholder={t('suppliers:placeholders.nameAr')} dir="rtl" />
                    </Field>
                  </div>
                </section>

                <section aria-labelledby="supplier-registration-heading">
                  <SectionHeading id="supplier-registration-heading">{t('suppliers:sections.registration')}</SectionHeading>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field id="supplier-vat" label={t('suppliers:fields.vatNumber')} helper={t('suppliers:helpers.vat')}>
                      <input ref={vatRef} id="supplier-vat" className="input" value={vatNumber}
                        onChange={event => setVatNumber(event.target.value)}
                        placeholder="300XXXXXXXXX003" maxLength={15} inputMode="numeric"
                        aria-invalid={errorField === 'vatNumber'} dir="ltr" />
                    </Field>
                    <Field id="supplier-cr" label={t('suppliers:fields.crNumber')} helper={t('suppliers:helpers.cr')}>
                      <input ref={crRef} id="supplier-cr" className="input" value={crNumber}
                        onChange={event => setCrNumber(event.target.value)}
                        placeholder={t('suppliers:placeholders.cr')} inputMode="numeric"
                        aria-invalid={errorField === 'crNumber'} dir="ltr" />
                    </Field>
                  </div>
                </section>

                <section aria-labelledby="supplier-contact-heading">
                  <SectionHeading id="supplier-contact-heading">{t('suppliers:sections.contact')}</SectionHeading>
                  <div className="mt-3 space-y-3">
                    <Field id="supplier-contact" label={t('suppliers:fields.contactPerson')}>
                      <input id="supplier-contact" className="input" value={contactPerson}
                        onChange={event => setContactPerson(event.target.value)}
                        placeholder={t('suppliers:placeholders.contact')} dir="auto" />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field id="supplier-phone" label={t('suppliers:fields.phone')}>
                        <input ref={phoneRef} id="supplier-phone" className="input" type="tel" inputMode="tel"
                          value={phone} onChange={event => setPhone(event.target.value)}
                          placeholder="05XXXXXXXX" aria-invalid={errorField === 'phone'} dir="ltr" />
                      </Field>
                      <Field id="supplier-email" label={t('suppliers:fields.email')}>
                        <input ref={emailRef} id="supplier-email" className="input" type="email" inputMode="email"
                          value={email} onChange={event => setEmail(event.target.value)}
                          placeholder="supplier@example.com" aria-invalid={errorField === 'email'} dir="ltr" />
                      </Field>
                    </div>
                  </div>
                </section>

                <section aria-label={t('suppliers:fields.notes')}>
                  <label className="label" htmlFor="supplier-notes">{t('suppliers:fields.notes')}</label>
                  <textarea id="supplier-notes" className="input resize-none" rows={2} value={notes}
                    onChange={event => setNotes(event.target.value)}
                    placeholder={t('suppliers:placeholders.notes')} dir="auto" />
                </section>
              </div>

              <aside className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
                <section className="overflow-hidden rounded-xl border border-primary-700 bg-[#173f2a] p-4 text-white" aria-labelledby="supplier-preview-heading">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-100">{t('suppliers:preview.eyebrow')}</p>
                  <h3 id="supplier-preview-heading" className="mt-2 break-words text-lg font-bold leading-6" dir="auto">
                    {name.trim() || t('suppliers:preview.unnamed')}
                  </h3>
                  {nameAr.trim() && <p className="mt-1 break-words text-sm text-primary-100" dir="rtl">{nameAr.trim()}</p>}
                  <dl className="mt-4 divide-y divide-white/10 text-xs">
                    <PreviewRow label={t('suppliers:fields.vatNumber')} value={vatNumber || t('suppliers:preview.notProvided')} ltr />
                    {crNumber && <PreviewRow label={t('suppliers:fields.crNumber')} value={crNumber} ltr />}
                    <PreviewRow label={t('suppliers:fields.contactPerson')} value={contactPerson || t('suppliers:preview.notProvided')} />
                    <PreviewRow label={t('suppliers:fields.phone')} value={phone || t('suppliers:preview.notProvided')} ltr />
                    <PreviewRow label={t('suppliers:fields.paymentTerms')} value={t(`suppliers:terms.${paymentTerms === 'cash' ? 'cash' : paymentTerms === 'credit_30' ? 'credit30' : 'credit60'}`)} />
                  </dl>
                </section>

                <section aria-labelledby="supplier-address-heading">
                  <SectionHeading id="supplier-address-heading">{t('suppliers:sections.addressPayment')}</SectionHeading>
                  <div className="mt-3 space-y-3">
                    <Field id="supplier-city" label={t('suppliers:fields.city')}>
                      <input id="supplier-city" className="input" value={city}
                        onChange={event => setCity(event.target.value)}
                        placeholder={t('suppliers:placeholders.city')} dir="auto" />
                    </Field>
                    <Field id="supplier-address" label={t('suppliers:fields.address')} helper={t('suppliers:helpers.address')}>
                      <textarea id="supplier-address" className="input resize-none" rows={2} value={address}
                        onChange={event => setAddress(event.target.value)}
                        placeholder={t('suppliers:placeholders.address')} dir="auto" />
                    </Field>
                    <Field id="supplier-payment-terms" label={t('suppliers:fields.paymentTerms')} helper={t('suppliers:helpers.paymentTerms')}>
                      <select id="supplier-payment-terms" className="input" value={paymentTerms}
                        onChange={event => setPaymentTerms(event.target.value)}>
                        <option value="cash">{t('suppliers:terms.cash')}</option>
                        <option value="credit_30">{t('suppliers:terms.credit30')}</option>
                        <option value="credit_60">{t('suppliers:terms.credit60')}</option>
                      </select>
                    </Field>
                  </div>
                </section>

                <p className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs leading-5 text-gray-600">
                  <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-primary-700" aria-hidden="true" />
                  {name.trim() ? t('suppliers:modal.ready') : t('suppliers:modal.completeRequired')}
                </p>
              </aside>
            </div>

            {error && errorField !== 'name' && (
              <div role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <footer className="flex flex-shrink-0 flex-col-reverse gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            <Button type="button" variant="secondary" className="w-full active:scale-[0.97] sm:w-auto"
              onClick={requestClose} disabled={saving}>{t('common:cancel')}</Button>
            <Button type="submit" className="w-full bg-[#173f2a] hover:bg-[#22563b] active:scale-[0.97] sm:w-auto"
              loading={saving} disabled={saving || !name.trim()}>
              {supplier ? t('suppliers:actions.saveChanges') : t('suppliers:add')}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return <h3 id={id} className="text-xs font-bold uppercase tracking-wide text-gray-600">{children}</h3>
}

function Field({
  id,
  label,
  helper,
  error,
  required = false,
  children,
}: {
  id: string
  label: string
  helper?: string
  error?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label} {required && <span className="text-red-600" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> required</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-[11px] text-red-600">{error}</p>
      ) : helper ? (
        <p id={`${id}-help`} className="mt-1 text-[11px] text-gray-500">{helper}</p>
      ) : null}
    </div>
  )
}

function PreviewRow({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-primary-100">{label}</dt>
      <dd className="max-w-[58%] break-words text-end font-semibold text-white" dir={ltr ? 'ltr' : 'auto'}>{value}</dd>
    </div>
  )
}
