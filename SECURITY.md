# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub:
**[Report a vulnerability](https://github.com/senxiu-official/cutex-desktop/security/advisories/new)**
(Security tab of this repository → Advisories → Report a vulnerability).

Include the version (Settings → About), the operating system, the steps to reproduce and what an
attacker gains. We will acknowledge the report, keep you informed and credit you in the advisory
unless you prefer otherwise. Problems in the daemon or the agent runtime belong to
[cutex](https://github.com/senxiu-official/cutex/security/advisories/new) or
[cute-codex](https://github.com/senxiu-official/cute-codex/security/advisories/new); if you are not
sure, report here.

Only the latest public release is supported with fixes.

## Security model

Cutex Desktop is a client for the cutex daemon, built for one person (or a few people who trust each
other) running agents on machines they own.

- **The daemon owns the state.** Agents, sessions, projects, Profiles and their credentials live in
  cutex on each host. The desktop keeps no business state of its own and reaches files, diffs and
  terminals only through the daemon's API, locally or on a remote host.
- **Tokens stay in the Electron main process.** The renderer talks to main through a narrow preload
  bridge and never sees a daemon token or an API key. Client tokens for remote hosts are stored
  encrypted with the operating system's key store (Electron safeStorage). The desktop runs no local
  HTTP server for its own interface.
- **Remote hosts** are reached over SSH, or a private network you trust; pairing issues a client token
  over SSH. User identities on a shared host make it easy to share with people you know; they are not
  a security boundary against strangers.
- **External code runs only in opaque frames.** Desktop plugins (off by default) and HTML pages that
  agents publish run in sandboxed frames with an opaque origin (`sandbox="allow-scripts"`, never
  `allow-same-origin`), their own content security policy and no network at all, loopback included.
  They get no preload, Node.js, token or daemon access. Agent pages have exactly three fixed message
  channels, all decided in the main process: their own small storage, sending text to their agent
  only after you confirm in a native dialog, and copying during a click. Details:
  [docs/desktop-modules.md](docs/desktop-modules.md) §10.
- **In-app browser.** Browser tabs use their own session partitions, separate from the app. Tabs
  opened by agents use their own pool, and a tab you lend to an agent keeps your logins in that tab,
  which the grant dialog says. Network access is admitted per tab and origin by the main process;
  a page reaches a private (LAN / tailnet) address only from that same origin, and host control ports
  are never browser targets. When external browsing is on (Settings → Browser, on by default), browser
  traffic goes through a browser-only proxy on 127.0.0.1 with a random port and a per-run credential;
  it does not intercept TLS or cache. The app window, plugin and agent-page frames never use it and
  stay network-locked. Pop-ups, downloads and site permissions are decided only in the main process
  (a save dialog, or a prompt to you), never by the page or an agent.
- **Signed updates.** Release files are signed with minisign. The in-app updater checks the signature
  of a new package before switching to it and switches back if the new version does not start.

## Privacy

There is no account and no telemetry. The desktop contacts the release source (GitHub by default) to
check for updates and to read the known-issues list; update checks can be turned off in Settings →
Desktop updates & diagnostics. Everything else goes to your own hosts, and from there to the model
providers you configure in your Profiles.
