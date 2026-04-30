import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'

export default function SuperAdminDashboard() {
  const { signOut } = useAuth()

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-primary-400">دفرة</h1>
          <span className="rounded-full bg-red-900 px-2.5 py-1 text-xs font-medium text-red-300">
            Super Admin
          </span>
        </div>
        <Button variant="secondary" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <h2 className="text-xl font-semibold mb-6">Platform Overview</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Tenants', value: '0', icon: '🏢' },
            { label: 'Active Subscriptions', value: '0', icon: '✅' },
            { label: 'Total Invoices', value: '0', icon: '🧾' },
          ].map(stat => (
            <div key={stat.label} className="bg-gray-800 rounded-xl border border-gray-700 p-6">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{stat.icon}</span>
                <div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-sm text-gray-400">{stat.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="font-semibold mb-4">Tenants</h3>
          <p className="text-sm text-gray-500 text-center py-8">No tenants registered yet</p>
        </div>
      </main>
    </div>
  )
}
