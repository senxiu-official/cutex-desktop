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
- **Optional components** that cutex installs on request: the Claude runtime for Claude Code
  agents (section 6.1) and, on Linux, the Job Service for long-running jobs (section 6.2).

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
tested together. If one of them has no `release` branch, stop and report it (open an issue on
https://github.com/senxiu-official/cutex-desktop/issues) instead of using another branch.

### Rules for an AI agent following this guide

1. Run the steps in order and check the result of each step before going on. If a check fails, stop
   and report the exact command and output; do not improvise workarounds.
2. Never print, log or paste tokens or API keys (the contents of `~/.cutex/config.json`,
   `~/.cutex/profiles/*/auth.json`). API keys are entered by the person, in the desktop UI (section 8).
3. Ask the person before anything that needs administrator rights (`sudo`, an elevated shell,
   installing system packages) and before changing a system setting.
4. Do not touch an existing `~/.cutex` without asking: it may hold someone's agents. This guide
   assumes a fresh machine.
5. Placeholders look like `<this>`. Most agent shell tools start a new shell for every command,
   so variables and `PATH` changes from one block are gone in the next. Section B therefore writes
   its settings to a file in B.1, and every later block starts by loading it
   (`. ~/cutex-download/cutex-install.env`; Windows: the `Invoke-Expression` line). In sections 2 to 7,
   each block sets what it needs at its top; if a block uses a variable it does not set, rerun the
   lines that set it in the same command.
6. Start the desktop app detached (as the commands below do), never as a foreground command: a GUI
   started in the foreground keeps the shell tool waiting until it times out, which usually kills
   the app.

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
minutes and 2 GB of disk. It needs no Rust, no C/C++ toolchain and no Node.js. Prerequisites:

- **Linux**: `curl`, `python3`, a systemd user session and `~/.local/bin` on PATH (section 1), and
  minisign (B.1).
- **Windows**: Python 3 (`py`, section 1) and minisign (B.1); `curl.exe` and `tar` ship with
  Windows 10 / 11.
- **macOS** (desktop only): minisign (B.1); `curl`, `ditto` and `codesign` ship with macOS.

Section 0's rules apply unchanged.

The GitHub Releases carry binaries built by GitHub Actions from the tagged commit of each
repository:

| Release | Files (`<platform>` = `linux-x64` or `windows-x64`) |
|---|---|
| `senxiu-official/cutex` → `v<version>` | `cutex-<version>-<platform>.tar.gz` (`cutex`, `cutex-mcp`), `manifest.json` |
| `senxiu-official/cute-codex` → `cute-codex-v<native version>` | `native-<native version>-<platform>.tar.gz` (`codex-app-server`, `codex`, `codex-code-mode-host`, the protocol schema, `cute-codex-build.json` with its `version` and `commit`) |
| `senxiu-official/cutex-desktop` → `v<version>` | `cutex-desktop-<version>-linux-x64.tar.gz`, `-windows-x64.zip`, `-macos-arm64.zip` (Apple silicon), `-macos-x64.zip` (Intel) |

The same native archives are also attached to the `native-<native version>` release of
`senxiu-official/cutex`, which is where Backend updates download them from. They are the same files
(same SHA-256; only the signature timestamps differ), so either copy is right.

Every file has a `<file>.minisig` signature next to it, and each release a `SHA256SUMS` (+
`.minisig`). The owner signs them offline with the release key; CI never holds it. The public key
(key id `00A0BD016183F447`) is the one cutex itself trusts for backend updates
(`src/upgrade/keys.rs` in the cutex repository) and is published as `docs/install/cutex-release.pub`
in this repository:

```text
RWRH9INhAb2gACJAg/h5EBjbudos2LXj6K+5hRBEGeVLDKaKzE+FICmS
```

The versions that belong together are in the table below. A cutex release's `manifest.json` names
a `native` block (`native.version`, `native.commit`) only when that release brings a new cute-codex;
a release without one keeps the native of the newest earlier release that has it. cutex 0.1.1 and
0.1.2 had none (they kept `0.160.0-r52.2` from cutex 0.1.0); cutex 0.1.3 brings `0.160.0-r52.3` (see the
`native` block of https://github.com/senxiu-official/cutex/releases/download/v0.1.3/manifest.json). The `cute-codex-build.json`
inside the native archive (`version`, `commit`) says which one you unpacked.

| | Linux / Windows | macOS (desktop only) |
|---|---|---|
| `VERSION` (cutex) | `0.1.3` | not used |
| `DESKTOP_VERSION` (desktop) | `0.1.3` | `0.1.3` |
| `NATIVE` (cute-codex) | `0.160.0-r52.3` | not used |

### B.1 Download and verify

**Install minisign** (it checks the signatures):

- **Ubuntu / Debian**: `sudo apt install minisign` (ask the person: it needs sudo). Without sudo,
  unpack the distribution's own package for your user only (the settings file below puts this
  directory on PATH):

  ```sh
  mkdir -p ~/.local/opt/minisign && cd ~/.local/opt/minisign && apt download minisign && dpkg -x minisign_*.deb . && cd -
  ~/.local/opt/minisign/usr/bin/minisign -v
  ```

- **Windows**: `winget install jedisct1.minisign`. winget adds it to PATH for shells started
  afterwards only; the settings file below also adds winget's link directory
  (`%LOCALAPPDATA%\Microsoft\WinGet\Links`) to the PATH of each block. Check with `minisign -v`
  after loading it; if it is still not found, ask the person to open a new terminal (or restart the
  agent) and try again.
- **macOS**: `brew install minisign`. Without Homebrew, download `minisign-<version>-macos.zip` from
  https://github.com/jedisct1/minisign/releases, unzip it and copy the `minisign` program from it to
  `~/.local/bin` (the macOS settings file below puts that directory on PATH). Check with
  `minisign -v`.

A file whose signature does not verify must not be used: stop and report it.

**Write the install settings.** Every later block of section B starts by loading this file, so
the values survive between commands (rule 5). It only holds versions and paths, no secrets.

Linux:

```sh
mkdir -p ~/cutex-download
cat > ~/cutex-download/cutex-install.env <<'ENV'
VERSION=0.1.3 DESKTOP_VERSION=0.1.3 NATIVE=0.160.0-r52.3 PLATFORM=linux-x64
PUB=RWRH9INhAb2gACJAg/h5EBjbudos2LXj6K+5hRBEGeVLDKaKzE+FICmS
# cutex's own default install base: $CUTEX_INSTALL_BASE, else $XDG_DATA_HOME/cutex, else ~/.local/share/cutex
CUTEX_BASE=${CUTEX_INSTALL_BASE:-${XDG_DATA_HOME:-$HOME/.local/share}/cutex}
RELEASE_DIR=$CUTEX_BASE/releases/$VERSION
N=$CUTEX_BASE/natives/$NATIVE
DESKTOP_BASE=$HOME/Applications/cutex-desktop
export PATH="$HOME/.local/bin:$HOME/.local/opt/minisign/usr/bin:$PATH"
if [ -f "$N/cute-codex-build.json" ]; then
  NATIVE_COMMIT=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["commit"])' "$N/cute-codex-build.json")
fi
export N RELEASE_DIR NATIVE_COMMIT
ENV
. ~/cutex-download/cutex-install.env && echo "settings ok: cutex $VERSION, base $CUTEX_BASE"
```

Windows (PowerShell; the file is loaded with `Invoke-Expression`, which works under any script
execution policy):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\cutex-download" | Out-Null
@'
$Version = '0.1.3'; $DesktopVersion = '0.1.3'; $Native = '0.160.0-r52.3'; $Platform = 'windows-x64'
$Pub = 'RWRH9INhAb2gACJAg/h5EBjbudos2LXj6K+5hRBEGeVLDKaKzE+FICmS'
$Dl = "$env:USERPROFILE\cutex-download"
# cutex's own default install base: $env:CUTEX_INSTALL_BASE, else %LOCALAPPDATA%\cutex
$CutexBase = if ($env:CUTEX_INSTALL_BASE) { $env:CUTEX_INSTALL_BASE } else { "$env:LOCALAPPDATA\cutex" }
$env:RELEASE_DIR = "$CutexBase\releases\$Version"
$env:N = "$CutexBase\natives\$Native"
$DesktopBase = "$env:LOCALAPPDATA\Programs\cutex-desktop-app"
foreach ($d in "$CutexBase\bin", "$env:LOCALAPPDATA\Microsoft\WinGet\Links") {
  if (($env:Path -split ';') -notcontains $d) { $env:Path = "$d;$env:Path" }
}
if (Test-Path "$env:N\cute-codex-build.json") {
  $env:NATIVE_COMMIT = (Get-Content "$env:N\cute-codex-build.json" | ConvertFrom-Json).commit
}
'@ | Set-Content -Encoding UTF8 "$env:USERPROFILE\cutex-download\cutex-install.env.ps1"
Invoke-Expression (Get-Content -Raw "$env:USERPROFILE\cutex-download\cutex-install.env.ps1")
"settings ok: cutex $Version, base $CutexBase"
```

macOS (the desktop only):

```sh
mkdir -p ~/cutex-download
cat > ~/cutex-download/cutex-install.env <<'ENV'
DESKTOP_VERSION=0.1.3
PUB=RWRH9INhAb2gACJAg/h5EBjbudos2LXj6K+5hRBEGeVLDKaKzE+FICmS
# hw.optional.arm64 is 1 on Apple silicon, also in a Rosetta terminal (where uname -m says x86_64)
ARCH=$( [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ] && echo arm64 || echo x64 )
DESKTOP_BASE=$HOME/Applications/cutex-desktop
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
ENV
. ~/cutex-download/cutex-install.env && echo "settings ok: desktop $DESKTOP_VERSION macos-$ARCH"
```

Check: the last line prints `settings ok: …`. If you later need another release, edit the version
lines of this file; nothing else stores them.

**Download and verify.** Linux:

```sh
. ~/cutex-download/cutex-install.env
cd ~/cutex-download
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
Invoke-Expression (Get-Content -Raw "$env:USERPROFILE\cutex-download\cutex-install.env.ps1")
Set-Location $Dl
function Get-Signed($Url) {
  $name = $Url.Split('/')[-1]
  curl.exe -fsSL --retry 3 -o $name $Url; curl.exe -fsSL --retry 3 -o "$name.minisig" "$Url.minisig"
  minisign -Vm $name -P $Pub; if ($LASTEXITCODE -ne 0) { throw "STOP: $name did not download or verify; do not use it" }
}
Get-Signed "https://github.com/senxiu-official/cutex/releases/download/v$Version/cutex-$Version-$Platform.tar.gz"
Get-Signed "https://github.com/senxiu-official/cutex/releases/download/v$Version/manifest.json"
Get-Signed "https://github.com/senxiu-official/cute-codex/releases/download/cute-codex-v$Native/native-$Native-$Platform.tar.gz"
Get-Signed "https://github.com/senxiu-official/cutex-desktop/releases/download/v$DesktopVersion/cutex-desktop-$DesktopVersion-$Platform.zip"
"all downloads verified"
```

macOS:

```sh
. ~/cutex-download/cutex-install.env
cd ~/cutex-download
F=cutex-desktop-$DESKTOP_VERSION-macos-$ARCH.zip
curl -fsSLO --retry 3 https://github.com/senxiu-official/cutex-desktop/releases/download/v$DESKTOP_VERSION/$F &&
curl -fsSLO --retry 3 https://github.com/senxiu-official/cutex-desktop/releases/download/v$DESKTOP_VERSION/$F.minisig &&
minisign -Vm "$F" -P "$PUB" && echo "all downloads verified"
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
. ~/cutex-download/cutex-install.env
cd ~/cutex-download
mkdir -p cutex-$VERSION && tar -xzf cutex-$VERSION-$PLATFORM.tar.gz -C cutex-$VERSION
cp manifest.json manifest.json.minisig cutex-$VERSION/
cutex-$VERSION/cutex --version            # cutex 0.1.3 (0.1.3, <commit>)
cutex-$VERSION/cutex service install --channel release --no-start
ls "$RELEASE_DIR"                          # cutex  cutex-mcp  manifest.json  manifest.json.minisig
mkdir -p ~/.local/bin && ln -sfn "$CUTEX_BASE/current/cutex" ~/.local/bin/cutex
cutex service status
cutex service status | python3 -c 'import json,sys; b=json.load(sys.stdin)["base"]; print("base ok" if b == sys.argv[1] else "STOP: base is " + b)' "$CUTEX_BASE"
cutex upgrade status
grep '"home"' ~/.cutex/archive/fresh-agent-permissions/migration.json
```

Windows:

```powershell
Invoke-Expression (Get-Content -Raw "$env:USERPROFILE\cutex-download\cutex-install.env.ps1")
Set-Location $Dl
New-Item -ItemType Directory -Force "cutex-$Version" | Out-Null
tar -xzf "cutex-$Version-$Platform.tar.gz" -C "cutex-$Version"
Copy-Item manifest.json, manifest.json.minisig "cutex-$Version\"
& ".\cutex-$Version\cutex.exe" --version
& ".\cutex-$Version\cutex.exe" service install --channel release --no-start
Get-ChildItem $env:RELEASE_DIR
# put cutex on PATH for your user (new terminals pick it up; the settings file covers later blocks)
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ";$CutexBase\bin", 'User')
cutex service status
$b = (cutex service status | ConvertFrom-Json).base; if ($b -eq $CutexBase) { "base ok" } else { "STOP: base is $b" }
cutex upgrade status
Select-String '"home"' "$env:USERPROFILE\.cutex\archive\fresh-agent-permissions\migration.json"
```

Check:

- `base ok`. If it prints `STOP: base is …`, cutex installed somewhere other than the settings
  file says: stop and report both paths.
- `cutex service status` (Linux): `units` shows `ActiveState: inactive` for both services. If
  either is already `active`, another cutex on this account owns these unit names: stop and ask the
  person (rule 4).
- `cutex upgrade status` prints `installed  0.1.3`; `cutex upgrade status --json` shows
  `"managed": true` and `installed.sequence` 5. (Its `serviceManager` field may say `none` while
  `cutex service status` says `systemd`; that is fine.)
- The last line prints `"home": "fresh"` (section 5.2 explains the record).

The services are installed but not started yet.

### B.3 Install the runtime files

Unpack cute-codex into its own `natives/<version>` directory (never over an existing one: agents pin
these files), then write and select the runtime manifest (the same steps as section 5.3, with the
paths of a binary install).

Linux:

```sh
. ~/cutex-download/cutex-install.env
if [ -e "$N/codex-app-server" ]; then echo "natives $NATIVE already installed, not unpacked"; else
  mkdir -p "$N" && tar -xzf ~/cutex-download/native-$NATIVE-$PLATFORM.tar.gz -C "$N"
fi
"$N/codex-app-server" --version
```

Windows:

```powershell
Invoke-Expression (Get-Content -Raw "$env:USERPROFILE\cutex-download\cutex-install.env.ps1")
if (Test-Path "$env:N\codex-app-server.exe") { "natives $Native already installed, not unpacked" } else {
  New-Item -ItemType Directory -Force $env:N | Out-Null
  tar -xzf "$Dl\native-$Native-$Platform.tar.gz" -C $env:N
}
& "$env:N\codex-app-server.exe" --version
```

Check: `codex-app-server --version` prints `codex-app-server 0.160.0-r52.3`.

Now save the Python script of section 5.3 (the block under "Write the manifest") as
`~/cutex-download/write-manifest.py` (Windows: `%USERPROFILE%\cutex-download\write-manifest.py`).
It reads `N`, `RELEASE_DIR` and `NATIVE_COMMIT`, which the settings file sets (`NATIVE_COMMIT` from
the unpacked `cute-codex-build.json`, so load the file again after unpacking, as below). Then run it
and select the manifest:

```sh
. ~/cutex-download/cutex-install.env
test -n "$NATIVE_COMMIT" && echo "native commit ok"
python3 ~/cutex-download/write-manifest.py
cutex human install-runtime "$RELEASE_DIR/manifests/default.json"
```

```powershell
Invoke-Expression (Get-Content -Raw "$env:USERPROFILE\cutex-download\cutex-install.env.ps1")
if ($env:NATIVE_COMMIT) { "native commit ok" } else { throw "no NATIVE_COMMIT: is $env:N\cute-codex-build.json there?" }
py "$Dl\write-manifest.py"
cutex human install-runtime "$env:RELEASE_DIR\manifests\default.json"
```

Check: `native commit ok`; the script prints `<install base>/releases/0.1.3/manifests/default.json`;
`install-runtime` prints `native_home` = `~/.cutex/codex-home` and `bundle_manifest` = that same
file. It verifies every pinned file, so an error here names the file that is wrong.

Then start cutex and check it: **section 6**.

### B.4 Install the desktop

The package is the same portable layout as section 7, without the `src/` checkout. Installed as
below (`releases/<version>` + `current`, channel `release`), it updates itself from the GitHub
Releases (B.5).

Linux:

```sh
. ~/cutex-download/cutex-install.env
mkdir -p "$DESKTOP_BASE/releases/$DESKTOP_VERSION"
tar -xzf ~/cutex-download/cutex-desktop-$DESKTOP_VERSION-linux-x64.tar.gz -C "$DESKTOP_BASE/releases/$DESKTOP_VERSION" --strip-components=1
ln -sfn "$DESKTOP_BASE/releases/$DESKTOP_VERSION" "$DESKTOP_BASE/current"
echo release > "$DESKTOP_BASE/channel"
test -x "$DESKTOP_BASE/current/cutex" && echo "desktop ok"
sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null
```

If the last line prints `= 1` (Ubuntu 23.10 and later), the app needs an AppArmor profile before its
first start (section 7.1 explains why). First check whether one already exists for this path (e.g.
from an earlier install) and whether it is loaded:

```sh
. ~/cutex-download/cutex-install.env
A="$(realpath "$DESKTOP_BASE")/releases/*/cutex"
F=$(grep -Fls -e " $A " -e "\"$A\"" /etc/apparmor.d/* 2>/dev/null | head -n 1)
if [ -n "$F" ]; then
  NAME=$(sed -n -E 's/^[[:space:]]*profile[[:space:]]+([^[:space:]"]+)[[:space:]].*/\1/p' "$F" | head -n 1)
  if ls /sys/kernel/security/apparmor/policy/profiles/ 2>/dev/null | grep -q "^$NAME\."; then
    echo "profile $NAME loaded ($F)"
  else
    echo "profile $NAME NOT loaded; ask the person to run: sudo apparmor_parser -r $F"
  fi
else
  echo "no profile yet"
fi
```

- `profile … loaded`: skip the rest of this step.
- `NOT loaded`: ask the person to run the printed `sudo apparmor_parser -r …` command, then skip
  the rest of this step.
- `no profile yet`: write it as below (the name gets a suffix when another install already owns
  `/etc/apparmor.d/cutex-desktop`, as the install script of section 7.1 does), then ask the person
  to run the two printed `sudo` commands.

```sh
. ~/cutex-download/cutex-install.env
RBASE=$(realpath "$DESKTOP_BASE")
NAME=cutex-desktop
if [ -e /etc/apparmor.d/$NAME ]; then NAME=cutex-desktop-$(printf '%s' "$RBASE" | sha256sum | cut -c1-8); fi
cat > "$DESKTOP_BASE/apparmor-cutex-desktop" <<PROFILE
abi <abi/4.0>,
include <tunables/global>

profile $NAME "$RBASE/releases/*/cutex" flags=(unconfined) {
  userns,
  include if exists <local/$NAME>
}
PROFILE
echo "sudo install -m 644 \"$DESKTOP_BASE/apparmor-cutex-desktop\" /etc/apparmor.d/$NAME"
echo "sudo apparmor_parser -r /etc/apparmor.d/$NAME"
```

If the app later aborts at start with `The SUID sandbox helper binary was found, but is not
configured correctly`, the profile is missing or not loaded: run the check above again.

Start the app detached, in the graphical session (rule 6):

```sh
. ~/cutex-download/cutex-install.env
setsid -f "$DESKTOP_BASE/current/cutex" >/dev/null 2>&1 </dev/null
```

If no window appears, your shell may not belong to the graphical session (`echo
"$DISPLAY$WAYLAND_DISPLAY"` prints nothing): ask the person to run the same command in a terminal
of their desktop session.

The Linux package adds no app-menu entry by itself. Optionally (ask the person; if
`~/.local/share/applications/cutex-desktop.desktop` already exists, leave it alone), add one for
your user so Cutex can be started from the app menu after a reboot. It points at `current`, so it
stays valid across updates:

```sh
. ~/cutex-download/cutex-install.env
LAUNCHER=~/.local/share/applications/cutex-desktop.desktop
if [ -e "$LAUNCHER" ]; then echo "launcher already exists, not changed"; else
  mkdir -p ~/.local/share/applications
  cat > "$LAUNCHER" <<LAUNCHER_END
[Desktop Entry]
Type=Application
Name=Cutex
Exec="$DESKTOP_BASE/current/cutex"
Icon=$DESKTOP_BASE/current/resources/app/resources/icons/icon-256.png
Terminal=false
Categories=Development;
LAUNCHER_END
  echo "launcher ok"
fi
```

Without it, start the app again with the `setsid` line above (or `"$DESKTOP_BASE/current/cutex"`
in a terminal).

Windows:

```powershell
Invoke-Expression (Get-Content -Raw "$env:USERPROFILE\cutex-download\cutex-install.env.ps1")
$Rel = "$DesktopBase\releases\$DesktopVersion"
New-Item -ItemType Directory -Force "$DesktopBase\releases" | Out-Null
Expand-Archive "$Dl\cutex-desktop-$DesktopVersion-windows-x64.zip" -DestinationPath "$DesktopBase\releases\unpack-$DesktopVersion"
Move-Item "$DesktopBase\releases\unpack-$DesktopVersion\cutex-desktop-$DesktopVersion-windows-x64" $Rel
Remove-Item "$DesktopBase\releases\unpack-$DesktopVersion"
if (Test-Path "$DesktopBase\current") { (Get-Item "$DesktopBase\current").Delete() }
New-Item -ItemType Junction -Path "$DesktopBase\current" -Target $Rel | Out-Null
Set-Content -Path "$DesktopBase\channel" -Value release
Get-ChildItem "$DesktopBase\current\cutex.exe"
Start-Process "$DesktopBase\current\cutex.exe"
```

The first start creates the Start-menu shortcut **Cutex**; start the app from there afterwards.
If you downloaded the zip with a browser, Windows SmartScreen may warn on the first start (B.6).

macOS (the desktop only; connect to your cutex machine as in section 7.4). The app lives in
`~/Applications/cutex-desktop/releases/<version>.noindex/Cutex.app` (`.noindex`: Spotlight lists only
the launcher); on its first start it creates `~/Applications/Cutex.app`, a copy it keeps on the
current version, which is the one to start (and pin to the Dock) from then on:

```sh
. ~/cutex-download/cutex-install.env
cd ~/cutex-download
F=cutex-desktop-$DESKTOP_VERSION-macos-$ARCH.zip
minisign -Vm "$F" -P "$PUB"                # downloaded in B.1; verify again before unpacking
REL="$DESKTOP_BASE/releases/$DESKTOP_VERSION.noindex"
mkdir -p "$DESKTOP_BASE/releases"
ditto -x -k "$F" "$DESKTOP_BASE/releases/unpack-$DESKTOP_VERSION"
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
  `cutex upgrade stage` (downloads, verifies and preflights it), then `cutex upgrade apply` (it waits
  until no agent is working; `--max-wait <secs>` gives up instead, changing nothing). `apply` without
  a staged release fails with `not_staged` (`docs/backend-upgrade.md` in the cutex repository).
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

- **Windows**: if the zip came through a browser (which marks downloads; `curl.exe` as in B.1 does
  not), SmartScreen says "Windows protected your PC" on the first start: click
  **More info → Run anyway**. To clear the download mark for the whole folder instead:
  `Get-ChildItem -Recurse "$DesktopBase\releases\$DesktopVersion" | Unblock-File`.
- **macOS**: "Cutex cannot be opened because the developer cannot be verified" (or "Apple could not
  verify…"). Right-click (Control-click) `Cutex.app` → **Open** → **Open**; on macOS 15 and later,
  open System Settings → Privacy & Security and click **Open Anyway**, then confirm. The keychain
  prompt of section 10 applies too.
- **Linux**: nothing beyond the AppArmor step of B.4.

The cutex and cute-codex command-line programs get no such warnings (they are not started from
Explorer or Finder).

### B.7 Known issues

The current list of known issues (with workarounds and planned fixes) is
[docs/KNOWN-ISSUES.md](https://github.com/senxiu-official/cutex-desktop/blob/release/docs/KNOWN-ISSUES.md);
the app shows the same list under Settings → About (关于) → Known issues. Read it before reporting a
problem. Among them: there is no phone app or push yet, the in-app browser refuses LAN / tailnet
addresses and blocks downloads, the Job Service and NCI jobs run on Linux hosts only, and macOS runs
the desktop only.

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
`0.160.0-r52.3`). Remember that version; section 5 uses it. Compiler `warning:` lines are expected
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

Check: `cutex --version` prints `cutex 0.1.3 (<7-char commit>)` (warnings during the build are
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

The Management API also runs the notification worker (webhook delivery and the notification states
the desktop shows), so there is no separate `cutex notify run` service to set up. On Windows,
`cutex human service` (the TUI services page) starts and stops both services through the
`\Cutex\cutex-supervisor` task.

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
$CutexBase = "$env:LOCALAPPDATA\cutex"
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

Two optional components come after cutex runs: the Claude runtime for Claude Code agents (section
6.1) and, on Linux, the Job Service for long-running jobs (section 6.2).

## 6. Start cutex and check it

After a binary install (section B), begin each block of sections 6 and 6.1 / 6.2 with the line
that loads the settings file (`. ~/cutex-download/cutex-install.env`; Windows: the
`Invoke-Expression` line of B.1), so `cutex` is on PATH in that shell.

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

### 6.1 Optional: Claude Code agents (the Claude runtime)

Skip this unless you want agents that run Anthropic's Claude Code instead of Codex. The Claude
runtime is an optional cutex component: a small Python adapter between cutex and the official
Claude Code CLI. cutex installs and updates it; you install two things it cannot ship for you:

- **Python 3.11 or newer** with the `venv` module. cutex creates a private virtual environment from
  the wheels in the component archive, offline. Linux: Debian 12+ / Ubuntu 24.04+
  `sudo apt install -y python3 python3-venv`; Ubuntu 22.04 `sudo apt install -y python3.11 python3.11-venv`.
  Windows: `winget install Python.Python.3.13` (or the python.org installer); cutex finds it with `py -3`.
- **The Claude Code CLI** (`claude`), installed by you under your own Anthropic account. Its license does not allow
  redistribution, so no Cutex archive contains it. Linux: `curl -fsSL https://claude.ai/install.sh | bash`;
  Windows (PowerShell): `irm https://claude.ai/install.ps1 | iex`. Check with `claude --version`.

`npm install -g @anthropic-ai/claude-code` works too. Do not point cutex at the copy bundled inside
the `claude-agent-sdk` wheels from PyPI. cutex looks for `claude` on PATH, then in `~/.local/bin` (Windows
`%USERPROFILE%\.local\bin`). If yours is elsewhere, set `CUTEX_CLAUDE_CLI=<path>` in the shell
where you run `cutex component install claude-runtime` (the install records that path); when you
install from the desktop's install card instead, set it for the cutex services, which run that
install. `CUTEX_CLAUDE_PYTHON=<path>` does the same for Python.

Install the component. A binary install (section B) downloads the signed archive that belongs to the
installed cutex release:

```sh
cutex component install claude-runtime
cutex component status claude-runtime
```

A source install builds it from the checkout instead (this downloads the Python wheels from PyPI):

```sh
cutex component install claude-runtime --from-source ~/src/cutex
```

```powershell
cutex component install claude-runtime --from-source "$env:USERPROFILE\src\cutex"
```

The desktop does the same from **Settings → Profiles → new Profile → Claude** or the new-agent page
when the host has no Claude runtime yet: they show an install card with the same steps.

`status` reports `state`. `needsUser` lists the remaining `steps`, which you follow and then install
again (the prepared environment is reused):

| Code in `detail.needsUser.code` | What to do |
|---|---|
| `python_missing`, `python_too_old`, `python_venv_missing` | Install Python 3.11+ with venv (above) |
| `claude_cli_missing` | Install the Claude Code CLI (above) |
| `codex_runtime_missing` | Select the Codex runtime first (section 5.3 / B.3) |
| `claude_login_required` | Log in (below); the runtime itself is ready |

Log in once. Either use a Claude subscription: `cutex human claude account login default` runs the
official `claude auth login` for cutex's own Claude home (not your `~/.claude`). Or use an API key:
`cutex human claude account add <label> --api --api-key-stdin` and paste the key on stdin. Then create a
Profile of kind **Claude** in the desktop (section 8) and an agent on it.

Check: `cutex component status claude-runtime` says `ready`, and
`cutex human claude account list` shows the account as logged in.

Updates and removal: a backend update (section 9) also downloads the Claude runtime version that
belongs to the new cutex release and selects it for **new** Claude agents. Existing agents keep the
version they started on, and `versions[].pinnedBy` counts them. `cutex component remove claude-runtime`
only deselects it; `cutex component prune` deletes versions no agent uses. The component's README
(`components/claude-runtime/README.md` in the cutex repository) documents the selected
`~/.cutex/runtime/claude/deployment.json` and the foreground TUI (`cutex human claude attach`).

### 6.2 Optional: long-running jobs (the Job Service, Linux)

Skip this unless you want agents to start long-running commands (builds, tests, training runs)
that keep going after their turn ends and report back when they finish: the desktop's **Jobs**
page. The Job Service is an optional cutex component, Linux only, run as the systemd user unit
`cutex-job-service.service`. It needs nothing beyond what sections B / 2 to 6 installed: the Codex
runtime selected in 5.3 / B.3 (its `codex` CLI is the jobs' sandbox launcher).

Install it on a binary install (section B), which downloads the signed archive that belongs to the
installed cutex release:

```sh
cutex component install job-service
cutex component status job-service
```

A source install builds it from the checkout instead (with the Rust toolchain of section 1):

```sh
cutex component install job-service --from-source ~/src/cutex
```

The desktop's **Jobs** page shows an install card with the same **Install** button when the host
has no Job Service yet.

Check: `cutex component status job-service` says `ready`. Agents created from now on get the job
tools. If it says `needsUser`, the `steps` name what is missing: no Codex runtime is selected for new
agents, or the selected one has no `codex` CLI. Fix that (5.3 / B.3), then install again.

Updates and removal: a backend update (section 9) installs the Job Service version that belongs to
the new cutex release; a restart that would interrupt a running job waits until the job has
finished (`restartPending`). `cutex component remove job-service` stops it and keeps the job
records and output (it refuses while jobs run unless you add `--force`); `cutex component prune
job-service` deletes versions nothing uses.

NCI remote jobs (the NCI module in [ANU.md](ANU.md)) build on the Job Service: available from
cutex 0.1.1, Linux hosts only. The module is off by default (Settings → Modules); skip it unless
you use NCI Gadi.

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

**Linux, Ubuntu 23.10 and later**: Ubuntu blocks the unprivileged user namespaces that Electron's
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

Start it detached, in the graphical session (rule 6): Linux
`setsid -f "$DESKTOP_BASE/current/cutex" >/dev/null 2>&1 </dev/null` (the same command starts it
later; for an app-menu entry see the optional launcher step of B.4); macOS
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

**A Windows cutex machine** needs the OpenSSH server, which Windows ships but does not turn on.
Ask the person before these steps: they need an elevated PowerShell (Run as administrator) on the
Windows machine.

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
Get-NetFirewallRule -Name *OpenSSH-Server* | Select-Object Name, Enabled   # the installer adds an inbound rule for port 22
```

Then put the Mac's public key (`~/.ssh/id_ed25519.pub`) into the Windows account's
`%USERPROFILE%\.ssh\authorized_keys`. For an account in the Administrators group, OpenSSH reads
`C:\ProgramData\ssh\administrators_authorized_keys` instead; that file must be writable only by
Administrators and SYSTEM:
`icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"`.

The app runs `cutex management client-token issue` over SSH to pair. OpenSSH runs it in `cmd.exe`
with the account's PATH, so `%LOCALAPPDATA%\cutex\bin` (added in B.2 / 5.2) must be on the **user**
PATH; restart the service (`Restart-Service sshd`, elevated) after changing PATH so new sessions see
it. Check from the Mac: `ssh user@machine cutex --version` prints the cutex version. If it does not,
the app still looks for `%LOCALAPPDATA%\cutex\bin\cutex.exe` by itself, as long as the account name
contains no spaces; otherwise fix the PATH.

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
After a binary install (section B) that is the way to update; it also brings installed optional
components (6.1, 6.2) to the versions of the new release. A cutex built from source can use it
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
8. Optional components installed from source (6.1, 6.2): run their
   `cutex component install <name> --from-source ~/src/cutex` again to pick up a newer version.

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
| Linux (Ubuntu 23.10+): the app does not start, mentioning the sandbox / `chrome-sandbox` | The AppArmor step of B.4 / section 7.1 was skipped, or its profile is not loaded. Run the check in B.4 and ask the person to run the `sudo` commands it names. |
| Something that looks like a bug but may be known (no phone push, in-app browser refusing a LAN address or a download, no Jobs on Windows / macOS) | See the known issues (B.7). |
| `nvm install 24` leaves `node --version` at an older version | `~/.npmrc` sets `prefix`; see the Node 24 item in section 1. |
| `git pull`: "divergent branches" / "unrelated histories", or `git fetch --tags`: "would clobber existing tag" | The published `release` branch was replaced instead of moved forward (each release is normally a child of the previous one). Keep your old state under another name and follow the new one: `git branch -m release old-release`, `git fetch --force --tags origin`, `git switch -c release --track origin/release`. For the desktop `src`, then rerun the install script (9). |
| Updates & diagnostics: "Installed from a release package" | A release package that is not in the `releases/<version>` + `current` layout of B.4 (e.g. unpacked somewhere else, or `Cutex.app` dragged to `/Applications`), so it cannot replace itself; the page links to the Releases page. Reinstall it as in B.4 to get the one-click updates of B.5, or update by hand (B.5). |
| Updates & diagnostics: "Not a portable install" | The app was not started from `<desktop base>/current`, or `<desktop base>/src` is missing. Start it from `current`, or reinstall with section 7. |
| Updates & diagnostics: "The update source has no branch for this channel yet" | The `release` branch is not published on the repository `src` was cloned from. Wait for it, or check `git -C <desktop base>/src remote -v`. |
| Backend updates: `no_trusted_keys` | A cutex built without the release keys (a fork, or a build older than 0.1.0). Update it from source once (section 9); later updates can use Backend updates. |
| Backend updates: `unmanaged_install` | The running cutex was not installed with `cutex service install` (e.g. started by hand from a build directory). Install it as in B.2 or 5.2. |
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
- Claude runtime (6.1): its versions live under `<install base>/components/claude-runtime` and go
  with the install base; the Claude Code CLI you installed is removed with its own uninstaller.
- Job Service (6.2): `cutex component remove job-service` before `cutex service uninstall` stops
  its unit; its versions live under `<install base>/components/job-service`, its job records under
  `~/.cutex/runtime/job-service`.
- `~/.cutex` holds every agent, conversation, Profile and credential. Delete it only if you want all
  of that gone.
- Linux AppArmor profile (section 7.1), if installed:
  `sudo apparmor_parser -R /etc/apparmor.d/cutex-desktop && sudo rm /etc/apparmor.d/cutex-desktop`.

Download leftovers of a binary install (section B): `~/cutex-download` (Windows
`%USERPROFILE%\cutex-download`, about 0.4 GB) can go once B.4 is done; everything in it was
unpacked or copied into the install bases. Keep only `cutex-install.env` (`.ps1`) if you want its
paths for later.

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
(a `SKILL.md` plus `references/`, in Chinese; the agent answers in the person's language). Every
desktop package carries a copy (`<desktop base>/current/skills/cutex-docs`), and a desktop built
from source has it in `<desktop base>/src/skills/cutex-docs`. With it,
the person can ask their own coding agent "how do I … in Cutex?" or "what does this error mean?".
It is optional and changes nothing in cutex or the desktop.

If the person wants it, copy the whole folder into their agent's personal skills directory:

| Agent | Directory |
|---|---|
| Claude Code | `~/.claude/skills/cutex-docs` |
| Codex CLI (and cute-codex) | `~/.agents/skills/cutex-docs` (older Codex versions read `~/.codex/skills`) |
| Any other agent | that agent's skills directory; check its documentation |

Linux / macOS (`DESKTOP_BASE` as in B.4 or section 7; after a binary install, first load the
settings file: `. ~/cutex-download/cutex-install.env`):

```sh
mkdir -p ~/.claude/skills
SKILL="$DESKTOP_BASE/current/skills/cutex-docs"
[ -d "$SKILL" ] || SKILL="$DESKTOP_BASE/src/skills/cutex-docs"
cp -R "$SKILL" ~/.claude/skills/
```

Windows:

```powershell
# after a binary install: Invoke-Expression (Get-Content -Raw "$env:USERPROFILE\cutex-download\cutex-install.env.ps1")
# after a source install: $DesktopBase = "$env:LOCALAPPDATA\Programs\cutex-desktop-app"
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
$Skill = "$DesktopBase\current\skills\cutex-docs"
if (-not (Test-Path $Skill)) { $Skill = "$DesktopBase\src\skills\cutex-docs" }
Copy-Item -Recurse -Force $Skill "$env:USERPROFILE\.claude\skills\"
```

(Use the Codex directory from the table instead if that is the person's agent. Packages up to
0.1.1 have no copy: download the folder from the `release` branch of
`https://github.com/senxiu-official/cutex-desktop` instead.) The copy does not
update itself: after a desktop update, copy the folder again to refresh it. Note that cute-codex
also reads `~/.agents/skills`, so cutex agents on that machine may see the skill too; that is harmless.

## ANU users

See [ANU.md](ANU.md) for two optional modules, both off by default: Claude Science (anyone with a Claude Science account) and NCI remote jobs (users of NCI, e.g. Gadi). Skip it if neither applies.
