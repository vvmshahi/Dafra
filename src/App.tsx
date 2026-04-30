import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import AppLayout from '@/components/layout/AppLayout'

// Pages
import LoginPage           from '@/pages/auth/LoginPage'
import SignupPage          from '@/pages/auth/SignupPage'
import OnboardingPage      from '@/pages/onboarding/OnboardingPage'
import DashboardPage       from '@/pages/admin/DashboardPage'
import SuperAdminDashboard from '@/pages/super-admin/SuperAdminDashboard'
import POSPage             from '@/pages/pos/POSPage'
import SettingsPage        from '@/pages/settings/SettingsPage'
import NotFoundPage        from '@/pages/NotFoundPage'

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
 * Smart root redirect — sends each role to the right landing page.
 * New users without a tenant go to /onboarding.
 */
function RootRedirect() {
  const { isAuthenticated, profile, loading } = useAuth()
  if (loading)           return <FullscreenSpinner />
  if (!isAuthenticated)  return <Navigate to="/login"       replace />
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

        {/* Smart root redirect */}
        <Route path="/" element={<RootRedirect />} />

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
                <Route path="/super-admin"               element={<SuperAdminDashboard />} />
                <Route path="/super-admin/tenants"       element={<PlaceholderPage title="Tenants" />} />
                <Route path="/super-admin/subscriptions" element={<PlaceholderPage title="Subscriptions" />} />
                <Route path="/super-admin/system"        element={<PlaceholderPage title="System" />} />
                <Route path="/super-admin/settings"      element={<PlaceholderPage title="Settings" />} />
              </Route>

              {/* Admin / owner / manager / accountant */}
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/products"  element={<PlaceholderPage title="Products" />} />
              <Route path="/inventory" element={<PlaceholderPage title="Inventory" />} />
              <Route path="/customers" element={<PlaceholderPage title="Customers" />} />
              <Route path="/expenses"  element={<PlaceholderPage title="Expenses" />} />
              <Route path="/reports"   element={<PlaceholderPage title="Reports" />} />
              <Route path="/suppliers" element={<PlaceholderPage title="Suppliers" />} />
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
