// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ConnectionControls } from './ConnectionControls'
import { ConnectionStatus } from './ConnectionStatus'
import { ConnectionStoreProvider } from '../store/ConnectionStoreProvider'
import { createConnectionStore } from '../store/connectionStore'
import { FakeSerial, FakeSerialPort } from '../serial/testing/fakeSerial'

function renderWithStore(fakeSerial: FakeSerial) {
  const store = createConnectionStore(fakeSerial)
  render(
    <ConnectionStoreProvider store={store}>
      <ConnectionControls />
      <ConnectionStatus />
    </ConnectionStoreProvider>,
  )
  return store
}

describe('ConnectionControls', () => {
  it('clicking Connect requests a port, opens it with the selected baud rate, and shows Connected', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)
    renderWithStore(fakeSerial)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected')
    })
    expect(fakeSerial.requestPort).toHaveBeenCalledOnce()
    expect(fakePort.open).toHaveBeenCalledWith(
      expect.objectContaining({ baudRate: 9600 }),
    )
  })

  it('clicking Disconnect after connecting closes the port and shows Disconnected', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)
    renderWithStore(fakeSerial)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected')
    })

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Disconnected')
    })
    expect(fakePort.close).toHaveBeenCalledOnce()
  })
})
