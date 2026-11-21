import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useConnection } from '../store/ConnectionStoreProvider'

const SCROLLBACK_LINES = 10_000

/**
 * Output-only terminal: renders decoded incoming bytes live. Fixed 10,000
 * line scrollback, not configurable in this ticket. Outgoing commands go
 * through the separate `Composer` component (ticket #3), not through this
 * terminal, so `disableStdin` is set and `onData` is never wired up.
 */
export function SerialTerminal() {
  const containerRef = useRef<HTMLDivElement>(null)
  const subscribeToData = useConnection((state) => state.subscribeToData)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      scrollback: SCROLLBACK_LINES,
      disableStdin: true,
      convertEol: true,
      cursorBlink: false,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    fitAddon.fit()

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(container)

    const unsubscribe = subscribeToData((chunk) => {
      terminal.write(chunk)
    })

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      terminal.dispose()
    }
  }, [subscribeToData])

  return (
    <div
      ref={containerRef}
      data-testid="serial-terminal"
      className="h-full w-full"
    />
  )
}
