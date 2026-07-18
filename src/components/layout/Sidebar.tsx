import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, Package, Warehouse, Users,
  CreditCard, BarChart2, Truck, Settings, Settings2, Building2,
  LogOut, ChevronRight, ChevronLeft, FileText, UserSquare2,
  Store, ShieldCheck, Printer,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { isElectron } from '@/lib/electron'
import { isStockModuleVisible } from '@/lib/utils/businessType'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DirectionalIcon } from '@/components/localization/DirectionalIcon'

interface NavItem {
  label: string
  translationKey?: 'dashboard' | 'newSale' | 'invoices' | 'products' | 'customers' | 'suppliers' | 'expenses' | 'reports' | 'settings'
  path: string
  icon: LucideIcon
  section?: 'Daily work' | 'Catalogue and stock' | 'Business' | 'Settings' | 'Analysis' | 'Administration'
}

const ownerNav: NavItem[] = [
  { label: 'Dashboard', translationKey: 'dashboard', path: '/dashboard', icon: LayoutDashboard, section: 'Daily work' },
  { label: 'Branches',  path: '/branches',  icon: Building2,       section: 'Administration' },
  { label: 'Employees', path: '/employees', icon: UserSquare2,     section: 'Administration' },
  { label: 'ZATCA',     path: '/zatca',     icon: ShieldCheck,     section: 'Settings' },
  { label: 'Settings', translationKey: 'settings', path: '/settings', icon: Settings, section: 'Settings' },
  { label: 'Reports', translationKey: 'reports', path: '/reports', icon: BarChart2, section: 'Analysis' },
]

const branchNav: NavItem[] = [
  { label: 'Dashboard', translationKey: 'dashboard', path: '/branch', icon: Store, section: 'Daily work' },
  { label: 'New Sale', translationKey: 'newSale', path: '/pos', icon: Receipt, section: 'Daily work' },
  { label: 'Invoices', translationKey: 'invoices', path: '/invoices', icon: FileText, section: 'Daily work' },
  { label: 'Products', translationKey: 'products', path: '/products', icon: Package, section: 'Catalogue and stock' },
  { label: 'Stock',            path: '/inventory',         icon: Warehouse,   section: 'Catalogue and stock' },
  { label: 'Purchases',        path: '/purchases',         icon: Truck,       section: 'Catalogue and stock' },
  { label: 'Suppliers', translationKey: 'suppliers', path: '/suppliers', icon: Truck, section: 'Catalogue and stock' },
  { label: 'Customers', translationKey: 'customers', path: '/customers', icon: Users, section: 'Business' },
  { label: 'Expenses', translationKey: 'expenses', path: '/expenses', icon: CreditCard, section: 'Business' },
  { label: 'Invoice Settings', path: '/invoice-settings',  icon: Settings2,   section: 'Settings' },
  { label: 'Reports', translationKey: 'reports', path: '/reports', icon: BarChart2, section: 'Analysis' },
]

const branchDevicePrinterNavItem: NavItem = {
  label: 'Device Printer',
  path: '/device-printer',
  icon: Printer,
  section: 'Settings',
}

const superAdminNav: NavItem[] = [
  { label: 'Overview',      path: '/super-admin',               icon: LayoutDashboard },
  { label: 'Clients',       path: '/super-admin/clients',       icon: Building2       },
  { label: 'Subscriptions', path: '/super-admin/subscriptions', icon: CreditCard      },
  { label: 'Settings',      path: '/super-admin/settings',      icon: Settings        },
]

const operationsNavItem: NavItem = {
  label: 'Operations',
  path: '/operations',
  icon: ShieldCheck,
  section: 'Administration',
}

const operationsRoles = new Set(['owner', 'admin', 'super_admin'])

const KUBRI_WORDMARK_SRC = '/brand/kubiri-wordmark.png?v=kubri-2'
const KUBRI_MARK_SRC = '/brand/kubiri-logo-mark.png?v=kubri-2'

interface NavItemRowProps {
  item: NavItem
  label: string
  isActive: boolean
  collapsed: boolean
}

function NavItemRow({ item, label, isActive, collapsed }: NavItemRowProps) {
  return (
    <div className={`
      flex items-center rounded-xl text-sm font-medium
      transition-all duration-150 group
      ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
      ${isActive
        ? 'bg-primary-500 text-white shadow-sm'
        : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
      }
    `}>
      <item.icon
        size={17}
        className={isActive ? 'text-white' : 'text-sidebar-text group-hover:text-white'}
      />
      {!collapsed && <span className="flex-1 text-start">{label}</span>}
      {!collapsed && isActive && <DirectionalIcon icon={ChevronRight} size={14} className="text-white/60" />}
    </div>
  )
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { profile, tenant, branch, user, signOut } = useAuth()
  const location = useLocation()
  const { t } = useTranslation(['navigation', 'auth'])

  const isSuperAdmin = profile?.role === 'super_admin'
  const isBranch     = profile?.role === 'branch'
  const canViewOperations = operationsRoles.has(String(profile?.role ?? ''))
  const stockVisible = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: branch?.stock_enabled,
  })
  const branchNavigation = branchNav.filter(item => (
    item.path !== '/inventory' || stockVisible
  ))

  const navItems = isSuperAdmin
    ? [...superAdminNav, operationsNavItem]
    : isBranch
      ? isElectron()
        ? [
            ...branchNavigation.filter(item => item.section !== 'Analysis'),
            branchDevicePrinterNavItem,
            ...branchNavigation.filter(item => item.section === 'Analysis'),
          ]
        : branchNavigation
      : canViewOperations
        ? [
            ...ownerNav.filter(item => item.section !== 'Settings' && item.section !== 'Analysis'),
            operationsNavItem,
            ...ownerNav.filter(item => item.section === 'Settings'),
            ...ownerNav.filter(item => item.section === 'Analysis'),
          ]
        : ownerNav
  const subtitle = isSuperAdmin ? 'Kubri Super Admin' : (tenant?.name ?? 'Kubri')
  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? 'User'
  const roleLabel = isBranch ? 'Branch' : (profile?.role?.replace(/_/g, ' ') ?? '')

  function isNavActive(item: NavItem) {
    if (item.path === '/super-admin') return location.pathname === item.path
    return location.pathname.startsWith(item.path)
  }

  return (
    <aside className={`
      flex-shrink-0 bg-sidebar flex flex-col h-full shadow-sidebar
      transition-all duration-200 ease-in-out
      ${collapsed ? 'w-16' : 'w-[240px]'}
    `}>

      {/* Logo + toggle */}
      <div className={`pt-6 pb-4 border-b border-sidebar-border ${collapsed ? 'px-2' : 'px-5'}`}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center">
              <img src={KUBRI_MARK_SRC} alt="Kubri" className="w-8 h-8 object-contain" />
            </div>
            <button
              onClick={onToggle}
              title="Expand sidebar"
              className="text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors p-1.5 rounded-lg"
            >
              <DirectionalIcon icon={ChevronRight} size={15} />
            </button>
          </div>
        ) : (
          <div className="relative">
            <div className="pe-8">
              <div className="flex h-14 w-[184px] max-w-full items-center overflow-visible">
                <img src={KUBRI_WORDMARK_SRC} alt="Kubri" className="h-full w-full object-contain object-start" />
              </div>
              <p className="mt-1 text-xs text-sidebar-text truncate" title={subtitle}>{subtitle}</p>
            </div>
            <button
              onClick={onToggle}
              title="Collapse sidebar"
              className="absolute end-0 top-2 text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors p-1.5 rounded-lg"
            >
              <DirectionalIcon icon={ChevronLeft} size={15} />
            </button>
            {isSuperAdmin && (
              <div className="mt-3 inline-flex items-center gap-1.5 bg-red-900/40 text-red-300 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-red-700/50">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                SUPER ADMIN
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto sidebar-scroll">
        {navItems.map((item, index) => {
          const isActive = isNavActive(item)
          const itemLabel = item.translationKey ? t(`navigation:${item.translationKey}`) : item.label
          const showSection = item.section && item.section !== navItems[index - 1]?.section
          return (
            <div key={item.label} className={showSection && index > 0 ? 'mt-3' : undefined}>
              {showSection && !collapsed && (
                <p className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-text/60">
                  {item.section}
                </p>
              )}
              {showSection && collapsed && index > 0 && <div className="mx-2 mb-2 border-t border-sidebar-border" />}
              <NavLink to={item.path} title={collapsed ? itemLabel : undefined}>
                <NavItemRow item={item} label={itemLabel} isActive={isActive} collapsed={collapsed} />
              </NavLink>
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className={`pb-4 pt-3 border-t border-sidebar-border space-y-1 ${collapsed ? 'px-2' : 'px-3'}`}>
        {/* User identity */}
        {collapsed ? (
          <div className="flex justify-center py-1">
            <div className="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center">
              <span className="text-white text-xs font-bold">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
            <div className="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold truncate">{displayName}</p>
              <p className="text-sidebar-text text-[10px] capitalize">{roleLabel}</p>
            </div>
          </div>
        )}

        {/* Profile */}
        <NavLink to="/profile" title={collapsed ? 'Profile' : undefined}>
          {({ isActive }) => (
            <div className={`
              flex items-center rounded-xl text-sm font-medium
              transition-all duration-150 group
              ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
              ${isActive
                ? 'bg-primary-500 text-white shadow-sm'
                : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
              }
            `}>
              <UserSquare2 size={16} className={isActive ? 'text-white' : 'group-hover:text-white'} />
              {!collapsed && 'Profile'}
            </div>
          )}
        </NavLink>

        {/* Sign out */}
        <button
          onClick={signOut}
          title={collapsed ? t('auth:signOut') : undefined}
          className={`
            flex items-center w-full rounded-xl text-sidebar-text
            hover:bg-sidebar-hover hover:text-white text-sm font-medium
            transition-all duration-150 group
            ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
        >
          <LogOut size={16} className="group-hover:text-white" />
          {!collapsed && t('auth:signOut')}
        </button>
      </div>
    </aside>
  )
}
