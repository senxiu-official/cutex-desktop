#!/usr/bin/env bash
# Build and pack the portable desktop for one platform (a release package: no source checkout recorded,
# channel `release`, the Releases page recorded for Settings → Updates & diagnostics):
#
#   cutex-desktop-<version>-linux-x64.tar.gz     cutex-desktop-<version>-linux-x64/cutex, resources/, ...
#   cutex-desktop-<version>-windows-x64.zip      cutex-desktop-<version>-windows-x64\cutex.exe, ...
#   cutex-desktop-<version>-macos-<arch>.zip     cutex-desktop-<version>-macos-<arch>/Cutex.app (ad-hoc signed)
#
#   bash .github/ci/package-desktop.sh <platform> <version> <out-dir>
#
# <platform>: linux-x64 | windows-x64 | macos-arm64 | macos-x64 (macos-x64 is packed on an arm64 Mac
# with the x64 Electron runtime: the app bundles only JavaScript, no native modules).
# Needs Node 24 with corepack, git, and on Windows 7-Zip (`7z`, present on GitHub's runners).
set -euo pipefail

platform="${1:?platform}"
version="${2:?version}"
out="${3:?out dir}"
case "$platform" in
  linux-x64 | windows-x64 | macos-arm64 | macos-x64) ;;
  *) echo "unknown platform $platform" >&2; exit 2 ;;
esac
[[ "$version" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "invalid version: $version" >&2; exit 2; }
release_page="${RELEASE_PAGE:-https://github.com/senxiu-official/cutex-desktop/releases}"

# Git Bash on Windows: directories given as C:\... become /c/... (GitHub passes RUNNER_TEMP that way).
unixpath() { if command -v cygpath > /dev/null 2>&1; then cygpath -u "$1"; else printf '%s' "$1"; fi; }
out="$(unixpath "$out")"
root="$(cd "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
cd "$root"
mkdir -p "$out"
out="$(cd "$out" && pwd -P)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "the checkout has local changes; build from a clean checkout" >&2
  exit 1
fi
# Paths handed to native Windows programs (node, 7z) are converted explicitly; Git Bash's automatic
# argument conversion is off so the https URL below reaches node unchanged.
if [ "$platform" = windows-x64 ]; then export MSYS2_ARG_CONV_EXCL='*'; native() { cygpath -w "$1"; }; else native() { printf '%s' "$1"; }; fi
sha256() { if command -v sha256sum > /dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npm_config_update_notifier=false
corepack pnpm install --frozen-lockfile
(cd apps/desktop && corepack pnpm build)

electron="$(node -e 'const {createRequire}=require("node:module");const r=createRequire(process.argv[1]);console.log(require("node:path").dirname(r.resolve("electron/package.json")))' "$(native "$root/apps/desktop/package.json")")"
if [ "$platform" = macos-x64 ]; then
  [ "$(uname -s)" = Darwin ] || { echo "macos-x64 is packed on macOS" >&2; exit 1; }
  # Swap in the x64 Electron runtime (install.js picks the arch from ELECTRON_INSTALL_ARCH; it skips the
  # download while dist/ exists, so remove it first).
  rm -rf "${electron:?}/dist"
  (cd "$electron" && ELECTRON_INSTALL_ARCH=x64 node install.js)
  file "$electron/dist/Electron.app/Contents/MacOS/Electron" | grep -q x86_64 || { echo "the Electron runtime is not x64" >&2; exit 1; }
fi

name="cutex-desktop-$version-$platform"
work="$root/../desktop-package"
rm -rf "${work:?}"
mkdir -p "$work"
node scripts/package-portable.mjs "$(native "$work/$name")" --no-source --channel release --release-page "$release_page"

case "$platform" in
  linux-x64)
    mtime="$(git log -1 --format=%ct)"
    tar -C "$work" --owner=0 --group=0 --numeric-owner --mtime="@$mtime" --sort=name -cf - "$name" | gzip -n -9 > "$out/$name.tar.gz"
    archive="$name.tar.gz"
    ;;
  windows-x64)
    (cd "$work" && 7z a -tzip -mx=9 -bd "$(native "$out/$name.zip")" "$name" > /dev/null)
    archive="$name.zip"
    ;;
  macos-*)
    # ditto keeps the bundle's symlinks, permissions and signature (zip -r would not).
    codesign --verify --deep --strict "$work/$name/Cutex.app"
    ditto -c -k --sequesterRsrc --keepParent "$work/$name" "$out/$name.zip"
    archive="$name.zip"
    ;;
esac
commit="$(git rev-parse HEAD)"
cat > "$out/BUILD-INFO-$platform.json" <<EOF
{
  "version": "$version",
  "commit": "$commit",
  "platform": "$platform",
  "archive": "$archive"
}
EOF
(cd "$out" && sha256 "$archive" > "SHA256SUMS-$platform")
echo "packed $out/$archive"
cat "$out/SHA256SUMS-$platform"
