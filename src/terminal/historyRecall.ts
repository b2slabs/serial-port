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

export interface OnDataEffect {
  /** Forward these bytes to the device immediately — the ticket #11 live-passthrough case, unchanged. */
  forward?: string
  /** Transmit these bytes to the device for real — the Enter-commits-a-recalled-line case. Goes through the same `sendRaw` path as `forward`, just not keystroke-by-keystroke. */
  send?: string
  /** Write this text straight into the terminal — the local echo of a line being recalled/edited. */
  echo?: string
}

/**
 * Local terminal-editing redraw: return to column 0 and clear to end of
 * line, then write `text`. Used for every recall-mode echo (initial recall
 * and every subsequent edit/navigation), so the previously-echoed content
 * never lingers alongside the new content.
 */
function redraw(text: string): string {
  return `\r\x1b[K${text}`
}

export class HistoryRecallEditor {
  /** Bounded, most-recent-last. */
  #history: string[] = []
  /** Accumulates the line currently being typed live, for Enter to push into `#history`. Irrelevant/unused while recalling. */
  #liveBuffer = ''
  /**
   * Null when not currently recalling. Otherwise, `indexFromEnd` counts how
   * far back into `#history` the recall sits — 1 is the most recent entry,
   * 2 the one before that, and so on — and `buffer` is the (possibly edited)
   * text currently shown for that entry.
   */
  #recall: { indexFromEnd: number; buffer: string } | null = null

  onData(data: string): OnDataEffect {
    if (data === ARROW_UP) {
      return this.#handleUp()
    }

    if (data === ARROW_DOWN) {
      return this.#handleDown()
    }

    if (this.#recall !== null) {
      const recall = this.#recall
      if (data === ENTER) {
        return this.#commitRecall(recall)
      }
      if (data === BACKSPACE) {
        recall.buffer = recall.buffer.slice(0, -1)
      } else {
        recall.buffer += data
      }
      return { echo: redraw(recall.buffer) }
    }

    if (data === ENTER) {
      this.#pushHistory(this.#liveBuffer)
      this.#liveBuffer = ''
      return { forward: data }
    }

    this.#liveBuffer += data
    return { forward: data }
  }

  #handleUp(): OnDataEffect {
    if (this.#history.length === 0) {
      return {}
    }

    if (this.#recall === null) {
      const indexFromEnd = 1
      this.#recall = { indexFromEnd, buffer: this.#entryAt(indexFromEnd) }
    } else if (this.#recall.indexFromEnd < this.#history.length) {
      this.#recall.indexFromEnd += 1
      this.#recall.buffer = this.#entryAt(this.#recall.indexFromEnd)
    } else {
      // Already at the oldest entry — nothing further back to go.
      return {}
    }

    return { echo: redraw(this.#recall.buffer) }
  }

  #handleDown(): OnDataEffect {
    if (this.#recall === null) {
      return {}
    }

    if (this.#recall.indexFromEnd > 1) {
      this.#recall.indexFromEnd -= 1
      this.#recall.buffer = this.#entryAt(this.#recall.indexFromEnd)
      return { echo: redraw(this.#recall.buffer) }
    }

    // Already at the most recent entry — one more Down walks past it to blank.
    this.#recall = null
    return { echo: redraw('') }
  }

  /**
   * Enter while recalling: transmits the (possibly edited) line for real —
   * through `send`, not `forward`, since none of its characters were sent
   * live while being edited — and exits recall mode.
   */
  #commitRecall(recall: { buffer: string }): OnDataEffect {
    const line = recall.buffer
    this.#pushHistory(line)
    this.#recall = null
    return { send: line + ENTER }
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
