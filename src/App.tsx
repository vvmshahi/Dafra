import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import AppLayout from '@/components/layout/AppLayout'

// Pages
import LoginPage           from '@/pages/auth/LoginPage'
import SignupPage          from '@/pages/auth/SignupPage'
import DashboardPage       from '@/pages/admin/DashboardPage'
import SuperAdminDashboard from '@/pages/super-admin/SuperAdminDashboard'
import POSPage             from '@/pages/pos/POSPage'
import NotFoundPage        from '@/pages/NotFoundPage'

// ── Shared loading screen ──────────────────────────────────────────────────

function FullscreenSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <LoadingSpinner size="lg" />
    </div>
  )
}

// ── Guards ─────────────────────────────────────────────────────────────────

function RequireAuth() {
  const { isAuthenticated, loading } = useAuth()
  if (loading)          return <FullscreenSpinner />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Outlet />
}

function RequireSuperAdmin() {
  const { hasRole, loading } = useAuth()
  if (loading)                return <FullscreenSpinner />
  if (!hasRole('super_admin')) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

function RequirePOS() {
  const { hasRole, loading } = useAuth()
  if (loading) return <FullscreenSpinner />
  if (!hasRole('super_admin', 'owner', 'manager', 'cashier')) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

// Redirect authenticated users to the correct landing page based on role
function RootRedirect() {
  const { isAuthenticated, profile, loading } = useAuth()
  if (loading)         return <FullscreenSpinner />
  if (!isAuthenticated) return <Navigate to="/login"       replace />
  if (profile?.role === 'super_admin') return <Navigate to="/super-admin" replace />
  if (profile?.role === 'cashier')     return <Navigate to="/pos"         replace />
  return <Navigate to="/dashboard" replace />
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login"  element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* Smart root redirect */}
        <Route path="/" element={<RootRedirect />} />

        {/* Authenticated routes */}
        <Route element={<RequireAuth />}>

          {/* POS — full-screen, no sidebar */}
          <Route element={<RequirePOS />}>
            <Route path="/pos" element={<POSPage />} />
          </Route>

          {/* App shell with Sidebar + TopHeader */}
          <Route element={<AppLayout />}>

            {/* Super admin only */}
            <Route element={<RequireSuperAdmin />}>
              <Route path="/super-admin"               element={<SuperAdminDashboard />} />
              <Route path="/super-admin/tenants"       element={<div className="card p-8 text-gray-400 text-sm">Tenants — coming soon</div>} />
              <Route path="/super-admin/subscriptions" element={<div className="card p-8 text-gray-400 text-sm">Subscriptions — coming soon</div>} />
              <Route path="/super-admin/system"        element={<div className="card p-8 text-gray-400 text-sm">System — coming soon</div>} />
              <Route path="/super-admin/settings"      element={<div className="card p-8 text-gray-400 text-sm">Settings — coming soon</div>} />
            </Route>

            {/* Admin / owner / manager */}
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/products"  element={<div className="card p-8 text-gray-400 text-sm">Products — coming soon</div>} />
            <Route path="/inventory" element={<div className="card p-8 text-gray-400 text-sm">Inventory — coming soon</div>} />
            <Route path="/customers" element={<div className="card p-8 text-gray-400 text-sm">Customers — coming soon</div>} />
            <Route path="/expenses"  element={<div className="card p-8 text-gray-400 text-sm">Expenses — coming soon</div>} />
            <Route path="/reports"   element={<div className="card p-8 text-gray-400 text-sm">Reports — coming soon</div>} />
            <Route path="/suppliers" element={<div className="card p-8 text-gray-400 text-sm">Suppliers — coming soon</div>} />
            <Route path="/settings"  element={<div className="card p-8 text-gray-400 text-sm">Settings — coming soon</div>} />
          </Route>
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
