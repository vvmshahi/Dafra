import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, Package, Warehouse, Users,
  CreditCard, BarChart2, Truck, Settings, Building2,
  Server, LogOut, ChevronRight,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  label: string
  labelAr: string
  path: string
  icon: LucideIcon
}

const adminNav: NavItem[] = [
  { label: 'Dashboard',   labelAr: 'الرئيسية',    path: '/dashboard',  icon: LayoutDashboard },
  { label: 'New Invoice', labelAr: 'فاتورة جديدة', path: '/pos',        icon: Receipt },
  { label: 'Products',    labelAr: 'المنتجات',     path: '/products',   icon: Package },
  { label: 'Inventory',   labelAr: 'المخزون',      path: '/inventory',  icon: Warehouse },
  { label: 'Customers',   labelAr: 'العملاء',      path: '/customers',  icon: Users },
  { label: 'Expenses',    labelAr: 'المصروفات',    path: '/expenses',   icon: CreditCard },
  { label: 'Reports',     labelAr: 'التقارير',     path: '/reports',    icon: BarChart2 },
  { label: 'Suppliers',   labelAr: 'الموردون',     path: '/suppliers',  icon: Truck },
  { label: 'Settings',    labelAr: 'الإعدادات',    path: '/settings',   icon: Settings },
]

const superAdminNav: NavItem[] = [
  { label: 'Overview',       labelAr: 'نظرة عامة',   path: '/super-admin',               icon: LayoutDashboard },
  { label: 'Tenants',        labelAr: 'العملاء',      path: '/super-admin/tenants',       icon: Building2 },
  { label: 'Subscriptions',  labelAr: 'الاشتراكات',  path: '/super-admin/subscriptions', icon: CreditCard },
  { label: 'System',         labelAr: 'النظام',       path: '/super-admin/system',        icon: Server },
  { label: 'Settings',       labelAr: 'الإعدادات',    path: '/super-admin/settings',      icon: Settings },
]

function NavItemRow({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <div className={`
      flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
      transition-all duration-150 group
      ${isActive
        ? 'bg-primary-500 text-white shadow-sm'
        : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
      }
    `}>
      <item.icon size={17} className={isActive ? 'text-white' : 'text-sidebar-text group-hover:text-white'} />
      <span className="flex-1">{item.label}</span>
      {isActive && <ChevronRight size={14} className="text-white/60" />}
    </div>
  )
}

export default function Sidebar() {
  const { profile, signOut } = useAuth()
  const location = useLocation()

  const isSuperAdmin = profile?.role === 'super_admin'
  const navItems     = isSuperAdmin ? superAdminNav : adminNav

  return (
    <aside className="w-[240px] flex-shrink-0 bg-sidebar flex flex-col h-full shadow-sidebar">

      {/* Logo */}
      <div className="px-5 pt-6 pb-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold-500 flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-sidebar font-black text-base leading-none">د</span>
          </div>
          <div>
            <p className="text-white font-bold text-xl leading-none tracking-tight" style={{ fontFamily: 'Cairo, sans-serif' }}>
              دفرة
            </p>
            <p className="text-sidebar-text text-xs mt-0.5">Dafra Platform</p>
          </div>
        </div>
        {isSuperAdmin && (
          <div className="mt-3 inline-flex items-center gap-1.5 bg-red-900/40 text-red-300 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-red-700/50">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            SUPER ADMIN
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto sidebar-scroll">
        {navItems.map(item => {
          const isActive = item.path === '/super-admin'
            ? location.pathname === item.path
            : location.pathname.startsWith(item.path)
          return (
            <NavLink key={item.path} to={item.path}>
              <NavItemRow item={item} isActive={isActive} />
            </NavLink>
          )
        })}
      </nav>

      {/* User profile */}
      <div className="px-3 pb-4 pt-3 border-t border-sidebar-border space-y-1">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
          <div className="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">
              {(profile?.full_name ?? 'U').charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate">
              {profile?.full_name ?? 'User'}
            </p>
            <p className="text-sidebar-text text-[10px] capitalize">{profile?.role?.replace('_', ' ')}</p>
          </div>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sidebar-text hover:bg-sidebar-hover hover:text-white text-sm font-medium transition-all duration-150 group"
        >
          <LogOut size={16} className="group-hover:text-white" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
