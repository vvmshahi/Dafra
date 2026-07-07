import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AlertTriangle, MessageCircle } from 'lucide-react'
import Sidebar from './Sidebar'
import { useAuth } from '@/hooks/useAuth'
import { useSubscription } from '@/hooks/useSubscription'
import { supportConfig } from '@/config/support'

const WA_LINK = supportConfig.whatsappLink

function SubscriptionBanner() {
  const { profile } = useAuth()
  const sub = useSubscription()

  const isTenantUser = !!profile && profile.role !== 'super_admin'
  const isOwner = isTenantUser && profile.role !== 'branch'

  if (!isTenantUser || sub.status === 'loading') return null

  if (sub.status === 'suspended') {
    return (
      <div className="flex items-center gap-3 bg-red-700 text-white px-4 py-2.5 text-sm flex-shrink-0">
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className="flex-1">
          Account suspended. New billing and register opening are disabled. Existing invoices and reports remain available.
        </span>
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          <MessageCircle size={13} /> Contact Us
        </a>
      </div>
    )
  }

  if (!isOwner || sub.isLifetimeFree) return null

  if (sub.status === 'grace_period') {
    return (
      <div className="flex items-center gap-3 bg-amber-600 text-white px-4 py-2.5 text-sm flex-shrink-0">
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className="flex-1">
          Grace period active. Billing remains available unless the account is suspended.
        </span>
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          <MessageCircle size={13} /> Contact Us
        </a>
      </div>
    )
  }

  if (sub.showWarning) {
    return (
      <div className="flex items-center gap-3 bg-amber-500 text-white px-4 py-2.5 text-sm flex-shrink-0">
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className="flex-1">
          Payment is due soon. Please contact Kubri support if payment is already completed.
        </span>
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          <MessageCircle size={13} /> Renew Now
        </a>
      </div>
    )
  }

  if (sub.status === 'expired') {
    return (
      <div className="flex items-center gap-3 bg-amber-600 text-white px-4 py-2.5 text-sm flex-shrink-0">
        <AlertTriangle size={15} className="flex-shrink-0" />
        <span className="flex-1">
          Payment is overdue. Billing remains available during pilot unless the account is suspended.
        </span>
        <a
          href={WA_LINK}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
        >
          <MessageCircle size={13} /> Contact Us
        </a>
      </div>
    )
  }

  return null
}

function getInitialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem('meem-sidebar-collapsed')
    if (saved !== null) return saved === 'true'
  } catch {}
  return window.matchMedia('(max-width: 767px)').matches
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed)
  const location = useLocation()
  const flushContent = location.pathname === '/branch'

  function toggle() {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('meem-sidebar-collapsed', String(next)) } catch {}
      return next
    })
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <div className="flex-1 flex flex-col min-w-0">
        <SubscriptionBanner />
        <main className={`flex-1 overflow-y-auto ${flushContent ? 'p-0' : 'p-6'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
