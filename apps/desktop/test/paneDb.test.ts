// @vitest-environment jsdom
// E-G10 (owner approved 2026-10-24): the pane layout file lives in IndexedDB, one record per piece (lib/paneDb).
// First start copies the old localStorage key (verified, the old key kept); writes store only what changed; quit keeps
// the last change (journal) and the downgrade copy; a newer old key (an older desktop wrote it) is read in again;
// windows hear each other; no IndexedDB = localStorage as before.
import { afterEach, beforeEach, describe, expect, it, it as itAll, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { PaneDb, PANES_JOURNAL_PREFIX, PANES_STAMP_KEY, PANES_STORAGE_KEY, parsePanesFile, type PaneDbOptions, type PanesFile } from "../src/renderer/src/lib/paneDb";
import { resetStorageFullNotice, setStorageFullNotifier } from "../src/renderer/src/lib/storageFull";

const part = (tag: string, size = 0) => ({ shelves: [{ id: tag, pages: [] }], panes: {}, instances: {}, tools: { seq: 1 }, ...(size ? { blob: "x".repeat(size) } : {}) });
const sample = (): PanesFile => ({
  v: 5,
  layouts: { "host:local": { v: 2, tag: "work-local" }, "host:remote": { v: 2, tag: "work-remote" } },
  convShelves: {
    "host:local": { template: part("tpl") as never, shared: null, conv: { "local|a": { part: part("a") as never, meta: {}, at: 1 }, "local|b": { part: part("b") as never, meta: {}, at: 2 } } },
  },
});

let factory: IDBFactory;
const open: PaneDb[] = [];
const make = (opts: PaneDbOptions = {}, Kind: typeof PaneDb = PaneDb) => {
  const db = new Kind({ indexedDB: factory, channel: null, ...opts });
  open.push(db);
  return db;
};
/** A window that goes away before its last transaction commits. */
class Dying extends PaneDb {
  override flush(): Promise<void> {
    return Promise.resolve();
  }
}
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(ok()).toBe(true);
};
async function records(): Promise<Map<string, { t: number; v: unknown }>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open("cutex-desktop-panes", 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = db.transaction("records", "readonly");
  const keys = tx.objectStore("records").getAllKeys();
  const values = tx.objectStore("records").getAll();
  await new Promise((r) => (tx.oncomplete = r));
  db.close();
  return new Map(keys.result.map((k, i) => [(k as string[]).join("/"), values.result[i] as { t: number; v: unknown }]));
}

const journals = () => Object.keys(localStorage).filter((k) => k.startsWith(PANES_JOURNAL_PREFIX));
/** Puts a record straight into the database (another window's write). */
async function putRaw(key: string[], rec: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open("cutex-desktop-panes", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("records");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = db.transaction("records", "readwrite");
  tx.objectStore("records").put(rec, key);
  await new Promise((r) => (tx.oncomplete = r));
  db.close();
}
const bind = <T extends object>(t: T, p: string | symbol) => {
  const v = Reflect.get(t, p) as unknown;
  return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
};
/** A database whose read-write transactions never report completion (a stalled IndexedDB). */
function stalled(f: IDBFactory): IDBFactory {
  const tx = (t: IDBTransaction) => new Proxy(t, { get: bind, set: (o, p, v) => (p === "oncomplete" ? true : Reflect.set(o, p, v)) });
  const db = (d: IDBDatabase) =>
    new Proxy(d, {
      get: (o, p) => (p === "transaction" ? (s: string, m?: IDBTransactionMode) => (m === "readwrite" ? tx(o.transaction(s, m)) : o.transaction(s, m)) : bind(o, p)),
      set: (o, p, v) => Reflect.set(o, p, v),
    });
  return { open: (name: string, v?: number) => new Proxy(f.open(name, v), { get: (o, p) => (p === "result" ? db(o.result) : bind(o, p)), set: (o, p, v) => Reflect.set(o, p, v) }) } as unknown as IDBFactory;
}

beforeEach(() => {
  factory = new IDBFactory();
  localStorage.clear();
  resetStorageFullNotice();
});
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  vi.restoreAllMocks();
  setStorageFullNotifier(null);
});

describe("first start", () => {
  it("copies the old key in, one record per piece, and keeps the old key as it was", async () => {
    const raw = JSON.stringify(sample());
    localStorage.setItem(PANES_STORAGE_KEY, raw);
    const db = make();
    expect(await db.load()).toBe(true);
    expect(db.active).toBe(true);
    expect(db.hadStored).toBe(true);
    expect(db.read()).toEqual(sample());
    expect(localStorage.getItem(PANES_STORAGE_KEY)).toBe(raw);
    expect([...(await records()).keys()].sort()).toEqual(["conv/host:local/local|a", "conv/host:local/local|b", "layout/host:local", "layout/host:remote", "meta", "scope/host:local"]);
  });

  it("nothing stored anywhere: a new install (empty v1 file)", async () => {
    const db = make();
    await db.load();
    expect(db.hadStored).toBe(false);
    expect(db.read()).toEqual({ v: 1, layouts: {} });
  });

  it("no IndexedDB: not active (lib/paneFile keeps localStorage)", async () => {
    const db = make({ indexedDB: null });
    expect(await db.load()).toBe(false);
    expect(db.active).toBe(false);
  });
});

describe("writes", () => {
  it("store only the records that changed, in one transaction, and survive a restart", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    const db = make();
    await db.load();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const file = db.read();
    const scope = file.convShelves!["host:local"]!;
    // what lib/paneFile does: copy the containers, replace one record
    db.write({ ...file, convShelves: { ...file.convShelves, "host:local": { ...scope, conv: { ...scope.conv, "local|b": { part: part("b2") as never, meta: {}, at: 3 } } } } });
    db.write({ ...db.read(), layouts: { ...db.read().layouts, "host:remote": { v: 2, tag: "moved" } } });
    await db.flush();
    expect(setItem.mock.calls.filter(([k]) => k === PANES_STORAGE_KEY)).toEqual([]);
    const recs = await records();
    const changed = [...recs].filter(([, r]) => r.t > 0).map(([k]) => k).sort();
    expect(changed).toEqual(["conv/host:local/local|b", "layout/host:remote"]);
    db.close();
    const again = make();
    await again.load();
    expect(again.read().layouts["host:remote"]).toEqual({ v: 2, tag: "moved" });
    expect(again.read().convShelves!["host:local"]!.conv["local|b"]!.at).toBe(3);
  });

  it("drop the records of removed conversations / scopes", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    const db = make();
    await db.load();
    const file = db.read();
    const scope = file.convShelves!["host:local"]!;
    const conv = { ...scope.conv };
    delete conv["local|a"];
    const layouts = { ...file.layouts };
    delete layouts["host:remote"];
    db.write({ ...file, layouts, convShelves: { "host:local": { ...scope, conv } } });
    await db.flush();
    // tombstones, so an older write can not bring them back
    const recs = await records();
    expect(recs.get("conv/host:local/local|a")).toMatchObject({ del: true });
    expect(recs.get("layout/host:remote")).toMatchObject({ del: true });
    expect(recs.get("conv/host:local/local|b")).not.toHaveProperty("del");
    db.close();
    const again = make();
    await again.load();
    expect(again.read().layouts["host:remote"]).toBeUndefined();
    expect(again.read().convShelves!["host:local"]!.conv["local|a"]).toBeUndefined();
  });

  it("a layout far beyond the localStorage quota is stored (no storage-full notice)", async () => {
    const told = vi.fn();
    setStorageFullNotifier(told);
    const db = make();
    await db.load();
    // localStorage would refuse anything over 1 MB
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (v.length > 1_000_000) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    const conv: Record<string, never> = {};
    for (let i = 0; i < 120; i++) conv[`local|s${i}`] = { part: part(`s${i}`, 40_000), meta: {}, at: i } as never;
    db.write({ v: 5, layouts: {}, convShelves: { "host:local": { template: null, shared: null, conv } } });
    await db.flush();
    db.hide(); // the downgrade copy does not fit: skipped quietly
    await db.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(told).not.toHaveBeenCalled();
    db.close();
    const again = make();
    await again.load();
    expect(Object.keys(again.read().convShelves!["host:local"]!.conv)).toHaveLength(120);
  });
});

describe("quit", () => {
  it("the last change is kept when the window goes before its transaction commits (journal)", async () => {
    const db = make({ mirrorMax: 0 }, Dying);
    await db.load();
    db.write({ v: 5, layouts: { "host:local": { v: 2, tag: "last" } } });
    db.hide();
    expect(JSON.parse(localStorage.getItem(journals()[0]!)!)).toHaveLength(2);
    db.close();
    const again = make();
    await again.load();
    expect(again.read()).toEqual({ v: 5, layouts: { "host:local": { v: 2, tag: "last" } } });
    expect(journals()).toEqual([]);
    expect((await records()).get("layout/host:local")!.v).toEqual({ v: 2, tag: "last" });
  });

  it("the downgrade copy: the old key holds the newest file an older desktop can read", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    const db = make();
    await db.load();
    db.write({ ...db.read(), layouts: { ...db.read().layouts, "host:local": { v: 2, tag: "after-upgrade" } } });
    db.hide();
    await db.flush();
    expect(parsePanesFile(localStorage.getItem(PANES_STORAGE_KEY)).layouts["host:local"]).toEqual({ v: 2, tag: "after-upgrade" });
    db.close();
    // the next start: the copy is ours (stamp matches), IndexedDB stays the source
    const again = make();
    await again.load();
    expect(again.read().layouts["host:local"]).toEqual({ v: 2, tag: "after-upgrade" });
  });

  it("the copy was written but not the last transaction: the journal brings the change back", async () => {
    const db = make({}, Dying);
    await db.load();
    db.write({ v: 5, layouts: { "host:local": { v: 2, tag: "only-in-copy" } } });
    db.hide();
    db.close();
    const again = make();
    await again.load();
    expect(again.read().layouts["host:local"]).toEqual({ v: 2, tag: "only-in-copy" });
  });

  it("an older desktop wrote the old key since: its changes are merged in", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    const db = make();
    await db.load();
    db.hide();
    await db.flush();
    db.close();
    // downgraded: the old build reads the key, changes a layout, writes the whole file back
    const old = parsePanesFile(localStorage.getItem(PANES_STORAGE_KEY));
    old.layouts["host:local"] = { v: 2, tag: "from-old-build" };
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(old));
    const again = make();
    await again.load();
    expect(again.read().layouts["host:local"]).toEqual({ v: 2, tag: "from-old-build" });
    expect(again.read().layouts["host:remote"]).toEqual({ v: 2, tag: "work-remote" });
  });
});

describe("windows", () => {
  const channel = () => `panes-test-${Math.random()}`;

  const it = typeof BroadcastChannel === "undefined" ? itAll.skip : itAll;
  it("hear each other's changes; a read-modify-write keeps the other window's", async () => {
    const ch = channel();
    const a = make({ channel: ch });
    const b = make({ channel: ch });
    await a.load();
    await b.load();
    a.write({ ...a.read(), v: 5, layouts: { ...a.read().layouts, "host:local": { v: 2, tag: "from-a" } } });
    await until(() => (b.read().layouts["host:local"] as { tag?: string } | undefined)?.tag === "from-a");
    b.write({ ...b.read(), layouts: { ...b.read().layouts, "host:remote": { v: 2, tag: "from-b" } } });
    await until(() => !!a.read().layouts["host:remote"]);
    await a.flush();
    await b.flush();
    const c = make();
    await c.load();
    expect(c.read().layouts).toEqual({ "host:local": { v: 2, tag: "from-a" }, "host:remote": { v: 2, tag: "from-b" } });
  });

  it("the same record written by two windows ends on the newer change", async () => {
    const ch = channel();
    const a = make({ channel: ch });
    const b = make({ channel: ch });
    await a.load();
    await b.load();
    a.write({ v: 5, layouts: { "host:local": { v: 2, tag: "older" } } });
    await new Promise((r) => setTimeout(r, 2));
    b.write({ v: 5, layouts: { "host:local": { v: 2, tag: "newer" } } });
    // b's transaction first, a's (older) after it: the record keeps the newer change
    await b.flush();
    await a.flush();
    await until(() => (a.read().layouts["host:local"] as { tag: string }).tag === "newer");
    expect((await records()).get("layout/host:local")!.v).toEqual({ v: 2, tag: "newer" });
  });

  it("a window closing before its transaction commits: the other one writes its change", async () => {
    const ch = channel();
    const a = make({ channel: ch, mirrorMax: 0 }, Dying);
    const b = make({ channel: ch });
    await a.load();
    await b.load();
    a.write({ v: 5, layouts: { "host:local": { v: 2, tag: "closing" } } });
    a.hide();
    a.close();
    await until(() => journals().length === 0);
    await b.flush();
    expect((await records()).get("layout/host:local")!.v).toEqual({ v: 2, tag: "closing" });
  });
});

describe("review fixes (deadline, merge, tombstones, live journal)", () => {
  it("a stalled transaction: the load gives up at its deadline and stays off (this run uses localStorage)", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    const db = make({ indexedDB: stalled(factory) });
    const t0 = Date.now();
    expect(await db.load(150)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
    await new Promise((r) => setTimeout(r, 50));
    expect(db.active).toBe(false);
  });

  it("a run without IndexedDB on a stale old key does not trample newer IndexedDB records", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    const a = make({ mirrorMax: 0 }); // the downgrade copy never fits: the old key stays stale
    await a.load();
    a.write({ ...a.read(), layouts: { ...a.read().layouts, "host:local": { v: 2, tag: "newer-in-idb" } } });
    a.hide();
    await a.flush();
    a.close();
    expect(parsePanesFile(localStorage.getItem(PANES_STORAGE_KEY)).layouts["host:local"]).toEqual({ v: 2, tag: "work-local" });
    // the fallback run (lib/paneFile's localStorage path): reads the stale key, changes another scope, writes it whole
    const stale = parsePanesFile(localStorage.getItem(PANES_STORAGE_KEY));
    stale.layouts["host:remote"] = { v: 2, tag: "fallback-edit" };
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(stale));
    const b = make();
    await b.load();
    expect(b.read().layouts["host:local"]).toEqual({ v: 2, tag: "newer-in-idb" });
    expect(b.read().layouts["host:remote"]).toEqual({ v: 2, tag: "fallback-edit" });
  });

  it("a foreign write of the old key never clears what a live window committed after the copy", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    const a = make();
    await a.load();
    a.hide(); // the copy + its stamp, together
    await a.flush();
    a.close();
    expect(localStorage.getItem(PANES_STAMP_KEY)).not.toBeNull();
    const b = make(); // stays open
    await b.load();
    b.write({ ...b.read(), layouts: { ...b.read().layouts, "host:remote": { v: 2, tag: "b-live" } } });
    await b.flush();
    // an older desktop writes the key it read (A's copy) with its own change
    const old = parsePanesFile(localStorage.getItem(PANES_STORAGE_KEY));
    old.layouts["host:local"] = { v: 2, tag: "older-desktop" };
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(old));
    // B quits meanwhile: it leaves the foreign key alone (the next start merges it)
    b.hide();
    await b.flush();
    expect(parsePanesFile(localStorage.getItem(PANES_STORAGE_KEY)).layouts["host:local"]).toEqual({ v: 2, tag: "older-desktop" });
    const c = make();
    await c.load();
    expect(c.read().layouts["host:remote"]).toEqual({ v: 2, tag: "b-live" });
    expect(c.read().layouts["host:local"]).toEqual({ v: 2, tag: "older-desktop" });
    expect(c.read().convShelves!["host:local"]!.conv["local|a"]).toBeTruthy();
  });

  it("first start: a record another window wrote before the copy landed stays", async () => {
    await putRaw(["layout", "host:local"], { t: Date.now(), v: { v: 2, tag: "other-window" } });
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    const db = make();
    await db.load();
    expect(db.read().layouts["host:local"]).toEqual({ v: 2, tag: "other-window" });
    expect(db.read().layouts["host:remote"]).toEqual({ v: 2, tag: "work-remote" });
  });

  it("a deleted Shelf stays deleted: a stale journal entry does not bring it back (tombstone); old tombstones go", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    await putRaw(["conv", "host:x", "x|old"], { t: 1, del: true });
    const db = make();
    await db.load();
    expect([...(await records()).keys()]).not.toContain("conv/host:x/x|old");
    const file = db.read();
    const scope = file.convShelves!["host:local"]!;
    const conv = { ...scope.conv };
    delete conv["local|a"];
    db.write({ ...file, convShelves: { "host:local": { ...scope, conv } } });
    await db.flush();
    expect((await records()).get("conv/host:local/local|a")).toMatchObject({ del: true });
    db.close();
    // a crashed window's older write of it
    localStorage.setItem(`${PANES_JOURNAL_PREFIX}.crashed`, JSON.stringify([{ k: ["conv", "host:local", "local|a"], t: 5, v: { part: part("a"), meta: {}, at: 1 } }]));
    const again = make();
    await again.load();
    expect(again.read().convShelves!["host:local"]!.conv["local|a"]).toBeUndefined();
    expect(journals()).toEqual([]);
  });

  it("a crash before the transaction (no pagehide): the live journal brings the change back", async () => {
    const db = make({}, Dying);
    await db.load();
    db.write({ v: 5, layouts: { "host:local": { v: 2, tag: "crash" } } });
    expect(journals()).toHaveLength(1);
    db.close();
    const again = make();
    await again.load();
    expect(again.read().layouts["host:local"]).toEqual({ v: 2, tag: "crash" });
  });

  it("the journal is dropped once the write is committed", async () => {
    const db = make();
    await db.load();
    db.write({ v: 5, layouts: { "host:local": { v: 2, tag: "x" } } });
    expect(journals()).toHaveLength(1);
    await db.flush();
    expect(journals()).toEqual([]);
  });
});

/** Open requests answer `ms` late. */
function slowOpen(f: IDBFactory, ms: number): IDBFactory {
  return { open: (name: string, v?: number) => new Proxy(f.open(name, v), { get: bind, set: (o, p, h) => Reflect.set(o, p, p === "onsuccess" ? (e: Event) => setTimeout(() => (h as (e: Event) => void)(e), ms) : h) }) } as unknown as IDBFactory;
}
/** Read-write transactions report completion `ms` late (they commit on time). */
function slowCommit(f: IDBFactory, ms: number): IDBFactory {
  const tx = (t: IDBTransaction) => new Proxy(t, { get: bind, set: (o, p, h) => Reflect.set(o, p, p === "oncomplete" ? (e: Event) => setTimeout(() => (h as (e: Event) => void)(e), ms) : h) });
  const db = (d: IDBDatabase) => new Proxy(d, { get: (o, p) => (p === "transaction" ? (s: string, m?: IDBTransactionMode) => (m === "readwrite" ? tx(o.transaction(s, m)) : o.transaction(s, m)) : bind(o, p)), set: (o, p, v) => Reflect.set(o, p, v) });
  return { open: (name: string, v?: number) => new Proxy(f.open(name, v), { get: (o, p) => (p === "result" ? db(o.result) : bind(o, p)), set: (o, p, v) => Reflect.set(o, p, v) }) } as unknown as IDBFactory;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("second review (late loads, no stamp)", () => {
  it("a load past its deadline writes nothing more to IndexedDB", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    const db = make({ indexedDB: slowOpen(factory, 200) });
    expect(await db.load(50)).toBe(false);
    await sleep(350);
    expect((await records()).size).toBe(0);
    // the localStorage run's edit is what the next start copies in
    const run = parsePanesFile(localStorage.getItem(PANES_STORAGE_KEY));
    run.layouts["host:local"] = { v: 2, tag: "fallback-edit" };
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(run));
    const again = make();
    await again.load();
    expect(again.read().layouts["host:local"]).toEqual({ v: 2, tag: "fallback-edit" });
  });

  it("a copy committed after the deadline is stamped: the localStorage run's edits merge in on the next start", async () => {
    const raw = JSON.stringify(sample());
    localStorage.setItem(PANES_STORAGE_KEY, raw);
    const db = make({ indexedDB: slowCommit(factory, 200) });
    expect(await db.load(100)).toBe(false);
    await sleep(400);
    expect((await records()).has("meta")).toBe(true);
    expect(JSON.parse(localStorage.getItem(PANES_STAMP_KEY)!)).toMatchObject({ t: 0 });
    const run = parsePanesFile(localStorage.getItem(PANES_STORAGE_KEY));
    run.layouts["host:local"] = { v: 2, tag: "fallback-edit" };
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(run));
    const again = make();
    await again.load();
    expect(again.read().layouts["host:local"]).toEqual({ v: 2, tag: "fallback-edit" });
  });

  it("no stamp can be written: deleted pieces are not re-added, tombstones are kept, the copy is not refreshed", async () => {
    localStorage.setItem(PANES_STORAGE_KEY, JSON.stringify(sample()));
    await putRaw(["conv", "host:x", "x|old"], { t: 1, del: true });
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === PANES_STAMP_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    const a = make();
    await a.load();
    expect((await records()).has("conv/host:x/x|old")).toBe(true); // not pruned without a stamp
    const file = a.read();
    const scope = file.convShelves!["host:local"]!;
    const conv = { ...scope.conv };
    delete conv["local|a"];
    a.write({ ...file, convShelves: { "host:local": { ...scope, conv } } });
    await a.flush();
    a.hide();
    await a.flush();
    a.close();
    // the stamp did not fit, so neither did the copy: the old key still has the deleted Shelf
    expect(parsePanesFile(localStorage.getItem(PANES_STORAGE_KEY)).convShelves!["host:local"]!.conv["local|a"]).toBeTruthy();
    expect(localStorage.getItem(PANES_STAMP_KEY)).toBeNull();
    // every later start sees an unstamped old key: merged conservatively, the deleted Shelf stays deleted
    for (let i = 0; i < 2; i++) {
      const b = make();
      await b.load();
      expect(b.read().convShelves!["host:local"]!.conv["local|a"]).toBeUndefined();
      expect(b.read().convShelves!["host:local"]!.conv["local|b"]).toBeTruthy();
      b.close();
    }
  });
});
