#!/usr/bin/env bash
# Sign the CI-built release binaries of one public repo with minisign and attach them to its GitHub
# Release. Two ways to run it, the same checks either way:
#   - interactively on the owner's machine: minisign asks for the passphrase on the terminal;
#   - non-interactively in the public repo's "Sign release" workflow (.github/workflows/sign-release.yml):
#     the key comes from an encrypted repo / environment secret written to a 0600 temp file (--key) and
#     the passphrase from another secret through --password-env (see below).
# Without --upload nothing is uploaded; the gh commands are printed instead.
#
#   sign-and-upload.sh cutex          --run ID --tag v0.1.0 --key KEY --sequence N|next [--native-run ID] [--meta FILE] [--release LABEL]
#                                     [--previous-capabilities FILE]
#   sign-and-upload.sh cute-codex     --run ID --tag cute-codex-v0.160.0-r52.2 --key KEY
#   sign-and-upload.sh cutex-desktop  --run ID --tag v0.1.0 --key KEY
#   common: [--dir DIR] (work dir, default ./signed-<project>-<tag>) [--upload] [--owner ORG]
#           [--pubkey FILE] (default: cutex-release.pub next to this script if there is one (the public
#             repos' copy), else docs/install/cutex-release.pub; another key only for a dry run)
#           [--password-env NAME] non-interactive signing: the passphrase is the value of environment
#             variable NAME. The script copies it into a shell variable, unsets NAME (so no child process
#             inherits it) and hands it to `minisign -S` on stdin (minisign reads the password from stdin
#             when stdin is not a terminal); never in argv, a file or the output. A wrong passphrase stops
#             the run before anything is uploaded. Without it, minisign prompts on the terminal.
#   CUTEX_NATIVE_GH_TOKEN (cutex --native-run only): the token for `gh run download` of the cute-codex run
#           when the token in GH_TOKEN cannot read the other repo's artifacts (CI: GITHUB_TOKEN is scoped to
#           its own repo). Used for that one download only.
#
#   sign-and-upload.sh release --desktop-run ID --desktop-tag v0.1.2 --cutex-run ID --cutex-tag v0.1.1 --key KEY
#                              --sequence N|next [the cutex options above] [--dir BASE] [--upload] [--owner ORG] [--pubkey FILE]
#     Both projects in one run, with ONE passphrase prompt: prepares cutex-desktop and cutex (work dirs
#     BASE/signed-<project>-<tag>, BASE default .: the same dirs as the per-project runs), signs every file
#     that still lacks a signature of both in a single `minisign -S` (minisign reads the passphrase from the
#     terminal itself; this script never sees it; with --password-env: from stdin), then runs cutex-desktop (uploaded, verified, published)
#     and only after it succeeded cutex (channel-release last). A dry run first and the same command with
#     --upload afterwards: one prompt in total (the --upload run reuses the dry run's signatures).
#
# Signature reuse (every mode): each signature is kept in <dir>/signatures/<sha256>-<name>.minisig. A rerun
# with the same --dir (a dry run, then --upload) reuses the kept signature of a file whose bytes are
# identical (same sha256) once `minisign -V` verifies it against --pubkey; only the other files are signed
# again (if none: no passphrase prompt). manifest.json's publishedAt is the time of the first run in that dir
# (<dir>/published-at; delete it for a new one), so the rebuilt manifest and channel.json stay identical.
# Internal (used by `release`): --prepare-only = stop before signing and write <dir>/unsigned
# ("<signature cache file>\t<file>" per file still to sign); --signed-only = fail instead of signing.
#
# Publish order (each step only once the one before is complete):
#   1. cutex-desktop: the vX release with ALL its assets. Never leave an asset-less release in
#      cutex-desktop: GitHub's /releases/latest then points at it, hides the older ones and the desktop
#      updater offers nothing. The Release workflow creates the vX release as a DRAFT on the tag push;
#      this script uploads, verifies (downloads again) and only then publishes it and marks it latest.
#   2. cutex: the --tag release, cutex-<label>, native-<version> and every component-<name>-<version>,
#      each created / kept as a draft until its assets are uploaded and verified, then published.
#   3. channel-release (channel.json with the sequence bump) last: this script uploads it last; the
#      updater of every installed cutex follows it as soon as it changes.
#
# Steps: `gh run download` the run's artifacts; check every file against the run's SHA256SUMS; (cutex)
# read the published channel.json (its sequence is the floor; `--sequence next` = that + 1); write
# manifest.json + channel.json for backend updates (upgrade-manifest.py; --native-run adds the
# cute-codex natives of that run; the run's component builds become `components`); check every
# component version that is already published: the published archive must be byte-identical to the
# rebuilt one, else stop; write SHA256SUMS of everything published; `minisign -S` every file once (one
# passphrase prompt); verify every signature against docs/install/cutex-release.pub; then upload (or
# print the commands). The capability check: every capability the previous release advertised and
# this build lacks must be in --meta capabilities.removed (else cutex's post-update verification rolls
# back); the previous list comes from that release's capabilities.json (cutex-<label>, written by this
# script since components) or --previous-capabilities (a JSON list or the index.json of
# `cutex management schema export --out DIR` run with the previous binary; needed once for 0.1.0).
# Release metadata committed next to this script (projects/cutex/release-meta/, docs/release/): without
# --meta, `<release>.json` there is the --meta of the release being signed (e.g. 0.1.1.json: mode full);
# without --previous-capabilities and with no capabilities.json on cutex-<previous>, the list
# `capabilities-<previous>.json` there is used (0.1.0). Both are printed when used.
# CUTEX_RELEASE_META_DIR overrides that directory (empty = none; the tests use this).
# Only the reads (`gh run download`, `gh release view|download`) run without
# --upload.
#
# Where things go (cutex's in-app backend updates read https://github.com/<owner>/cutex/releases/download/<tag>/<file>):
#   cutex       --tag (human release, e.g. v0.1.0): archives, manifest.json, SHA256SUMS (+ .minisig each)
#               cutex-<label> (machine release): manifest.json(+.minisig), the cutex archives and
#                 capabilities.json(+.minisig) ({platform: [capability]}, read by the next release's run)
#               native-<version> (only with --native-run): the native archives
#               component-<name>-<version> (one per component the run built): its archives (+ .minisig);
#                 published once: an archive already there is never replaced (only checked)
#               channel-release: channel.json(+.minisig), replaced on every release — uploaded last
#   cute-codex  --tag: native archives, SHA256SUMS (+ .minisig each)
#   desktop     --tag: packages, SHA256SUMS (+ .minisig each)
#
# Needs: gh (logged in as an account that can write releases, or GH_TOKEN), minisign, python3, sha256sum.
set -euo pipefail

here="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
pubkey_file="$here/../../docs/install/cutex-release.pub"
project="${1:?project: cutex | cute-codex | cutex-desktop | release}"
shift
run="" tag="" key="" dir="" upload=0 owner=senxiu-official sequence="" native_run="" meta="" release="" prev_caps=""
desktop_run="" desktop_tag="" cutex_run="" cutex_tag="" prepare_only=0 signed_only=0 pubkey_arg="" password_env=""
# The public repos ship this script as .github/ci/sign-and-upload.sh with the public key and the release
# metadata next to it; the dev repo keeps them in docs/install and projects/cutex/release-meta.
[ ! -f "$here/cutex-release.pub" ] || pubkey_file="$here/cutex-release.pub"
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    --tag) tag="$2"; shift 2 ;;
    --key) key="$2"; shift 2 ;;
    --dir) dir="$2"; shift 2 ;;
    --upload) upload=1; shift ;;
    --owner) owner="$2"; shift 2 ;;
    --sequence) sequence="$2"; shift 2 ;;
    --native-run) native_run="$2"; shift 2 ;;
    --meta) meta="$2"; shift 2 ;;
    --release) release="$2"; shift 2 ;;
    --pubkey) pubkey_file="$2"; pubkey_arg="$2"; shift 2 ;;
    --previous-capabilities) prev_caps="$2"; shift 2 ;;
    --desktop-run) desktop_run="$2"; shift 2 ;;
    --desktop-tag) desktop_tag="$2"; shift 2 ;;
    --cutex-run) cutex_run="$2"; shift 2 ;;
    --cutex-tag) cutex_tag="$2"; shift 2 ;;
    --prepare-only) prepare_only=1; shift ;;
    --signed-only) signed_only=1; shift ;;
    --password-env) password_env="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Non-interactive passphrase (see the header). Read once, then removed from the environment.
password="" have_password=0
if [ -n "$password_env" ]; then
  case "$password_env" in [A-Za-z_]*) ;; *) echo "--password-env needs a variable name" >&2; exit 2 ;; esac
  case "$password_env" in *[!A-Za-z0-9_]*) echo "--password-env needs a variable name" >&2; exit 2 ;; esac
  [ -n "${!password_env:-}" ] || { echo "--password-env $password_env: that variable is unset or empty" >&2; exit 2; }
  password="${!password_env}"
  have_password=1
  unset "$password_env"
fi
native_gh_token="${CUTEX_NATIVE_GH_TOKEN:-}"
unset CUTEX_NATIVE_GH_TOKEN
# minisign_sign FILE...: one `minisign -S` over the files (one passphrase). With --password-env the
# passphrase goes in on stdin from a builtin printf in a subshell (no exec: not in any argv); SIGPIPE is
# ignored there so a key without a password (minisign then never reads stdin) cannot fail the pipeline.
minisign_sign() {
  if [ "$have_password" = 1 ]; then
    ( trap '' PIPE; printf '%s\n' "$password" 2> /dev/null || true ) | minisign -S -s "$key" -m "$@"
  else
    minisign -S -s "$key" -m "$@"
  fi
}

# Both projects, one signing pass (see the header).
if [ "$project" = release ]; then
  [ -n "$desktop_run" ] && [ -n "$desktop_tag" ] && [ -n "$cutex_run" ] && [ -n "$cutex_tag" ] && [ -n "$key" ] \
    || { echo "release needs --desktop-run, --desktop-tag, --cutex-run, --cutex-tag and --key" >&2; exit 2; }
  [ -z "$run$tag" ] || { echo "release takes --desktop-run/--desktop-tag and --cutex-run/--cutex-tag, not --run/--tag" >&2; exit 2; }
  [ -n "$sequence" ] || { echo "release needs --sequence for cutex (higher than every earlier release's)" >&2; exit 2; }
  [ -f "$key" ] || { echo "no secret key file $key" >&2; exit 2; }
  [ -f "$pubkey_file" ] || { echo "missing $pubkey_file" >&2; exit 2; }
  base="${dir:-.}"
  ddir="$base/signed-cutex-desktop-$desktop_tag" cdir="$base/signed-cutex-$cutex_tag"
  common=(--key "$key" --owner "$owner")
  [ -z "$pubkey_arg" ] || common+=(--pubkey "$pubkey_arg")
  cargs=(--sequence "$sequence")
  [ -z "$native_run" ] || cargs+=(--native-run "$native_run")
  [ -z "$meta" ] || cargs+=(--meta "$meta")
  [ -z "$release" ] || cargs+=(--release "$release")
  [ -z "$prev_caps" ] || cargs+=(--previous-capabilities "$prev_caps")
  up=()
  [ "$upload" != 1 ] || up=(--upload)
  self="$here/sign-and-upload.sh"
  echo "=== prepare cutex-desktop $desktop_tag"
  bash "$self" cutex-desktop --run "$desktop_run" --tag "$desktop_tag" --dir "$ddir" "${common[@]}" --prepare-only
  echo "=== prepare cutex $cutex_tag"
  CUTEX_NATIVE_GH_TOKEN="$native_gh_token" bash "$self" cutex --run "$cutex_run" --tag "$cutex_tag" --dir "$cdir" "${common[@]}" "${cargs[@]}" --prepare-only
  caches=() files=()
  while IFS=$'\t' read -r c f; do caches+=("$c"); files+=("$f"); done < <(cat "$ddir/unsigned" "$cdir/unsigned")
  if [ ${#files[@]} -gt 0 ]; then
    echo "=== signing ${#files[@]} files of both projects with $key (one passphrase prompt)"
    minisign_sign "${files[@]}"
    pub="$(sed -n 2p "$pubkey_file")"
    for i in "${!files[@]}"; do
      minisign -V -q -P "$pub" -m "${files[$i]}" || { echo "${files[$i]}: the new signature does not verify with $pubkey_file" >&2; exit 1; }
      cp "${files[$i]}.minisig" "${caches[$i]}"
    done
  else
    echo "=== every file already has a verified signature: no passphrase needed"
  fi
  echo "=== cutex-desktop $desktop_tag (published and verified before anything of cutex is uploaded)"
  bash "$self" cutex-desktop --run "$desktop_run" --tag "$desktop_tag" --dir "$ddir" "${common[@]}" --signed-only ${up[@]+"${up[@]}"}
  echo "=== cutex $cutex_tag (channel-release last)"
  CUTEX_NATIVE_GH_TOKEN="$native_gh_token" bash "$self" cutex --run "$cutex_run" --tag "$cutex_tag" --dir "$cdir" "${common[@]}" "${cargs[@]}" --signed-only ${up[@]+"${up[@]}"}
  echo "release done: cutex-desktop $desktop_tag, then cutex $cutex_tag"
  exit 0
fi
case "$project" in cutex | cute-codex | cutex-desktop) ;; *) echo "unknown project $project" >&2; exit 2 ;; esac
[ -n "$run" ] && [ -n "$tag" ] && [ -n "$key" ] || { echo "--run, --tag and --key are required" >&2; exit 2; }
[ -f "$key" ] || { echo "no secret key file $key" >&2; exit 2; }
[ "$project" != cutex ] || [ -n "$sequence" ] || { echo "cutex needs --sequence (higher than every earlier release's)" >&2; exit 2; }
[ -f "$pubkey_file" ] || { echo "missing $pubkey_file" >&2; exit 2; }
repo="$owner/$project"
dir="${dir:-./signed-$project-$tag}"
# A rerun with the same --dir (e.g. after a mistyped passphrase) reuses the downloaded artifacts once they
# check against the run's SHA256SUMS again; everything after the download is redone from scratch.
if [ -e "$dir" ]; then
  [ -f "$dir/artifacts/SHA256SUMS/SHA256SUMS" ] || { echo "$dir exists without a finished download; delete it or pick another --dir" >&2; exit 2; }
  echo "reusing the downloads in $dir"
  rm -rf "${dir:?}/release" "${dir:?}/channel" "${dir:?}/native" "${dir:?}/components" "${dir:?}/published" "${dir:?}/previous" "${dir:?}/capabilities" "${dir:?}/unsigned"
fi
mkdir -p "$dir"
dir="$(cd "$dir" && pwd -P)"

# 1. Download and check against the run's combined sums.
fetch() { # repo run dest [token: GH_TOKEN for this download only]
  if [ -f "$3/SHA256SUMS/SHA256SUMS" ]; then
    echo "run $2 of $1: already downloaded in $3 (checking it again)"
  elif [ -n "${4:-}" ]; then
    GH_TOKEN="$4" gh run download "$2" -R "$1" -D "$3"
  else
    gh run download "$2" -R "$1" -D "$3" || {
      [ "$1" = "$repo" ] || echo "could not download run $2 of $1: a token in GH_TOKEN scoped to $repo (GITHUB_TOKEN) may not read another repo's artifacts; set CUTEX_NATIVE_GH_TOKEN to one with Actions read on $1" >&2
      exit 1
    }
  fi
  [ -f "$3/SHA256SUMS/SHA256SUMS" ] || { echo "run $2 of $1 has no SHA256SUMS artifact (did the sums job run?)" >&2; exit 1; }
  local n=0 name hash path
  while read -r hash name; do
    name="${name#\*}"
    path="$(find "$3" -type f -name "$name" ! -path "*/SHA256SUMS/*" | head -n 1)"
    [ -n "$path" ] || { echo "$name is in SHA256SUMS but not in the artifacts (an interrupted download? delete $3 and rerun)" >&2; exit 1; }
    [ "$(sha256sum "$path" | cut -d' ' -f1)" = "$hash" ] || { echo "$name does not match SHA256SUMS" >&2; exit 1; }
    n=$((n + 1))
  done < "$3/SHA256SUMS/SHA256SUMS"
  echo "run $2 of $1: $n files match SHA256SUMS"
}
fetch "$repo" "$run" "$dir/artifacts"
out="$dir/release"
mkdir -p "$out"
case "$project" in
  cutex) ;; # the archives the manifest names, below
  cute-codex) find "$dir/artifacts" -type f -name 'native-*.tar.gz' -exec cp {} "$out/" \; ;;
  cutex-desktop) find "$dir/artifacts" -type f \( -name 'cutex-desktop-*.tar.gz' -o -name 'cutex-desktop-*.zip' \) -exec cp {} "$out/" \; ;;
esac

# Read-only release queries (they run without --upload too).
# release_assets TAG: the asset names, one per line; exit 3 when the release does not exist.
release_assets() {
  local err out_assets
  if out_assets="$(gh release view "$1" -R "$repo" --json assets -q '.assets[].name' 2> "$dir/gh-view.err")"; then
    printf '%s\n' "$out_assets" | sed '/^$/d'
    return 0
  fi
  err="$(cat "$dir/gh-view.err")"
  case "$err" in *"release not found"* | *"Not Found"*) return 3 ;; esac
  echo "gh release view $1 failed: $err" >&2
  exit 1
}

# 2. cutex: the backend-update documents.
label="" native_version=""
if [ "$project" = cutex ]; then
  # The published channel pointer: the new sequence must be higher than its sequence.
  previous=""
  rc=0; release_assets channel-release > "$dir/channel-assets" || rc=$?
  if [ "$rc" = 0 ] && grep -qx channel.json "$dir/channel-assets"; then
    mkdir -p "$dir/previous"
    gh release download channel-release -R "$repo" -p channel.json -p channel.json.minisig -D "$dir/previous" --clobber
    minisign -V -q -P "$(sed -n 2p "$pubkey_file")" -m "$dir/previous/channel.json" \
      || { echo "the published channel.json does not verify with $pubkey_file" >&2; exit 1; }
    previous="$dir/previous/channel.json"
    echo "published channel: sequence $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sequence"])' "$previous")"
  elif [ "$sequence" = next ]; then
    echo "--sequence next: no published channel.json in $repo; give a number" >&2
    exit 2
  fi
  # The committed release metadata (see the header).
  default_meta_dir="$here/projects/cutex/release-meta"
  [ ! -d "$here/release-meta" ] || default_meta_dir="$here/release-meta" # the public repo's .github/ci/release-meta
  meta_dir="${CUTEX_RELEASE_META_DIR-$default_meta_dir}"
  this_label="$release"
  if [ -z "$this_label" ]; then
    this_label="$(python3 -c '
import json, sys
from pathlib import Path
labels = {json.loads(p.read_text(encoding="utf-8")).get("release") for p in Path(sys.argv[1]).rglob("BUILD-INFO-*.json")
          if not p.name.startswith("BUILD-INFO-component-")}
print(labels.pop() if len(labels) == 1 else "")' "$dir/artifacts")"
  fi
  if [ -n "$meta_dir" ] && [ -n "$this_label" ] && [ -f "$meta_dir/$this_label.json" ]; then
    if [ -z "$meta" ]; then
      meta="$meta_dir/$this_label.json"
      echo "release metadata for $this_label: $meta (mode $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("mode", "-"))' "$meta"))"
    elif ! cmp -s "$meta" "$meta_dir/$this_label.json"; then
      echo "note: --meta $meta differs from the committed $meta_dir/$this_label.json"
    fi
  fi
  margs=(manifest --cutex-dir "$dir/artifacts" --sequence "$sequence" --out "$out")
  [ -z "$previous" ] || margs+=(--previous "$previous")
  # The previous release's capabilities (see the header).
  if [ -z "$prev_caps" ] && [ -n "$previous" ]; then
    prev_label="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["release"])' "$previous")"
    rc=0; release_assets "cutex-$prev_label" > "$dir/previous/cutex-assets" || rc=$?
    if [ "$rc" = 0 ] && grep -qx capabilities.json "$dir/previous/cutex-assets"; then
      gh release download "cutex-$prev_label" -R "$repo" -p capabilities.json -p capabilities.json.minisig -D "$dir/previous" --clobber
      minisign -V -q -P "$(sed -n 2p "$pubkey_file")" -m "$dir/previous/capabilities.json" \
        || { echo "the published cutex-$prev_label/capabilities.json does not verify with $pubkey_file" >&2; exit 1; }
      prev_caps="$dir/previous/capabilities.json"
    elif [ -n "$meta_dir" ] && [ -f "$meta_dir/capabilities-$prev_label.json" ]; then
      prev_caps="$meta_dir/capabilities-$prev_label.json"
      echo "cutex-$prev_label has no capabilities.json: using the committed $prev_caps"
    else
      echo "cutex-$prev_label has no capabilities.json: pass --previous-capabilities (the index.json of" >&2
      echo "  \`cutex management schema export --out DIR\` run with the $prev_label binary)" >&2
      exit 2
    fi
  fi
  [ -z "$prev_caps" ] || margs+=(--previous-capabilities "$prev_caps")
  if [ -n "$(find "$dir/artifacts" -type f -name 'BUILD-INFO-component-*.json' | head -n 1)" ]; then
    margs+=(--component-dir "$dir/artifacts")
  fi
  if [ -n "$native_run" ]; then
    fetch "$owner/cute-codex" "$native_run" "$dir/native-artifacts" "$native_gh_token"
    margs+=(--native-dir "$dir/native-artifacts")
    mkdir -p "$dir/native"
    find "$dir/native-artifacts" -type f -name 'native-*.tar.gz' -exec cp {} "$dir/native/" \;
  fi
  [ -z "$meta" ] || margs+=(--meta "$meta")
  [ -z "$release" ] || margs+=(--release "$release")
  # The same publishedAt on every run in this dir: a rerun rebuilds a byte-identical manifest (signature reuse).
  [ -s "$dir/published-at" ] || date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/published-at"
  margs+=(--published-at "$(cat "$dir/published-at")")
  echo "publishedAt $(cat "$dir/published-at") (the first run in $dir; delete $dir/published-at for a new one)"
  python3 "$here/upgrade-manifest.py" "${margs[@]}"
  mkdir -p "$dir/channel"
  python3 "$here/upgrade-manifest.py" channel --manifest "$out/manifest.json" --out "$dir/channel"
  label="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["cutex"]["release"])' "$out/manifest.json")"
  native_version="$(python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(m.get("native", {}).get("version", ""))' "$out/manifest.json")"
  mkdir -p "$dir/capabilities"
  python3 - "$dir/artifacts" "$dir/capabilities/capabilities.json" <<'PY'
import json, sys
from pathlib import Path
out = {}
for p in sorted(Path(sys.argv[1]).rglob("BUILD-INFO-*.json")):
    if p.name.startswith("BUILD-INFO-component-"):
        continue
    info = json.loads(p.read_text(encoding="utf-8"))
    out[info["platform"]] = sorted(info["capabilities"])
Path(sys.argv[2]).write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
PY
  # Exactly the archives the manifest names (never a glob: component archives share the download).
  python3 -c 'import json,sys; [print(a["name"]) for a in json.load(open(sys.argv[1]))["cutex"]["artifacts"].values()]' "$out/manifest.json" \
    | while read -r name; do
        path="$(find "$dir/artifacts" -type f -name "$name" | head -n 1)"
        [ -n "$path" ] || { echo "$name is in the manifest but not in the artifacts" >&2; exit 1; }
        cp "$path" "$out/"
      done
  # Components: "<tag> <archive name> <sha256>" per platform.
  python3 -c '
import json, sys
for c in json.load(open(sys.argv[1])).get("components", {}).values():
    for a in c["artifacts"].values():
        print(a["tag"], a["name"], a["sha256"])' "$out/manifest.json" > "$dir/component-assets"
  # Check each component version against what is already published; collect what is still to upload.
  : > "$dir/component-uploads"
  if [ -s "$dir/component-assets" ]; then
    mkdir -p "$dir/components" "$dir/published"
    while read -r ctag cname csha; do
      path="$(find "$dir/artifacts" -type f -name "$cname" | head -n 1)"
      [ -n "$path" ] || { echo "$cname is in the manifest but not in the artifacts" >&2; exit 1; }
      cp "$path" "$dir/components/"
      rc=0; release_assets "$ctag" > "$dir/published/$ctag.assets" || rc=$?
      if [ "$rc" = 0 ] && grep -qxF "$cname" "$dir/published/$ctag.assets"; then
        mkdir -p "$dir/published/$ctag"
        gh release download "$ctag" -R "$repo" -p "$cname" -D "$dir/published/$ctag" --clobber
        got="$(sha256sum "$dir/published/$ctag/$cname" | cut -d' ' -f1)"
        if [ "$got" != "$csha" ]; then
          echo "$ctag/$cname is already published with sha256 $got, but this run built $csha:" >&2
          echo "  a component version is immutable; bump components/<name>/component.json's version or make the build reproduce it" >&2
          exit 1
        fi
        echo "$ctag/$cname: already published, identical (not uploaded again)"
        if grep -qxF "$cname.minisig" "$dir/published/$ctag.assets"; then
          gh release download "$ctag" -R "$repo" -p "$cname.minisig" -D "$dir/published/$ctag" --clobber
          minisign -V -q -P "$(sed -n 2p "$pubkey_file")" -m "$dir/published/$ctag/$cname" \
            || { echo "the published $ctag/$cname.minisig does not verify with $pubkey_file" >&2; exit 1; }
        else
          echo "$ctag $cname.minisig" >> "$dir/component-uploads"
        fi
      else
        echo "$ctag $cname" >> "$dir/component-uploads"
        echo "$ctag $cname.minisig" >> "$dir/component-uploads"
      fi
    done < "$dir/component-assets"
  fi
fi

# 3. SHA256SUMS of the published files; reuse the kept signatures of byte-identical files (see the header),
# then one signing pass for the rest (one passphrase prompt, none if nothing is left) and a verify pass.
(cd "$out" && find . -maxdepth 1 -type f ! -name SHA256SUMS ! -name '*.minisig' -printf '%f\n' | LC_ALL=C sort | xargs sha256sum > SHA256SUMS)
to_sign=("$out"/*)
[ "$project" != cutex ] || to_sign+=("$dir/channel/channel.json" "$dir/capabilities/capabilities.json")
[ -z "$native_version" ] || to_sign+=("$dir"/native/*)
[ ! -d "$dir/components" ] || to_sign+=("$dir"/components/*)
pub="$(sed -n 2p "$pubkey_file")"
mkdir -p "$dir/signatures"
sig_cache() { printf '%s/signatures/%s-%s.minisig' "$dir" "$(sha256sum < "$1" | cut -d' ' -f1)" "$(basename "$1")"; }
need=() reused=0
for f in "${to_sign[@]}"; do
  c="$(sig_cache "$f")"
  if [ -f "$c" ] && minisign -V -q -P "$pub" -m "$f" -x "$c" > /dev/null 2>&1; then
    cp "$c" "$f.minisig"
    reused=$((reused + 1))
  else
    need+=("$f")
  fi
done
echo "signatures: $reused of ${#to_sign[@]} reused (byte-identical, verified with $pubkey_file), ${#need[@]} to sign"
if [ "$prepare_only" = 1 ]; then
  : > "$dir/unsigned"
  for f in ${need[@]+"${need[@]}"}; do printf '%s\t%s\n' "$(sig_cache "$f")" "$f" >> "$dir/unsigned"; done
  echo "prepared: $dir/unsigned"
  exit 0
fi
if [ ${#need[@]} -gt 0 ]; then
  if [ "$signed_only" = 1 ]; then
    echo "${#need[@]} files have no kept signature (changed since the signing pass?): ${need[*]}" >&2
    exit 1
  fi
  echo "signing ${#need[@]} files with $key"
  minisign_sign "${need[@]}"
fi
for f in "${to_sign[@]}"; do
  minisign -V -q -P "$pub" -m "$f"
  cp "$f.minisig" "$(sig_cache "$f")"
done
echo "all signatures verify with $(sed -n 1p "$pubkey_file" | sed 's/.*key //')"

# 4. Upload (or print). Every release except channel-release is created as a draft (the Release workflow
# creates the --tag release as a draft too); a draft is published only after all its assets are uploaded
# and verified (downloaded again: byte-identical, signatures valid), so nobody sees a half-uploaded
# release. channel-release is updated last, after everything it points at is public.
do_gh() { if [ "$upload" = 1 ]; then (set -x; gh "$@"); else printf 'gh'; printf ' %q' "$@"; printf '\n'; fi; }
ensure_release() { # tag title notes [draft: 1 (default) | 0]
  if gh release view "$1" -R "$repo" > /dev/null 2>&1; then return; fi
  local commit draft=()
  [ "${4:-1}" = 0 ] || draft=(--draft)
  commit="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["cutex"]["commit"])' "$out/manifest.json")"
  do_gh release create "$1" -R "$repo" --target "$commit" ${draft[@]+"${draft[@]}"} --title "$2" --notes "$3" --latest=false
}
verify_release() { # tag file...: each file is on the release, byte-identical (a .minisig: verifies the local file)
  local t="$1" f n tmp
  shift
  tmp="$dir/verify/$t"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  for f in "$@"; do
    n="$(basename "$f")"
    gh release download "$t" -R "$repo" -p "$n" -D "$tmp" --clobber || { echo "$t: $n is not on the release after the upload" >&2; exit 1; }
    case "$n" in
      *.minisig) minisign -V -q -P "$pub" -m "${f%.minisig}" -x "$tmp/$n" || { echo "$t/$n does not verify ${f%.minisig}" >&2; exit 1; } ;;
      *) [ "$(sha256sum < "$tmp/$n")" = "$(sha256sum < "$f")" ] || { echo "$t/$n differs from the local signed file" >&2; exit 1; } ;;
    esac
  done
  echo "$t: $# assets verified"
}
finish_release() { # tag latest(true|false) file...: verify, then publish the draft
  local t="$1" latest="$2"
  shift 2
  if [ "$upload" != 1 ]; then
    echo "# verify the $# assets of $t, then if it is a draft:"
    do_gh release edit "$t" -R "$repo" --draft=false "--latest=$latest"
    return
  fi
  verify_release "$t" "$@"
  if [ "$(gh release view "$t" -R "$repo" --json isDraft -q .isDraft)" = true ]; then
    do_gh release edit "$t" -R "$repo" --draft=false "--latest=$latest"
  else
    echo "$t: already published (left as it is)"
  fi
}
if ! gh release view "$tag" -R "$repo" > /dev/null 2>&1; then
  msg="$repo has no release $tag: push the tag and let the Release workflow create it (as a draft)"
  if [ "$upload" = 1 ]; then echo "$msg" >&2; exit 1; fi
  echo "note: $msg"
fi
[ "$upload" = 1 ] || echo "--- not uploaded; the commands would be:"
do_gh release upload "$tag" -R "$repo" --clobber "$out"/*
finish_release "$tag" true "$out"/*
if [ "$project" = cutex ]; then
  cutex_files=("$out"/manifest.json "$out"/manifest.json.minisig "$out"/cutex-*.tar.gz "$out"/cutex-*.tar.gz.minisig
    "$dir/capabilities/capabilities.json" "$dir/capabilities/capabilities.json.minisig")
  ensure_release "cutex-$label" "cutex $label (backend update files)" "Signed files for cutex's in-app backend updates. To install by hand, use the $tag release."
  do_gh release upload "cutex-$label" -R "$repo" --clobber "${cutex_files[@]}"
  finish_release "cutex-$label" false "${cutex_files[@]}"
  if [ -n "$native_version" ]; then
    ensure_release "native-$native_version" "cute-codex native $native_version (backend update files)" "cute-codex native files for cutex's in-app backend updates."
    do_gh release upload "native-$native_version" -R "$repo" --clobber "$dir"/native/*
    finish_release "native-$native_version" false "$dir"/native/*
  fi
  # Components before the channel flips: never --clobber (a published version is immutable). Every
  # component tag the manifest names is verified and, if still a draft (e.g. an earlier run stopped
  # before publishing), published.
  for ctag in $(cut -d' ' -f1 "$dir/component-assets" | sort -u); do
    files=()
    while read -r t f; do [ "$t" != "$ctag" ] || files+=("$dir/components/$f"); done < "$dir/component-uploads"
    if [ ${#files[@]} -gt 0 ]; then
      ensure_release "$ctag" "cutex component ${ctag#component-} (backend update files)" "Signed archive of an optional cutex component, installed by cutex on hosts that ask for it."
      do_gh release upload "$ctag" -R "$repo" "${files[@]}"
    fi
    files=()
    while read -r t f _; do [ "$t" != "$ctag" ] || files+=("$dir/components/$f" "$dir/components/$f.minisig"); done < "$dir/component-assets"
    finish_release "$ctag" false "${files[@]}"
  done
  ensure_release channel-release "channel: release" "Pointer to the current cutex release for in-app backend updates." 0
  do_gh release upload channel-release -R "$repo" --clobber "$dir/channel/channel.json" "$dir/channel/channel.json.minisig"
  [ "$upload" != 1 ] || verify_release channel-release "$dir/channel/channel.json" "$dir/channel/channel.json.minisig"
fi
echo "done: $dir"
