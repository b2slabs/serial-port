import { ConnectionProfileStore } from '../serial/persistence'

/**
 * Returns a `ConnectionProfileStore` backed by the real `localStorage`, or
 * `null` if it isn't available (e.g. storage disabled by the browser, or a
 * non-browser environment). Mirrors `getWebSerial()`'s nullable pattern.
 */
export function getConnectionProfileStore(): ConnectionProfileStore | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return new ConnectionProfileStore(window.localStorage)
}
