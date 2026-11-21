import { useConnection } from '../store/ConnectionStoreProvider'
import type { ConnectionState } from '../serial/types'

const LABELS: Record<ConnectionState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  'unexpected-disconnect': 'Unexpected disconnect',
  reconnecting: 'Reconnecting…',
  error: 'Error',
}

const DOT_CLASSES: Record<ConnectionState, string> = {
  disconnected: 'bg-zinc-500',
  connecting: 'bg-amber-400 animate-pulse',
  connected: 'bg-emerald-400',
  'unexpected-disconnect': 'bg-red-500 animate-pulse',
  reconnecting: 'bg-amber-400 animate-pulse',
  error: 'bg-red-500',
}

/** Connection state is visible at all times, per the ticket's acceptance criteria. */
export function ConnectionStatus() {
  const status = useConnection((state) => state.status)
  const error = useConnection((state) => state.error)

  return (
    <div className="flex items-center gap-2 text-sm" data-testid="connection-status">
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full ${DOT_CLASSES[status]}`}
        aria-hidden="true"
      />
      <span className="font-medium">{LABELS[status]}</span>
      {status === 'error' && error ? (
        <span className="text-red-400">({error})</span>
      ) : null}
    </div>
  )
}
