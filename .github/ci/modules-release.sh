#!/usr/bin/env bash
# Sign and publish signed first-party module packs (docs/desktop-modules.md §23.10) on the
# `modules-release` GitHub release of the public desktop repo: the pack archives built by
# apps/desktop/scripts/module-packs/build.mjs, a new modules.json that keeps every published entry, and
# its minisign signature.
#
#   bash .github/ci/modules-release.sh --packs DIR --dir WORK [--owner OWNER] [--repo NAME]
#        [--key FILE] [--password-env NAME] [--pubkey FILE] [--upload]
#
#   --packs DIR          build.mjs output (<id>-<version>.tar.gz + .pack.json)
#   --dir WORK           working directory (previous index, new index, verification downloads)
#   --owner / --repo     the GitHub repository (default senxiu-official / cutex-desktop)
#   --key FILE           minisign secret key (default ~/.minisign/minisign.key)
#   --password-env NAME  non-interactive: the passphrase is in environment variable NAME; it is copied,
#                        NAME is unset (no child inherits it) and the passphrase reaches `minisign -S` on
#                        stdin only (as sign-and-upload.sh does). Without it minisign prompts.
#   --pubkey FILE        the release public key (default: cutex-release.pub next to this script)
#   --root DIR           the desktop repo checkout (default: two levels above this script, .github/ci/)
#   --upload             publish; without it (dry run) everything is checked and signed, and the gh
#                        commands that would publish are printed.
#
# Checks, in order: the published modules.json (if any) verifies with --pubkey and is signed for the file
# name modules.json; the new index is generated from it (index.mjs: published entries kept, a published id +
# version must be byte-identical, serial moves forward, the app's strict parser accepts the result); the
# new signature verifies with --pubkey before anything is uploaded. Upload order: new archives first (an
# archive name already on the release is never overwritten: it must already be byte-identical), each
# downloaded again and compared; then modules.json + modules.json.minisig, downloaded again, compared and
# verified. `modules-release` is created as a non-draft release that is never "latest" (the desktop's binary
# updater reads /releases/latest).
#
# Needs: gh (GH_TOKEN or logged in, contents: write), minisign, node 24 with the repo's dependencies installed.
set -euo pipefail

TAG=modules-release
here="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$here/../.." && pwd -P)"
packs="" dir="" owner="senxiu-official" repo_name="cutex-desktop" key="$HOME/.minisign/minisign.key" password_env="" pubkey_file="$here/cutex-release.pub" upload=0
while [ $# -gt 0 ]; do
  case "$1" in
    --packs) packs="$2"; shift 2 ;;
    --dir) dir="$2"; shift 2 ;;
    --owner) owner="$2"; shift 2 ;;
    --repo) repo_name="$2"; shift 2 ;;
    --key) key="$2"; shift 2 ;;
    --password-env) password_env="$2"; shift 2 ;;
    --pubkey) pubkey_file="$2"; shift 2 ;;
    --root) root="$(cd "$2" && pwd -P)"; shift 2 ;;
    --upload) upload=1; shift ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$packs" ] && [ -d "$packs" ] || { echo "--packs DIR is required" >&2; exit 2; }
[ -n "$dir" ] || { echo "--dir WORK is required" >&2; exit 2; }
[[ "$owner" =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]] && [[ "$repo_name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad --owner / --repo" >&2; exit 2; }
[ -f "$pubkey_file" ] || { echo "public key $pubkey_file is missing" >&2; exit 2; }
[ -f "$key" ] || { echo "secret key $key is missing" >&2; exit 2; }
repo="$owner/$repo_name"
pub="$(sed -n 2p "$pubkey_file")"
[ -n "$pub" ] || { echo "$pubkey_file is not a minisign public key" >&2; exit 2; }

password="" have_password=0
if [ -n "$password_env" ]; then
  case "$password_env" in [A-Za-z_]*) ;; *) echo "--password-env needs a variable name" >&2; exit 2 ;; esac
  case "$password_env" in *[!A-Za-z0-9_]*) echo "--password-env needs a variable name" >&2; exit 2 ;; esac
  [ -n "${!password_env:-}" ] || { echo "--password-env $password_env: that variable is unset or empty" >&2; exit 2; }
  password="${!password_env}"
  have_password=1
  unset "$password_env"
fi
minisign_sign() {
  if [ "$have_password" = 1 ]; then
    ( trap '' PIPE; printf '%s\n' "$password" 2> /dev/null || true ) | minisign -S -s "$key" -m "$@"
  else
    minisign -S -s "$key" -m "$@"
  fi
}
# minisign_verify FILE [SIG]: verifies with the release key and requires the trusted comment to name
# modules.json when FILE is the index (the app checks the same: main/minisign.ts verifyData).
minisign_verify() {
  local f="$1" sig="${2:-$1.minisig}" out
  out="$(minisign -V -P "$pub" -m "$f" -x "$sig")" || { echo "$sig does not verify $f with $pubkey_file" >&2; exit 1; }
  if [ "$(basename "$f")" = modules.json ]; then
    printf '%s\n' "$out" | grep -qE $'^Trusted comment: (.*\t)?file:modules\\.json(\t|$)' || { echo "$sig is not a signature for the file name modules.json" >&2; exit 1; }
  fi
}
do_gh() { if [ "$upload" = 1 ]; then (set -x; gh "$@"); else printf 'gh'; printf ' %q' "$@"; printf '\n'; fi; }
sha() { sha256sum < "$1" | cut -d' ' -f1; }

mkdir -p "$dir"
dir="$(cd "$dir" && pwd -P)"
packs="$(cd "$packs" && pwd -P)"
rm -rf "$dir/previous" "$dir/out" "$dir/verify"
mkdir -p "$dir/previous" "$dir/out" "$dir/verify"

# 1. The published index, if there is one, verified with the release key.
release_exists=0 previous=()
assets=""
if assets="$(gh release view "$TAG" -R "$repo" --json assets -q '.assets[].name' 2> "$dir/gh-view.err")"; then
  release_exists=1
elif ! grep -qi 'not found' "$dir/gh-view.err"; then
  echo "gh release view $TAG failed: $(cat "$dir/gh-view.err")" >&2
  exit 1
fi
if [ "$release_exists" = 1 ] && printf '%s\n' "$assets" | grep -qx modules.json; then
  gh release download "$TAG" -R "$repo" -p modules.json -p modules.json.minisig -D "$dir/previous" --clobber
  minisign_verify "$dir/previous/modules.json"
  previous=(--previous "$dir/previous/modules.json")
  echo "published index verified ($(sha "$dir/previous/modules.json"))"
else
  echo "no published modules.json yet: this is the first module index"
fi

# 2. The new index (strictly checked by the app's own parser inside index.mjs).
node "$root/apps/desktop/scripts/module-packs/index.mjs" --packs "$packs" \
  --base-url "https://github.com/$repo/releases/download/$TAG" ${previous[@]+"${previous[@]}"} \
  --out "$dir/out/modules.json" --new-list "$dir/out/new.txt"
mapfile -t new < "$dir/out/new.txt"
if [ "${#new[@]}" = 0 ]; then
  echo "nothing new: every pack version is already published (byte-identical); leaving $TAG as it is"
  exit 0
fi

# 3. Sign and verify before anything is uploaded.
minisign_sign "$dir/out/modules.json"
minisign_verify "$dir/out/modules.json"
( cd "$dir/out" && sha256sum modules.json modules.json.minisig ) > "$dir/out/SHA256SUMS"
for f in "${new[@]}"; do ( cd "$(dirname "$f")" && sha256sum "$(basename "$f")" ) >> "$dir/out/SHA256SUMS"; done
cat "$dir/out/SHA256SUMS"

# 4. Upload (or print): archives, then the index.
if [ "$release_exists" = 0 ]; then
  do_gh release create "$TAG" -R "$repo" --title "Module packs" --latest=false \
    --notes "Signed first-party module packs for the Cutex desktop app (modules.json, signed with the Cutex release key). The app downloads from here only when you choose Download / Update in Settings → Modules. Not a desktop release."
fi
for f in "${new[@]}"; do
  n="$(basename "$f")"
  if printf '%s\n' "$assets" | grep -qxF "$n"; then
    # Already there (an earlier interrupted run): must be the same bytes; never overwritten.
    rm -f "$dir/verify/$n"
    gh release download "$TAG" -R "$repo" -p "$n" -D "$dir/verify" --clobber
    [ "$(sha "$dir/verify/$n")" = "$(sha "$f")" ] || { echo "$TAG already has a different $n: bump the pack version" >&2; exit 1; }
    echo "$n: already on $TAG, identical"
    continue
  fi
  do_gh release upload "$TAG" -R "$repo" "$f"
done
verify_asset() { # name local-file
  rm -f "$dir/verify/$1"
  gh release download "$TAG" -R "$repo" -p "$1" -D "$dir/verify" --clobber || { echo "$TAG: $1 is not on the release after the upload" >&2; exit 1; }
  [ "$(sha "$dir/verify/$1")" = "$(sha "$2")" ] || { echo "$TAG/$1 differs from the local file" >&2; exit 1; }
}
if [ "$upload" = 1 ]; then
  for f in "${new[@]}"; do verify_asset "$(basename "$f")" "$f"; done
  echo "${#new[@]} archive(s) verified on $TAG"
fi
do_gh release upload "$TAG" -R "$repo" --clobber "$dir/out/modules.json" "$dir/out/modules.json.minisig"
if [ "$upload" = 1 ]; then
  verify_asset modules.json "$dir/out/modules.json"
  verify_asset modules.json.minisig "$dir/out/modules.json.minisig"
  minisign_verify "$dir/verify/modules.json" "$dir/verify/modules.json.minisig"
  latest="$(gh api "repos/$repo/releases/latest" -q .tag_name 2> /dev/null || true)"
  [ "$latest" != "$TAG" ] || { echo "$TAG became the latest release: the binary updater would read it; fix with: gh release edit <desktop tag> -R $repo --latest" >&2; exit 1; }
  echo "$TAG: modules.json published and verified"
else
  echo "# dry run: nothing uploaded"
fi
