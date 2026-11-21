import { useConnection } from '../store/ConnectionStoreProvider'

/**
 * Multi-line outgoing-command composer. Text is held in the store, not
 * transmitted keystroke-by-keystroke: Enter sends the buffered text through
 * `SerialManager`'s writer (fixed line ending appended) and clears the
 * composer; Shift+Enter inserts a newline instead of sending.
 */
export function Composer() {
  const composerText = useConnection((state) => state.composerText)
  const setComposerText = useConnection((state) => state.setComposerText)
  const send = useConnection((state) => state.send)
  const isConnected = useConnection((state) => state.status === 'connected')

  return (
    <textarea
      data-testid="composer"
      aria-label="Command composer"
      className="w-full resize-none rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
      rows={3}
      placeholder={
        isConnected
          ? 'Type a command. Enter to send, Shift+Enter for a new line.'
          : 'Connect to a device to send commands.'
      }
      disabled={!isConnected}
      value={composerText}
      onChange={(event) => setComposerText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        if (event.shiftKey) return

        event.preventDefault()
        void send()
      }}
    />
  )
}
