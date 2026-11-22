import { describe, expect, it } from 'vitest'
import {
  ARROW_DOWN,
  ARROW_UP,
  BACKSPACE,
  ENTER,
  HistoryRecallEditor,
  MAX_HISTORY_ENTRIES,
} from './historyRecall'

describe('HistoryRecallEditor', () => {
  it('forwards an ordinary live-typed character verbatim when not recalling', () => {
    const editor = new HistoryRecallEditor()

    const result = editor.onData('a')

    expect(result).toStrictEqual({ forward: 'a' })
  })

  it('treats Up Arrow as a no-op when nothing has been sent yet', () => {
    const editor = new HistoryRecallEditor()

    const result = editor.onData(ARROW_UP)

    expect(result).toStrictEqual({})
  })

  it('records a sent line via Enter, then recalls and echoes it on Up Arrow', () => {
    const editor = new HistoryRecallEditor()
    editor.onData('h')
    editor.onData('i')
    const enterResult = editor.onData(ENTER)
    expect(enterResult).toStrictEqual({ forward: ENTER })

    const result = editor.onData(ARROW_UP)

    expect(result).toStrictEqual({ echo: '\r\x1b[Khi' })
  })

  it('walks further back through history on repeated Up Arrow presses', () => {
    const editor = new HistoryRecallEditor()
    sendLine(editor, 'first')
    sendLine(editor, 'second')

    const firstUp = editor.onData(ARROW_UP)
    const secondUp = editor.onData(ARROW_UP)

    expect(firstUp).toStrictEqual({ echo: '\r\x1b[Ksecond' })
    expect(secondUp).toStrictEqual({ echo: '\r\x1b[Kfirst' })
  })

  it('is a no-op on Up Arrow once already at the oldest entry', () => {
    const editor = new HistoryRecallEditor()
    sendLine(editor, 'only')
    editor.onData(ARROW_UP)

    const result = editor.onData(ARROW_UP)

    expect(result).toStrictEqual({})
  })

  it('walks forward on Down Arrow, back to a blank line past the most recent entry', () => {
    const editor = new HistoryRecallEditor()
    sendLine(editor, 'first')
    sendLine(editor, 'second')
    editor.onData(ARROW_UP)
    editor.onData(ARROW_UP)

    const forwardOnce = editor.onData(ARROW_DOWN)
    const forwardToBlank = editor.onData(ARROW_DOWN)

    expect(forwardOnce).toStrictEqual({ echo: '\r\x1b[Ksecond' })
    expect(forwardToBlank).toStrictEqual({ echo: '\r\x1b[K' })
  })

  it('is a no-op on Down Arrow when not currently recalling', () => {
    const editor = new HistoryRecallEditor()
    sendLine(editor, 'only')

    const result = editor.onData(ARROW_DOWN)

    expect(result).toStrictEqual({})
  })

  it('edits the recalled buffer locally on typing, instead of forwarding raw', () => {
    const editor = new HistoryRecallEditor()
    sendLine(editor, 'hi')
    editor.onData(ARROW_UP)

    const result = editor.onData('!')

    expect(result).toStrictEqual({ echo: '\r\x1b[Khi!' })
  })

  it('removes the last character of the recalled buffer on Backspace', () => {
    const editor = new HistoryRecallEditor()
    sendLine(editor, 'hi')
    editor.onData(ARROW_UP)

    const result = editor.onData(BACKSPACE)

    expect(result).toStrictEqual({ echo: '\r\x1b[Kh' })
  })

  it('transmits the edited recalled line for real on Enter, through send rather than forward', () => {
    const editor = new HistoryRecallEditor()
    sendLine(editor, 'hi')
    editor.onData(ARROW_UP)
    editor.onData('!')

    const result = editor.onData(ENTER)

    expect(result).toStrictEqual({ send: 'hi!\r' })
  })

  it('exits recall mode after Enter, so the next Up Arrow recalls the newly-sent edited line', () => {
    const editor = new HistoryRecallEditor()
    sendLine(editor, 'hi')
    editor.onData(ARROW_UP)
    editor.onData('!')
    editor.onData(ENTER)

    const result = editor.onData(ARROW_UP)

    expect(result).toStrictEqual({ echo: '\r\x1b[Khi!' })
  })

  it('drops the oldest entry once history exceeds the bounded cap', () => {
    const editor = new HistoryRecallEditor()
    // Send one more line than the cap allows; the very first ('line-0')
    // should fall off the front.
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 1; i++) {
      sendLine(editor, `line-${i}`)
    }

    // Walk all the way back: the oldest surviving entry should be
    // 'line-1', not 'line-0', and there should be exactly MAX_HISTORY_ENTRIES
    // of them to walk through.
    let last: ReturnType<HistoryRecallEditor['onData']> = {}
    for (let i = 0; i < MAX_HISTORY_ENTRIES; i++) {
      last = editor.onData(ARROW_UP)
    }
    const oneMoreUp = editor.onData(ARROW_UP)

    expect(last).toStrictEqual({ echo: '\r\x1b[Kline-1' })
    expect(oneMoreUp).toStrictEqual({})
  })
})

function sendLine(editor: HistoryRecallEditor, line: string): void {
  for (const char of line) {
    editor.onData(char)
  }
  editor.onData(ENTER)
}
