# Contributing to Cutex Desktop

Thanks for helping. Bug reports and translation fixes are welcome as
[GitHub issues](https://github.com/senxiu-official/cutex-desktop/issues); for anything larger than a
small fix, open an issue first so we can agree on the approach. Security problems go to
[SECURITY.md](SECURITY.md), not to public issues.

## Before you start

- [docs/DESIGN.md](docs/DESIGN.md): architecture and product decisions. Per-feature proposals are in
  [docs/design/](docs/design/) (mostly in Chinese).
- [AGENTS.md](AGENTS.md): the short rule set for contributors and coding agents.
- [docs/desktop-modules.md](docs/desktop-modules.md) and [docs/module-dev-guide.md](docs/module-dev-guide.md):
  the module contract and how to write a module; [examples/](examples/README.md) has plugin examples
  and [docs/widget-authoring-guide.md](docs/widget-authoring-guide.md) covers home widgets.

The key rules: cutex is the daemon and the desktop is only a client (no business state or cutex
logic in TypeScript; if the desktop needs something cutex does not expose, it belongs in the cutex
Management v2 API). UI features never touch the local filesystem or a PTY directly; files, diffs and
terminals go through daemon APIs. Tokens stay in the Electron main process. External code runs only in
opaque frames.

## Build from source

You need Node.js 24 and pnpm (through corepack).

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm dev            # Electron dev run against the local cutex daemon
```

- `node scripts/package-portable.mjs <dest>` builds a portable package.
- `scripts/install-portable.sh` (Linux / macOS) and `scripts/install-portable.ps1` (Windows) build one
  into the self-updating install layout described in
  [docs/install/AGENT-INSTALL.md](docs/install/AGENT-INSTALL.md) (section 7).
- The app holds a single-instance lock. To run a dev build next to an installed one, set
  `CUTEX_DESKTOP_MULTI_INSTANCE=1` and `CUTEX_DESKTOP_USER_DATA=<dir>` (a separate settings folder).

## Dev preview without a daemon

```sh
pnpm --filter @cutex-desktop/app preview:web
```

This runs the interface in a plain browser against a mock bridge
(`apps/desktop/src/renderer/src/dev/mockBridge.ts`), with no Electron and no cutex. Each module keeps
its own mock data in `modules/<id>/mock.ts`; only `dev/` imports mocks, and production bundles drop
them.

## A private cutex for development

Never point tests or dev runs at a cutex daemon you use for real work. Build a **debug** cutex from
[cutex](https://github.com/senxiu-official/cutex) (`cargo build --locked --bin cutex`) and run it on a
private home and its own ports. On Windows, `scripts/dev-daemon.ps1` does this (management on
127.0.0.1:24370, home under `%USERPROFILE%\.cutex-desktop-dev`); its header shows how to start
`pnpm dev` against it.

## Tests and checks

- `pnpm typecheck` and `pnpm test` must pass before a change is merged.
- Tests run with Vitest per package (`pnpm --filter <package> test` for one package).
- Protocol types in `packages/protocol` are generated from a cute-codex binary
  (`pnpm gen:protocol [path-to-cute-codex]`), never written by hand.

## Code conventions

- Stack: Electron, React 19, TypeScript, Vite, Tailwind 4, shadcn/ui, Zustand.
- Every user-visible string goes through the message catalog; `zh-CN` and `en` ship complete, other
  locales may lag. Translation fixes are very welcome.
- Keep non-component exports (helpers, hooks) out of `components/*.tsx` so Fast Refresh works.
- Code adapted from [ZCode](https://github.com/zai-org/ZCode) (Apache-2.0) keeps its licence header,
  is marked as modified, is listed in [NOTICE](NOTICE), and carries no ZCode / Z.ai / GLM branding or
  service endpoints.

## Releases

The public repository is a published snapshot of the development repository. Each release is one
commit on the `release` branch, which is also the update channel of installed apps;
`EXPORT-MANIFEST.json` in the public repository lists every file of the snapshot with its SHA-256.
Binaries are built by GitHub Actions from the tagged commit and signed with minisign (see the install
guide, B.1). Accepted changes are applied in the development repository and arrive with the next
snapshot. Release notes are in [CHANGELOG.md](CHANGELOG.md).

The maintainers' working files (status, roadmap and work log) are kept in the development repository
and are not published here.
