import { createContext, useContext, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { createConnectionStore, type ConnectionStore } from './connectionStore'
import { getWebSerial } from '../lib/webSerialSupport'

type ConnectionStoreApi = ReturnType<typeof createConnectionStore>

const ConnectionStoreContext = createContext<ConnectionStoreApi | null>(null)

export function ConnectionStoreProvider({
  children,
  store,
}: {
  children: ReactNode
  /** Injectable for tests; defaults to a store bound to the real navigator.serial. */
  store?: ConnectionStoreApi
}) {
  // Lazy initializer: only constructed once per provider instance, even
  // though this component re-renders. Skipped entirely when a store is
  // injected (e.g. in tests).
  const [ownStore] = useState(() =>
    store ? null : createConnectionStore(getWebSerial()),
  )
  const resolvedStore = store ?? ownStore!
  return (
    <ConnectionStoreContext.Provider value={resolvedStore}>
      {children}
    </ConnectionStoreContext.Provider>
  )
}

/** Components call this instead of ever touching SerialManager/navigator.serial. */
export function useConnection<T>(selector: (state: ConnectionStore) => T): T {
  const store = useContext(ConnectionStoreContext)
  if (!store) {
    throw new Error('useConnection must be used within a ConnectionStoreProvider')
  }
  return useStore(store, selector)
}
