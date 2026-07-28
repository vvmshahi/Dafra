export interface PosCustomerRecord {
  id: string
  name: string
  name_ar: string | null
  phone: string | null
  customer_type: string
  vat_number: string | null
  business_name: string | null
  business_name_ar: string | null
  cr_number: string | null
  address: string | null
  address_ar: string | null
}

export function normalizeSaudiMobile(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`
  if (/^5\d{8}$/.test(digits)) return `0${digits}`
  return digits
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase()
}

export function customerDisplayName(customer: PosCustomerRecord): string {
  return customer.customer_type === 'business' && customer.business_name
    ? customer.business_name
    : customer.name
}

function customerRank(customer: PosCustomerRecord, query: string): number | null {
  const textQuery = normalizedText(query)
  const mobileQuery = normalizeSaudiMobile(query)
  const names = [
    customerDisplayName(customer),
    customer.name,
    customer.name_ar,
    customer.business_name_ar,
  ].map(normalizedText).filter(Boolean)
  const phone = normalizeSaudiMobile(customer.phone)
  if (mobileQuery.length >= 9 && phone === mobileQuery) return 0
  if (names.some(name => name === textQuery)) return 1
  if (names.some(name => name.startsWith(textQuery))) return 2
  if (names.some(name => name.includes(textQuery))) return 3
  if (mobileQuery && phone.includes(mobileQuery)) return 4
  if (textQuery && (normalizedText(customer.vat_number).includes(textQuery) || normalizedText(customer.cr_number).includes(textQuery))) return 5
  return null
}

export function searchCustomers(customers: PosCustomerRecord[], query: string): PosCustomerRecord[] {
  if (!query.trim()) return customers
  return customers
    .map((customer, index) => ({ customer, index, rank: customerRank(customer, query) }))
    .filter((result): result is { customer: PosCustomerRecord; index: number; rank: number } => result.rank !== null)
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(result => result.customer)
}

export function findCustomerDuplicate(
  customers: PosCustomerRecord[],
  values: { phone: string; vatNumber?: string; crNumber?: string },
): PosCustomerRecord | null {
  const phone = normalizeSaudiMobile(values.phone)
  const vat = values.vatNumber?.trim()
  const cr = values.crNumber?.trim()
  return customers.find(customer =>
    (phone.length === 10 && normalizeSaudiMobile(customer.phone) === phone)
    || Boolean(vat && customer.vat_number === vat)
    || Boolean(cr && customer.cr_number === cr),
  ) ?? null
}

export interface PosCustomerCreateClient {
  from: (table: 'customers') => {
    insert: (payload: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: PosCustomerRecord | null; error: { code?: string; message?: string } | null; status?: number }>
      }
    }
  }
}

export async function createPosCustomer(
  client: PosCustomerCreateClient,
  payload: Record<string, unknown>,
): Promise<PosCustomerRecord> {
  const result = await client.from('customers').insert(payload).select(
    'id, name, name_ar, phone, customer_type, vat_number, business_name, business_name_ar, cr_number, address, address_ar',
  ).single()
  if (
    result.error
    || (result.status !== undefined && (result.status < 200 || result.status >= 300))
    || !result.data?.id
  ) {
    throw result.error ?? new Error('Customer creation response was not confirmed')
  }
  return result.data
}
