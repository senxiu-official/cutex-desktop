import { describe, expect, it } from "vitest";
import { createUserLayout, USER_LAYOUT_KEY, type LayoutBackend } from "../src/renderer/src/lib/userLayout";
import { applyLayoutOp, decodeSidebar, describeLayoutHost, emptySidebar, encodeSidebar, mergeSidebar, portableRef, readSidebar, sidebarEdits, type LayoutHost, type SidebarDoc, type SidebarLocal } from "../src/renderer/src/lib/userLayoutModel";
import { readPortableHome, writePortableHome } from "../src/renderer/src/modules/home/portable";
import { hostKey } from "../src/renderer/src/lib/hostKeys";
import type { UserLayout } from "@cutex-desktop/cutex-client";

const a = `ci-${"a".repeat(32)}`, b = `ci-${"b".repeat(32)}`;
const hosts: LayoutHost[] = [{ id: "local", instanceId: a, label: "Host-A", online: true, supported: true, eligible: true }, { id: "ssh-b", instanceId: b, label: "Remote", online: true, supported: true, eligible: true }];
const local = (): SidebarLocal => ({ sidebarSections: [{ id: "s", name: "Work", collapsed: false, members: [hostKey("local", "p")] }], starredProjects: [hostKey("ssh-b", "p2")], projectOrder: [hostKey("local", "p")], foldedProjects: [], pinned: [hostKey("local", "agent")], navPins: ["home.nav"] });
function fixture(initial: SidebarDoc | null = null, seed = local()) {
  let revision = 0; let doc = initial; let identity = "owner"; let conflicts = 0;
  let puts = 0; const disk = new Map<string, string>();
  const storage = { getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => { disk.set(key, value); } };
  const view = (): UserLayout => ({ docKey: identity, userId: "owner", displayName: "Sam", ownerPersonConfirmed: true, pointer: null, sections: doc ? { sidebar: { revision, data: doc, updatedAt: null, updatedBy: null } } : {} });
  const backend: LayoutBackend = {
    get: async () => ({ ok: true, value: structuredClone(view()) }),
    put: async (rev, data) => {
      puts++;
      if (conflicts > 0) { conflicts--; revision++; doc = { ...readSidebar(doc), pinned: [...(doc?.pinned ?? []), { host: b, id: `other-${conflicts}` }] }; }
      if (rev !== revision) return { ok: false, error: { code: "layout_revision_conflict", message: "changed", revision } };
      doc = structuredClone(data); revision++;
      return { ok: true, value: { revision, updatedAt: null } };
    },
  };
  const make = () => createUserLayout({ storage, backend: () => backend, local: () => seed });
  const store = make(); store.setHosts(hosts);
  return { store, make, storage, disk, backend, doc: () => doc!, puts: () => puts, conflict: (n: number) => { conflicts = n; }, identity: (s: string) => { identity = s; } };
}

describe("portable sidebar references and edit replay", () => {
  it("never attributes a stale focus daemon's identity to local or another host", () => {
    const stale = { daemon: { kind: "connected", instanceId: b }, featuresKnown: true, features: new Set(["user-layout"]) };
    expect(describeLayoutHost("local", "Local", undefined, stale, true)).toMatchObject({ instanceId: undefined, online: false, supported: false });
    expect(describeLayoutHost("local", "Local", { kind: "connected", instanceId: a }, stale, true)).toMatchObject({ instanceId: a, online: true, supported: false, known: false });
    expect(describeLayoutHost("remote", "Remote", { kind: "connected", instanceId: b }, stale, true)).toMatchObject({ instanceId: b, online: true, supported: true, known: true });
    expect(describeLayoutHost("remote", "Remote", { kind: "unreachable" }, stale, true)).toMatchObject({ instanceId: undefined, online: false, supported: false });
  });
  it("round trips local keys and changes device host aliases", () => {
    const doc = encodeSidebar(local(), hosts, "local");
    expect(doc.sections[0]!.members).toEqual([{ host: a, id: "p" }]);
    expect(decodeSidebar(doc, hosts)).toEqual(local());
    expect(decodeSidebar(doc, [{ ...hosts[0]!, id: "ssh-eva" }]).sidebarSections[0]!.members).toEqual([hostKey("ssh-eva", "p")]);
  });
  it("keeps unknown source labels without claiming another device's local id", () => {
    const r = portableRef(hostKey("deleted", "p"), hosts, "local");
    expect(r).toEqual({ localId: "deleted", hostLabel: "deleted", id: "p" });
    expect(decodeSidebar({ ...emptySidebar(), pinned: [r] }, hosts).pinned).toEqual([]);
  });
  it("hidden members survive visible edits, with unknown fields unchanged", () => {
    const d = { ...encodeSidebar(local(), hosts, "local"), future: { secret: 1 } };
    const before = decodeSidebar(d, [hosts[0]!]); const after = { ...before, pinned: [...before.pinned, hostKey("local", "new")] };
    const edits = sidebarEdits(encodeSidebar(before, [hosts[0]!], "local"), encodeSidebar(after, [hosts[0]!], "local"), 10);
    const next = edits.reduce(applyLayoutOp, d);
    expect(next.starredProjects).toEqual([{ host: b, id: "p2" }]); expect(next.future).toEqual({ secret: 1 });
  });
  it("order anchors keep hidden entries in their relative order", () => {
    const d = { ...emptySidebar(), projectOrder: [{ host: a, id: "one" }, { host: b, id: "hidden1" }, { host: b, id: "hidden2" }, { host: a, id: "two" }] };
    const before = decodeSidebar(d, [hosts[0]!]); const after = { ...before, projectOrder: [...before.projectOrder].reverse() };
    const next = sidebarEdits(encodeSidebar(before, [hosts[0]!], "local"), encodeSidebar(after, [hosts[0]!], "local"), 10).reduce(applyLayoutOp, d);
    expect(next.projectOrder.filter(r => r.host === b).map(r => r.id)).toEqual(["hidden1", "hidden2"]);
    expect(next.projectOrder.map(r => r.id)).toEqual(["two", "hidden1", "hidden2", "one"]);
    expect(decodeSidebar(next, [hosts[0]!]).projectOrder).toEqual(after.projectOrder);
  });
  it("replays independent section fields without overwriting concurrent edits", () => {
    const d = encodeSidebar(local(), hosts, "local");
    const renamed = { ...d, sections: d.sections.map(s => ({ ...s, name: "Renamed" })) };
    const folded = { ...d, sections: d.sections.map(s => ({ ...s, collapsed: true })) };
    const next = sidebarEdits(d, renamed, 1).reduce(applyLayoutOp, folded);
    expect(next.sections[0]).toMatchObject({ name: "Renamed", collapsed: true });
  });
  it("keeps a deletion tombstone and refuses stale resurrection", () => {
    const ref = { host: a, id: "agent" };
    const gone = applyLayoutOp({ ...emptySidebar(), pinned: [ref] }, { kind: "list", list: "pinned", ref, present: false, before: null, t: 100 });
    expect(gone.tombstones).toHaveLength(1);
    expect(applyLayoutOp(gone, { kind: "list", list: "pinned", ref, present: true, before: null, t: 99 }).pinned).toEqual([]);
    expect(applyLayoutOp(gone, { kind: "list", list: "pinned", ref, present: true, before: null, t: 101 }).pinned).toEqual([ref]);
  });
  it("expires only deletion markers older than 30 days when another edit is committed", () => {
    const day = 24 * 60 * 60 * 1000;
    const d = { ...emptySidebar(), future: { retained: true }, tombstones: [{ id: "old", del: true as const, t: day }, { id: "recent", del: true as const, t: 30 * day }] };
    const next = applyLayoutOp(d, { kind: "navDefault", t: 32 * day });
    expect(next.tombstones.map(t => t.id)).toEqual(["recent"]); expect(next.future).toEqual({ retained: true });
  });
  it("merges same-name sections, deduplicating membership and preserving remote order", () => {
    const remote = encodeSidebar(local(), hosts, "local");
    const other = { ...remote, sections: [{ ...remote.sections[0]!, id: "s-other", members: [...remote.sections[0]!.members, { host: b, id: "extra" }] }] };
    const merged = mergeSidebar(remote, other);
    expect(merged.sections).toHaveLength(1); expect(merged.sections[0]!.id).toBe("s");
    expect(merged.sections[0]!.members.map(r => r.id)).toEqual(["p", "extra"]);
  });
  it("keeps hidden members when moving the last visible member drops its section locally", () => {
    const d = encodeSidebar(local(), hosts, "local");
    d.sections[0]!.members.push({ host: b, id: "hidden" });
    const before = decodeSidebar(d, [hosts[0]!]);
    const after = { ...before, sidebarSections: [] };
    const next = sidebarEdits(encodeSidebar(before, [hosts[0]!], "local"), encodeSidebar(after, [hosts[0]!], "local"), 10).reduce(applyLayoutOp, d);
    expect(next.sections[0]!.members).toEqual([{ host: b, id: "hidden" }]);
  });
  it("replays every three-item permutation for sections, members and project order", () => {
    const perms = [["a", "b", "c"], ["a", "c", "b"], ["b", "a", "c"], ["b", "c", "a"], ["c", "a", "b"], ["c", "b", "a"]];
    for (const names of perms) {
      const d = emptySidebar(); d.sections = ["a", "b", "c"].map(id => ({ id, name: id, collapsed: false, members: id === "a" ? ["a", "b", "c"].map(id => ({ host: a, id })) : [] }));
      d.projectOrder = ["a", "b", "c"].map(id => ({ host: a, id }));
      const after = { ...d, sections: names.map(id => ({ ...d.sections.find(s => s.id === id)!, members: id === "a" ? names.map(id => ({ host: a, id })) : [] })), projectOrder: names.map(id => ({ host: a, id })) };
      const replayed = sidebarEdits(d, after, 10).reduce(applyLayoutOp, d);
      expect(replayed.sections, names.join()).toEqual(after.sections); expect(replayed.projectOrder).toEqual(after.projectOrder);
    }
  });
});

describe("user-layout migration, durable log and capability fallback", () => {
  it("migrates empty remote once, retaining legacy local storage", async () => {
    const f = fixture(); await f.store.choose({ instanceId: a, label: "Host-A" });
    expect(decodeSidebar(f.doc(), hosts)).toEqual(local());
    const count = f.puts(); await f.store.refresh(); expect(f.puts()).toBe(count);
    const cache = JSON.parse(f.disk.get(USER_LAYOUT_KEY)!); expect(cache.entries[a].migratedAt).toBeGreaterThan(0);
  });
  it("asks once for non-empty remote and defaults to the remote layout", async () => {
    const d = { ...emptySidebar(), pinned: [{ host: a, id: "remote" }] };
    const f = fixture(d); await f.store.choose({ instanceId: a, label: "Host-A" });
    expect(f.store.state.getState().migration).toBe(true); expect(f.puts()).toBe(0);
    await f.store.resolveMigration(false); await f.store.refresh();
    expect(f.doc()).toEqual(d); expect(f.store.state.getState().migration).toBe(false);
  });
  it("merges device sidebar only after the explicit migration choice", async () => {
    const f = fixture({ ...emptySidebar(), pinned: [{ host: a, id: "remote" }] });
    await f.store.choose({ instanceId: a, label: "Host-A" }); await f.store.resolveMigration(true);
    expect(f.doc().pinned.map(r => r.id)).toEqual(["remote", "agent"]);
  });
  it("persists offline operations across a restart and replays on reconnection", async () => {
    const f = fixture(); await f.store.choose({ instanceId: a, label: "Host-A" });
    f.store.setHosts(hosts.map(h => ({ ...h, online: false }))); await f.store.refresh();
    const before = f.store.local()!; f.store.edit(before, { ...before, pinned: [...before.pinned, hostKey("local", "offline")] });
    expect(f.store.state.getState().pending).toBe(1);
    const restarted = f.make(); restarted.setHosts(hosts); await restarted.refresh();
    expect(restarted.state.getState().pending).toBe(0); expect(f.doc().pinned.map(r => r.id)).toContain("offline");
  });
  it("409 rereads and replays the same operation, retaining the other device's pin", async () => {
    const f = fixture(); await f.store.choose({ instanceId: a, label: "Host-A" }); f.conflict(1);
    const before = f.store.local()!; f.store.edit(before, { ...before, pinned: [...before.pinned, hostKey("local", "mine")] });
    await f.store.refresh();
    expect(f.doc().pinned.map(r => r.id)).toEqual(expect.arrayContaining(["mine", "other-0"]));
  });
  it("retains the operation after three conflicts", async () => {
    const f = fixture(); await f.store.choose({ instanceId: a, label: "Host-A" }); f.conflict(4);
    const before = f.store.local()!; f.store.edit(before, { ...before, pinned: [...before.pinned, hostKey("local", "mine")] });
    await f.store.refresh(); expect(f.store.state.getState().pending).toBe(1); expect(f.store.state.getState().error).toBe("layout_revision_conflict");
  });
  it("unsupported or pending hosts use local storage without layout requests", async () => {
    for (const patch of [{ supported: false }, { eligible: false }]) {
      const f = fixture(); f.store.setHosts(hosts.map(h => ({ ...h, ...patch })));
      await f.store.choose({ instanceId: a, label: "Host-A" });
      expect(f.store.state.getState().status).toBe("unsupported"); expect(f.store.local()).toBeNull(); expect(f.puts()).toBe(0);
    }
  });
  it("keeps confirmed cached layout while reconnect capabilities are still unknown", async () => {
    const f = fixture(); await f.store.choose({ instanceId: a, label: "EVA" });
    f.store.setHosts(hosts.map(h => ({ ...h, known: false, supported: false }))); await f.store.refresh();
    expect(f.store.state.getState().status).toBe("loading"); expect(f.store.local()).toEqual(local());
  });
  it("never silently elects another memory host when the selected host disappears", async () => {
    const f = fixture(); await f.store.choose({ instanceId: a, label: "Host-A" }); f.store.setHosts([hosts[1]!]); await f.store.refresh();
    expect(f.store.state.getState().status).toBe("missing"); expect(f.store.state.getState().memoryHost?.instanceId).toBe(a);
    expect(f.store.local()!.pinned).toEqual([]); expect(f.doc().pinned).toHaveLength(1);
  });
  it("does not replay another identity's offline edits", async () => {
    const f = fixture(); await f.store.choose({ instanceId: a, label: "Host-A" });
    f.store.setHosts(hosts.map(h => ({ ...h, online: false }))); await f.store.refresh();
    const before = f.store.local()!; f.store.edit(before, { ...before, pinned: [...before.pinned, hostKey("local", "old-person")] });
    f.identity("owner~1234567890123456"); f.store.setHosts(hosts); await f.store.refresh();
    expect(f.doc().pinned.map(r => r.id)).not.toContain("old-person");
    expect(JSON.parse(f.disk.get(USER_LAYOUT_KEY)!).entries[`${a}/owner`].operations).toHaveLength(1);
  });
  it("copies unknown sidebar fields and tombstones to a new memory host and retains the old document", async () => {
    const original = { ...emptySidebar(), future: { custom: 17 }, tombstones: [{ id: "pinned:deleted", del: true as const, t: Date.now() }] };
    const one = fixture(original), two = fixture();
    const store = createUserLayout({ storage: one.storage, local, backend: id => id === "local" ? one.backend : two.backend });
    store.setHosts(hosts); await store.choose({ instanceId: a, label: "EVA" }); await store.resolveMigration(false);
    await store.choose({ instanceId: b, label: "Remote" });
    expect(two.doc().future).toEqual({ custom: 17 }); expect(two.doc().tombstones).toEqual(original.tombstones); expect(one.doc()).toEqual(original);
  });
  it("keeps unacknowledged operations in memory and sends no write after a storage failure", async () => {
    const f = fixture(); await f.store.choose({ instanceId: a, label: "EVA" });
    f.storage.setItem = () => { throw new Error("disk full"); };
    const before = f.store.local()!; const count = f.puts();
    f.store.edit(before, { ...before, pinned: [...before.pinned, hostKey("local", "unsaved")] });
    expect(f.puts()).toBe(count); expect(f.store.state.getState().error).toContain("disk full"); expect(f.store.state.getState().pending).toBe(1);
  });
});

describe("portable home pins", () => {
  it("maps stable host to this device's alias and retains legacy hostId on wire", () => {
    const raw = { pins: [{ host: b, hostId: "local", kind: "agent" as const, key: "x" }] };
    const doc = readPortableHome(raw, hosts); expect(doc.pins![0]!.hostId).toBe("ssh-b"); expect(writePortableHome(doc, hosts)).toEqual(raw);
  });
  it("backfills unambiguous legacy pins on first connect", () => {
    const raw = { pins: [{ hostId: "local", kind: "agent" as const, key: "x" }] };
    expect(writePortableHome(readPortableHome(raw, hosts), hosts).pins![0]!.host).toBe(a);
  });
  it("does not resolve a foreign document's legacy local pin to this computer", () => {
    const raw = { pins: [{ host: b, hostId: "ssh-old", kind: "agent" as const, key: "portable" }, { hostId: "local", kind: "agent" as const, key: "ambiguous" }] };
    const doc = readPortableHome(raw, hosts); expect(doc.pins![1]!.hostId).toBe("unknown:local");
    expect(writePortableHome(doc, hosts).pins![1]).toEqual(raw.pins[1]);
  });
  it("keeps unconfigured home refs and nested group members portable", () => {
    const raw = { pins: [{ host: b, hostId: "old", kind: "agent" as const, key: "x", members: [{ host: b, hostId: "local", key: "y" }] }] };
    const doc = readPortableHome(raw, [hosts[0]!]); expect(doc.pins![0]!.hostId).toBe(`unknown:${b}`);
    expect(writePortableHome(doc, [hosts[0]!])).toEqual(raw);
  });
  it("resolves a previously missing home host when it is configured later", () => {
    const raw = { pins: [{ host: b, hostId: "old", kind: "agent" as const, key: "x" }], future: { hostId: "local", key: "opaque" } };
    const missing = readPortableHome(raw, [hosts[0]!]);
    const connected = readPortableHome(missing, hosts);
    expect(connected.pins![0]!.hostId).toBe("ssh-b"); expect(writePortableHome(connected, hosts).future).toEqual(raw.future);
  });
});
