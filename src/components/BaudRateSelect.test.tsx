// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BaudRateSelect } from './BaudRateSelect'
import { ConnectionControls } from './ConnectionControls'
import { ConnectionStatus } from './ConnectionStatus'
import { ConnectionStoreProvider } from '../store/ConnectionStoreProvider'
import { createConnectionStore } from '../store/connectionStore'
import { FakeSerial, FakeSerialPort } from '../serial/testing/fakeSerial'

describe('BaudRateSelect', () => {
  it('stays enabled while connected, so the baud rate can be changed at any time', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)
    const store = createConnectionStore(fakeSerial)

    render(
      <ConnectionStoreProvider store={store}>
        <ConnectionControls />
        <ConnectionStatus />
      </ConnectionStoreProvider>,
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected')
    })

    const select = screen.getByLabelText('Baud rate')
    expect(select).toBeEnabled()

    await user.selectOptions(select, '57600')

    await waitFor(() => {
      expect(fakePort.open).toHaveBeenLastCalledWith(
        expect.objectContaining({ baudRate: 57600 }),
      )
    })
    await waitFor(() => {
      expect(screen.getByTestId('connection-status')).toHaveTextContent('Connected')
    })
  })

  it('is enabled before connecting, so the initial baud rate can still be chosen', () => {
    const fakeSerial = new FakeSerial()
    const store = createConnectionStore(fakeSerial)

    render(
      <ConnectionStoreProvider store={store}>
        <BaudRateSelect />
      </ConnectionStoreProvider>,
    )

    expect(screen.getByLabelText('Baud rate')).toBeEnabled()
  })
})
