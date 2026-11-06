# 042 — Desktop profile account links

Availability follows the capabilities advertised by the host and runtime; deployment plans are not a public version contract.

## Identity and admission

Only owner/full connections participate. Older hosts keep their existing profile-name/provider fallback. The daemon exposes an optional `link` containing `accountKey`, `secretId`, `basis` and `source`; desktop matches both the salt ID and the account key. Different known accounts never join through an ambiguous legacy name. Deleted ledger profile IDs do not inherit a replacement profile's account.

Main generates 32 random bytes and stores them with Electron OS encryption in `userData/profile-link/secret-v1.json`. It refuses unavailable encryption and Linux's `basic_text` fallback. Only main calls the fixed GET/PUT `/v2/profile-link/secret` routes. Renderer IPC can inspect safe sync status, retry reconciliation or reset the key; it cannot provide, export or read the key. Errors contain fixed codes instead of remote response bodies. Connection epochs, access changes and key generations fence asynchronous work. Unsupported/restricted hosts receive no secret. A paired owner/full connection can initialise a host without a secret; replacing an existing secret requires host-local authority. The desktop explains that refusal and does not keep attempting a forbidden overwrite.

An explicit backend disable is durable intent: GET status `disabled: true` suppresses automatic setup on reconnect, restart and key reset, including crash remnants with an old secret still present. The desktop shows the host as disabled and leaves re-enabling to an explicit host-local action. An absent secret without a disable tombstone is the only automatic initialisation case.

## Profile and quota UI

Profile cards, composer profile choices and quick-chat choices show the other hosts using the account. The all-host usage view groups quota cards and profile chart/table series by account identity, retaining host splits, cost conversion and the freshest whole quota observation. Unknown identities retain the legacy fallback. Single-host quota cards can show other linked hosts without polling their quotas.

Manual linking selects connected profiles from the same provider family and uses an in-place second confirmation. Each selected host receives a PATCH with a fresh `m-…` group marker; no login information is copied. Every prior detail `accountLink` value is read before writes so undo restores automatic, disabled and previous manual states exactly. Partial success is explicit and remains undoable. Undo checks for a subsequent owner edit before applying its inverse. Cross-host mutations are never automatically retried.

Unlinking an automatic match writes `none`; its menu can resume automatic recognition. Clearing a manual link writes null and restores automatic recognition, which may still recognise the same account. The dialog explains this distinction.

## Appearance synchronisation

Only colour, avatar themes, greeting, avatar and intro portrait participate. Names, model configuration, credentials and provider category never synchronise. The overview and editor expose first-link appearance differences and let the owner choose a source or retain separate appearances. Existing differences are never silently overwritten.

Subsequent edits use per-field `appearanceRevisions` (`etag`, `updatedAt`), including deletion tombstones. Unknown timestamps or competing newer edits require a new source choice. An editor's “also apply to other hosts” choice defaults on. Pending appearance-only work is bounded and stored on this desktop; reconnect retries recheck account membership and expected field revisions. Successful changes offer undo, guarded against newer edits. Storage failures remain visible.

The desktop does not coordinate quota polling between daemons. Each host retains its existing quota reader and eligibility checks.

Profile PATCH uses backend last-write-wins semantics. The desktop checks field revisions immediately before writing and retains each mutation's own receipt for guarded undo; later display refreshes cannot become that receipt.

## Preview and validation

The browser-only mock is `?mh&profilelink`; it gives HOST-A and workstation shared accounts plus a deliberate Claude appearance difference. `?legacy`, narrowed device scopes and non-owner fixtures retain their existing admission behaviour. The preview never connects to a daemon or reads credentials.

Focused coverage includes secret persistence/privacy/reset races, registry permissions and stale replies, manual partial writes/exact undo, account-aware usage identities and appearance conflict/pending/revision behaviour. Full validation results are recorded in `PROGRESS.md`.
