import { create, type StoreApi } from 'zustand'
import { SerialManager, type StateChangeDetail } from '../serial/SerialManager'
import type { ConnectionState, SerialLike } from '../serial/types'
import { DEFAULT_BAUD_RATE } from '../lib/baudRates'
import type { ConnectionProfile, ConnectionProfileStore } from '../serial/persistence'

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
  /** Buffered composer text; held here rather than local component state. */
  composerText: string
  setComposerText: (text: string) => void
  /** Sends the buffered composer text through SerialManager, then clears it. */
  send: () => Promise<void>
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

  // Read up front, not via a `set()` call inside the initializer below:
  // any `set()` made during that initializer, before it returns, would be
  // clobbered by the initial-state object it returns — zustand treats that
  // return value as the baseline, not a merge.
  const profile = manager && profileStore ? profileStore.load() : null

  const useConnectionStore = create<ConnectionStore>()((set, get) => {
    wireStatechangeAndPersistence(manager, profileStore, set, get)

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
      composerText: '',
      setComposerText: (text) => set({ composerText: text }),
      send: async () => {
        if (!manager) return
        const { composerText } = get()
        await manager.send(composerText)
        set({ composerText: '' })
      },
    }
  })

  // On creation (app start), attempt the page-load reconnect described in
  // ticket #4. `manager.reconnect()` only takes effect asynchronously (its
  // first step is an `await`), so kicking it off here — after the store
  // exists — behaves identically to kicking it off from inside the
  // initializer above, without needing the profile-timing workaround that
  // would require.
  bootstrapPageLoadReconnect(manager, profile)

  return useConnectionStore
}

/**
 * Subscribes to the manager's `statechange` events for the lifetime of the
 * store: mirrors state/error into it, and refreshes the persisted profile's
 * 24h expiry on every successful (re)connect.
 */
function wireStatechangeAndPersistence(
  manager: SerialManager | null,
  profileStore: ConnectionProfileStore | null,
  set: StoreApi<ConnectionStore>['setState'],
  get: StoreApi<ConnectionStore>['getState'],
): void {
  manager?.addEventListener('statechange', (event) => {
    const { state, error, deviceInfo } = (
      event as CustomEvent<StateChangeDetail>
    ).detail
    set({ status: state, error })

    if (state === 'connected' && profileStore) {
      profileStore.save(get().baudRate, deviceInfo ?? {})
    }
  })
}

/**
 * Attempts the page-load reconnect described in ticket #4: a saved,
 * unexpired profile's baud rate is reapplied only when `getPorts()`
 * resolves exactly one match. Zero/multiple matches, or a failed reopen,
 * surface a clear error via the statechange -> 'error' transition (see
 * `SerialManager#reconnect`), leaving the manual Connect flow available —
 * handled entirely by the subscription wired up above, so failure here is
 * swallowed rather than treated as an unhandled rejection.
 */
function bootstrapPageLoadReconnect(
  manager: SerialManager | null,
  profile: ConnectionProfile | null,
): void {
  if (!manager || !profile) {
    return
  }
  manager.reconnect({ baudRate: profile.baudRate }).catch(() => {})
}
