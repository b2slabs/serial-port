// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Composer } from './Composer'
import { ConnectionStoreProvider } from '../store/ConnectionStoreProvider'
import { createConnectionStore } from '../store/connectionStore'
import { FakeSerial, FakeSerialPort } from '../serial/testing/fakeSerial'

async function renderConnected() {
  const fakeSerial = new FakeSerial()
  const fakePort = new FakeSerialPort()
  fakeSerial.requestPort.mockResolvedValue(fakePort)
  const store = createConnectionStore(fakeSerial)
  render(
    <ConnectionStoreProvider store={store}>
      <Composer />
    </ConnectionStoreProvider>,
  )
  await store.getState().connect()
  return { store, fakePort }
}

describe('Composer', () => {
  it('pressing Enter sends the buffered text with a fixed line ending appended, then clears the composer', async () => {
    const { fakePort } = await renderConnected()
    const user = userEvent.setup()

    const textbox = screen.getByRole('textbox')
    await user.click(textbox)
    await user.keyboard('hello')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(fakePort.writtenChunks).toHaveLength(1)
    })
    expect(new TextDecoder().decode(fakePort.writtenChunks[0])).toBe('hello\r')
    expect(textbox).toHaveValue('')
  })

  it('pressing Shift+Enter inserts a newline instead of sending', async () => {
    const { fakePort } = await renderConnected()
    const user = userEvent.setup()

    const textbox = screen.getByRole('textbox')
    await user.click(textbox)
    await user.keyboard('line one')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    await user.keyboard('line two')

    expect(textbox).toHaveValue('line one\nline two')
    expect(fakePort.writtenChunks).toHaveLength(0)
  })
})
