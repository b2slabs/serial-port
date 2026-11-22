import { describe, expect, it } from 'vitest'
import { customKeyEventHandler } from './SerialTerminal'

function keyEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent
}

describe('customKeyEventHandler', () => {
  it('returns false for Ctrl+R so the browser refreshes the tab instead of xterm swallowing it', () => {
    const event = keyEvent({ key: 'r', ctrlKey: true })

    expect(customKeyEventHandler(event)).toBe(false)
  })

  it('returns false for Cmd+R (macOS) so the browser refreshes the tab', () => {
    const event = keyEvent({ key: 'r', metaKey: true })

    expect(customKeyEventHandler(event)).toBe(false)
  })

  it('returns false for Ctrl+Shift+R (hard refresh), where the key fires as uppercase "R"', () => {
    const event = keyEvent({ key: 'R', ctrlKey: true, shiftKey: true })

    expect(customKeyEventHandler(event)).toBe(false)
  })

  it('returns true for plain "r" with no modifiers, leaving xterm free to handle it as usual', () => {
    const event = keyEvent({ key: 'r' })

    expect(customKeyEventHandler(event)).toBe(true)
  })

  it('returns true for unrelated shortcuts (e.g. Ctrl+C) so other terminal behavior is unaffected', () => {
    const event = keyEvent({ key: 'c', ctrlKey: true })

    expect(customKeyEventHandler(event)).toBe(true)
  })

  it('returns true for keys used for scrolling/navigation (e.g. PageUp)', () => {
    const event = keyEvent({ key: 'PageUp' })

    expect(customKeyEventHandler(event)).toBe(true)
  })
})
