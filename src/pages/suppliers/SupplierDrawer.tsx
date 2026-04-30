import { useState, useEffect } from 'react'
import { X, Building2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import type { Supplier } from '@/types'

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
  open:     boolean
  supplier: Supplier | null
  onClose:  () => void
  onSaved:  () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SupplierDrawer({ open, supplier, onClose, onSaved }: Props) {
  const { profile } = useAuth()

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const [name,          setName]          = useState('')
  const [nameAr,        setNameAr]        = useState('')
  const [vatNumber,     setVatNumber]     = useState('')
  const [crNumber,      setCrNumber]      = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone,         setPhone]         = useState('')
  const [email,         setEmail]         = useState('')
  const [city,          setCity]          = useState('')
  const [address,       setAddress]       = useState('')
  const [paymentTerms,  setPaymentTerms]  = useState('cash')
  const [notes,         setNotes]         = useState('')

  useEffect(() => {
    if (open && supplier) {
      setName(supplier.name)
      setNameAr(supplier.name_ar ?? '')
      setVatNumber(supplier.vat_number ?? '')
      setCrNumber(supplier.cr_number ?? '')
      setContactPerson(supplier.contact_person ?? '')
      setPhone(supplier.phone ?? '')
      setEmail(supplier.email ?? '')
      setCity(supplier.city ?? '')
      setAddress(supplier.address ?? '')
      setPaymentTerms(supplier.payment_terms)
      setNotes(supplier.notes ?? '')
    } else {
      setName(''); setNameAr(''); setVatNumber(''); setCrNumber('')
      setContactPerson(''); setPhone(''); setEmail(''); setCity('')
      setAddress(''); setPaymentTerms('cash'); setNotes('')
    }
    setError('')
  }, [open, supplier])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Supplier name is required'); return }

    setSaving(true)
    setError('')

    try {
      const payload: Record<string, unknown> = {
        tenant_id:      profile?.tenant_id!,
        name:           name.trim(),
        name_ar:        nameAr.trim() || null,
        vat_number:     vatNumber.trim() || null,
        cr_number:      crNumber.trim() || null,
        contact_person: contactPerson.trim() || null,
        phone:          phone.trim() || null,
        email:          email.trim() || null,
        city:           city.trim() || null,
        address:        address.trim() || null,
        payment_terms:  paymentTerms,
        notes:          notes.trim() || null,
      }

      const q = supabase as unknown as { from: (t: string) => any }

      if (supplier) {
        const { error: err } = await q.from('suppliers').update(payload).eq('id', supplier.id)
        if (err) { setError(err.message); return }
      } else {
        const { error: err } = await q.from('suppliers').insert(payload)
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

      <div className="fixed inset-y-0 right-0 w-full max-w-[520px] bg-white shadow-2xl z-50 flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Building2 size={16} className="text-emerald-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">
                  {supplier ? 'Edit Supplier' : 'Add Supplier'}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Supplier master record</p>
              </div>
            </div>
            <button type="button" onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* ── Business Info ─────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>Business Information</SectionLabel>

              <div>
                <label className="label">Supplier Name (English) <span className="text-red-500">*</span></label>
                <input className="input" value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. Al-Watania Chicken" />
              </div>

              <div>
                <label className="label">Supplier Name (Arabic)</label>
                <input className="input" value={nameAr} onChange={e => setNameAr(e.target.value)}
                  placeholder="اسم المورد بالعربية" dir="rtl" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">VAT Number</label>
                  <input className="input" value={vatNumber} onChange={e => setVatNumber(e.target.value)}
                    placeholder="300xxxxxxxxx" maxLength={15} />
                </div>
                <div>
                  <label className="label">CR Number</label>
                  <input className="input" value={crNumber} onChange={e => setCrNumber(e.target.value)}
                    placeholder="10xxxxxxxx" />
                </div>
              </div>
            </div>

            {/* ── Contact Info ──────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>Contact Information</SectionLabel>

              <div>
                <label className="label">Contact Person</label>
                <input className="input" value={contactPerson} onChange={e => setContactPerson(e.target.value)}
                  placeholder="e.g. Ahmed Al-Qahtani" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Phone</label>
                  <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="05xxxxxxxx" />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="supplier@example.com" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">City</label>
                  <input className="input" value={city} onChange={e => setCity(e.target.value)}
                    placeholder="e.g. Riyadh" />
                </div>
                <div>
                  <label className="label">Payment Terms</label>
                  <select className="input" value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}>
                    <option value="cash">Cash</option>
                    <option value="credit_30">Credit 30 Days</option>
                    <option value="credit_60">Credit 60 Days</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Address</label>
                <textarea className="input resize-none" rows={2} value={address}
                  onChange={e => setAddress(e.target.value)} placeholder="Full address..." />
              </div>
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
              {supplier ? 'Save Changes' : 'Add Supplier'}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
