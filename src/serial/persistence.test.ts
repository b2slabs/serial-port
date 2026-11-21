import { describe, expect, it } from 'vitest'
import { ConnectionProfileStore } from './persistence'
import { createMemoryStorage } from './testing/memoryStorage'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe('ConnectionProfileStore', () => {
  it('returns null when no profile has been saved', () => {
    const store = new ConnectionProfileStore(createMemoryStorage(), () => 0)
    expect(store.load()).toBeNull()
  })

  it('saves a profile with baud rate, device info, and a 24h expiry from now', () => {
    const now = 1_000_000
    const store = new ConnectionProfileStore(createMemoryStorage(), () => now)

    store.save(9600, { usbVendorId: 0x2341, usbProductId: 0x0043 })

    expect(store.load()).toEqual({
      baudRate: 9600,
      deviceInfo: { usbVendorId: 0x2341, usbProductId: 0x0043 },
      expiresAt: now + DAY,
    })
  })

  it('treats the profile as expired (and clears it) once 24h have elapsed since the last save', () => {
    let now = 1_000_000
    const storage = createMemoryStorage()
    const store = new ConnectionProfileStore(storage, () => now)

    store.save(9600, { usbVendorId: 0x2341 })

    // Still valid one millisecond before the 24h mark.
    now += DAY - 1
    expect(store.load()).not.toBeNull()

    // Expired exactly at the 24h mark.
    now += 1
    expect(store.load()).toBeNull()
    // Actively cleared, not just ignored.
    expect(storage.getItem('serial-port:connection-profile')).toBeNull()
  })

  it('resets the 24h expiry on every save, including a reconnect save', () => {
    let now = 1_000_000
    const store = new ConnectionProfileStore(createMemoryStorage(), () => now)

    store.save(9600, { usbVendorId: 0x2341 })

    // 23 hours later: a reconnect happens and saves again.
    now += 23 * HOUR
    store.save(9600, { usbVendorId: 0x2341 })

    // 23 hours after the *reconnect* save (46h after the original save),
    // the profile is still valid because the clock was reset.
    now += 23 * HOUR
    expect(store.load()).not.toBeNull()
  })

  it('treats malformed stored JSON as absent and clears it', () => {
    const storage = createMemoryStorage()
    storage.setItem('serial-port:connection-profile', '{not valid json')
    const store = new ConnectionProfileStore(storage, () => 0)

    expect(store.load()).toBeNull()
    expect(storage.getItem('serial-port:connection-profile')).toBeNull()
  })
})
