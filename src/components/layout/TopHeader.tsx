import { useLocation } from 'react-router-dom'
import { Bell, Search } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'

const titles: Record<string, string> = {
  '/dashboard':               'Dashboard',
  '/pos':                     'Point of Sale',
  '/products':                'Products',
  '/inventory':               'Inventory',
  '/customers':               'Customers',
  '/expenses':                'Expenses',
  '/reports':                 'Reports',
  '/suppliers':               'Suppliers',
  '/settings':                'Settings',
  '/super-admin':             'Platform Overview',
  '/super-admin/tenants':     'Tenants',
  '/super-admin/subscriptions': 'Subscriptions',
  '/super-admin/system':      'System',
  '/super-admin/settings':    'Settings',
}

export default function TopHeader() {
  const location = useLocation()
  const { profile } = useAuth()
  const title = titles[location.pathname] ?? 'Dafra'

  return (
    <header className="h-14 flex-shrink-0 bg-white border-b border-gray-100 flex items-center px-6 gap-4">

      {/* Page title */}
      <div className="flex-1">
        <h1 className="text-sm font-semibold text-gray-900">{title}</h1>
      </div>

      {/* Search */}
      <button className="hidden md:flex items-center gap-2 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2 hover:border-gray-300 transition-colors w-52">
        <Search size={14} />
        <span>Search...</span>
        <span className="ml-auto text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-mono">⌘K</span>
      </button>

      {/* Notifications */}
      <button className="relative w-9 h-9 flex items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors">
        <Bell size={17} />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
      </button>

      {/* Avatar */}
      <div className="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center flex-shrink-0 cursor-pointer hover:bg-primary-600 transition-colors">
        <span className="text-white text-xs font-bold">
          {(profile?.full_name ?? 'U').charAt(0).toUpperCase()}
        </span>
      </div>
    </header>
  )
}
