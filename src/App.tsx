import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'

// Pages
import LoginPage from '@/pages/auth/LoginPage'
import SignupPage from '@/pages/auth/SignupPage'
import DashboardPage from '@/pages/admin/DashboardPage'
import SuperAdminDashboard from '@/pages/super-admin/SuperAdminDashboard'
import POSPage from '@/pages/pos/POSPage'
import NotFoundPage from '@/pages/NotFoundPage'

// ── Guards ─────────────────────────────────────────────────────────────────

function RequireAuth() {
  const { isAuthenticated, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function RequireSuperAdmin() {
  const { hasRole, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!hasRole('super_admin')) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function RequirePOS() {
  const { hasRole, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!hasRole('super_admin', 'owner', 'manager', 'cashier')) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

// Redirect authenticated users to the right place based on their role
function RootRedirect() {
  const { isAuthenticated, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (profile?.role === 'super_admin') return <Navigate to="/super-admin" replace />
  if (profile?.role === 'cashier') return <Navigate to="/pos" replace />
  return <Navigate to="/dashboard" replace />
}

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* Smart root redirect */}
        <Route path="/" element={<RootRedirect />} />

        {/* Super admin — protected */}
        <Route element={<RequireAuth />}>
          <Route element={<RequireSuperAdmin />}>
            <Route path="/super-admin" element={<SuperAdminDashboard />} />
          </Route>

          {/* POS — cashier + above */}
          <Route element={<RequirePOS />}>
            <Route path="/pos" element={<POSPage />} />
          </Route>

          {/* Main admin area — everyone except cashier */}
          <Route path="/dashboard" element={<DashboardPage />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
