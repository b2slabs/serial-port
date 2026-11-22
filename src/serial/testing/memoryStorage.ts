import type { StorageLike } from '../persistence'

/**
 * In-memory fake satisfying the narrow `StorageLike` interface, so
 * persistence tests don't depend on a real `localStorage` (and therefore
 * don't need a jsdom environment).
 */
export function createMemoryStorage(): StorageLike {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}
