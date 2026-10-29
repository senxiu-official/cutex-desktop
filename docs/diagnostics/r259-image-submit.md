# r259 inline image submit persistence failure (2026-10-25)

## Cause

Desktop main receives a string `image.url`; `sanitizeExtraInput` drops object URLs.
The owner-visible object is introduced later by cutex, not emitted by the renderer.
Pinned source: cutex r259 `002f0cdbfd7ab273f9225ce2ce8b045727fa3d67`.

`EventRepository::append` validates the pending event, runs
`EventBlobStore::normalize` on both native messages and `cutex.params`, then
validates again. `event_blobs.rs` recursively converts a data URL longer than
`INLINE_BYTES = 32 * 1024` characters to a `cutexBlob` object. However,
`schema/cutex-methods-v2.json` `$defs.userInput` requires `image.url` to be a string.
`cutex/userInput/submitted` and queue receipts reuse that input definition.
Consequently, a valid incoming request becomes an invalid persisted event and
returns `event_persistence_unavailable`. Native event params are untyped JSON,
which is why tests covering image generation/ordinary native image fields did
not expose the typed cutex receipt failure.

## Desktop hotfix

All inline/pasted images and resolved blob/history resend images use the existing
session-authorized attachment upload, then submit `localImage` with the returned
host path. Local and remote owner connections use the same existing route as
restricted users. No new daemon capability or endpoint is required. Attachment
storage is content-addressed within the session, preserving stable paths on
identical retries. Source draft/resend objects are not mutated.

Existing local host paths remain unchanged. Remote picked-file reads still require
that the native picker returned the path. Uploads and reads remain bound to the
originating client/generation, including host switches. BMP bytes are converted
to PNG with the existing Electron native image decoder because the attachment
endpoint accepts PNG/JPEG/GIF/WebP. Existing 8-MiB limits remain. Upload failure
never falls back to the broken inline representation.

This fixes desktop sends on r259 without daemon replacement. A backend
normalization/schema fix is still needed for other clients that submit inline
images; it was reported to r253-coalesce. This branch does not change cutex.

## Why previous tests/smoke missed it

- `mediaBlobMain.test.ts` used a one-pixel PNG and a mocked `submitInput` that always
  succeeded. Its local resend assertion explicitly expected inline data without
  upload. Projection/history tests checked descriptors, not typed persistence.
- The 0.2.0 native smoke receipt in `.claude/previews/release-020-owner.html`
  describes its scope as packaged renderer/preload/main, empty isolated debug
  hosts, capability UI/version, and **no real sessions/accounts/workload replay**.
  The r252/r258/r259 screenshots therefore do not prove a large image submit.

## Regression evidence

`test/imageSubmitR259.test.ts` calls the real composer input helpers,
`DaemonService.submit`, actual SDK attachment/request serializers and an injected
HTTP transport. The transport applies the documented r259 inline-to-blob
transformation, then uses Ajv 2020-12 against an unmodified frozen r259 schema.
It is a wire/schema regression, not a real daemon or provider smoke.

The fixture's git blob is `cd0bb5783f06841434e573f51675143b2f1cb8ff`, identical
to the source file at the pinned backend commit. Ajv is development-only.

Before the fix, local and remote 272,235-byte PNG sends fail with the owner's
same `image.url` string/oneOf error. After the fix, eight cases pass: the original
normalization failure, local/remote paste, image-only queue, local blob resend,
BMP conversion, existing host paths, and no inline fallback after upload refusal.
Fifty focused existing/new cases and workspace typecheck pass. Node 24.21.0,
private TEMP/TMP, apps/desktop full Vitest `--maxWorkers=4`: **752 files / 9,452
passed; 7 files / 76 skipped**, 143.97 seconds. Logs are `.test-temp/r259-red.log`,
`r259-green-focused.log`, `r259-wire-final.log`, `r259-typecheck.log`, and
`r259-desktop-full.log`.

## Owner action / next release gate

Ship a desktop hotfix (for example 0.2.1); do not require cutex r259 reinstall.
The release lead selects the version and builds from the integration commit.
Owner fully quits the desktop from the tray, installs the hotfix using the normal
upgrade path, and reopens it. Keep existing userData and daemon runtimes.

Until then, save the image as a file and select it through Add image on the local
host: the existing localImage path avoids inline receipt normalization. A plain
text message also remains available. No live process or installation was touched.

Before releasing the next package, extend the isolated native acceptance set to
submit an image larger than 32 KiB of encoded data (roughly the reported screenshot
size), confirm both management persistence and native acceptance, then verify
queue/resend on local and remote connections. Capability cards/about dialogs alone
are insufficient evidence for image submission.
