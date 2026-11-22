import { describe, expect, it, vi } from 'vitest'
import { createConnectionStore } from './connectionStore'
import { ConnectionProfileStore } from '../serial/persistence'
import { createMemoryStorage } from '../serial/testing/memoryStorage'
import { FakeSerial, FakeSerialPort } from '../serial/testing/fakeSerial'

describe('createConnectionStore persistence wiring', () => {
  it('writes a profile (baud rate + device info) to the injected profile store on a successful connect', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)
    const profileStore = new ConnectionProfileStore(createMemoryStorage())

    const useStore = createConnectionStore(fakeSerial, profileStore)
    useStore.getState().setBaudRate(19200)
    await useStore.getState().connect()

    expect(profileStore.load()).toEqual({
      baudRate: 19200,
      deviceInfo: { usbVendorId: 0x2341, usbProductId: 0x0043 },
      expiresAt: expect.any(Number),
    })
  })

  it('resets the 24h expiry on a successful reconnect, not just the initial connect', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.requestPort.mockResolvedValue(fakePort)
    let now = 1_000_000
    const profileStore = new ConnectionProfileStore(createMemoryStorage(), () => now)

    const useStore = createConnectionStore(fakeSerial, profileStore)
    await useStore.getState().connect()
    const firstExpiry = profileStore.load()?.expiresAt

    now += 1000
    await useStore.getState().disconnect()
    await useStore.getState().connect()
    const secondExpiry = profileStore.load()?.expiresAt

    expect(secondExpiry).toBeGreaterThan(firstExpiry!)
  })

  it('auto-reopens on creation with the saved baud rate when a profile exists and getPorts() has exactly one match', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakeSerial.getPorts.mockResolvedValue([fakePort])
    const profileStore = new ConnectionProfileStore(createMemoryStorage())
    profileStore.save(57600, { usbVendorId: 0x2341 })

    const useStore = createConnectionStore(fakeSerial, profileStore)

    await vi.waitFor(() => {
      expect(useStore.getState().status).toBe('connected')
    })
    expect(fakePort.open).toHaveBeenCalledWith(
      expect.objectContaining({ baudRate: 57600 }),
    )
    expect(useStore.getState().baudRate).toBe(57600)
  })

  it('surfaces a clear error and leaves manual connect available on creation when getPorts() has zero matches', async () => {
    const fakeSerial = new FakeSerial()
    fakeSerial.getPorts.mockResolvedValue([])
    const profileStore = new ConnectionProfileStore(createMemoryStorage())
    profileStore.save(57600, { usbVendorId: 0x2341 })

    const useStore = createConnectionStore(fakeSerial, profileStore)

    await vi.waitFor(() => {
      expect(useStore.getState().status).toBe('error')
    })
    expect(useStore.getState().error).toBe(
      'Automatic reconnect failed: device not found.',
    )
  })

  it('surfaces a clear error and leaves manual connect available on creation when getPorts() has multiple matches', async () => {
    const fakeSerial = new FakeSerial()
    fakeSerial.getPorts.mockResolvedValue([new FakeSerialPort(), new FakeSerialPort()])
    const profileStore = new ConnectionProfileStore(createMemoryStorage())
    profileStore.save(57600, { usbVendorId: 0x2341 })

    const useStore = createConnectionStore(fakeSerial, profileStore)

    await vi.waitFor(() => {
      expect(useStore.getState().status).toBe('error')
    })
    expect(useStore.getState().error).toBe(
      'Automatic reconnect failed: device not found.',
    )
  })

  it('surfaces a clear error and leaves manual connect available when the auto-reopen fails', async () => {
    const fakeSerial = new FakeSerial()
    const fakePort = new FakeSerialPort()
    fakePort.openError = new Error('Device is busy.')
    fakeSerial.getPorts.mockResolvedValue([fakePort])
    const profileStore = new ConnectionProfileStore(createMemoryStorage())
    profileStore.save(57600, { usbVendorId: 0x2341 })

    const useStore = createConnectionStore(fakeSerial, profileStore)

    await vi.waitFor(() => {
      expect(useStore.getState().status).toBe('error')
    })
    expect(useStore.getState().error).toBe('Device is busy.')
  })

  it('does not attempt an auto-reopen when no saved profile exists', async () => {
    const fakeSerial = new FakeSerial()
    const profileStore = new ConnectionProfileStore(createMemoryStorage())

    createConnectionStore(fakeSerial, profileStore)
    await Promise.resolve()

    expect(fakeSerial.getPorts).not.toHaveBeenCalled()
  })
})
