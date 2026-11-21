import { FIXED_SERIAL_DEFAULTS, LINE_ENDING } from './types'
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

  /**
   * Retained in-memory profile from the last successful open, used to
   * auto-reopen after a USB unplug/replug (ticket #5). Deliberately never
   * cleared on `unexpected-disconnect` — that's the whole point of
   * "retaining" it.
   */
  #activeOptions: ConnectOptions | null = null

  /**
   * Incremented on every successful `#openAndTrack`. Lets a stale read
   * loop (from a session that's already been superseded by an
   * auto-recovery reopen) recognize it's stale and avoid clobbering the
   * new session's state/reader on its way out.
   */
  #sessionId = 0

  constructor(serial: SerialLike) {
    super()
    this.#serial = serial
    this.#serial.addEventListener('disconnect', this.#handleSerialDisconnect)
    this.#serial.addEventListener('connect', this.#handleSerialConnect)
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
    return this.#reopenFromSavedProfile(options, 'connecting')
  }

  /**
   * Shared "reopen with a saved profile" routine behind both the page-load
   * reconnect (`reconnect()`, ticket #4) and the post-unplug auto-recovery
   * path below (ticket #5) — the two differ only in which intermediate
   * state they show while the attempt is in flight.
   */
  async #reopenFromSavedProfile(
    options: ConnectOptions,
    pendingState: 'connecting' | 'reconnecting',
  ): Promise<ReconnectOutcome> {
    const ports = await this.#serial.getPorts()
    if (ports.length !== 1) {
      return 'no-saved-match'
    }

    this.#setState(pendingState)
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

    const sessionId = ++this.#sessionId
    this.#port = port
    this.#activeOptions = { baudRate }
    this.#disconnecting = false
    this.#keepReading = true
    this.#setState('connected', undefined, port.getInfo?.())

    // Fire-and-forget: started synchronously (up to its first await) so the
    // reader is already attached by the time this resolves.
    this.#readLoopPromise = this.#readLoop(port, sessionId)
  }

  /**
   * Browser signal that a previously authorized port physically
   * disconnected (USB unplug). Ignored unless it's our currently-open port
   * and we're actually connected (e.g. not a stray event for some other
   * authorized device). Halts reads/writes immediately but deliberately
   * keeps `#activeOptions` so the retained profile survives for recovery.
   */
  #handleSerialDisconnect = (event: Event): void => {
    if (this.#state !== 'connected') {
      return
    }
    const target = (event as unknown as { target?: unknown }).target
    if (target != null && target !== this.#port) {
      return
    }

    this.#keepReading = false
    this.#reader?.cancel().catch(() => {})
    this.#port = null
    this.#setState('unexpected-disconnect')
  }

  /**
   * Browser signal that a previously authorized port reappeared (replug).
   * Only meaningful while waiting for recovery; triggers an automatic
   * reopen attempt using the retained profile.
   */
  #handleSerialConnect = (): void => {
    if (this.#state !== 'unexpected-disconnect') {
      return
    }
    void this.#autoRecover()
  }

  async #autoRecover(): Promise<void> {
    const options = this.#activeOptions
    if (!options) {
      this.#setState('error', 'Automatic reconnect failed: no saved connection.')
      return
    }

    try {
      const outcome = await this.#reopenFromSavedProfile(options, 'reconnecting')
      if (outcome === 'no-saved-match') {
        this.#setState('error', 'Automatic reconnect failed: device not found.')
      }
    } catch {
      // #openAndTrack already surfaced the failure via #setState('error', ...);
      // swallow here so a failed auto-recovery isn't an unhandled rejection.
    }
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

  /**
   * Encodes `text` as UTF-8, appends the fixed line ending, and writes it to
   * the open port. No-op target for disconnected state: throws rather than
   * silently dropping the command.
   */
  async send(text: string): Promise<void> {
    const port = this.#port
    if (!port || !port.writable) {
      throw new Error('Cannot send while disconnected.')
    }

    const encoded = new TextEncoder().encode(text + LINE_ENDING)
    const writer = port.writable.getWriter()
    try {
      await writer.write(encoded)
    } finally {
      writer.releaseLock()
    }
  }

  async #readLoop(port: SerialPortLike, sessionId: number): Promise<void> {
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

    // A stale loop (superseded by a newer session via auto-recovery while
    // this one was still draining) must not clobber the new session's
    // reader or flip its state to 'error'.
    if (sessionId !== this.#sessionId) {
      return
    }

    this.#reader = null

    if (!this.#disconnecting && this.#state === 'connected') {
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
