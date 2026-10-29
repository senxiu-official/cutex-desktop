# File viewer refresh after agent edits

Default on, device-local switch in Settings → Shelf → Preview. The incremental work uses
the existing desktop `sessionEvent` stream, adding no watcher, daemon endpoint or network stream.
The existing workspace tree watcher is unchanged.

Only native `item/completed` with `item.type = fileChange` and `status = completed` invalidates a
viewer. `changes[].path` and update `kind.move_path` / `movePath` include both ends of a rename;
add/delete also invalidate the named path. This is the same item shape consumed by Timeline,
PlainToolRow and the turn summary. Patch deltas, started/failed/declined items and historical
timeline reads do not trigger reads. A bounded 128-item identity set suppresses duplicate completion
replays for each mounted viewer; older replayed identities may cause a harmless extra read.

The event host must equal the viewer's bound host. Absolute paths work across agents on that host.
Relative event paths resolve against the *event agent's cwd*, while relative viewer paths resolve
against that viewer's workspace scope root (which may be a project root above the cwd). Unknown
cwd means relative events cannot match. Lexical normalization handles separators, dot segments,
Windows verbatim paths and Windows drive/UNC case folding; POSIX paths retain case. No realpath
or symlink resolution is attempted: alias paths can miss a refresh.

Each mounted viewer has one pending bit and one bounded 400 ms coalescing timer. Hidden viewers
retain that bit and read after becoming visible; unmounted tabs naturally read fresh when mounted.
In-flight old reads are fenced by the existing effect cleanup. File previews include text, images,
office documents and opaque HTML; working-tree Git diff reads refresh, while turn/text diff tabs
remain historical snapshots. Git diff no longer uses broad workspace revision/git-object changes
to reread the same path: this keeps the switch and hidden-tab limit meaningful. Staging selection
changes still load the chosen diff.

File/source and diff previews are read-only, with no local source editor buffer to overwrite.
Opaque HTML may contain unsaved form state; it always shows a changed-on-disk/reload bar and keeps
the frame until the owner clicks reload. The controller also supports a dirty flag for a future
editor. No new frame bridge channels or document inspection are introduced.

Shell/MCP commands do not provide reliable changed paths. This feature does not infer writes from
command text or reread every open file on every command. Existing workspace-tree behavior stays
separate. External/editor-only writes and symlink aliases remain outside this event-only feature.

Cost: zero added incoming events/sec and zero idle reads. There is one lightweight event listener
per mounted viewer; unrelated events stop at host/method/type checks. Matching work is proportional
to mounted viewers × reported paths, with a sidebar cwd lookup only for completed patches. Each
visible read-only viewer issues at most one refresh per 400 ms window (2.5 reads/sec under continuous
matching patches), plus its initial read. Separate tabs showing the same file can each issue a read;
reads are not shared across tabs. Hidden/HTML-dirty viewers issue zero automatic refresh reads.
Timers do not cap latency or bytes of an individual daemon read. The regression fixture sends
100 matching completions in one burst and observes exactly one extra file read; this is a synthetic
burst count, not a measured production event rate or throughput claim.

Validation (2026-10-25): full desktop Vitest 764 files / 9548 passed, 76 skipped; root typecheck, Hant generation/check and mock build passed. Real mock-browser reads: development StrictMode initial text reads 2, after 100 matching completions 3, after unrelated host/path events still 3, after disabling still 3. Git diff refresh and HTML form preservation/explicit reload passed. Hidden-tab deferral, source-cwd resolution, rename, failure filtering and dirty/timer disposal are covered by component/pure regressions. The final change after the full suite only prevents the reload button wrapping; file/HTML focused tests and typecheck/build were rerun.
