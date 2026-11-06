# Owner-store page consumers (store consumers)

The daemon contract is `docs/management/owner-store-pages.md` on cutex's S10
branch. One capability, `owner-notify-approval-pages-v1`, covers approvals,
owner-notifications and safety-checks. Test it per host; older hosts retain their
existing calls.

`CutexClient` adds `approvalsPage(state, query)`,
`ownerNotificationsPage(query)` and `safetyChecksPage(query)`. Page queries always
include a bounded `limit` (default 100, maximum 500), including the first read.
They return their original record arrays plus optional `nextCursor`. Missing or
null continuation means EOF. A byte-bounded page can be short or empty; a single
oversized row may be returned alone. Cursors remain opaque and are sent back
without decoding, under the same host, filter and agent scope.

The existing `CutexClient.approvals(state)` still returns an array or null and
keeps its original request for compatibility. New desktop paths never use that
complete-list route on a host advertising the capability. Its pending-approval
array is collected from bounded matching pages; notifications retain their
existing logical row limit while following any byte-budget continuations needed
to reach it. A cursor resync discards the interrupted collection and retries once;
errors never fall back to an unbounded read.
Each in-flight approval list also merges authority events and successful owner
decisions received during its pages before publishing the result. This prevents
an earlier pending page from restoring a decision already seen live. These
temporary per-read records are released when the read settles; they are not a
history cache and never replay an owner action.

Approval history loads one page per host, with explicit continuation and refresh.
Host scope changes, connection replacement and pending-list updates invalidate
old requests. Each host has its own cursor, loading and error state. Empty decided
results do not hide continuation when the fetched approval page contained only
pending records.

Conversation notification history has its own bounded first page and an earlier
notifications button, independently of native turn pagination. Safety notices
already use these same owner-notification records; they share this pager rather
than making a duplicate safety-list request. Loaded pages merge by record ID,
preserving live/action updates and deletion tombstones. A rejected cursor restarts
the view, and repeated cursors produce a retryable error rather than a loop.

Waveline currently pins `deps/cutex-desktop` at `59e001a9a`. These client methods
and optional response fields are additive; existing calls need no changes and no
mandatory re-pin. To adopt pagination there, re-pin the submodule and use the new
methods behind the same per-host capability check. No Waveline files are changed
here. The current mobile work module does not call these three list routes.

Mock preview `?s10pages&perf=quiet` includes multi-page approval history and short
notification/safety pages. `?legacy` or `?nofeat=owner-notify-approval-pages-v1`
keeps the previous path. Requests, cursors and first-page resets can be inspected
without a daemon.
