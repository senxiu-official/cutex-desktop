// Settings sync (design 056 §12): the engine against a fake memory host — first enable (push / adopt / ask),
// 用同步设置 / 用本机设置, this device's edits, offline queue, 409 replay with per-field last writer, per-device switches.
import { describe, expect, it } from "vitest";
import { createSettingsSync, SETTINGS_SYNC_KEY, storedSyncOn, type SyncBackend } from "../src/renderer/src/lib/settingsSync/engine";
import { applySyncOps, changedOps, differingKeys, readSyncDoc, sectionOf, type SyncDoc, type SyncValues } from "../src/renderer/src/lib/settingsSync/model";
import { registerSyncCategory, syncCategories, type SyncCategory } from "../src/renderer/src/lib/settingsSync/registry";
import type { LayoutHost } from "../src/renderer/src/lib/userLayoutModel";

const MEMORY = { instanceId: `ci-${"a".repeat(32)}`, label: "EVA" };
const host = (over: Partial<LayoutHost> = {}): LayoutHost => ({ id: "local", instanceId: MEMORY.instanceId, label: "EVA", online: true, supported: true, eligible: true, known: true, ...over });

function memoryStorage() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

/** A person document on one host: sections with revisions, 409 on a stale write. */
function fakeHost(docKey = "owner") {
  const sections = new Map<string, { revision: number; data: SyncDoc }>();
  const puts: { section: string; data: SyncDoc }[] = [];
  let conflictOnce: (() => void) | null = null;
  const backend: SyncBackend = {
    async get() {
      return { ok: true, value: { docKey, userId: docKey, displayName: "Sam", ownerPersonConfirmed: true, pointer: null, sections: Object.fromEntries([...sections].map(([k, v]) => [k, { revision: v.revision, data: v.data, updatedAt: null, updatedBy: null }])) } };
    },
    async put(section, revision, data) {
      if (conflictOnce) { const c = conflictOnce; conflictOnce = null; c(); }
      const cur = sections.get(section) ?? { revision: 0, data: { fields: {} } };
      if (cur.revision !== revision) return { ok: false, error: { code: "layout_revision_conflict", message: "Changed" } };
      sections.set(section, { revision: revision + 1, data: structuredClone(data) });
      puts.push({ section, data });
      return { ok: true, value: { revision: revision + 1, updatedAt: null } };
    },
  };
  return {
    backend, sections, puts,
    set(category: string, values: SyncValues, t = 1) {
      const cur = sections.get(sectionOf(category));
      sections.set(sectionOf(category), { revision: (cur?.revision ?? 0) + 1, data: { fields: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { v, t }])) } });
    },
    values: (category: string) => Object.fromEntries(Object.entries(sections.get(sectionOf(category))?.data.fields ?? {}).map(([k, f]) => [k, f.v])),
    conflictBeforeNextPut(f: () => void) { conflictOnce = f; },
  };
}

function category(id: string, values: SyncValues, over: Partial<SyncCategory> = {}) {
  const local = { ...values };
  const listeners = new Set<() => void>();
  const c: SyncCategory = {
    id, order: 1, titleKey: "settingsSync.cat.appearance", hintKey: "settingsSync.cat.appearance.hint", defaultOn: true, pages: [id],
    read: () => ({ ...local }),
    write: (v) => Object.assign(local, v),
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    summary: (v) => Object.entries(v).map(([k, x]) => `${k}=${String(x)}`).join(" "),
    ...over,
  };
  return { c, local, edit(v: SyncValues) { Object.assign(local, v); for (const l of listeners) l(); } };
}

async function setup(cats: SyncCategory[], h = fakeHost(), storage = memoryStorage(), hostOver: Partial<LayoutHost> = {}) {
  let t = 1000;
  const store = createSettingsSync({ storage, backend: () => h.backend, categories: () => cats, now: () => (t += 10) });
  store.setMemory(MEMORY, [host(hostOver)]);
  await store.refresh(); await store.refresh();
  return { store, h, storage };
}

describe("settings sync model", () => {
  it("keeps the newest writer per field and only real differences", () => {
    const doc = readSyncDoc({ fields: { theme: { v: "dark", t: 5 }, accent: { v: "blue", t: 9 } }, future: 1 });
    const next = applySyncOps(doc, [{ key: "theme", v: "light", t: 6 }, { key: "accent", v: "pink", t: 8 }]);
    expect(next.fields).toEqual({ theme: { v: "light", t: 6 }, accent: { v: "blue", t: 9 } });
    expect(next.future).toBe(1);
    expect(changedOps({ a: 1, b: [1] }, { a: 1, b: [2], c: 0 }, 3)).toEqual([{ key: "b", v: [2], t: 3 }, { key: "c", v: 0, t: 3 }]);
    expect(differingKeys({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })).toEqual(["b"]);
  });
});

describe("settings sync engine", () => {
  it("starts the synced settings from the first device and follows them when they are the same", async () => {
    const a = category("appearance", { theme: "dark" });
    const { h, store } = await setup([a.c]);
    expect(h.values("appearance")).toEqual({ theme: "dark" });
    expect(store.state.getState().categories.appearance).toMatchObject({ on: true, adopted: true, differs: false });
    // A second device with the same values follows without a question, and adds what only it has.
    const b = category("appearance", { theme: "dark", accent: "pink" });
    const second = await setup([b.c], h);
    expect(second.store.state.getState().ask).toEqual([]);
    expect(h.values("appearance")).toEqual({ theme: "dark", accent: "pink" });
  });

  it("asks once when this device differs, writes nothing until the answer, then takes the chosen side", async () => {
    const h = fakeHost();
    h.set("appearance", { theme: "dark", accent: "indigo" });
    const a = category("appearance", { theme: "light", accent: "blue" });
    const { store } = await setup([a.c], h);
    expect(store.state.getState().ask).toEqual(["appearance"]);
    expect(a.local).toEqual({ theme: "light", accent: "blue" });
    expect(h.puts).toEqual([]);
    store.useSynced("appearance");
    expect(a.local).toEqual({ theme: "dark", accent: "indigo" });
    expect(store.state.getState().ask).toEqual([]);

    const h2 = fakeHost();
    h2.set("appearance", { theme: "dark" });
    const b = category("appearance", { theme: "light" });
    const second = await setup([b.c], h2);
    second.store.pushLocal("appearance");
    await second.store.refresh();
    expect(h2.values("appearance")).toEqual({ theme: "light" });
    expect(b.local.theme).toBe("light");
  });

  it("sends this device's edits and takes another device's", async () => {
    const a = category("appearance", { theme: "dark", accent: "blue" });
    const { h, store } = await setup([a.c]);
    a.edit({ accent: "pink" });
    await store.refresh();
    expect(h.values("appearance")).toEqual({ theme: "dark", accent: "pink" });
    h.set("appearance", { theme: "light", accent: "pink" }, 99_999);
    store.invalidate("settings-appearance");
    await store.refresh();
    expect(a.local).toEqual({ theme: "light", accent: "pink" });
    // Taking synced values is not an edit of this device.
    store.check(); await store.refresh();
    expect(store.state.getState().pending).toBe(0);
  });

  it("queues edits while the memory host is offline and sends them once it is back", async () => {
    const a = category("appearance", { theme: "dark" });
    const { h, store } = await setup([a.c]);
    store.setMemory(MEMORY, [host({ online: false })]);
    a.edit({ theme: "light" });
    await store.refresh();
    expect(store.state.getState()).toMatchObject({ status: "offline", pending: 1 });
    expect(h.values("appearance")).toEqual({ theme: "dark" });
    store.setMemory(MEMORY, [host()]);
    await store.refresh(); await store.refresh();
    expect(h.values("appearance")).toEqual({ theme: "light" });
    expect(store.state.getState().pending).toBe(0);
  });

  it("replays its own fields on a conflict and keeps the other device's", async () => {
    const a = category("appearance", { theme: "dark", accent: "blue" });
    const { h, store } = await setup([a.c]);
    // The other device changed only the accent (its theme field keeps its old time).
    h.conflictBeforeNextPut(() => { const cur = h.sections.get(sectionOf("appearance"))!; h.sections.set(sectionOf("appearance"), { revision: cur.revision + 1, data: { fields: { ...cur.data.fields, accent: { v: "green", t: 50_000 } } } }); });
    a.edit({ theme: "light" });
    await store.refresh(); await store.refresh();
    expect(h.values("appearance")).toEqual({ theme: "light", accent: "green" });
    expect(a.local).toEqual({ theme: "light", accent: "green" });
  });

  it("leaves a category alone where this device turned it off, and asks again when it is turned back on", async () => {
    const h = fakeHost();
    const storage = memoryStorage();
    const a = category("scale", { zoom: 1 }, { defaultOn: false });
    const { store } = await setup([a.c], h, storage);
    expect(h.sections.size).toBe(0);
    h.set("scale", { zoom: 1.25 });
    await store.refresh();
    expect(a.local.zoom).toBe(1);
    expect(store.state.getState().categories.scale).toMatchObject({ on: false, differs: true });
    store.setOn("scale", true);
    await store.refresh();
    expect(store.state.getState().ask).toEqual(["scale"]);
    expect(storedSyncOn("scale", false, storage)).toBe(true);
    expect(JSON.parse(storage.data.get(SETTINGS_SYNC_KEY)!).on).toEqual({ scale: true });
  });

  it("is idle without a supported memory host", async () => {
    const a = category("appearance", { theme: "dark" });
    const { h, store } = await setup([a.c], fakeHost(), memoryStorage(), { supported: false });
    expect(store.state.getState().status).toBe("unsupported");
    expect(h.puts).toEqual([]);
  });

  it("never replays one person's edits into another person's document", async () => {
    const storage = memoryStorage();
    const a = category("appearance", { theme: "dark" });
    const first = await setup([a.c], fakeHost("owner"), storage);
    first.store.setMemory(MEMORY, [host({ online: false })]);
    a.edit({ theme: "light" });
    first.store.dispose();
    const other = fakeHost("owner~ab12");
    other.set("appearance", { theme: "dark" });
    const second = await setup([a.c], other, storage);
    expect(other.puts).toEqual([]);
    expect(second.store.state.getState().ask).toEqual(["appearance"]);
  });
});

describe("settings sync registry", () => {
  it("takes a feature's category once, with a section-safe id", () => {
    const k = category("keybindings", {});
    const off = registerSyncCategory(k.c);
    expect(syncCategories().map((c) => c.id)).toContain("keybindings");
    expect(() => registerSyncCategory(k.c)).toThrow();
    expect(() => registerSyncCategory({ ...k.c, id: "Bad Id" })).toThrow();
    off();
    expect(syncCategories().map((c) => c.id)).not.toContain("keybindings");
  });
});
