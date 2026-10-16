<p align="center">
  <img src="apps/desktop/resources/icons/icon-256.png" width="160" alt="Cutex logo">
</p>

<h1 align="center">Cutex desktop</h1>

<p align="center"><b>English</b> · <a href="README.zh-CN.md">简体中文</a></p>

**0.1.2**: optional backend components (Job Service, Claude runtime) install from the app; needs
cutex 0.1.1 for that (0.1.0 "First Take" was the first public release). See [CHANGELOG.md](CHANGELOG.md).

> **Known issues**: see [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md) (also in the app: Settings → About).
> The most important ones:
> - **In-app browser** cannot open LAN, private or tailnet addresses (fix planned for 0.1.3); open
>   them in your normal browser.
> - **Phone push / pairing a phone**: there is no public phone app yet.
>
> Claude agents and the Jobs page need optional cutex components (the Claude runtime; the Job
> Service, Linux only). Install them with the **Install** button where the app asks for one, or
> `cutex component install claude-runtime` / `job-service` on the host (cutex 0.1.1, managed
> install; [install guide](docs/install/AGENT-INSTALL.md) §6.1 / §6.2).

Cutex desktop is the desktop app for [cutex](https://github.com/senxiu-official/cutex), a daemon
that runs coding agents on your own machines. Agents run on
[cute-codex](https://github.com/senxiu-official/cute-codex) (a fork of OpenAI Codex) or on Claude Code.
All state lives in cutex; the app is a client, so agents keep running when it is closed.

Windows and Linux x64. On macOS it is a front end for one of your own machines that runs cutex.

## Features

**Agents working together**
- Several agents side by side, grouped into projects.
- Agents delegate tasks to each other and wait for the results; the 委托 / Delegations page shows who
  asked whom for what.
- Agents can ask you questions; you answer in the conversation.
- Queue, steer or interrupt a turn. Alarms wake an agent later; notifications tell you when one
  needs you.
- Side chats, notes and bookmarks on any message.

**Hosts and people**
- Add another machine over SSH: the desktop opens the tunnel and pairs by itself. Switch hosts, or
  show all of them at once.
- Files, diffs and terminals go through the daemon, so a remote host works like the local one.
- Several people can share a host as separate users, each with their own devices.

**Models and usage**
- Profiles for ChatGPT, Claude and OpenAI-compatible APIs. Each agent uses one; switch at any time.
- Quota and plan where the provider reports them.
- Token usage and cost across all hosts, merged by Profile. Usage from stand-alone Claude Code, Codex
  and ZCode can be added.

**Around the conversation**
- Files, diffs, terminal, artifacts, local services, and an in-app browser you can lend to an agent.
- Fork an agent, or revert it to an earlier turn.
- Every module can be turned off.

**Self-hosted**
- No account and no telemetry. API keys and tokens stay in the daemon and the app's main process.
- Apache-2.0.

## Install

Install from the release binaries (no compiler, about 15 minutes) or build cutex, cute-codex and the
desktop from source on your own machine. The guide covers both, and it is written so that either you
or an AI coding agent (Claude Code, Codex, …) can follow it end to end. The simplest way is to hand
it to your agent:

**[docs/install/AGENT-INSTALL.md](docs/install/AGENT-INSTALL.md)**

| Platform | What runs there |
|---|---|
| Linux x64 | cutex + agents + the desktop |
| Windows 10 / 11 x64 | cutex + agents + the desktop |
| macOS | the desktop only, connected over SSH to a Linux or Windows machine of yours that runs cutex |

From source, once the guide's prerequisites are in place, the desktop part is three commands. They are shown here
for Linux; the guide also has the Windows and macOS versions.

```sh
git clone --branch release https://github.com/senxiu-official/cutex-desktop.git ~/Applications/cutex-desktop/src
~/Applications/cutex-desktop/src/scripts/install-portable.sh --channel release
~/Applications/cutex-desktop/current/cutex
```

The desktop finds the local cutex by itself. Add a Profile (Settings → Profiles), then click
"New agent". The install follows the `release` branch and updates itself: when a new release is out,
an "Update" button appears in the sidebar.

## Release binaries

Each GitHub Release carries binaries built by GitHub Actions from the tagged commit:

| Repository | Files |
|---|---|
| [cutex](https://github.com/senxiu-official/cutex/releases) | `cutex` + `cutex-mcp` for Linux x64 and Windows x64 |
| [cute-codex](https://github.com/senxiu-official/cute-codex/releases) | the agent runtime (`codex-app-server`, `codex`, `codex-code-mode-host`) for Linux x64 and Windows x64 |
| [cutex-desktop](https://github.com/senxiu-official/cutex-desktop/releases) | the desktop for Linux x64 (`.tar.gz`), Windows x64 (`.zip`) and macOS arm64 / x64 (`.zip`) |

Every file is signed with minisign; the signature is the `.minisig` file next to it. Verify a
download with the release public key (also in
[docs/install/cutex-release.pub](docs/install/cutex-release.pub), and the key cutex trusts for its
own backend updates):

```sh
minisign -Vm <file> -P RWRH9INhAb2gACJAg/h5EBjbudos2LXj6K+5hRBEGeVLDKaKzE+FICmS
```

A desktop installed from a release package as the install guide describes (section B.4) updates
itself: when a newer release is published, an **Update** button appears next to Settings
(also in Settings → Updates & diagnostics). It downloads the new package, checks its signature
against the same key, switches to it and restarts, and switches back by itself if the new version
does not start.

The Windows and macOS apps are not code-signed with a paid certificate (no Apple Developer ID or
notarization, no Windows Authenticode). On the first start Windows SmartScreen says "Windows
protected your PC": click **More info → Run anyway**. macOS says the developer cannot be verified:
right-click the app → **Open**, or open System Settings → Privacy & Security → **Open Anyway**.
Linux needs nothing extra (on Ubuntu 23.10 and later, the AppArmor step in the guide). Building from
source stays available, see the guide.

## Documentation

- [docs/install/AGENT-INSTALL.md](docs/install/AGENT-INSTALL.md): install, update and troubleshooting
- [docs/QUICKSTART.md](docs/QUICKSTART.md): a short tour of the desktop (Chinese, with an English summary)
- [docs/install/ANU.md](docs/install/ANU.md): two optional modules, off by default: Claude Science
  (for anyone with a Claude Science account) and NCI remote jobs (for users of Australia's National
  Computational Infrastructure, e.g. Gadi)
- [docs/DESIGN.md](docs/DESIGN.md): architecture and product decisions
- [docs/desktop-modules.md](docs/desktop-modules.md) and
  [docs/module-dev-guide.md](docs/module-dev-guide.md): the module contract, and how to write a module

## Status

This is a first take. Its author uses it every day, but few others do yet. Expect rough edges,
especially on macOS and in the less-used modules.

- **Plugins are off by default.** Third-party code runs only in sandboxed frames with no network.
- **Remote access assumes your own network.** Machines are reached over SSH or a private tailnet that
  you trust. User identities make it easy to share a host with people you know; they are not a
  security boundary against strangers.

Bug reports and translation fixes are welcome as GitHub issues. If the project is useful to you, a
star on GitHub helps others find it.

## Build from source (development)

You need Node.js 24 and pnpm (via corepack).

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm dev            # Electron dev run against the local cutex daemon
```

- `node scripts/package-portable.mjs <dest>` builds a portable package.
- `scripts/install-portable.sh` (Linux / macOS) and `scripts/install-portable.ps1` (Windows) build
  one into the self-updating install layout described in the install guide.
- `pnpm --filter @cutex-desktop/app preview:web` runs the interface in a plain browser against a
  mock daemon, with no Electron and no cutex.

## Releases

The public repository is a published snapshot. Each release is one commit on the `release` branch,
which is also the update channel of installs. `EXPORT-MANIFEST.json` lists every file in the snapshot
with its SHA-256.

## Acknowledgements

Built with Codex, Claude, DeepSeek, GLM and Kimi. Product names are trademarks of their
owners; naming them implies no affiliation or endorsement.

Parts of the user interface are adapted from [ZCode](https://github.com/zai-org/ZCode)
(Apache-2.0, Copyright 2026 Z.AI Co., Ltd). The adapted files are listed in [NOTICE](NOTICE).

## License

Apache License 2.0: see [LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party material and its
licenses are listed in NOTICE and LICENSES/.
