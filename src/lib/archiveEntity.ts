export interface ArchiveEntityResponse {
  data: { id?: string } | null
  error: unknown
  status?: number
}

export interface ArchiveEntityClient {
  from: (table: string) => {
    update: (values: { is_active: false }) => {
      eq: (column: 'id', id: string) => {
        select: (columns: 'id') => {
          maybeSingle: () => Promise<ArchiveEntityResponse>
        }
      }
    }
  }
}

export async function archiveEntity(
  client: ArchiveEntityClient,
  table: 'customers' | 'suppliers',
  id: string,
): Promise<void> {
  const result = await client.from(table).update({ is_active: false }).eq('id', id).select('id').maybeSingle()
  if (
    result.error
    || (result.status !== undefined && (result.status < 200 || result.status >= 300))
    || result.data?.id !== id
  ) {
    throw result.error ?? new Error(`${table} archive response was not confirmed`)
  }
}
