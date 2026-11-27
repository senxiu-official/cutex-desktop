#!/usr/bin/env bash
# Prepare and verify a local, unsigned-output-directory build, then sign its index with the desktop key.
# This script uploads nothing. The signer must already have the desktop release key.
set -euo pipefail
if [ "$#" -ne 7 ]; then
  echo "usage: $0 OUT RELEASE_BASE_URL SEQUENCE VERSION SECRET_KEY PUBLIC_KEY PREVIOUS_DIR_OR_DASH" >&2
  exit 2
fi
out="$1" url="$2" sequence="$3" version="$4" key="$5" pub="$6" previous="$7"
here="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
verify_index() {
  local info
  info="$(minisign -V -p "$pub" -m "$1")"
  printf '%s\n' "$info" | grep -qE $'^Trusted comment: (.*\t)?file:portraits\\.json(\t|$)'
}
if [ "$previous" != "-" ]; then
  verify_index "$previous/portraits.json"
fi
(cd "$here/.." && node ../../node_modules/vitest/vitest.mjs run test/portraitCollections.test.ts)
node "$here/portrait-collections.mjs" "$out" "$url" "$sequence" "$version"
if [ "$previous" != "-" ]; then
  node --input-type=module - "$previous/portraits.json" "$out/portraits.json" <<'JS'
import { readFileSync } from "node:fs";
const [old, next] = process.argv.slice(2).map(p => JSON.parse(readFileSync(p)));
if (next.sequence <= old.sequence) throw Error("portrait index sequence must increase");
for (const entry of old.collections) {
  const row = next.collections.find(c => c.theme === entry.theme);
  if (!row || row.version < entry.version ||
      (row.version === entry.version && (row.archive.sha256 !== entry.archive.sha256 || row.archive.size !== entry.archive.size))) {
    throw Error("invalid replacement for " + entry.theme);
  }
}
JS
fi
minisign -S -s "$key" -m "$out/portraits.json"
verify_index "$out/portraits.json"
