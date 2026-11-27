// 跨主机同步 of 浏览器身份 (owner 2026-11-26; cutex r297 browser-identity-sync-v1): the identity file's directory side
// (first-attach import, merge, remote deletion with a retained cleanup, 清除) and the per-host sync service
// (capabilities, enrollment proof, outbox repeats and conflicts, switch, owner gesture), plus the proof's message.
import { createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Session } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BROWSER_IDENTITY_ID as DEFAULT_ID, parseBrowserIdentityRequest } from "../src/shared/browserIdentity";
import { BrowserIdentities, cleanDeletedBrowserPartitions, type BrowserIdentityDirectory } from "../src/main/browser/identity/identities";
import { partitionDirectory } from "../src/main/browser/identity/disk";
import { BrowserIdentitySync, parseBrowserIdentityDirectory, syncHostView, type BrowserIdentitySyncTarget } from "../src/main/browser/identity/sync";

vi.mock("electron", () => ({ clipboard: { writeText: vi.fn(), readText: vi.fn(() => ""), clear: vi.fn() }, dialog: {}, BrowserWindow: class {} }));

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fakeSession() {
  return {
    getCacheSize: vi.fn(async () => 0), cookies: { get: vi.fn(async () => []) },
    clearData: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}), clearCache: vi.fn(async () => {}), clearAuthCache: vi.fn(async () => {}),
  };
}
function fixture() {
  const userData = mkdtempSync(join(tmpdir(), "cutex-browser-identity-sync-"));
  roots.push(userData);
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
  const options = {
    userData, sessionData: userData, hostIds: () => ["local", "ssh-fixture"], tabs: () => [],
    session: (p: string) => { if (!sessions.has(p)) sessions.set(p, fakeSession()); return sessions.get(p)! as unknown as Session; },
    close: vi.fn(), revoke: vi.fn(), forgetAdmissions: vi.fn(), forgetHostAdmissions: vi.fn(), reload: vi.fn(),
    dropIdentity: vi.fn(async () => {}), dropHost: vi.fn(async () => {}), retentionChanged: vi.fn(), emit: vi.fn(), directoryChanged: vi.fn(),
  };
  return { userData, options, sessions, ids: new BrowserIdentities(options) };
}
const retain = (root: string, id: string, host = "local") => {
  const dir = partitionDirectory(root, id, host);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "Cookies"), "logins");
  return dir;
};
const directory = (over: Partial<BrowserIdentityDirectory> = {}): BrowserIdentityDirectory => ({
  desktopRegistered: true, syncEnabled: true, revision: 1, identities: [], deleted: [], peers: [], ...over,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("identity file: directory side", () => {
  it("first directory imports local identities and deletions; remote rows appear and renames follow (not while a local change waits)", async () => {
    const f = fixture();
    const work = await f.ids.create("Work", "teal");
    const gone = await f.ids.create("Gone", "pink");
    await f.ids.remove(gone.id);
    expect(f.ids.directoryOutbox()).toEqual([]); // Nothing queues before a directory was ever seen.
    f.ids.applyDirectory(directory({ identities: [{ id: "c".repeat(32), name: "School", color: "violet", revision: 3 }] }));
    expect(f.ids.state().identities.map((i) => [i.id, i.name])).toEqual([[DEFAULT_ID, "个人"], [work.id, "Work"], ["c".repeat(32), "School"]]);
    expect(f.ids.directoryOutbox().map(({ kind, id, name, expectedRevision }) => [kind, id, name, expectedRevision])).toEqual([
      ["update", DEFAULT_ID, "个人", 0], ["create", work.id, "Work", undefined], ["delete", gone.id, undefined, undefined],
    ]);
    // A local rename waits: the remote name does not overwrite it.
    await f.ids.update(work.id, 1, { name: "Mail" });
    f.ids.applyDirectory(directory({ identities: [{ id: work.id, name: "Old", color: "teal", revision: 1 }] }));
    expect(f.ids.state().identities.find((i) => i.id === work.id)!.name).toBe("Mail");
    for (const e of f.ids.directoryOutbox()) f.ids.directoryOutboxUpdate(e.mutationId, null);
    f.ids.applyDirectory(directory({ identities: [{ id: work.id, name: "M" + "🎓".repeat(39), color: "orange", revision: 4 }] }));
    const reopened = new BrowserIdentities(f.options);
    expect(reopened.state().identities.find((i) => i.id === work.id)).toMatchObject({ color: "orange", initial: "W" }); // The owner's initial stays (it never syncs).
    expect([...reopened.state().identities.find((i) => i.id === work.id)!.name].length).toBe(40);
    // Later local changes queue directly (an unsent create + delete cancel out).
    const temp = await reopened.create("Temp", "slate");
    await reopened.remove(temp.id);
    expect(reopened.directoryOutbox()).toEqual([]);
  });

  it("a remote deletion blocks the identity at once and keeps its data until 清除 of that exact deletion", async () => {
    const f = fixture();
    const work = await f.ids.create("Work", "teal");
    f.ids.partition(work.id, "local");
    f.ids.used(f.ids.partition(work.id, "local"));
    const kept = retain(f.userData, work.id, "local");
    f.ids.applyDirectory(directory({ identities: [{ id: work.id, name: "Work", color: "teal", revision: 1 }] }));
    f.ids.applyDirectory(directory({ deleted: [{ id: work.id, revision: 9, requiresLocalCleanupConfirmation: true }] }));
    expect(f.options.close).toHaveBeenCalledWith(work.id);
    expect(f.ids.has(work.id)).toBe(false);
    expect(() => f.ids.partition(work.id, "local")).toThrow("browser_identity_unavailable");
    expect(f.ids.cleanups()).toEqual([{ identityId: work.id, name: "Work", color: "teal", deletionRevision: 9, hosts: ["local"] }]);
    // Leaving / restarting keeps it pending; the startup sweep leaves its data alone.
    cleanDeletedBrowserPartitions(f.userData, f.userData);
    expect(existsSync(kept)).toBe(true);
    const reopened = new BrowserIdentities(f.options);
    expect(reopened.cleanups()).toHaveLength(1);
    await expect(reopened.confirmCleanup(work.id, 8)).rejects.toThrow("browser_identity_cleanup_missing");
    expect(f.options.dropIdentity).not.toHaveBeenCalled();
    await reopened.confirmCleanup(work.id, 9);
    expect(f.sessions.get(`persist:browser-id-${work.id}-local`)!.clearData).toHaveBeenCalled();
    expect(f.options.dropIdentity).toHaveBeenCalledWith(work.id); // saved passwords + history
    expect(reopened.cleanups()).toEqual([]);
    cleanDeletedBrowserPartitions(f.userData, f.userData);
    expect(existsSync(kept)).toBe(false);
    // The same id never comes back from a directory.
    reopened.applyDirectory(directory({ identities: [{ id: work.id, name: "Work", color: "teal", revision: 10 }] }));
    expect(reopened.has(work.id)).toBe(false);
  });

  it("a deletion without local data or without the confirmation flag leaves no question", async () => {
    const f = fixture();
    const a = await f.ids.create("A", "teal"), b = await f.ids.create("B", "pink");
    retain(f.userData, b.id);
    f.ids.applyDirectory(directory({ deleted: [{ id: a.id, revision: 2, requiresLocalCleanupConfirmation: true }, { id: b.id, revision: 2, requiresLocalCleanupConfirmation: false }] }));
    expect(f.ids.cleanups()).toEqual([]);
    expect(f.ids.state().identities.map((i) => i.id)).toEqual([DEFAULT_ID]);
    await flush();
    expect(f.options.dropIdentity).toHaveBeenCalledWith(b.id);
    expect(JSON.parse(readFileSync(join(f.userData, "browser-identities.json"), "utf8")).pendingPartitions).toEqual([`persist:browser-id-${b.id}-local`]);
  });
});

type Call = { method: string; route: string; body?: unknown };
function host(features: string[], answer: (call: Call) => unknown, over: Partial<BrowserIdentitySyncTarget> = {}) {
  const calls: Call[] = [];
  const target: BrowserIdentitySyncTarget = {
    hostId: "local", epoch: "e1", instanceId: "ci-" + "1".repeat(32),
    client: {
      capabilities: async () => ({ featureList: features }),
      browserIdentities: async (method, route, body) => { const call = { method, route, ...(body !== undefined ? { body } : {}) }; calls.push(call); return answer(call); },
    },
    ...over,
  };
  return { target, calls };
}
const apiError = (status: number, code: string) => Object.assign(new Error(code), { status, code });

describe("sync service", () => {
  it("hosts without the feature or the owner's access show why; no proof yet waits", async () => {
    const f = fixture();
    const old = host([], () => { throw new Error("not called"); }, { hostId: "ssh-old" });
    const guest = host(["browser-identity-sync-v1"], () => { throw apiError(403, "browser_identity_owner_required"); }, { hostId: "ssh-guest" });
    const fresh = host(["browser-identity-sync-v1"], () => directory(), { hostId: "local" });
    const sync = new BrowserIdentitySync({ targets: () => [old.target, guest.target, fresh.target], proof: (h) => (h === "ssh-guest" ? { publicKey: "pk", signature: "sig" } : null), local: f.ids, ownerGesture: () => false, emit: vi.fn() });
    await sync.refreshAll();
    expect(sync.state().hosts.map((h) => [h.hostId, h.state])).toEqual([["local", "waiting"], ["ssh-guest", "notOwner"], ["ssh-old", "unsupported"]]);
    expect(old.calls).toEqual([]);
    expect(fresh.calls).toEqual([]); // No proof: nothing sent.
  });

  it("registers with the proof, sends the outbox to the primary and repeats a lost send unchanged", async () => {
    const f = fixture();
    const work = await f.ids.create("Work", "teal");
    let remote = directory({ identities: [{ id: DEFAULT_ID, name: "个人", color: null, revision: 1 }] });
    let failNext = 1;
    const local = host(["browser-identity-sync-v1"], (call) => {
      if (call.route === "mutations") {
        if (failNext-- > 0) throw Object.assign(new Error("socket hang up"), { status: 0 });
        const body = call.body as { kind: string; id: string; name: string; color: string };
        if (body.kind === "create") remote = { ...remote, identities: [...remote.identities, { id: body.id, name: body.name, color: body.color as "teal", revision: 1 }] };
      }
      return remote;
    });
    const emit = vi.fn();
    const sync = new BrowserIdentitySync({ targets: () => [local.target], proof: () => ({ publicKey: "pk", signature: "sig" }), local: f.ids, ownerGesture: () => false, emit });
    await sync.refreshAll();
    expect(local.calls[0]).toEqual({ method: "POST", route: "desktop", body: { publicKey: "pk", signature: "sig" } });
    const first = local.calls.find((c) => c.route === "mutations")!.body as { mutationId: string };
    expect(first).toMatchObject({ kind: "create", id: work.id, name: "Work", color: "teal" });
    expect(sync.state().hosts[0]!.state).toBe("error");
    await sync.refreshAll();
    const sends = local.calls.filter((c) => c.route === "mutations").map((c) => c.body);
    expect(sends).toHaveLength(2);
    expect(sends[1]).toEqual(sends[0]); // Same mutation id and body after a lost reply.
    expect(f.ids.directoryOutbox()).toEqual([]);
    expect(local.calls.at(-1)).toMatchObject({ route: "mutations" });
    expect(sync.state().hosts).toEqual([{ hostId: "local", state: "alone", lastSyncAt: null }]);
    expect(emit).toHaveBeenCalled();
  });

  it("a stale revision reads again and sends a fresh operation; final refusals drop the change", async () => {
    const f = fixture();
    f.ids.applyDirectory(directory({ identities: [{ id: DEFAULT_ID, name: "个人", color: null, revision: 4 }] }));
    for (const e of f.ids.directoryOutbox()) f.ids.directoryOutboxUpdate(e.mutationId, null);
    await f.ids.update(DEFAULT_ID, 0, { name: "Me" });
    let revision = 4;
    const local = host(["browser-identity-sync-v1"], (call) => {
      if (call.route === "mutations") {
        const body = call.body as { expectedRevision: number };
        if (body.expectedRevision !== 5) { revision = 5; throw apiError(409, "revision_conflict"); }
      }
      return directory({ identities: [{ id: DEFAULT_ID, name: "个人", color: null, revision }] });
    });
    const sync = new BrowserIdentitySync({ targets: () => [local.target], proof: () => ({ publicKey: "pk", signature: "sig" }), local: f.ids, ownerGesture: () => false, emit: vi.fn() });
    await sync.refreshAll();
    const sends = local.calls.filter((c) => c.route === "mutations").map((c) => c.body as { mutationId: string; expectedRevision: number; name: string });
    expect(sends.map((s) => [s.expectedRevision, s.name])).toEqual([[4, "Me"], [5, "Me"]]);
    expect(sends[0]!.mutationId).not.toBe(sends[1]!.mutationId);
    expect(f.ids.directoryOutbox()).toEqual([]);
  });

  it("the switch goes to that host; 清除 needs the owner's gesture", async () => {
    const f = fixture();
    let enabled = true;
    const local = host(["browser-identity-sync-v1"], (call) => {
      if (call.route === "sync") enabled = (call.body as { enabled: boolean }).enabled;
      return directory({ syncEnabled: enabled, peers: [{ instanceId: "ci-2", label: "Samplehostb", state: "synced", confirmedRevision: 1, confirmedAt: "2026-11-26T01:00:00Z" }] });
    });
    let gesture = false;
    const confirm = vi.spyOn(f.ids, "confirmCleanup").mockResolvedValue();
    const sync = new BrowserIdentitySync({ targets: () => [local.target], proof: () => ({ publicKey: "pk", signature: "sig" }), local: f.ids, ownerGesture: () => gesture, emit: vi.fn() });
    await sync.refreshAll();
    expect(sync.state().hosts[0]).toEqual({ hostId: "local", state: "synced", lastSyncAt: "2026-11-26T01:00:00Z" });
    expect((await sync.setHostSync("local", false)).hosts[0]!.state).toBe("off");
    expect(local.calls.at(-1)).toEqual({ method: "PUT", route: "sync", body: { enabled: false } });
    await expect(sync.setHostSync("ssh-none", true)).rejects.toThrow("browser_identity_sync_unavailable");
    await expect(sync.confirmCleanup("a".repeat(32), 3)).rejects.toThrow("owner_gesture_required");
    expect(confirm).not.toHaveBeenCalled();
    gesture = true;
    await sync.confirmCleanup("a".repeat(32), 3);
    expect(confirm).toHaveBeenCalledWith("a".repeat(32), 3);
  });
});

describe("host lines and the wire", () => {
  it("maps peer states to the owner's words", () => {
    const base = { features: true, registeredKey: "pk", error: null, localLimit: false } as const;
    const peers = (...states: string[]) => directory({ peers: states.map((state, i) => ({ instanceId: `ci-${i}`, label: "", state, confirmedRevision: null, confirmedAt: null })) });
    expect(syncHostView("h", { ...base, snapshot: peers("synced", "disabled") }, false).state).toBe("synced");
    expect(syncHostView("h", { ...base, snapshot: peers("synced") }, true).state).toBe("syncing");
    expect(syncHostView("h", { ...base, snapshot: peers("offline") }, false).state).toBe("syncing");
    expect(syncHostView("h", { ...base, snapshot: peers("limit", "synced") }, false).state).toBe("limit");
    expect(syncHostView("h", { ...base, snapshot: peers("clock") }, false).state).toBe("error");
    expect(syncHostView("h", { ...base, snapshot: { ...peers("synced"), syncEnabled: false } }, false).state).toBe("off");
    expect(syncHostView("h", { ...base, snapshot: peers("needsDesktop") }, false).state).toBe("alone");
    expect(syncHostView("h", { ...base, features: false, snapshot: null }, false).state).toBe("unsupported");
  });

  it("reads a directory strictly and parses the new requests", () => {
    expect(() => parseBrowserIdentityDirectory({ desktopRegistered: true })).toThrow("browser_identity_directory_invalid");
    expect(() => parseBrowserIdentityDirectory(directory({ identities: [{ id: "x", name: "n", color: "red" as never, revision: 1 }] }))).toThrow();
    expect(parseBrowserIdentityRequest({ op: "setHostSync", hostId: "ssh-abc", enabled: false })).toEqual({ op: "setHostSync", hostId: "ssh-abc", enabled: false });
    expect(() => parseBrowserIdentityRequest({ op: "setHostSync", hostId: "../x", enabled: false })).toThrow("invalid_browser_request");
    expect(() => parseBrowserIdentityRequest({ op: "confirmCleanup", identityId: DEFAULT_ID, deletionRevision: 1 })).toThrow("invalid_browser_request");
    expect(parseBrowserIdentityRequest({ op: "confirmCleanup", identityId: "a".repeat(32), deletionRevision: 2 })).toEqual({ op: "confirmCleanup", identityId: "a".repeat(32), deletionRevision: 2 });
  });

  it("the enrollment proof signs cutex-browser-identities-v1, the instance id and the key, only after that host's claim", async () => {
    const { PersonIdentityService } = await import("../src/main/personIdentity");
    const dir = mkdtempSync(join(tmpdir(), "cutex-person-proof-"));
    roots.push(dir);
    const first = new PersonIdentityService(dir, () => {}, () => null, () => []);
    const publicKey = first.view().publicKey!;
    expect(first.browserIdentityProof("local", "ci-abc")).toBeNull();
    writeFileSync(join(dir, "claims.json"), JSON.stringify({ claims: { local: { publicKey, credential: "root", tokenId: "root" } } }));
    const service = new PersonIdentityService(dir, () => {}, () => null, () => []);
    const proof = service.browserIdentityProof("local", "ci-abc")!;
    expect(proof.publicKey).toBe(publicKey);
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: publicKey }, format: "jwk" });
    expect(verify(null, Buffer.from(`cutex-browser-identities-v1\nci-abc\n${publicKey}`, "utf8"), key, Buffer.from(proof.signature, "base64url"))).toBe(true);
    expect(proof.signature).not.toMatch(/=/);
    expect(service.browserIdentityProof("ssh-other", "ci-abc")).toBeNull();
  });
});
