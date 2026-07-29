import type { Customer, Product } from './domain'

export const products: Product[] = [
  { id: 'p1', name: 'Sidr honey', nameAr: 'عسل سدر', barcode: '6281100001011', category: 'Pantry', price: 57.5, stock: 18, taxRate: 15 },
  { id: 'p2', name: 'Arabic coffee', nameAr: 'قهوة عربية', barcode: '6281100001028', category: 'Drinks', price: 34.5, stock: 9, taxRate: 15 },
  { id: 'p3', name: 'Ajwa dates', nameAr: 'تمر عجوة', barcode: '6281100001035', category: 'Pantry', price: 28.75, stock: 24, taxRate: 15 },
  { id: 'p4', name: 'Cardamom', nameAr: 'هيل', barcode: '6281100001042', category: 'Spices', price: 18.4, stock: 3, taxRate: 15 },
  { id: 'p5', name: 'Rose water', nameAr: 'ماء ورد', barcode: '6281100001059', category: 'Pantry', price: 12.65, stock: 0, taxRate: 15 },
  { id: 'p6', name: 'Paper cups', nameAr: 'أكواب ورقية', barcode: '6281100001066', category: 'Supplies', price: 9.2, stock: 31, taxRate: 15 }
]

export const customers: Customer[] = [
  { id: 'c1', name: 'Noura Al Harbi', mobile: '050 123 4588', kind: 'individual' },
  { id: 'c2', name: 'Madar Trading', mobile: '055 840 2110', kind: 'business', vatNumber: '310123456700003', crNumber: '1010882341' },
  { id: 'c3', name: 'Yousef Saleh', mobile: '053 610 2099', kind: 'individual' }
]

export const ownerMetrics = {
  sales: 18420.5,
  invoices: 146,
  expectedCash: 6410,
  cash: 6410,
  card: 12010.5,
  activeBranches: 4,
}
