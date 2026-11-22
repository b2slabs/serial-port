import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useConnection } from '../store/ConnectionStoreProvider'

const SCROLLBACK_LINES = 10_000

/**
 * Passed to xterm's `attachCustomKeyEventHandler` (ticket #8). Returning
 * `false` tells xterm not to swallow the keystroke, so the browser's own
 * default handling fires instead — specifically Ctrl+R / Cmd+R (refresh) and
 * Ctrl+Shift+R / Cmd+Shift+R (hard refresh). Note that when Shift is held,
 * `event.key` for this key comes through as uppercase `'R'`, not `'r'`, hence
 * the case-insensitive comparison. Every other key combination returns
 * `true`, leaving xterm's existing behavior (scrolling, rendering, etc.)
 * untouched.
 */
export function customKeyEventHandler(event: KeyboardEvent): boolean {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')
    return false

  return true
}

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
    terminal.attachCustomKeyEventHandler(customKeyEventHandler)

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
