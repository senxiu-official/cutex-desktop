# Known issues

Known issues in **desktop 0.1.5** with **cutex 0.1.5**. The app shows the same list under
Settings → About → Known issues from [known-issues.json](known-issues.json) (schema in
`apps/desktop/src/shared/knownIssues.ts`): its built-in copy, and the copy on the `release` branch,
which it fetches — so a docs push to `release` updates the list in installed apps. Change this file
and the JSON together (same entries, order, titles and planned fixes; a test checks them).

Each entry: what you see, a workaround if there is one, and the version that is planned to fix it.
Entries titled "cutex 0.1.1 hosts" apply only while a host still runs cutex 0.1.1, "hosts before cutex 0.1.3"
only while it runs 0.1.2 or older; the app hides them for a host on a fixed version (`appliesTo` in the JSON).

## Phone push / pairing a phone

There is no public phone app yet, so phone push notifications and pairing a phone are not
available.

- Workaround: none.
- Planned fix: not scheduled.

## Windows (cutex 0.1.1 hosts): plain commands ask for approval in Auto mode

When an agent on a Windows host has no Windows sandbox set up, the native runtime cannot confine
commands, so in Auto (自动) it asks you before every command. From cutex 0.1.2 the permission menu says
the sandbox is not ready and sets it up in one click (no administrator rights); a cutex 0.1.1 host has
no such setup.

- Workaround: update that host to cutex 0.1.2 (Settings → Host backend updates); or use Full access for
  now, or set up the sandbox on that host with cute-codex's `/setup-default-sandbox`.
- Planned fix: cutex 0.1.2 (with desktop 0.1.3).

## Windows (cutex 0.1.1 hosts): a saved API-key Profile cannot start agents

On Windows, after an API-key Profile's settings are saved, creating an agent fails with "object DACL
is not service-private": cutex wrote the credential file with only inherited permissions, and the launch
check requires its own private permissions.

- Workaround: update that host to cutex 0.1.2 (Settings → Host backend updates); it repairs the file by
  itself. Until then, in PowerShell, run on the auth.json named in the error
  `` icacls "<path from the error>" /inheritance:r /grant:r "$env:USERNAME`:F" `` (changes permissions only,
  not the contents).
- Planned fix: cutex 0.1.2.

## Windows (hosts before cutex 0.1.3): after the sandbox is set up, commands fail with Store PowerShell

On a Windows host where PowerShell is the Microsoft Store version, after "Set up sandbox (no
administrator)" (设置沙箱（无需管理员）) every command an agent runs fails with exit -1: the restricted
sandbox process cannot start a Store app. cutex 0.1.3 brings the native runtime cute-codex
0.160.0-r52.3, which uses an installed PowerShell or Windows PowerShell instead.

- Workaround: update that host to cutex 0.1.3 (Settings → Host backend updates), then restart the agent
  (idle agents move to the new runtime by themselves). Until then, install PowerShell on that host with
  winget (`winget install Microsoft.PowerShell`) or the MSI installer, then restart the agent; or leave
  the sandbox unset for now.
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
