# Known issues

Applies to **Cutex Desktop 0.2.2 — Beautiful World** with **cutex 0.2.1 — Beautiful World**,
unless an entry specifies an older host version. Update the desktop and each host separately.

The application displays these entries in Settings → About → Known issues. Three Windows entries
apply only to older cutex hosts; they are hidden when the connected host is outside the stated
version range. No release date is assigned to limitations without a fixed version.

## Phone pairing and push notifications unavailable

A public mobile app is not available. Phone pairing and mobile push notifications are unavailable.

- Workaround: None available.
- Fix schedule: not scheduled.

## Windows: Auto mode requires command approval on cutex 0.1.1

When an agent on a Windows host has no Windows sandbox set up, the native runtime cannot confine commands, so it requests approval for every command. From cutex 0.1.2 the permission menu says the sandbox is not ready and provides sandbox setup (no administrator rights); a cutex 0.1.1 host has no such setup.

- Affected host versions: `<0.1.2`.
- Workaround: Update that host to cutex 0.1.2 (Settings → Host backend updates); or use Full access for now, or set up the sandbox on that host with cute-codex's /setup-default-sandbox.
- Fixed in: cutex 0.1.2.

## Windows: API-key Profiles cannot create agents on cutex 0.1.1

On Windows, after an API-key Profile's settings are saved, creating an agent fails with “object DACL is not service-private”: cutex wrote the credential file with only inherited permissions, and the launch check requires its own private permissions.

- Affected host versions: `<0.1.2`.
- Workaround: Update that host to cutex 0.1.2 (Settings → Host backend updates); it repairs the file permissions automatically. Until then, in PowerShell, run on the auth.json named in the error: icacls "<path from the error>" /inheritance:r /grant:r "$env:USERNAME`:F" (changes permissions only, not the contents).
- Fixed in: cutex 0.1.2.

## Windows: sandbox commands fail with Store PowerShell before cutex 0.1.3

On a Windows host where PowerShell is the Microsoft Store version, after “Set up sandbox (no administrator)” every command an agent runs fails with exit -1: the restricted sandbox process cannot start a Store app. cutex 0.1.3 brings the native runtime cute-codex 0.160.0-r52.3, which uses an installed PowerShell or Windows PowerShell instead.

- Affected host versions: `<0.1.3`.
- Workaround: Update that host to cutex 0.1.3 (Settings → Host backend updates), then restart the agent (idle agents move to the new runtime by themselves). Until then, install PowerShell on that host with winget (winget install Microsoft.PowerShell) or the MSI installer, then restart the agent; or leave the sandbox unset for now.
- Fixed in: cutex 0.1.3.

## Job Service and NCI remote jobs require Linux

The Job Service component (needed by the Jobs page and NCI remote jobs) runs only on Linux cutex hosts.

- Workaround: Run these from a Linux host.
- Fix schedule: not scheduled.

## macOS provides the desktop client only

The macOS package provides the desktop client. Run cutex on a Windows or Linux host and connect through SSH.

- Workaround: Run cutex on a Linux or Windows machine and add it as a host.
- Fix schedule: not scheduled.

For NCI setup, see [NCI remote jobs](install/ANU.md).
