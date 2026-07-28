interface ProductArchiveResponse {
  data: { id?: string } | null
  error: unknown
  status: number
}

export interface ProductArchiveClient {
  from: (table: 'products') => {
    update: (values: { is_active: false }) => {
      eq: (column: 'id', id: string) => {
        select: (columns: 'id') => {
          single: () => Promise<ProductArchiveResponse>
        }
      }
    }
  }
}

export async function archiveProduct(client: ProductArchiveClient, id: string): Promise<void> {
  const { data, error, status } = await client
    .from('products')
    .update({ is_active: false })
    .eq('id', id)
    .select('id')
    .single()

  if (error || status < 200 || status >= 300 || data?.id !== id) {
    throw error ?? new Error(`Unexpected archive response (${status})`)
  }
}
