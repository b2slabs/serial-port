import { useConnection } from '../store/ConnectionStoreProvider'
import type { ConnectionState } from '../serial/types'

const MESSAGES: Partial<Record<ConnectionState, string>> = {
  'unexpected-disconnect':
    'USB device disconnected. Waiting for it to reconnect…',
  reconnecting: 'Reconnecting to the device…',
}

/**
 * Prominent warning shown while the service is in `unexpected-disconnect` or
 * `reconnecting`. Tied directly to connection state via the store (not a
 * local dismiss flag), so it appears and clears itself automatically as the
 * state machine recovers — no manual dismissal needed.
 */
export function UnplugWarning() {
  const status = useConnection((state) => state.status)
  const message = MESSAGES[status]

  if (!message) {
    return null
  }

  return (
    <div
      role="alert"
      data-testid="unplug-warning"
      className="rounded border border-amber-500 bg-amber-950/60 px-3 py-2 text-sm font-medium text-amber-200"
    >
      {message}
    </div>
  )
}
