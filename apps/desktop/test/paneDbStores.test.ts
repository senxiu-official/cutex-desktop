// @vitest-environment jsdom
// E-G10: the stores (lib/paneStore, lib/sideLayoutStore) on the IndexedDB file (lib/paneDb): the migrations run on
// the copy, a conversation's Shelf comes back after a restart from IndexedDB, and the old localStorage key is only
// written as the downgrade copy on quit.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { SideBinding } from "../src/renderer/src/modules/slots";
import type { ItemId } from "../src/renderer/src/modules/types";
import { applyOpen, emptyLayout, place, placeSpec, SINGLETON_KEY, type SideLayout } from "../src/renderer/src/lib/sideLayout";
import { defaultLayout, joinLayout, toolPartOf } from "../src/renderer/src/lib/paneLayout";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

let clock = 100;
function open(l: SideLayout, kind: string, binding: SideBinding, home: string): { layout: SideLayout; id: string } {
  const input = { kind: kind as ItemId, binding, key: SINGLETON_KEY, state: { k: kind } as never, v: 1, pinned: false };
  const decision = place(l, { ...input, transient: false, activePage: l.activePage, columnOpen: l.open }, placeSpec({ home }));
  const applied = applyOpen(l, decision, input, ++clock, { reveal: true, home });
  return { layout: applied.layout, id: applied.instanceId };
}
const follow: SideBinding = { kind: "follow", hostId: "local" };

describe("the stores on IndexedDB", { timeout: 20_000 }, () => {
  let storage: Map<string, string>;
  let factory: IDBFactory;
  beforeEach(() => {
    storage = new Map();
    factory = new IDBFactory();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k), get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i] ?? null });
    vi.stubGlobal("indexedDB", factory);
  });

  /** A start of the app: fresh modules, the file loaded before the stores start. */
  async function boot(selected: string | null) {
    vi.resetModules();
    const { paneDb } = await import("../src/renderer/src/lib/paneDb");
    expect(await paneDb.load()).toBe(true);
    const { useApp } = await import("../src/renderer/src/store");
    const side = await import("../src/renderer/src/lib/sideLayoutStore");
    const file = await import("../src/renderer/src/lib/paneFile");
    useApp.setState({ selectedId: selected, selectedHost: "local" });
    const stop = side.startSideStore(() => () => {});
    /** The window closes: the stores' last saves (beforeunload), then pagehide. */
    const quit = async () => {
      side.flushSideSave();
      stop();
      paneDb.hide();
      await paneDb.flush();
      paneDb.close();
    };
    return { paneDb, useApp, side, file, quit };
  }

  it("migrates a v4 file in IndexedDB; the old key keeps the v4 file until quit writes the downgrade copy", async () => {
    const tools = open(emptyLayout(), "workspace.files", follow, "files").layout;
    const work = defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
    const v4 = JSON.stringify({ v: 4, layouts: { "host:local": joinLayout(work, toolPartOf(tools)) }, singleShelf: false });
    storage.set("cutex-desktop.panes", v4);
    const { side, file, quit } = await boot(null);
    expect(file.readPanesFile().v).toBe(5);
    expect(side.liveConversation()).toBe("local|a1");
    expect(storage.get("cutex-desktop.panes")).toBe(v4);
    await quit();
    const copy = JSON.parse(storage.get("cutex-desktop.panes")!);
    expect(copy.v).toBe(5);
    expect(Object.keys(copy.convShelves["host:local"].conv)).toEqual(["local|a1"]);
  });

  it("a conversation's Shelf comes back after a restart, read from IndexedDB", async () => {
    const first = await boot("A");
    let files = "";
    first.side.updateLayout((l) => {
      const r = open(l, "workspace.files", follow, "files");
      files = r.id;
      return r.layout;
    });
    first.useApp.setState({ selectedId: "B" });
    await first.quit();
    // the old key is not read again: drop it to be sure the Shelf comes from IndexedDB
    storage.delete("cutex-desktop.panes");
    const second = await boot("A");
    expect(second.side.useSide.getState().layout.instances[files]?.kind).toBe("workspace.files");
    expect(second.file.singleShelfDefault()).toBe(true);
    await second.quit();
  });

  it("a new install (nothing stored): 只用一个 Shelf on", async () => {
    const { file, quit } = await boot(null);
    expect(file.singleShelfDefault()).toBe(true);
    await quit();
  });
});
