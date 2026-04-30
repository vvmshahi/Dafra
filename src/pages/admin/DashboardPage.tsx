import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export default function DashboardPage() {
  const { profile, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-primary-700">دفرة</h1>
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-500">Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {profile?.full_name ?? profile?.id}
          </span>
          <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-800 capitalize">
            {profile?.role}
          </span>
          <Button variant="secondary" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Overview</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Today's Sales", value: 'SAR 0', icon: '💰' },
            { label: 'Invoices', value: '0', icon: '🧾' },
            { label: 'Products', value: '0', icon: '📦' },
            { label: 'Customers', value: '0', icon: '👥' },
          ].map(stat => (
            <Card key={stat.label}>
              <div className="flex items-center gap-3">
                <span className="text-2xl">{stat.icon}</span>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                  <p className="text-sm text-gray-500">{stat.label}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h3 className="font-semibold text-gray-900 mb-4">Recent Invoices</h3>
            <p className="text-sm text-gray-400 text-center py-8">No invoices yet</p>
          </Card>
          <Card>
            <h3 className="font-semibold text-gray-900 mb-4">ZATCA Submission Status</h3>
            <p className="text-sm text-gray-400 text-center py-8">No pending submissions</p>
          </Card>
        </div>
      </main>
    </div>
  )
}
