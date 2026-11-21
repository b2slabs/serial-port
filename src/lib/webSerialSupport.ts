import type { SerialLike } from '../serial/types'

/**
 * Returns the real `navigator.serial`, narrowed to the app's injectable
 * interface, or `null` if the browser doesn't support the Web Serial API
 * (non-Chromium browsers, or a non-secure context).
 */
export function getWebSerial(): SerialLike | null {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) {
    return null
  }
  return (navigator as Navigator & { serial: SerialLike }).serial
}
