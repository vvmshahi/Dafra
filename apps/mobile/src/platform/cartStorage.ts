import { Preferences } from '@capacitor/preferences'
import type { CartLine } from '../domain'

const CART_KEY = 'kubri.mobile.unsent-cart.v1'
const REQUEST_KEY = 'kubri.mobile.checkout-request.v1'

export const cartStorage = {
  async save(lines: CartLine[]) {
    await Preferences.set({ key: CART_KEY, value: JSON.stringify(lines) })
  },
  async restore(): Promise<CartLine[]> {
    const { value } = await Preferences.get({ key: CART_KEY })
    if (!value) return []
    try {
      return JSON.parse(value) as CartLine[]
    } catch {
      return []
    }
  },
  async retainRequestId(requestId: string) {
    await Preferences.set({ key: REQUEST_KEY, value: requestId })
  },
  async getRetainedRequestId() {
    return (await Preferences.get({ key: REQUEST_KEY })).value
  },
  async clearRequestId() {
    await Preferences.remove({ key: REQUEST_KEY })
  },
}
