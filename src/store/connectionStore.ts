import { create } from 'zustand'
import { SerialManager, type StateChangeDetail } from '../serial/SerialManager'
import type { ConnectionState, SerialLike } from '../serial/types'
import { DEFAULT_BAUD_RATE } from '../lib/baudRates'

export interface ConnectionStore {
  /** Whether the browser supports the Web Serial API at all. */
  isSupported: boolean
  status: ConnectionState
  error: string | undefined
  baudRate: number
  setBaudRate: (baudRate: number) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  /**
   * Subscribe to decoded incoming data without going through React state
   * (every byte doesn't need to trigger a re-render) — the terminal
   * component uses this to write straight into xterm.js.
   */
  subscribeToData: (listener: (chunk: string) => void) => () => void
}

/**
 * Builds a connection store bound to the given Web Serial implementation
 * (the real `navigator.serial` in production, a fake in tests). Components
 * never talk to `SerialManager` or `navigator.serial` directly — only to the
 * store this factory returns.
 */
export function createConnectionStore(serial: SerialLike | null) {
  const manager = serial ? new SerialManager(serial) : null

  const useConnectionStore = create<ConnectionStore>()((set) => {
    manager?.addEventListener('statechange', (event) => {
      const { state, error } = (event as CustomEvent<StateChangeDetail>).detail
      set({ status: state, error })
    })

    return {
      isSupported: manager !== null,
      status: 'disconnected',
      error: undefined,
      baudRate: DEFAULT_BAUD_RATE,
      setBaudRate: (baudRate) => set({ baudRate }),
      connect: async () => {
        if (!manager) return
        const { baudRate } = useConnectionStore.getState()
        await manager.connect({ baudRate })
      },
      disconnect: async () => {
        if (!manager) return
        await manager.disconnect()
      },
      subscribeToData: (listener) => {
        if (!manager) return () => {}
        const handler = (event: Event) => {
          listener((event as CustomEvent<string>).detail)
        }
        manager.addEventListener('data', handler)
        return () => manager.removeEventListener('data', handler)
      },
    }
  })

  return useConnectionStore
}
