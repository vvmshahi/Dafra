export type MobileRole = 'owner' | 'branch'
export type Locale = 'en' | 'ar'
export type ConnectionState = 'online' | 'slow' | 'offline'
export type OwnerTab = 'home' | 'branches' | 'reports' | 'activity' | 'more'
export type BranchTab = 'pos' | 'sales' | 'products' | 'customers' | 'more'

export interface Product {
  id: string
  name: string
  nameAr: string
  barcode: string
  category: string
  price: number
  stock: number
  taxRate: number
}

export interface CartLine {
  product: Product
  quantity: number
}

export interface Customer {
  id: string
  name: string
  mobile: string
  kind: 'individual' | 'business'
  vatNumber?: string
  crNumber?: string
}

export interface CheckoutPreview {
  requestId: string
  classification: 'SIMPLIFIED_PREVIEW'
  subtotal: number
  tax: number
  total: number
  serverConfirmed: false
}

export const ALLOWED_MOBILE_ROLES = new Set<MobileRole>(['owner', 'branch'])

export function resolveMobileRole(role: string): MobileRole | null {
  return role === 'owner' || role === 'branch' ? role : null
}

export function calculatePreview(lines: CartLine[], requestId: string): CheckoutPreview {
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0)
  const tax = lines.reduce((sum, line) => {
    const lineTotal = line.product.price * line.quantity
    return sum + lineTotal - lineTotal / (1 + line.product.taxRate / 100)
  }, 0)
  return {
    requestId,
    classification: 'SIMPLIFIED_PREVIEW',
    subtotal: Number((total - tax).toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total: Number(total.toFixed(2)),
    serverConfirmed: false,
  }
}

export function canCheckout(connection: ConnectionState, reconciling: boolean, lines: CartLine[]) {
  return connection === 'online' && !reconciling && lines.length > 0
}

export function matchesCustomer(customer: Customer, query: string) {
  const normalized = query.replace(/\s+/g, '').toLowerCase()
  return customer.name.toLowerCase().includes(query.trim().toLowerCase())
    || customer.mobile.replace(/\s+/g, '') === normalized
}
