// 桌面: the home document store (modules/home/store.ts) — optimistic edits, the revision check
// (409 home_revision_conflict → reload + re-apply), the device-local fallback without `user-home`.
import { describe, expect, it } from "vitest";
import { createHomeStore, type HomeBackend } from "../src/renderer/src/modules/home/store";
import type { HomeDoc, HomeResult, HomeView } from "../src/shared/home";
import { withPin, withPinToggled } from "../src/renderer/src/modules/home/model";

/** A host keeping one document with a revision, like cutex. `other()` = another device writes. */
function fakeHost(initial: HomeDoc = {}) {
  let revision = 1;
  let home: HomeDoc = initial;
  const puts: number[] = [];
  const view = (): HomeView => ({ revision, home, coverEtag: null, updatedAt: null });
  const backend: HomeBackend = {
    get: async () => ({ ok: true, value: view() }),
    put: async (rev, next): Promise<HomeResult<HomeView>> => {
      puts.push(rev);
      if (rev !== revision) return { ok: false, error: { code: "home_revision_conflict", message: "changed", revision } };
      if (JSON.stringify(next) !== JSON.stringify(home)) revision++;
      home = next ?? {};
      return { ok: true, value: view() };
    },
  };
  return { backend, puts, other: (edit: (d: HomeDoc) => HomeDoc) => ((home = edit(home)), revision++), doc: () => home, rev: () => revision };
}

const memory = () => {
  let doc: HomeDoc | null = null;
  return { read: () => doc, write: (d: HomeDoc) => void (doc = d), get: () => doc };
};

const pin = (key: string) => ({ hostId: "local", kind: "service" as const, key });

describe("home store", () => {
  it("loads the host's document and writes with its revision", async () => {
    const host = fakeHost({ bio: "hi" });
    const store = createHomeStore({ backend: () => host.backend, local: memory() });
    await store.load("local");
    expect(store.entry("local")).toMatchObject({ status: "ready", source: "host", revision: 1, doc: { bio: "hi" } });
    expect(await store.update("local", (d) => withPin(d, pin("a")))).toBe(true);
    expect(host.puts).toEqual([1]);
    expect(store.entry("local")).toMatchObject({ revision: 2, doc: { bio: "hi", pins: [pin("a")] }, saving: false, error: null });
  });

  it("an edit shows at once (optimistic), before the host answered", async () => {
    const host = fakeHost();
    let release!: () => void;
    const slow: HomeBackend = { get: host.backend.get, put: (r, h) => new Promise((ok) => (release = () => void host.backend.put(r, h).then(ok))) };
    const store = createHomeStore({ backend: () => slow, local: memory() });
    await store.load("local");
    const done = store.update("local", (d) => withPin(d, pin("a")));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.entry("local")!.doc.pins).toEqual([pin("a")]);
    expect(store.entry("local")!.confirmed.pins).toBeUndefined();
    expect(store.entry("local")!.saving).toBe(true);
    release();
    expect(await done).toBe(true);
    expect(store.entry("local")!.confirmed.pins).toEqual([pin("a")]);
  });

  it("409 home_revision_conflict: reloads the other device's document and applies the same edit on top", async () => {
    const host = fakeHost({ pins: [pin("a")] });
    const store = createHomeStore({ backend: () => host.backend, local: memory() });
    await store.load("local");
    // Another device pins b and changes the bio meanwhile.
    host.other((d) => ({ ...withPin(d, pin("b")), bio: "from the laptop" }));
    expect(await store.update("local", (d) => withPin(d, pin("c")))).toBe(true);
    expect(host.puts).toEqual([1, 2]);
    // (The laptop's pin was the first tray change: the desktop's icons were fixed to the pins before it, model deskIconsOf.)
    expect(host.doc()).toEqual({ pins: [pin("a"), pin("b"), pin("c")], bio: "from the laptop", deskIcons: [pin("a")] });
    expect(store.entry("local")).toMatchObject({ revision: 3, doc: host.doc(), error: null });
  });

  it("a toggle re-applied after a conflict acts on the fresh document (no double toggle)", async () => {
    const host = fakeHost({});
    const store = createHomeStore({ backend: () => host.backend, local: memory() });
    await store.load("local");
    host.other((d) => withPin(d, pin("x")));
    // Pinned on the other device already: this device's toggle now unpins it (it acts on what is there).
    expect(await store.update("local", (d) => withPinToggled(d, pin("x")))).toBe(true);
    expect(host.doc().pins).toEqual([]);
  });

  it("queued edits keep their order; a refused edit is dropped and the shown document goes back", async () => {
    const host = fakeHost();
    let refuse = false;
    const backend: HomeBackend = { get: host.backend.get, put: async (r, h) => (refuse ? { ok: false, error: { code: "invalid_home", message: "pins: bad" } } : host.backend.put(r, h)) };
    const store = createHomeStore({ backend: () => backend, local: memory() });
    await store.load("local");
    const a = store.update("local", (d) => withPin(d, pin("a")));
    const b = store.update("local", (d) => withPin(d, pin("b")));
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(host.doc().pins).toEqual([pin("a"), pin("b")]);
    refuse = true;
    expect(await store.update("local", (d) => withPin(d, pin("c")))).toBe(false);
    expect(store.entry("local")).toMatchObject({ doc: { pins: [pin("a"), pin("b")] }, error: "pins: bad" });
  });

  it("gives up after repeated conflicts (another device keeps writing)", async () => {
    const host = fakeHost();
    const backend: HomeBackend = { get: host.backend.get, put: async (r, h) => (host.other((d) => ({ ...d, n: Math.random() })), host.backend.put(r, h)) };
    const store = createHomeStore({ backend: () => backend, local: memory() });
    await store.load("local");
    expect(await store.update("local", (d) => withPin(d, pin("a")))).toBe(false);
    expect(store.entry("local")!.error).toBe("home_revision_conflict");
  });

  it("a host without user-home (no backend): the document stays on this device", async () => {
    const local = memory();
    const store = createHomeStore({ backend: () => null, local });
    await store.load("ssh-old");
    expect(store.entry("ssh-old")).toMatchObject({ status: "ready", source: "local", doc: {} });
    expect(await store.update("ssh-old", (d) => withPin(d, pin("a")))).toBe(true);
    expect(local.get()).toEqual({ pins: [pin("a")], deskIcons: [] });
    // A second store (next run) reads it back.
    const again = createHomeStore({ backend: () => null, local });
    await again.load("ssh-old");
    expect(again.entry("ssh-old")!.doc.pins).toEqual([pin("a")]);
  });

  it("the capability without the route (GET answers null): falls back to this device too", async () => {
    const store = createHomeStore({ backend: () => ({ get: async () => ({ ok: true, value: null }), put: async () => ({ ok: false, error: { code: "x", message: "" } }) }), local: memory() });
    await store.load("local");
    expect(store.entry("local")!.source).toBe("local");
    expect(await store.update("local", (d) => ({ ...d, bio: "b" }))).toBe(true);
  });

  it("a cover answer takes the cover etag without touching the document; a newer revision is taken whole", async () => {
    const host = fakeHost({ bio: "a" });
    const store = createHomeStore({ backend: () => host.backend, local: memory() });
    await store.load("local");
    store.noteView("local", { revision: 1, home: { bio: "a" }, coverEtag: "c1", updatedAt: null });
    expect(store.entry("local")).toMatchObject({ coverEtag: "c1", doc: { bio: "a" } });
    store.noteView("local", { revision: 5, home: { bio: "other" }, coverEtag: null, updatedAt: null });
    expect(store.entry("local")).toMatchObject({ revision: 5, coverEtag: null, doc: { bio: "other" } });
  });
});
