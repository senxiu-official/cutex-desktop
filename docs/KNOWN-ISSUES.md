# Known issues

Known issues in the current public release: **desktop v0.2.0** with **cutex v0.2.0**. The app shows
the same list under Settings → About → Known issues from [known-issues.json](known-issues.json)
(schema in `apps/desktop/src/shared/knownIssues.ts`): its built-in copy, and the copy on the `release`
branch, which it fetches — so a docs push to `release` updates the list in installed apps. Change this
file and the JSON together (same entries, order, titles and planned fixes; a test checks them).

Each entry: what you see, a workaround if there is one, and the version that is planned to fix it.
Three entries below apply only to hosts still on cutex 0.1.x; a host on cutex v0.2.0 is not affected,
and the app hides them for such a host (`appliesTo` in the JSON). If a host still runs 0.1.x, update
it in Settings → Host backend updates.

## Phone push / pairing a phone

There is no public phone app yet, so phone push notifications and pairing a phone are not
available.

- Workaround: none.
- Planned fix: not scheduled.

## Windows (cutex 0.1.1 hosts): plain commands ask for approval in Auto mode

Only on hosts still running cutex 0.1.1, which cannot set up the Windows sandbox.

- Workaround: update that host (Settings → Host backend updates).
- Planned fix: cutex 0.1.2 (with desktop 0.1.3).

## Windows (cutex 0.1.1 hosts): a saved API-key Profile cannot start agents

Only on hosts still running cutex 0.1.1 ("object DACL is not service-private" when creating an agent).

- Workaround: update that host (Settings → Host backend updates); it repairs the file by itself.
- Planned fix: cutex 0.1.2.

## Windows (hosts before cutex 0.1.3): after the sandbox is set up, commands fail with Store PowerShell

Only on hosts still running cutex 0.1.2 or older whose PowerShell is the Microsoft Store version.

- Workaround: update that host (Settings → Host backend updates), then restart the agent.
- Planned fix: cutex 0.1.3 (native runtime cute-codex 0.160.0-r52.3).

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
