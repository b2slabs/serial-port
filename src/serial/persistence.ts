import type { SerialPortInfoLike } from './types'

const STORAGE_KEY = 'serial-port:connection-profile'
const EXPIRY_MS = 24 * 60 * 60 * 1000 // 24h

/** Profile persisted across refreshes so a saved connection can be reopened. */
export interface ConnectionProfile {
  baudRate: number
  deviceInfo: SerialPortInfoLike
  expiresAt: number
}

/** Narrow injectable storage abstraction, satisfied by `localStorage`. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * Persists the baud rate and device info from the last successful
 * connection, so the app can attempt an automatic reconnect on the next page
 * load. Never persists or reconstructs a live `SerialPort` — only
 * `getPorts()` results (the browser's own permission store) are used to
 * re-find the device.
 *
 * Depends on an injectable `StorageLike` and clock so it can be unit-tested
 * against an in-memory store and a fake clock, independent of the UI.
 */
export class ConnectionProfileStore {
  #storage: StorageLike
  #now: () => number

  constructor(storage: StorageLike, now: () => number = Date.now) {
    this.#storage = storage
    this.#now = now
  }

  /** Saves/refreshes the profile with a fresh 24h expiry from now. */
  save(baudRate: number, deviceInfo: SerialPortInfoLike): void {
    const profile: ConnectionProfile = {
      baudRate,
      deviceInfo,
      expiresAt: this.#now() + EXPIRY_MS,
    }
    this.#storage.setItem(STORAGE_KEY, JSON.stringify(profile))
  }

  /**
   * Returns the saved profile, or `null` if absent, malformed, or expired.
   * An expired profile is actively removed from storage.
   */
  load(): ConnectionProfile | null {
    const raw = this.#storage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }

    const profile = parseProfile(raw)
    if (!profile) {
      this.#storage.removeItem(STORAGE_KEY)
      return null
    }

    if (profile.expiresAt <= this.#now()) {
      this.#storage.removeItem(STORAGE_KEY)
      return null
    }

    return profile
  }

  /** Removes the saved profile, if any. */
  clear(): void {
    this.#storage.removeItem(STORAGE_KEY)
  }
}

function parseProfile(raw: string): ConnectionProfile | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as ConnectionProfile).baudRate !== 'number' ||
    typeof (parsed as ConnectionProfile).expiresAt !== 'number' ||
    typeof (parsed as ConnectionProfile).deviceInfo !== 'object' ||
    (parsed as ConnectionProfile).deviceInfo === null
  ) {
    return null
  }

  return parsed as ConnectionProfile
}
