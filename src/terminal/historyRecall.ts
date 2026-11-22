/**
 * Decides what to do with a single xterm `onData` chunk (ticket #12), on top
 * of the raw passthrough terminal from ticket #11. Pure and DOM-independent:
 * no xterm.js or `navigator.serial` imports, so it's testable with plain
 * strings. `SerialTerminal.tsx` is the only caller, and it applies the
 * returned effect verbatim (forward/send -> `sendRaw`, echo -> `terminal.write`).
 */
/** xterm's default (non-application) cursor-key mode escape sequences. */
export const ARROW_UP = '\x1b[A'
export const ARROW_DOWN = '\x1b[B'
/** Matches the existing raw-passthrough code's own doc comments: Enter already arrives as `'\r'`. */
export const ENTER = '\r'
/** xterm.js's default Backspace key encoding (DEL, 0x7f). */
export const BACKSPACE = '\x7f'
/** Bounded history cap — prevents unbounded growth over a long session. */
export const MAX_HISTORY_ENTRIES = 100

/**
 * A discriminated union, not three independent optionals: exactly one effect
 * is ever produced per `onData` call, and `SerialTerminal.tsx` dispatches on
 * `kind` with a `switch` instead of a chain of `if (effect.x !== undefined)`
 * checks.
 */
export type OnDataEffect =
  | { kind: 'forward'; bytes: string }
  | { kind: 'send'; bytes: string }
  | { kind: 'echo'; bytes: string }
  | { kind: 'none' }

const NONE: OnDataEffect = { kind: 'none' }

/**
 * Local terminal-editing redraw: return to column 0 and clear to end of
 * line, then write `text`. Used for every recall-mode echo (initial recall
 * and every subsequent edit/navigation), so the previously-echoed content
 * never lingers alongside the new content.
 */
function redraw(text: string): OnDataEffect {
  return { kind: 'echo', bytes: `\r\x1b[K${text}` }
}

/**
 * The editor is in exactly one of two mutually-exclusive modes at any time —
 * a real union, not a `#liveBuffer` field that sits around "irrelevant while
 * recalling" alongside a separate nullable `#recall` field. Modeling it this
 * way forces every transition to say explicitly what happens to the other
 * mode's buffer, rather than leaving it to linger by omission (see `#handleUp`:
 * entering recall from live mode deliberately *discards* whatever had been
 * typed live but not yet sent — it was never a complete line, so it's not
 * history, and it must not survive to be prepended to whatever's typed next
 * once recall mode exits).
 */
type Mode =
  | { kind: 'live'; buffer: string }
  | { kind: 'recall'; indexFromEnd: number; buffer: string }

export class HistoryRecallEditor {
  /** Bounded, most-recent-last. */
  #history: string[] = []
  #mode: Mode = { kind: 'live', buffer: '' }

  onData(data: string): OnDataEffect {
    if (data === ARROW_UP) {
      return this.#handleUp()
    }

    if (data === ARROW_DOWN) {
      return this.#handleDown()
    }

    if (this.#mode.kind === 'recall') {
      if (data === ENTER) {
        return this.#commitRecall(this.#mode)
      }
      this.#mode.buffer =
        data === BACKSPACE ? this.#mode.buffer.slice(0, -1) : this.#mode.buffer + data
      return redraw(this.#mode.buffer)
    }

    if (data === ENTER) {
      this.#pushHistory(this.#mode.buffer)
      this.#mode = { kind: 'live', buffer: '' }
      return { kind: 'forward', bytes: data }
    }

    this.#mode.buffer += data
    return { kind: 'forward', bytes: data }
  }

  #handleUp(): OnDataEffect {
    if (this.#history.length === 0) {
      return NONE
    }

    if (this.#mode.kind === 'live') {
      // Deliberately discards any in-progress, not-yet-sent live buffer —
      // see the `Mode` doc comment above.
      const indexFromEnd = 1
      this.#mode = { kind: 'recall', indexFromEnd, buffer: this.#entryAt(indexFromEnd) }
    } else if (this.#mode.indexFromEnd < this.#history.length) {
      this.#mode.indexFromEnd += 1
      this.#mode.buffer = this.#entryAt(this.#mode.indexFromEnd)
    } else {
      // Already at the oldest entry — nothing further back to go.
      return NONE
    }

    return redraw(this.#mode.buffer)
  }

  #handleDown(): OnDataEffect {
    if (this.#mode.kind === 'live') {
      return NONE
    }

    if (this.#mode.indexFromEnd > 1) {
      this.#mode.indexFromEnd -= 1
      this.#mode.buffer = this.#entryAt(this.#mode.indexFromEnd)
      return redraw(this.#mode.buffer)
    }

    // Already at the most recent entry — one more Down walks past it to blank.
    this.#mode = { kind: 'live', buffer: '' }
    return redraw('')
  }

  /**
   * Enter while recalling: transmits the (possibly edited) line for real —
   * `kind: 'send'`, not `'forward'`, since none of its characters were sent
   * live while being edited — and exits recall mode.
   */
  #commitRecall(recall: { buffer: string }): OnDataEffect {
    const line = recall.buffer
    this.#pushHistory(line)
    this.#mode = { kind: 'live', buffer: '' }
    return { kind: 'send', bytes: line + ENTER }
  }

  #entryAt(indexFromEnd: number): string {
    return this.#history[this.#history.length - indexFromEnd]
  }

  #pushHistory(line: string): void {
    if (line === '') {
      return
    }
    this.#history.push(line)
    if (this.#history.length > MAX_HISTORY_ENTRIES) {
      this.#history.shift()
    }
  }
}
