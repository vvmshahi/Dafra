import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import AppLayout from '@/components/layout/AppLayout'

// Pages
import LoginPage           from '@/pages/auth/LoginPage'
import SignupPage          from '@/pages/auth/SignupPage'
import OnboardingPage      from '@/pages/onboarding/OnboardingPage'
import DashboardPage       from '@/pages/admin/DashboardPage'
import ProductsPage         from '@/pages/products/ProductsPage'
import CustomersPage        from '@/pages/customers/CustomersPage'
import CustomerDetailPage   from '@/pages/customers/CustomerDetailPage'
import ExpensesPage        from '@/pages/expenses/ExpensesPage'
import SuppliersPage       from '@/pages/suppliers/SuppliersPage'
import InventoryPage       from '@/pages/inventory/InventoryPage'
import ReportsPage         from '@/pages/reports/ReportsPage'
import SuperAdminDashboard    from '@/pages/super-admin/SuperAdminDashboard'
import ClientsPage             from '@/pages/super-admin/ClientsPage'
import ClientDetailPage        from '@/pages/super-admin/ClientDetailPage'
import SubscriptionsPage       from '@/pages/super-admin/SubscriptionsPage'
import SuperAdminSettingsPage  from '@/pages/super-admin/SuperAdminSettingsPage'
import POSPage             from '@/pages/pos/POSPage'
import SettingsPage        from '@/pages/settings/SettingsPage'
import InvoicesPage        from '@/pages/invoices/InvoicesPage'
import InvoiceDetailPage   from '@/pages/invoices/InvoiceDetailPage'
import NotFoundPage        from '@/pages/NotFoundPage'
import LandingPage         from '@/pages/landing/LandingPage'

// ── Shared spinner ────────────────────────────────────────────────────────

function FullscreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <LoadingSpinner size="lg" />
    </div>
  )
}

// ── Guards ────────────────────────────────────────────────────────────────

/** Must be authenticated. */
function RequireAuth() {
  const { isAuthenticated, loading } = useAuth()
  if (loading)          return <FullscreenSpinner />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}

/**
 * Must have a tenant record (onboarding complete).
 * Super admins always pass — they never have a tenant_id.
 */
function RequireTenant() {
  const { isAuthenticated, profile, loading } = useAuth()
  if (loading)          return <FullscreenSpinner />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  // Super admin bypasses tenant requirement
  if (profile?.role === 'super_admin') return <Outlet />
  // New user (no tenant yet) → complete onboarding first
  if (profile && !profile.tenant_id) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/**
 * Accessible only when onboarding is NOT yet done.
 * Redirects already-onboarded users to dashboard.
 */
function RequireNewUser() {
  const { isAuthenticated, profile, loading } = useAuth()
  if (loading)          return <FullscreenSpinner />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  // Super admin has no tenant but is not a "new user"
  if (profile?.role === 'super_admin') return <Navigate to="/super-admin" replace />
  // Already onboarded → skip wizard
  if (profile?.tenant_id) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/** Super admin only. */
function RequireSuperAdmin() {
  const { hasRole, loading } = useAuth()
  if (loading)                 return <FullscreenSpinner />
  if (!hasRole('super_admin')) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/** POS-capable roles. */
function RequirePOS() {
  const { hasRole, loading } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (!hasRole('super_admin', 'owner', 'manager', 'cashier'))
    return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/**
 * Root route: show the marketing landing page for guests,
 * redirect authenticated users to their appropriate home.
 */
function RootRoute() {
  const { isAuthenticated, profile, loading } = useAuth()
  if (loading)          return <FullscreenSpinner />
  if (!isAuthenticated) return <LandingPage />
  if (profile?.role === 'super_admin') return <Navigate to="/super-admin" replace />
  if (profile && !profile.tenant_id)   return <Navigate to="/onboarding"  replace />
  if (profile?.role === 'cashier')     return <Navigate to="/pos"          replace />
  return <Navigate to="/dashboard" replace />
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public ──────────────────────────────────────── */}
        <Route path="/login"  element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* Root: landing page for guests, dashboard redirect for authenticated */}
        <Route path="/" element={<RootRoute />} />

        {/* ── Authenticated ────────────────────────────────── */}
        <Route element={<RequireAuth />}>

          {/* Onboarding — only for new users with no tenant */}
          <Route element={<RequireNewUser />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
          </Route>

          {/* POS — full-screen, no sidebar, requires tenant */}
          <Route element={<RequireTenant />}>
            <Route element={<RequirePOS />}>
              <Route path="/pos" element={<POSPage />} />
            </Route>
          </Route>

          {/* App shell with Sidebar + TopHeader */}
          <Route element={<RequireTenant />}>
            <Route element={<AppLayout />}>

              {/* Super admin only */}
              <Route element={<RequireSuperAdmin />}>
                <Route path="/super-admin"                    element={<SuperAdminDashboard />} />
                <Route path="/super-admin/clients"            element={<ClientsPage />} />
                <Route path="/super-admin/clients/:id"        element={<ClientDetailPage />} />
                <Route path="/super-admin/subscriptions"      element={<SubscriptionsPage />} />
                <Route path="/super-admin/settings"           element={<SuperAdminSettingsPage />} />
              </Route>

              {/* Admin / owner / manager / accountant */}
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/invoices"       element={<InvoicesPage />} />
              <Route path="/invoices/:id"   element={<InvoiceDetailPage />} />
              <Route path="/products"  element={<ProductsPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/customers"     element={<CustomersPage />} />
              <Route path="/customers/:id" element={<CustomerDetailPage />} />
              <Route path="/expenses"  element={<ExpensesPage />} />
              <Route path="/reports"   element={<ReportsPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/settings"  element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>

        {/* ── 404 ─────────────────────────────────────────── */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

// Inline placeholder for routes not yet built.
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-gray-400 text-sm">{title} — coming soon</p>
    </div>
  )
}
