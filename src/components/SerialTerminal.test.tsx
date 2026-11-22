// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { createConnectionStore } from '../store/connectionStore'
import { ConnectionStoreProvider } from '../store/ConnectionStoreProvider'

// Mounting the real @xterm/xterm `Terminal` isn't viable under jsdom (ticket
// #8): it needs canvas/layout APIs jsdom doesn't fully provide. For the
// mount-effect behavior under test here (ticket #13), the `Terminal` and
// `FitAddon` classes are mocked instead, so the test observes exactly what
// the component calls on them without needing a real render.
const mockTerminalInstances: { open: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }[] = []

vi.mock('@xterm/xterm', () => {
  class Terminal {
    loadAddon = vi.fn()
    open = vi.fn()
    focus = vi.fn()
    attachCustomKeyEventHandler = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    write = vi.fn()
    dispose = vi.fn()
    constructor() {
      mockTerminalInstances.push(this)
    }
  }
  return { Terminal }
})

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit = vi.fn()
  }
  return { FitAddon }
})

// jsdom doesn't implement ResizeObserver; the component only uses it to
// re-fit on container resize, which this test doesn't exercise.
class StubResizeObserver {
  observe() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', StubResizeObserver)

const { SerialTerminal, customKeyEventHandler } = await import('./SerialTerminal')

function renderTerminal() {
  const store = createConnectionStore(null)
  return render(
    <ConnectionStoreProvider store={store}>
      <SerialTerminal />
    </ConnectionStoreProvider>,
  )
}

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

describe('SerialTerminal', () => {
  it('focuses the terminal on mount, after opening it, so typing works immediately with no click (ticket #13)', () => {
    renderTerminal()

    expect(mockTerminalInstances).toHaveLength(1)
    const [terminal] = mockTerminalInstances
    expect(terminal.focus).toHaveBeenCalledOnce()
    expect(terminal.open).toHaveBeenCalledOnce()
    expect(terminal.open.mock.invocationCallOrder[0]).toBeLessThan(
      terminal.focus.mock.invocationCallOrder[0],
    )
  })
})
