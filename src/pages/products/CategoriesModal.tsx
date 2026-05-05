import { useState, useEffect } from 'react'
import { X, Plus, Pencil, Trash2, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import type { Category } from '@/types'

// ── Palette & defaults ────────────────────────────────────────────────────────

const COLOR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#6b7280', '#1c5c2e', '#0891b2', '#b45309',
]

const PRESET_ICONS = [
  '📦', '🍕', '🍔', '☕', '🥤', '🍰',
  '🛍️', '💊', '📱', '🎁', '🧴', '🥗',
  '🍣', '🥩', '🧃', '🍦', '🫙', '🥪',
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  categories: Category[]
  onClose: () => void
  onChanged: () => void
}

interface FormState {
  name: string
  nameAr: string
  description: string
  color: string
  icon: string
  sortOrder: string
}

const blank = (): FormState => ({
  name: '', nameAr: '', description: '',
  color: '#6b7280', icon: '📦', sortOrder: '0',
})

// ── Component ─────────────────────────────────────────────────────────────────

export default function CategoriesModal({ open, categories, onClose, onChanged }: Props) {
  const { profile } = useAuth()

  const [form,      setForm]      = useState<FormState>(blank())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm,  setShowForm]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setShowForm(false)
      setEditingId(null)
      setForm(blank())
      setError('')
    }
  }, [open])

  const startAdd = () => {
    setEditingId(null)
    setForm(blank())
    setError('')
    setShowForm(true)
  }

  const startEdit = (cat: Category) => {
    setEditingId(cat.id)
    setForm({
      name:        cat.name,
      nameAr:      cat.name_ar      ?? '',
      description: cat.description  ?? '',
      color:       cat.color        ?? '#6b7280',
      icon:        cat.icon         ?? '📦',
      sortOrder:   String(cat.sort_order ?? 0),
    })
    setError('')
    setShowForm(true)
  }

  const cancelForm = () => {
    setShowForm(false)
    setEditingId(null)
    setForm(blank())
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Category name is required'); return }

    setSaving(true)
    setError('')

    const payload = {
      name:        form.name.trim(),
      name_ar:     form.nameAr.trim()      || null,
      description: form.description.trim() || null,
      color:       form.color,
      icon:        form.icon || '📦',
      sort_order:  Number(form.sortOrder)  || 0,
    }

    const q = supabase as unknown as { from: (t: string) => any }

    if (editingId) {
      const { error: err } = await q.from('categories').update(payload).eq('id', editingId)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await q.from('categories').insert({
        ...payload,
        tenant_id: profile?.tenant_id,
        branch_id: profile?.branch_id,
      })
      if (err) { setError(err.message); setSaving(false); return }
    }

    setSaving(false)
    cancelForm()
    onChanged()
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete category "${name}"?\n\nProducts in this category won't be deleted — they'll just have no category.`)) return
    const q = supabase as unknown as { from: (t: string) => any }
    await q.from('categories').delete().eq('id', id)
    onChanged()
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[88vh] flex flex-col">

          {/* ── Header ──────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">Manage Categories</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {categories.length} {categories.length === 1 ? 'category' : 'categories'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* ── Body ────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">

            {/* Add / Edit form */}
            {showForm ? (
              <form
                onSubmit={handleSubmit}
                className="border border-primary-200 bg-primary-50/20 rounded-xl p-4 space-y-3"
              >
                <p className="text-sm font-semibold text-gray-800">
                  {editingId ? 'Edit Category' : 'New Category'}
                </p>

                {/* Names */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">Name (English) *</label>
                    <input
                      className="input py-2 text-sm"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Beverages"
                    />
                  </div>
                  <div>
                    <label className="label text-xs">Name (Arabic)</label>
                    <input
                      className="input py-2 text-sm text-right"
                      dir="rtl"
                      value={form.nameAr}
                      onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))}
                      placeholder="المشروبات"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="label text-xs">Description</label>
                  <input
                    className="input py-2 text-sm"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional"
                  />
                </div>

                {/* Color swatches */}
                <div>
                  <label className="label text-xs">Color</label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {COLOR_PALETTE.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, color: c }))}
                        style={{ backgroundColor: c }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center transition-transform hover:scale-110 flex-shrink-0"
                      >
                        {form.color === c && <Check size={12} className="text-white" strokeWidth={3} />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Icon presets + custom */}
                <div>
                  <label className="label text-xs">Icon</label>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {PRESET_ICONS.map(icon => (
                      <button
                        key={icon}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, icon }))}
                        className={`w-9 h-9 rounded-xl text-xl flex items-center justify-center transition-all ${
                          form.icon === icon
                            ? 'bg-primary-100 ring-2 ring-primary-400 scale-110'
                            : 'hover:bg-gray-100'
                        }`}
                      >
                        {icon}
                      </button>
                    ))}
                    {/* Custom emoji input */}
                    <input
                      className="input w-14 py-1.5 text-center text-xl"
                      value={form.icon}
                      onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                      maxLength={2}
                      placeholder="✏️"
                      title="Type any emoji"
                    />
                  </div>
                </div>

                {/* Sort order */}
                <div className="w-32">
                  <label className="label text-xs">Sort Order</label>
                  <input
                    className="input py-2 text-sm"
                    type="number"
                    min="0"
                    value={form.sortOrder}
                    onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))}
                  />
                </div>

                {error && <p className="text-xs text-red-600">{error}</p>}

                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="ghost" size="sm" onClick={cancelForm}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" loading={saving}>
                    {editingId ? 'Save Changes' : 'Add Category'}
                  </Button>
                </div>
              </form>
            ) : (
              /* Add button */
              <button
                onClick={startAdd}
                className="w-full flex items-center gap-2 px-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50/20 transition-colors"
              >
                <Plus size={16} />
                Add Category
              </button>
            )}

            {/* ── Category grid ──────────────────────────────── */}
            {categories.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                No categories yet. Add one above to get started.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {categories.map(cat => {
                  const color = cat.color ?? '#6b7280'
                  const icon  = cat.icon  ?? '📦'
                  const isEditing = editingId === cat.id

                  return (
                    <div
                      key={cat.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors bg-white ${
                        isEditing
                          ? 'border-primary-300 bg-primary-50/20'
                          : 'border-gray-100 hover:border-gray-200'
                      }`}
                    >
                      {/* Color swatch + icon */}
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                        style={{ backgroundColor: color + '22' }}
                      >
                        {icon}
                      </div>

                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{cat.name}</p>
                        {cat.name_ar && (
                          <p className="text-xs text-gray-400 truncate" dir="rtl">{cat.name_ar}</p>
                        )}
                      </div>

                      {/* Color dot */}
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />

                      {/* Actions */}
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => startEdit(cat)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(cat.id, cat.name)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────── */}
          <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
            <Button variant="secondary" className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>

        </div>
      </div>
    </>
  )
}
