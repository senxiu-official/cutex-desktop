# Non-durable text delta contract (v1)

Status: implementation contract, 2026-10-25. Backend branch
Capability: `live-text-deltas`, with runtime `features.liveTextDeltas`.

Director revision v2: **live-only is runtime-capability gated**. Only a strict
boolean `AppServerSchema.capabilities.features.fullTextItemTerminal: true` enables
it. Native wire declaration is `initialize.result.fullTextItemTerminal: true`
(a root boolean, confirmed with release-020); Management captures this on the
connection and projects it into the normalized per-event schema above.
Missing/false/invalid capability keeps the old durable delta, diagnostic journal
and takeover behavior. The host `live-text-deltas` feature advertises wire support,
not support in every installed runtime. Old Codex cancellation/error/EOF paths
lack authoritative item completion: that part is unfinished until the native
terminal fix is part of the supported runtime contract. Claude enables the flag only after its
terminal identity/mapping repair. Never synthesize authoritative full text from a
partial Management observer stream.

## Subscription and wire format

Opt in with `liveDeltas=true` on existing Management v2 SSE subscriptions.
Capability: `featureList` contains `live-text-deltas`, boolean
`features.liveTextDeltas` is true.
Authorization, session filtering, durable replay and durable cursor semantics are
unchanged. The server sends `event: live_delta` with one JSON object in `data:`.
There is **no SSE id**, durable sequence or cursor on these frames. Do not pass
these objects to the durable feed's `advance()` or persist them as journal events.
Old clients receive full durable item completion, but no incremental text after
live-only is enabled. Ship SDK/desktop support alongside this backend change.

```json
{
  "version": 1,
  "kind": "delta",
  "cutexSessionId": "cutex.session",
  "hostId": "host",
  "runtimeGeneration": 3,
  "threadId": "thread",
  "turnId": "turn",
  "itemId": "item",
  "method": "item/agentMessage/delta",
  "producerEpoch": "opaque-process-epoch",
  "revision": 2,
  "startOffset": 5,
  "endOffset": 11,
  "anchor": {"streamId": "durable-stream", "sequence": 100},
  "params": {"threadId":"thread", "turnId":"turn", "itemId":"item", "delta":" world"}
}
```

`kind` is `delta` or `gap`. `params` preserves native notification parameters,
including `summaryIndex` / `contentIndex` and unknown metadata; only the `delta`
string is concatenated. Gap frames have no usable delta and require authoritative
completion repair. String IDs are opaque. `turnId` may be null when absent in the
native protocol; never infer a different turn from an unrelated active turn.

Offsets are **UTF-8 byte offsets within the item/method/content segment**, not JS
UTF-16 indices. `revision` increases per key (an emitted revision may skip queued
intermediate revisions after merge). Frame identity includes host/session,
generation, thread/turn/item, method, native summary/content index and producer
epoch. A metadata change starts a separate frame; do not merge incompatible
params. Metadata changes force a frame boundary but keep offsets within the same
item/method/index identity. `anchor` is the last locally observed durable checkpoint
for this cutexSessionId (never an unreachable event from another session), nullable before
one exists. Buffer appended delta frames until that stream/sequence has been applied;
discard on stream reset. Buffering itself must have a byte limit and timeout.

## Client application rules

1. Create temporary text only for a verified current session/runtime/item.
   Apply live after the durable start anchor. Native start/completed handling is
   unchanged. If start is unavailable, discard live and wait for full completion.
2. First revision starts at offset zero. Subsequent append requires matching epoch
   and `startOffset == previous endOffset`; ignore already consumed ranges.
   Validate UTF-8 byte length, and reject overlaps/missing ranges. A contiguous
   coalesced frame can cover multiple revisions; do not require revision + 1.
3. A `gap`, epoch change or noncontiguous offset invalidates temporary text for
   that key. Suppress further appends until an explicit complete snapshot/full
   durable completion replaces it. Never append the last fragment as though it
   were the missing accumulated text.
   A gap has `gapScope: "item"` or `"subscription"`; the latter invalidates all
   temporary text on this subscription, including items from other sessions. It
   still carries the complete identity/anchor fields of the item that triggered
   overflow. Do not treat that identity as the limit of a subscription-wide gap.
   An item gap invalidates all methods/summaryIndex/contentIndex segments of the
   identified item; `params` may be null and carry no indices.
4. Durable `item/completed` replaces temporary content with full authoritative
   text, including all reasoning parts. Completion, turn terminal, runtime
   generation change and stream reset establish fences: discard late live frames
   from fenced items/generations/epochs. A completed item cannot be reopened by
   live traffic. Keep fences bounded by current turns/generations.
   An explicit empty reasoning `summary`/`content` array is authoritative and
   clears corresponding temporary content; absent fields are not empty arrays.
5. Live frames never alter durable `after`, `lastSequence`, reconnect cursor,
   event retention or durable lagged state. SSE reconnect does not replay live.
   Reconnect may miss incremental text; full completed repairs the result.

## Large completed text: authoritative repair

The existing durable event limit remains 256 KiB. An oversized native
`item/completed` for agentMessage/reasoning may contain a truncated inline preview.
Never replace temporary full text with that preview as though it were complete.
Before truncation the backend stores the full `params.item` JSON (after media
externalization) in the existing session-authorized blob store. Native message
top-level `_cutexFullText` contains:

```json
{"type":"cutexBlob","blobId":"<sha256>","sha256":"<same>","mime":"application/json","size":1234567,"url":"cutex-blob:<session>/<sha256>"}
```

Resolve through existing `GET /v2/sessions/{encodedSession}/blobs/{blobId}` with
normal session authorization. Decode the JSON as a complete item, verify item ID,
item type and session/runtime/turn fence, then apply it as the authoritative
completion. The blob is **an item, not a notification**. Fence the item immediately
on receiving completion, before asynchronous fetch; discard stale fetch results
after reset/generation change or a newer authoritative item update.

The native `_cutexTruncated` marker remains. If a truncated event has no usable
full-text ref (old event, unavailable blob, or over the 32 MiB blob limit), request
history/thread-read repair instead. Over-limit marker includes
`fullTextUnavailable:"blob_size_limit", repair:"thread/read", resyncRequired:true`.
An unresolved preview must not silently become final text; retain a repair-needed
state and use existing resync/retry. Full-text blobs preserve all reasoning parts,
including explicit empty arrays. Replay normalization preserves an existing
`_cutexFullText` ref and never replaces it with the truncated preview.

## Backend policy and boundaries

Allowlist: `item/agentMessage/delta`, `item/reasoning/textDelta`,
`item/reasoning/summaryTextDelta`. Other native events keep existing durability.
Always coalesce per key for 40 ms, including idle load; flush early at size limit
or before durable completion/control barriers. Exact UTF-8 order is preserved.
Control/final records use the durable stream and are never silently dropped.

Live payload budgets: 256 KiB/subscriber, 1 MiB/session, 64 MiB/process;
64 KiB/frame and 64 active keys/session. Include pending coalescer and queued
payloads; separately bound frame/key metadata. Slow subscribers merge contiguous
ranges or receive a gap and suppress that key until completion. Durable backpressure
may explicitly disconnect and replay from durable cursor; live congestion must
not set durable `lagged`. Socket writes retain existing timeout/disconnect rules.

Both Management and diagnostic journals exclude this allowlist. Single-writer
takeover retains lease/time bookkeeping but never buffers/replays these payloads.
Activity observers still receive live signals without per-delta durable writes.

Batch 1 is process-local with a passive native observer ingress; producer identity
is the live hub epoch, replaced for a session after local observer transport loss.
Observer disconnect (owned or unowned) emits a gap and suppresses affected open
items until authoritative completion. Cross-process IPC is batch 2. Existing shared-journal
catch-up/watch/recovery semantics stay intact. Missing observer coverage produces
missing incremental text, repaired by full completion. Do not advertise batch 1
as lossless cross-process live delivery. Before enabling live-only for a backend,
verify completed-full-text behavior including cancellation/failure/disconnect;
repair incomplete terminal paths rather than keeping durable text deltas.

## Desktop/SDK acceptance

- Parser accepts `live_delta` without id and keeps durable cursor unchanged.
- Append, UTF-8 offsets (including CJK/emoji), coalesced revisions and both reasoning
  indices work. Exact final text equals authoritative completion.
- Gap, terminal-before-live, epoch/generation/reset, duplicate and stale frames
  never corrupt or reopen completed output.
- Live buffering is bounded; malformed/unknown live frames do not stop durable feed.
- Tests cover opt-in URL, session filtering, legacy final-only delivery and reconnect.

## SDK/desktop integration decisions (2026-10-25)

Validation note: use `live-text-deltas` plus `features.liveTextDeltas`,
metadata boundaries retain offsets, null-anchor deltas are discarded, and item gaps
invalidate every reasoning segment even when params is null. Subscription gaps
invalidate all eligible in-progress items; the supplied item identity only identifies
the overflow trigger. Anchors must be reachable within the subscribed session,
including its child threads, rather than referring to another session's global event.

Host wire support and the runtime terminal guarantee are distinct. The client
continues applying durable deltas on capable hosts. Legacy empty reasoning completions
keep their prior fallback unless the same-generation schema promises complete
terminal items or the item actually received live traffic. Reconnect suppression
only marks items that have used live traffic.

Validation note: `_cutexFullText` is on native.message, and contains the
existing session-authorized JSON cutexBlob descriptor. SDK blob checks and desktop
identity/MIME/size/UTF-8 checks precede replacement. Completed previews establish a
fence immediately; the renderer accepts hydration only against the exact pending
stream/sequence/event token and current host epoch/runtime generation. Unusable
references request the existing history repair path. Reads are bounded to two
concurrent 32-MiB blobs and 32 queued preview descriptors per host.

The feed buffers live frames behind reachable durable checkpoints with bounded
bytes/count/time. It does not advance the durable cursor from live frames. The
renderer uses the existing frame batching for the selected thread and a matching
batch for child threads. Temporary state and reasoning segment count are bounded
to 64 keys. A verified native item start is required; bootstrap/history output is
not treated as a fresh live start.


## Review clarification: negative gap markers (2026-10-25)

Validation note: process `kind:gap` before checking anchor readiness.
A gap with a null anchor or the current stream's future anchor invalidates already
verified temporary text immediately; it never advances any durable position. Reject
foreign-stream gaps and keep host/session/runtime fences. Item gaps invalidate all
segments of the identified current item. Subscription gaps invalidate every existing
tracked item, regardless of the supplied anchor sequence or overflow-trigger identity.
A durable item start received after the gap can establish a fresh item. Null-anchor
positive deltas remain discarded, and future-anchor positive deltas remain buffered.

Backend review also specifies a two-second server-side future-anchor hold followed by
an explicit item gap, subscriber-capacity HTTP429 (`live_delta_capacity_exceeded`,
retryable/retryAfterMs1000) before SSE headers, and a bounded suppression-metadata
budget with subscription-gap/final-only fallback. Normal delta wire format is unchanged.
