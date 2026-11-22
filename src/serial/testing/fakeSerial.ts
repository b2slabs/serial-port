import { vi } from 'vitest'
import type {
  SerialLike,
  SerialPortLike,
  SerialPortOpenOptions,
} from '../types'

/**
 * Fake `SerialPort`. Built on real `ReadableStream`/`WritableStream` globals
 * (available in plain Node since v18) so `SerialManager`'s read loop runs
 * against the exact same stream semantics it will see in a real browser.
 */
export class FakeSerialPort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null

  /** Chunks written via the writable stream, in order. */
  writtenChunks: Uint8Array[] = []

  /** Options the test can make `open()` reject with, to simulate failure. */
  openError: unknown = null

  private readableController: ReadableStreamDefaultController<Uint8Array> | null =
    null

  openOptions: SerialPortOpenOptions | null = null

  open = vi.fn(async (options: SerialPortOpenOptions) => {
    if (this.openError) {
      throw this.openError
    }
    this.openOptions = options
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.readableController = controller
      },
    })
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.writtenChunks.push(chunk)
      },
    })
  })

  close = vi.fn(async () => {
    this.readable = null
    this.writable = null
    this.readableController = null
  })

  getInfo = vi.fn(() => ({ usbVendorId: 0x2341, usbProductId: 0x0043 }))

  /** Test helper: push a chunk as if the device sent it. */
  emit(chunk: Uint8Array) {
    this.readableController?.enqueue(chunk)
  }

  /** Test helper: simulate a fatal read error -> readable goes null. */
  failFatally(err: Error) {
    this.readableController?.error(err)
    this.readableController = null
    this.readable = null
  }
}

/**
 * Fake `Serial` (the `navigator.serial` object). Extends the real
 * `EventTarget` global so it satisfies `SerialLike`'s `addEventListener`/
 * `removeEventListener` for the `connect`/`disconnect` events exactly as the
 * real `navigator.serial` does.
 */
export class FakeSerial extends EventTarget implements SerialLike {
  requestPort = vi.fn<() => Promise<SerialPortLike>>()
  getPorts = vi.fn<() => Promise<SerialPortLike[]>>().mockResolvedValue([])

  /**
   * Test helper: simulate the browser firing `disconnect` for `port` (e.g. a
   * USB unplug). Real `event.target` is the `SerialPort` instance; a plain
   * `Event`'s `target` is normally set by the dispatch mechanism and isn't
   * writable directly, so it's set here via `defineProperty` to match.
   */
  simulateDisconnect(port: SerialPortLike) {
    const event = new Event('disconnect')
    Object.defineProperty(event, 'target', { value: port, configurable: true })
    this.dispatchEvent(event)
  }

  /** Test helper: simulate the browser firing `connect` for `port` (replug). */
  simulateConnect(port: SerialPortLike) {
    const event = new Event('connect')
    Object.defineProperty(event, 'target', { value: port, configurable: true })
    this.dispatchEvent(event)
  }
}
