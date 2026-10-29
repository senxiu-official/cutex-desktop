import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CutexApiError } from "@cutex-desktop/cutex-client";
vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false } }));
import { ProfileLinkService, type ProfileLinkEncryption, type ProfileLinkTarget } from "../src/main/profileLink";
import { PROFILE_ACCOUNT_LINK_FEATURE } from "../src/shared/profileLink";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const encryption: ProfileLinkEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from([...value].reverse().join("")),
  decryptString: value => [...value.toString()].reverse().join(""),
};
const owner = () => ({ featureList: [PROFILE_ACCOUNT_LINK_FEATURE], user: { isOwner: true, scope: "full", ownerLocal: true, token: null } });
const pairedOwner = () => ({ featureList: [PROFILE_ACCOUNT_LINK_FEATURE], user: { isOwner: true, scope: "full", ownerLocal: false, token: { id: "synthetic-paired", scope: "full" } } });
const differentId = (id: string | null) => id === "00000000" ? "ffffffff" : "00000000";
const hash = (secret: string) => createHash("sha256").update(Buffer.from(secret, "base64url")).digest("hex").slice(0, 8);
function fixture(customEncryption = encryption) {
  const userData = mkdtempSync(join(tmpdir(), "profile-link-synthetic-")); dirs.push(userData);
  let targets: ProfileLinkTarget[] = [];
  const emissions: unknown[] = [];
  const service = new ProfileLinkService({ userData, encryption: customEncryption, targets: () => targets, emit: state => emissions.push(state) });
  return { userData, service, emissions, targets: (value: ProfileLinkTarget[]) => { targets = value; } };
}
function host(id = "local", capabilities: unknown = owner()) {
  let remote: string | null = null;
  const secrets: string[] = [];
  const request = vi.fn(async (method: string, path: string, body?: unknown) => {
    expect(path).toBe("/v2/profile-link/secret");
    if (method === "PUT") { const secret = (body as { secret: string }).secret; secrets.push(secret); remote = hash(secret); }
    return { contractVersion: 2, secretId: remote };
  });
  const target: ProfileLinkTarget = { hostId: id, epoch: "one", client: { capabilities: vi.fn(async () => capabilities as ReturnType<typeof owner>), request: request as ProfileLinkTarget["client"]["request"] } };
  return { target, request, secrets, remote: (value: string | null) => { remote = value; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

describe("main-only profile link secret", () => {
  it("generates 32 bytes, stores encrypted state, reloads unchanged and exposes only safe facts", async () => {
    const f = fixture(); const h = host(); f.targets([h.target]);
    await f.service.reconcile();
    expect(h.secrets).toHaveLength(1);
    const secret = h.secrets[0]!;
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
    expect(f.service.view()).toEqual({ secretId: hash(secret), hosts: { local: { state: "synced", secretId: hash(secret) } } });
    expect(JSON.stringify(f.emissions)).not.toContain(secret);
    expect(JSON.stringify(f.service)).not.toContain(secret);
    expect(readFileSync(join(f.userData, "profile-link/secret-v1.json"), "utf8")).not.toContain(secret);
    const reloaded = new ProfileLinkService({ userData: f.userData, encryption, targets: () => [h.target] });
    await reloaded.reconcile();
    expect(h.secrets).toHaveLength(1); // GET matches: no second PUT.
    expect(reloaded.view().secretId).toBe(hash(secret));
  });
  it("does not contact secret routes for old, restricted or unknown credentials", async () => {
    for (const caps of [null, {}, { featureList: [] }, { featureList: [PROFILE_ACCOUNT_LINK_FEATURE] },
      { featureList: [PROFILE_ACCOUNT_LINK_FEATURE], user: { isOwner: false, scope: "full", ownerLocal: true } },
      { featureList: [PROFILE_ACCOUNT_LINK_FEATURE], user: { isOwner: true, scope: "read", ownerLocal: true } },
      { featureList: [PROFILE_ACCOUNT_LINK_FEATURE], user: { isOwner: true, scope: "chat", ownerLocal: true } },
      { featureList: [PROFILE_ACCOUNT_LINK_FEATURE], user: { isOwner: true, ownerLocal: false } }]) {
      const f = fixture(); const h = host("restricted", caps); f.targets([h.target]);
      await f.service.reconcile(); expect(h.request).not.toHaveBeenCalled(); expect(f.service.view().secretId).toBeNull();
    }
  });
  it("allows an explicitly full owner device token", async () => {
    const f = fixture(); const h = host("ssh", { featureList: [PROFILE_ACCOUNT_LINK_FEATURE], user: { isOwner: true, scope: "full", ownerLocal: false, token: { id: "synthetic", scope: "full" } } });
    f.targets([h.target]); await f.service.reconcile(); expect(h.secrets).toHaveLength(1);
  });
  it("does not PUT when a paired host already has the matching secret", async () => {
    const f = fixture(); const h = host("paired", pairedOwner()); f.targets([h.target]);
    await f.service.reconcile(); expect(h.secrets).toHaveLength(1); // Initial null GET allows first set.
    const id = f.service.view().secretId;
    await f.service.reconcile();
    expect(h.secrets).toHaveLength(1);
    expect(f.service.view().hosts.paired).toEqual({ state: "synced", secretId: id });
  });
  it("preserves its own secret and syncs eligible hosts while refusing paired replacement", async () => {
    const f = fixture(); await f.service.reset(); const id = f.service.view().secretId;
    const paired = host("paired", pairedOwner()); paired.remote(differentId(id));
    const local = host("local"); f.targets([paired.target, local.target]); await f.service.reconcile();
    expect(paired.request.mock.calls.map(call => call[0])).toEqual(["GET"]);
    expect(paired.secrets).toHaveLength(0); expect(f.service.view().secretId).toBe(id);
    expect(f.service.view().hosts.paired).toEqual({ state: "error", secretId: null, code: "owner_local_required" });
    expect(hash(local.secrets[0]!)).toBe(id);
    await f.service.reset();
    expect(paired.secrets).toHaveLength(0); expect(local.secrets).toHaveLength(2);
    expect(hash(local.secrets[1]!)).toBe(f.service.view().secretId);
  });
  it("requires an explicitly true ownerLocal for an existing secret, including after refreshed capabilities", async () => {
    for (const ownerLocal of [false, undefined]) {
      const f = fixture(); await f.service.reset(); const h = host("paired"); h.remote(differentId(f.service.view().secretId));
      h.target.client.capabilities = vi.fn().mockResolvedValueOnce(owner()).mockResolvedValue({ ...pairedOwner(), user: { ...pairedOwner().user, ownerLocal } });
      await f.service.onConnected(h.target);
      expect(h.secrets).toHaveLength(0);
      expect(f.service.view().hosts.paired?.code).toBe("owner_local_required");
    }
  });
  it("allows owner-local replacement of an existing different secret", async () => {
    const f = fixture(); await f.service.reset(); const h = host(); h.remote(differentId(f.service.view().secretId));
    await f.service.onConnected(h.target);
    expect(h.secrets).toHaveLength(1); expect(f.service.view().hosts.local?.state).toBe("synced");
  });
  it.each(["missing", "matching", "different", "malformed"])("honors disabled even with a %s secret ID and never sends PUT", async (kind) => {
    const f = fixture(); await f.service.reset(); const id = f.service.view().secretId;
    const h = host();
    const remoteId = kind === "missing" ? null : kind === "matching" ? id : kind === "different" ? differentId(id) : "synthetic-private-response-body";
    h.target.client.request = vi.fn(async () => ({ contractVersion: 2, secretId: remoteId, disabled: true })) as ProfileLinkTarget["client"]["request"];
    await f.service.onConnected(h.target);
    expect(h.target.client.request).toHaveBeenCalledTimes(1);
    expect(h.target.client.request).toHaveBeenCalledWith("GET", "/v2/profile-link/secret");
    expect(f.service.view().hosts.local).toEqual({ state: "ineligible", secretId: null, code: "host_disabled" });
    expect(f.service.view().secretId).toBe(id);
    expect(JSON.stringify(f.emissions)).not.toContain("synthetic-private-response-body");
  });
  it("keeps disabled hosts off across reset, reconnect and desktop restart for local and paired owners", async () => {
    for (const caps of [owner(), pairedOwner()]) {
      const f = fixture(); const h = host(); h.target.client.capabilities = async () => caps as ReturnType<typeof owner>;
      const calls: string[] = [];
      h.target.client.request = (async (method) => {
        calls.push(method);
        if (method !== "GET") throw new Error("disabled host must never receive a secret body");
        return { contractVersion: 2, secretId: null, disabled: true };
      }) as ProfileLinkTarget["client"]["request"];
      f.targets([h.target]); await f.service.reconcile(); await f.service.reset();
      f.service.onDisconnected("local", "one");
      const next = { ...h.target, epoch: "two" }; f.targets([next]); await f.service.onConnected(next);
      const restarted = new ProfileLinkService({ userData: f.userData, encryption, targets: () => [next] });
      await restarted.reconcile();
      expect(calls).toEqual(["GET", "GET", "GET", "GET"]);
      expect(f.service.view().hosts.local?.code).toBe("host_disabled");
      expect(restarted.view().hosts.local).toEqual({ state: "ineligible", secretId: null, code: "host_disabled" });
    }
  });
  it("accepts explicit disabled:false without changing initialization", async () => {
    const f = fixture(); const h = host(); const original = h.target.client.request;
    h.target.client.request = (async (method, path, body) => ({ ...await original<{ contractVersion: number; secretId: string | null }>(method, path, body), disabled: false })) as typeof original;
    await f.service.onConnected(h.target);
    expect(h.secrets).toHaveLength(1); expect(f.service.view().hosts.local?.state).toBe("synced");
  });
  it("rejects any present non-boolean disabled value without sending PUT or exposing response fields", async () => {
    for (const disabled of [null, "true", 0, 1, {}, [], undefined]) {
      const f = fixture(); const h = host();
      h.target.client.request = vi.fn(async () => ({ contractVersion: 2, secretId: null, disabled, secret: "fixture-secret" })) as ProfileLinkTarget["client"]["request"];
      await f.service.onConnected(h.target);
      expect(h.target.client.request).toHaveBeenCalledTimes(1);
      expect(f.service.view().hosts.local).toEqual({ state: "error", secretId: null, code: "bad_response" });
      expect(JSON.stringify(f.emissions)).not.toContain("fixture-secret");
    }
  });
  it("reduces a racing 403 owner_local_only to a safe code without retrying the overwrite", async () => {
    const f = fixture(); await f.service.reset(); const id = f.service.view().secretId;
    const h = host("paired", pairedOwner()); const original = h.target.client.request;
    const puts: string[] = [];
    h.target.client.request = (async (method, path, body) => {
      if (method === "PUT") {
        const secret = (body as { secret: string }).secret;
        puts.push(secret); h.remote(differentId(id));
        throw new CutexApiError(403, "owner_local_only", `synthetic echoed ${secret}`, true, { secret });
      }
      return original(method, path, body);
    }) as typeof original;
    f.targets([h.target]); await f.service.reconcile();
    expect(puts).toHaveLength(1);
    expect(f.service.view().hosts.paired).toEqual({ state: "error", secretId: null, code: "owner_local_required" });
    expect(f.service.view().secretId).toBe(id);
    expect(JSON.stringify(f.emissions)).not.toContain(puts[0]);
    expect(JSON.stringify(f.emissions)).not.toContain("synthetic echoed");
    await f.service.reconcile(); expect(puts).toHaveLength(1);
  });
  it("fails closed when OS encryption is unavailable or uses the basic_text fallback", async () => {
    for (const crypto of [{ ...encryption, isEncryptionAvailable: () => false }, { ...encryption, getSelectedStorageBackend: () => "basic_text" }]) {
      const f = fixture(crypto); const h = host(); f.targets([h.target]); await f.service.reconcile();
      expect(h.request).not.toHaveBeenCalled(); expect(f.service.view().error).toBe("storage_unavailable");
    }
  });
  it("does not silently replace a corrupted persisted secret", async () => {
    const f = fixture(); const h = host(); f.targets([h.target]); await f.service.reconcile();
    const path = join(f.userData, "profile-link/secret-v1.json"); writeFileSync(path, "synthetic corrupt secret");
    const other = new ProfileLinkService({ userData: f.userData, encryption, targets: () => [h.target] });
    await other.reconcile(); expect(other.view().error).toBe("storage_unavailable"); expect(readFileSync(path, "utf8")).toBe("synthetic corrupt secret");
  });
  it("rotates all connected hosts and retries offline hosts on reconnect", async () => {
    const f = fixture(); const a = host("a"); const b = host("b"); f.targets([a.target, b.target]); await f.service.reconcile();
    const previous = f.service.view().secretId;
    f.targets([a.target]); f.service.onDisconnected("b"); await f.service.reset();
    expect(f.service.view().secretId).not.toBe(previous); expect(a.secrets).toHaveLength(2); expect(b.secrets).toHaveLength(1);
    f.targets([a.target, b.target]); await f.service.onConnected(b.target);
    expect(b.secrets).toHaveLength(2); expect(b.secrets[1]).toBe(a.secrets[1]);
  });
  it("does not rotate memory or push a new secret when persisting the reset fails", async () => {
    let fail = false;
    const f = fixture({ ...encryption, encryptString: value => {
      if (fail) throw new Error(`synthetic encryption failure ${value}`);
      return encryption.encryptString(value);
    } });
    const h = host(); f.targets([h.target]); await f.service.reconcile();
    const previous = f.service.view().secretId;
    const saved = readFileSync(join(f.userData, "profile-link/secret-v1.json"), "utf8");
    fail = true;
    const result = await f.service.reset();
    expect(result.secretId).toBe(previous); expect(result.error).toBe("storage_unavailable");
    expect(h.secrets).toHaveLength(1);
    expect(readFileSync(join(f.userData, "profile-link/secret-v1.json"), "utf8")).toBe(saved);
    expect(JSON.stringify(f.emissions)).not.toContain("synthetic encryption failure");
  });
  it("serializes reset behind an in-flight old push, then pushes the newest secret", async () => {
    const f = fixture(); const h = host(); const entered = deferred<void>(); const release = deferred<void>();
    const original = h.target.client.request;
    h.target.client.request = (async (method, path, body) => { if (method === "PUT" && !h.secrets.length) { entered.resolve(); await release.promise; } return original(method, path, body); }) as typeof original;
    f.targets([h.target]); const first = f.service.reconcile(); await entered.promise;
    const reset = f.service.reset(); const latest = f.service.view().secretId; release.resolve(); await Promise.all([first, reset]);
    expect(h.secrets).toHaveLength(2); expect(hash(h.secrets[1]!)).toBe(latest); expect(f.service.view().hosts.local?.state).toBe("synced");
  });
  it("does not push after a stale capability reply from a disconnected connection", async () => {
    const f = fixture(); const h = host(); const wait = deferred<ReturnType<typeof owner>>(); h.target.client.capabilities = () => wait.promise;
    const work = f.service.onConnected(h.target); f.service.onDisconnected("local", "one"); wait.resolve(owner()); await work;
    expect(h.request).not.toHaveBeenCalled();
  });
  it("drops late old-epoch results and resynchronizes the current connection", async () => {
    const f = fixture(); const old = host(); const next = host(); next.target.epoch = "two";
    const wait = deferred<ReturnType<typeof owner>>(); old.target.client.capabilities = () => wait.promise;
    const first = f.service.onConnected(old.target); const second = f.service.onConnected(next.target); wait.resolve(owner()); await Promise.all([first, second]);
    expect(old.request).not.toHaveBeenCalled(); expect(next.secrets).toHaveLength(1); expect(f.service.view().hosts.local?.state).toBe("synced");
  });
  it.each([
    ["read", { ...owner(), user: { isOwner: true, scope: "read", ownerLocal: true, token: null } }, "ineligible"],
    ["chat", { ...owner(), user: { isOwner: true, scope: "chat", ownerLocal: true, token: null } }, "ineligible"],
    ["non-owner", { ...owner(), user: { isOwner: false, scope: "full", ownerLocal: true, token: null } }, "ineligible"],
    ["unsupported", { ...owner(), featureList: [] }, "unsupported"],
  ])("does not PUT a secret when access becomes %s while GET is pending", async (_label, downgraded, expected) => {
    const f = fixture(); const h = host(); const entered = deferred<void>(); const get = deferred<unknown>();
    const original = h.target.client.request;
    h.target.client.capabilities = vi.fn().mockResolvedValueOnce(owner()).mockResolvedValue(downgraded);
    h.target.client.request = (async (method, path, body) => {
      if (method === "GET") { entered.resolve(); return get.promise; }
      return original(method, path, body);
    }) as typeof original;
    const work = f.service.onConnected(h.target); await entered.promise;
    get.resolve({ contractVersion: 2, secretId: null }); await work;
    expect(h.target.client.capabilities).toHaveBeenCalledTimes(2);
    expect(h.secrets).toHaveLength(0);
    expect(h.request).not.toHaveBeenCalled();
    expect(f.service.view().hosts.local).toEqual({ state: expected, secretId: null });
  });
  it("invalidates a pending GET on same-epoch access changes before resuming with fresh capabilities", async () => {
    const f = fixture(); const old = host(); const entered = deferred<void>(); const get = deferred<unknown>();
    const original = old.target.client.request;
    old.target.client.request = (async (method, path, body) => {
      if (method === "GET") { entered.resolve(); return get.promise; }
      return original(method, path, body);
    }) as typeof original;
    const work = f.service.onConnected(old.target); await entered.promise;
    const next = host("local", { ...owner(), user: { isOwner: true, scope: "read", ownerLocal: true, token: null } });
    expect(next.target.epoch).toBe(old.target.epoch);
    f.service.onDisconnected("local", old.target.epoch);
    const replacement = f.service.onConnected(next.target);
    get.resolve({ contractVersion: 2, secretId: null }); await Promise.all([work, replacement]);
    expect(old.request).not.toHaveBeenCalled(); expect(old.secrets).toHaveLength(0);
    expect(next.request).not.toHaveBeenCalled(); expect(next.secrets).toHaveLength(0);
    expect(next.target.client.capabilities).toHaveBeenCalledOnce();
    expect(f.service.view().hosts.local).toEqual({ state: "ineligible", secretId: null });
  });
  it("never returns or logs malicious remote error text and retries on reconnect", async () => {
    const f = fixture(); const h = host(); f.targets([h.target]); await f.service.reconcile(); const secret = h.secrets[0]!;
    h.target.client.request = vi.fn(async () => { throw new Error(`server echoed ${secret}`); });
    await f.service.reconcile(); expect(f.service.view().hosts.local).toEqual({ state: "error", secretId: null, code: "sync_failed" });
    expect(JSON.stringify(f.emissions)).not.toContain(secret);
    const next = host(); next.target.epoch = "two"; await f.service.onConnected(next.target); expect(next.secrets).toHaveLength(1);
  });
  it("refuses malformed contract responses and does not PUT after an invalid GET", async () => {
    const f = fixture(); const h = host(); h.target.client.request = vi.fn(async () => ({ secretId: "bad" })) as ProfileLinkTarget["client"]["request"];
    await f.service.onConnected(h.target); expect(f.service.view().hosts.local?.code).toBe("bad_response"); expect(h.secrets).toHaveLength(0);
  });
  it("does not publish or push after disposal", async () => {
    const f = fixture(); const h = host(); const wait = deferred<ReturnType<typeof owner>>(); h.target.client.capabilities = () => wait.promise;
    const work = f.service.onConnected(h.target); f.service.dispose(); const emitted = f.emissions.length; wait.resolve(owner()); await work;
    expect(h.request).not.toHaveBeenCalled(); expect(f.emissions).toHaveLength(emitted); expect(f.service.view().secretId).toBeNull();
  });
});
