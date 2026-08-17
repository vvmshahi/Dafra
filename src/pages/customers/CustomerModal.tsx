import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, Check, CircleAlert, CircleCheck, Plus, User, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { CustomerType } from '@/types'
import type { CustomerWithStats } from './CustomersPage'

const SAUDI_MOBILE_RE = /^05[0-9]{8}$/
const VAT_RE = /^3\d{13}3$/
const CR_RE = /^[a-zA-Z0-9]+$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type ErrorField = 'name' | 'businessName' | 'phone' | 'email' | 'vatNumber' | 'crNumber'

function isValidPhone(value: string) {
  const clean = value.replace(/\s/g, '')
  return SAUDI_MOBILE_RE.test(clean)
}

interface Props {
  open: boolean
  customer: CustomerWithStats | null
  onClose: () => void
  onSaved: () => void
}

export default function CustomerModal({ open, customer, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const { t } = useTranslation(['customers', 'common'])
  const dialogRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const businessNameRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const vatRef = useRef<HTMLInputElement>(null)
  const crRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<ErrorField | null>(null)
  const [phoneError, setPhoneError] = useState('')
  const [vatError, setVatError] = useState('')
  const [crError, setCrError] = useState('')
  const [custType, setCustType] = useState<CustomerType | null>(null)
  const [name, setName] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [businessNameAr, setBusinessNameAr] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [vatNumber, setVatNumber] = useState('')
  const [crNumber, setCrNumber] = useState('')
  const [city, setCity] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [emailOpen, setEmailOpen] = useState(false)
  const [addressOpen, setAddressOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)

  const isBusiness = custType === 'business'
  const vatTrimmed = vatNumber.trim()
  const vatIsValid = VAT_RE.test(vatTrimmed)
  const crTrimmed = crNumber.trim()
  const crIsValid = CR_RE.test(crTrimmed)
  const cityIsValid = Boolean(city.trim())
  const phoneIsValid = isValidPhone(phone)
  const emailIsValid = !email.trim() || EMAIL_RE.test(email.trim())
  const requiredName = isBusiness ? businessName.trim() : name.trim()
  const isIndividualValid = Boolean(custType === 'individual' && requiredName && phoneIsValid && cityIsValid && emailIsValid)
  const isBusinessValid = Boolean(custType === 'business' && requiredName && vatIsValid && crIsValid && name.trim() && phoneIsValid && cityIsValid && emailIsValid)
  const formCanSubmit = isIndividualValid || isBusinessValid

  const resetForm = useCallback(() => {
    setSaving(false)
    setError('')
    setErrorField(null)
    setPhoneError('')
    setVatError('')
    setCrError('')
    setCustType(null)
    setName('')
    setNameAr('')
    setBusinessName('')
    setBusinessNameAr('')
    setPhone('')
    setEmail('')
    setVatNumber('')
    setCrNumber('')
    setCity('')
    setAddress('')
    setNotes('')
    setEmailOpen(false)
    setAddressOpen(false)
    setNotesOpen(false)
  }, [])

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    setCustType((customer?.customer_type as CustomerType) ?? null)
    setName(customer?.name ?? '')
    setNameAr(customer?.name_ar ?? '')
    setBusinessName(customer?.business_name ?? customer?.company_name ?? '')
    setBusinessNameAr(customer?.business_name_ar ?? '')
    setPhone(customer?.phone ?? '')
    setEmail(customer?.email ?? '')
    setVatNumber(customer?.vat_number ?? '')
    setCrNumber(customer?.cr_number ?? '')
    setCity(customer?.city ?? '')
    setAddress(customer?.address ?? '')
    setNotes(customer?.notes ?? '')
    setEmailOpen(Boolean(customer?.email))
    setAddressOpen(Boolean(customer?.address))
    setNotesOpen(Boolean(customer?.notes))
    setError('')
    setErrorField(null)
    setPhoneError('')
    setVatError('')
    setCrError('')
    window.setTimeout(() => {
      const type = (customer?.customer_type as CustomerType) ?? null
      if (type === 'business') businessNameRef.current?.focus()
      else nameRef.current?.focus()
    }, 0)
  }, [customer, open])

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

  const selectType = (nextType: CustomerType) => {
    if (nextType === custType) return
    setCustType(nextType)
    setError('')
    setErrorField(null)
    setPhoneError('')
    setVatError('')
    setCrError('')
    setName('')
    setNameAr('')
    setBusinessName('')
    setBusinessNameAr('')
    setPhone('')
    setEmail('')
    setVatNumber('')
    setCrNumber('')
    setCity('')
    setAddress('')
    setNotes('')
    setEmailOpen(false)
    setAddressOpen(false)
    setNotesOpen(false)
    window.setTimeout(() => {
      if (nextType === 'business') businessNameRef.current?.focus()
      else nameRef.current?.focus()
    }, 0)
  }

  const handlePhoneBlur = () => {
    setPhoneError(phoneIsValid ? '' : t('customers:errors.phoneRequired'))
  }

  const handleVatBlur = () => {
    setVatError(!vatTrimmed ? t('customers:errors.vatRequired') : vatIsValid ? '' : t('customers:errors.vatInvalid'))
  }

  const handleCrBlur = () => setCrError(!crTrimmed ? t('customers:errors.crRequired') : crIsValid ? '' : t('customers:errors.crInvalid'))

  const focusErrorField = (field: ErrorField) => {
    const refs = {
      name: nameRef,
      businessName: businessNameRef,
      phone: phoneRef,
      email: emailRef,
      vatNumber: vatRef,
      crNumber: crRef,
    }
    window.setTimeout(() => refs[field].current?.focus(), 0)
  }

  const handleSaveError = (saveError: { code?: string; message?: string; details?: string }) => {
    const technical = `${saveError.message ?? ''} ${saveError.details ?? ''}`.toLowerCase()
    if (saveError.code === '23505' || technical.includes('duplicate')) {
      const field: ErrorField = technical.includes('vat')
        ? 'vatNumber'
        : technical.includes('cr_') || technical.includes('cr number')
          ? 'crNumber'
          : technical.includes('phone')
            ? 'phone'
            : technical.includes('email')
              ? 'email'
              : isBusiness
                ? 'businessName'
                : 'name'
      setErrorField(field)
      setError(t(`customers:errors.duplicate.${field}`))
      focusErrorField(field)
      return
    }
    setErrorField(null)
    setError(t('customers:errors.saveFailed'))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!custType) return

    if (isBusiness && !businessName.trim()) {
      setErrorField('businessName')
      setError(t('customers:errors.businessNameRequired'))
      businessNameRef.current?.focus()
      return
    }
    if (!isBusiness && !name.trim()) {
      setErrorField('name')
      setError(t('customers:errors.nameRequired'))
      nameRef.current?.focus()
      return
    }
    if (isBusiness && !vatIsValid) {
      setVatError(!vatTrimmed ? t('customers:errors.vatRequired') : t('customers:errors.vatInvalid'))
      vatRef.current?.focus()
      return
    }
    if (isBusiness && !crIsValid) {
      setCrError(!crTrimmed ? t('customers:errors.crRequired') : t('customers:errors.crInvalid'))
      crRef.current?.focus()
      return
    }
    if (!phoneIsValid) {
      setPhoneError(t('customers:errors.phoneRequired'))
      phoneRef.current?.focus()
      return
    }
    if (!cityIsValid || !emailIsValid) return

    setSaving(true)
    setError('')
    setErrorField(null)

    try {
      const payload: Record<string, unknown> = {
        tenant_id: profile?.tenant_id,
        branch_id: profile?.branch_id,
        name: isBusiness ? (name.trim() || businessName.trim()) : name.trim(),
        name_ar: nameAr.trim() || null,
        customer_type: custType,
        business_name: isBusiness ? businessName.trim() : null,
        business_name_ar: isBusiness ? (businessNameAr.trim() || null) : null,
        company_name: isBusiness ? businessName.trim() : null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        vat_number: isBusiness ? (vatTrimmed || null) : null,
        cr_number: isBusiness ? (crNumber.trim() || null) : null,
        city: city.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
      }
      const query = supabase as unknown as { from: (table: string) => any }

      if (customer) {
        const { error: updateError } = await query.from('customers').update(payload).eq('id', customer.id)
        if (updateError) {
          console.error('[CustomerModal] update failed', { code: updateError.code })
          handleSaveError(updateError)
          return
        }
      } else {
        const { error: insertError } = await query.from('customers').insert(payload)
        if (insertError) {
          console.error('[CustomerModal] insert failed', { code: insertError.code })
          handleSaveError(insertError)
          return
        }
      }

      toast.success(t(customer ? 'customers:success.updated' : 'customers:success.added'))
      onSaved()
      resetForm()
      onClose()
      window.setTimeout(() => previousFocusRef.current?.focus(), 0)
    } catch (saveError) {
      console.error('[CustomerModal] save failed')
      handleSaveError(saveError as { code?: string; message?: string; details?: string })
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const previewName = isBusiness
    ? businessName.trim() || t('customers:preview.businessPlaceholder')
    : name.trim() || t('customers:preview.individualPlaceholder')
  const readinessKey = !businessName.trim()
    ? 'missingBusinessName'
    : !vatTrimmed
      ? 'missingVat'
      : !vatIsValid
        ? 'invalidVat'
        : 'ready'
  const readinessReady = readinessKey === 'ready'

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
        aria-labelledby="customer-modal-title"
        aria-describedby="customer-modal-description"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[940px] flex-col overflow-hidden rounded-2xl border border-white/20 bg-[#fffdf7] shadow-2xl md:max-h-[min(92vh,840px)]"
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-primary-100 bg-white px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                <Users size={18} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 id="customer-modal-title" className="truncate text-base font-bold text-gray-900">
                    {t(customer ? 'customers:edit' : 'customers:add')}
                  </h2>
                  {custType && <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                    {t(isBusiness ? 'customers:business' : 'customers:individual')}
                  </span>}
                </div>
                <p id="customer-modal-description" className="mt-0.5 text-xs text-gray-500">
                  {t(customer ? 'customers:updateHint' : custType ? 'customers:modal.subtitle' : 'customers:modal.chooseType')}
                </p>
              </div>
            </div>
            <button type="button" onClick={requestClose} disabled={saving} aria-label={t('common:close')}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50 active:scale-[0.97]">
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {!customer && !custType ? (
              <fieldset>
                <legend className="label">{t('customers:sections.type')}</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {([
                    { value: 'individual', icon: User, label: t('customers:individual'), description: t('customers:personalCustomer') },
                    { value: 'business', icon: Building2, label: t('customers:business'), description: t('customers:companyCustomer') },
                  ] as const).map(option => {
                    const Icon = option.icon
                    return <button key={option.value} type="button" onClick={() => selectType(option.value)} className="flex min-h-32 items-center gap-3 rounded-xl border border-[#d7e2d8] bg-white p-4 text-start transition-colors hover:border-[#6e9a75] hover:bg-[#fbfdfb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173f2a]">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e5efe6] text-[#173f2a]"><Icon size={18} aria-hidden="true" /></span>
                      <span><span className="block text-sm font-bold text-gray-900">{option.label}</span><span className="mt-1 block text-xs text-gray-500">{option.description}</span></span>
                    </button>
                  })}
                </div>
              </fieldset>
            ) : <>
            <fieldset>
              <legend className="label">{t('customers:sections.type')}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  { value: 'individual', icon: User, label: t('customers:individual'), description: t('customers:personalCustomer') },
                  { value: 'business', icon: Building2, label: t('customers:business'), description: t('customers:companyCustomer') },
                ] as const).map(option => {
                  const selected = custType === option.value
                  const Icon = option.icon
                  return (
                    <label key={option.value} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 focus-within:ring-2 focus-within:ring-primary-500 active:scale-[0.99] ${
                      selected ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-200 bg-white text-gray-600'
                    }`}>
                      <input className="sr-only" type="radio" name="customer-type" value={option.value}
                        checked={selected} onChange={() => selectType(option.value)} />
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                        selected ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {selected ? <Check size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="block text-[11px] text-gray-500">{option.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(285px,1fr)]">
              <div className="min-w-0 space-y-4">
                <section aria-labelledby="customer-identity-heading">
                  <SectionHeading id="customer-identity-heading">
                    {t(isBusiness ? 'customers:sections.businessIdentity' : 'customers:sections.personalIdentity')}
                  </SectionHeading>
                  <div className="mt-3">
                    {isBusiness ? (
                      <>
                        <Field id="customer-business-name" label={t('customers:fields.businessName')} required
                          error={errorField === 'businessName' ? error : undefined}>
                          <input ref={businessNameRef} id="customer-business-name" className="input"
                            value={businessName} onChange={event => {
                              setBusinessName(event.target.value)
                              if (errorField === 'businessName') {
                                setError('')
                                setErrorField(null)
                              }
                            }}
                            placeholder={t('customers:placeholders.businessName')}
                            aria-invalid={errorField === 'businessName'} dir="auto" />
                        </Field>
                      </>
                    ) : (
                      <>
                        <Field id="customer-name" label={t('customers:fields.fullName')} required
                          error={errorField === 'name' ? error : undefined}>
                          <input ref={nameRef} id="customer-name" className="input" value={name}
                            onChange={event => {
                              setName(event.target.value)
                              if (errorField === 'name') {
                                setError('')
                                setErrorField(null)
                              }
                            }}
                            placeholder={t('customers:placeholders.name')}
                            aria-invalid={errorField === 'name'} dir="auto" />
                        </Field>
                      </>
                    )}
                  </div>
                </section>

                {isBusiness && (
                  <section aria-labelledby="customer-registration-heading">
                    <SectionHeading id="customer-registration-heading">{t('customers:sections.registration')}</SectionHeading>
                    <div className="mt-3 space-y-3">
                      <Field id="customer-vat" label={t('customers:fields.vatNumber')} required
                        helper={vatError || t('customers:vatHint')} error={vatError || undefined}>
                        <input ref={vatRef} id="customer-vat"
                          className={`input ${vatError ? 'border-red-300' : ''}`}
                          value={vatNumber} onChange={event => {
                            setVatNumber(event.target.value)
                            setVatError('')
                          }}
                          onBlur={handleVatBlur} placeholder="3XXXXXXXXXXXXX3" maxLength={15}
                          inputMode="numeric" aria-invalid={Boolean(vatError) || errorField === 'vatNumber'} dir="ltr" />
                      </Field>
                      <div><Field id="customer-cr" label={t('customers:fields.crNumber')} required helper={crError || t('customers:helpers.cr')} error={crError || undefined}>
                        <input ref={crRef} id="customer-cr" className="input" value={crNumber}
                          onChange={event => { setCrNumber(event.target.value); setCrError('') }} onBlur={handleCrBlur}
                          placeholder="1234567890" inputMode="numeric"
                          aria-invalid={errorField === 'crNumber'} dir="ltr" />
                      </Field></div>
                    </div>
                  </section>
                )}

                {isBusiness && (
                  <section aria-labelledby="customer-contact-person-heading">
                    <SectionHeading id="customer-contact-person-heading">{t('customers:sections.contactPerson')}</SectionHeading>
                    <div className="mt-3">
                      <Field id="customer-contact-name" label={t('customers:fields.contactPerson')} required
                        helper={t('customers:helpers.contactPerson')}>
                        <input ref={nameRef} id="customer-contact-name" className="input" value={name}
                          onChange={event => setName(event.target.value)}
                          placeholder={t('customers:placeholders.contactPerson')} dir="auto" />
                      </Field>
                    </div>
                  </section>
                )}

                <section aria-labelledby="customer-contact-heading">
                  <SectionHeading id="customer-contact-heading">{t('customers:sections.contact')}</SectionHeading>
                  <div className="mt-3 space-y-3">
                    <Field id="customer-phone" label={t('customers:fields.mobile')} required
                      helper={phoneError || t('customers:placeholders.phoneHint')} error={phoneError || undefined}>
                      <input ref={phoneRef} id="customer-phone" className={`input ${phoneError ? 'border-red-300' : ''}`}
                        type="tel" inputMode="tel" value={phone}
                        onChange={event => {
                          setPhone(event.target.value)
                          setPhoneError('')
                        }}
                        onBlur={handlePhoneBlur} placeholder="0512345678" maxLength={10}
                        aria-invalid={Boolean(phoneError) || errorField === 'phone'} dir="ltr" />
                    </Field>
                    {emailOpen ? <div><Field id="customer-email" label={t('customers:fields.email')} helper={emailIsValid ? t('customers:helpers.optional') : t('customers:errors.emailInvalid')} error={emailIsValid ? undefined : t('customers:errors.emailInvalid')}>
                      <input ref={emailRef} id="customer-email" className="input" type="email" inputMode="email"
                        value={email} onChange={event => setEmail(event.target.value)}
                        placeholder={t('customers:placeholders.email')}
                        aria-invalid={errorField === 'email'} dir="ltr" />
                    </Field>{!email && <OptionalToggle onClick={() => setEmailOpen(false)}>{t('customers:actions.hideEmail')}</OptionalToggle>}</div> : <OptionalToggle onClick={() => setEmailOpen(true)}>{t('customers:actions.addEmail')}</OptionalToggle>}
                  </div>
                </section>

                <section aria-labelledby="customer-address-heading">
                  <SectionHeading id="customer-address-heading">{t('customers:sections.address')}</SectionHeading>
                  <div className="mt-3 space-y-3">
                    <Field id="customer-city" label={t('customers:fields.city')} required>
                      <input id="customer-city" className="input" value={city}
                        onChange={event => setCity(event.target.value)}
                        placeholder={t('customers:placeholders.city')} dir="auto" />
                    </Field>
                    {addressOpen ? <div><Field id="customer-address" label={t('customers:fields.address')}
                      helper={isBusiness ? t('customers:helpers.businessAddress') : t('customers:helpers.optional')}>
                      <textarea id="customer-address" className="input resize-none" rows={2} value={address}
                        onChange={event => setAddress(event.target.value)}
                        placeholder={t('customers:placeholders.address')} dir="auto" />
                    </Field>{!address && <OptionalToggle onClick={() => setAddressOpen(false)}>{t('customers:actions.hideAddress')}</OptionalToggle>}</div> : <OptionalToggle onClick={() => setAddressOpen(true)}>{t('customers:actions.addAddress')}</OptionalToggle>}
                  </div>
                </section>

                <section aria-labelledby="customer-optional-heading">
                  <SectionHeading id="customer-optional-heading">{t('customers:sections.optional')}</SectionHeading>
                  <div className="mt-3">{notesOpen ? <div><textarea id="customer-notes" className="input resize-none" rows={2} value={notes}
                    onChange={event => setNotes(event.target.value)}
                    placeholder={t('customers:placeholders.notes')} dir="auto" />
                    {!notes && <OptionalToggle onClick={() => setNotesOpen(false)}>{t('customers:actions.hideNotes')}</OptionalToggle>}</div> : <OptionalToggle onClick={() => setNotesOpen(true)}>{t('customers:actions.addNotes')}</OptionalToggle>}</div>
                </section>
              </div>

              <aside className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
                <section className="overflow-hidden rounded-xl border border-primary-700 bg-[#173f2a] p-4 text-white"
                  aria-labelledby="customer-preview-heading">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-100">{t('customers:preview.eyebrow')}</p>
                  <h3 id="customer-preview-heading" className="mt-2 break-words text-lg font-bold leading-6" dir="auto">{previewName}</h3>
                  <dl className="mt-4 divide-y divide-white/10 text-xs">
                    <PreviewRow label={t('customers:fields.type')} value={t(isBusiness ? 'customers:business' : 'customers:individual')} />
                    {isBusiness && <PreviewRow label={t('customers:fields.vatNumber')} value={vatNumber || t('customers:preview.notProvided')} ltr />}
                    {isBusiness && crNumber && <PreviewRow label={t('customers:fields.crNumber')} value={crNumber} ltr />}
                    {isBusiness && <PreviewRow label={t('customers:fields.contactPerson')} value={name || t('customers:preview.notProvided')} />}
                    <PreviewRow label={t('customers:fields.mobile')} value={phone || t('customers:preview.notProvided')} ltr />
                    <PreviewRow label={t('customers:fields.email')} value={email || t('customers:preview.notProvided')} ltr />
                    <PreviewRow label={t('customers:fields.city')} value={city || t('customers:preview.notProvided')} />
                  </dl>
                  {isBusiness && (
                    <div role="status" aria-live="polite" className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-5 ${
                      readinessReady ? 'bg-emerald-400/15 text-emerald-50' : 'bg-amber-300/15 text-amber-50'
                    }`}>
                      {readinessReady
                        ? <CircleCheck size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                        : <CircleAlert size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />}
                      <span>{t(`customers:readiness.${readinessKey}`)}</span>
                    </div>
                  )}
                </section>
              </aside>
            </div>

            </>}
            {error && !['name', 'businessName'].includes(errorField ?? '') && (
              <div role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <footer className="flex flex-shrink-0 flex-col-reverse gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:flex-row sm:justify-end sm:px-6">
            <Button type="button" variant="secondary" className="w-full active:scale-[0.97] sm:w-auto"
              onClick={requestClose} disabled={saving}>{t('common:cancel')}</Button>
            {(!customer && !custType) ? null : <Button type="submit" className="w-full bg-[#173f2a] text-[#fff8e7] shadow-[0_4px_12px_rgba(15,36,25,0.18)] hover:bg-[#22563b] active:scale-[0.97] focus-visible:ring-[#173f2a] sm:w-auto"
              loading={saving} disabled={saving || !formCanSubmit}>
              {saving ? t('common:saving') : t(customer ? 'common:saveChanges' : 'customers:add')}
            </Button>}
          </footer>
        </form>
      </div>
    </div>
  )
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return <h3 id={id} className="text-xs font-bold uppercase tracking-wide text-gray-600">{children}</h3>
}

function OptionalToggle({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-[#31543f] hover:text-[#173f2a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#173f2a] focus-visible:ring-offset-2"><Plus size={13} aria-hidden="true" />{children}</button>
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
