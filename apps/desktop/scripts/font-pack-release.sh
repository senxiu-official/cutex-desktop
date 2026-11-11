#!/usr/bin/env bash
# Publishes the 中文字体包 (apps/desktop/src/shared/fontCatalog.ts FONT_PACK_ARCHIVE) as the only asset of its own
# GitHub release on the public desktop repo. The app pins the archive's URL, size and SHA-256 and checks every font
# file against the catalog, so no signature is involved; this script only makes sure the published bytes are the
# pinned ones.
#
#   bash apps/desktop/scripts/font-pack-release.sh --archive FILE [--owner OWNER] [--repo NAME] [--upload]
#
#   --archive FILE   cutex-fonts-zh-1.tar from scripts/font-pack-archive.mjs (reproducible: rebuild and compare)
#   --owner/--repo   default senxiu-official / cutex-desktop (must match the pinned URL)
#   --upload         publish; without it (dry run) everything is checked and the gh commands are printed
#
# Checks: the file's size and SHA-256 are the pinned ones; its entries are exactly the catalog's pack fonts, their
# license folders and README.txt. Publishing: the release (tag from the pinned URL, e.g. fonts-zh-1) is created as a
# non-draft release that is never "latest" (the desktop's binary updater reads /releases/latest); an asset already on
# it is never overwritten (it must already be byte-identical). Afterwards the pinned URL is downloaded anonymously,
# as the app does, and compared.
#
# Needs: gh (GH_TOKEN or logged in, contents: write on the repo), curl, sha256sum, tar, node.
set -euo pipefail

here="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
catalog="$here/../src/shared/fontCatalog.ts"
archive="" owner="senxiu-official" repo_name="cutex-desktop" upload=0
while [ $# -gt 0 ]; do
  case "$1" in
    --archive) archive="$2"; shift 2 ;;
    --owner) owner="$2"; shift 2 ;;
    --repo) repo_name="$2"; shift 2 ;;
    --upload) upload=1; shift ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
done
[ -n "$archive" ] && [ -f "$archive" ] || { echo "--archive FILE is required" >&2; exit 2; }

pinned() { sed -n "/export const FONT_PACK_ARCHIVE = {/,/} as const;/p" "$catalog" | sed -n "s/^ *$1: \"\{0,1\}\([^\",]*\)\"\{0,1\},.*/\1/p" | tr -d '_'; }
name="$(pinned name)" url="$(pinned url)" sha="$(pinned sha256)" bytes="$(pinned bytes)"
[ -n "$name" ] && [ -n "$url" ] && [ -n "$sha" ] && [ -n "$bytes" ] || { echo "cannot read FONT_PACK_ARCHIVE from $catalog" >&2; exit 2; }
expected_url="https://github.com/$owner/$repo_name/releases/download/"
case "$url" in "$expected_url"*"/$name") ;; *) echo "pinned URL $url is not on $owner/$repo_name" >&2; exit 2 ;; esac
tag="${url#"$expected_url"}"; tag="${tag%"/$name"}"
[[ "$tag" =~ ^fonts-[a-z0-9-]+$ ]] || { echo "unexpected tag $tag" >&2; exit 2; }
repo="$owner/$repo_name"

actual_bytes="$(wc -c < "$archive" | tr -d ' ')"
actual_sha="$(sha256sum "$archive" | cut -d' ' -f1)"
[ "$actual_bytes" = "$bytes" ] || { echo "size $actual_bytes, pinned $bytes" >&2; exit 1; }
[ "$actual_sha" = "$sha" ] || { echo "SHA-256 $actual_sha, pinned $sha" >&2; exit 1; }
echo "archive matches the pin: $name $bytes bytes sha256 $sha"

# Entries: exactly the catalog's pack fonts, their license folders and README.txt (all under the archive's root).
expected="$(node -e '
  const src = require("fs").readFileSync(process.argv[1], "utf8");
  const json = src.slice(src.indexOf("= [") + 2, src.lastIndexOf("];") + 1);
  const root = process.argv[2];
  const out = [root + "/README.txt"];
  for (const e of JSON.parse(json).filter((e) => e.delivery === "pack")) {
    for (const f of e.faces) out.push(root + "/fonts/" + f.file);
    for (const l of ["COPYRIGHT-AND-NOTICES.txt", "OFL.txt", "SOURCE.txt"]) out.push(root + "/licenses/" + e.id + "/" + l);
  }
  console.log(out.sort().join("\n"));
' "$here/../src/shared/fontCatalog.generated.ts" "${name%.tar}")"
listed="$(tar -tf - < "$archive" | LC_ALL=C sort)"
[ "$listed" = "$(printf '%s\n' "$expected" | LC_ALL=C sort)" ] || { echo "archive entries differ from the catalog:" >&2; diff <(printf '%s\n' "$expected" | LC_ALL=C sort) <(printf '%s\n' "$listed") >&2 || true; exit 1; }
echo "entries match the catalog ($(printf '%s\n' "$listed" | wc -l | tr -d ' ') files)"

notes="中文字体包 for Cutex desktop (Settings → 外观 → 中文字体包 → 下载并安装): 狮尾四季春加糖, 狮尾 B2 加糖宋体, 狮尾四季春 and 朱雀仿宋, SIL Open Font License 1.1 (license texts inside the archive). The desktop pins this file's size and SHA-256 ($sha) and checks every font file before installing it."
run() { if [ "$upload" = 1 ]; then "$@"; else printf 'would run:'; printf ' %q' "$@"; printf '\n'; fi; }

if ! command -v gh >/dev/null 2>&1; then
  [ "$upload" = 0 ] || { echo "gh is required to publish" >&2; exit 2; }
  echo "gh not found: the release state is not checked in this dry run"
  run gh release create "$tag" "$archive" --repo "$repo" --title "中文字体包 ($tag)" --notes "$notes" --latest=false
elif gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  echo "release $tag exists"
  if gh release view "$tag" --repo "$repo" --json assets --jq '.assets[].name' | grep -qx "$name"; then
    work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
    gh release download "$tag" --repo "$repo" --pattern "$name" --dir "$work"
    [ "$(sha256sum "$work/$name" | cut -d' ' -f1)" = "$sha" ] || { echo "$name on $tag differs from the pinned bytes: not overwriting; investigate" >&2; exit 1; }
    echo "$name is already published with the pinned bytes"
  else
    run gh release upload "$tag" "$archive" --repo "$repo"
  fi
else
  run gh release create "$tag" "$archive" --repo "$repo" --title "中文字体包 ($tag)" --notes "$notes" --latest=false
fi

if [ "$upload" = 1 ]; then
  work2="$(mktemp -d)"
  curl -fsSL --retry 3 -o "$work2/$name" "$url"
  got="$(sha256sum "$work2/$name" | cut -d' ' -f1)"; rm -rf "$work2"
  [ "$got" = "$sha" ] || { echo "anonymous download of $url has sha256 $got, pinned $sha" >&2; exit 1; }
  [ "$(gh release view "$tag" --repo "$repo" --json isDraft,isPrerelease --jq '.isDraft')" = "false" ] || { echo "$tag is a draft" >&2; exit 1; }
  latest="$(gh release view --repo "$repo" --json tagName --jq .tagName 2>/dev/null || true)"
  [ "$latest" != "$tag" ] || { echo "$tag became the latest release: the binary updater would read it" >&2; exit 1; }
  echo "published and verified: $url"
fi
