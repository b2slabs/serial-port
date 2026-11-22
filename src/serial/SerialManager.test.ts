import { describe, expect, it, vi } from 'vitest'
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

  it('writes the buffered text with a fixed line ending appended, UTF-8 encoded, to the writer', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)

    const manager = new SerialManager(fakeSerial)
    await manager.connect({ baudRate: 9600 })

    await manager.send('hello')

    expect(fakePort.writtenChunks).toHaveLength(1)
    expect(new TextDecoder().decode(fakePort.writtenChunks[0])).toBe('hello\r')
  })

  it('rejects a send attempted while disconnected instead of silently dropping it', async () => {
    const fakeSerial = new FakeSerial()
    const manager = new SerialManager(fakeSerial)

    await expect(manager.send('hello')).rejects.toThrow(
      'Cannot send while disconnected.',
    )
  })

  describe('setBaudRate (change baud rate at any time)', () => {
    it('safely closes and reopens the same already-authorized port at the new baud rate while connected', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakeSerial.requestPort.mockResolvedValue(fakePort)

      const manager = new SerialManager(fakeSerial)
      await manager.connect({ baudRate: 9600 })

      await manager.setBaudRate(57600)

      expect(fakeSerial.requestPort).toHaveBeenCalledOnce() // no re-prompt
      expect(fakePort.close).toHaveBeenCalledOnce()
      expect(fakePort.open).toHaveBeenLastCalledWith({
        baudRate: 57600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      })
      expect(manager.state).toBe('connected')
    })

    it('resumes receiving data at the new baud rate after the reopen', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakeSerial.requestPort.mockResolvedValue(fakePort)

      const manager = new SerialManager(fakeSerial)
      await manager.connect({ baudRate: 9600 })
      await manager.setBaudRate(57600)

      const received: string[] = []
      manager.addEventListener('data', (event) => {
        received.push((event as CustomEvent<string>).detail)
      })

      fakePort.emit(new TextEncoder().encode('resumed at new rate\r\n'))
      await Promise.resolve()
      await Promise.resolve()

      expect(received.join('')).toBe('resumed at new rate\r\n')
    })

    it('is a no-op (no open/close calls) when called while disconnected', async () => {
      const fakeSerial = new FakeSerial()
      const manager = new SerialManager(fakeSerial)

      await manager.setBaudRate(57600)

      expect(fakeSerial.requestPort).not.toHaveBeenCalled()
      expect(manager.state).toBe('disconnected')
    })

    it('surfaces a clear error when reopening at the new baud rate fails', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakeSerial.requestPort.mockResolvedValue(fakePort)

      const manager = new SerialManager(fakeSerial)
      await manager.connect({ baudRate: 9600 })

      fakePort.openError = new Error('Device is busy.')

      await expect(manager.setBaudRate(57600)).rejects.toThrow(
        'Device is busy.',
      )
      expect(manager.state).toBe('error')
      expect(manager.error).toBe('Device is busy.')
    })
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

    it('surfaces a clear error and leaves manual connect available (no auto-open) when getPorts() has zero matches', async () => {
      const fakeSerial = new FakeSerial()
      fakeSerial.getPorts.mockResolvedValue([])

      const manager = new SerialManager(fakeSerial)
      const outcome = await manager.reconnect({ baudRate: 9600 })

      expect(outcome).toBe('no-saved-match')
      expect(manager.state).toBe('error')
      expect(manager.error).toBe('Automatic reconnect failed: device not found.')
    })

    it('surfaces a clear error and never guesses when getPorts() has multiple matches', async () => {
      const fakeSerial = new FakeSerial()
      const fakePortA = new FakeSerialPort()
      const fakePortB = new FakeSerialPort()
      fakeSerial.getPorts.mockResolvedValue([fakePortA, fakePortB])

      const manager = new SerialManager(fakeSerial)
      const outcome = await manager.reconnect({ baudRate: 9600 })

      expect(outcome).toBe('no-saved-match')
      expect(manager.state).toBe('error')
      expect(manager.error).toBe('Automatic reconnect failed: device not found.')
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

  describe('USB unplug/replug auto-recovery', () => {
    it('transitions to unexpected-disconnect and halts further sends when the device unplugs', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakeSerial.requestPort.mockResolvedValue(fakePort)

      const manager = new SerialManager(fakeSerial)
      await manager.connect({ baudRate: 9600 })

      fakeSerial.simulateDisconnect(fakePort)

      expect(manager.state).toBe('unexpected-disconnect')
      await expect(manager.send('hello')).rejects.toThrow(
        'Cannot send while disconnected.',
      )
    })

    it('automatically reopens with the retained baud rate when the device reappears', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakeSerial.requestPort.mockResolvedValue(fakePort)

      const manager = new SerialManager(fakeSerial)
      await manager.connect({ baudRate: 57600 })

      fakeSerial.simulateDisconnect(fakePort)
      expect(manager.state).toBe('unexpected-disconnect')

      const replugged = new FakeSerialPort()
      fakeSerial.getPorts.mockResolvedValue([replugged])
      fakeSerial.simulateConnect(replugged)

      await vi.waitFor(() => {
        expect(manager.state).toBe('connected')
      })
      expect(replugged.open).toHaveBeenCalledWith({
        baudRate: 57600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      })
    })

    it('falls back to a manual-connect-available error state when the device reappears ambiguously (zero/multiple matches)', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakeSerial.requestPort.mockResolvedValue(fakePort)

      const manager = new SerialManager(fakeSerial)
      await manager.connect({ baudRate: 9600 })

      fakeSerial.simulateDisconnect(fakePort)
      fakeSerial.getPorts.mockResolvedValue([])
      fakeSerial.simulateConnect(fakePort)

      await vi.waitFor(() => {
        expect(manager.state).toBe('error')
      })
      expect(manager.error).toBe('Automatic reconnect failed: device not found.')
    })

    it('falls back to a manual-connect-available error state when the automatic reopen fails to open', async () => {
      const fakeSerial = new FakeSerial()
      const fakePort = new FakeSerialPort()
      fakeSerial.requestPort.mockResolvedValue(fakePort)

      const manager = new SerialManager(fakeSerial)
      await manager.connect({ baudRate: 9600 })

      fakeSerial.simulateDisconnect(fakePort)

      const replugged = new FakeSerialPort()
      replugged.openError = new Error('Device is busy.')
      fakeSerial.getPorts.mockResolvedValue([replugged])
      fakeSerial.simulateConnect(replugged)

      await vi.waitFor(() => {
        expect(manager.state).toBe('error')
      })
      expect(manager.error).toBe('Device is busy.')
    })

    it('never transitions away from connected purely from elapsed idle time, however long the device stays quiet', async () => {
      vi.useFakeTimers()
      try {
        const fakeSerial = new FakeSerial()
        const fakePort = new FakeSerialPort()
        fakeSerial.requestPort.mockResolvedValue(fakePort)

        const manager = new SerialManager(fakeSerial)
        await manager.connect({ baudRate: 9600 })

        // Advance far past any plausible idle/activity timeout; no data,
        // no disconnect event, no user action.
        await vi.advanceTimersByTimeAsync(7 * 24 * 60 * 60 * 1000)

        expect(manager.state).toBe('connected')
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
