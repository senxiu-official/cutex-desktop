import type { SessionCatalogPage, SessionChangePage, SessionResync } from "@cutex-desktop/cutex-client";
import type { HostClaudeRuntime, HostSessionRow, SessionLifecycle, SessionResource } from "@cutex-desktop/protocol";
import { shownSessions } from "../shared/hiddenSessions";

export interface SessionCatalogSource {
  page(lifecycle: SessionLifecycle, cursor?: string): Promise<SessionCatalogPage | SessionResync>;
  changes(cursor: string): Promise<SessionChangePage | SessionResync>;
  /** Returns null only after the authorized active/retired lookups both miss. */
  session(id: string, lifecycle: SessionLifecycle): Promise<SessionResource | null>;
  hostRow(id: string): Promise<HostSessionRow | null>;
  /** Every archived session in one list (`GET /v2/sessions?lifecycle=retired`), read only once they are wanted. */
  retired(): Promise<SessionResource[]>;
}
export interface SessionCatalogSnapshot {
  active: SessionResource[];
  retired: SessionResource[];
  hostRows: Record<string, HostSessionRow>;
  claudeRuntime?: HostClaudeRuntime;
  /** Rows whose read failed; they stay dirty and the next read tries them again. */
  missing?: number;
  /** Archived rows are not read yet (`retired` is empty): how many there are. */
  archivedPending?: number;
  /** A first read still in progress ({@link SessionDeltaCatalog.peek}): active rows read so far of all. */
  loading?: { loaded: number; total: number };
}
interface CatalogState {
  rows: Map<string, SessionResource>;
  hostRows: Map<string, HostSessionRow>;
  cursor: string | null;
  sequence?: number;
  claudeRuntime?: HostClaudeRuntime;
  membershipChanged?: boolean;
  /** Archived session IDs from the catalog pages; their rows are read only once wanted. */
  retiredIds: Set<string>;
  archivedLoaded?: boolean;
}
class ResyncRequired extends Error {}
const lifecycleOf = (state: CatalogState, id: string, fallback: SessionLifecycle = "active"): SessionLifecycle =>
  state.rows.get(id)?.lifecycle ?? (state.retiredIds.has(id) ? "retired" : fallback);

/** Per connection/access generation. Durable cursors survive SSE reconnects, never access changes.
 * Reads are single-flight; each keyed read has a dirty bit for hints arriving during hydration.
 * The snapshot/cursor commits together, so a failed resource read is retried from the same cursor.
 */
export class SessionDeltaCatalog {
  private state: CatalogState | undefined;
  private pending: Promise<SessionCatalogSnapshot> | undefined;
  private dirty = new Set<string>();
  private refreshAll = false;
  /** Active rows read before this time are read again (a status gap: what happened before it was not streamed). */
  private staleBefore = 0;
  private fetchedAt = new Map<string, number>();
  private failed = new Set<string>();
  private failedThisRead = new Set<string>();
  private archivedWanted = false;
  private archivedStale = false;
  /** The first read's rows while it runs, for {@link peek}. */
  private building: { state: CatalogState; loaded: number; total: number } | undefined;
  private disposed = false;
  private snapshot: SessionCatalogSnapshot | undefined;
  private revision = 0;
  private membershipRevision = 0;
  private writes = 0;
  /** `writes` when the pending read began. */
  private pendingWrites = 0;
  constructor(private readonly source: SessionCatalogSource, private readonly onProgress?: (loaded: number, total: number) => void) {}

  get version(): number { return this.revision; }
  get membershipVersion(): number { return this.membershipRevision; }
  dispose(): void { this.disposed = true; this.state = undefined; this.snapshot = undefined; this.dirty.clear(); this.fetchedAt.clear(); this.failed.clear(); }
  invalidate(id?: string): void {
    if (id) this.dirty.add(id);
    else this.refreshAll = true;
  }
  /** This client's own write has returned: a read asked from now on must begin after it. A read already running may have passed its row. */
  noteWrite(): void { this.writes++; }
  /** Reads again the active rows read before `before` (default: all of them). Rows read later already show what the gap hid. */
  invalidateActive(before = Number.POSITIVE_INFINITY): void { this.staleBefore = Math.max(this.staleBefore, before); }
  /** While the first read runs: the active rows read so far (shown before the rest arrives). */
  peek(): SessionCatalogSnapshot | undefined {
    const building = this.building;
    if (!building) return undefined;
    return { ...this.project(building.state), loading: { loaded: building.loaded, total: building.total } };
  }
  /** From now on reads include the archived rows (one list read). Returns whether they still have to be read. */
  wantArchived(): boolean { this.archivedWanted = true; return !this.state?.archivedLoaded; }
  private assertCurrent(): void { if (this.disposed) throw new Error("session catalog scope changed"); }
  private writable(state: CatalogState): void {
    // Empty polls must not clone a host-wide index. Copy only when applying actual rows.
    if (state.rows === this.state?.rows) {
      state.rows = new Map(state.rows);
      state.hostRows = new Map(state.hostRows);
      state.retiredIds = new Set(state.retiredIds);
    }
  }

  read(): Promise<SessionCatalogSnapshot> {
    this.assertCurrent();
    if (this.pending) return this.pendingWrites === this.writes ? this.pending : this.pending.catch(() => undefined).then(() => this.read());
    this.pendingWrites = this.writes;
    const pending = this.refresh().finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.pending = pending;
    return pending;
  }

  private async refresh(): Promise<SessionCatalogSnapshot> {
    // Rows that failed twice in this read are not tried a third time by its later passes.
    this.failedThisRead = new Set();
    const dirtyBefore = new Set(this.dirty), refreshAllBefore = this.refreshAll, staleBeforeBefore = this.staleBefore;
    // One recovery per read. A continually changing epoch must not cause an unbounded loop.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const previous = this.state;
        const state: CatalogState = previous
          ? { ...previous, membershipChanged: false }
          : { rows: new Map(), hostRows: new Map(), cursor: null, retiredIds: new Set() };
        let changed = !previous;
        const reindexed = !previous || previous.cursor === null;
        if (reindexed) {
          const initial = await this.bootstrap();
          Object.assign(state, initial);
          changed = true;
        }
        if (state.cursor !== null) changed = await this.drain(state) || changed;
        if (this.refreshAll) {
          this.refreshAll = false;
          // Archived rows come again as one list, not one read each.
          for (const [id, row] of state.rows) if (row.lifecycle === "active") this.dirty.add(id);
          if (state.archivedLoaded) this.archivedStale = true;
        }
        if (this.staleBefore) {
          const before = this.staleBefore;
          this.staleBefore = 0;
          for (const [id, row] of state.rows) if (row.lifecycle === "active" && (this.fetchedAt.get(id) ?? 0) <= before) this.dirty.add(id);
        }
        const dirty = new Map([...this.dirty].map(id => [id, lifecycleOf(state, id)] as const));
        if (dirty.size) { await this.hydrate(state, dirty); changed = true; }
        if (this.archivedWanted && (!state.archivedLoaded || this.archivedStale)) changed = await this.readArchived(state) || changed;
        this.assertCurrent();
        this.state = state;
        if (reindexed || state.membershipChanged) this.membershipRevision++;
        if (changed || !this.snapshot || (this.snapshot.missing ?? 0) !== this.failed.size) {
          this.snapshot = this.project(state);
          this.revision++;
        }
        return this.snapshot;
      } catch (error) {
        this.building = undefined;
        this.assertCurrent();
        for (const id of dirtyBefore) this.dirty.add(id);
        this.refreshAll ||= refreshAllBefore;
        this.staleBefore = Math.max(this.staleBefore, staleBeforeBefore);
        if (!(error instanceof ResyncRequired)) throw error;
        this.state = undefined;
        if (attempt === 1) throw error;
      }
    }
    throw new Error("session catalog recovery exhausted");
  }

  private project(state: CatalogState): SessionCatalogSnapshot {
    const rows = [...state.rows.values()].sort((a, b) => a.cutexSessionId < b.cutexSessionId ? -1 : a.cutexSessionId > b.cutexSessionId ? 1 : 0);
    return {
      active: shownSessions(rows.filter(row => row.lifecycle === "active")),
      retired: state.archivedLoaded ? rows.filter(row => row.lifecycle === "retired") : [],
      hostRows: Object.fromEntries(state.hostRows),
      ...(state.claudeRuntime ? { claudeRuntime: state.claudeRuntime } : {}),
      ...(this.failed.size ? { missing: this.failed.size } : {}),
      ...(state.archivedLoaded ? {} : { archivedPending: state.retiredIds.size }),
    };
  }

  private async bootstrap(): Promise<CatalogState> {
    const state: CatalogState = { rows: new Map(), hostRows: new Map(), cursor: null, retiredIds: new Set() };
    const keys = new Map<string, SessionLifecycle>();
    let first = true;
    let loaded = 0, total = 0;
    try {
      for (const lifecycle of ["active", "retired"] as const) {
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          // A status gap during this request still requires a reread.
          const started = Date.now();
          const page = await this.source.page(lifecycle, cursor);
          this.assertCurrent();
          if ("resyncRequired" in page) throw new ResyncRequired(page.reason);
          // Retain the FIRST head, even when null. Later pages are newer snapshots.
          if (first) { state.cursor = page.changeCursor; first = false; }
          if (page.claudeRuntime) state.claudeRuntime = page.claudeRuntime;
          for (const key of page.sessions) {
            if (lifecycle === "retired") { state.retiredIds.add(key.cutexSessionId); continue; }
            total++;
            if (key.resource !== undefined && key.hostRow !== undefined) {
              // Null means ineligible. Keep hints arriving during the request dirty.
              this.applyRow(state, key.cutexSessionId, key.resource, key.hostRow, started);
              loaded++;
            } else keys.set(key.cutexSessionId, lifecycle);
          }
          if (loaded) {
            // The known total grows as pages arrive; publish before requesting the next.
            this.building = { state, loaded, total };
            this.onProgress?.(loaded, total);
          }
          cursor = page.nextCursor ?? undefined;
          if (cursor && seen.has(cursor)) throw new Error("session page cursor did not advance");
          if (cursor) seen.add(cursor);
        } while (cursor);
      }
      this.building = { state, loaded, total };
      if (keys.size || !loaded) this.onProgress?.(loaded, total);
      await this.hydrate(state, keys);
    } finally { this.building = undefined; }
    return state;
  }

  /** The archived rows as one list. A failed list leaves them unread (the active rows stand); the next read tries again. */
  private async readArchived(state: CatalogState): Promise<boolean> {
    let rows: SessionResource[];
    try { rows = await this.source.retired(); }
    catch (error) { if (this.disposed) throw error; return false; }
    this.assertCurrent();
    this.writable(state);
    for (const [id, row] of state.rows) if (row.lifecycle === "retired") state.rows.delete(id);
    state.retiredIds = new Set();
    for (const row of rows) {
      if (row.lifecycle !== "retired" || state.rows.has(row.cutexSessionId)) continue;
      state.rows.set(row.cutexSessionId, row); state.retiredIds.add(row.cutexSessionId);
    }
    if (!state.archivedLoaded) state.membershipChanged = true;
    state.archivedLoaded = true; this.archivedStale = false;
    return true;
  }

  private async drain(state: CatalogState): Promise<boolean> {
    let changed = false;
    const updates = new Map<string, SessionLifecycle>();
    const seen = new Set<string>();
    let sequence = state.sequence ?? 0;
    do {
      const cursor = state.cursor!;
      if (seen.has(cursor)) throw new Error("session changes cursor did not advance");
      seen.add(cursor);
      const page = await this.source.changes(cursor);
      this.assertCurrent();
      if (page.resyncRequired) throw new ResyncRequired(page.reason);
      if (page.claudeRuntime && page.claudeRuntime.selectedRelease !== state.claudeRuntime?.selectedRelease) {
        state.claudeRuntime = page.claudeRuntime;
        changed = true;
      }
      // Order transport rows by seq, never by resource presentation revisions.
      for (const change of [...page.changes].sort((a, b) => a.seq - b.seq)) {
        if (change.seq <= sequence) continue;
        sequence = change.seq;
        changed = true;
        if (change.deleted) {
          if (state.rows.has(change.key)) state.membershipChanged = true;
          this.writable(state);
          state.rows.delete(change.key); state.hostRows.delete(change.key); state.retiredIds.delete(change.key); this.fetchedAt.delete(change.key); this.failed.delete(change.key);
          updates.delete(change.key); this.dirty.delete(change.key);
        } else updates.set(change.key, lifecycleOf(state, change.key));
      }
      state.cursor = page.nextCursor;
      if (!page.more) break;
    } while (true);
    await this.hydrate(state, updates);
    state.sequence = sequence;
    return changed;
  }

  private applyRow(state: CatalogState, id: string, row: SessionResource | null, hostRow: HostSessionRow | null, started: number): void {
    const before = state.rows.has(id) || state.retiredIds.has(id) ? lifecycleOf(state, id) : null;
    if (before !== (row?.lifecycle ?? null) ||
        (state.hostRows.get(id)?.projectId ?? null) !== (hostRow?.projectId ?? null)) state.membershipChanged = true;
    this.writable(state);
    if (row?.lifecycle === "retired") state.retiredIds.add(id); else state.retiredIds.delete(id);
    // An archived row is kept only once the archived rows are read; until then its ID is enough.
    if (row && (row.lifecycle !== "retired" || state.archivedLoaded)) state.rows.set(id, row); else state.rows.delete(id);
    if (hostRow) state.hostRows.set(id, hostRow); else state.hostRows.delete(id);
    this.fetchedAt.set(id, started);
    this.failed.delete(id);
  }

  /**
   * Reads the rows of `keys`. A row whose read fails is tried once more, then left dirty (and counted
   * missing) while every other row is kept: one busy reply never voids a whole host's read. Only when
   * every row failed (the host is unreachable) does the read fail, so its cursor is not acknowledged.
   */
  private async hydrate(state: CatalogState, keys: Map<string, SessionLifecycle>): Promise<void> {
    const entries = [...keys].filter(([id]) => !this.failedThisRead.has(id));
    let next = 0, succeeded = 0;
    let firstError: unknown;
    await Promise.all(Array.from({ length: Math.min(6, entries.length) }, async () => {
      while (next < entries.length) {
        const [id, lifecycle] = entries[next++]!;
        // At most one follow-up in this pass; continued hints remain dirty for the next refresh.
        let errors = 0;
        for (let pass = 0; pass < 2; pass++) {
          this.assertCurrent(); this.dirty.delete(id);
          try {
            const started = Date.now();
            const row = await this.source.session(id, lifecycleOf(state, id, lifecycle));
            this.assertCurrent();
            const hostRow = row?.lifecycle === "active" ? await this.source.hostRow(id) : null;
            this.assertCurrent();
            this.applyRow(state, id, row, hostRow, started);
            succeeded++;
            if (this.building?.state === state && pass === 0) this.onProgress?.(++this.building.loaded, this.building.total);
          } catch (error) {
            if (this.disposed) throw error;
            firstError ??= error;
            this.dirty.add(id);
            // One more try for this row, then keep it for the next read.
            if (++errors < 2) { pass--; continue; }
            this.failed.add(id); this.failedThisRead.add(id);
            break;
          }
          if (!this.dirty.has(id)) break;
        }
      }
    }));
    if (entries.length && !succeeded) throw firstError;
  }
}
