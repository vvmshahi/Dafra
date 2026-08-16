import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, Package, Warehouse, Users,
  CreditCard, BarChart2, Truck, Settings, Settings2, Building2,
  LogOut, ChevronRight, ChevronLeft, FileText, UserSquare2,
  Store, ShieldCheck, Printer, Loader2,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { isElectron } from '@/lib/electron'
import { isStockModuleVisible } from '@/lib/utils/businessType'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DirectionalIcon } from '@/components/localization/DirectionalIcon'
import { useLocale } from '@/localization/useLocale'
import { AuthenticatedLanguageSwitch } from '@/components/localization/AuthenticatedLanguageSwitch'
import { toast } from 'sonner'
import { useEffect, useRef, useState } from 'react'
import { resolveBusinessDisplayName } from '@/lib/utils/localizedDisplayName.mjs'
import { loadBranchCustomerCreditSettings, isCustomerCreditPolicyStorageChange, CUSTOMER_CREDIT_POLICY_CHANGED_EVENT } from '@/lib/customers/receivables'
import { useBranchBillingConfig } from '@/hooks/useBranchBillingConfig'
import { getCataloguePresentation } from '@/lib/products/cataloguePresentation'

interface NavItem {
  labelKey: string
  path: string
  icon: LucideIcon
  section?: 'daily' | 'catalogue' | 'business' | 'settings' | 'analysis' | 'administration'
}

const ownerNav: NavItem[] = [
  { labelKey: 'dashboard', path: '/dashboard', icon: LayoutDashboard, section: 'daily' },
  { labelKey: 'products', path: '/products', icon: Package, section: 'catalogue' },
  { labelKey: 'branches', path: '/branches', icon: Building2, section: 'administration' },
  { labelKey: 'employees', path: '/employees', icon: UserSquare2, section: 'administration' },
  { labelKey: 'customerCredit', path: '/reports/receivables', icon: CreditCard, section: 'business' },
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
  { labelKey: 'customerCredit', path: '/reports/receivables', icon: CreditCard, section: 'business' },
  { labelKey: 'expenses', path: '/expenses', icon: CreditCard, section: 'business' },
  { labelKey: 'branchSettings', path: '/branch-settings', icon: Settings, section: 'settings' },
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
      transition-[background-color,color,transform] duration-150 group active:scale-[0.98]
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
  const { profile, tenant, branch, user, signOut, signingOut } = useAuth()
  const location = useLocation()
  const { t } = useTranslation(['navigation', 'auth'])
  const { isRtl } = useLocale()

  const isSuperAdmin = profile?.role === 'super_admin'
  const isBranch     = profile?.role === 'branch'
  const isOwnerAdmin = profile?.role === 'owner' || profile?.role === 'admin'
  const ownerCatalogueBranchId = isOwnerAdmin
    ? new URLSearchParams(location.search).get('branch')
    : null
  const catalogueBranchId = isBranch ? branch?.id ?? null : ownerCatalogueBranchId
  const { config: catalogueBillingConfig } = useBranchBillingConfig(catalogueBranchId)
  const cataloguePresentation = getCataloguePresentation(catalogueBillingConfig)
  const [branchCreditEnabled, setBranchCreditEnabled] = useState(false)
  const stockVisible = isStockModuleVisible({
    businessType: tenant?.business_type,
    stockEnabled: branch?.stock_enabled,
  })
  useEffect(() => {
    if (!isBranch || !branch?.id) {
      setBranchCreditEnabled(false)
      return
    }
    let cancelled = false
    void loadBranchCustomerCreditSettings(branch.id)
      .then(settings => { if (!cancelled) setBranchCreditEnabled(settings.branchCreditEnabled) })
      .catch(() => { if (!cancelled) setBranchCreditEnabled(false) })
    const refresh = () => {
      void loadBranchCustomerCreditSettings(branch.id)
        .then(settings => { if (!cancelled) setBranchCreditEnabled(settings.branchCreditEnabled) })
        .catch(() => { if (!cancelled) setBranchCreditEnabled(false) })
    }
    const refreshStorage = (event: StorageEvent) => { if (isCustomerCreditPolicyStorageChange(event)) refresh() }
    window.addEventListener(CUSTOMER_CREDIT_POLICY_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refreshStorage)
    return () => {
      cancelled = true
      window.removeEventListener(CUSTOMER_CREDIT_POLICY_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', refreshStorage)
    }
  }, [branch?.id, isBranch])

  const branchNavigation = branchNav.filter(item => (
    (item.path !== '/inventory' || stockVisible)
      && (item.path !== '/reports/receivables' || branchCreditEnabled)
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
  const activeRouteRef = useRef<HTMLAnchorElement | null>(null)

  useEffect(() => {
    activeRouteRef.current?.scrollIntoView({ block: 'nearest' })
  }, [location.pathname, collapsed])

  async function handleSignOut() {
    if (signingOut) return
    const result = await signOut()
    if (result?.error) toast.error(t('auth:signOutFailure'))
  }

  function isNavActive(item: NavItem) {
    if (item.path === '/super-admin') return location.pathname === item.path
    return location.pathname.startsWith(item.path)
  }

  return (
    <aside dir={isRtl ? 'rtl' : 'ltr'} className={`
      relative flex-shrink-0 bg-sidebar flex flex-col h-full shadow-sidebar
      transition-[width] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]
      ${collapsed ? 'w-16' : 'w-[240px]'}
    `}>
      {location.pathname === '/branch' && (
        <div
          data-branch-sidebar-gold-rule
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-1 bg-gold-500"
          aria-hidden="true"
        />
      )}

      {/* Logo + toggle */}
      <div className={`pt-4 pb-3 border-b border-sidebar-border ${collapsed ? 'px-2' : 'px-4'}`}>
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
              <div className="flex h-11 w-[168px] max-w-full items-center overflow-visible">
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
      <nav
        className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto sidebar-scroll"
        aria-label={t('navigation:mainNavigation')}
      >
        {navItems.map((item, index) => {
          const isActive = isNavActive(item)
          const destination = item.path === '/products' && isOwnerAdmin && ownerCatalogueBranchId
            ? `${item.path}?branch=${encodeURIComponent(ownerCatalogueBranchId)}`
            : item.path
          const itemLabel = item.path === '/products'
            ? t(`navigation:${cataloguePresentation.navigationLabelKey}`)
            : t(`navigation:${item.labelKey}`)
          const showSection = item.section && item.section !== navItems[index - 1]?.section
          return (
            <div key={item.labelKey} className={showSection && index > 0 ? 'mt-3' : undefined}>
              {showSection && !collapsed && (
                <p className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-text/60">
                  {t(`navigation:sections.${item.section}`)}
                </p>
              )}
              {showSection && collapsed && index > 0 && <div className="mx-2 mb-2 border-t border-sidebar-border" />}
              <NavLink
                ref={isActive ? activeRouteRef : undefined}
                to={destination}
                title={collapsed ? itemLabel : undefined}
                aria-current={isActive ? 'page' : undefined}
                className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
              >
                <NavItemRow item={item} label={itemLabel} isActive={isActive} collapsed={collapsed} />
              </NavLink>
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div data-sidebar-footer className={`pb-2 pt-2 border-t border-sidebar-border space-y-0.5 ${collapsed ? 'px-2' : 'px-2.5'}`}>
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
          <div className="flex min-h-11 items-center gap-2.5 px-2.5 py-1 rounded-xl" title={`${displayName} · ${roleLabel}`}>
            <div className="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-bold">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold truncate" dir="auto">{displayName}</p>
              <p className="truncate text-sidebar-text text-[10px] capitalize">{roleLabel}{branch?.name ? ` · ${branch.name}` : ''}</p>
            </div>
          </div>
        )}

        <AuthenticatedLanguageSwitch inverse className={`w-full border-sidebar-border hover:bg-sidebar-hover ${collapsed ? 'px-1 text-[10px]' : ''}`} />

        <div className={collapsed ? 'space-y-0.5' : 'grid grid-cols-2 gap-1'}>
          <NavLink
            to="/profile"
            title={collapsed ? t('navigation:profile') : undefined}
            className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
          >
            {({ isActive }) => (
              <div className={`flex min-h-10 items-center justify-center rounded-xl px-2 text-xs font-medium transition-[background-color,color,transform] duration-150 group active:scale-[0.98] ${
                isActive ? 'bg-primary-500 text-white shadow-sm' : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
              }`}>
                <UserSquare2 size={16} className={isActive ? 'text-white' : 'group-hover:text-white'} />
                {!collapsed && <span className="ms-1.5 truncate">{t('navigation:profile')}</span>}
              </div>
            )}
          </NavLink>

          <button
            onClick={() => void handleSignOut()}
            title={collapsed ? t(signingOut ? 'auth:signingOut' : 'auth:signOut') : undefined}
            aria-label={t(signingOut ? 'auth:signingOut' : 'auth:signOut')}
            disabled={signingOut}
            className="flex min-h-10 w-full items-center justify-center rounded-xl px-2 text-xs font-medium text-sidebar-text transition-[background-color,color,transform] duration-150 hover:bg-sidebar-hover hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 disabled:cursor-wait disabled:opacity-60 active:scale-[0.98]"
          >
            {signingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
            {!collapsed && <span className="ms-1.5 truncate">{t(signingOut ? 'auth:signingOut' : 'auth:signOut')}</span>}
          </button>
        </div>
      </div>
    </aside>
  )
}
