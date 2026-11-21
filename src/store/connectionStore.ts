import { create } from 'zustand'
import { SerialManager, type StateChangeDetail } from '../serial/SerialManager'
import type { ConnectionState, SerialLike } from '../serial/types'
import { DEFAULT_BAUD_RATE } from '../lib/baudRates'
import type { ConnectionProfileStore } from '../serial/persistence'

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
 *
 * `profileStore` (null when persistence is unavailable, e.g. no
 * `localStorage`) wires in ticket #4's remember-and-reconnect behavior: every
 * successful connect/reconnect writes a profile with a fresh 24h expiry, and
 * a saved, unexpired profile triggers an automatic page-load reconnect
 * attempt via `SerialManager#reconnect`.
 */
export function createConnectionStore(
  serial: SerialLike | null,
  profileStore: ConnectionProfileStore | null = null,
) {
  const manager = serial ? new SerialManager(serial) : null

  const useConnectionStore = create<ConnectionStore>()((set, get) => {
    manager?.addEventListener('statechange', (event) => {
      const { state, error, deviceInfo } = (
        event as CustomEvent<StateChangeDetail>
      ).detail
      set({ status: state, error })

      if (state === 'connected' && profileStore) {
        profileStore.save(get().baudRate, deviceInfo ?? {})
      }
    })

    // On creation (app start), attempt the page-load reconnect described in
    // ticket #4: a saved, unexpired profile's baud rate is reapplied only
    // when getPorts() resolves exactly one match. Zero/multiple matches, or
    // a failed reopen, fall back to the existing manual Connect flow (the
    // latter surfaces its error via the statechange listener above).
    //
    // The profile is read here (rather than via a `set()` call) because any
    // `set()` made during this initializer, before it returns, would be
    // clobbered by the initial-state object returned below — zustand treats
    // that return value as the baseline, not a merge.
    const profile = manager && profileStore ? profileStore.load() : null
    if (profile && manager) {
      manager.reconnect({ baudRate: profile.baudRate }).catch(() => {
        // Failure is already surfaced via the statechange -> 'error'
        // transition; swallow here so it isn't an unhandled rejection.
      })
    }

    return {
      isSupported: manager !== null,
      status: 'disconnected',
      error: undefined,
      baudRate: profile ? profile.baudRate : DEFAULT_BAUD_RATE,
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
