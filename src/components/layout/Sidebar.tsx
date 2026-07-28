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
import { useLocale } from '@/localization/useLocale'
import { AuthenticatedLanguageSwitch } from '@/components/localization/AuthenticatedLanguageSwitch'
import { resolveBusinessDisplayName } from '@/lib/utils/localizedDisplayName.mjs'

interface NavItem {
  labelKey: string
  path: string
  icon: LucideIcon
  section?: 'daily' | 'catalogue' | 'business' | 'settings' | 'analysis' | 'administration'
}

const ownerNav: NavItem[] = [
  { labelKey: 'dashboard', path: '/dashboard', icon: LayoutDashboard, section: 'daily' },
  { labelKey: 'branches', path: '/branches', icon: Building2, section: 'administration' },
  { labelKey: 'employees', path: '/employees', icon: UserSquare2, section: 'administration' },
  { labelKey: 'zatca', path: '/zatca', icon: ShieldCheck, section: 'settings' },
  { labelKey: 'settings', path: '/settings', icon: Settings, section: 'settings' },
  { labelKey: 'reports', path: '/reports', icon: BarChart2, section: 'analysis' },
]

const branchNav: NavItem[] = [
  { labelKey: 'dashboard', path: '/branch', icon: Store, section: 'daily' },
  { labelKey: 'newSale', path: '/pos', icon: Receipt, section: 'daily' },
  { labelKey: 'invoices', path: '/invoices', icon: FileText, section: 'daily' },
  { labelKey: 'products', path: '/products', icon: Package, section: 'catalogue' },
  { labelKey: 'stock', path: '/inventory', icon: Warehouse, section: 'catalogue' },
  { labelKey: 'purchases', path: '/purchases', icon: Truck, section: 'catalogue' },
  { labelKey: 'suppliers', path: '/suppliers', icon: Truck, section: 'catalogue' },
  { labelKey: 'customers', path: '/customers', icon: Users, section: 'business' },
  { labelKey: 'expenses', path: '/expenses', icon: CreditCard, section: 'business' },
  { labelKey: 'invoiceSettings', path: '/invoice-settings', icon: Settings2, section: 'settings' },
  { labelKey: 'reports', path: '/reports', icon: BarChart2, section: 'analysis' },
]

const branchDevicePrinterNavItem: NavItem = {
  labelKey: 'devicePrinter',
  path: '/device-printer',
  icon: Printer,
  section: 'settings',
}

const superAdminNav: NavItem[] = [
  { labelKey: 'overview', path: '/super-admin', icon: LayoutDashboard },
  { labelKey: 'clients', path: '/super-admin/clients', icon: Building2 },
  { labelKey: 'subscriptions', path: '/super-admin/subscriptions', icon: CreditCard },
  { labelKey: 'settings', path: '/super-admin/settings', icon: Settings },
]

const operationsNavItem: NavItem = {
  labelKey: 'operations',
  path: '/operations',
  icon: ShieldCheck,
  section: 'administration',
}

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
  const { isRtl } = useLocale()

  const isSuperAdmin = profile?.role === 'super_admin'
  const isBranch     = profile?.role === 'branch'
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
            ...branchNavigation.filter(item => item.section !== 'analysis'),
            branchDevicePrinterNavItem,
            ...branchNavigation.filter(item => item.section === 'analysis'),
          ]
        : branchNavigation
      : ownerNav
  const subtitle = isSuperAdmin
    ? `Kubri ${t('navigation:roles.superAdmin')}`
    : resolveBusinessDisplayName(tenant, isRtl, 'Kubri')
  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? t('navigation:roles.user')
  const roleKey = profile?.role === 'super_admin' ? 'superAdmin' : String(profile?.role ?? 'user')
  const roleLabel = t(`navigation:roles.${roleKey}`)

  function isNavActive(item: NavItem) {
    if (item.path === '/super-admin') return location.pathname === item.path
    return location.pathname.startsWith(item.path)
  }

  return (
    <aside dir={isRtl ? 'rtl' : 'ltr'} className={`
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
              title={t('navigation:expandSidebar')}
              aria-label={t('navigation:expandSidebar')}
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
              <p className="mt-1 text-xs text-sidebar-text truncate" title={subtitle} dir="auto">{subtitle}</p>
            </div>
            <button
              onClick={onToggle}
              title={t('navigation:collapseSidebar')}
              aria-label={t('navigation:collapseSidebar')}
              className="absolute end-0 top-2 text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors p-1.5 rounded-lg"
            >
              <DirectionalIcon icon={ChevronLeft} size={15} />
            </button>
            {isSuperAdmin && (
              <div className="mt-3 inline-flex items-center gap-1.5 bg-red-900/40 text-red-300 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-red-700/50">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                {t('navigation:roles.superAdmin')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto sidebar-scroll">
        {navItems.map((item, index) => {
          const isActive = isNavActive(item)
          const itemLabel = t(`navigation:${item.labelKey}`)
          const showSection = item.section && item.section !== navItems[index - 1]?.section
          return (
            <div key={item.labelKey} className={showSection && index > 0 ? 'mt-3' : undefined}>
              {showSection && !collapsed && (
                <p className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-text/60">
                  {t(`navigation:sections.${item.section}`)}
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
              <p className="text-white text-xs font-semibold truncate" dir="auto">{displayName}</p>
              <p className="text-sidebar-text text-[10px] capitalize">{roleLabel}</p>
            </div>
          </div>
        )}

        {/* Profile */}
        <NavLink to="/profile" title={collapsed ? t('navigation:profile') : undefined}>
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
              {!collapsed && t('navigation:profile')}
            </div>
          )}
        </NavLink>

        <AuthenticatedLanguageSwitch inverse className={`w-full border-sidebar-border hover:bg-sidebar-hover ${collapsed ? 'px-1 text-[10px]' : ''}`} />

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
