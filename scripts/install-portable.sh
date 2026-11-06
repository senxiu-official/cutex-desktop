#!/usr/bin/env bash
# First install (or manual reinstall) of a self-updating portable desktop on Linux / macOS.
#
#   scripts/install-portable.sh [--base <dir>] [--source <base>/src] [--channel main|release]
#
# --base defaults to $CUTEX_DESKTOP_PORTABLE_BASE, else ~/Applications/cutex-desktop.
# --channel writes <base>/channel (main = 开发版, release = 正式版; Settings → 更新与诊断 can switch later);
# without it an existing <base>/channel is kept and a new install follows main.
#
# Mirrors what the in-app updater does for later updates (apps/desktop/src/main/updater.ts +
# src/shared/update.ts) and scripts/install-portable.ps1 (Windows): in the source checkout run
# `pnpm install --frozen-lockfile`, `pnpm build` (apps/desktop) and
# `node scripts/package-portable.mjs <base>/releases/<short-hash[-N]>`, then point the <base>/current
# symlink at the new release. Linux: launch <base>/current/cutex. macOS: open ~/Applications/Cutex.app,
# a clone of <base>/current/Cutex.app that this script and the app keep current (release dirs are
# named <hash>.noindex so Spotlight lists only that one); set CUTEX_DESKTOP_CODESIGN_IDENTITY to sign
# with a local identity, see docs/install/AGENT-INSTALL.md section 10.
# Then, like the app after an update, every release but the new one and the previous one is moved to
# <base>/old-releases (scripts/archive-releases.mjs; never deleted here).
# Does not pull: update the checkout first (git -C <source> pull --ff-only origin <branch>).
#
# Node: CUTEX_DEV_NODE_DIR=<dir with the node binary> is put first on PATH (as on Windows), e.g.
# when nvm cannot switch because ~/.npmrc sets a prefix.
# Linux with kernel.apparmor_restrict_unprivileged_userns=1 (Ubuntu 23.10+): if no AppArmor profile
# allows user namespaces for <base>/releases/*/cutex, one is written to <base>/apparmor-cutex-desktop
# and the two sudo commands that install it are printed (scripts/lib/linux-apparmor.sh).
set -euo pipefail

base="${CUTEX_DESKTOP_PORTABLE_BASE:-$HOME/Applications/cutex-desktop}"
source=""
channel=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) base="$2"; shift 2 ;;
    --source) source="$2"; shift 2 ;;
    --channel) channel="$2"; shift 2 ;;
    *) echo "usage: $0 [--base <dir>] [--source <dir>] [--channel main|release]" >&2; exit 2 ;;
  esac
done
case "$channel" in ""|main|release) ;; *) echo "--channel must be main or release" >&2; exit 2 ;; esac
[ -n "$source" ] || source="$base/src"
echo "base $base | source $source"

if [ -n "${CUTEX_DEV_NODE_DIR:-}" ]; then
  [ -x "$CUTEX_DEV_NODE_DIR/node" ] || { echo "CUTEX_DEV_NODE_DIR has no node binary: $CUTEX_DEV_NODE_DIR" >&2; exit 1; }
  export PATH="$CUTEX_DEV_NODE_DIR:$PATH"
fi
node_major="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [ "$node_major" != "24" ]; then
  echo "Node 24 required on PATH (found: $(node --version 2>/dev/null || echo none) at $(command -v node || echo -))" >&2
  if [ -z "$node_major" ] || [ "$node_major" -lt 24 ] 2>/dev/null; then
    echo "hint: install Node 24 (e.g. nvm install 24) and rerun with CUTEX_DEV_NODE_DIR=<dir containing node>," >&2
    echo "      e.g. CUTEX_DEV_NODE_DIR=\$HOME/.nvm/versions/node/v24.x.y/bin (needed when ~/.npmrc sets a prefix nvm refuses)" >&2
  fi
  exit 1
fi
[ -d "$source/.git" ] || { echo "no git checkout at $source (git clone <remote> $source first)" >&2; exit 1; }
dirty="$(git -C "$source" status --porcelain --untracked-files=no)"
# The lockfile is restored only in the install's own clone <base>/src; in a --source developer tree an
# edited pnpm-lock.yaml may be the developer's own work (as the in-app updater: isOwnClone).
own_clone=0
[ "$(cd "$source" && pwd -P)" = "$(cd "$base" 2>/dev/null && pwd -P)/src" ] && own_clone=1
if [ "$own_clone" = 1 ] && [ "$dirty" = " M pnpm-lock.yaml" ]; then
  # Only the lockfile an earlier pnpm install rewrote (as the in-app updater: sourceDirtyCheck).
  echo "restoring pnpm-lock.yaml rewritten by an earlier pnpm install"
  git -C "$source" checkout -- pnpm-lock.yaml
elif [ -n "$dirty" ]; then
  echo "source checkout has uncommitted changes: $source" >&2
  printf '%s\n' "$dirty" >&2
  exit 1
fi
commit="$(git -C "$source" rev-parse HEAD)"

# releaseName(): short hash, suffixed -2, -3, ... when taken; macOS: + .noindex (hidden from Spotlight).
releases="$base/releases"
suffix=""
[ "$(uname -s)" = "Darwin" ] && suffix=".noindex"
name="${commit:0:7}$suffix"
i=2
while [ -e "$releases/$name" ]; do name="${commit:0:7}-$i$suffix"; i=$((i + 1)); done
dest="$releases/$name"

# The package keeps the channel (main stays implicit, as buildSteps does).
effective="$channel"
[ -n "$effective" ] || effective="$(head -n1 "$base/channel" 2>/dev/null | tr -d '[:space:]' || true)"
pkg_args=()
[ -n "$effective" ] && [ "$effective" != "main" ] && pkg_args=(--channel "$effective")

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# No "Update available" banner: the pnpm pinned by packageManager is the one to use.
export npm_config_update_notifier=false
# buildSteps()
(cd "$source" && corepack pnpm install --frozen-lockfile)
(cd "$source/apps/desktop" && corepack pnpm build)
(cd "$source" && node scripts/package-portable.mjs "$dest" ${pkg_args[@]+"${pkg_args[@]}"})
# Never point current at a release without its executable (a half-written package).
if [ "$(uname -s)" = "Darwin" ]; then launcher="$dest/Cutex.app/Contents/MacOS/Cutex"; else launcher="$dest/cutex"; fi
[ -x "$launcher" ] || { echo "the new release has no $launcher (current unchanged)" >&2; exit 1; }

[ -n "$channel" ] && printf '%s\n' "$channel" > "$base/channel"

# switchCurrent(): replace the symlink itself (never its target).
if [ -e "$base/current" ] && [ ! -L "$base/current" ]; then
  echo "$base/current exists and is not a symlink" >&2
  exit 1
fi
previous="$(readlink "$base/current" 2>/dev/null || true)"
ln -sfn "$dest" "$base/current"
echo "current -> $dest"
# Old releases out of the way (moved, never deleted here); macOS: the ~/Applications/Cutex.app clone.
node "$(dirname -- "${BASH_SOURCE[0]}")/archive-releases.mjs" --base "$base" ${previous:+--previous "$previous"} ||
  echo "old releases were not tidied up (the app retries at its next start)" >&2
if [ "$(uname -s)" = "Darwin" ]; then
  if [ -d "${CUTEX_DESKTOP_SHORTCUT_ROOT:-$HOME/Applications}/Cutex.app" ]; then
    echo "open \"${CUTEX_DESKTOP_SHORTCUT_ROOT:-$HOME/Applications}/Cutex.app\""
  else
    echo "open \"$base/current/Cutex.app\""
  fi
else
  echo "launch $base/current/cutex"
  # The build succeeded either way; the note says what is still needed before the first start.
  # shellcheck source=lib/linux-apparmor.sh
  . "$(dirname -- "${BASH_SOURCE[0]}")/lib/linux-apparmor.sh"
  apparmor_userns_check "$base" "$base/apparmor-cutex-desktop" || true
fi
