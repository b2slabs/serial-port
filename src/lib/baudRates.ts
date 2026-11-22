/**
 * Baud rate presets. Trimmed to rates actually seen in modern use (dropped
 * 300/1200/2400 — legacy modem-era rates nobody's hardware uses today); any
 * rate not listed, including those, is still reachable via the custom entry.
 */
export const BAUD_RATE_PRESETS = [
  4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
] as const

export const DEFAULT_BAUD_RATE = 9600

/** A valid custom baud rate is a positive integer (Web Serial requires non-zero). */
export function isValidCustomBaudRate(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
