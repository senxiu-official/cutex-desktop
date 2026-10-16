# Known issues

Known issues in **desktop 0.1.2** with **cutex 0.1.1**. The app shows the same list under
Settings → About → Known issues (`apps/desktop/src/renderer/src/modules/about/knownIssues.ts`);
keep both in sync.

Each entry: what you see, a workaround if there is one, and the version that is planned to fix it.

## Phone push / pairing a phone

There is no public phone app yet, so phone push notifications and pairing a phone are not
available.

- Workaround: none.
- Planned fix: not scheduled.

## In-app browser: LAN, private and tailnet addresses do not open

The in-app browser only opens public sites, loopback addresses and the host's cutex services.
Addresses on your local network, private ranges and tailnets (for example `192.168.x.x`, `10.x.x.x`,
`100.64.0.0/10`) are refused. The error message also mixes several causes ("external pages are
off" and "private address" read alike).

- Workaround: open these pages in your normal browser, or expose them as a cutex service.
- Planned fix: desktop 0.1.3.

## In-app browser: sharing a tab with an agent

On a tab an agent controls, any click, scroll or key press by you pauses the agent. The first click
only takes the tab over and does not reach the page. Resuming the agent asks for a second
confirmation.

- Workaround: none; click once to take over, then use the page.
- Planned fix: desktop 0.1.3 (you and the agent can both use the tab, an explicit Pause, one-click
  Resume).

## In-app browser: downloads, device permissions and POST pop-ups are blocked

Downloads, camera / microphone / other device permission prompts, and pop-up windows that submit a
form (POST) are blocked.

- Workaround: open the page in your normal browser.
- Planned fix: desktop 0.1.3 (a save dialog for downloads, per-site permissions you grant).

## In-app browser: pages can reach loopback ports

A web page open in the in-app browser can send requests to loopback ports on the desktop machine.
cutex's management API still requires its token.

- Workaround: only open sites you trust in the in-app browser.
- Planned fix: desktop 0.1.3.

## Job Service and NCI remote jobs need a Linux host

The Job Service component, and with it the Jobs page and NCI remote jobs, runs only on Linux cutex
hosts. See [docs/install/ANU.md](install/ANU.md) for NCI.

- Workaround: run these from a Linux host.
- Planned fix: not scheduled.

## macOS: front end only

On macOS the app is a front end only: cutex itself runs on another machine (Linux or Windows) that
you connect to over SSH.

- Workaround: run cutex on a Linux or Windows machine and add it as a host.
- Planned fix: not scheduled.
