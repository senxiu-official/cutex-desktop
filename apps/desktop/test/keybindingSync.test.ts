// 快捷键方案 in settings sync (lib/keybindingSync + lib/settingsSync engine against a fake memory host): the category is
// registered with the built-ins' engine, a device's synced schemes and deliberate switch reach another device, a scheme
// marked 「不同步」 never leaves its device, the category switched off on a device syncs nothing either way, and the
// 已同步 marker (setKeybindingSyncOn) follows the engine's on / adopted state.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSettingsSync, type SyncBackend } from "../src/renderer/src/lib/settingsSync/engine";
import { sectionOf, type SyncDoc } from "../src/renderer/src/lib/settingsSync/model";
import { syncCategory } from "../src/renderer/src/lib/settingsSync/registry";
import { categoryFollowed, IDLE_SYNC_STATE, useSettingsSync } from "../src/renderer/src/lib/settingsSync/view";
import type { LayoutHost } from "../src/renderer/src/lib/userLayoutModel";
import { BUILTIN_SCHEME_ID, emptyLibrary, type SchemeLibrary } from "../src/renderer/src/lib/keybindingSchemes";
import { createScheme, deleteScheme, keybindingSyncOn, resetSchemesForTests, schemeLibrary, setSchemeSync, switchScheme } from "../src/renderer/src/lib/keybindingSchemeStore";
import { KEYBINDING_SYNC_ID, keybindingSyncCategory, startKeybindingSync } from "../src/renderer/src/lib/keybindingSync";
import { bindingsOf, setBindings, setKeybindingPlatform } from "../src/renderer/src/lib/keybindings";

const MEMORY = { instanceId: `ci-${"a".repeat(32)}`, label: "EVA" };
const host: LayoutHost = { id: "local", instanceId: MEMORY.instanceId, label: "EVA", online: true, supported: true, eligible: true, known: true };
const SECTION = sectionOf(KEYBINDING_SYNC_ID);

function fakeHost() {
  const sections = new Map<string, { revision: number; data: SyncDoc }>();
  const backend: SyncBackend = {
    async get() {
      return { ok: true, value: { docKey: "owner", userId: "owner", displayName: "Sam", ownerPersonConfirmed: true, pointer: null, sections: Object.fromEntries([...sections].map(([k, v]) => [k, { revision: v.revision, data: v.data, updatedAt: null, updatedBy: null }])) } };
    },
    async put(section, revision, data) {
      const cur = sections.get(section) ?? { revision: 0, data: { fields: {} } };
      if (cur.revision !== revision) return { ok: false, error: { code: "layout_revision_conflict", message: "Changed" } };
      sections.set(section, { revision: revision + 1, data: structuredClone(data) });
      return { ok: true, value: { revision: revision + 1, updatedAt: null } };
    },
  };
  const values = () => Object.fromEntries(Object.entries(sections.get(SECTION)?.data.fields ?? {}).map(([k, f]) => [k, f.v]));
  return { backend, sections, values };
}

/** One device: its own library and sync storage, against the shared host. */
function device(h: ReturnType<typeof fakeHost>, lib: SchemeLibrary, on?: boolean) {
  const data = new Map<string, string>();
  if (on !== undefined) data.set("cutex-desktop.settingsSync.v1", JSON.stringify({ on: { [KEYBINDING_SYNC_ID]: on }, docs: {}, lastSync: {} }));
  let t = 1000;
  let state = lib;
  return {
    async run(edit?: () => void) {
      resetSchemesForTests(state);
      const store = createSettingsSync({ storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }, backend: () => h.backend, categories: () => [keybindingSyncCategory], now: () => (t += 10) });
      store.setMemory(MEMORY, [host]);
      await store.refresh();
      await store.refresh();
      if (edit) {
        edit();
        store.check();
        await store.refresh();
      }
      const view = store.state.getState();
      state = schemeLibrary();
      store.dispose();
      return view;
    },
    get lib() { return state; },
  };
}

beforeEach(() => {
  setKeybindingPlatform("windows");
  resetSchemesForTests();
});
afterEach(() => {
  setKeybindingPlatform(null);
  resetSchemesForTests();
  useSettingsSync.setState(IDLE_SYNC_STATE, true);
});

describe("快捷键方案 in settings sync", () => {
  it("is a registered category on 快捷键, on by default, and the 已同步 marker follows the engine", () => {
    const stop = startKeybindingSync();
    try {
      expect(syncCategory(KEYBINDING_SYNC_ID)).toBe(keybindingSyncCategory);
      expect(keybindingSyncCategory).toMatchObject({ defaultOn: true, pages: ["shortcuts"] });
      expect(keybindingSyncOn()).toBe(false);
      const view = (on: boolean, adopted: boolean) => ({ on, adopted, synced: {}, local: {}, differs: false });
      useSettingsSync.setState({ ...IDLE_SYNC_STATE, status: "synced", categories: { [KEYBINDING_SYNC_ID]: view(true, true) } }, true);
      expect(keybindingSyncOn()).toBe(true);
      // Switched off on this device, or waiting for 「保留哪一份？」, or no memory host: not synced.
      useSettingsSync.setState({ ...IDLE_SYNC_STATE, status: "synced", categories: { [KEYBINDING_SYNC_ID]: view(false, true) } }, true);
      expect(keybindingSyncOn()).toBe(false);
      useSettingsSync.setState({ ...IDLE_SYNC_STATE, status: "synced", categories: { [KEYBINDING_SYNC_ID]: view(true, false) } }, true);
      expect(keybindingSyncOn()).toBe(false);
      useSettingsSync.setState({ ...IDLE_SYNC_STATE, status: "noHost", categories: { [KEYBINDING_SYNC_ID]: view(true, true) } }, true);
      expect(keybindingSyncOn()).toBe(false);
      expect(categoryFollowed({ ...IDLE_SYNC_STATE, status: "offline", categories: { [KEYBINDING_SYNC_ID]: view(true, true) } }, KEYBINDING_SYNC_ID)).toBe(true);
    } finally {
      stop();
    }
    expect(syncCategory(KEYBINDING_SYNC_ID)).toBeUndefined();
    expect(keybindingSyncOn()).toBe(false);
  });

  it("a scheme and a deliberate switch reach the other device; a 「不同步」 scheme stays where it is", async () => {
    const h = fakeHost();
    const a = device(h, emptyLibrary());
    let work = "";
    let mine = "";
    await a.run(() => {
      work = createScheme("Work")!;
      setBindings("sidebar", ["Mod+Backslash"]);
      mine = createScheme("Private")!;
      setSchemeSync(mine, false);
      switchScheme(work);
    });
    const synced = h.values();
    // 「不同步」 after it was sent: the other devices are told to drop it; its content never stays up there.
    expect(Object.keys(synced).sort()).toEqual(["active", `scheme:${mine}`, `scheme:${work}`].sort());
    expect(synced[`scheme:${mine}`]).toBeNull();
    expect(synced.active).toBe(work);

    const b = device(h, emptyLibrary());
    await b.run();
    expect(b.lib.schemes.map((s) => s.name)).toEqual(["Work"]);
    // On its own device the 「不同步」 scheme stays.
    expect(a.lib.schemes.find((s) => s.id === mine)).toMatchObject({ name: "Private", sync: false });
    expect(b.lib.active).toBe(work);
    resetSchemesForTests(b.lib);
    expect(bindingsOf("sidebar")).toEqual(["Mod+Backslash"]);
  });

  it("with the category off on a device, nothing goes up or comes down; on again, the scheme flag decides", async () => {
    const h = fakeHost();
    const a = device(h, emptyLibrary());
    let work = "";
    await a.run(() => {
      work = createScheme("Work")!;
    });
    expect(Object.keys(h.values())).toContain(`scheme:${work}`);

    const off = device(h, emptyLibrary(), false);
    let local = "";
    const view = await off.run(() => {
      local = createScheme("Laptop only?")!;
    });
    expect(view.categories[KEYBINDING_SYNC_ID]?.on).toBe(false);
    expect(Object.keys(h.values())).not.toContain(`scheme:${local}`);
    expect(off.lib.schemes.map((s) => s.id)).toEqual([local]);
    expect(off.lib.active).toBe(local);
  });

  it("deleting a synced scheme on one device removes it on the other", async () => {
    const h = fakeHost();
    const a = device(h, emptyLibrary());
    let work = "";
    await a.run(() => {
      work = createScheme("Work")!;
    });
    const b = device(h, emptyLibrary());
    await b.run();
    expect(b.lib.schemes.map((s) => s.id)).toEqual([work]);
    await a.run(() => deleteScheme(work));
    expect(h.values()[`scheme:${work}`]).toBeNull();
    await b.run();
    expect(b.lib.schemes).toEqual([]);
    expect(b.lib.active).toBe(BUILTIN_SCHEME_ID);
  });
});
