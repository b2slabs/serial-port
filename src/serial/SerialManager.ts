import { FIXED_SERIAL_DEFAULTS } from './types'
import type {
  ConnectionState,
  SerialLike,
  SerialPortInfoLike,
  SerialPortLike,
} from './types'

export interface ConnectOptions {
  baudRate: number
}

export interface StateChangeDetail {
  state: ConnectionState
  error?: string
  /** Present on transitions to `connected`, from the port's `getInfo()`. */
  deviceInfo?: SerialPortInfoLike
}

/**
 * Result of a page-load reconnect attempt (see `reconnect()`): either the
 * saved baud rate was successfully reapplied to the single matching
 * already-authorized port, or there wasn't exactly one match and the caller
 * should fall back to the manual Connect flow instead of guessing.
 */
export type ReconnectOutcome = 'reconnected' | 'no-saved-match'

/**
 * Owns the lifecycle of a single Web Serial connection: requesting a port,
 * opening it with fixed defaults (only baudRate is user-facing), running the
 * cancelable read loop, and closing cleanly.
 *
 * Does not import React. Emits `statechange` (CustomEvent<StateChangeDetail>)
 * and `data` (CustomEvent<string>, UTF-8 decoded) events that a Zustand store
 * subscribes to.
 */
export class SerialManager extends EventTarget {
  #serial: SerialLike
  #state: ConnectionState = 'disconnected'
  #error: string | undefined

  #port: SerialPortLike | null = null
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  #readLoopPromise: Promise<void> | null = null
  #disconnecting = false
  #keepReading = true

  constructor(serial: SerialLike) {
    super()
    this.#serial = serial
  }

  get state(): ConnectionState {
    return this.#state
  }

  get error(): string | undefined {
    return this.#error
  }

  async connect(options: ConnectOptions): Promise<void> {
    this.#setState('connecting')

    let port: SerialPortLike
    try {
      port = await this.#serial.requestPort()
    } catch (err) {
      this.#setState('error', toErrorMessage(err))
      throw err
    }

    await this.#openAndTrack(port, options.baudRate)
  }

  /**
   * Page-load reconnect: looks up already-authorized ports via `getPorts()`
   * (never `requestPort()`, so no picker prompt) and, when exactly one
   * matches, reopens it with the saved baud rate. Zero or multiple matches
   * are ambiguous — the caller falls back to the manual Connect flow rather
   * than guessing which adapter is the right one.
   */
  async reconnect(options: ConnectOptions): Promise<ReconnectOutcome> {
    const ports = await this.#serial.getPorts()
    if (ports.length !== 1) {
      return 'no-saved-match'
    }

    this.#setState('connecting')
    await this.#openAndTrack(ports[0], options.baudRate)
    return 'reconnected'
  }

  async #openAndTrack(port: SerialPortLike, baudRate: number): Promise<void> {
    try {
      await port.open({
        baudRate,
        ...FIXED_SERIAL_DEFAULTS,
      })
    } catch (err) {
      this.#setState('error', toErrorMessage(err))
      throw err
    }

    this.#port = port
    this.#disconnecting = false
    this.#keepReading = true
    this.#setState('connected', undefined, port.getInfo?.())

    // Fire-and-forget: started synchronously (up to its first await) so the
    // reader is already attached by the time this resolves.
    this.#readLoopPromise = this.#readLoop(port)
  }

  async disconnect(): Promise<void> {
    const port = this.#port
    if (!port) {
      return
    }

    this.#disconnecting = true
    this.#keepReading = false
    this.#reader?.cancel()
    await this.#readLoopPromise
    await port.close()

    this.#port = null
    this.#reader = null
    this.#readLoopPromise = null
    this.#setState('disconnected')
  }

  async #readLoop(port: SerialPortLike): Promise<void> {
    const decoder = new TextDecoder()

    while (port.readable && this.#keepReading) {
      const reader = port.readable.getReader()
      this.#reader = reader
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) {
            break
          }
          if (value) {
            const text = decoder.decode(value, { stream: true })
            this.dispatchEvent(new CustomEvent<string>('data', { detail: text }))
          }
        }
      } catch {
        // Non-fatal error on this reader: loop retries with a fresh reader
        // unless port.readable has gone null (fatal), which ends the outer
        // loop below.
      } finally {
        reader.releaseLock()
      }
    }

    this.#reader = null

    if (!this.#disconnecting) {
      this.#setState('error', 'Connection lost.')
    }
  }

  #setState(
    state: ConnectionState,
    error?: string,
    deviceInfo?: SerialPortInfoLike,
  ) {
    this.#state = state
    this.#error = error
    this.dispatchEvent(
      new CustomEvent<StateChangeDetail>('statechange', {
        detail: { state, error, deviceInfo },
      }),
    )
  }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
