/**
 * Narrow injectable abstraction over the Web Serial API.
 *
 * `SerialManager` depends only on this interface, never on `navigator.serial`
 * directly, so it can be driven by a fake in tests and by the real
 * `navigator.serial` in production.
 *
 * Deliberately excludes `getSignals`/`setSignals` (DTR/RTS are out of scope).
 */

/** Options accepted by `SerialPortLike.open()`. */
export interface SerialPortOpenOptions {
  baudRate: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: 'none' | 'even' | 'odd'
  bufferSize?: number
  flowControl?: 'none' | 'hardware'
}

/** Mirrors the subset of `SerialPortInfo` this app cares about. */
export interface SerialPortInfoLike {
  usbVendorId?: number
  usbProductId?: number
}

/** Mirrors the subset of `SerialPort` this app depends on. */
export interface SerialPortLike {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: SerialPortOpenOptions): Promise<void>
  close(): Promise<void>
  getInfo?(): SerialPortInfoLike
}

/** Mirrors the subset of `Serial` (navigator.serial) this app depends on. */
export interface SerialLike {
  requestPort(): Promise<SerialPortLike>
  getPorts(): Promise<SerialPortLike[]>
}

/** Connection states visible to the UI at all times. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Fixed serial defaults: only baudRate is ever user-facing. */
export const FIXED_SERIAL_DEFAULTS = {
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
  flowControl: 'none',
} as const

/** Fixed line ending appended to every sent command. Not user-configurable in the MVP. */
export const LINE_ENDING = '\r\n'
