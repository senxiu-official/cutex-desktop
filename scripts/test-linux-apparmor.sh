#!/usr/bin/env bash
# Tests scripts/lib/linux-apparmor.sh against stub sysctl / /etc/apparmor.d / policy dirs (no sudo).
#   bash scripts/test-linux-apparmor.sh
set -euo pipefail
. "$(dirname -- "${BASH_SOURCE[0]}")/lib/linux-apparmor.sh"

t="$(mktemp -d)"
trap 'rm -rf "$t"' EXIT
fails=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
reset() {
  rm -rf "$t/etc" "$t/policy" "$t/out" "$t/base"
  mkdir -p "$t/etc/abi" "$t/policy" "$t/base"
  export CUTEX_TEST_APPARMOR_SYSCTL="$t/sysctl" CUTEX_TEST_APPARMOR_ETC="$t/etc" CUTEX_TEST_APPARMOR_POLICY="$t/policy"
}
base="$t/base"
attach="$(realpath -m "$base")/releases/*/cutex"
run() { rc=0; msg="$(apparmor_userns_check "$base" "$t/out")" || rc=$?; }

reset; echo 0 > "$t/sysctl"; run
check "restriction off: nothing to do" '[ $rc = 0 ] && [ -z "$msg" ] && [ ! -e "$t/out" ]'

reset; rm -f "$t/sysctl"; run
check "no sysctl (older kernel): nothing to do" '[ $rc = 0 ] && [ ! -e "$t/out" ]'

reset; echo 1 > "$t/sysctl"; run
check "restricted, no profile: generated" '[ $rc = 1 ] && [ -f "$t/out" ]'
check "profile attaches the releases glob" 'grep -qF "profile cutex-desktop \"$attach\" flags=(unconfined) {" "$t/out"'
check "profile allows userns" 'grep -qx "  userns," "$t/out" && grep -qF "abi <abi/4.0>," "$t/out" && grep -qF "include if exists <local/cutex-desktop>" "$t/out"'
check "prints install command" 'grep -qF "sudo install -m 644 $t/out $t/etc/cutex-desktop" <<<"$msg"'
check "prints load command" 'grep -qF "sudo apparmor_parser -r $t/etc/cutex-desktop" <<<"$msg"'

reset; echo 1 > "$t/sysctl"; run; cp "$t/out" "$t/etc/cutex-desktop"; rm "$t/out"; run
check "present, not loaded: parser command only" '[ $rc = 1 ] && [ ! -e "$t/out" ] && grep -qF "sudo apparmor_parser -r $t/etc/cutex-desktop" <<<"$msg" && ! grep -q "sudo install" <<<"$msg"'
mkdir "$t/policy/cutex-desktop.4"; run
check "present and loaded: nothing to do" '[ $rc = 0 ] && [ ! -e "$t/out" ] && grep -q "allows user namespaces" <<<"$msg"'

reset; echo 1 > "$t/sysctl"
printf 'abi <abi/5.0>,\ninclude <tunables/global>\nprofile cutex-desktop %s flags=(unconfined) {\n  userns,\n}\n' "$attach" > "$t/etc/cutex-desktop"
mkdir "$t/policy/cutex-desktop.1"; run
check "hand-written unquoted profile (abi 5.0) is recognised" '[ $rc = 0 ] && [ ! -e "$t/out" ]'

reset; echo 1 > "$t/sysctl"
printf 'profile cutex-desktop /elsewhere%s flags=(unconfined) {\n  userns,\n}\n' "$attach" > "$t/etc/cutex-desktop"
mkdir "$t/policy/cutex-desktop.1"; run
check "a profile for another base does not count; new name" '[ $rc = 1 ] && grep -qE "^profile cutex-desktop-[0-9a-f]{8} " "$t/out" && grep -qF "$t/etc/cutex-desktop-" <<<"$msg"'

reset; echo 1 > "$t/sysctl"; base="$t/base,x"; mkdir -p "$base"; run
check "glob characters in base: no profile, note" '[ $rc = 1 ] && [ ! -e "$t/out" ] && grep -q "no profile was generated" <<<"$msg"'

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
