import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Search, SmilePlus, X } from 'lucide-react'
import type { EmojiClickData, EmojiStyle } from 'emoji-picker-react'
import { useTranslation } from 'react-i18next'

const EmojiPicker = lazy(() => import('emoji-picker-react'))
const RECENT_KEY = 'kubri:recent-category-emojis'
const RECENT_LIMIT = 16

const BUSINESS_SUGGESTIONS: Array<{ terms: string[]; emojis: string[] }> = [
  { terms: ['burger', 'burgers', 'sandwich'], emojis: ['🍔'] },
  { terms: ['coffee', 'cafe', 'café'], emojis: ['☕', '🫘'] },
  { terms: ['water'], emojis: ['💧', '🚰'] },
  { terms: ['juice', 'drinks', 'beverage'], emojis: ['🧃', '🥤'] },
  { terms: ['clothing', 'clothes', 'shirt', 'fashion'], emojis: ['👕', '👗'] },
  { terms: ['electronics', 'phone', 'mobile', 'computer'], emojis: ['📱', '💻', '🔌'] },
  { terms: ['car', 'auto', 'automotive'], emojis: ['🚗', '🛞'] },
  { terms: ['tools', 'hardware'], emojis: ['🛠️', '🔩'] },
  { terms: ['medicine', 'medical', 'pharmacy'], emojis: ['💊', '🩺'] },
  { terms: ['cake', 'bakery', 'dessert'], emojis: ['🍰', '🧁'] },
  { terms: ['beauty', 'cosmetic', 'salon'], emojis: ['💄', '✨'] },
  { terms: ['stationery', 'office', 'school'], emojis: ['✏️', '📚'] },
  { terms: ['home', 'household', 'furniture'], emojis: ['🏠', '🛋️'] },
  { terms: ['service', 'services'], emojis: ['🤝', '🛠️'] },
]

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

interface Props {
  value: string
  categoryName?: string
  onChange: (emoji: string) => void
}

export function CategoryEmojiPicker({ value, categoryName = '', onChange }: Props) {
  const { t } = useTranslation('products')
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>(readRecent)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const suggestions = useMemo(() => {
    const name = categoryName.trim().toLowerCase()
    if (!name) return []
    return [...new Set(BUSINESS_SUGGESTIONS
      .filter(group => group.terms.some(term => name.includes(term)))
      .flatMap(group => group.emojis))]
  }, [categoryName])

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const select = (emoji: string) => {
    onChange(emoji)
    const next = [emoji, ...recent.filter(item => item !== emoji)].slice(0, RECENT_LIMIT)
    setRecent(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
    close()
  }

  const handleEmojiClick = (data: EmojiClickData) => select(data.emoji)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-2xl"
          aria-live="polite" aria-label={value ? t('emoji.selected', { emoji: value }) : t('emoji.noneSelected')}>
          {value || <span className="text-sm text-gray-300">{t('emoji.none')}</span>}
        </div>
        <button ref={triggerRef} type="button" onClick={() => setOpen(true)}
          aria-haspopup="dialog" aria-expanded={open} aria-label={t('emoji.choose')}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:border-primary-300 hover:bg-primary-50/40 active:scale-[0.97]">
          <SmilePlus size={16} /> {t('emoji.choose')}
        </button>
        {value && (
          <button type="button" onClick={() => onChange('')}
            className="text-xs font-medium text-gray-400 hover:text-red-500" aria-label={t('emoji.remove')}>
            {t('emoji.noIcon')}
          </button>
        )}
      </div>

      {suggestions.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-gray-400">{t('emoji.suggested')}</p>
          <div className="flex gap-1.5">
            {suggestions.map(emoji => (
              <button key={emoji} type="button" onClick={() => select(emoji)}
                aria-label={t('emoji.useSuggested', { emoji })}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-100 bg-white text-lg hover:border-primary-300 hover:bg-primary-50 active:scale-[0.97]">
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-3" role="presentation"
          onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
          <section role="dialog" aria-modal="true" aria-label={t('emoji.choose')}
            className="w-full max-w-[390px] overflow-hidden rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{t('emoji.choose')}</h3>
                <p className="text-[11px] text-gray-400">{t('emoji.searchHelp')}</p>
              </div>
              <button type="button" onClick={close} aria-label={t('emoji.close')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X size={16} />
              </button>
            </div>

            {recent.length > 0 && (
              <div className="mb-2 rounded-xl bg-gray-50 p-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('emoji.recent')}</p>
                <div className="flex flex-wrap gap-1">
                  {recent.map(emoji => (
                    <button key={emoji} type="button" onClick={() => select(emoji)}
                      aria-label={t('emoji.useRecent', { emoji })}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-white active:scale-[0.97]">
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Suspense fallback={
              <div className="flex h-[420px] items-center justify-center text-sm text-gray-400">
                <Search size={16} className="me-2" /> {t('emoji.loading')}
              </div>
            }>
              <EmojiPicker
                onEmojiClick={handleEmojiClick}
                emojiStyle={'native' as EmojiStyle}
                width="100%"
                height={420}
                lazyLoadEmojis
                previewConfig={{ showPreview: false }}
                searchPlaceHolder={t('emoji.search')}
              />
            </Suspense>
            <button type="button" onClick={() => { onChange(''); close() }}
              className="mt-2 w-full rounded-lg py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700">
              {t('emoji.noIcon')}
            </button>
          </section>
        </div>
      )}
    </div>
  )
}
