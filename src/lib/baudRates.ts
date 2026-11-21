/** Standard baud rate presets, 300 through 921600. */
export const BAUD_RATE_PRESETS = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800,
  921600,
] as const

export const DEFAULT_BAUD_RATE = 9600

/** A valid custom baud rate is a positive integer (Web Serial requires non-zero). */
export function isValidCustomBaudRate(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
