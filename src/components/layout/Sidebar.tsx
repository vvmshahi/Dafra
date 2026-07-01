import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, Package, Warehouse, Users,
  CreditCard, BarChart2, Truck, Settings, Settings2, Building2,
  LogOut, ChevronRight, ChevronLeft, FileText, UserSquare2,
  Store, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  label: string
  path: string
  icon: LucideIcon
}

const ownerNav: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { label: 'Employees', path: '/employees', icon: UserSquare2     },
  { label: 'Reports',   path: '/reports',   icon: BarChart2       },
  { label: 'Settings',  path: '/settings',  icon: Settings        },
]

const branchNav: NavItem[] = [
  { label: 'Dashboard',   path: '/branch',      icon: Store          },
  { label: 'New Sale',    path: '/pos',          icon: Receipt        },
  { label: 'Invoices',         path: '/invoices',          icon: FileText   },
  { label: 'Invoice Settings', path: '/invoice-settings',  icon: Settings2  },
  { label: 'Products',         path: '/products',          icon: Package    },
  { label: 'Stock',       path: '/inventory?tab=stock',     icon: Warehouse      },
  { label: 'Purchases',   path: '/inventory?tab=purchases', icon: Truck          },
  { label: 'Customers',   path: '/customers',    icon: Users          },
  { label: 'Expenses',    path: '/expenses',     icon: CreditCard     },
  { label: 'Suppliers',   path: '/suppliers',    icon: Truck          },
  { label: 'Reports',     path: '/reports',      icon: BarChart2      },
]

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
}

const operationsRoles = new Set(['owner', 'admin', 'super_admin'])

interface NavItemRowProps {
  item: NavItem
  isActive: boolean
  collapsed: boolean
}

function NavItemRow({ item, isActive, collapsed }: NavItemRowProps) {
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
      {!collapsed && <span className="flex-1">{item.label}</span>}
      {!collapsed && isActive && <ChevronRight size={14} className="text-white/60" />}
    </div>
  )
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { profile, tenant, user, signOut } = useAuth()
  const location = useLocation()

  const isSuperAdmin = profile?.role === 'super_admin'
  const isBranch     = profile?.role === 'branch'
  const canViewOperations = operationsRoles.has(String(profile?.role ?? ''))

  const navItems = isSuperAdmin
    ? [...superAdminNav, operationsNavItem]
    : isBranch
      ? branchNav
      : canViewOperations
        ? [...ownerNav, operationsNavItem]
        : ownerNav
  const subtitle = isSuperAdmin ? 'Super Admin Console' : (tenant?.name ?? 'Meem Platform')
  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? 'User'
  const roleLabel = isBranch ? 'Branch' : (profile?.role?.replace(/_/g, ' ') ?? '')

  function isNavActive(item: NavItem) {
    if (item.path === '/super-admin') return location.pathname === item.path
    if (item.path === '/inventory?tab=stock') {
      const tab = new URLSearchParams(location.search).get('tab')
      return location.pathname === '/inventory' && tab !== 'purchases'
    }
    if (item.path === '/inventory?tab=purchases') {
      const tab = new URLSearchParams(location.search).get('tab')
      return location.pathname === '/inventory' && tab === 'purchases'
    }
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
            <div className="w-9 h-9 rounded-xl bg-gold-500 flex items-center justify-center shadow-sm">
              <span className="text-sidebar font-black text-base leading-none">م</span>
            </div>
            <button
              onClick={onToggle}
              title="Expand sidebar"
              className="text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors p-1.5 rounded-lg"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gold-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                <span className="text-sidebar font-black text-base leading-none">م</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white font-bold text-xl leading-none tracking-tight" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  ميم
                </p>
                <p className="text-sidebar-text text-xs mt-0.5 truncate" title={subtitle}>{subtitle}</p>
              </div>
              <button
                onClick={onToggle}
                title="Collapse sidebar"
                className="text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors p-1.5 rounded-lg flex-shrink-0"
              >
                <ChevronLeft size={15} />
              </button>
            </div>
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
        {navItems.map(item => {
          const isActive = isNavActive(item)
          return (
            <NavLink key={item.label} to={item.path} title={collapsed ? item.label : undefined}>
              <NavItemRow item={item} isActive={isActive} collapsed={collapsed} />
            </NavLink>
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
          title={collapsed ? 'Sign out' : undefined}
          className={`
            flex items-center w-full rounded-xl text-sidebar-text
            hover:bg-sidebar-hover hover:text-white text-sm font-medium
            transition-all duration-150 group
            ${collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5'}
          `}
        >
          <LogOut size={16} className="group-hover:text-white" />
          {!collapsed && 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
