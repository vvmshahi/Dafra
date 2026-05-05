import { useState, useEffect } from 'react'
import { X, Building2, User } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import type { CustomerType } from '@/types'
import type { CustomerWithStats } from './CustomersPage'

// ── Validation patterns ───────────────────────────────────────────────────────

const SAUDI_MOBILE_RE = /^05[0-9]{8}$/
const VAT_RE          = /^3\d{13}3$/

function validatePhone(value: string): string | null {
  const clean = value.replace(/\s/g, '')
  if (!clean) return null
  if (!SAUDI_MOBILE_RE.test(clean)) return 'Enter a valid Saudi mobile (05XXXXXXXX)'
  return null
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest pt-1 pb-0.5">
      {children}
    </p>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  customer: CustomerWithStats | null
  onClose: () => void
  onSaved: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomerDrawer({ open, customer, onClose, onSaved }: Props) {
  const { profile } = useAuth()

  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')
  const [phoneError,    setPhoneError]    = useState('')
  const [vatError,      setVatError]      = useState('')

  // Form
  const [custType,      setCustType]      = useState<CustomerType>('individual')
  const [name,          setName]          = useState('')
  const [nameAr,        setNameAr]        = useState('')
  const [businessName,  setBusinessName]  = useState('')
  const [businessNameAr, setBusinessNameAr] = useState('')
  const [phone,         setPhone]         = useState('')
  const [email,         setEmail]         = useState('')
  const [vatNumber,     setVatNumber]     = useState('')
  const [crNumber,      setCrNumber]      = useState('')
  const [city,          setCity]          = useState('')
  const [notes,         setNotes]         = useState('')

  // Populate on edit
  useEffect(() => {
    if (open && customer) {
      setCustType((customer.customer_type as CustomerType) ?? 'individual')
      setName(customer.name)
      setNameAr(customer.name_ar ?? '')
      setBusinessName(customer.business_name ?? customer.company_name ?? '')
      setBusinessNameAr(customer.business_name_ar ?? '')
      setPhone(customer.phone ?? '')
      setEmail(customer.email ?? '')
      setVatNumber(customer.vat_number ?? '')
      setCrNumber(customer.cr_number ?? '')
      setCity(customer.city ?? '')
      setNotes(customer.notes ?? '')
    } else {
      setCustType('individual')
      setName('')
      setNameAr('')
      setBusinessName('')
      setBusinessNameAr('')
      setPhone('')
      setEmail('')
      setVatNumber('')
      setCrNumber('')
      setCity('')
      setNotes('')
    }
    setError('')
    setPhoneError('')
    setVatError('')
  }, [open, customer])

  const handlePhoneBlur = () => {
    setPhoneError(validatePhone(phone) ?? '')
  }

  const handleVatBlur = () => {
    const v = vatNumber.trim()
    if (v && !VAT_RE.test(v)) setVatError('VAT must be 15 digits starting and ending with 3')
    else setVatError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (custType === 'business') {
      if (!businessName.trim()) { setError('Business name is required'); return }
    } else {
      if (!name.trim()) { setError('Full name is required'); return }
    }
    const vatTrimmed = vatNumber.trim()
    if (vatTrimmed && !VAT_RE.test(vatTrimmed)) {
      setVatError('VAT must be 15 digits starting and ending with 3'); return
    }
    const phoneErr = validatePhone(phone)
    if (phoneErr) { setPhoneError(phoneErr); return }

    setSaving(true)
    setError('')

    const payload: Record<string, unknown> = {
      tenant_id:        profile?.tenant_id,
      branch_id:        profile?.branch_id,
      name:             name.trim() || businessName.trim(),
      name_ar:          nameAr.trim()          || null,
      customer_type:    custType,
      business_name:    businessName.trim()    || null,
      business_name_ar: businessNameAr.trim()  || null,
      company_name:     businessName.trim()    || null,
      phone:            phone.trim()           || null,
      email:            email.trim()           || null,
      vat_number:       vatTrimmed             || null,
      cr_number:        crNumber.trim()        || null,
      city:             city.trim()            || null,
      notes:            notes.trim()           || null,
    }

    const q = supabase as unknown as { from: (t: string) => any }

    if (customer) {
      const { error: err } = await q.from('customers').update(payload).eq('id', customer.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await q.from('customers').insert(payload)
      if (err) { setError(err.message); setSaving(false); return }
    }

    setSaving(false)
    onSaved()
    onClose()
  }

  if (!open) return null

  const isBusiness = custType === 'business'

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-[520px] bg-white shadow-2xl z-50 flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">

          {/* ── Header ──────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                {customer ? 'Edit Customer' : 'Add Customer'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {customer ? 'Update customer information' : 'Enter the customer details below'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* ── Body ────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* Customer type selector */}
            <div>
              <label className="label">Customer Type</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCustType('individual')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                    !isBusiness
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <User size={18} className={!isBusiness ? 'text-primary-500' : 'text-gray-400'} />
                  <div className="text-left">
                    <p className="text-sm font-semibold">Individual</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Personal customer</p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setCustType('business')}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                    isBusiness
                      ? 'border-gold-500 bg-amber-50 text-amber-800'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <Building2 size={18} className={isBusiness ? 'text-gold-600' : 'text-gray-400'} />
                  <div className="text-left">
                    <p className="text-sm font-semibold">Business (B2B)</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Company / entity</p>
                  </div>
                </button>
              </div>
            </div>

            {/* ── Identity ────────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>Identity</SectionLabel>

              <div>
                <label className="label">
                  {isBusiness ? 'Contact Person Name (English)' : 'Full Name (English)'}
                  <span className="text-red-500 ml-1">*</span>
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={isBusiness ? 'e.g. Mohammed Al-Otaibi' : 'e.g. Ahmed Al-Sayed'}
                />
              </div>

              <div>
                <label className="label">
                  {isBusiness ? 'Contact Person Name (Arabic)' : 'Full Name (Arabic)'}
                </label>
                <input
                  className="input text-right"
                  dir="rtl"
                  value={nameAr}
                  onChange={e => setNameAr(e.target.value)}
                  placeholder="الاسم الكامل"
                />
              </div>

              {/* Business-only fields */}
              {isBusiness && (
                <>
                  <div>
                    <label className="label">
                      Business Name (English) <span className="text-red-500">*</span>
                    </label>
                    <input
                      className="input"
                      value={businessName}
                      onChange={e => setBusinessName(e.target.value)}
                      placeholder="e.g. ABC Trading Company"
                    />
                  </div>

                  <div>
                    <label className="label">Business Name (Arabic)</label>
                    <input
                      className="input text-right"
                      dir="rtl"
                      value={businessNameAr}
                      onChange={e => setBusinessNameAr(e.target.value)}
                      placeholder="اسم الشركة بالعربية"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">VAT Number</label>
                      <input
                        className={`input font-mono ${vatError ? 'border-red-300 focus:border-red-400 focus:ring-red-400/20' : ''}`}
                        value={vatNumber}
                        onChange={e => { setVatNumber(e.target.value); setVatError('') }}
                        onBlur={handleVatBlur}
                        placeholder="3XXXXXXXXXXXXX3"
                        maxLength={15}
                      />
                      {vatError ? (
                        <p className="text-xs text-red-500 mt-1">{vatError}</p>
                      ) : (
                        <p className="text-[10px] text-gray-400 mt-1">15-digit ZATCA VAT (3…3)</p>
                      )}
                    </div>
                    <div>
                      <label className="label">CR Number</label>
                      <input
                        className="input font-mono"
                        value={crNumber}
                        onChange={e => setCrNumber(e.target.value)}
                        placeholder="1234567890"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ── Contact ─────────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>Contact</SectionLabel>

              <div>
                <label className="label">Mobile Number</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium pointer-events-none">
                    🇸🇦
                  </span>
                  <input
                    className={`input pl-10 ${phoneError ? 'border-red-300 focus:border-red-400 focus:ring-red-400/20' : ''}`}
                    type="tel"
                    value={phone}
                    onChange={e => { setPhone(e.target.value); setPhoneError('') }}
                    onBlur={handlePhoneBlur}
                    placeholder="0512345678"
                    maxLength={10}
                  />
                </div>
                {phoneError ? (
                  <p className="text-xs text-red-500 mt-1">{phoneError}</p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">Saudi format: 05XXXXXXXX</p>
                )}
              </div>

              <div>
                <label className="label">Email Address</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="customer@example.com"
                />
              </div>
            </div>

            {/* ── Additional ──────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>Additional</SectionLabel>

              <div>
                <label className="label">City</label>
                <input
                  className="input"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  placeholder="e.g. Riyadh, Jeddah, Dammam"
                />
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Internal notes about this customer..."
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────── */}
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" loading={saving}>
              {customer ? 'Save Changes' : 'Add Customer'}
            </Button>
          </div>

        </form>
      </div>
    </>
  )
}
