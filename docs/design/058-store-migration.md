# Durable storage and incremental reads

cutex uses SQLite for mutable business state, append-only JSONL for suitable logs,
and JSON for small configuration. Storage changes are made per store; this is not
a claim that every store has already migrated. The store manifest, advertised
capabilities and signed release metadata describe the current implementation.

## Authority and migration

A store has one authoritative representation. A successful importer verifies the
source data and commits the new representation before it becomes authoritative.
A retained JSON import source may be stale after the database starts accepting
writes; readers must use the active store rather than whichever file is easiest
to find. Do not infer completion from an old file's existence.

Schema changes preserve record IDs, revisions, ordering and access boundaries.
Compare business records and their relationships before and after import, restart
and any supported recovery operation. Duplicate hot and cold authority is an error.

The public cutex 0.2.1 manifest declares the durable-state transition as one-way.
Keep an offline backup before upgrading. An older executable alone cannot restore
an earlier data format. Supported rollback and recovery follow the signed
migration metadata and require stopped writers.

## Read cost

Use keyed access, bounded pages and change cursors instead of cloning whole stores
for routine reads. Apply source, scope and time filters before aggregation. Keep
one in-flight refresh per scope, reconcile gaps from a bounded snapshot, and fence
stale responses by revision and connection epoch.

Delta protocols must distinguish deletion, loss of access and temporary absence.
A record missing from a capped list is not proof that it was deleted or closed.
Archived history remains available through the host's supported history APIs.

## Validation

Use populated isolated fixtures. Verify import, continued writes, restart, stable
IDs and cursors, permissions, and failure recovery. Measure CPU, allocations,
lock duration, bytes read and records decoded against a declared fixture. Report
which candidate and platform ran; local fixtures do not replace release CI or
old-public-version upgrade acceptance.
