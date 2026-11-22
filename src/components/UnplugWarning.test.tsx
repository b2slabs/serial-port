// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UnplugWarning } from './UnplugWarning'
import { ConnectionStoreProvider } from '../store/ConnectionStoreProvider'
import { createConnectionStore } from '../store/connectionStore'
import { FakeSerial, FakeSerialPort } from '../serial/testing/fakeSerial'

function renderWithStore(fakeSerial: FakeSerial) {
  const store = createConnectionStore(fakeSerial)
  render(
    <ConnectionStoreProvider store={store}>
      <UnplugWarning />
    </ConnectionStoreProvider>,
  )
  return store
}

describe('UnplugWarning', () => {
  it('is absent while disconnected', () => {
    const fakeSerial = new FakeSerial()
    renderWithStore(fakeSerial)

    expect(screen.queryByTestId('unplug-warning')).not.toBeInTheDocument()
  })

  it('appears on an unexpected USB disconnect and clears itself automatically on recovery', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)
    const store = renderWithStore(fakeSerial)

    await store.getState().connect()
    expect(screen.queryByTestId('unplug-warning')).not.toBeInTheDocument()

    fakeSerial.simulateDisconnect(fakePort)
    await waitFor(() => {
      expect(screen.getByTestId('unplug-warning')).toBeInTheDocument()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/disconnect/i)

    const replugged = new FakeSerialPort()
    fakeSerial.getPorts.mockResolvedValue([replugged])
    fakeSerial.simulateConnect(replugged)

    await waitFor(() => {
      expect(store.getState().status).toBe('connected')
    })
    expect(screen.queryByTestId('unplug-warning')).not.toBeInTheDocument()
  })
})
