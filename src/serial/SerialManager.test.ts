import { describe, expect, it } from 'vitest'
import { SerialManager } from './SerialManager'
import { FakeSerial, FakeSerialPort } from './testing/fakeSerial'

describe('SerialManager', () => {
  it('opens the requested port at the chosen baud rate with fixed defaults, and transitions to connected', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)

    const manager = new SerialManager(fakeSerial)
    expect(manager.state).toBe('disconnected')

    await manager.connect({ baudRate: 9600 })

    expect(fakeSerial.requestPort).toHaveBeenCalledOnce()
    expect(fakePort.open).toHaveBeenCalledWith({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    })
    expect(manager.state).toBe('connected')
  })

  it('transitions to error and surfaces the failure when the user declines the device picker', async () => {
    const fakeSerial = new FakeSerial()
    fakeSerial.requestPort.mockRejectedValue(new Error('No port selected.'))

    const manager = new SerialManager(fakeSerial)

    await expect(manager.connect({ baudRate: 9600 })).rejects.toThrow(
      'No port selected.',
    )

    expect(manager.state).toBe('error')
    expect(manager.error).toBe('No port selected.')
  })

  it('transitions to error and surfaces the failure when opening the chosen port fails', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakePort.openError = new Error('The port is already open.')
    fakeSerial.requestPort.mockResolvedValue(fakePort)

    const manager = new SerialManager(fakeSerial)

    await expect(manager.connect({ baudRate: 9600 })).rejects.toThrow(
      'The port is already open.',
    )

    expect(manager.state).toBe('error')
    expect(manager.error).toBe('The port is already open.')
  })

  it('decodes a received chunk as UTF-8 and emits it as a data event', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)

    const manager = new SerialManager(fakeSerial)
    await manager.connect({ baudRate: 9600 })

    const received: string[] = []
    manager.addEventListener('data', (event) => {
      received.push((event as CustomEvent<string>).detail)
    })

    fakePort.emit(new TextEncoder().encode('hello from device\r\n'))

    // Let the read loop's pending promise resolve and dispatch.
    await Promise.resolve()
    await Promise.resolve()

    expect(received.join('')).toBe('hello from device\r\n')
  })

  it('cleanly closes the port on disconnect: releases the reader lock before closing, and returns to disconnected', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)

    const manager = new SerialManager(fakeSerial)
    await manager.connect({ baudRate: 9600 })

    await manager.disconnect()

    expect(fakePort.close).toHaveBeenCalledOnce()
    expect(manager.state).toBe('disconnected')
  })

  it('transitions to error when the read stream fails fatally outside of a user-initiated disconnect', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)

    const manager = new SerialManager(fakeSerial)
    await manager.connect({ baudRate: 9600 })

    fakePort.failFatally(new Error('device vanished'))

    await Promise.resolve()
    await Promise.resolve()

    expect(manager.state).toBe('error')
  })

  describe('reconnect (page-load reconnect-on-refresh)', () => {
    it('auto-reopens with the saved baud rate when getPorts() has exactly one match', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakeSerial.getPorts.mockResolvedValue([fakePort])

      const manager = new SerialManager(fakeSerial)
      const outcome = await manager.reconnect({ baudRate: 9600 })

      expect(fakeSerial.requestPort).not.toHaveBeenCalled()
      expect(fakePort.open).toHaveBeenCalledWith({
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      })
      expect(manager.state).toBe('connected')
      expect(outcome).toBe('reconnected')
    })

    it('resumes the data stream after an auto-reopen', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakeSerial.getPorts.mockResolvedValue([fakePort])

      const manager = new SerialManager(fakeSerial)
      await manager.reconnect({ baudRate: 9600 })

      const received: string[] = []
      manager.addEventListener('data', (event) => {
        received.push((event as CustomEvent<string>).detail)
      })

      fakePort.emit(new TextEncoder().encode('resumed\r\n'))
      await Promise.resolve()
      await Promise.resolve()

      expect(received.join('')).toBe('resumed\r\n')
    })

    it('falls back to manual connect (no auto-open) when getPorts() has zero matches', async () => {
      const fakeSerial = new FakeSerial()
      fakeSerial.getPorts.mockResolvedValue([])

      const manager = new SerialManager(fakeSerial)
      const outcome = await manager.reconnect({ baudRate: 9600 })

      expect(outcome).toBe('no-saved-match')
      expect(manager.state).toBe('disconnected')
    })

    it('falls back to manual connect (never guesses) when getPorts() has multiple matches', async () => {
      const fakeSerial = new FakeSerial()
      const fakePortA = new FakeSerialPort()
      const fakePortB = new FakeSerialPort()
      fakeSerial.getPorts.mockResolvedValue([fakePortA, fakePortB])

      const manager = new SerialManager(fakeSerial)
      const outcome = await manager.reconnect({ baudRate: 9600 })

      expect(outcome).toBe('no-saved-match')
      expect(manager.state).toBe('disconnected')
      expect(fakePortA.open).not.toHaveBeenCalled()
      expect(fakePortB.open).not.toHaveBeenCalled()
    })

    it('surfaces a clear error and leaves manual connect available when the matched port fails to open', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakePort.openError = new Error('Device is busy.')
      fakeSerial.getPorts.mockResolvedValue([fakePort])

      const manager = new SerialManager(fakeSerial)

      await expect(manager.reconnect({ baudRate: 9600 })).rejects.toThrow(
        'Device is busy.',
      )

      expect(manager.state).toBe('error')
      expect(manager.error).toBe('Device is busy.')
    })
  })
})
