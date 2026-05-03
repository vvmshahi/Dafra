import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import AppLayout from '@/components/layout/AppLayout'

// Pages
import LoginPage           from '@/pages/auth/LoginPage'
import SignupPage          from '@/pages/auth/SignupPage'
import OnboardingPage      from '@/pages/onboarding/OnboardingPage'
import DashboardPage       from '@/pages/admin/DashboardPage'
import BranchDetailPage    from '@/pages/admin/BranchDetailPage'
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
import EmployeesPage        from '@/pages/employees/EmployeesPage'
import ProfilePage          from '@/pages/profile/ProfilePage'
import DayClosingPage       from '@/pages/day-closing/DayClosingPage'
import BranchDashboardPage  from '@/pages/branch/BranchDashboardPage'
import InvoiceSettingsPage  from '@/pages/branch/InvoiceSettingsPage'
import ForgotPasswordPage   from '@/pages/auth/ForgotPasswordPage'
import ResetPasswordPage    from '@/pages/auth/ResetPasswordPage'
import TermsPage            from '@/pages/legal/TermsPage'
import PrivacyPage          from '@/pages/legal/PrivacyPage'
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

/**
 * Must be authenticated.
 * Hard gate: waits for isOnboarded to resolve, then forces owners
 * without a tenant to /onboarding before any other route is reachable.
 */
function RequireAuth() {
  const { isAuthenticated, loading, isOnboarded } = useAuth()
  if (loading)               return <FullscreenSpinner />
  if (!isAuthenticated)      return <Navigate to="/login" replace />
  // Wait for profile fetch to complete before deciding
  if (isOnboarded === null)  return <FullscreenSpinner />
  if (isOnboarded === false) return <Navigate to="/onboarding" replace />
  return <Outlet />
}

/**
 * Onboarding gate — the ONLY guard for /onboarding.
 * Lets through: authenticated owner with no tenant (isOnboarded === false).
 * Redirects everyone else to their appropriate home.
 */
function RequireOnboarding() {
  const { isAuthenticated, profile, loading, isOnboarded } = useAuth()
  if (loading)               return <FullscreenSpinner />
  if (!isAuthenticated)      return <Navigate to="/login" replace />
  if (isOnboarded === null)  return <FullscreenSpinner />
  if (profile?.role === 'super_admin') return <Navigate to="/super-admin" replace />
  if (profile?.role === 'branch')      return <Navigate to="/branch"       replace />
  if (isOnboarded === true)            return <Navigate to="/dashboard"     replace />
  return <Outlet />
}

/** Super admin only. */
function RequireSuperAdmin() {
  const { hasRole, loading } = useAuth()
  if (loading)                 return <FullscreenSpinner />
  if (!hasRole('super_admin')) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/** Branch role only — POS and branch dashboard. */
function RequireBranch() {
  const { hasRole, loading } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (!hasRole('branch')) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/** POS — branch role only. */
function RequirePOS() {
  const { hasRole, loading } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (!hasRole('branch')) return <Navigate to="/branch" replace />
  return <Outlet />
}

/**
 * Root route: landing page for guests, smart redirect for authenticated users.
 * Waits for isOnboarded before deciding — never redirects on stale state.
 */
function SmartRedirect() {
  const { isAuthenticated, profile, loading, isOnboarded } = useAuth()
  if (loading)          return <FullscreenSpinner />
  if (!isAuthenticated) return <LandingPage />
  // Authenticated — wait for profile fetch to complete
  if (isOnboarded === null) return <FullscreenSpinner />
  if (profile?.role === 'super_admin') return <Navigate to="/super-admin" replace />
  if (isOnboarded === false)           return <Navigate to="/onboarding"  replace />
  if (profile?.role === 'branch')      return <Navigate to="/branch"       replace />
  return <Navigate to="/dashboard" replace />
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Public ──────────────────────────────────────── */}
        <Route path="/login"           element={<LoginPage />} />
        <Route path="/signup"          element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/terms"           element={<TermsPage />} />
        <Route path="/privacy"         element={<PrivacyPage />} />

        {/* Root: landing page for guests, smart redirect for authenticated */}
        <Route path="/" element={<SmartRedirect />} />

        {/* Onboarding — outside RequireAuth so the hard gate doesn't loop */}
        <Route element={<RequireOnboarding />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Route>

        {/* ── Authenticated ────────────────────────────────── */}
        {/* RequireAuth hard-gates owners without tenant → /onboarding */}
        <Route element={<RequireAuth />}>

          {/* POS — full-screen, no sidebar, branch role only */}
          <Route element={<RequirePOS />}>
            <Route path="/pos" element={<POSPage />} />
          </Route>

          {/* App shell with Sidebar + TopHeader */}
          <Route element={<AppLayout />}>

            {/* Branch dashboard — inside AppLayout so sidebar shows */}
            <Route element={<RequireBranch />}>
              <Route path="/branch"            element={<BranchDashboardPage />} />
              <Route path="/invoice-settings"  element={<InvoiceSettingsPage />} />
            </Route>

            {/* Super admin only */}
            <Route element={<RequireSuperAdmin />}>
              <Route path="/super-admin"                    element={<SuperAdminDashboard />} />
              <Route path="/super-admin/clients"            element={<ClientsPage />} />
              <Route path="/super-admin/clients/:id"        element={<ClientDetailPage />} />
              <Route path="/super-admin/subscriptions"      element={<SubscriptionsPage />} />
              <Route path="/super-admin/settings"           element={<SuperAdminSettingsPage />} />
            </Route>

            {/* Owner routes */}
            <Route path="/dashboard" element={<DashboardRoute />} />
            <Route path="/dashboard/branches/:branchId" element={<BranchDetailPage />} />
            <Route path="/invoices"       element={<InvoicesPage />} />
            <Route path="/invoices/:id"   element={<InvoiceDetailPage />} />
            <Route path="/products"  element={<ProductsPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/customers"     element={<CustomersPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/expenses"   element={<ExpensesPage />} />
            <Route path="/employees"   element={<EmployeesPage />} />
            <Route path="/profile"    element={<ProfilePage />} />
            <Route path="/day-closing" element={<DayClosingPage />} />
            <Route path="/reports"   element={<ReportsPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Route>
        </Route>

        {/* ── 404 ─────────────────────────────────────────── */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

// Forces DashboardPage to fully remount on every navigation so branch data
// is always fetched fresh. location.key changes on each navigation entry.
function DashboardRoute() {
  const { key } = useLocation()
  return <DashboardPage key={key} />
}

// Inline placeholder for routes not yet built.
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-gray-400 text-sm">{title} — coming soon</p>
    </div>
  )
}
