import { useState, useEffect, useRef } from 'react'
import { X, ChevronDown, ChevronUp, ImagePlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import type { Category, VatTreatment } from '@/types'
import type { ProductRow } from './ProductsPage'

// ── VAT options ───────────────────────────────────────────────────────────────

const VAT_OPTIONS: { value: VatTreatment; label: string; desc: string }[] = [
  { value: 'inherit',   label: 'Branch Default',    desc: 'Follow branch VAT setting' },
  { value: 'exclusive', label: 'Always Exclusive',  desc: 'Price shown + VAT at checkout' },
  { value: 'inclusive', label: 'Always Inclusive',  desc: 'VAT already included in price' },
  { value: 'exempt',    label: 'VAT Exempt',        desc: 'Zero-rated or exempt item' },
]

// ── Accordion section ─────────────────────────────────────────────────────────

function Section({
  title, open, onToggle, children,
}: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        {open
          ? <ChevronUp size={16} className="text-gray-400" />
          : <ChevronDown size={16} className="text-gray-400" />
        }
      </button>
      {open && <div className="px-4 py-4 space-y-4 bg-white">{children}</div>}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  product: ProductRow | null
  categories: Category[]
  onClose: () => void
  onSaved: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProductDrawer({ open, product, categories, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [s0, setS0] = useState(true)   // Basic Info
  const [s1, setS1] = useState(true)   // Pricing & VAT
  const [s2, setS2] = useState(true)   // Image
  const [s3, setS3] = useState(true)   // Settings

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // Form state
  const [name,         setName]         = useState('')
  const [nameAr,       setNameAr]       = useState('')
  const [categoryId,   setCategoryId]   = useState('')
  const [description,  setDescription]  = useState('')
  const [price,        setPrice]        = useState('')
  const [vatTreatment, setVatTreatment] = useState<VatTreatment>('inherit')
  const [imageFile,    setImageFile]    = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isAvailable,  setIsAvailable]  = useState(true)
  const [sortOrder,    setSortOrder]    = useState('0')
  const [sku,          setSku]          = useState('')
  const [notes,        setNotes]        = useState('')

  // Populate form when editing, reset when adding
  useEffect(() => {
    if (open && product) {
      setName(product.name)
      setNameAr(product.name_ar ?? '')
      setCategoryId(product.category_id ?? '')
      setDescription(product.description ?? '')
      setPrice(String(product.price))
      setVatTreatment((product.vat_treatment as VatTreatment) ?? 'inherit')
      setImagePreview(product.image_url)
      setIsAvailable(product.is_available ?? true)
      setSortOrder(String(product.sort_order ?? 0))
      setSku(product.sku ?? '')
      setNotes(product.notes ?? '')
    } else {
      setName('')
      setNameAr('')
      setCategoryId('')
      setDescription('')
      setPrice('')
      setVatTreatment('inherit')
      setImagePreview(null)
      setIsAvailable(true)
      setSortOrder('0')
      setSku('')
      setNotes('')
    }
    setImageFile(null)
    setError('')
  }, [open, product])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Product name is required'); return }
    if (!price || isNaN(Number(price))) { setError('A valid price is required'); return }

    setSaving(true)
    setError('')

    try {
      const tid = profile?.tenant_id!
      let imageUrl: string | null = product?.image_url ?? null

      // Upload new image if selected
      if (imageFile) {
        const ext  = imageFile.name.split('.').pop() ?? 'jpg'
        const path = `${tid}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('product-images')
          .upload(path, imageFile, { upsert: true })
        if (upErr) { setError('Image upload failed: ' + upErr.message); return }
        const { data: { publicUrl } } = supabase.storage
          .from('product-images')
          .getPublicUrl(path)
        imageUrl = publicUrl
      } else if (imagePreview === null) {
        // User explicitly removed the image
        imageUrl = null
      }

      const payload: Record<string, unknown> = {
        tenant_id:     tid,
        name:          name.trim(),
        name_ar:       nameAr.trim()       || null,
        category_id:   categoryId          || null,
        description:   description.trim()  || null,
        price:         Number(price),
        vat_treatment: vatTreatment,
        image_url:     imageUrl,
        is_available:  isAvailable,
        sort_order:    Number(sortOrder)   || 0,
        sku:           sku.trim()          || null,
        notes:         notes.trim()        || null,
      }

      const q = supabase as unknown as { from: (t: string) => any }

      if (product) {
        const { error: err } = await q.from('products').update(payload).eq('id', product.id)
        if (err) { setError(err.message); return }
      } else {
        const { error: err } = await q.from('products').insert(payload)
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
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-[560px] bg-white shadow-2xl z-50 flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">

          {/* ── Header ──────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                {product ? 'Edit Product' : 'Add Product'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {product ? 'Update product details below' : 'Fill in the details for your new product'}
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
          <div className="flex-1 overflow-y-auto p-6 space-y-3">

            {/* Basic Info */}
            <Section title="Basic Information" open={s0} onToggle={() => setS0(v => !v)}>
              <div>
                <label className="label">
                  Product Name (English) <span className="text-red-500">*</span>
                </label>
                <input
                  className="input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Chicken Shawarma"
                />
              </div>
              <div>
                <label className="label">Product Name (Arabic)</label>
                <input
                  className="input text-right"
                  dir="rtl"
                  value={nameAr}
                  onChange={e => setNameAr(e.target.value)}
                  placeholder="اسم المنتج"
                />
              </div>
              <div>
                <label className="label">Category</label>
                <select
                  className="input"
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                >
                  <option value="">— No Category —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.icon ?? '📦'} {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Optional product description"
                />
              </div>
            </Section>

            {/* Pricing & VAT */}
            <Section title="Pricing & VAT" open={s1} onToggle={() => setS1(v => !v)}>
              <div>
                <label className="label">
                  Price (SAR) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium pointer-events-none">
                    SAR
                  </span>
                  <input
                    className="input pl-12"
                    type="number"
                    step="0.01"
                    min="0"
                    value={price}
                    onChange={e => setPrice(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="label">VAT Treatment</label>
                <div className="grid grid-cols-2 gap-2">
                  {VAT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setVatTreatment(opt.value)}
                      className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                        vatTreatment === opt.value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      <p className="text-xs font-semibold">{opt.label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            {/* Product Image */}
            <Section title="Product Image" open={s2} onToggle={() => setS2(v => !v)}>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleImageChange}
              />
              {imagePreview ? (
                <div className="relative group/img">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-full h-44 object-cover rounded-xl border border-gray-200"
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/20 rounded-xl">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="bg-white text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg shadow hover:bg-gray-50"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={() => { setImageFile(null); setImagePreview(null) }}
                      className="bg-white text-red-500 text-xs font-medium px-3 py-1.5 rounded-lg shadow hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="w-full h-36 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl hover:border-primary-400 hover:bg-primary-50/30 transition-colors group/upload"
                >
                  <ImagePlus size={24} className="text-gray-300 group-hover/upload:text-primary-400 transition-colors" />
                  <p className="text-xs text-gray-400 group-hover/upload:text-primary-500 transition-colors">
                    Click to upload image
                  </p>
                  <p className="text-[10px] text-gray-300">JPEG, PNG, WebP or GIF · max 5 MB</p>
                </button>
              )}
            </Section>

            {/* Settings */}
            <Section title="Settings" open={s3} onToggle={() => setS3(v => !v)}>
              {/* Show in POS toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Show in POS</p>
                  <p className="text-xs text-gray-400 mt-0.5">Product appears during cashier checkout</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAvailable(v => !v)}
                  className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                    isAvailable ? 'bg-primary-500' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                      isAvailable ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="label">SKU / Item Code</label>
                <input
                  className="input"
                  value={sku}
                  onChange={e => setSku(e.target.value)}
                  placeholder="e.g. PROD-001 (optional)"
                />
              </div>

              <div>
                <label className="label">Sort Order</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  value={sortOrder}
                  onChange={e => setSortOrder(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-gray-400 mt-1">Lower numbers appear first in the POS grid</p>
              </div>

              <div>
                <label className="label">Notes / Kitchen Instructions</label>
                <textarea
                  className="input resize-none"
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. allergens, preparation notes, modifiers..."
                />
              </div>
            </Section>

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
              {product ? 'Save Changes' : 'Add Product'}
            </Button>
          </div>

        </form>
      </div>
    </>
  )
}
