# Installing Cutex (cutex + cute-codex + the desktop)

This guide installs everything on **your own computer** for one person, either from the signed
release binaries (section B, about 15 minutes, no compiler) or from source (sections 2 to 7). It is written
so that you can hand it to an AI coding agent (Claude Code, Codex, ...) and let it work through the
steps, or follow it yourself. From source, expect 1 to 2 hours on a first install, most of it Rust
compile time (much less on a machine with many cores), and 25 to 40 GB of free disk: a measured
Linux install used about 22 GB, half of it the cute-codex build directory, which you can delete
afterwards (section 12).

## 0. Read first

### What you are installing

```text
 Cutex desktop (Electron app)                you click here
      │  HTTP + SSE, 127.0.0.1:24270, token from ~/.cutex/config.json
      ▼
 cutex management service ──── cutex agent bus (127.0.0.1:24260)
      │  starts one native runtime per agent
      ▼
 cute-codex app-server (+ code-mode host)    talks to your model provider with your API key
```

- **cutex** is the daemon. Agents, sessions, projects and Profiles (model accounts) live in it,
  under `~/.cutex`. Closing the desktop does not stop your agents.
- **cute-codex** is the agent runtime (a fork of OpenAI Codex). cutex starts it for each agent.
- **The desktop** only displays and controls what cutex has. It never installs or starts cutex.

| Your computer | Supported |
|---|---|
| Linux x64 (Ubuntu 22.04+ or similar, systemd user session) | cutex, agents and the desktop |
| Windows 10 / 11 x64 | cutex, agents and the desktop |
| macOS | **the desktop only.** cutex's agent runtime does not support macOS. Run cutex on a Linux or Windows machine you own and connect to it over SSH (section 7.4) |

Section B installs the binaries attached to the GitHub Releases of these repositories; sections 2
to 7 build the same programs from them:

| Repository | Branch | What |
|---|---|---|
| `https://github.com/senxiu-official/cutex` | `release` | the daemon (`cutex`, `cutex-mcp`) |
| `https://github.com/senxiu-official/cute-codex` | `release` | the agent runtime (`codex-app-server`, `codex`, `codex-code-mode-host`) |
| `https://github.com/senxiu-official/cutex-desktop` | `release` | the desktop app (this repository) |

Use the `release` branch (or the release binaries) of all three: they are published together and
tested together. If one of them has no `release` branch yet, stop and ask whoever invited you.

### Rules for an AI agent following this guide

1. Run the steps in order and check the result of each step before going on. If a check fails, stop
   and report the exact command and output; do not improvise workarounds.
2. Never print, log or paste tokens or API keys (the contents of `~/.cutex/config.json`,
   `~/.cutex/profiles/*/auth.json`). API keys are entered by the person, in the desktop UI (section 8).
3. Ask the person before anything that needs administrator rights (`sudo`, an elevated shell,
   installing system packages) and before changing a system setting.
4. Do not touch an existing `~/.cutex` without asking: it may hold someone's agents. This guide
   assumes a fresh machine.
5. Placeholders look like `<this>`. Shell variables set in one step are reused in later steps of
   the same shell; if you open a new shell, set them again.

## 1. Prerequisites

### Every platform

- Outbound network access (HTTPS) to crates.io and static.crates.io (Rust crates), github.com and
  its download hosts (the repositories, cute-codex's git dependencies and the V8 archive of 3.2),
  the npm registry (registry.npmjs.org) and Electron's download (GitHub releases). A proxy that
  blocks any of these makes a build step fail.
- Section 7 needs a graphical desktop session to start the app, and sections 7.3 and 8 need the
  person at the screen.

### Linux

- git, curl, python3, a C/C++ toolchain and pkg-config. Ubuntu / Debian:

  ```sh
  sudo apt install -y git curl python3 build-essential pkg-config libssl-dev
  ```

- Rust via rustup (<https://rustup.rs>). cute-codex pins its toolchain (1.95.0) in
  `codex-rs/rust-toolchain.toml` and rustup installs it on first use; build cutex with the same one:

  ```sh
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  . "$HOME/.cargo/env"
  rustup toolchain install 1.95.0
  ```

- Node.js 24 with corepack. If `node --version` does not print `v24.x`, install it with nvm (no
  sudo; it adds a few lines to `~/.bashrc`):

  ```sh
  curl -fsSL -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  . "$HOME/.nvm/nvm.sh"
  nvm install 24
  node --version
  ```

  Check: `node --version` prints `v24.x`. If `nvm install 24` instead warns that `~/.npmrc` has a
  `prefix` (or `globalconfig`) setting that is incompatible with nvm, `node` stays the old version.
  Do not delete that setting without asking (global npm tools may live there); instead tell the
  desktop install which Node to use, in the shell of section 7.1:

  ```sh
  export CUTEX_DEV_NODE_DIR=$(ls -d ~/.nvm/versions/node/v24.*/bin | sort -V | tail -n 1)
  "$CUTEX_DEV_NODE_DIR/node" --version
  ```

  (`nvm use --delete-prefix 24` also works, but it removes the `prefix` line from `~/.npmrc` for
  good, so global npm tools installed under that prefix drop off PATH.)
- python3 (3.6 or newer, from the line above).
- `~/.local/bin` on PATH (section 5.2 puts `cutex` there). Ubuntu's `~/.profile` adds it only if
  the directory existed at login; check and add it if needed:

  ```sh
  mkdir -p ~/.local/bin
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile; export PATH="$HOME/.local/bin:$PATH" ;; esac
  ```

- A systemd user session (`systemctl --user status` works). To keep cutex running after you log out:
  `loginctl enable-linger "$USER"` (asks for your password via polkit on some distributions).

### Windows

- Git for Windows (<https://git-scm.com>).
- Visual Studio 2022 Build Tools with the workload **Desktop development with C++** (MSVC and a
  Windows SDK). Build in a **Developer PowerShell for VS 2022** (or run
  `Launch-VsDevShell.ps1 -Arch amd64`) so `cl.exe` and `link.exe` are on PATH.
- Rust via rustup-init.exe (<https://rustup.rs>), default host `x86_64-pc-windows-msvc`, then
  `rustup toolchain install 1.95.0`.
- Node.js 24 (the official installer or nvm-windows); corepack ships with it.
- Python 3 (`py --version`), used once to write the runtime manifest (section 5.3).
- Work under your user profile (for example `%USERPROFILE%\src`). cutex insists that its state is
  private to your user; directories elsewhere (for example a shared drive) can fail with
  `os error 5`.
- Configure git **before cloning** so the sources keep LF line endings (the native build embeds
  database migrations whose checksums depend on the exact bytes):

  ```powershell
  git config --global core.autocrlf false
  ```

### macOS (desktop only)

- Xcode command line tools: `xcode-select --install` (git, codesign).
- Node.js 24 with corepack.
- SSH access, with a key and no password prompt, to the Linux or Windows machine that runs cutex.

Skip to section 7 on a Mac.

## B. Install from release binaries

This path installs the same programs as sections 2 to 7 without compiling anything: about 15
minutes and 2 GB of disk. It needs no Rust, no C/C++ toolchain and no Node.js. Prerequisites from
section 1: Linux `curl`, `python3`, a systemd user session and `~/.local/bin` on PATH; Windows
Python 3 (`py`); macOS nothing for the desktop. Section 0's rules apply unchanged.

The GitHub Releases carry binaries built by GitHub Actions from the tagged commit of each
repository:

| Release | Files (`<platform>` = `linux-x64` or `windows-x64`) |
|---|---|
| `senxiu-official/cutex` → `v<version>` | `cutex-<version>-<platform>.tar.gz` (`cutex`, `cutex-mcp`), `manifest.json` |
| `senxiu-official/cute-codex` → `cute-codex-v<native version>` | `native-<native version>-<platform>.tar.gz` (`codex-app-server`, `codex`, `codex-code-mode-host`, the protocol schema) |
| `senxiu-official/cutex-desktop` → `v<version>` | `cutex-desktop-<version>-linux-x64.tar.gz`, `-windows-x64.zip`, `-macos-arm64.zip` (Apple silicon), `-macos-x64.zip` (Intel) |

Every file has a `<file>.minisig` signature next to it, and each release a `SHA256SUMS` (+
`.minisig`). The owner signs them offline with the release key; CI never holds it. The public key
(key id `00A0BD016183F447`) is the one cutex itself trusts for backend updates
(`src/upgrade/keys.rs` in the cutex repository) and is published as `docs/install/cutex-release.pub`
in this repository:

```text
RWRH9INhAb2gACJAg/h5EBjbudos2LXj6K+5hRBEGeVLDKaKzE+FICmS
```

The versions that belong together are the ones in the cutex release's `manifest.json` (`native.version`)
and in the table below; for this release:

| | Linux / Windows / macOS |
|---|---|
| `VERSION` (cutex) | `0.1.0` |
| `DESKTOP_VERSION` (desktop) | `0.1.1` |
| `NATIVE` (cute-codex) | `0.160.0-r52.2` |

### B.1 Download and verify

Install minisign: Ubuntu / Debian `sudo apt install minisign` (ask the person: it needs sudo),
Windows `winget install jedisct1.minisign`, macOS `brew install minisign`. Without sudo on Ubuntu /
Debian, unpack the distribution's own package for your user only:

```sh
mkdir -p ~/.local/opt/minisign && cd ~/.local/opt/minisign && apt download minisign && dpkg -x minisign_*.deb . && cd -
export PATH="$HOME/.local/opt/minisign/usr/bin:$PATH"; minisign -v
```

A file whose signature does not verify must not be used: stop and report it.

Linux (macOS: only the desktop line, with `macos-arm64` or `macos-x64` and `.zip`):

```sh
VERSION=0.1.0 DESKTOP_VERSION=0.1.1 NATIVE=0.160.0-r52.2 PLATFORM=linux-x64
PUB=RWRH9INhAb2gACJAg/h5EBjbudos2LXj6K+5hRBEGeVLDKaKzE+FICmS
mkdir -p ~/cutex-download && cd ~/cutex-download
get() { curl -fsSL --retry 3 -O "$1" && curl -fsSL --retry 3 -O "$1.minisig" && minisign -Vm "${1##*/}" -P "$PUB" \
  || { echo "STOP: ${1##*/} did not download or verify; do not use it"; return 1; }; }
get https://github.com/senxiu-official/cutex/releases/download/v$VERSION/cutex-$VERSION-$PLATFORM.tar.gz &&
get https://github.com/senxiu-official/cutex/releases/download/v$VERSION/manifest.json &&
get https://github.com/senxiu-official/cute-codex/releases/download/cute-codex-v$NATIVE/native-$NATIVE-$PLATFORM.tar.gz &&
get https://github.com/senxiu-official/cutex-desktop/releases/download/v$DESKTOP_VERSION/cutex-desktop-$DESKTOP_VERSION-$PLATFORM.tar.gz &&
echo "all downloads verified"
```

Windows (PowerShell):

```powershell
$Version = '0.1.0'; $DesktopVersion = '0.1.1'; $Native = '0.160.0-r52.2'; $Platform = 'windows-x64'
$Pub = 'RWRH9INhAb2gACJAg/h5EBjbudos2LXj6K+5hRBEGeVLDKaKzE+FICmS'
$Dl = "$env:USERPROFILE\cutex-download"; New-Item -ItemType Directory -Force $Dl | Out-Null; Set-Location $Dl
function Get-Signed($Url) {
  $name = $Url.Split('/')[-1]
  curl.exe -fsSL --retry 3 -o $name $Url; curl.exe -fsSL --retry 3 -o "$name.minisig" "$Url.minisig"
  minisign -Vm $name -P $Pub; if ($LASTEXITCODE -ne 0) { throw "signature of $name does not verify" }
}
Get-Signed "https://github.com/senxiu-official/cutex/releases/download/v$Version/cutex-$Version-$Platform.tar.gz"
Get-Signed "https://github.com/senxiu-official/cutex/releases/download/v$Version/manifest.json"
Get-Signed "https://github.com/senxiu-official/cute-codex/releases/download/cute-codex-v$Native/native-$Native-$Platform.tar.gz"
Get-Signed "https://github.com/senxiu-official/cutex-desktop/releases/download/v$DesktopVersion/cutex-desktop-$DesktopVersion-$Platform.zip"
```

Check: every file prints `Signature and comment signature verified`, then `all downloads verified`.
(Each package's own `.minisig` is what proves it; the releases' `SHA256SUMS` files are an extra
listing for people who check hashes by hand. They share one name, so download them into a
directory per repository if you want them.)

### B.2 Install cutex

First create `~/.cutex` with its tokens exactly as in **section 5.1**. Then unpack cutex next to
its `manifest.json` and let `cutex service install` copy both into the install base. The signed
manifest makes this a managed install of release `$VERSION` (sequence and commit recorded), which is
what the in-app **Backend updates** need later.

Linux:

```sh
cd ~/cutex-download
mkdir -p cutex-$VERSION && tar -xzf cutex-$VERSION-$PLATFORM.tar.gz -C cutex-$VERSION
cp manifest.json manifest.json.minisig cutex-$VERSION/
cutex-$VERSION/cutex --version            # cutex 0.1.0 (0.1.0, <commit>)
cutex-$VERSION/cutex service install --channel release --no-start
CUTEX_BASE=~/.local/share/cutex
RELEASE_DIR="$CUTEX_BASE/releases/$VERSION"
ls "$RELEASE_DIR"                          # cutex  cutex-mcp  manifest.json  manifest.json.minisig
mkdir -p ~/.local/bin && ln -sfn "$CUTEX_BASE/current/cutex" ~/.local/bin/cutex
cutex service status
cutex upgrade status
grep '"home"' ~/.cutex/archive/fresh-agent-permissions/migration.json
```

Windows:

```powershell
Set-Location "$env:USERPROFILE\cutex-download"
New-Item -ItemType Directory -Force "cutex-$Version" | Out-Null
tar -xzf "cutex-$Version-$Platform.tar.gz" -C "cutex-$Version"
Copy-Item manifest.json, manifest.json.minisig "cutex-$Version\"
& ".\cutex-$Version\cutex.exe" --version
& ".\cutex-$Version\cutex.exe" service install --channel release --no-start
$CutexBase = "$env:LOCALAPPDATA\cutex"
$env:RELEASE_DIR = "$CutexBase\releases\$Version"
Get-ChildItem $env:RELEASE_DIR
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ";$CutexBase\bin", 'User')
$env:Path += ";$CutexBase\bin"
cutex service status
cutex upgrade status
Select-String '"home"' "$env:USERPROFILE\.cutex\archive\fresh-agent-permissions\migration.json"
```

Check: `cutex upgrade status` prints `installed  0.1.0` (`cutex upgrade status --json` shows
`"managed": true` and the release's `sequence` above 0), and the last line prints `"home": "fresh"`
(section 5.2 explains the record). The services are installed but not started yet.

### B.3 Install the runtime files

Unpack cute-codex into its own `natives/<version>` directory (never over an existing one: agents pin
these files), then write and select the runtime manifest exactly as in section 5.3.

Linux:

```sh
N="$CUTEX_BASE/natives/$NATIVE"
if [ -e "$N/codex-app-server" ]; then echo "natives $NATIVE already installed, not unpacked"; else
  mkdir -p "$N" && tar -xzf ~/cutex-download/native-$NATIVE-$PLATFORM.tar.gz -C "$N"
fi
"$N/codex-app-server" --version
NATIVE_COMMIT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["commit"])' "$N/cute-codex-build.json")
export N RELEASE_DIR NATIVE_COMMIT
```

Windows:

```powershell
$env:N = "$CutexBase\natives\$Native"
if (Test-Path "$env:N\codex-app-server.exe") { "natives $Native already installed, not unpacked" } else {
  New-Item -ItemType Directory -Force $env:N | Out-Null
  tar -xzf "$env:USERPROFILE\cutex-download\native-$Native-$Platform.tar.gz" -C $env:N
}
& "$env:N\codex-app-server.exe" --version
$env:NATIVE_COMMIT = (Get-Content "$env:N\cute-codex-build.json" | ConvertFrom-Json).commit
```

Check: `codex-app-server --version` prints `codex-app-server 0.160.0-r52.2`. Now save the Python
script of section 5.3 as `~/cutex-download/write-manifest.py` (Windows:
`%USERPROFILE%\cutex-download\write-manifest.py`; a binary install has no `~/src`; it reads `N`,
`RELEASE_DIR` and `NATIVE_COMMIT`), run
it and select the manifest with `cutex human install-runtime` (section 5.3, from "Write the manifest"
to its check).

Then start cutex and check it: **section 6**.

### B.4 Install the desktop

The package is the same portable layout as section 7, without the `src/` checkout. Installed as
below (`releases/<version>` + `current`, channel `release`), it updates itself from the GitHub
Releases (B.5).

Linux:

```sh
DESKTOP_BASE=~/Applications/cutex-desktop
mkdir -p "$DESKTOP_BASE/releases/$DESKTOP_VERSION"
tar -xzf ~/cutex-download/cutex-desktop-$DESKTOP_VERSION-linux-x64.tar.gz -C "$DESKTOP_BASE/releases/$DESKTOP_VERSION" --strip-components=1
ln -sfn "$DESKTOP_BASE/releases/$DESKTOP_VERSION" "$DESKTOP_BASE/current"
echo release > "$DESKTOP_BASE/channel"
test -x "$DESKTOP_BASE/current/cutex" && echo "desktop ok"
sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null
```

If the last line prints `= 1` (Ubuntu 23.10 and later), the app needs an AppArmor profile before its
first start (section 7.1 explains why). First check whether one is already loaded for this path
(e.g. from an earlier install): if this prints a profile file, skip the rest of this step.

```sh
grep -ls "$(realpath "$DESKTOP_BASE")/releases/\*/cutex" /etc/apparmor.d/* 2>/dev/null
```

Otherwise write it, then ask the person to run the two `sudo` commands:

```sh
RBASE=$(realpath "$DESKTOP_BASE")
cat > "$DESKTOP_BASE/apparmor-cutex-desktop" <<EOF
abi <abi/4.0>,
include <tunables/global>

profile cutex-desktop "$RBASE/releases/*/cutex" flags=(unconfined) {
  userns,
  include if exists <local/cutex-desktop>
}
EOF
echo "sudo install -m 644 \"$DESKTOP_BASE/apparmor-cutex-desktop\" /etc/apparmor.d/cutex-desktop"
echo "sudo apparmor_parser -r /etc/apparmor.d/cutex-desktop"
```

(If `/etc/apparmor.d/cutex-desktop` already exists for another install, use another profile name
in both the file and the commands.) Start the app in the graphical session:
`"$DESKTOP_BASE/current/cutex"`.

Windows:

```powershell
$DesktopBase = "$env:LOCALAPPDATA\Programs\cutex-desktop-app"
$Rel = "$DesktopBase\releases\$DesktopVersion"
New-Item -ItemType Directory -Force "$DesktopBase\releases" | Out-Null
Expand-Archive "$env:USERPROFILE\cutex-download\cutex-desktop-$DesktopVersion-windows-x64.zip" -DestinationPath "$DesktopBase\releases\unpack-$DesktopVersion"
Move-Item "$DesktopBase\releases\unpack-$DesktopVersion\cutex-desktop-$DesktopVersion-windows-x64" $Rel
Remove-Item "$DesktopBase\releases\unpack-$DesktopVersion"
if (Test-Path "$DesktopBase\current") { (Get-Item "$DesktopBase\current").Delete() }
New-Item -ItemType Junction -Path "$DesktopBase\current" -Target $Rel | Out-Null
Set-Content -Path "$DesktopBase\channel" -Value release
Get-ChildItem "$DesktopBase\current\cutex.exe"
& "$DesktopBase\current\cutex.exe"
```

The first start creates the Start-menu shortcut **Cutex**; start the app from there afterwards.
Windows SmartScreen warns about the downloaded program (B.6).

macOS (the desktop only; connect to your cutex machine as in section 7.4). The app lives in
`~/Applications/cutex-desktop/releases/<version>.noindex/Cutex.app` (`.noindex`: Spotlight lists only
the launcher); on its first start it creates `~/Applications/Cutex.app`, a copy it keeps on the
current version, which is the one to start (and pin to the Dock) from then on:

```sh
cd ~/cutex-download
DESKTOP_VERSION=0.1.1
ARCH=$( [ "$(uname -m)" = arm64 ] && echo arm64 || echo x64 )
# (download and verify cutex-desktop-$DESKTOP_VERSION-macos-$ARCH.zip as in B.1)
DESKTOP_BASE=~/Applications/cutex-desktop
REL="$DESKTOP_BASE/releases/$DESKTOP_VERSION.noindex"
mkdir -p "$DESKTOP_BASE/releases"
ditto -x -k cutex-desktop-$DESKTOP_VERSION-macos-$ARCH.zip "$DESKTOP_BASE/releases/unpack-$DESKTOP_VERSION"
mv "$DESKTOP_BASE/releases/unpack-$DESKTOP_VERSION/cutex-desktop-$DESKTOP_VERSION-macos-$ARCH" "$REL"
rm -r "$DESKTOP_BASE/releases/unpack-$DESKTOP_VERSION"
xattr -dr com.apple.quarantine "$REL/Cutex.app"
codesign --verify --deep --strict "$REL/Cutex.app" && echo "signature ok"
ln -sfn "$REL" "$DESKTOP_BASE/current"
echo release > "$DESKTOP_BASE/channel"
open "$DESKTOP_BASE/current/Cutex.app"
```

Check: `signature ok`, and about 20 seconds after the window appears `~/Applications/Cutex.app`
exists. If `~/Applications/Cutex.app` already existed (an earlier install that copied the app there
by hand), the app leaves it alone and it stays on its old version: quit Cutex, move that copy to the
Trash, and start `"$DESKTOP_BASE/current/Cutex.app"` once more. If macOS still blocks the first start,
see B.6.

Then go on with **section 7.3** (first start) and **section 8** (first Profile and agent).

### B.5 Updating a binary install

- **cutex** (and the runtime files it brings): Settings → Host backend updates. When a newer signed
  release is published, it downloads it, verifies the signature, waits until no agent is working,
  switches and checks the result (rolling back by itself on failure). By hand: `cutex upgrade check`,
  then `cutex upgrade apply` (`docs/backend-upgrade.md` in the cutex repository).
- **The desktop** (Linux, Windows, macOS): when a newer release is published, an **Update** button appears
  next to Settings, and Settings → Updates & diagnostics shows "New version <version>". The app asks
  `api.github.com` for the latest release of `senxiu-official/cutex-desktop` (at most once an hour in
  the background; **Check now** asks at once). **Update** downloads the platform package with its
  `.minisig`, `SHA256SUMS` and `SHA256SUMS.minisig` into `<desktop base>/.update-download` (only from
  github.com and GitHub's download hosts), verifies both signatures with the release key above (or
  the spare key `D12869DA9D6F784E`, `docs/install/cutex-release-spare.pub`) and the package's
  SHA-256 against the signed `SHA256SUMS`, unpacks it into `releases/<new version>` (macOS:
  `<new version>.noindex`, unpacked with `ditto`, the quarantine mark removed and the app's signature
  checked with `codesign --verify --deep --strict`, then `~/Applications/Cutex.app` refreshed), points
  `current` at it and restarts. If anything does not verify, nothing changes and the button says
  **Retry update**. If the new version does not come up within 25 seconds, `current` is switched back
  to the previous release by itself. Older releases are tidied up as in section 9 (Old releases).
  It needs network access to github.com, nothing else (no git, no Node.js). It uses the computer's
  proxy settings the way Chrome does (Windows / macOS system proxy including automatic configuration,
  Linux desktop proxy settings or `HTTPS_PROXY`). A proxy that asks for a user name and password is not
  supported yet: Settings → Updates & diagnostics then says the update source cannot be reached
  (update by hand, below).

  The same by hand (e.g. without network access from the app): download and verify the new package
  (B.1), unpack it next to the old one as `releases/<new version>` and point `current` at it (Linux:
  the `ln -sfn` line of B.4; Windows: the junction lines of B.4; macOS: the lines of B.4 from `REL=`
  to `ln -sfn`), then quit the app from the tray and start it again.

### B.6 Unsigned app warnings

The binaries are signed with the minisign key above, but not with a paid code-signing certificate
(no Apple Developer ID or notarization, no Windows Authenticode), so the operating system does not
know the publisher:

- **Windows**: SmartScreen says "Windows protected your PC" on the first start: click
  **More info → Run anyway**. To clear the download mark for the whole folder instead:
  `Get-ChildItem -Recurse "$DesktopBase\releases\$DesktopVersion" | Unblock-File`.
- **macOS**: "Cutex cannot be opened because the developer cannot be verified" (or "Apple could not
  verify…"). Right-click (Control-click) `Cutex.app` → **Open** → **Open**; on macOS 15 and later,
  open System Settings → Privacy & Security and click **Open Anyway**, then confirm. The keychain
  prompt of section 10 applies too.
- **Linux**: nothing beyond the AppArmor step of B.4.

The cutex and cute-codex command-line programs get no such warnings (they are not started from
Explorer or Finder).

## 2. Get the sources

Sections 2 to 7 are the from-source path. Skip them if you installed from the release binaries
(section B).


Linux:

```sh
mkdir -p ~/src && cd ~/src
git clone --branch release https://github.com/senxiu-official/cutex.git
git clone --branch release https://github.com/senxiu-official/cute-codex.git
```

Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\src" | Out-Null
Set-Location "$env:USERPROFILE\src"
git clone --branch release https://github.com/senxiu-official/cutex.git
git clone --branch release https://github.com/senxiu-official/cute-codex.git
```

Check: `git -C cute-codex log -1 --oneline` and `git -C cutex log -1 --oneline` both print a commit.

## 3. Build cute-codex (the agent runtime)

You need four files from cute-codex, all built from the same commit:

| File (Windows: `.exe`) | Built by |
|---|---|
| `codex-app-server` | `cargo build -p codex-app-server` |
| `codex` (the terminal UI; optional for the desktop) | `cargo build -p codex-cli` |
| `codex-code-mode-host` | `cargo build -p codex-code-mode-host` (needs a V8 download, 3.2) |
| `codex_app_server_protocol.schemas.json` | copied from the source tree |

Build from an **LF export** of the commit (`git archive`), not from the working copy. This is how
every cute-codex release is built: the runtime embeds SQL migrations whose checksums must match the
bytes in git.

### 3.1 Export and build the app-server and the CLI

Linux:

```sh
cd ~/src
NATIVE_COMMIT=$(git -C cute-codex rev-parse HEAD)
mkdir -p ~/src/build/native
git -C cute-codex -c core.autocrlf=false archive --format=tar --prefix=native/ "$NATIVE_COMMIT" | tar -x -C ~/src/build
cd ~/src/build/native/codex-rs
cargo fetch --locked
cargo build --locked --release -p codex-cli -p codex-app-server --bin codex --bin codex-app-server
```

Windows (Developer PowerShell):

```powershell
Set-Location "$env:USERPROFILE\src"
$NativeCommit = (git -C cute-codex rev-parse HEAD).Trim()
New-Item -ItemType Directory -Force "$env:USERPROFILE\src\build" | Out-Null
git -C cute-codex -c core.autocrlf=false archive --format=tar --prefix=native/ -o "$env:USERPROFILE\src\build\native.tar" $NativeCommit
tar -xf "$env:USERPROFILE\src\build\native.tar" -C "$env:USERPROFILE\src\build"
Set-Location "$env:USERPROFILE\src\build\native\codex-rs"
cargo fetch --locked
cargo build --locked --release -p codex-cli -p codex-app-server --bin codex --bin codex-app-server
```

Check: `target/release/codex-app-server --version` prints `codex-app-server <version>` (for example
`0.160.0-r52.2`). Remember that version; section 5 uses it. Compiler `warning:` lines are expected
in this and the other builds; only `error:` lines (and a non-zero exit) mean the build failed.

### 3.2 Build the code-mode host

`codex-code-mode-host` links V8 with its sandbox feature. The prebuilt V8 archive for that build
is published by OpenAI on the `rusty-v8-v<version>` release of `openai/codex`, not by
`denoland/rusty_v8` (a plain `cargo build` fails with a 404 download error). The source tree pins
the expected checksums in `third_party/v8/`, so the download is verified before use.

Linux:

```sh
cd ~/src/build/native
V8=$(awk '/^name = "v8"$/{getline; gsub(/[^0-9.]/,""); print; exit}' codex-rs/Cargo.lock)   # e.g. 150.4.0
T=x86_64-unknown-linux-gnu
P=ptrcomp_sandbox_release
BASE=https://github.com/openai/codex/releases/download/rusty-v8-v$V8
mkdir -p ~/src/build/v8 && cd ~/src/build/v8
for f in rusty_v8_${P}_$T.sha256 librusty_v8_${P}_$T.a.gz src_binding_${P}_$T.rs; do
  curl -fsSL --retry 3 -o "$f" "$BASE/$f"
done
# the manifest must match the pin in the source tree, and the two files must match the manifest
grep -F "  rusty_v8_${P}_$T.sha256" ~/src/build/native/third_party/v8/rusty_v8_${V8//./_}_release_manifests.sha256 | sha256sum --check -
sha256sum --check rusty_v8_${P}_$T.sha256
export RUSTY_V8_ARCHIVE=$PWD/librusty_v8_${P}_$T.a.gz RUSTY_V8_SRC_BINDING_PATH=$PWD/src_binding_${P}_$T.rs
cd ~/src/build/native/codex-rs
cargo build --locked --release -p codex-code-mode-host --bin codex-code-mode-host
```

Windows (same shell as 3.1):

```powershell
Set-Location "$env:USERPROFILE\src\build\native"
$V8 = (Select-String -Path codex-rs\Cargo.lock -Pattern '^name = "v8"$' -Context 0,1).Context.PostContext[0] -replace '[^0-9.]', ''
$T = 'x86_64-pc-windows-msvc'; $P = 'ptrcomp_sandbox_release'
$Base = "https://github.com/openai/codex/releases/download/rusty-v8-v$V8"
$V8Dir = "$env:USERPROFILE\src\build\v8"; New-Item -ItemType Directory -Force $V8Dir | Out-Null
$Manifest = "rusty_v8_${P}_$T.sha256"; $Archive = "rusty_v8_${P}_$T.lib.gz"; $Binding = "src_binding_${P}_$T.rs"
foreach ($f in $Manifest, $Archive, $Binding) { curl.exe -fsSL --retry 3 -o "$V8Dir\$f" "$Base/$f" }
$pins = "third_party\v8\rusty_v8_$($V8 -replace '\.', '_')_release_manifests.sha256"
$expected = ((Get-Content $pins | Where-Object { $_ -like "*  $Manifest" }) -split '\s+')[0]
if ((Get-FileHash -Algorithm SHA256 "$V8Dir\$Manifest").Hash.ToLower() -ne $expected) { throw 'V8 manifest checksum mismatch' }
foreach ($line in Get-Content "$V8Dir\$Manifest" | Where-Object { $_.Trim() }) {
  $hash, $name = $line.Trim() -split '\s+', 2
  if ((Get-FileHash -Algorithm SHA256 "$V8Dir\$name").Hash.ToLower() -ne $hash) { throw "$name checksum mismatch" }
}
$env:RUSTY_V8_ARCHIVE = "$V8Dir\$Archive"; $env:RUSTY_V8_SRC_BINDING_PATH = "$V8Dir\$Binding"
Set-Location codex-rs
cargo build --locked --release -p codex-code-mode-host --bin codex-code-mode-host
```

Check: `target/release/codex-code-mode-host` (`.exe`) exists. Any checksum mismatch: stop, do not
build with an unverified download.

## 4. Build cutex

Linux:

```sh
cd ~/src/cutex
CUTEX_COMMIT=$(git rev-parse HEAD) CUTEX_CHANNEL=release cargo +1.95.0 build --locked --release --bin cutex --bin cutex-mcp
./target/release/cutex --version
```

Windows (Developer PowerShell):

```powershell
Set-Location "$env:USERPROFILE\src\cutex"
$env:CUTEX_COMMIT = (git rev-parse HEAD).Trim(); $env:CUTEX_CHANNEL = 'release'
cargo +1.95.0 build --locked --release --bin cutex --bin cutex-mcp
.\target\release\cutex.exe --version
```

Check: `cutex --version` prints `cutex 0.1.0 (<7-char commit>)` (warnings during the build are
expected; only `error:` matters). `CUTEX_COMMIT` names the install
(`dev-<commit>`) and `CUTEX_CHANNEL=release` records the channel; neither changes behaviour.

## 5. Set up the cutex home and the runtime

### 5.1 Create `~/.cutex` with its tokens

cutex keeps all state in `~/.cutex` (Windows: `%USERPROFILE%\.cutex`). The desktop finds the local
daemon through `management_api_token` in `~/.cutex/config.json`; a fresh cutex does not create that
token, so create it now (two different random tokens, never printed):

Linux:

```sh
mkdir -p ~/.cutex/codex-home && chmod 700 ~/.cutex ~/.cutex/codex-home
touch ~/.cutex/codex-home/config.toml
python3 - <<'PY'
import json, os, secrets
p = os.path.expanduser("~/.cutex/config.json")
c = json.load(open(p)) if os.path.exists(p) else {}
c.setdefault("agent_bus_enabled", True)
c.setdefault("agent_bus_token", secrets.token_hex(32))
c.setdefault("management_api_token", secrets.token_hex(32))
assert c["agent_bus_token"] != c["management_api_token"]
fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(c, f, indent=2)
print("config.json ok:", sorted(c))
PY
```

Windows (PowerShell):

```powershell
$CutexHome = "$env:USERPROFILE\.cutex"
New-Item -ItemType Directory -Force "$CutexHome\codex-home" | Out-Null
if (-not (Test-Path "$CutexHome\codex-home\config.toml")) { New-Item -ItemType File "$CutexHome\codex-home\config.toml" | Out-Null }
@'
import json, os, secrets
p = os.path.join(os.environ["USERPROFILE"], ".cutex", "config.json")
c = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
c.setdefault("agent_bus_enabled", True)
c.setdefault("agent_bus_token", secrets.token_hex(32))
c.setdefault("management_api_token", secrets.token_hex(32))
assert c["agent_bus_token"] != c["management_api_token"]
json.dump(c, open(p, "w", encoding="utf-8"), indent=2)
print("config.json ok:", sorted(c))
'@ | py -
```

Check: the script prints `config.json ok: ['agent_bus_enabled', 'agent_bus_token', 'management_api_token']`.
If you ever edit `config.json` by hand, keep it valid JSON: cutex silently falls back to all defaults
(and loses the token) when it cannot parse the file.

### 5.2 Install the services

`cutex service install` copies the `cutex` and `cutex-mcp` you just built into an install base and
registers the background services:

| | Install base | Services |
|---|---|---|
| Linux | `~/.local/share/cutex` | systemd user units `cutex-agent-bus.service`, `cutex-management-api.service` |
| Windows | `%LOCALAPPDATA%\cutex` | Task Scheduler task `\Cutex\cutex-supervisor` (runs at logon, no admin rights) |

Install without starting yet (the runtime is selected first):

Linux:

```sh
~/src/cutex/target/release/cutex service install --channel release --no-start
CUTEX_BASE=~/.local/share/cutex
ls "$CUTEX_BASE/releases"            # one directory: dev-<commit>
mkdir -p ~/.local/bin && ln -sfn "$CUTEX_BASE/current/cutex" ~/.local/bin/cutex
cutex service status
grep '"home"' ~/.cutex/archive/fresh-agent-permissions/migration.json
```

Windows:

```powershell
& "$env:USERPROFILE\src\cutex\target\release\cutex.exe" service install --channel release --no-start
$CutexBase = "$env:LOCALAPPDATA\cutex"
Get-ChildItem "$CutexBase\releases"   # one directory: dev-<commit>
# put cutex on PATH for your user (new shells pick it up)
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ";$CutexBase\bin", 'User')
$env:Path += ";$CutexBase\bin"
cutex service status
Select-String '"home"' "$env:USERPROFILE\.cutex\archive\fresh-agent-permissions\migration.json"
```

Check: `cutex service status` prints a JSON document about both services. They are installed but
not started yet, so `inactive` (Linux `ActiveState`) is correct here; section 6 starts them.

The first `cutex` command on a new home decides once whether new agents get the new **Auto**
default (a fresh home) or keep full access (a home from an older install) and records it in
`~/.cutex/archive/fresh-agent-permissions/migration.json` (Windows: `%USERPROFILE%\.cutex\...`).
The last line must print `"home": "fresh"`. If it says `"existing"`, or a command printed
`cutex fresh-agent-permissions: existing home keeps full access for new agents (...)` to stderr,
cutex took this home for an old one and wrote the old full-access defaults into `config.json`
(older cutex builds did that for a home made with section 5.1); section 8 shows how to undo it.

Note: the desktop app's own executable is also called `cutex` (`cutex.exe`). Only the install base
above goes on PATH, never the desktop's folder.

### 5.3 Select the runtime for new agents

New agents start from a **runtime bundle manifest**: a JSON file that pins the cute-codex files and
the `cutex-mcp` tool facade by path and SHA-256. cutex refuses to start an agent if any pinned file
changes, so copy the cute-codex files to a directory you will not rebuild into.

Linux (the release build carries debug info; `strip -o` copies the binaries without it, about
0.6 GB per version instead of 2.6 GB):

```sh
CUTEX_BASE=~/.local/share/cutex
NATIVE_COMMIT=$(git -C ~/src/cute-codex rev-parse HEAD)      # the commit built in 3.1
RELEASE_DIR="$CUTEX_BASE/releases/dev-$(git -C ~/src/cutex rev-parse HEAD | cut -c1-7)"
test -x "$RELEASE_DIR/cutex-mcp" && echo "release dir ok: $RELEASE_DIR"
NATIVE_VERSION=$(~/src/build/native/codex-rs/target/release/codex-app-server --version | awk '{print $2}')
N="$CUTEX_BASE/natives/$NATIVE_VERSION"
# Existing agents pin the files of $N: never overwrite them. Copy only into a new version.
if [ -e "$N/codex-app-server" ]; then echo "natives $NATIVE_VERSION already installed, not copied"; else
  mkdir -p "$N"
  for f in codex-app-server codex codex-code-mode-host; do
    strip -o "$N/$f" ~/src/build/native/codex-rs/target/release/$f
  done
  cp ~/src/build/native/codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json "$N/"
fi
"$N/codex-app-server" --version && du -sh "$N"
export N RELEASE_DIR NATIVE_COMMIT
```

`RELEASE_DIR` is the release `cutex service install` made from the cutex you built in section 4
(`dev-<first 7 characters of its commit>`); the check line must print `release dir ok`. These lines
recompute everything, so they also work in a new shell.

Windows:

```powershell
$NativeVersion = ((& "$env:USERPROFILE\src\build\native\codex-rs\target\release\codex-app-server.exe" --version) -split ' ')[1]
$env:N = "$CutexBase\natives\$NativeVersion"
# Existing agents pin the files of $env:N: never overwrite them. Copy only into a new version.
if (Test-Path "$env:N\codex-app-server.exe") { "natives $NativeVersion already installed, not copied" } else {
  New-Item -ItemType Directory -Force $env:N | Out-Null
  foreach ($f in 'codex-app-server.exe', 'codex.exe', 'codex-code-mode-host.exe') { Copy-Item "$env:USERPROFILE\src\build\native\codex-rs\target\release\$f" $env:N }
  Copy-Item "$env:USERPROFILE\src\build\native\codex-rs\app-server-protocol\schema\json\codex_app_server_protocol.schemas.json" $env:N
}
$env:RELEASE_DIR = "$CutexBase\releases\dev-" + (git -C "$env:USERPROFILE\src\cutex" rev-parse HEAD).Trim().Substring(0, 7)
if (-not (Test-Path "$env:RELEASE_DIR\cutex-mcp.exe")) { throw "no release dir $env:RELEASE_DIR" }
$env:NATIVE_COMMIT = (git -C "$env:USERPROFILE\src\cute-codex" rev-parse HEAD).Trim()
```

Write the manifest (`python3` on Linux, `py` on Windows; the same script):

```python
import hashlib, json, os, sys
exe = ".exe" if os.name == "nt" else ""
n, rel, commit = os.environ["N"], os.environ["RELEASE_DIR"], os.environ["NATIVE_COMMIT"]
def pin(path):
    path = os.path.realpath(path)
    with open(path, "rb") as f:
        return {"path": path, "sha256": hashlib.sha256(f.read()).hexdigest()}
manifest = {
    "version": 4,
    "upstream_commit": commit,          # informational for version 4
    "native_patch_commit": commit,
    "executable": pin(os.path.join(n, "codex-app-server" + exe)),
    "cli": pin(os.path.join(n, "codex" + exe)),
    "code_mode_host": pin(os.path.join(n, "codex-code-mode-host" + exe)),
    "facade": pin(os.path.join(rel, "cutex-mcp" + exe)),
    "schema": pin(os.path.join(n, "codex_app_server_protocol.schemas.json")),
    "shared_config": pin(os.path.join(os.path.expanduser("~"), ".cutex", "codex-home", "config.toml")),
}
out = os.path.join(rel, "manifests", "default.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(manifest, f, indent=2)
print(out)
```

Save it as `~/src/write-manifest.py` (Windows: `%USERPROFILE%\src\write-manifest.py`), run it, then
select the manifest:

```sh
python3 ~/src/write-manifest.py
cutex human install-runtime "$RELEASE_DIR/manifests/default.json"
```

```powershell
py "$env:USERPROFILE\src\write-manifest.py"
cutex human install-runtime "$env:RELEASE_DIR\manifests\default.json"
```

Check: `install-runtime` prints the selection (`bundle_manifest`, `native_home` =
`~/.cutex/codex-home`). It verifies every pinned file, so an error here names the file that is wrong.

Claude Code agents need a separate runtime (the `claude-adapter` directory of the cutex repository,
`cutex human claude install`); this guide covers Codex-based agents only.

## 6. Start cutex and check it

Linux:

```sh
systemctl --user daemon-reload
systemctl --user enable --now cutex-agent-bus.service cutex-management-api.service
systemctl --user --no-pager status cutex-management-api.service
curl -fsS http://127.0.0.1:24270/ && echo
cutex human doctor --check
```

Windows:

```powershell
schtasks /Run /TN "\Cutex\cutex-supervisor"
Start-Sleep 5
cutex service status
curl.exe -fsS http://127.0.0.1:24270/
cutex human doctor --check
```

Check: `GET /` answers (it is the unauthenticated health check) and `doctor --check` reports no
errors. The management API listens on `127.0.0.1` only; do not change that to a network address.

What cutex does by itself once running: it fetches a public model price list once a day (for the
usage page's cost estimates), and it writes agent scratch directories under `~/.cutex/agents-scratch`
(never deleted automatically).

## 7. Install the desktop

The desktop is a self-updating portable install. Its layout:

```text
<desktop base>/
  src/                  git clone of cutex-desktop (branch release); the updater pulls and builds here
  releases/<hash>/      the release in use and the previous one (the rollback target);
                        macOS names them <hash>.noindex
  old-releases/<hash>/  older releases, moved here after each update; deleted 30 days after the move
  current               link to the release in use (Windows: junction; Linux / macOS: symlink)
  channel               one line: release
```

On macOS the app you open is `~/Applications/Cutex.app`: a copy of `current/Cutex.app` (an APFS
clone, so it takes no extra space) that the install script and the app replace on every update.
Spotlight and the Apps picker list only this one, and a Dock icon kept from it survives updates.

Default bases: Linux and macOS `~/Applications/cutex-desktop`, Windows
`%LOCALAPPDATA%\Programs\cutex-desktop-app`.

### 7.1 Linux and macOS

```sh
DESKTOP_BASE=~/Applications/cutex-desktop
git clone --branch release https://github.com/senxiu-official/cutex-desktop.git "$DESKTOP_BASE/src"
"$DESKTOP_BASE/src/scripts/install-portable.sh" --base "$DESKTOP_BASE" --channel release
git -C "$DESKTOP_BASE/src" status --porcelain --untracked-files=no
```

The script uses `node` from PATH, or the Node 24 in `CUTEX_DEV_NODE_DIR` if set (section 1), and
the pnpm version the repository pins (through corepack; it turns off pnpm's "Update available"
banner, so do not install another pnpm). Check: the last command prints nothing. A modified
checkout (for example a changed `pnpm-lock.yaml`) makes every later update refuse to run
(section 9).

**Linux, Ubuntu 24.04 and later**: Ubuntu blocks the unprivileged user namespaces that Electron's
sandbox needs (`sysctl kernel.apparmor_restrict_unprivileged_userns` prints `= 1`), and the app then
aborts at start with `The SUID sandbox helper binary was found, but is not configured correctly`.
In that case the install script has written an AppArmor profile for this install to
`$DESKTOP_BASE/apparmor-cutex-desktop` and printed two commands. They need sudo, so ask the person
to run them once, before the first start. Use the exact commands the script printed (the profile name
differs when another install already owns `cutex-desktop`); typically:

```sh
sudo install -m 644 "$DESKTOP_BASE/apparmor-cutex-desktop" /etc/apparmor.d/cutex-desktop
sudo apparmor_parser -r /etc/apparmor.d/cutex-desktop
```

The profile covers every `releases/*` directory, so it stays valid across updates. If the app still
does not start, rerun `install-portable.sh`: it prints exactly what is missing. Do not use
`--no-sandbox`. (Making `<release>/chrome-sandbox` root-owned with mode
4755 also works, but only for that one release directory: it is lost on every update, and the
updater's restart then fails.)

Start it, in the graphical session: Linux `"$DESKTOP_BASE/current/cutex"`; macOS
`open ~/Applications/Cutex.app` (the script prints the exact command; keep it in the Dock from the
running icon: Options → Keep in Dock). If `~/Applications/Cutex.app` already belonged to another
install, the script leaves it alone and prints `open "$DESKTOP_BASE/current/Cutex.app"` instead.

### 7.2 Windows

```powershell
$DesktopBase = "$env:LOCALAPPDATA\Programs\cutex-desktop-app"
git clone --branch release https://github.com/senxiu-official/cutex-desktop.git "$DesktopBase\src"
powershell -ExecutionPolicy Bypass -File "$DesktopBase\src\scripts\install-portable.ps1" -Base $DesktopBase -Channel release
```

The script needs Node 24 on PATH (or `CUTEX_DEV_NODE_DIR` pointing at a Node 24 directory). It
creates the Start-menu shortcut **Cutex**; start the app from there.

### 7.3 First start

- **Connected**: the host switcher (top left) shows this computer's name; hovering it says
  "在线" / "online" (the dot next to it is the host's own colour, not a status light). Go on with
  section 8.
- **"cutex is not installed on this computer yet"**: `~/.cutex/config.json` or its
  `management_api_token` is missing (section 5.1).
- **"cutex is not running"**: the management service does not answer (section 6). The app retries
  every few seconds; there is no need to restart it.

Closing the window hides it to the tray (menu bar on macOS); quit from the tray menu. Change this
under Settings → General → When closing the window if you prefer.

### 7.4 macOS: connect to your cutex machine

On a Mac the app starts with no host. Click **Add an SSH host** (or the host switcher → Add SSH
host…) and enter `user@machine` for the Linux or Windows computer where you did sections 2 to 6.
The app uses your existing SSH keys and `~/.ssh/config`, tunnels the connection over SSH and pairs
with that cutex by itself; no port needs to be opened. Only connect to machines you own.

### 7.5 The same identity on another computer

Each desktop makes its own person identity (an Ed25519 key) on first start; hosts use it to
recognise who a paired device belongs to (it grants no access by itself). To be the same person on a second computer:

1. On the first computer: Settings → You → expand **Use on your other computers** → **Copy identity key**. The key (`cutex-id-…`, one line)
   is now on the clipboard; it is cleared after 60 seconds.
2. Move the string to the other computer yourself (a password manager, or type it). Whoever has it
   is you: never paste it into a chat, an issue or an AI agent, and never send it to anyone.
3. On the second computer: Settings → You → **Use on your other computers** → **Paste identity key…**, paste, **Continue**, and
   confirm the replacement. Line breaks or spaces picked up on the way are ignored; a cut-off or
   mistyped key is refused.

Older desktops moved the identity as a file (`cutex-identity-<fingerprint>.json`); **Legacy identity file: Import…** in the
same row still reads it. An AI agent following this guide never handles this key.

## 8. First Profile and first agent

A **Profile** is a model account: provider, endpoint, credentials and model defaults. Agents cannot
run without one, and a fresh cutex has none.

1. Settings → **Profiles** → **New profile**.
2. Name it, pick the **Kind**:
   - **API key**: pick the provider preset (OpenAI API, DeepSeek, Z.ai, Moonshot, OpenRouter, ...)
     or **Custom** for any OpenAI-Responses-compatible endpoint, and check the base URL.
   - **ChatGPT login**: sign in with a ChatGPT account in the browser window that opens.
3. **Create**. The Profile's editor opens. For an API-key Profile, type the key into the
   **Account** section's key field and **Save**. The key goes to cutex on this computer
   (`~/.cutex/profiles/<id>/auth.json`) and is never shown again.
4. Under **Models**, check the default model and save.

An AI agent following this guide stops here and asks the person to do steps 1 to 4: the key must
not pass through the agent.

Then click **New agent** in the sidebar, pick the Profile, optionally a working directory (empty =
a fresh scratch directory), create it and send a first message.

**Know the defaults before you start**: on a fresh install a new agent runs in **Auto** mode: it
may write inside its working directory and use the network, and asks you before anything beyond that
(sandbox workspace-write, approval on request). A `~/.cutex` that already existed before this cutex
keeps the older default, **full access without asking** (it can read, write and run anything your
user can); so does a cutex older than this behaviour. Change the default under Settings → New agent
defaults, or one agent's mode from the menu under its message box. Quick chats are workspace write,
ask on request, no network.

If the check in 5.2 said `"existing"` on a home you set up new with this guide (an earlier version
of this guide caused that), cutex wrote `sandbox: danger-full-access`, `approval: never` and
`network_access: false` into `config.json` → `new_thread_defaults.agent`. Picking **Auto** under
Settings → New agent defaults fixes it. To restore the built-in defaults instead, remove exactly the
keys cutex wrote (they are listed under `written` in the migration record; cutex never writes them
again). Ask the person first, then, with the services stopped (Linux:
`systemctl --user stop cutex-management-api.service cutex-agent-bus.service`; Windows:
`schtasks /End /TN "\Cutex\cutex-supervisor"`), run this with `python3` (Windows: `py`):

```python
import json, os
home = os.path.join(os.path.expanduser("~"), ".cutex")
record = json.load(open(os.path.join(home, "archive", "fresh-agent-permissions", "migration.json")))
path = os.path.join(home, "config.json")
config = json.load(open(path, encoding="utf-8"))
agent = (config.get("new_thread_defaults") or {}).get("agent") or {}
removed = [k for k, v in record.get("written", {}).items() if k in agent and agent[k] == v]
for k in removed:
    del agent[k]
with open(path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2)
print("removed:", removed)
```

Then start the services again (section 6). Agents created before keep their mode; change it from
the menu under each one's message box.

Completion notifications for new agents are off by default; turn them on per agent (bell icon) or
under Settings → Notifications.

## 9. Updating

### The desktop

A desktop installed from a release package (section B) has no `src/` checkout: it updates from the
GitHub Releases (the **Update** button, **B.5**). An app copied somewhere else by hand (outside
`releases/<version>` + `current`) cannot replace itself; Settings → Updates & diagnostics then links
to the Releases page. The rest of this part is about a desktop built from source
(section 7).

Settings → **Updates & diagnostics** shows the version, the channel (`release`) and the update
state. When the `release` branch moves, an **Update** button appears next to Settings: it pulls
`<desktop base>/src`, builds a new release, switches `current` and restarts. If the new version does
not come up, it switches back by itself. It fetches from the `origin` remote of
`<desktop base>/src` (GitHub, for a clone made in section 7) and builds with the Node 24 the
install was built with, so it needs git and network access to that remote. Behind a proxy, git
(for an `https://` remote) and the build's downloads use the computer's proxy settings unless git's
`http.proxy` or `HTTPS_PROXY` already name one; `ssh` remotes are left to ssh. It refuses to run while
`src` has local changes (see the check in 7.1).

By hand (the same thing):

```sh
git -C "$DESKTOP_BASE/src" pull --ff-only origin release
"$DESKTOP_BASE/src/scripts/install-portable.sh" --base "$DESKTOP_BASE"
```

```powershell
git -C "$DesktopBase\src" pull --ff-only origin release
powershell -ExecutionPolicy Bypass -File "$DesktopBase\src\scripts\install-portable.ps1" -Base $DesktopBase
```

**Old releases.** Each release takes a few hundred MB. After an update has started fine (and at
every start of the app, and at the end of the install script), every release except the one in use
and the previous one is moved from `releases/` to `<desktop base>/old-releases/`. Nothing in
`releases/` is deleted. Releases in `old-releases/` are deleted automatically 30 days after the move.
Settings → **Updates & diagnostics** → **Old versions** shows how many there are and their size;
**Delete old versions** (click twice) deletes them now. By hand, with the app running or not:

```sh
rm -rf "$DESKTOP_BASE/old-releases"
```

```powershell
Remove-Item -LiteralPath "$DesktopBase\old-releases" -Recurse -Force
```

Never delete inside `releases/` by hand while the app runs. On Windows a release with a file still
in use cannot be moved; it stays in `releases/` and is moved at a later start.

### cutex and cute-codex

The in-app **Backend updates** page downloads signed cutex releases from the GitHub Releases of
`senxiu-official/cutex` (managed installs only: every install made with `cutex service install`).
After a binary install (section B) that is the way to update. A cutex built from source can use it
too; or update from source:

1. Wait until no agent is working (a restart never loses agents, but do not cut a running turn).
2. `git pull --ff-only origin release` in both repositories, rebuild cutex (section 4) and, if cute-codex changed, the native
   files (section 3).
3. Run `cutex service install --channel release --no-start` **from the new build**
   (`~/src/cutex/target/release/cutex`): it adds `releases/dev-<new commit>` and points the services
   at it.
4. If cute-codex changed: copy the new files into `natives/<new version>` (5.3).
5. Rerun the variable lines of 5.3 (they pick the new `RELEASE_DIR` and, if cute-codex changed,
   the new `N`), write a new manifest and run `cutex human install-runtime` on it (5.3). This selects the new runtime for **new** agents; existing agents keep the files they were
   started with, so keep old `releases/` and `natives/` directories.
6. Restart the services. Linux:
   `systemctl --user restart cutex-agent-bus.service cutex-management-api.service`.
   Windows: sign out and back in (the logon task starts the new build), or end and rerun the task:
   `schtasks /End /TN "\Cutex\cutex-supervisor"` then `schtasks /Run /TN "\Cutex\cutex-supervisor"`.
7. Check with `cutex --version` and section 6.

## 10. Unsigned app warnings

For the downloaded release packages see **B.6**. The packages you build yourself are not signed by
a publisher either.

- **Windows SmartScreen** normally stays quiet for a program you built yourself (it has no
  "downloaded from the internet" mark). If you copy a package to another computer and SmartScreen
  says "Windows protected your PC", click **More info → Run anyway**, or unblock the folder:
  `Get-ChildItem -Recurse <folder> | Unblock-File`.
- **macOS Gatekeeper**: packages are ad-hoc signed and not notarized. A package built on your own
  Mac carries no quarantine attribute and normally opens directly. If macOS blocks it, open System
  Settings → Privacy & Security and click **Open Anyway**.
- **macOS keychain prompt** "Cutex wants to use … Cutex Safe Storage": the app keeps host tokens
  encrypted in your keychain. Click **Always Allow**. Ad-hoc signed packages count as a new program
  after every update, so it asks again. To stop that, create a self-signed code-signing certificate
  in Keychain Access (Certificate Assistant → Create a Certificate…, type **Code Signing**, for
  example named `Cutex Local Signing`) and reinstall once with
  `CUTEX_DESKTOP_CODESIGN_IDENTITY="Cutex Local Signing" "$DESKTOP_BASE/src/scripts/install-portable.sh" --base "$DESKTOP_BASE"`;
  later updates reuse that identity.

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Desktop: "cutex is not installed on this computer yet" | No `~/.cutex/config.json`, or it has no `management_api_token`, or it is not valid JSON. Redo 5.1. |
| Desktop: "cutex is not running" | Linux: `systemctl --user status cutex-management-api.service`, logs `journalctl --user -u cutex-management-api.service -n 100` (add `--since "1 hour ago"` to hide an older install's history under the same unit name). Windows: `cutex service status`, logs `%USERPROFILE%\.cutex\runtime\services\management.log` and `agent-bus.log`. |
| `address already in use` on 24270 / 24260 | Another cutex (or something else) uses the port. Stop it; do not run two cutex daemons on one home. |
| Creating an agent fails with `No local runtime installed` or `Windows requires a local v4 runtime deployment` | Section 5.3 was skipped or failed. |
| `stock reference changed`, or an agent no longer starts after a rebuild | A pinned file was overwritten. Never rebuild into `natives/<version>` or `releases/<label>`; write a new manifest and run `install-runtime` again (5.3). |
| `stock companion must be beside executable` | `codex-code-mode-host` is not in the same directory as `codex-app-server`. |
| Agent fails at its first turn with a database / migration checksum error | cute-codex was built from a working copy with CRLF line endings. Rebuild from `git -c core.autocrlf=false archive` (section 3.1). |
| Building `codex-code-mode-host` fails downloading `librusty_v8_…` (404) | The V8 archive variables of 3.2 were not set in that shell. |
| V8 checksum mismatch in 3.2 | Stop. Do not build with that download; report it. |
| `cargo build` fails on `--locked` | The lock file and the sources disagree: you built from a modified checkout. Use a clean export of the `release` commit. |
| The model answers 401 / `invalid api key` | Re-enter the key in the Profile's Account section. A key change applies to agents started afterwards. |
| `rate_limit` / quota errors | The provider's limit. Settings → Profiles → the Profile → Quota readers → Refresh shows what the provider reports. |
| Linux: the window vanished after closing it | Close-to-tray without a visible tray (GNOME needs the AppIndicator extension). Start the app again to show the window; set Settings → General → When closing the window → Quit. |
| Linux (Ubuntu 24.04+): the app does not start, mentioning the sandbox / `chrome-sandbox` | The AppArmor step of section 7.1 was skipped. Ask the person to run the two `sudo` commands there. |
| `nvm install 24` leaves `node --version` at an older version | `~/.npmrc` sets `prefix`; see the Node 24 item in section 1. |
| `git pull`: "divergent branches" / "unrelated histories", or `git fetch --tags`: "would clobber existing tag" | The published `release` branch was replaced instead of moved forward (each release is normally a child of the previous one). Keep your old state under another name and follow the new one: `git branch -m release old-release`, `git fetch --force --tags origin`, `git switch -c release --track origin/release`. For the desktop `src`, then rerun the install script (9). |
| Updates & diagnostics: "Installed from a release package" | A desktop from the release binaries (section B). It does not update itself; see B.5. |
| Updates & diagnostics: "Not a portable install" | The app was not started from `<desktop base>/current`, or `<desktop base>/src` is missing. Start it from `current`, or reinstall with section 7. |
| Updates & diagnostics: "The update source has no branch for this channel yet" | The `release` branch is not published on the repository `src` was cloned from. Wait for it, or check `git -C <desktop base>/src remote -v`. |
| Backend updates: `no_trusted_keys` | A cutex older than 0.1.0, built without the release keys; update from source (section 9). |
| Disk full of `<desktop base>/releases/*` (tens of GB) | An install from before old releases were tidied up. Update once (or rerun the install script): everything but the release in use and the previous one moves to `old-releases/`; then delete it (section 9, **Old releases**). |
| macOS: Spotlight / the Apps picker lists several **Cutex** | Releases from before `~/Applications/Cutex.app` existed. Update once; open `~/Applications/Cutex.app` from then on and delete `old-releases/` (section 9). The release that was in use before stays listed until the next update moves it. Remove a Dock icon of an old release (Options → Remove from Dock) and keep the running one instead. |
| macOS: `~/Applications/Cutex.app` is missing after an update | It is created from a release that records its location (built by this version or later), and never over a `Cutex.app` from another install. Check `update.log` (lines starting with `launcher`), move the other app away, and restart the desktop. |
| Something else in the desktop | Settings → Updates & diagnostics → **Open log folder**: `logs/errors.jsonl` and `update.log` (Linux `~/.config/Cutex`, Windows `%APPDATA%\Cutex`, macOS `~/Library/Application Support/Cutex`). |

When you report a problem, include the desktop version (Settings → Updates & diagnostics), the
cutex version (`cutex --version`), your OS, the steps and the relevant log lines. Never include API
keys, tokens, `config.json` or `auth.json`, and remove paths or names you do not want to share.

## 12. Uninstall

- Desktop: quit it from the tray, then delete `<desktop base>` (with `releases/` and
  `old-releases/`) and its data folder (`~/.config/Cutex`, `%APPDATA%\Cutex`,
  `~/Library/Application Support/Cutex`). macOS: also delete `~/Applications/Cutex.app` and remove its
  Dock icon. Windows: also delete the Start-menu shortcut **Cutex** and unpin it from the taskbar.
- Only the old releases: `old-releases/` can be deleted at any time (section 9).
- cutex: `cutex service uninstall` removes the services (never data). Then delete the install base
  (`~/.local/share/cutex` or `%LOCALAPPDATA%\cutex`) and `~/.local/bin/cutex`.
- `~/.cutex` holds every agent, conversation, Profile and credential. Delete it only if you want all
  of that gone.
- Linux AppArmor profile (section 7.1), if installed:
  `sudo apparmor_parser -R /etc/apparmor.d/cutex-desktop && sudo rm /etc/apparmor.d/cutex-desktop`.

Build leftovers (Linux paths; Windows uses the same names under `%USERPROFILE%`). After section 5.3
the binaries are copied, so these can go right after the install, but keeping the sources makes
the next update (section 9) shorter:

- `~/src/build` (the cute-codex export: its `codex-rs/target` is about 11 GB, plus the V8
  downloads), `~/src/cutex/target` (about 1 GB), `~/src/write-manifest.py`, and the clones in `~/src`.
- `<install base>/natives/<version>`: old versions only once no agent uses them; they go with the
  install base on uninstall.
- Toolchains, if nothing else uses them: Rust `rustup self uninstall` (removes `~/.rustup` and
  `~/.cargo`, about 5 GB, and the line rustup added to `~/.profile` / `~/.bashrc`); nvm: delete `~/.nvm`
  and the `NVM_DIR` lines it added to `~/.bashrc`.
- Caches: `~/.cache/electron` and `~/.cache/node/corepack` (Windows `%LOCALAPPDATA%\electron\Cache`
  and `%LOCALAPPDATA%\node\corepack`).

## 13. Optional: this manual for your own coding agent

The desktop repository contains a usage manual written for AI agents: the skill `skills/cutex-docs`
(a `SKILL.md` plus `references/`, in Chinese; the agent answers in the person's language). With it,
the person can ask their own coding agent "how do I … in Cutex?" or "what does this error mean?".
It is optional and changes nothing in cutex or the desktop.

If the person wants it, copy the whole folder into their agent's personal skills directory:

| Agent | Directory |
|---|---|
| Claude Code | `~/.claude/skills/cutex-docs` |
| Codex CLI (and cute-codex) | `~/.agents/skills/cutex-docs` (older Codex versions read `~/.codex/skills`) |
| Any other agent | that agent's skills directory; check its documentation |

Linux / macOS:

```sh
mkdir -p ~/.claude/skills
cp -R "$DESKTOP_BASE/src/skills/cutex-docs" ~/.claude/skills/
```

Windows:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
Copy-Item -Recurse -Force "$DesktopBase\src\skills\cutex-docs" "$env:USERPROFILE\.claude\skills\"
```

(Use the Codex directory from the table instead if that is the person's agent.) The copy does not
update itself: after a desktop update, copy the folder again to refresh it. Note that cute-codex
also reads `~/.agents/skills`, so cutex agents on that machine may see the skill too; that is harmless.

## ANU users

See [ANU.md](ANU.md) for two optional modules, both off by default: Claude Science (anyone with a Claude Science account) and NCI remote jobs (users of NCI, e.g. Gadi). Skip it if neither applies.
