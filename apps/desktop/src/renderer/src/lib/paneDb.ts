// Where the pane layout file (lib/paneFile) lives (E-G10, owner approved 2026-10-24): IndexedDB
// `cutex-desktop-panes`, one record per piece (`meta`, each scope's layout, each scope's default layout + shared
// pages, each conversation's own Shelf) instead of one localStorage JSON read and rewritten whole on every save
// (storage audit 2026-10-23 #7: a full origin quota silently stopped layouts from being saved).
//
// - Reads stay synchronous: `load()` runs once before the first render (lib/paneDbBoot) and keeps the file in
//   memory. The whole load has one deadline; missed = this run uses localStorage (`active` stays false) and nothing
//   more is written here (a copy / merge already committed is stamped, so that run's edits of the old key merge in).
// - A write stores only the records that changed (by reference: lib/paneFile replaces what it changes), within
//   FLUSH_MS, in one transaction. Every record carries `t` (when it changed) and is only replaced by a newer one; a
//   deleted record stays as a tombstone `{ t, del }` (pruned after TOMBSTONE_MS), so an older write can not bring it
//   back; tombstones are only pruned while a valid stamp exists. Other windows hear each change at once
//   (BroadcastChannel).
// - Each window keeps what it has not committed yet in its own small localStorage journal
//   (`cutex-desktop.panes.journal.<window>`, updated on every change while small, always on pagehide); the next
//   start commits every journal it finds, after the merge below (a crashed or closing renderer may not finish its
//   last transaction); a journal rewritten meanwhile by a window still open stays.
// - Downgrade (for the 0.2 releases): on pagehide the whole file is also written to the old key
//   `cutex-desktop.panes` when it fits (MIRROR_MAX), its hash + newest `t` written just before it
//   (`cutex-desktop.panes.stamp`; no room for the stamp = no copy), so an older desktop finds the newest layout. When the old key no longer matches
//   that stamp, someone else wrote it (an older desktop, or a run without IndexedDB): its pieces are merged in,
//   except records changed here after the copy was taken (they are newer than what that writer saw); with no stamp,
//   only pieces never seen here come in. Nothing is ever cleared. A window does not overwrite such a foreign write with its own copy (the next start merges it).
// - First start: the old key is copied in (records another window wrote meanwhile stay) and read back before it is
//   used; the old key stays.
// - No IndexedDB (or it fails to open / verify / within the deadline): the file stays in localStorage as before.
// Shell code: names no feature.
import type { ToolPart } from "./paneLayout";
import type { ShelfMeta } from "./convShelves";
import { reportStorageFull } from "./storageFull";

export const PANES_STORAGE_KEY = "cutex-desktop.panes";
/** The downgrade copy's identity `{ stamp, t }`: its hash, the newest change it holds. */
export const PANES_STAMP_KEY = "cutex-desktop.panes.stamp";
/** Each window's not yet committed writes (`<prefix>.<window>`; applied on the next start, then removed). */
export const PANES_JOURNAL_PREFIX = "cutex-desktop.panes.journal";
export const PANES_DB_NAME = "cutex-desktop-panes";
const STORE = "records";
const CHANNEL = "cutex-desktop.panes";
/** Writes within this are one transaction (the stores debounce their own saves already). */
const FLUSH_MS = 100;
/** The downgrade copy is written only up to this size (characters; the origin quota is about 5M, shared). */
const MIRROR_MAX = 1_500_000;
/** The journal is kept on every change only while this small (a migration rewriting everything is not). */
const JOURNAL_LIVE_MAX = 200_000;
/** Tombstones older than this go (a journal or another window's write is never that late). */
const TOMBSTONE_MS = 7 * 24 * 3600_000;

/** A conversation's own Shelf as stored (v5): its tool area without the shared pages, what it showed, last used. */
export interface ConvShelfEntry {
  part: ToolPart;
  meta: ShelfMeta;
  at: number;
}

/** A scope's Shelves (v5, §24.13): the default layout, the shared pages, each conversation's own Shelf. */
export interface ConvShelfScope {
  template: ToolPart | null;
  shared: ToolPart | null;
  conv: Record<string, ConvShelfEntry>;
}

export interface PanesFile {
  /** 1: layouts may be v1 (tool columns); 2: every layout v2 (Shelves), the step-3 backup restored; 3: 允许混排 reset (step 3 above); 4: Shelf chips → collapsed rails (step 4); 5: a Shelf per conversation (step 5). */
  v: 1 | 2 | 3 | 4 | 5;
  layouts: Record<string, unknown>;
  /** 只用一个 Shelf for a scope with no stored tool area (v3: true = a new install). Absent = off. */
  singleShelf?: boolean;
  /** v5: the Shelves per scope (`host:<id>`). */
  convShelves?: Record<string, ConvShelfScope>;
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** The stored file (the old key's JSON); anything unreadable is an empty v1 file. */
export function parsePanesFile(raw: string | null): PanesFile {
  try {
    const file = JSON.parse(raw ?? "null") as unknown;
    if (isRecord(file) && (file.v === 1 || file.v === 2 || file.v === 3 || file.v === 4 || file.v === 5) && isRecord(file.layouts)) return file as unknown as PanesFile;
  } catch {
    // unreadable: start empty
  }
  return { v: 1, layouts: {} };
}

// ── records ──────────────────────────────────────────────────────────────────────────────────────

type RecKey = ["meta"] | ["layout", string] | ["scope", string] | ["conv", string, string];
interface MetaValue {
  v: PanesFile["v"];
  singleShelf?: boolean;
}
/** A record change; `t` orders changes from every window (the newer one stays). */
export interface PaneOp {
  k: RecKey;
  t: number;
  v?: unknown;
  del?: true;
}
const idOf = (k: RecKey): string => k.join("\u0000");

/** The old key's identity: length + FNV-1a (it only has to notice that someone else wrote the key). */
export function stampOf(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${raw.length}:${(h >>> 0).toString(36)}`;
}

const metaOp = (file: PanesFile, t: number): PaneOp => ({ k: ["meta"], t, v: { v: file.v, ...(file.singleShelf !== undefined ? { singleShelf: file.singleShelf } : {}) } satisfies MetaValue });
const scopeValue = (e: ConvShelfScope) => ({ template: e.template ?? null, shared: e.shared ?? null });
const put = (k: RecKey, v: unknown, t: number): PaneOp => (v === undefined ? { k, t, del: true } : { k, t, v });

/** Every record of a file. */
export function flatten(file: PanesFile, t: number): PaneOp[] {
  const ops: PaneOp[] = [metaOp(file, t)];
  for (const [scope, layout] of Object.entries(file.layouts)) if (layout !== undefined) ops.push({ k: ["layout", scope], t, v: layout });
  for (const [scope, entry] of Object.entries(file.convShelves ?? {})) {
    ops.push({ k: ["scope", scope], t, v: scopeValue(entry) });
    for (const [key, conv] of Object.entries(entry.conv ?? {})) if (conv !== undefined) ops.push({ k: ["conv", scope, key], t, v: conv });
  }
  return ops;
}

/** The records that differ between two files (the pieces lib/paneFile replaced, added or dropped). */
export function diffFiles(prev: PanesFile, next: PanesFile, t: number): PaneOp[] {
  const ops: PaneOp[] = [];
  if (prev.v !== next.v || prev.singleShelf !== next.singleShelf) ops.push(metaOp(next, t));
  for (const [scope, layout] of Object.entries(next.layouts)) if (layout !== prev.layouts[scope] || !(scope in prev.layouts)) ops.push(put(["layout", scope], layout, t));
  for (const scope of Object.keys(prev.layouts)) if (!(scope in next.layouts)) ops.push({ k: ["layout", scope], t, del: true });
  const before = prev.convShelves ?? {};
  const after = next.convShelves ?? {};
  for (const [scope, entry] of Object.entries(after)) {
    const old = before[scope];
    if (!old || old.template !== entry.template || old.shared !== entry.shared) ops.push({ k: ["scope", scope], t, v: scopeValue(entry) });
    const oldConv = old?.conv ?? {};
    const conv = entry.conv ?? {};
    if (old && oldConv === conv) continue;
    for (const [key, e] of Object.entries(conv)) if (e !== oldConv[key] || !(key in oldConv)) ops.push(put(["conv", scope, key], e, t));
    for (const key of Object.keys(oldConv)) if (!(key in conv)) ops.push({ k: ["conv", scope, key], t, del: true });
  }
  for (const [scope, old] of Object.entries(before)) {
    if (scope in after) continue;
    ops.push({ k: ["scope", scope], t, del: true });
    for (const key of Object.keys(old.conv ?? {})) ops.push({ k: ["conv", scope, key], t, del: true });
  }
  return ops;
}

/** A file with the changes applied (containers copied where touched; records kept by reference). */
export function applyOps(file: PanesFile, ops: readonly PaneOp[]): PanesFile {
  const out: PanesFile = { ...file, layouts: { ...file.layouts } };
  let shelves: Record<string, ConvShelfScope> | null = null;
  const copied = new Set<string>();
  const scopeOf = (scope: string): ConvShelfScope => {
    shelves ??= { ...(file.convShelves ?? {}) };
    const cur = shelves[scope];
    if (!copied.has(scope)) {
      copied.add(scope);
      shelves[scope] = cur ? { ...cur, conv: { ...(cur.conv ?? {}) } } : { template: null, shared: null, conv: {} };
    }
    return shelves[scope]!;
  };
  for (const op of ops) {
    const [kind, scope, key] = op.k;
    if (kind === "meta") {
      if (op.del || !isRecord(op.v)) continue;
      const v = op.v as unknown as MetaValue;
      out.v = v.v;
      if (v.singleShelf === undefined) delete out.singleShelf;
      else out.singleShelf = v.singleShelf;
    } else if (kind === "layout") {
      if (op.del) delete out.layouts[scope!];
      else out.layouts[scope!] = op.v;
    } else if (kind === "scope") {
      if (op.del) {
        shelves ??= { ...(file.convShelves ?? {}) };
        delete shelves[scope!];
        copied.delete(scope!);
      } else {
        const e = scopeOf(scope!);
        const v = isRecord(op.v) ? op.v : {};
        e.template = (v.template as ToolPart | null | undefined) ?? null;
        e.shared = (v.shared as ToolPart | null | undefined) ?? null;
      }
    } else if (kind === "conv") {
      if (op.del) {
        if (!(shelves ?? file.convShelves ?? {})[scope!]) continue;
        delete scopeOf(scope!).conv[key!];
      } else scopeOf(scope!).conv[key!] = op.v as ConvShelfEntry;
    }
  }
  if (shelves) out.convShelves = shelves;
  return out;
}

/** What the stored records are (tombstones included). */
type Recs = Map<string, PaneOp>;

/**
 * Someone else wrote the old key (`file`) since the copy stamped `copyT` was taken: its pieces that differ come in
 * (at `t`), its missing ones go — except records (and tombstones) changed here after `copyT`, which that writer never
 * saw. `copyT` -Infinity (no stamp): only pieces never seen here come in, nothing goes.
 */
export function mergeForeign(recs: Recs, file: PanesFile, copyT: number, t: number): PaneOp[] {
  const ops: PaneOp[] = [];
  const incoming = new Map(flatten(file, t).map((op) => [idOf(op.k), op]));
  for (const [id, op] of incoming) {
    const cur = recs.get(id);
    if (cur && cur.t > copyT) continue;
    if (cur && !cur.del && JSON.stringify(cur.v) === JSON.stringify(op.v)) continue;
    ops.push(op);
  }
  for (const [id, cur] of recs) if (!cur.del && !incoming.has(id) && cur.t <= copyT) ops.push({ k: cur.k, t, del: true });
  return ops;
}

// ── IndexedDB ────────────────────────────────────────────────────────────────────────────────────

interface StoredRec {
  t: number;
  v?: unknown;
  del?: true;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("aborted", "AbortError"));
  });

function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new DOMException("blocked", "AbortError"));
  });
}

async function readAll(db: IDBDatabase): Promise<Recs> {
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const keys = store.getAllKeys();
  const values = store.getAll();
  await done(tx);
  const out: Recs = new Map();
  keys.result.forEach((key, i) => {
    const rec = values.result[i] as StoredRec | undefined;
    if (!Array.isArray(key) || !rec || typeof rec.t !== "number") return;
    const k = key as RecKey;
    out.set(idOf(k), rec.del ? { k, t: rec.t, del: true } : { k, t: rec.t, v: rec.v });
  });
  return out;
}

/** A value IndexedDB can hold (JSON data; anything else as its JSON). */
function putRec(store: IDBObjectStore, k: RecKey, rec: StoredRec): void {
  try {
    store.put(rec, k);
  } catch {
    store.put(JSON.parse(JSON.stringify(rec)) as StoredRec, k);
  }
}

/** Writes the changes in one transaction; a record (or tombstone) only goes for a newer (or equal) one. */
function commit(db: IDBDatabase, ops: readonly PaneOp[]): Promise<void> {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const op of ops) {
    const req = store.get(op.k);
    req.onsuccess = () => {
      const cur = req.result as StoredRec | undefined;
      if (cur && cur.t > op.t) return;
      putRec(store, op.k, op.del ? { t: op.t, del: true } : { t: op.t, v: op.v });
    };
  }
  return done(tx);
}

/** Removes tombstones older than TOMBSTONE_MS. */
function prune(db: IDBDatabase, recs: Recs, now: number): Promise<void> {
  const old = [...recs.values()].filter((r) => r.del && r.t < now - TOMBSTONE_MS);
  if (!old.length) return Promise.resolve();
  const tx = db.transaction(STORE, "readwrite");
  for (const r of old) tx.objectStore(STORE).delete(r.k);
  return done(tx);
}

function parseOps(text: string | null): PaneOp[] {
  try {
    const raw = JSON.parse(text ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((op): op is PaneOp => isRecord(op) && Array.isArray(op.k) && typeof op.t === "number") : [];
  } catch {
    return [];
  }
}

/** Every window's journal key (the plain prefix too). */
function journalKeys(ls: Storage | null): string[] {
  const out: string[] = [];
  try {
    if (!ls) return out;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && (k === PANES_JOURNAL_PREFIX || k.startsWith(`${PANES_JOURNAL_PREFIX}.`))) out.push(k);
    }
  } catch {
    // none readable
  }
  return out;
}

function readStamp(ls: Storage | null): { stamp: string; t: number } | null {
  try {
    const raw = JSON.parse(ls?.getItem(PANES_STAMP_KEY) ?? "null") as unknown;
    return isRecord(raw) && typeof raw.stamp === "string" && typeof raw.t === "number" ? { stamp: raw.stamp, t: raw.t } : null;
  } catch {
    return null;
  }
}

const isQuota = (e: unknown) => e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "UnknownError");

type Message = { type: "ops"; ops: PaneOp[] } | { type: "closing"; ops: PaneOp[]; journal: string };

export interface PaneDbOptions {
  indexedDB?: IDBFactory | null;
  storage?: () => Storage | null;
  name?: string;
  /** BroadcastChannel name (null: none). */
  channel?: string | null;
  /** Listen to pagehide / visibilitychange (the app's instance). */
  listen?: boolean;
  mirrorMax?: number;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export class PaneDb {
  private db: IDBDatabase | null = null;
  private file: PanesFile = { v: 1, layouts: {} };
  private stored = false;
  /** When each record last changed (`t`, tombstones too): an older change from another window does not replace it. */
  private times = new Map<string, number>();
  private pending = new Map<string, PaneOp>();
  private inflight = new Set<Promise<void>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private channel: BroadcastChannel | null = null;
  private lastT = 0;
  private off: (() => void)[] = [];
  private loading: Promise<boolean> | null = null;
  /** The old key's hash this run accounts for (read, merged in or copied): not someone else's write. */
  private known: string | null = null;
  /** Live journaling paused (too big / localStorage full) until a commit succeeds. */
  private journalOff = false;
  /** This window's journal key. */
  private readonly journal = `${PANES_JOURNAL_PREFIX}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  constructor(private readonly opts: PaneDbOptions = {}) {}

  /** The file lives in IndexedDB (loaded); false: lib/paneFile keeps using localStorage. */
  get active(): boolean {
    return this.db !== null;
  }

  /** Something was stored before this start (the old key or a copy here): not a new install. */
  get hadStored(): boolean {
    return this.stored;
  }

  private ls(): Storage | null {
    return (this.opts.storage ?? defaultStorage)();
  }

  private tick(): number {
    this.lastT = Math.max(Date.now(), this.lastT + 1);
    return this.lastT;
  }

  /**
   * Opens the database and reads the file into memory (once), all within `deadlineMs`. False: no IndexedDB here,
   * it failed, or it was too slow — this run uses localStorage (a load finishing later is dropped).
   */
  load(deadlineMs = 5000): Promise<boolean> {
    this.loading ??= new Promise<boolean>((resolve) => {
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        resolve(false);
      }, deadlineMs);
      void this.doLoad(() => late).then((ok) => {
        clearTimeout(timer);
        resolve(ok);
      });
    });
    return this.loading;
  }

  private async doLoad(late: () => boolean): Promise<boolean> {
    const factory = this.opts.indexedDB !== undefined ? this.opts.indexedDB : typeof indexedDB === "undefined" ? null : indexedDB;
    if (!factory) return false;
    let db: IDBDatabase | null = null;
    try {
      db = await openDb(factory, this.opts.name ?? PANES_DB_NAME);
      let recs = await readAll(db);
      this.lastT = Math.max(this.lastT, 0, ...[...recs.values()].map((r) => r.t));
      const ls = this.ls();
      let raw: string | null = null;
      try {
        raw = ls?.getItem(PANES_STORAGE_KEY) ?? null;
      } catch {
        raw = null;
      }
      const meta = recs.get(idOf(["meta"]));
      const hadMeta = !!meta && !meta.del;
      const stamp = readStamp(ls);
      // The old key's hash this run has accounted for (our copy, or merged in); a valid stamp stored (or no old key
      // at all) = tombstones may be pruned (without one, the next merge can only lean on them).
      let known = stamp?.stamp ?? null;
      let stampOk = !!stamp || raw === null;
      const writeStamp = (s: { stamp: string; t: number }) => {
        known = s.stamp;
        try {
          ls?.setItem(PANES_STAMP_KEY, JSON.stringify(s));
          stampOk = true;
        } catch {
          // full: the next start merges again (conservatively, nothing pruned)
        }
      };
      // Past the deadline this run uses localStorage: nothing more is written here.
      const onTime = () => {
        if (late()) throw new Error("pane layout load missed its deadline");
      };
      if (!hadMeta) {
        // First start here: the old key comes in at t 0 (what another window wrote meanwhile stays), read back.
        onTime();
        const ops = flatten(parsePanesFile(raw), 0);
        await commit(db, ops);
        // Committed (even when the deadline passed meanwhile): stamped, so a later write of the old key merges in.
        if (raw !== null) writeStamp({ stamp: stampOf(raw), t: 0 });
        onTime();
        const back = await readAll(db);
        if (!ops.every((op) => { const r = back.get(idOf(op.k)); return !!r && (r.t > 0 || JSON.stringify(r.v) === JSON.stringify(op.v)); })) throw new Error("pane layout copy did not verify");
        recs = back;
      } else if (raw !== null && stampOf(raw) !== stamp?.stamp) {
        // Someone else wrote the old key since our copy: merged in, keeping what changed here after the copy. No stamp
        // known: everything stored (tombstones too) counts as newer — only pieces never seen here come in.
        onTime();
        const ops = mergeForeign(recs, parsePanesFile(raw), stamp?.t ?? -Infinity, this.tick());
        if (ops.length) await commit(db, ops);
        writeStamp({ stamp: stampOf(raw), t: this.lastT });
        onTime();
        if (ops.length) recs = await readAll(db);
      }
      // Then every window's last writes not committed (crash, closing): committed (newer than what is stored only).
      onTime();
      const journals = journalKeys(ls).map((k) => [k, ls?.getItem(k) ?? null] as const);
      const journal = journals.flatMap(([, text]) => parseOps(text));
      if (journal.length) {
        await commit(db, journal);
        onTime();
        recs = await readAll(db);
      }
      if (stampOk) await prune(db, recs, Date.now());
      onTime();
      for (const [k, text] of journals) {
        try {
          // A window still open may have rewritten its journal since: kept then.
          if (ls?.getItem(k) === text) ls?.removeItem(k);
        } catch {
          // committed already: applying it again changes nothing
        }
      }
      this.known = known;
      this.times = new Map([...recs].map(([id, r]) => [id, r.t]));
      this.lastT = Math.max(this.lastT, ...this.times.values());
      this.file = applyOps({ v: 1, layouts: {} }, [...recs.values()].filter((r) => !r.del));
      this.stored = raw !== null || hadMeta;
      this.db = db;
      db.onversionchange = () => db?.close();
      this.listen();
      return true;
    } catch {
      db?.close();
      return false;
    }
  }

  private listen(): void {
    const name = this.opts.channel === undefined ? CHANNEL : this.opts.channel;
    if (name && typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(name);
      channel.onmessage = (e: MessageEvent<Message>) => this.receive(e.data);
      this.channel = channel;
    }
    if (this.opts.listen && typeof window !== "undefined" && typeof document !== "undefined") {
      // pagehide: after every beforeunload handler (the stores store their last change there).
      const hide = () => this.hide();
      const hidden = () => {
        if (document.visibilityState === "hidden") void this.flush();
      };
      window.addEventListener("pagehide", hide);
      document.addEventListener("visibilitychange", hidden);
      this.off.push(() => window.removeEventListener("pagehide", hide), () => document.removeEventListener("visibilitychange", hidden));
    }
  }

  /** The file as stored (shared: lib/paneFile copies before changing it). */
  read(): PanesFile {
    return this.file;
  }

  /** Stores a changed file: the records that differ, within FLUSH_MS (journaled now); other windows hear them now. */
  write(next: PanesFile): void {
    const ops = diffFiles(this.file, next, this.tick());
    this.file = next;
    if (!ops.length) return;
    for (const op of ops) {
      const id = idOf(op.k);
      this.pending.set(id, op);
      this.times.set(id, op.t);
    }
    this.saveJournal(JOURNAL_LIVE_MAX);
    this.post({ type: "ops", ops });
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  /** This window's pending writes in its journal (none: removed); `max`: skipped when bigger (a crash loses them). */
  private saveJournal(max = Infinity): void {
    const ls = this.ls();
    const live = max !== Infinity;
    try {
      if (!this.pending.size) {
        this.journalOff = false;
        return ls?.removeItem(this.journal);
      }
      if (live && this.journalOff) return;
      const text = JSON.stringify([...this.pending.values()]);
      if (text.length <= max) return ls?.setItem(this.journal, text);
      ls?.removeItem(this.journal);
      if (live) this.journalOff = true;
    } catch {
      // full: the transaction is all there is (not tried again on every change until a commit succeeds)
      if (live) this.journalOff = true;
    }
  }

  private post(msg: Message): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // not cloneable: the other windows read it on their next start
    }
  }

  /** Applies another window's changes that are newer than what this one has. */
  private receive(msg: Message): void {
    if (!this.db || !msg || !Array.isArray(msg.ops)) return;
    // A closing window's own changes were heard already (same `t`): this one writes them now.
    const closing = msg.type === "closing";
    const fresh = msg.ops.filter((op) => {
      const mine = this.times.get(idOf(op.k)) ?? -Infinity;
      return closing ? op.t >= mine : op.t > mine;
    });
    for (const op of fresh) {
      const id = idOf(op.k);
      this.times.set(id, op.t);
      this.lastT = Math.max(this.lastT, op.t);
      // That window writes its own change; a closing one may not finish: this one writes it too.
      if (closing) this.pending.set(id, op);
      else this.pending.delete(id);
    }
    if (fresh.length) this.file = applyOps(this.file, fresh);
    if (!closing) return;
    void this.flush().then(() => {
      // Written: that window's journal is not needed any more.
      try {
        this.ls()?.removeItem(msg.journal);
      } catch {
        // committed again (to no effect) on the next start
      }
    });
  }

  /** Writes what is pending now (one transaction); resolves when everything started so far is written. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const db = this.db;
    if (db && this.pending.size) {
      const ops = [...this.pending.values()];
      this.pending.clear();
      const run = commit(db, ops).then(
        () => {
          if (!this.db) return;
          this.journalOff = false;
          this.saveJournal(JOURNAL_LIVE_MAX);
        },
        (e: unknown) => {
          // Not written: kept for the next write / quit (unless a newer change replaced it meanwhile).
          for (const op of ops) {
            const id = idOf(op.k);
            if (!this.pending.has(id) && (this.times.get(id) ?? 0) <= op.t) this.pending.set(id, op);
          }
          if (isQuota(e)) reportStorageFull();
        },
      );
      this.inflight.add(run);
      void run.finally(() => this.inflight.delete(run));
    }
    return Promise.all([...this.inflight]).then(() => undefined);
  }

  /**
   * The window goes away: the downgrade copy (the old key + its stamp, when it fits and nobody else wrote the key),
   * the journal of what is not written yet, the other windows told, and the last transaction started.
   */
  hide(): void {
    if (!this.db) return;
    const ls = this.ls();
    try {
      const raw = ls?.getItem(PANES_STORAGE_KEY) ?? null;
      const prev = ls?.getItem(PANES_STAMP_KEY) ?? null;
      const stamp = readStamp(ls);
      // Written by someone else since (neither this run's nor the stored stamp's): left for the next start to merge.
      const own = raw === null || stampOf(raw) === this.known || stampOf(raw) === stamp?.stamp;
      const text = JSON.stringify(this.file);
      const next = stampOf(text);
      if (ls && own && next !== stampOf(raw ?? "") && text.length <= (this.opts.mirrorMax ?? MIRROR_MAX)) {
        // The stamp first: when it does not fit, the copy is not written either. A copy that does not fit after it
        // puts the old stamp back (or none: the next start then merges conservatively).
        ls.setItem(PANES_STAMP_KEY, JSON.stringify({ stamp: next, t: this.lastT }));
        try {
          ls.setItem(PANES_STORAGE_KEY, text);
          this.known = next;
        } catch {
          try {
            if (prev === null) ls.removeItem(PANES_STAMP_KEY);
            else ls.setItem(PANES_STAMP_KEY, prev);
          } catch {
            ls.removeItem(PANES_STAMP_KEY);
          }
        }
      }
    } catch {
      // too big for what is left of localStorage: an older desktop finds the copy it last wrote
    }
    this.saveJournal();
    this.post({ type: "closing", ops: [...this.pending.values()], journal: this.journal });
    void this.flush();
  }

  /** Tests / teardown: stop listening and close the database (pending writes are dropped; flush first). */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const off of this.off.splice(0)) off();
    this.channel?.close();
    this.channel = null;
    this.db?.close();
    this.db = null;
    this.loading = null;
    this.pending.clear();
  }
}

/** The app's pane layout storage (lib/paneDbBoot loads it before the first render). */
export const paneDb = new PaneDb({ listen: true });
