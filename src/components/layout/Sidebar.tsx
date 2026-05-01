import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, Package, Warehouse, Users,
  CreditCard, BarChart2, Truck, Settings, Building2,
  LogOut, ChevronRight, FileText, UserSquare2, CalendarCheck2,
  Store,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  label: string
  path: string
  icon: LucideIcon
}

// Owner sees high-level management items only — branch operations are done by branch accounts
const ownerNav: NavItem[] = [
  { label: 'Dashboard',  path: '/dashboard',  icon: LayoutDashboard },
  { label: 'Employees',  path: '/employees',  icon: UserSquare2     },
  { label: 'Reports',    path: '/reports',    icon: BarChart2       },
  { label: 'Settings',   path: '/settings',   icon: Settings        },
]

// Branch role sees all transactional operations
const branchNav: NavItem[] = [
  { label: 'My Branch',  path: '/branch',     icon: Store           },
  { label: 'New Sale',   path: '/pos',        icon: Receipt         },
  { label: 'Invoices',   path: '/invoices',   icon: FileText        },
  { label: 'Products',   path: '/products',   icon: Package         },
  { label: 'Inventory',  path: '/inventory',  icon: Warehouse       },
  { label: 'Customers',  path: '/customers',  icon: Users           },
  { label: 'Expenses',   path: '/expenses',   icon: CreditCard      },
  { label: 'Suppliers',  path: '/suppliers',  icon: Truck           },
  { label: 'Reports',    path: '/reports',    icon: BarChart2       },
  { label: 'Day Closing',path: '/day-closing',icon: CalendarCheck2  },
]

const superAdminNav: NavItem[] = [
  { label: 'Overview',       path: '/super-admin',               icon: LayoutDashboard },
  { label: 'Clients',        path: '/super-admin/clients',       icon: Building2       },
  { label: 'Subscriptions',  path: '/super-admin/subscriptions', icon: CreditCard      },
  { label: 'Settings',       path: '/super-admin/settings',      icon: Settings        },
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
  const { profile, tenant, user, signOut } = useAuth()
  const location = useLocation()

  const isSuperAdmin = profile?.role === 'super_admin'
  const isBranch     = profile?.role === 'branch'
  const isOwner      = !isSuperAdmin && !isBranch

  const navItems = isSuperAdmin ? superAdminNav : isBranch ? branchNav : ownerNav

  const subtitle = isSuperAdmin ? 'Super Admin Console' : (tenant?.name ?? 'Dafra Platform')

  const displayName = profile?.full_name
    ?? user?.email?.split('@')[0]
    ?? 'User'

  const roleLabel = isBranch ? 'Branch' : (profile?.role?.replace(/_/g, ' ') ?? '')

  return (
    <aside className="w-[240px] flex-shrink-0 bg-sidebar flex flex-col h-full shadow-sidebar">

      {/* Logo */}
      <div className="px-5 pt-6 pb-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold-500 flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-sidebar font-black text-base leading-none">د</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white font-bold text-xl leading-none tracking-tight" style={{ fontFamily: 'Cairo, sans-serif' }}>
              دفرة
            </p>
            <p className="text-sidebar-text text-xs mt-0.5 truncate" title={subtitle}>{subtitle}</p>
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
            <NavLink key={item.label} to={item.path}>
              <NavItemRow item={item} isActive={isActive} />
            </NavLink>
          )
        })}
      </nav>

      {/* Footer: user profile + owner-only Close Day + sign out */}
      <div className="px-3 pb-4 pt-3 border-t border-sidebar-border space-y-1">
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

        {isOwner && (
          <NavLink to="/day-closing">
            {({ isActive }) => (
              <div className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                transition-all duration-150 group
                ${isActive
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
                }
              `}>
                <CalendarCheck2 size={16} className={isActive ? 'text-white' : 'group-hover:text-white'} />
                Close Day
              </div>
            )}
          </NavLink>
        )}

        <NavLink to="/profile">
          {({ isActive }) => (
            <div className={`
              flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
              transition-all duration-150 group
              ${isActive
                ? 'bg-primary-500 text-white shadow-sm'
                : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
              }
            `}>
              <UserSquare2 size={16} className={isActive ? 'text-white' : 'group-hover:text-white'} />
              Profile
            </div>
          )}
        </NavLink>

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
