import { useState, useEffect } from 'react'
import { X, Pencil, Trash2, Check, GripVertical } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import type { Category } from '@/types'
import type { ProductRow } from './ProductsPage'
import { CategoryEmojiPicker } from '@/components/ui/CategoryEmojiPicker'

// ── Palette & defaults ────────────────────────────────────────────────────────

const COLOR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#6b7280', '#1c5c2e', '#0891b2', '#b45309',
]

const normalizeIcon = (value: string) => value.trim()

const isIconTooLong = (value: string) => Array.from(value.trim()).length > 10

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  categories: Category[]
  products: ProductRow[]
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

export default function CategoriesModal({ open, categories, products, onClose, onChanged }: Props) {
  const [form,      setForm]      = useState<FormState>(blank())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm,  setShowForm]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [reorderingId, setReorderingId] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [localCategories, setLocalCategories] = useState<Category[]>([])
  const [error,     setError]     = useState('')
  const [notice,    setNotice]    = useState('')

  const sortCategories = (items: Category[]) => [...items].sort((a, b) => {
    const order = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
    return order || a.name.localeCompare(b.name)
  })

  const orderedCategories = localCategories

  // Reset form when modal closes
  useEffect(() => {
    if (open) {
      setLocalCategories(sortCategories(categories))
    }

    if (!open) {
      setShowForm(false)
      setEditingId(null)
      setForm(blank())
      setError('')
      setDraggedId(null)
      setDragOverId(null)
    }
  }, [open, categories])

  const startEdit = (cat: Category) => {
    setEditingId(cat.id)
    setForm({
      name:        cat.name,
      nameAr:      cat.name_ar      ?? '',
      description: cat.description  ?? '',
      color:       cat.color        ?? '#6b7280',
      icon:        cat.icon         ?? '',
      sortOrder:   String(cat.sort_order ?? 0),
    })
    setError('')
    setNotice('')
    setShowForm(true)
  }

  const cancelForm = (clearNotice = true) => {
    setShowForm(false)
    setEditingId(null)
    setForm(blank())
    setError('')
    if (clearNotice) setNotice('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) { setError('Choose a category to edit'); return }
    const normalizedName = form.name.trim().toLowerCase()
    if (!normalizedName) { setError('Category name is required'); return }

    const cleanIcon = normalizeIcon(form.icon)
    if (isIconTooLong(cleanIcon)) { setError('Icon must be 10 characters or fewer.'); return }

    const duplicate = categories.some(cat =>
      cat.id !== editingId && cat.name.trim().toLowerCase() === normalizedName
    )
    if (duplicate) { setError('A category with this name already exists'); return }

    setSaving(true)
    setError('')
    setNotice('')

    const payload = {
      name:        form.name.trim(),
      name_ar:     form.nameAr.trim()      || null,
      description: form.description.trim() || null,
      color:       form.color,
      icon:        cleanIcon || null,
      sort_order:  Number(form.sortOrder)  || 0,
    }

    const q = supabase as unknown as { from: (t: string) => any }

    const { error: err } = await q.from('categories').update(payload).eq('id', editingId)
    if (err) { setError(err.message); setSaving(false); return }

    setSaving(false)
    const successMessage = editingId ? 'Category changes saved.' : 'Category added.'
    cancelForm(false)
    setNotice(successMessage)
    onChanged()
  }

  const handleDelete = async (id: string, name: string) => {
    const productCount = products.filter(p => p.category_id === id).length
    const warning = productCount > 0
      ? `This category is used by ${productCount} ${productCount === 1 ? 'product' : 'products'}. Deleting it will remove the category from those products.`
      : 'Deleting this category may uncategorize existing products.'
    if (!confirm(`Delete category "${name}"?\n\n${warning}`)) return

    setError('')
    setNotice('')
    const q = supabase as unknown as { from: (t: string) => any }
    const { error: err } = await q.from('categories').delete().eq('id', id)
    if (err) {
      setError(err.message)
      return
    }
    setNotice('Category deleted.')
    onChanged()
  }

  const persistOrder = async (nextOrder: Category[], movedId: string) => {
    const previousOrder = orderedCategories
    const normalizedOrder = nextOrder.map((cat, sortOrder) => ({ ...cat, sort_order: sortOrder }))
    setLocalCategories(normalizedOrder)

    setReorderingId(movedId)
    setError('')
    setNotice('')

    const q = supabase as unknown as { from: (t: string) => any }
    const results = await Promise.all(
      normalizedOrder.map((cat, sortOrder) =>
        q.from('categories').update({ sort_order: sortOrder }).eq('id', cat.id)
      )
    )
    const failed = results.find(result => result.error)
    if (failed?.error) {
      setError(failed.error.message)
      setLocalCategories(previousOrder)
      setReorderingId(null)
      return
    }

    setNotice('Category order saved.')
    setReorderingId(null)
    onChanged()
  }

  const handleDropCategory = async (targetId: string) => {
    if (!draggedId || draggedId === targetId || reorderingId) {
      setDraggedId(null)
      setDragOverId(null)
      return
    }

    const fromIndex = orderedCategories.findIndex(cat => cat.id === draggedId)
    const toIndex = orderedCategories.findIndex(cat => cat.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return

    const nextOrder = [...orderedCategories]
    const [moved] = nextOrder.splice(fromIndex, 1)
    nextOrder.splice(toIndex, 0, moved)

    setDraggedId(null)
    setDragOverId(null)
    await persistOrder(nextOrder, moved.id)
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
                {categories.length} {categories.length === 1 ? 'category' : 'categories'} · Changes are saved immediately.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Drag categories to set the order shown from left to right in POS.
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

            {/* Edit form */}
            {notice && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700">
                {notice}
              </div>
            )}
            {error && !showForm && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-600">
                {error}
              </div>
            )}

            {showForm ? (
              <form
                onSubmit={handleSubmit}
                className="border border-primary-200 bg-primary-50/20 rounded-xl p-4 space-y-3"
              >
                <p className="text-sm font-semibold text-gray-800">
                  Edit Category
                </p>
                <p className="text-xs text-gray-500">
                  Saving updates applies them right away.
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

                {/* Searchable category emoji */}
                <div>
                  <label className="label text-xs">Category icon</label>
                  <CategoryEmojiPicker value={form.icon} categoryName={form.name}
                    onChange={icon => setForm(current => ({ ...current, icon }))} />
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
                    Save Changes
                  </Button>
                </div>
              </form>
            ) : null}

            {/* ── Category grid ──────────────────────────────── */}
            {categories.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                No categories yet. Use Add Category on the products page to create one.
              </div>
            ) : (
              <div className="space-y-2">
                {orderedCategories.map((cat, index) => {
                  const color = cat.color ?? '#6b7280'
                  const icon  = cat.icon  ?? ''
                  const isEditing = editingId === cat.id
                  const isReordering = reorderingId === cat.id
                  const isDragging = draggedId === cat.id
                  const isDragTarget = dragOverId === cat.id && draggedId !== cat.id

                  return (
                    <div
                      key={cat.id}
                      draggable={reorderingId === null}
                      onDragStart={e => {
                        setDraggedId(cat.id)
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', cat.id)
                      }}
                      onDragOver={e => {
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        setDragOverId(cat.id)
                      }}
                      onDragLeave={() => setDragOverId(current => current === cat.id ? null : current)}
                      onDrop={e => {
                        e.preventDefault()
                        handleDropCategory(cat.id)
                      }}
                      onDragEnd={() => {
                        setDraggedId(null)
                        setDragOverId(null)
                      }}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all bg-white ${
                        isEditing
                          ? 'border-primary-300 bg-primary-50/20'
                          : isDragTarget
                            ? 'border-primary-300 bg-primary-50/30'
                            : 'border-gray-100 hover:border-gray-200'
                      } ${isDragging ? 'opacity-60 shadow-sm' : ''}`}
                    >
                      {/* Order number */}
                      <div className="w-8 h-8 rounded-xl bg-primary-50 border border-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {index + 1}
                      </div>

                      {/* Drag handle */}
                      <button
                        type="button"
                        className={`w-7 h-9 rounded-lg flex items-center justify-center text-gray-300 hover:bg-gray-100 hover:text-gray-500 transition-colors ${
                          reorderingId === null ? 'cursor-grab active:cursor-grabbing' : 'cursor-wait'
                        }`}
                        aria-label={`Drag to reorder ${cat.name}`}
                        title="Drag to reorder"
                        tabIndex={0}
                      >
                        <GripVertical size={16} />
                      </button>

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
                        <p className="text-[11px] text-gray-400 mt-0.5">Priority {index + 1}</p>
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
                          disabled={isReordering}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 transition-colors"
                          aria-label={`Edit ${cat.name}`}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(cat.id, cat.name)}
                          disabled={isReordering}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40 transition-colors"
                          aria-label={`Delete ${cat.name}`}
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
