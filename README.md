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

## Deploying

The app is hosted on GitHub Pages at <https://b2slabs.github.io/serial-port/>.
`vite.config.ts` sets `base: '/serial-port/'` to match that subpath. Deploys
are a manual step (no CI automation in v1): build the app, then publish
`dist/` as the `gh-pages` branch via a throwaway worktree.

```bash
npm run build

rm -rf /tmp/gh-pages-worktree
git worktree add -f /tmp/gh-pages-worktree gh-pages 2>/dev/null \
  || git worktree add -f /tmp/gh-pages-worktree --orphan gh-pages

rm -rf /tmp/gh-pages-worktree/*
cp -r dist/* /tmp/gh-pages-worktree/
touch /tmp/gh-pages-worktree/.nojekyll

git -C /tmp/gh-pages-worktree add -A
git -C /tmp/gh-pages-worktree commit -m "Deploy $(git rev-parse --short HEAD)"
git -C /tmp/gh-pages-worktree \
  -c credential.helper= -c credential.helper="!gh auth git-credential" \
  push origin gh-pages

git worktree remove /tmp/gh-pages-worktree
```

GitHub Pages is configured (once) to serve from the `gh-pages` branch, root
folder:

```bash
gh api -X POST repos/b2slabs/serial-port/pages \
  -f "source[branch]=gh-pages" -f "source[path]=/"
```
