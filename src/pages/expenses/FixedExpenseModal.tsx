import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Switch } from '@/components/ui/Switch'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Rial } from '@/components/ui/RiyalSymbol'
import type { ExpenseCategory } from '@/types'
import type { FixedExpenseRow } from './FixedExpensesTab'
import { useTranslation } from 'react-i18next'
import ExpenseModalShell from './ExpenseModalShell'

interface Props {
  open: boolean
  item: FixedExpenseRow | null
  categories: ExpenseCategory[]
  onClose: () => void
  onSaved: () => void
}

export default function FixedExpenseModal({ open, item, categories, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const { t } = useTranslation(['expenses', 'common'])
  const nameRef = useRef<HTMLInputElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (!open) return
    setName(item?.name ?? '')
    setCategoryId(item?.category_id ?? '')
    setAmount(item ? String(item.monthly_amount) : '')
    setIsActive(item?.is_active ?? true)
    setError('')
    setSaving(false)
  }, [item, open])

  const amountNum = Number.parseFloat(amount) || 0
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!name.trim()) {
      setError(t('expenses:errors.nameRequired'))
      nameRef.current?.focus()
      return
    }
    if (amountNum <= 0) {
      setError(t('expenses:errors.monthlyAmountInvalid'))
      amountRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload: Record<string, unknown> = {
        tenant_id: profile?.tenant_id,
        branch_id: profile?.branch_id,
        name: name.trim(),
        category_id: categoryId || null,
        monthly_amount: amountNum,
        // Legacy schema requires a non-null value. "other" is a neutral
        // compatibility marker; a template never represents an actual payment.
        payment_method: 'other',
        is_active: isActive,
      }
      const query = supabase as unknown as { from: (table: string) => any }
      const { error: saveError } = item
        ? await query.from('fixed_expenses').update(payload).eq('id', item.id)
        : await query.from('fixed_expenses').insert(payload)
      if (saveError) {
        console.error('[FixedExpenseModal] save failed', { code: saveError.code })
        setError(t('expenses:errors.saveFailed'))
        return
      }
      toast.success(t(item ? 'expenses:success.updated' : 'expenses:success.fixedAdded'))
      onSaved()
      onClose()
    } catch {
      setError(t('expenses:errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ExpenseModalShell open={open} kind="fixed" editing={Boolean(item)} saving={saving}
      canSubmit={Boolean(name.trim() && amountNum > 0)} onClose={onClose} onSubmit={handleSubmit}>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,1fr)]">
        <div className="min-w-0 space-y-5">
          <section aria-labelledby="fixed-identity-heading">
            <SectionTitle id="fixed-identity-heading">{t('expenses:sections.fixedIdentity')}</SectionTitle>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="fixed-expense-name">{t('expenses:fields.name')} <span className="text-red-600">*</span></label>
                <input ref={nameRef} data-autofocus id="fixed-expense-name" className="input" value={name}
                  onChange={event => { setName(event.target.value); setError('') }}
                  placeholder={t('expenses:placeholders.name')} dir="auto" />
              </div>
              <div>
                <label className="label" htmlFor="fixed-expense-category">{t('expenses:fields.category')}</label>
                <select id="fixed-expense-category" className="input" value={categoryId} onChange={event => setCategoryId(event.target.value)}>
                  <option value="">— {t('expenses:placeholders.uncategorized')} —</option>
                  {categories.map(category => <option key={category.id} value={category.id}>{category.icon} {category.name}</option>)}
                </select>
              </div>
            </div>
          </section>

          <section aria-labelledby="fixed-cost-heading">
            <SectionTitle id="fixed-cost-heading">{t('expenses:sections.recurringCost')}</SectionTitle>
            <div className="mt-3">
              <label className="label" htmlFor="fixed-expense-amount">{t('expenses:fields.monthlyAmount')} <span className="text-red-600">*</span></label>
              <MoneyInput ref={amountRef} id="fixed-expense-amount" className="input" value={amount}
                onValueChange={value => { setAmount(value); setError('') }} placeholder="0.00" />
              <p className="mt-1 text-[11px] text-gray-500">{t('expenses:fixed.monthlyOnly')}</p>
            </div>
          </section>

          <section aria-labelledby="fixed-status-heading">
            <SectionTitle id="fixed-status-heading">{t('expenses:fields.status')}</SectionTitle>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">{t(isActive ? 'expenses:status.active' : 'expenses:status.inactive')}</p>
                <p className="mt-0.5 text-xs text-gray-500">{t('expenses:activeHint')}</p>
              </div>
              <Switch checked={isActive} onChange={setIsActive} ariaLabel={t('expenses:status.active')} />
            </div>
          </section>

          {error && <div role="alert" aria-live="assertive" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        </div>

        <aside className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          <section aria-live="polite" className="rounded-xl border border-white/10 bg-[#173f2a] p-4 text-[#fff8e7] shadow-lg">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#fff8e7]/65">{t('expenses:preview.recurring')}</p>
            <p className="mt-3 break-words text-lg font-bold" dir="auto">{name || t('expenses:preview.fixedPlaceholder')}</p>
            <div className="mt-5 border-t border-white/15 pt-4">
              <p className="text-xs text-[#fff8e7]/65">{t('expenses:preview.monthlyAmount')}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums"><Rial amount={amountNum} /></p>
            </div>
            <dl className="mt-4 divide-y divide-white/15 text-xs">
              <PreviewRow label={t('expenses:preview.frequency')} value={t('expenses:fixed.monthly')} />
              <PreviewRow label={t('expenses:preview.annualEstimate')} value={new Intl.NumberFormat('en-SA', { style: 'currency', currency: 'SAR' }).format(amountNum * 12)} />
              <PreviewRow label={t('expenses:fields.status')} value={t(isActive ? 'expenses:status.active' : 'expenses:status.inactive')} />
            </dl>
            <p className="mt-4 rounded-lg bg-white/10 px-3 py-2 text-xs leading-5 text-[#fff8e7]/85">{t('expenses:fixed.templateOnly')}</p>
          </section>
        </aside>
      </div>
    </ExpenseModalShell>
  )
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return <h3 id={id} className="text-xs font-bold uppercase tracking-wide text-gray-600">{children}</h3>
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 py-2"><dt className="text-[#fff8e7]/70">{label}</dt><dd className="font-semibold text-end">{value}</dd></div>
}
