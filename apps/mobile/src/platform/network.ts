import { Network } from '@capacitor/network'
import type { ConnectionState } from '../domain'

export async function getConnectionState(): Promise<ConnectionState> {
  const status = await Network.getStatus()
  return status.connected ? 'online' : 'offline'
}

export function observeConnection(onChange: (state: ConnectionState) => void) {
  return Network.addListener('networkStatusChange', status => {
    onChange(status.connected ? 'online' : 'offline')
  })
}
