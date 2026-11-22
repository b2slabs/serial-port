import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useConnection } from '../store/ConnectionStoreProvider'
import { HistoryRecallEditor } from '../terminal/historyRecall'

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
 * The terminal is both the input and output surface (ticket #11, replacing
 * the separate `Composer` from ticket #3): `disableStdin` is now `false`,
 * and xterm's `onData` fires with the raw bytes of each keystroke — Enter
 * already arrives as `'\r'` — which are forwarded verbatim to `sendRaw`.
 * No local buffering, no app-appended line ending, and no local echo of any
 * kind: the only bytes ever rendered are the ones that arrive from the
 * device via `subscribeToData` below, so what appears while typing is
 * exactly whatever the connected device echoes back over the wire.
 *
 * `attachCustomKeyEventHandler` (ticket #8) still runs first on every
 * keydown: when it returns `false` for Ctrl+R / Cmd+R, xterm never processes
 * that key at all, so `onData` never fires for it either and the browser's
 * own refresh handling takes over instead. A raw per-keystroke send path and
 * a custom key event handler aren't mutually exclusive.
 *
 * Ticket #12 adds a second, deliberate exception on top of that raw
 * passthrough, scoped to only Up/Down Arrow: every `onData` chunk is first
 * run through a `HistoryRecallEditor` (see `../terminal/historyRecall.ts`),
 * which returns a discriminated `OnDataEffect` — `'forward'` for the common
 * live-passthrough case (applied exactly as before via `sendRaw`), `'echo'`
 * for the recall/edit case (written straight into the terminal with no
 * network round-trip), `'send'` once Enter commits a recalled/edited line
 * for real, or `'none'`. One `HistoryRecallEditor` instance lives for the
 * lifetime of the mounted terminal, so history persists across a session but
 * not across remounts — matching the rest of this component's
 * session-scoped state.
 *
 * Fixed 10,000 line scrollback, not configurable in this ticket.
 */
export function SerialTerminal() {
  const containerRef = useRef<HTMLDivElement>(null)
  const subscribeToData = useConnection((state) => state.subscribeToData)
  const sendRaw = useConnection((state) => state.sendRaw)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      scrollback: SCROLLBACK_LINES,
      disableStdin: false,
      convertEol: true,
      cursorBlink: false,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    fitAddon.fit()
    // Ticket #13: focus immediately so the page loads ready to type, with
    // no click into the terminal required first.
    terminal.focus()
    terminal.attachCustomKeyEventHandler(customKeyEventHandler)

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(container)

    const unsubscribeData = subscribeToData((chunk) => {
      terminal.write(chunk)
    })
    const recallEditor = new HistoryRecallEditor()
    const dataListener = terminal.onData((data) => {
      const effect = recallEditor.onData(data)
      switch (effect.kind) {
        case 'forward':
        case 'send':
          sendRaw(effect.bytes)
          break
        case 'echo':
          terminal.write(effect.bytes)
          break
        case 'none':
          break
      }
    })

    return () => {
      unsubscribeData()
      dataListener.dispose()
      resizeObserver.disconnect()
      terminal.dispose()
    }
  }, [subscribeToData, sendRaw])

  return (
    <div
      ref={containerRef}
      data-testid="serial-terminal"
      className="h-full w-full"
    />
  )
}
