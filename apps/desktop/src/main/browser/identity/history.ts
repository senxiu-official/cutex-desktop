import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  isBrowserIdentityId, type BrowserClearDataRequest, type BrowserHistoryDelete, type BrowserHistoryEntry, type BrowserHistoryPage,
  type BrowserHistoryQuery, type BrowserHistoryRange, type BrowserHistoryRetention, type BrowserTopSite,
} from "../../../shared/browserIdentity";
import { parsePublicBrowserUrl } from "../egressAddress";
import type { BrowserHistoryService, EmitBrowserIdentityEvent } from "./contract";
import { browserIdentityHostId, diskEntry, historyDirectory } from "./disk";

const DAY_MS = 24 * 60 * 60_000;
const RETENTION: Record<Exclude<BrowserHistoryRetention, "off">, number> = { "30d": 30, "90d": 90, "1y": 365 };
const CLEAR: Record<BrowserHistoryRange, number> = { hour: DAY_MS / 24, day: DAY_MS, week: 7 * DAY_MS, month: 28 * DAY_MS, all: Infinity };
const MAX_VISITS = 100_000;
const MAX_TITLE = 200;
const MAX_URL = 2000;
const EMPTY: BrowserHistoryPage = { entries: [], nextBefore: null };

interface Cell { identityId: string; hostId: string }
interface HistoryDb { db: DatabaseSync; count: number; lastVisit: number; lastPrune: number }
interface HistoryOptions {
  userData: string;
  allowed(identityId: string, hostId: string): boolean;
  retention(): BrowserHistoryRetention;
  emit: EmitBrowserIdentityEvent;
  now?: () => number;
  maxVisits?: number;
}

function visitUrl(raw: string): URL | null {
  if (raw.length > MAX_URL || !parsePublicBrowserUrl(raw)) return null;
  const url = new URL(raw);
  if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  url.hash = "";
  return url;
}
function exactOrigin(raw: string): string {
  const url = new URL(raw);
  if (raw !== url.origin || (url.protocol !== "https:" && url.protocol !== "http:")) throw Error("invalid_browser_origin");
  return url.origin;
}
function folded(value: string): string { return value.normalize("NFKC").toLowerCase(); }

/** Main-only history. Only its renderer IPC facade gets access to reads or mutations. */
export class BrowserHistory implements BrowserHistoryService {
  private readonly handles = new Map<string, HistoryDb>();
  private readonly now: () => number;
  private readonly maxVisits: number;
  private sweep = 0;
  constructor(private readonly options: HistoryOptions) {
    this.now = options.now ?? Date.now;
    this.maxVisits = Math.min(MAX_VISITS, Math.max(1, options.maxVisits ?? MAX_VISITS));
  }

  private path(identityId: string, hostId: string): string {
    if (!browserIdentityHostId(hostId)) throw Error("invalid_browser_identity");
    return join(historyDirectory(this.options.userData, identityId), `${hostId}.sqlite`);
  }

  private diskPath(path: string, create: boolean): boolean {
    for (const directory of [this.options.userData, join(this.options.userData, "browser-history"), dirname(path)]) {
      const info = diskEntry(directory);
      if (info ? !info.isDirectory() : !create) return false;
      if (!info) mkdirSync(directory);
    }
    const info = diskEntry(path);
    if (info && !info.isFile()) throw Error("browser_history_storage_unavailable");
    // SQLite may open these by basename before any query runs.
    for (const suffix of ["-wal", "-shm", "-journal"]) diskEntry(path + suffix);
    return !!info || create;
  }

  private open(identityId: string, hostId: string, create = false): HistoryDb | undefined {
    if (!this.options.allowed(identityId, hostId)) return;
    const path = this.path(identityId, hostId);
    const before = this.handles.get(path);
    if (before) {
      this.handles.delete(path);
      this.handles.set(path, before);
      return before;
    }
    if (!this.diskPath(path, create)) return;
    const db = new DatabaseSync(path);
    try {
      db.exec(`PRAGMA busy_timeout=250; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS visits (
          id TEXT PRIMARY KEY, origin TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL,
          visited_at INTEGER NOT NULL UNIQUE, transition TEXT NOT NULL, search_text TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS visits_origin_time ON visits(origin, visited_at DESC);
        CREATE INDEX IF NOT EXISTS visits_url_time ON visits(url, visited_at DESC);
        CREATE TABLE IF NOT EXISTS deleted_visits (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS deleted_visits_time ON deleted_visits(updated_at);
      `);
      const stats = db.prepare("SELECT COUNT(*) AS count, COALESCE(MAX(visited_at), -1) AS lastVisit FROM visits").get() as { count: number; lastVisit: number };
      const handle = { db, ...stats, lastPrune: -Infinity };
      this.handles.set(path, handle);
      if (this.handles.size > 24) this.close(this.handles.keys().next().value!);
      return handle;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private changed(identityId: string, hostId: string): void {
    this.options.emit({ kind: "history", identityId, hostId });
  }

  private prune(handle: HistoryDb, force = false): boolean {
    const now = this.now(), retention = this.options.retention();
    let changed = 0;
    if (force || now >= handle.lastPrune + 60_000 || now < handle.lastPrune) {
      if (retention !== "off")
        changed = Number(handle.db.prepare("DELETE FROM visits WHERE visited_at < ?").run(now - RETENTION[retention] * DAY_MS).changes);
      handle.count -= changed;
      handle.db.prepare("DELETE FROM deleted_visits WHERE updated_at < ?").run(now - 365 * DAY_MS);
      handle.lastPrune = now;
    }
    if (handle.count > this.maxVisits) {
      const removed = Number(handle.db.prepare(`DELETE FROM visits WHERE id IN
        (SELECT id FROM visits ORDER BY visited_at LIMIT ?)`).run(handle.count - this.maxVisits).changes);
      handle.count -= removed;
      changed += removed;
    }
    return changed > 0;
  }

  record(entry: Omit<BrowserHistoryEntry, "id">): string | undefined {
    const { identityId, hostId, transition } = entry;
    if (this.options.retention() === "off" || !Number.isSafeInteger(entry.visitedAt) || entry.visitedAt < 0) return;
    const url = visitUrl(entry.url), handle = url && this.open(identityId, hostId, true);
    if (!url || !handle) return;
    const id = randomUUID(), title = entry.title.slice(0, MAX_TITLE), now = this.now();
    // The IPC cursor is a timestamp. Make colliding millisecond visits individually pageable.
    const visitedAt = Math.max(entry.visitedAt, handle.lastVisit + 1);
    handle.db.prepare(`INSERT INTO visits (id, origin, url, title, visited_at, transition, search_text, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, url.origin, url.href, title, visitedAt, transition, folded(`${title}\n${url.href}`), now);
    handle.lastVisit = visitedAt;
    handle.count++;
    this.prune(handle);
    this.changed(identityId, hostId);
    return id;
  }

  retitle(identityId: string, hostId: string, raw: string, value: string, id?: string): void {
    if (this.options.retention() === "off") return;
    const url = visitUrl(raw), handle = url && this.open(identityId, hostId);
    if (!url || !handle) return;
    const title = value.slice(0, MAX_TITLE);
    const rowId = id ?? (handle.db.prepare("SELECT id FROM visits WHERE url = ? ORDER BY visited_at DESC LIMIT 1").get(url.href)?.id as string | undefined);
    if (!rowId) return;
    const result = handle.db.prepare(`UPDATE visits SET title = ?, search_text = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND url = ? AND title <> ?`).run(title, folded(`${title}\n${url.href}`), this.now(), rowId, url.href, title);
    if (result.changes) this.changed(identityId, hostId);
  }

  async query({ identityId, hostId, text, before, limit = 100 }: BrowserHistoryQuery): Promise<BrowserHistoryPage> {
    const handle = this.open(identityId, hostId);
    if (!handle) return { ...EMPTY, entries: [] };
    this.prune(handle);
    const rows = handle.db.prepare(`SELECT id,url,title,visited_at AS visitedAt,transition FROM visits
      WHERE visited_at < ? AND instr(search_text, ?) > 0 ORDER BY visited_at DESC LIMIT ?`)
      .all(before ?? Number.MAX_SAFE_INTEGER, folded(text ?? ""), limit + 1) as Array<Omit<BrowserHistoryEntry, "identityId" | "hostId">>;
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    return { entries: rows.map(row => ({ ...row, identityId, hostId })), nextBefore: hasMore ? rows.at(-1)!.visitedAt : null };
  }

  async topSites(identityId: string, hostId: string, limit: number): Promise<BrowserTopSite[]> {
    const handle = this.open(identityId, hostId);
    if (!handle) return [];
    this.prune(handle);
    return handle.db.prepare(`WITH sites AS (
      SELECT MAX(visited_at) AS latest, COUNT(*) AS visits FROM visits GROUP BY origin ORDER BY visits DESC, latest DESC LIMIT ?
      ) SELECT visits.url,visits.title,sites.visits FROM sites JOIN visits ON visits.visited_at = sites.latest
      ORDER BY sites.visits DESC, sites.latest DESC`).all(limit) as unknown as BrowserTopSite[];
  }

  private deleteRows(cell: Cell, where: string, bindings: SQLInputValue[]): void {
    const handle = this.open(cell.identityId, cell.hostId);
    if (!handle) return;
    const now = this.now(), db = handle.db;
    db.exec("BEGIN IMMEDIATE");
    let removed: number;
    try {
      db.prepare(`INSERT INTO deleted_visits SELECT id, revision + 1, ? FROM visits WHERE ${where}`).run(now, ...bindings);
      removed = Number(db.prepare(`DELETE FROM visits WHERE ${where}`).run(...bindings).changes);
      db.prepare(`DELETE FROM deleted_visits WHERE id IN
        (SELECT id FROM deleted_visits ORDER BY updated_at DESC, id LIMIT -1 OFFSET ?)`).run(MAX_VISITS);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    handle.count -= removed;
    if (removed) this.changed(cell.identityId, cell.hostId);
  }

  async remove(target: BrowserHistoryDelete): Promise<void> {
    if ("ids" in target) {
      if (target.ids.length) this.deleteRows(target, `id IN (${target.ids.map(() => "?").join(",")})`, target.ids);
    } else {
      this.deleteRows(target, "origin = ?", [exactOrigin(target.origin)]);
    }
  }

  async clear(request: BrowserClearDataRequest): Promise<void> {
    if (!request.types.includes("history")) return;
    const { identityId, hostId, historyRange = "all" } = request;
    const origins = request.origins?.map(exactOrigin), since = CLEAR[historyRange];
    const where = ["visited_at >= ?"], bindings: SQLInputValue[] = [since === Infinity ? 0 : this.now() - since];
    if (origins?.length) { where.push(`origin IN (${origins.map(() => "?").join(",")})`); bindings.push(...origins); }
    for (const host of hostId === "all" ? this.hosts(identityId) : [hostId]) {
      this.deleteRows({ identityId, hostId: host }, where.join(" AND "), bindings);
    }
  }

  private identities(): string[] {
    const directory = join(this.options.userData, "browser-history");
    if (!diskEntry(directory)?.isDirectory()) return [];
    return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory() && isBrowserIdentityId(entry.name)).map(entry => entry.name);
  }

  private hosts(identityId: string): string[] {
    const directory = historyDirectory(this.options.userData, identityId);
    if (!diskEntry(dirname(directory))?.isDirectory() || !diskEntry(directory)?.isDirectory()) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (!entry.isFile() || !entry.name.endsWith(".sqlite")) return [];
      const hostId = entry.name.slice(0, -".sqlite".length);
      return browserIdentityHostId(hostId) ? [hostId] : [];
    });
  }

  async pruneAll(): Promise<void> {
    const sweep = ++this.sweep;
    for (const identityId of this.identities()) for (const hostId of this.hosts(identityId)) {
      if (this.sweep !== sweep) return;
      try {
        const handle = this.open(identityId, hostId);
        if (handle && this.prune(handle, true)) this.changed(identityId, hostId);
      } catch { /* A damaged store must not stop cleanup of the other identity partitions. */ }
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  private close(path: string): void {
    this.handles.get(path)?.db.close();
    this.handles.delete(path);
  }

  async dropIdentity(identityId: string): Promise<void> {
    const directory = historyDirectory(this.options.userData, identityId);
    if (!diskEntry(dirname(directory))?.isDirectory() || !diskEntry(directory)?.isDirectory()) return;
    for (const hostId of this.hosts(identityId)) this.close(this.path(identityId, hostId));
    rmSync(directory, { recursive: true });
  }

  async dropHost(hostId: string): Promise<void> {
    for (const identityId of this.identities()) {
      const path = this.path(identityId, hostId);
      this.close(path);
      if (!this.diskPath(path, false)) continue;
      for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(path + suffix, { force: true });
    }
  }

  dispose(): void { this.sweep++; for (const path of this.handles.keys()) this.close(path); }
}
