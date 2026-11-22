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
 * The session-scoped state of a single open Web Serial connection: the open
 * port, its currently-attached reader (while the read loop is actively
 * reading — null between a reader release and the next `getReader()`), the
 * read loop's promise (awaited by `disconnect()` before closing the port),
 * and whether the read loop should keep running. Always replaced wholesale
 * by a fresh object on open (never reused across sessions), so a stale read
 * loop from a superseded session can recognize it no longer owns `#session`
 * via a simple reference check instead of a separate id.
 */
interface Session {
  port: SerialPortLike
  reader: ReadableStreamDefaultReader<Uint8Array> | null
  readLoopPromise: Promise<void> | null
  keepReading: boolean
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

  /** The currently open session, or `null` whenever nothing is open. */
  #session: Session | null = null

  /**
   * True only while `disconnect()` is tearing down intentionally.
   * Distinguishes that user-initiated close (where the read loop exiting is
   * expected and shouldn't be reported as a failure) from a genuine fatal
   * read error in `#readLoop`'s cleanup below.
   */
  #disconnecting = false

  /**
   * Retained in-memory profile from the last successful open, used to
   * auto-reopen after a USB unplug/replug (ticket #5). Deliberately never
   * cleared on `unexpected-disconnect` — that's the whole point of
   * "retaining" it.
   */
  #activeOptions: ConnectOptions | null = null

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
   * are ambiguous — this transitions to `'error'` with a clear message (the
   * same outcome `#autoRecover`'s equivalent case produces for the
   * post-unplug path) so the caller always has a manual Connect path
   * forward rather than being left at a silent, unexplained disconnected.
   */
  async reconnect(options: ConnectOptions): Promise<ReconnectOutcome> {
    return this.#reopenFromSavedProfile(options, 'connecting')
  }

  /**
   * Shared "reopen with a saved profile" routine behind both the page-load
   * reconnect (`reconnect()`, ticket #4) and the post-unplug auto-recovery
   * path below (ticket #5) — the two differ only in which intermediate
   * state they show while the attempt is in flight. Zero/multiple matches
   * are equally ambiguous for either caller ("never guess among ambiguous
   * adapters"), so this is also where the resulting error state is set —
   * both callers get the same clear, manual-connect-available outcome for
   * the same logical situation instead of diverging.
   */
  async #reopenFromSavedProfile(
    options: ConnectOptions,
    pendingState: 'connecting' | 'reconnecting',
  ): Promise<ReconnectOutcome> {
    const ports = await this.#serial.getPorts()
    if (ports.length !== 1) {
      this.#setState('error', 'Automatic reconnect failed: device not found.')
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

    const session: Session = {
      port,
      reader: null,
      readLoopPromise: null,
      keepReading: true,
    }
    this.#session = session
    this.#activeOptions = { baudRate }
    this.#disconnecting = false
    this.#setState('connected', undefined, port.getInfo?.())

    // Fire-and-forget: started synchronously (up to its first await) so the
    // reader is already attached by the time this resolves.
    session.readLoopPromise = this.#readLoop(session)
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
    const session = this.#session
    const target = (event as unknown as { target?: unknown }).target
    if (target != null && target !== session?.port) {
      return
    }

    if (session) {
      session.keepReading = false
      session.reader?.cancel().catch(() => {})
    }
    this.#session = null
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
      // 'no-saved-match' is already surfaced as 'error' by
      // #reopenFromSavedProfile itself (see its doc comment) — nothing left
      // to do with the outcome here.
      await this.#reopenFromSavedProfile(options, 'reconnecting')
    } catch {
      // #openAndTrack already surfaced the failure via #setState('error', ...);
      // swallow here so a failed auto-recovery isn't an unhandled rejection.
    }
  }

  async disconnect(): Promise<void> {
    const session = this.#session
    if (!session) {
      return
    }

    this.#disconnecting = true
    await this.#teardownSession(session)
    this.#session = null
    this.#setState('disconnected')
  }

  /**
   * Applies a new baud rate. The spec requires this be possible "at any
   * time" rather than only before the initial connect: if a session is
   * currently open, this safely stops the reader/writer, closes the port,
   * and reopens the *same* already-authorized port (no re-prompt via
   * `requestPort()`) with the new baud rate, resuming the read loop
   * afterward — the same safe reconfiguration cycle `disconnect()` uses for
   * teardown. A no-op when nothing is open; the caller is responsible for
   * using the new baud rate on the next `connect()`/`reconnect()`.
   */
  async setBaudRate(baudRate: number): Promise<void> {
    const session = this.#session
    if (!session) {
      return
    }

    this.#setState('connecting')
    await this.#teardownSession(session)
    this.#session = null

    await this.#openAndTrack(session.port, baudRate)
  }

  /** Stops the read loop and closes the port for an open session. Does not touch `#state`/`#session` — callers decide what happens next. */
  async #teardownSession(session: Session): Promise<void> {
    session.keepReading = false
    session.reader?.cancel()
    await session.readLoopPromise
    await session.port.close()
  }

  /**
   * Encodes `text` as UTF-8, appends the fixed line ending, and writes it to
   * the open port. No-op target for disconnected state: throws rather than
   * silently dropping the command.
   */
  async send(text: string): Promise<void> {
    const port = this.#session?.port
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

  async #readLoop(session: Session): Promise<void> {
    const decoder = new TextDecoder()
    const { port } = session

    while (port.readable && session.keepReading) {
      const reader = port.readable.getReader()
      session.reader = reader
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
    // this one was still draining, or torn down by an unexpected-disconnect)
    // must not clobber the current session's state.
    if (this.#session !== session) {
      return
    }

    session.reader = null

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
