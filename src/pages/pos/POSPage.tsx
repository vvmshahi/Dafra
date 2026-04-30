import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'

export default function POSPage() {
  const { profile, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* POS header */}
      <header className="bg-primary-700 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">دفرة POS</h1>
          <span className="text-primary-200 text-sm">{profile?.full_name}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-primary-600 px-2.5 py-1 text-xs">
            Branch: {profile?.branch_id ?? 'N/A'}
          </span>
          <Button variant="secondary" size="sm" onClick={signOut}>
            End Shift
          </Button>
        </div>
      </header>

      {/* POS body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Product grid */}
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search products or scan barcode…"
              className="input"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {/* Products will be loaded here */}
            <div className="col-span-full text-center py-16 text-gray-400 text-sm">
              No products found. Add products in the admin panel.
            </div>
          </div>
        </div>

        {/* Cart panel */}
        <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Current Order</h2>
          </div>
          <div className="flex-1 p-4 overflow-y-auto">
            <p className="text-sm text-gray-400 text-center py-8">Cart is empty</p>
          </div>
          <div className="p-4 border-t border-gray-200 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span>SAR 0.00</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">VAT (15%)</span>
              <span>SAR 0.00</span>
            </div>
            <div className="flex justify-between font-semibold text-lg border-t pt-3">
              <span>Total</span>
              <span>SAR 0.00</span>
            </div>
            <Button className="w-full" disabled>
              Charge — SAR 0.00
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
