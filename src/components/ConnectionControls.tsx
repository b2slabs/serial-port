import { BaudRateSelect } from './BaudRateSelect'
import { useConnection } from '../store/ConnectionStoreProvider'

/**
 * Connect/Disconnect buttons and baud rate selection.
 *
 * `requestPort()` must be invoked directly inside a user gesture, so the
 * Connect button calls the store's `connect()` action synchronously from its
 * own click handler (no deferred/async hop before the call that actually
 * reaches `navigator.serial.requestPort()`).
 */
export function ConnectionControls() {
  const status = useConnection((state) => state.status)
  const connect = useConnection((state) => state.connect)
  const disconnect = useConnection((state) => state.disconnect)
  const isSupported = useConnection((state) => state.isSupported)

  if (!isSupported) {
    return (
      <p className="text-sm text-red-400" role="alert">
        This browser doesn't support the Web Serial API. Use Chrome or Edge
        over HTTPS (or localhost).
      </p>
    )
  }

  const isConnected = status === 'connected'
  // 'reconnecting' covers the post-unplug auto-recovery attempt in flight;
  // disabled alongside 'connecting' so a manual click can't race it.
  const isConnecting = status === 'connecting' || status === 'reconnecting'

  return (
    <div className="flex flex-wrap items-center gap-4">
      {isConnected ? (
        <button
          type="button"
          className="rounded bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          onClick={() => {
            void disconnect()
          }}
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isConnecting}
          onClick={() => {
            void connect()
          }}
        >
          {status === 'reconnecting' ? 'Reconnecting…' : isConnecting ? 'Connecting…' : 'Connect'}
        </button>
      )}

      <BaudRateSelect />
    </div>
  )
}
