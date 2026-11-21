import { FIXED_SERIAL_DEFAULTS } from './types'
import type { ConnectionState, SerialLike, SerialPortLike } from './types'

export interface ConnectOptions {
  baudRate: number
}

export interface StateChangeDetail {
  state: ConnectionState
  error?: string
}

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

    try {
      await port.open({
        baudRate: options.baudRate,
        ...FIXED_SERIAL_DEFAULTS,
      })
    } catch (err) {
      this.#setState('error', toErrorMessage(err))
      throw err
    }

    this.#port = port
    this.#disconnecting = false
    this.#keepReading = true
    this.#setState('connected')

    // Fire-and-forget: started synchronously (up to its first await) so the
    // reader is already attached by the time connect() resolves.
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

  #setState(state: ConnectionState, error?: string) {
    this.#state = state
    this.#error = error
    this.dispatchEvent(
      new CustomEvent<StateChangeDetail>('statechange', {
        detail: { state, error },
      }),
    )
  }
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
