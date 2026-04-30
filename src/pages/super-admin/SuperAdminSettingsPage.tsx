import { useEffect, useState } from 'react'
import { Save, Plus, Trash2, Edit2, Check, X, Package } from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Plan {
  id:            string
  name:          string
  name_ar:       string | null
  price_monthly: number
  price_yearly:  number
  max_branches:  number
  max_users:     number
  max_products:  number
  features:      string[]
  is_active:     boolean
}

interface PlanForm {
  name:          string
  name_ar:       string
  price_monthly: string
  price_yearly:  string
  max_branches:  string
  max_users:     string
  max_products:  string
  features:      string
  is_active:     boolean
}

const EMPTY_FORM: PlanForm = {
  name: '', name_ar: '', price_monthly: '', price_yearly: '',
  max_branches: '1', max_users: '5', max_products: '500',
  features: '', is_active: true,
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SuperAdminSettingsPage() {
  const [plans,    setPlans]    = useState<Plan[]>([])
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState<string | null>(null) // plan id or 'new'
  const [form,     setForm]     = useState<PlanForm>(EMPTY_FORM)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function fetchPlans() {
    const { data } = await (supabase as any)
      .from('subscription_plans')
      .select('*')
      .order('price_monthly')
    setPlans(data ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchPlans() }, [])

  function startEdit(plan: Plan) {
    setEditing(plan.id)
    setForm({
      name:          plan.name,
      name_ar:       plan.name_ar ?? '',
      price_monthly: plan.price_monthly.toString(),
      price_yearly:  plan.price_yearly.toString(),
      max_branches:  plan.max_branches.toString(),
      max_users:     plan.max_users.toString(),
      max_products:  plan.max_products.toString(),
      features:      plan.features.join('\n'),
      is_active:     plan.is_active,
    })
    setError(null)
  }

  function startNew() {
    setEditing('new')
    setForm(EMPTY_FORM)
    setError(null)
  }

  function cancelEdit() {
    setEditing(null)
    setError(null)
  }

  async function savePlan() {
    setError(null)
    const name = form.name.trim()
    if (!name) return setError('Plan name is required.')
    const price = parseFloat(form.price_monthly)
    if (isNaN(price) || price < 0) return setError('Invalid monthly price.')

    setSaving(true)
    const payload = {
      name,
      name_ar:       form.name_ar.trim() || null,
      price_monthly: price,
      price_yearly:  parseFloat(form.price_yearly) || price * 10,
      max_branches:  parseInt(form.max_branches) || 1,
      max_users:     parseInt(form.max_users) || 5,
      max_products:  parseInt(form.max_products) || 500,
      features:      form.features.split('\n').map(s => s.trim()).filter(Boolean),
      is_active:     form.is_active,
    }

    let err: any = null
    if (editing === 'new') {
      const res = await (supabase as any).from('subscription_plans').insert([payload])
      err = res.error
    } else {
      const res = await (supabase as any).from('subscription_plans').update(payload).eq('id', editing)
      err = res.error
    }

    setSaving(false)
    if (err) { setError(err.message); return }
    setEditing(null)
    fetchPlans()
  }

  async function deletePlan(plan: Plan) {
    const confirmed = window.confirm(`Delete plan "${plan.name}"? Existing subscriptions using it will not be affected.`)
    if (!confirmed) return
    await (supabase as any).from('subscription_plans').delete().eq('id', plan.id)
    fetchPlans()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-4xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Platform Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage subscription plans and global configuration</p>
      </div>

      {/* Subscription plans */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Subscription Plans</h2>
          {editing !== 'new' && (
            <button
              onClick={startNew}
              className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-xl transition-colors"
            >
              <Plus size={14} /> New Plan
            </button>
          )}
        </div>

        {/* New plan form */}
        {editing === 'new' && (
          <PlanForm
            form={form} onChange={setForm} onSave={savePlan} onCancel={cancelEdit}
            saving={saving} error={error} title="New Plan"
          />
        )}

        <div className="space-y-3">
          {plans.map(plan => (
            <div key={plan.id} className="card">
              {editing === plan.id ? (
                <div className="p-5">
                  <PlanForm
                    form={form} onChange={setForm} onSave={savePlan} onCancel={cancelEdit}
                    saving={saving} error={error} title={`Edit: ${plan.name}`}
                  />
                </div>
              ) : (
                <div className="p-5 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                    <Package size={18} className="text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900">{plan.name}</h3>
                      {plan.name_ar && <span className="text-xs text-gray-400" dir="rtl">{plan.name_ar}</span>}
                      {!plan.is_active && (
                        <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Inactive</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
                      <span>SAR {plan.price_monthly}/mo · SAR {plan.price_yearly}/yr</span>
                      <span>{plan.max_branches} branch{plan.max_branches !== 1 ? 'es' : ''}</span>
                      <span>{plan.max_users} users</span>
                      <span>{plan.max_products} products</span>
                    </div>
                    {plan.features.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {plan.features.map((f, i) => (
                          <span key={i} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => startEdit(plan)}
                      className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => deletePlan(plan)}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Platform config — static for now */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Platform Configuration</h2>
        <div className="card p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Platform Name">
              <input className="input text-sm h-9 w-full" defaultValue="Dafra" />
            </FormField>
            <FormField label="Support Email">
              <input className="input text-sm h-9 w-full" defaultValue="support@dafra.sa" />
            </FormField>
            <FormField label="VAT Rate (%)">
              <input className="input text-sm h-9 w-full" defaultValue="15" type="number" />
            </FormField>
            <FormField label="Default Country">
              <input className="input text-sm h-9 w-full" defaultValue="SA" />
            </FormField>
          </div>
          <div className="pt-2 border-t border-gray-100 flex justify-end">
            <button className="flex items-center gap-2 text-sm font-medium px-4 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors">
              <Save size={14} /> Save Configuration
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

// ── Inline form component ─────────────────────────────────────────────────────

function PlanForm({
  form, onChange, onSave, onCancel, saving, error, title,
}: {
  form: PlanForm
  onChange: (f: PlanForm) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
  title: string
}) {
  function set(key: keyof PlanForm, val: any) {
    onChange({ ...form, [key]: val })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <button onClick={onCancel} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
          <X size={15} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Plan Name *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} className="input text-sm h-9 w-full" placeholder="Business" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Name (Arabic)</label>
          <input value={form.name_ar} onChange={e => set('name_ar', e.target.value)} className="input text-sm h-9 w-full" dir="rtl" placeholder="بزنس" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Monthly Price (SAR) *</label>
          <input value={form.price_monthly} onChange={e => set('price_monthly', e.target.value)} className="input text-sm h-9 w-full" type="number" min="0" placeholder="299" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Yearly Price (SAR)</label>
          <input value={form.price_yearly} onChange={e => set('price_yearly', e.target.value)} className="input text-sm h-9 w-full" type="number" min="0" placeholder="2990" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Max Branches</label>
          <input value={form.max_branches} onChange={e => set('max_branches', e.target.value)} className="input text-sm h-9 w-full" type="number" min="1" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Max Users</label>
          <input value={form.max_users} onChange={e => set('max_users', e.target.value)} className="input text-sm h-9 w-full" type="number" min="1" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Max Products</label>
          <input value={form.max_products} onChange={e => set('max_products', e.target.value)} className="input text-sm h-9 w-full" type="number" min="1" />
        </div>
        <div className="flex items-center gap-3 pt-5">
          <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="rounded" />
          <label htmlFor="is_active" className="text-sm text-gray-700">Plan is active</label>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Features (one per line)</label>
        <textarea
          value={form.features} onChange={e => set('features', e.target.value)}
          rows={4} className="input text-sm w-full resize-none"
          placeholder={"ZATCA Phase 1 QR\nMulti-branch\nReports & Analytics"}
        />
      </div>

      {error && (
        <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="flex items-center gap-2 justify-end pt-1">
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 font-medium">
          Cancel
        </button>
        <button
          onClick={onSave} disabled={saving}
          className="flex items-center gap-1.5 text-sm font-medium px-4 py-1.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-60"
        >
          {saving ? <LoadingSpinner size="sm" /> : <Check size={14} />}
          {saving ? 'Saving…' : 'Save Plan'}
        </button>
      </div>
    </div>
  )
}
