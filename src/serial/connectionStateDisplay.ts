import type { ConnectionState } from './types'

/**
 * Single source of truth for how the 6-value `ConnectionState` union is
 * classified and labeled for display. `ConnectionControls`, `ConnectionStatus`,
 * and `UnplugWarning` each used to hand-roll their own grouping/labeling of
 * these states (e.g. `'Reconnecting…'` was duplicated verbatim); they now all
 * consume this module instead so the six states have one definition of what
 * each one is called and which ones count as "transitional" or "recovering".
 */

/** Canonical short label for each connection state (used by `ConnectionStatus`, and reused by `ConnectionControls` for its button label while an attempt is in flight). */
export const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
  'unexpected-disconnect': 'Unexpected disconnect',
  reconnecting: 'Reconnecting…',
  error: 'Error',
}

/**
 * States where a connect attempt — manual or automatic — is in flight. The
 * manual Connect button is disabled during these (so a click can't race an
 * in-progress attempt) and shows the state's label instead of "Connect".
 */
export const CONNECT_ATTEMPT_IN_FLIGHT_STATES: ReadonlySet<ConnectionState> =
  new Set<ConnectionState>(['connecting', 'reconnecting'])

/**
 * States that warrant the prominent unplug/recovery banner (ticket #5),
 * mapped to the longer-form message shown for each. Tied directly to
 * connection state (rather than a dismiss flag) so the banner appears and
 * clears itself automatically as the state machine recovers.
 */
export const UNPLUG_RECOVERY_MESSAGES: Partial<Record<ConnectionState, string>> = {
  'unexpected-disconnect': 'USB device disconnected. Waiting for it to reconnect…',
  reconnecting: 'Reconnecting to the device…',
}
