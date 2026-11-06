# Desktop ledger and timeline caches

The daemon decides record state and placement. The desktop retains full ledger records for the
selected conversation and visible conversation panes. Host events for other sessions continue
through the existing waiting/notification/sidebar projections; they do not initialize a ledger,
fetch record bodies, or synthesize aggregate counts from an incomplete record projection.

An inactive cached ledger is marked dirty when its host/session events arrive. Opening it again
reads a full authoritative snapshot, including removal of records outside that snapshot. Opening
an evicted conversation likewise initializes from the daemon. Closing, hiding, selection changes
and host view removal prune the inactive cache to four sessions and 4,096 records in total.
Eviction removes whole recoverable session snapshots, never individual user messages.

Unconfirmed owner sends and in-flight reads/mutations retain their ledger until reconciliation.
Owner drafts/outbox persistence is separate and is never removed by cache eviction. New cache
incarnations receive distinct generations, so older replies cannot overwrite a newly opened
ledger. Visible trimmed host records hydrate by host, session, input ID, generation and record
revision; duplicate requests share an in-flight promise and hydrated revisions need no new read.

These bounds apply to idle snapshots, not to the number of currently visible panes or pending
owner operations. They are a record-count budget, not a measured heap-byte limit. No timer deletes
user data. Tests in `apps/desktop/test/inputLedgerCache.test.ts` exercise actual store event handlers
at 100 and 1,000 unopened sessions and verify cache lifecycle, hydration and waiting projection.

Timeline views select the visible turn window before reading its entries. The native entry Map
tracks per-turn revisions; each mounted view reuses unchanged turn pages and reads changed visible
turns only. Loaded-turn and owner client-ID indexes support ledger joins and owner-note placement
without flattening hidden history. History prepend and timeline cloning retain these indexes.
Explicit focus, copy and complete-history actions still use the full loaded transcript.

Windowing changes neither daemon surfaces nor the history rule: waiting records remain in nextUp
or pendingNotes until the daemon places them on the timeline. Revert, native identity joins,
owner-note placement, retry folding and older-history expansion retain their existing behavior.
Count-based tests use the audit's 327/3,270-turn, 7,974/79,740-entry fixture with 50 visible turns.
They measure derivation work, not frame rate or production heap usage.
