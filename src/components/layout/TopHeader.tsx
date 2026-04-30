import { useLocation, useNavigate } from 'react-router-dom'
import { Bell, Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

const titles: Record<string, string> = {
  '/dashboard':                 'Dashboard',
  '/pos':                       'Point of Sale',
  '/products':                  'Products',
  '/inventory':                 'Inventory',
  '/customers':                 'Customers',
  '/expenses':                  'Expenses',
  '/reports':                   'Reports',
  '/suppliers':                 'Suppliers',
  '/settings':                  'Settings',
  '/super-admin':               'Platform Overview',
  '/super-admin/clients':       'Clients',
  '/super-admin/subscriptions': 'Subscriptions',
  '/super-admin/settings':      'Settings',
  '/employees':                 'Employees',
  '/profile':                   'My Profile',
  '/invoices':                  'Invoices',
  '/day-closing':               'Day Closing',
}

export default function TopHeader() {
  const location = useLocation()
  const { profile, tenant, user } = useAuth()

  const navigate = useNavigate()
  const title   = titles[location.pathname] ?? 'Dafra'

  // Subtitle: tenant business name for regular users, empty for super admin
  const isSuperAdmin = profile?.role === 'super_admin'
  const subtitle     = !isSuperAdmin && tenant?.name ? tenant.name : null

  // Avatar initials: full_name → email prefix → 'U'
  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? 'U'

  return (
    <header className="h-14 flex-shrink-0 bg-white border-b border-gray-100 flex items-center px-6 gap-4">

      {/* Page title + tenant subtitle */}
      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-semibold text-gray-900 leading-none">{title}</h1>
        {subtitle && (
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>

      {/* Search */}
      <button className="hidden md:flex items-center gap-2 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2 hover:border-gray-300 transition-colors w-52 flex-shrink-0">
        <Search size={14} />
        <span>Search...</span>
        <span className="ml-auto text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-mono">⌘K</span>
      </button>

      {/* Notifications */}
      <button className="relative w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors flex-shrink-0">
        <Bell size={17} />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
      </button>

      {/* Avatar — navigates to profile */}
      <button
        onClick={() => navigate('/profile')}
        title="My Profile"
        className="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center flex-shrink-0 hover:bg-primary-600 transition-colors"
      >
        <span className="text-white text-xs font-bold">
          {displayName.charAt(0).toUpperCase()}
        </span>
      </button>
    </header>
  )
}
