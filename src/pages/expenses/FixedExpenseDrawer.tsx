import { useState, useEffect } from 'react'
import { X, Banknote, CreditCard, Building } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import type { ExpenseCategory, ExpensePaymentMethod } from '@/types'
import type { FixedExpenseRow } from './FixedExpensesTab'
import { Rial } from '@/components/ui/RiyalSymbol'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { useTranslation } from 'react-i18next'

// ── Payment options ───────────────────────────────────────────────────────────

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
  open:       boolean
  item:       FixedExpenseRow | null
  categories: ExpenseCategory[]
  onClose:    () => void
  onSaved:    () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FixedExpenseDrawer({ open, item, categories, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const { t } = useTranslation(['expenses', 'common'])

  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  const [name,       setName]       = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [amount,     setAmount]     = useState('')
  const [payMethod,  setPayMethod]  = useState<ExpensePaymentMethod>('cash')
  const [isActive,   setIsActive]   = useState(true)

  useEffect(() => {
    if (open && item) {
      setName(item.name)
      setCategoryId(item.category_id ?? '')
      setAmount(String(item.monthly_amount))
      setPayMethod((item.payment_method as ExpensePaymentMethod) ?? 'cash')
      setIsActive(item.is_active)
    } else {
      setName('')
      setCategoryId('')
      setAmount('')
      setPayMethod('cash')
      setIsActive(true)
    }
    setError('')
  }, [open, item])

  const amountNum = parseFloat(amount) || 0
  const fmt = (n: number) => n.toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError(t('expenses:errors.nameRequired')); return }
    if (amountNum <= 0) { setError(t('expenses:errors.monthlyAmountInvalid')); return }

    setSaving(true)
    setError('')

    try {
      const bid = profile?.branch_id!
      const tid = profile?.tenant_id!

      const payload: Record<string, unknown> = {
        tenant_id:      tid,
        branch_id:      bid,
        name:           name.trim(),
        category_id:    categoryId || null,
        monthly_amount: amountNum,
        payment_method: payMethod,
        is_active:      isActive,
      }

      const q = supabase as unknown as { from: (t: string) => any }

      if (item) {
        const { error: err } = await q.from('fixed_expenses').update(payload).eq('id', item.id)
        if (err) { console.error('Fixed expense update failed', err); setError(t('expenses:errors.saveFailed')); return }
      } else {
        const { error: err } = await q.from('fixed_expenses').insert(payload)
        if (err) { console.error('Fixed expense creation failed', err); setError(t('expenses:errors.saveFailed')); return }
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

      <div className="fixed inset-y-0 right-0 w-full max-w-[480px] bg-white shadow-2xl z-50 flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                {t(item ? 'expenses:editFixed' : 'expenses:addFixed')}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{t('expenses:recurringMonthly')}</p>
            </div>
            <button type="button" onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* ── Details ──────────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>{t('expenses:sections.details')}</SectionLabel>

              <div>
                <label className="label">{t('expenses:fields.name')} <span className="text-red-500">*</span></label>
                <input
                  className="input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('expenses:placeholders.name')} dir="auto"
                />
              </div>

              <div>
                <label className="label">{t('expenses:fields.category')}</label>
                <select className="input" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                  <option value="">— {t('expenses:placeholders.uncategorized')} —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── Amount ───────────────────────────────────── */}
            <div className="space-y-4">
              <SectionLabel>{t('expenses:fields.monthlyAmount')}</SectionLabel>

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

              {amountNum > 0 && (
                <div className="bg-gray-50 rounded-xl px-4 py-3 space-y-1.5 text-sm">
                  <div className="flex justify-between text-gray-500">
                    <span>{t('expenses:fields.monthlyAmount')}</span>
                    <span className="tabular-nums font-medium"><Rial amount={amountNum} /></span>
                  </div>
                  <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1.5">
                    <span>{t('expenses:annualEstimate')}</span>
                    <span className="tabular-nums text-primary-600"><Rial amount={amountNum * 12} /></span>
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

            {/* ── Active toggle ─────────────────────────────── */}
            <div className="space-y-3">
              <SectionLabel>{t('expenses:fields.status')}</SectionLabel>
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">{t('expenses:status.active')}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t('expenses:activeHint')}
                  </p>
                </div>
                <Switch
                  checked={isActive}
                  onChange={setIsActive}
                  ariaLabel={t('expenses:status.active')}
                />
              </div>
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
              {t(item ? 'expenses:actions.saveChanges' : 'expenses:add')}
            </Button>
          </div>
        </form>
      </div>
    </>
  )
}
