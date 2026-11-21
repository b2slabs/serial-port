# Serial Port

A static, browser-based serial terminal built on the Web Serial API: pick a
port, pick a baud rate, watch live data in a terminal. No backend.

## Stack

React + TypeScript + Vite, [@xterm/xterm](https://github.com/xtermjs/xterm.js)
for the terminal, [Zustand](https://github.com/pmndrs/zustand) for
connection/UI state, Tailwind for layout.

## Architecture

Three layers:

- **`src/serial/SerialManager.ts`** — the only code that touches
  `navigator.serial` (via the narrow injectable interface in
  `src/serial/types.ts`). Owns port lifecycle, the cancelable read loop, and
  emits `statechange`/`data` events.
- **`src/store`** — a Zustand store (`connectionStore.ts`) that subscribes to
  `SerialManager`'s events and exposes actions/state to components via
  `ConnectionStoreProvider`. Components never call `SerialManager` or
  `navigator.serial` directly.
- **`src/components`** — React UI (connect/disconnect controls, baud rate
  selection, connection status, the xterm.js terminal).

## Scripts

```bash
npm run dev       # start the dev server
npm run build     # typecheck + production build
npm run test      # run the test suite once
npm run test:watch
npm run lint
```

## Browser support

Requires a Chromium-based browser (Chrome, Edge) and a secure context
(HTTPS, or localhost for dev) — the Web Serial API isn't available
elsewhere.
