import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AlertTriangle, MessageCircle } from 'lucide-react'
import Sidebar from './Sidebar'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { supportConfig } from '@/config/support'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/localization/useLocale'

const WA_LINK = supportConfig.whatsappLink
const subscriptionBannerClass = 'flex shrink-0 flex-wrap items-center gap-2.5 px-4 py-2.5 text-sm sm:flex-nowrap'
const subscriptionMessageClass = 'min-w-0 flex-[1_1_180px] [overflow-wrap:anywhere]'
const subscriptionActionClass = 'ms-auto flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30'

function SubscriptionBanner() {
  const { profile } = useAuth()
  const sub = useSubscription()
  const { t } = useTranslation('common')

  const isTenantUser = !!profile && profile.role !== 'super_admin'
  const isOwner = isTenantUser && profile.role !== 'branch'

  if (!isTenantUser || sub.status === 'loading') return null

  if (sub.status === 'suspended') {
    return (
      <div className={`${subscriptionBannerClass} bg-red-700 text-white`}>
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className={subscriptionMessageClass}>
          {t('subscription.suspended')}
        </span>
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className={subscriptionActionClass}
        >
          <MessageCircle size={13} /> {t('contactUs')}
        </a>
      </div>
    )
  }

  if (!isOwner || sub.isLifetimeFree) return null

  if (sub.status === 'grace_period') {
    return (
      <div className={`${subscriptionBannerClass} bg-amber-600 text-white`}>
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className={subscriptionMessageClass}>
          {t('subscription.gracePeriod')}
        </span>
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className={subscriptionActionClass}
        >
          <MessageCircle size={13} /> {t('contactUs')}
        </a>
      </div>
    )
  }

  if (sub.showWarning) {
    return (
      <div className={`${subscriptionBannerClass} bg-amber-500 text-white`}>
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className={subscriptionMessageClass}>
          {t('subscription.dueSoon')}
        </span>
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className={subscriptionActionClass}
        >
          <MessageCircle size={13} /> {t('renewNow')}
        </a>
      </div>
    )
  }

  if (sub.status === 'expired') {
    return (
      <div className={`${subscriptionBannerClass} bg-amber-600 text-white`}>
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className={subscriptionMessageClass}>
          {t('subscription.overdue')}
        </span>
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className={subscriptionActionClass}
        >
          <MessageCircle size={13} /> {t('contactUs')}
        </a>
      </div>
    )
  }

  return null
}

function getInitialCollapsed(): boolean {
  // Compact is the application baseline; tablet follows it too. An explicit
  // local user choice still takes precedence after the first interaction.
  if (window.matchMedia('(max-width: 1023px)').matches) return true
  try {
    const saved = localStorage.getItem('meem-sidebar-collapsed')
    if (saved !== null) return saved === 'true'
  } catch {}
  return true
}

export default function AppLayout() {
  const { isRtl } = useLocale()
  const { t } = useTranslation('common')
  const [collapsed, setCollapsed] = useState(getInitialCollapsed)
  const location = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const flushContent = location.pathname === '/branch'
  const ownsInnerScroll = location.pathname === '/invoice-settings'

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  function toggle() {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('meem-sidebar-collapsed', String(next)) } catch {}
      return next
    })
  }

  return (
    <div
      className="flex h-screen bg-gray-50 overflow-hidden"
      dir="ltr"
      style={{ '--app-sidebar-width': collapsed ? '64px' : '240px' } as CSSProperties}
    >
      <a
        href="#main-content"
        dir={isRtl ? 'rtl' : 'ltr'}
        className="fixed start-3 top-3 z-[100] -translate-y-20 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-primary-800 shadow-card-lg transition-transform focus:translate-y-0"
      >
        {t('skipToContent')}
      </a>
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex-1 flex flex-col min-w-0" dir={isRtl ? 'rtl' : 'ltr'}>
        <SubscriptionBanner />
        <main
          ref={mainRef}
          id="main-content"
          tabIndex={-1}
          className={`min-h-0 flex-1 outline-none ${ownsInnerScroll ? 'overflow-hidden' : 'overflow-y-auto'} ${flushContent ? 'p-0' : 'px-4 py-5 sm:p-6'}`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
