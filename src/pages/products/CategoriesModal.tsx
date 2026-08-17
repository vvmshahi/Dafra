import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Pencil, Trash2, Check, GripVertical, Loader2, RotateCcw, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useDialogFocus } from '@/hooks/useDialogFocus'
import type { Category } from '@/types'
import type { ProductRow } from './ProductsPage'
import { CategoryEmojiPicker } from '@/components/ui/CategoryEmojiPicker'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
  onAddCategory: () => void
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

export default function CategoriesModal({ open, categories, products, onClose, onChanged, onAddCategory }: Props) {
  const { t } = useTranslation(['products', 'common'])
  const [form,      setForm]      = useState<FormState>(blank())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm,  setShowForm]  = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [reorderingId, setReorderingId] = useState<string | null>(null)
  const [orderStatus, setOrderStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [localCategories, setLocalCategories] = useState<Category[]>([])
  const [error,     setError]     = useState('')
  const [notice,    setNotice]    = useState('')
  const deletePendingRef = useRef(false)
  const savedStatusTimerRef = useRef<number | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const closeModal = useCallback(() => onCloseRef.current(), [])
  const modalRef = useDialogFocus(open && deleteTarget === null, closeModal)

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
      setDeleteTarget(null)
      setOrderStatus('idle')
    }
  }, [open, categories])

  useEffect(() => () => {
    if (savedStatusTimerRef.current !== null) window.clearTimeout(savedStatusTimerRef.current)
  }, [])

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
    if (!editingId) { setError(t('products:category.chooseToEdit')); return }
    const normalizedName = form.name.trim().toLowerCase()
    if (!normalizedName) { setError(t('products:category.nameRequired')); return }

    const cleanIcon = normalizeIcon(form.icon)
    if (isIconTooLong(cleanIcon)) { setError(t('products:category.iconTooLong')); return }

    const duplicate = categories.some(cat =>
      cat.id !== editingId && cat.name.trim().toLowerCase() === normalizedName
    )
    if (duplicate) { setError(t('products:category.duplicate')); return }

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
    if (err) { console.error('[CategoriesModal] update failed', err); setError(t('products:errors.saveFailed')); setSaving(false); return }

    setSaving(false)
    const successMessage = t('products:category.saved')
    cancelForm(false)
    setNotice(successMessage)
    onChanged()
  }

  const handleDelete = async () => {
    const id = deleteTarget?.id
    if (!id || deletePendingRef.current) return
    deletePendingRef.current = true
    setDeletingId(id)
    setError('')
    setNotice('')
    const q = supabase as unknown as { from: (t: string) => any }
    try {
      const { data, error: err, status } = await q
        .from('categories')
        .delete()
        .eq('id', id)
        .select('id')
        .single()
      if (err || status < 200 || status >= 300 || data?.id !== id) {
        throw err ?? new Error(`Unexpected category delete response (${status})`)
      }
      setLocalCategories(current => current.filter(category => category.id !== id))
      setDeleteTarget(null)
      toast.success(t('products:categoryManagement.deleteSuccess'))
      onChanged()
    } catch (deleteError) {
      console.error('[CategoriesModal] delete failed', deleteError)
      const code = typeof deleteError === 'object' && deleteError !== null && 'code' in deleteError
        ? String(deleteError.code)
        : ''
      const message = code === '23503'
        ? t('products:categoryManagement.deleteDependencyError')
        : t('products:categoryManagement.deleteError')
      setError(message)
      toast.error(message)
    } finally {
      deletePendingRef.current = false
      setDeletingId(null)
    }
  }

  const persistOrder = async (nextOrder: Category[], movedId: string) => {
    const previousOrder = orderedCategories
    const normalizedOrder = nextOrder.map((cat, sortOrder) => ({ ...cat, sort_order: sortOrder }))
    setLocalCategories(normalizedOrder)

    setReorderingId(movedId)
    setOrderStatus('saving')
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
      console.error('[CategoriesModal] reorder failed', failed.error)
      const message = t('products:categoryManagement.orderStatus.error')
      setError(message)
      setOrderStatus('error')
      setLocalCategories(previousOrder)
      toast.error(message)
      await Promise.all(previousOrder.map(category =>
        q.from('categories').update({ sort_order: category.sort_order ?? 0 }).eq('id', category.id)
      ))
      setReorderingId(null)
      onChanged()
      return
    }

    setOrderStatus('saved')
    setReorderingId(null)
    onChanged()
    if (savedStatusTimerRef.current !== null) window.clearTimeout(savedStatusTimerRef.current)
    savedStatusTimerRef.current = window.setTimeout(() => setOrderStatus('idle'), 1800)
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

  const handleKeyboardReorder = async (categoryId: string, direction: -1 | 1) => {
    if (reorderingId) return
    const currentIndex = orderedCategories.findIndex(category => category.id === categoryId)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedCategories.length) return
    const nextOrder = [...orderedCategories]
    const [moved] = nextOrder.splice(currentIndex, 1)
    nextOrder.splice(nextIndex, 0, moved)
    await persistOrder(nextOrder, moved.id)
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={() => {
        if (!saving && !reorderingId && !deletingId) closeModal()
      }} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-categories-title"
          aria-describedby="manage-categories-guidance"
          className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden"
        >

          {/* ── Header ──────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id="manage-categories-title" className="text-lg font-bold text-gray-900">{t('products:category.manage')}</h2>
              <div className="mt-1 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                <span>{t('products:category.count', { count: orderedCategories.length })}</span>
                <span aria-hidden="true">·</span>
                <span aria-live="polite" aria-atomic="true" className={`inline-flex items-center gap-1 font-medium ${
                  orderStatus === 'error' ? 'text-red-600' : orderStatus === 'saved' ? 'text-emerald-700' : 'text-gray-500'
                }`}>
                  {orderStatus === 'saving' && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                  {t(`products:categoryManagement.orderStatus.${orderStatus}`)}
                </span>
              </div>
              <p id="manage-categories-guidance" className="text-xs text-gray-500 mt-1">
                {t('products:categoryManagement.orderHint')}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={onAddCategory}
                disabled={saving || Boolean(reorderingId) || Boolean(deletingId)}
                className="border border-[#a9c6ad] bg-[#fffefa] text-[#173f2a] shadow-sm hover:border-[#6e9a75] hover:bg-[#f1f7f2] focus-visible:ring-[#173f2a]"
              >
                <Plus size={14} aria-hidden="true" />
                {t('products:category.add')}
              </Button>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving || Boolean(reorderingId) || Boolean(deletingId)}
                aria-label={t('common:close')}
                className="w-9 h-9 flex flex-shrink-0 items-center justify-center rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-40 transition-colors"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* ── Body ────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 sm:p-6">

            {/* Edit form */}
            {notice && (
              <div aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-700">
                {notice}
              </div>
            )}
            {error && !showForm && (
              <div role="alert" aria-live="assertive" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700">
                <span>{error}</span>
                <button type="button" onClick={() => { setError(''); onChanged() }} className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">
                  <RotateCcw size={12} aria-hidden="true" />{t('products:categoryManagement.retry')}
                </button>
              </div>
            )}

            {showForm ? (
              <form
                onSubmit={handleSubmit}
                className="border border-primary-200 bg-primary-50/20 rounded-xl p-4 space-y-3"
              >
                <p className="text-sm font-semibold text-gray-800">
                  {t('products:category.edit')}
                </p>
                <p className="text-xs text-gray-500">
                  {t('products:category.saveHint')}
                </p>

                {/* Names */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label text-xs">{t('products:category.name')} *</label>
                    <input
                      className="input py-2 text-sm"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder={t('products:placeholders.category')}
                    />
                  </div>
                  <div>
                    <label className="label text-xs">{t('products:category.nameAr')}</label>
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
                  <label className="label text-xs">{t('products:category.description')}</label>
                  <input
                    className="input py-2 text-sm"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={t('common:optional')}
                  />
                </div>

                {/* Color swatches */}
                <div>
                  <label className="label text-xs">{t('products:category.color')}</label>
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
                  <label className="label text-xs">{t('products:category.icon')}</label>
                  <CategoryEmojiPicker value={form.icon} categoryName={form.name}
                    onChange={icon => setForm(current => ({ ...current, icon }))} />
                </div>

                {/* Sort order */}
                <div className="w-32">
                  <label className="label text-xs">{t('products:category.sortOrder')}</label>
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
                    {t('common:cancel')}
                  </Button>
                  <Button type="submit" size="sm" loading={saving}>
                    {t('common:save')}
                  </Button>
                </div>
              </form>
            ) : null}

            {/* ── Category grid ──────────────────────────────── */}
            {orderedCategories.length === 0 ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                {t('products:category.empty')}
              </div>
            ) : (
              <div className="space-y-2" role="list">
                {orderedCategories.map((cat, index) => {
                  const color = cat.color ?? '#6b7280'
                  const icon  = cat.icon  ?? ''
                  const isEditing = editingId === cat.id
                  const isDragging = draggedId === cat.id
                  const isDragTarget = dragOverId === cat.id && draggedId !== cat.id

                  return (
                    <div
                      key={cat.id}
                      role="listitem"
                      aria-label={t('products:categoryManagement.rowAria', { name: cat.name, position: index + 1, count: orderedCategories.length })}
                      onDragOver={e => {
                        if (!draggedId || reorderingId) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        setDragOverId(cat.id)
                      }}
                      onDragLeave={() => setDragOverId(current => current === cat.id ? null : current)}
                      onDrop={e => {
                        e.preventDefault()
                        handleDropCategory(cat.id)
                      }}
                      className={`flex items-center gap-2 rounded-xl border bg-white p-2.5 transition-[border-color,background-color,box-shadow,opacity,transform] duration-150 sm:gap-3 ${
                        isEditing
                          ? 'border-primary-300 bg-primary-50/20'
                          : isDragTarget
                            ? 'border-primary-400 bg-primary-50/50 shadow-[inset_0_2px_0_0_#238447]'
                            : 'border-gray-100 hover:border-gray-200'
                      } ${isDragging ? 'scale-[0.99] border-amber-300 bg-amber-50/60 opacity-70 shadow-md' : ''}`}
                    >
                      {/* Order number */}
                      <div className="w-8 h-8 rounded-lg bg-primary-50 border border-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0" aria-hidden="true">
                        {index + 1}
                      </div>

                      {/* Drag handle */}
                      <button
                        type="button"
                        draggable={reorderingId === null}
                        disabled={reorderingId !== null}
                        onDragStart={event => {
                          setDraggedId(cat.id)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', cat.id)
                        }}
                        onDragEnd={() => {
                          setDraggedId(null)
                          setDragOverId(null)
                        }}
                        onKeyDown={event => {
                          if (event.key === 'ArrowUp') {
                            event.preventDefault()
                            void handleKeyboardReorder(cat.id, -1)
                          } else if (event.key === 'ArrowDown') {
                            event.preventDefault()
                            void handleKeyboardReorder(cat.id, 1)
                          }
                        }}
                        className={`w-10 h-10 rounded-lg flex flex-shrink-0 items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 transition-colors ${
                          reorderingId === null ? 'cursor-grab active:cursor-grabbing' : 'cursor-wait'
                        }`}
                        aria-label={t('products:categoryManagement.dragAria', { name: cat.name, position: index + 1, count: orderedCategories.length })}
                        aria-describedby="manage-categories-guidance"
                        title={t('products:categoryManagement.dragTooltip', { position: index + 1 })}
                      >
                        <GripVertical size={18} aria-hidden="true" />
                      </button>

                      {/* Color swatch + icon */}
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 sm:h-10 sm:w-10 sm:text-xl"
                        style={{ backgroundColor: color + '22' }}
                        aria-hidden="true"
                      >
                        {icon}
                      </div>

                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-gray-800" dir="auto">{cat.name}</p>
                        {cat.name_ar && (
                          <p className="truncate text-xs text-gray-500" dir="auto">{cat.name_ar}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(cat)}
                          disabled={Boolean(reorderingId) || Boolean(deletingId) || saving}
                          title={t('products:category.editAria', { name: cat.name })}
                          className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                          aria-label={t('products:category.editAria', { name: cat.name })}
                          aria-busy={(saving && editingId === cat.id) || undefined}
                        >
                          {saving && editingId === cat.id
                            ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            : <Pencil size={14} aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(cat)}
                          disabled={Boolean(reorderingId) || Boolean(deletingId) || saving}
                          title={t('products:category.deleteAria', { name: cat.name })}
                          className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                          aria-label={t('products:category.deleteAria', { name: cat.name })}
                          aria-busy={(deletingId === cat.id) || undefined}
                        >
                          {deletingId === cat.id
                            ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                            : <Trash2 size={14} aria-hidden="true" />}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────── */}
          <div className="flex flex-shrink-0 justify-end border-t border-gray-100 px-4 py-4 sm:px-6">
            <Button
              className="w-full sm:w-auto sm:min-w-28"
              onClick={closeModal}
              disabled={saving || Boolean(reorderingId) || Boolean(deletingId)}
            >
              {t('products:done')}
            </Button>
          </div>

        </div>
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        kind="categoryDelete"
        busy={deletingId !== null}
        destructive
        cancelLabel={t('common:cancel')}
        onConfirm={() => void handleDelete()}
        onClose={() => { if (!deletePendingRef.current) setDeleteTarget(null) }}
      />
    </>
  )
}
