import { useState } from 'react'
import { useConnection } from '../store/ConnectionStoreProvider'
import { BAUD_RATE_PRESETS, isValidCustomBaudRate } from '../lib/baudRates'
import { CONNECT_ATTEMPT_IN_FLIGHT_STATES } from '../serial/connectionStateDisplay'

const CUSTOM_VALUE = 'custom'

/**
 * Preset baud rate dropdown plus a validated custom numeric entry. Only
 * baudRate is ever user-facing here — dataBits/stopBits/parity/flowControl
 * are fixed in SerialManager and never exposed in this UI.
 *
 * Changeable at any time, including while connected — `setBaudRate` on the
 * store triggers `SerialManager`'s safe close/reopen cycle, which itself
 * moves through `connecting` while the reopen is in flight. Only disabled
 * during that in-flight window (same set the Connect button uses), so a
 * second change can't race the first.
 *
 * The custom-rate input commits on blur/Enter, not on every keystroke: while
 * connected, each commit drives a real close/reopen of the port, so typing
 * "19200" one digit at a time must not churn the connection through 1, 19,
 * 192, 1920 along the way.
 */
export function BaudRateSelect() {
  const baudRate = useConnection((state) => state.baudRate)
  const setBaudRate = useConnection((state) => state.setBaudRate)
  const disabled = useConnection((state) =>
    CONNECT_ATTEMPT_IN_FLIGHT_STATES.has(state.status),
  )

  const isPreset = (BAUD_RATE_PRESETS as readonly number[]).includes(baudRate)
  const [customMode, setCustomMode] = useState(!isPreset)
  const [customText, setCustomText] = useState(isPreset ? '' : String(baudRate))

  const customValue = Number(customText)
  const customIsValid = customText.trim() !== '' && isValidCustomBaudRate(customValue)

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="baud-rate-select" className="text-sm text-zinc-300">
        Baud rate
      </label>
      <select
        id="baud-rate-select"
        className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
        disabled={disabled}
        value={customMode ? CUSTOM_VALUE : baudRate}
        onChange={(event) => {
          const { value } = event.target
          if (value === CUSTOM_VALUE) {
            setCustomMode(true)
            return
          }
          setCustomMode(false)
          setBaudRate(Number(value))
        }}
      >
        {BAUD_RATE_PRESETS.map((preset) => (
          <option key={preset} value={preset}>
            {preset}
          </option>
        ))}
        <option value={CUSTOM_VALUE}>Custom…</option>
      </select>

      {customMode ? (
        <input
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          placeholder="Custom baud rate"
          className="w-36 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
          disabled={disabled}
          value={customText}
          aria-invalid={customText.trim() !== '' && !customIsValid}
          onChange={(event) => {
            setCustomText(event.target.value)
          }}
          onBlur={() => {
            if (customIsValid) {
              setBaudRate(customValue)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && customIsValid) {
              setBaudRate(customValue)
            }
          }}
        />
      ) : null}

      {customMode && customText.trim() !== '' && !customIsValid ? (
        <span className="text-xs text-red-400">Enter a positive whole number</span>
      ) : null}
    </div>
  )
}
