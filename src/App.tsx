import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Toaster } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import AppLayout from '@/components/layout/AppLayout'
import { isDesktopApp } from '@/lib/electron'

// Pages
import LoginPage           from '@/pages/auth/LoginPage'
import SignupPage          from '@/pages/auth/SignupPage'
import OnboardingPage      from '@/pages/onboarding/OnboardingPage'
import SetupBranchPage     from '@/pages/onboarding/SetupBranchPage'
import DashboardPage       from '@/pages/admin/DashboardPage'
import BranchDetailPage    from '@/pages/admin/BranchDetailPage'
import ProductsPage         from '@/pages/products/ProductsPage'
import CustomersPage        from '@/pages/customers/CustomersPage'
import CustomerDetailPage   from '@/pages/customers/CustomerDetailPage'
import ExpensesPage        from '@/pages/expenses/ExpensesPage'
import SuppliersPage       from '@/pages/suppliers/SuppliersPage'
import InventoryPage       from '@/pages/inventory/InventoryPage'
import ReportsPage         from '@/pages/reports/ReportsPage'
import OperationsPage      from '@/pages/operations/OperationsPage'
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
import PricingPage         from '@/pages/landing/PricingPage'
import FAQPage             from '@/pages/landing/FAQPage'
import ReceiptPrintPage    from '@/pages/print/ReceiptPrintPage'

// ── Shared spinner ────────────────────────────────────────────────────────

function FullscreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <LoadingSpinner size="lg" />
    </div>
  )
}

function AuthLoadError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="max-w-sm w-full rounded-2xl bg-white border border-gray-100 p-6 text-center shadow-sm">
        <h1 className="text-lg font-bold text-gray-900">Account could not be loaded</h1>
        <p className="text-sm text-gray-500 mt-2">
          We could not verify your account profile. Please check your connection and try again.
        </p>
        <div className="flex gap-2 justify-center mt-5">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700"
          >
            Retry
          </button>
          <a href="/login" className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-50">
            Sign in again
          </a>
        </div>
      </div>
    </div>
  )
}

// ── Guards ────────────────────────────────────────────────────────────────

/**
 * Must be authenticated.
 * Hard gate: forces owners without a tenant to /onboarding,
 * and owners with no branches to /setup-branch.
 */
function RequireAuth() {
  const { isAuthenticated, loading, authError, isOnboarded, profile, hasBranch } = useAuth()
  if (loading)               return <FullscreenSpinner />
  if (authError)             return <AuthLoadError />
  if (!isAuthenticated)      return <Navigate to="/login" replace />
  if (isOnboarded === null)  return <FullscreenSpinner />
  if (isOnboarded === false) return <Navigate to="/onboarding" replace />
  // Owners must have at least one branch before accessing the app
  if (profile?.role === 'owner') {
    if (hasBranch === null)  return <FullscreenSpinner />
    if (hasBranch === false) return <Navigate to="/setup-branch" replace />
  }
  return <Outlet />
}

/**
 * Setup-branch gate — lets through owners with 0 branches only.
 * Redirects everyone else to their appropriate home.
 */
function RequireSetupBranch() {
  const { isAuthenticated, loading, authError, isOnboarded, profile, hasBranch } = useAuth()
  if (loading)               return <FullscreenSpinner />
  if (authError)             return <AuthLoadError />
  if (!isAuthenticated)      return <Navigate to="/login" replace />
  if (isOnboarded === null)  return <FullscreenSpinner />
  if (isOnboarded === false) return <Navigate to="/onboarding" replace />
  if (profile?.role === 'super_admin') return <Navigate to="/super-admin" replace />
  if (profile?.role === 'branch')      return <Navigate to="/branch"       replace />
  if (hasBranch === null)    return <FullscreenSpinner />
  if (hasBranch === true)    return <Navigate to="/dashboard"  replace />
  return <Outlet />
}

/**
 * Onboarding gate — the ONLY guard for /onboarding.
 * Lets through: authenticated owner with no tenant (isOnboarded === false).
 * Redirects everyone else to their appropriate home.
 */
function RequireOnboarding() {
  const { isAuthenticated, profile, loading, authError, isOnboarded } = useAuth()
  if (loading)               return <FullscreenSpinner />
  if (authError)             return <AuthLoadError />
  if (!isAuthenticated)      return <Navigate to="/login" replace />
  if (isOnboarded === null)  return <FullscreenSpinner />
  if (profile?.role === 'super_admin') return <Navigate to="/super-admin" replace />
  if (profile?.role === 'branch')      return <Navigate to="/branch"       replace />
  if (isOnboarded === true)            return <Navigate to="/dashboard"     replace />
  return <Outlet />
}

/** Super admin only. */
function RequireSuperAdmin() {
  const { hasRole, loading, authError } = useAuth()
  if (loading)                 return <FullscreenSpinner />
  if (authError)               return <AuthLoadError />
  if (!hasRole('super_admin')) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/** Branch role only — POS and branch dashboard. */
function RequireBranch() {
  const { hasRole, loading, authError } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (authError) return <AuthLoadError />
  if (!hasRole('branch')) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/** POS — branch role only. */
function RequirePOS() {
  const { hasRole, loading, authError } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (authError) return <AuthLoadError />
  if (!hasRole('branch')) return <Navigate to="/branch" replace />
  return <Outlet />
}

/**
 * Root route: landing page for guests, smart redirect for authenticated users.
 * Waits for isOnboarded before deciding — never redirects on stale state.
 */
function SmartRedirect() {
  const { isAuthenticated, profile, loading, authError, isOnboarded } = useAuth()
  if (loading)          return <FullscreenSpinner />
  if (authError)        return <AuthLoadError />
  if (!isAuthenticated) return isDesktopApp() ? <Navigate to="/login" replace /> : <LandingPage />
  // Authenticated — wait for profile fetch to complete
  if (isOnboarded === null) return <FullscreenSpinner />
  return <Navigate to={protectedDefaultPath(profile, isOnboarded)} replace />
}

function protectedDefaultPath(profile: { role?: string } | null, isOnboarded: boolean | null) {
  if (profile?.role === 'super_admin') return '/super-admin'
  if (isOnboarded === false)           return '/onboarding'
  if (profile?.role === 'branch')      return '/branch'
  return '/dashboard'
}

function DesktopEntry() {
  const { isAuthenticated, profile, loading, authError, isOnboarded } = useAuth()
  if (loading)          return <FullscreenSpinner />
  if (authError)        return <AuthLoadError />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (isOnboarded === null) return <FullscreenSpinner />
  return <Navigate to={protectedDefaultPath(profile, isOnboarded)} replace />
}

function DesktopAwareLogin() {
  const { isAuthenticated, profile, loading, authError, isOnboarded } = useAuth()
  if (!isDesktopApp()) return <LoginPage />
  if (loading) return <FullscreenSpinner />
  if (authError) return <AuthLoadError />
  if (!isAuthenticated) return <LoginPage />
  if (isOnboarded === null) return <FullscreenSpinner />
  return <Navigate to={protectedDefaultPath(profile, isOnboarded)} replace />
}

function BrowserOnlyPublicRoute({ children }: { children: ReactNode }) {
  if (isDesktopApp()) return <DesktopEntry />
  return <>{children}</>
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <>
    <Toaster position="top-center" richColors />
    <BrowserRouter>
      <Routes>
        {/* ── Public ──────────────────────────────────────── */}
        <Route path="/login"           element={<DesktopAwareLogin />} />
        <Route path="/signup"          element={<BrowserOnlyPublicRoute><SignupPage /></BrowserOnlyPublicRoute>} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/terms"           element={<BrowserOnlyPublicRoute><TermsPage /></BrowserOnlyPublicRoute>} />
        <Route path="/privacy"         element={<BrowserOnlyPublicRoute><PrivacyPage /></BrowserOnlyPublicRoute>} />
        <Route path="/pricing"         element={<BrowserOnlyPublicRoute><PricingPage /></BrowserOnlyPublicRoute>} />
        <Route path="/faq"             element={<BrowserOnlyPublicRoute><FAQPage /></BrowserOnlyPublicRoute>} />

        {/* Root: landing page for guests, smart redirect for authenticated */}
        <Route path="/" element={<SmartRedirect />} />

        {/* Onboarding — outside RequireAuth so the hard gate doesn't loop */}
        <Route element={<RequireOnboarding />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Route>

        {/* Branch setup — outside RequireAuth so the hard gate doesn't loop */}
        <Route element={<RequireSetupBranch />}>
          <Route path="/setup-branch" element={<SetupBranchPage />} />
        </Route>

        {/* ── Authenticated ────────────────────────────────── */}
        {/* RequireAuth hard-gates owners without tenant → /onboarding */}
        <Route element={<RequireAuth />}>

          {/* Receipt print view — full-screen, no app shell or checkout modal */}
          <Route path="/print/receipt/:invoiceId" element={<ReceiptPrintPage />} />

          {/* POS — full-screen, no sidebar, branch role only */}
          <Route element={<RequirePOS />}>
            <Route path="/pos" element={<POSPage />} />
          </Route>

          {/* App shell with Sidebar */}
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
            <Route path="/dashboard" element={<DashboardPage />} />
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
            <Route path="/operations" element={<OperationsPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Route>
        </Route>

        {/* ── 404 ─────────────────────────────────────────── */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
    </>
  )
}
