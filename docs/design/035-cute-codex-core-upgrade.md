# Native runtime and upstream core

The public set uses cute-codex **0.164.0-r59**, based on upstream Codex **0.164.0**.
Native, backend and desktop version numbers are independent. The signed backend
manifest binds the native version, generated protocol schema and build commit.
Use those records instead of inferring a version from a development branch name.

cute-codex keeps the fork changes needed by cutex, including external inputs,
selected authentication files and compatibility fixes. Native protocol types
are generated from the app-server schema; they are not hand-written desktop types.
The desktop remains a client of the daemon rather than launching native tools
or accessing a local filesystem directly from renderer features.

## Build and release

The native repository has its own GitHub Actions build and signing pipeline for
Linux x64 and Windows x64. Compile from committed LF bytes: embedded database
migration checksums must agree across hosts. Compare archive checksums, the
embedded build record and the protocol schema after downloading signed assets.

A new native release does not overwrite an existing agent's runtime pin. Runtime
upgrades are explicit; retain the packages still referenced by agents. The signed
migration metadata determines which recovery paths are supported. Do not assume
that selecting an older executable reverses a data migration.

Performance observations belong to the tested candidate, configuration and
platform. In particular, compare the same model, effort and Fast setting before
attributing a speed difference to the fork or transport.
