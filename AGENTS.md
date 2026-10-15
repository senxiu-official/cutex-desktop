# Cutex desktop — contributor and agent guide

Electron + React 19 + TypeScript + Vite + Tailwind 4 + Zustand, pnpm workspace, Node 24.
Read `docs/DESIGN.md` (architecture and decisions) and `docs/desktop-modules.md` (module contract)
before larger changes.

## Principles

1. **cutex is the daemon, the desktop is a client.** Sessions, runtimes, queue, agent bus,
   projects and profiles live in cutex. Do not re-implement cutex logic in TypeScript; if the
   desktop needs something cutex does not expose, it belongs in the cutex Management v2 API.
2. **No direct local filesystem / PTY access from UI features.** File tree, diffs, terminal and
   similar features go through daemon APIs, so a remote host works the same as the local one.
3. **One agent = one cutex session = one native thread.** Fork creates a new agent; revert stays on
   the same agent.
4. **The renderer is untrusted.** Tokens stay in the Electron main process; the renderer talks to
   main through a narrow preload IPC bridge. The desktop exposes no local HTTP server.
5. **External code runs only in opaque frames** (`sandbox="allow-scripts"`, never
   `allow-same-origin`, no network, no preload / Node / token). See docs/desktop-modules.md §10.

## Layout

- `apps/desktop` — the Electron app (main, preload, renderer).
- `packages/protocol` — generated protocol types (`pnpm gen:protocol`; never hand-written).
- `packages/cutex-client` — Management v2 client (bootstrap, SSE with resume, commands).
- `packages/plugin-sdk`, `packages/plugin-host` — module contract and lifecycle only.
- `packages/opaque-frame`, `packages/plugin-sandbox` — the opaque frame shape and sandbox.
- `packages/browser-protocol`, `packages/browser-cdp` — in-app browser plumbing.
- `examples/plugins` — development examples of desktop plugins.

## Working on the UI

- `pnpm --filter @cutex-desktop/app preview:web` runs the renderer in a plain browser with the mock
  bridge (`apps/desktop/src/renderer/src/dev/mockBridge.ts`); a module keeps its own mock data in
  `modules/<id>/mock.ts`. Only `dev/` imports mocks; production bundles drop them.
- Keep non-component exports (helpers, hooks) out of `components/*.tsx` so Fast Refresh works.
- i18n from day one: every user-visible string goes through the message catalog (`zh-CN`, `en`).
- The app holds a single-instance lock; set `CUTEX_DESKTOP_MULTI_INSTANCE=1` and
  `CUTEX_DESKTOP_USER_DATA=<dir>` to run a dev build next to an installed one.

## Checks

`pnpm typecheck` and `pnpm test` must pass. Never point tests or dev runs at a production cutex
daemon; use a private debug daemon on its own port.
