import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Session } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BROWSER_IDENTITY_ID as DEFAULT_ID, browserIdentityPartition } from "../src/shared/browserIdentity";
import { browserAttachSource, evaluateBrowserAttach, matchBrowserPartition } from "../src/main/browser/attachPolicy";
import { parseBrowserRequest } from "../src/main/browser/channel";
import { BrowserIdentities, cleanDeletedBrowserPartitions } from "../src/main/browser/identity/identities";
import { partitionDirectory } from "../src/main/browser/identity/disk";
import { BrowserRegistry } from "../src/main/browser/registry";
import { createBrowserTabIdentity } from "../src/main/browser/tabIdentity";
import { BrowserDesktopLoopbackStore } from "../src/main/browser/desktopLoopback";
import { BrowserSitePermissionStore } from "../src/main/browser/sitePermissions";
import { BrowserCertificateExceptionStore } from "../src/main/browser/certificateExceptions";

const NAMED = "aabbccdd";
const roots: string[] = [];
function fixture() {
  const userData = mkdtempSync(join(tmpdir(), "cutex-browser-identities-"));
  roots.push(userData);
  const sessions = new Map<string, ReturnType<typeof fakeSession>>();
  const sessionFor = (partition: string) => {
    if (!sessions.has(partition)) sessions.set(partition, fakeSession());
    return sessions.get(partition)!;
  };
  let hosts = ["local", "ssh-fixture"];
  const options = {
    userData, sessionData: userData, hostIds: () => hosts, tabs: () => [],
    session: (partition: string) => sessionFor(partition) as unknown as Session,
    close: vi.fn(), revoke: vi.fn(), forgetAdmissions: vi.fn(), forgetHostAdmissions: vi.fn(),
    reload: vi.fn(), dropIdentity: vi.fn(async () => {}), dropHost: vi.fn(async () => {}),
    retentionChanged: vi.fn(), emit: vi.fn(),
  };
  return { userData, options, sessionFor, setHosts: (next: string[]) => { hosts = next; }, ids: new BrowserIdentities(options) };
}

function fakeSession() {
  return {
    getCacheSize: vi.fn(async () => 2),
    cookies: { get: vi.fn(async () => [
      { domain: ".Example.invalid", get value() { throw Error("should only read the domain"); } },
      { domain: "example.invalid" }, { domain: "other.invalid" },
    ]) },
    clearData: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}),
    clearCache: vi.fn(async () => {}), clearAuthCache: vi.fn(async () => {}),
  };
}

function retainedFile(root: string, id: string, host = "local") {
  const directory = partitionDirectory(root, id, host);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, "fixture.bin");
  writeFileSync(file, "pages");
  return file;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("main browser identity lifecycle", () => {
  it("keeps legacy profile data, persists identity preferences and checks revisions", async () => {
    const f = fixture(), old = retainedFile(f.userData, DEFAULT_ID);
    expect(f.ids.partition(DEFAULT_ID, "local")).toBe("persist:browser-local");
    const profile = await f.ids.create("Work", "violet");
    expect(profile).toMatchObject({ name: "Work", initial: "W", color: "violet", revision: 1, openTabs: 0 });
    expect(profile.id).toMatch(/^[a-f0-9]{32}$/);
    expect(f.ids.partition(profile.id, "local")).not.toBe(f.ids.partition(profile.id, "ssh-fixture"));
    await f.ids.update(profile.id, 1, { name: "Mail" });
    await expect(f.ids.update(profile.id, 1, { name: "Old" })).rejects.toThrow("revision_conflict");
    await f.ids.setCurrent(profile.id);
    await f.ids.prefs({ historyRetention: "30d", searchEngine: "bing" });
    const reopened = new BrowserIdentities(f.options);
    expect(reopened.state()).toMatchObject({ current: profile.id,
      identities: [{ id: DEFAULT_ID, hosts: ["local"] }, { id: profile.id, name: "Mail", revision: 2 }] });
    await expect(reopened.prefs()).resolves.toMatchObject({ historyRetention: "30d", searchEngine: "bing" });
    await expect(reopened.storage(DEFAULT_ID)).resolves.toEqual([{ hostId: "local", siteDataBytes: 3, cacheBytes: 2 }]);
    await expect(reopened.remove(DEFAULT_ID)).rejects.toThrow("default_identity");
    expect(readFileSync(old, "utf8")).toBe("pages");
  });

  it("clears requested data in one partition and returns only cookie domains", async () => {
    const f = fixture(), { id } = await f.ids.create("Work", "teal");
    const target = f.sessionFor(f.ids.partition(id, "local"));
    await expect(f.ids.signedInSites(id, "local")).resolves.toEqual(["example.invalid", "other.invalid"]);
    await f.ids.clearData({ identityId: id, hostId: "local", types: ["siteData", "cache"], origins: ["https://example.invalid"] });
    expect(target.clearData).toHaveBeenCalledOnce();
    expect(target.clearData).toHaveBeenCalledWith({ // both choices mean both Electron data types
      dataTypes: expect.arrayContaining(["cookies", "localStorage", "indexedDB", "cache"]), origins: ["https://example.invalid"], originMatchingMode: "origin-in-all-contexts",
    });
    expect(f.options.reload).toHaveBeenCalledWith(id, "local");
    expect(f.sessionFor("persist:browser-local").clearData).not.toHaveBeenCalled();
    await expect(f.ids.clearData({ identityId: id, hostId: "local", types: ["siteData"], origins: ["https://user@invalid"] })).rejects.toThrow("invalid_browser_origin");
  });

  it("closes and clears an identity on each host before queuing deletion at the next startup", async () => {
    const f = fixture(), { id } = await f.ids.create("Work", "teal");
    const old = retainedFile(f.userData, DEFAULT_ID), own = retainedFile(f.userData, id);
    const remote = retainedFile(f.userData, id, "ssh-fixture");
    const primary = f.sessionFor(browserIdentityPartition(id, "local"));
    await f.ids.signOut(id);
    expect(f.options.close).toHaveBeenCalledWith(id);
    expect(f.options.revoke).toHaveBeenCalledWith(browserIdentityPartition(id, "ssh-fixture"));
    expect(primary.clearStorageData).toHaveBeenCalledOnce();
    expect(primary.clearAuthCache).toHaveBeenCalledOnce();
    expect(f.options.forgetAdmissions).toHaveBeenCalledWith(id);
    expect(f.ids.has(id)).toBe(true);
    await f.ids.setCurrent(id);
    await f.ids.remove(id);
    expect(f.options.dropIdentity).toHaveBeenCalledWith(id);
    expect(f.ids.current()).toBe(DEFAULT_ID);
    expect(f.ids.identityOfPartition(browserIdentityPartition(id, "local"))).toBeUndefined();
    expect(existsSync(own)).toBe(true);
    cleanDeletedBrowserPartitions(f.userData, f.userData);
    expect(existsSync(own)).toBe(false);
    expect(existsSync(remote)).toBe(false);
    expect(existsSync(old)).toBe(true);
    const persisted = JSON.parse(readFileSync(join(f.userData, "browser-identities.json"), "utf8"));
    expect(persisted).toMatchObject({ pendingPartitions: [], tombstones: [{ id, revision: 2 }] });
  });

  it("removes all profiles of a removed host and keeps the same profile on other hosts", async () => {
    const f = fixture(), { id } = await f.ids.create("Work", "teal");
    const local = retainedFile(f.userData, id), remote = retainedFile(f.userData, id, "ssh-fixture");
    f.ids.reconcileHosts(f.options.hostIds());
    f.setHosts(["local"]);
    f.ids.reconcileHosts(f.options.hostIds());
    expect(f.options.dropHost).toHaveBeenCalledWith("ssh-fixture");
    cleanDeletedBrowserPartitions(f.userData, f.userData);
    expect(existsSync(remote)).toBe(false);
    expect(existsSync(local)).toBe(true);
  });
});

describe("browser identity admission", () => {
  it("admits an owner identity only via the live lookup and an exact one-use reservation", () => {
    const partition = browserIdentityPartition(NAMED, "local");
    const identityOfPartition = (value: string) => value === partition ? { identityId: NAMED, hostId: "local" } : undefined;
    expect(matchBrowserPartition(partition, ["local"])).toBeUndefined();
    expect(matchBrowserPartition(partition, ["local"], identityOfPartition)).toEqual({ identityId: NAMED, hostId: "local", pool: "owner" });
    expect(matchBrowserPartition("persist:browser-agent-local", ["local"], identityOfPartition)).toEqual({ hostId: "local", pool: "agent" });
    expect(matchBrowserPartition(partition, ["ssh-fixture"], identityOfPartition)).toBeUndefined();
    const attachId = "a".repeat(64);
    const attach = (held: string) => evaluateBrowserAttach({
      moduleEnabled: true, popupGuardInstalled: true, registeredHostIds: ["local"], identityOfPartition,
      appWebContentsId: 1, senderWebContentsId: 1, reservation: { attachId, hostId: "local", partition: held },
      params: { partition, src: browserAttachSource(attachId), preload: "should-be-removed" }, webPreferences: { partition, nodeIntegration: true },
    });
    expect(attach("persist:browser-local")).toMatchObject({ allowed: false, reason: "partition_mismatch" });
    expect(attach(partition)).toMatchObject({ allowed: true, partition });
  });

  it("retains named provenance on restart and refuses reassignment to default or agent", () => {
    let raw: string | undefined;
    const storage = { read: () => raw, write: (value: string) => { raw = value; } };
    const tabKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    createBrowserTabIdentity(storage).registerOwner("local", tabKey, NAMED);
    const fromDisk = createBrowserTabIdentity(storage);
    expect(fromDisk.identity("local", tabKey)).toBe(NAMED);
    expect(() => fromDisk.registerOwner("local", tabKey)).toThrow("permission_denied");
    expect(() => fromDisk.register("local", tabKey)).toThrow("permission_denied");
    const registry = new BrowserRegistry();
    registry.registerHost("local", "fixture");
    expect(registry.ensure("local", tabKey, "owner", NAMED).identityId).toBe(NAMED);
    expect(() => registry.ensure("local", tabKey, "owner", DEFAULT_ID)).toThrow("partition cannot change");
  });

  it("parses explicit identity picks for owner IPC only", () => {
    expect(parseBrowserRequest({ op: "reserveOwnerTab", browserIdentityId: NAMED })).toEqual({ op: "reserveOwnerTab", browserIdentityId: NAMED });
    const open = { op: "open", tabKey: "x", url: "about:blank", identity: { browserIdentityId: NAMED } };
    expect(parseBrowserRequest(open)).toEqual(open);
    expect(() => parseBrowserRequest({ ...open, identity: { browserIdentityId: NAMED, agentOpened: true } })).toThrow("invalid_browser_request");
  });

  it("assigns old permissions, certificate exceptions and loopback grants to default alone", () => {
    const site = "https://localhost", fp = "sha256/" + "A".repeat(43) + "=";
    const memory = (stored: unknown) => {
      let data = JSON.stringify(stored);
      return { read: () => data, write: (_path: string, text: string) => { data = text; } };
    };
    const permissionIO = memory({ version: 1, entries: [{ pool: "owner", origin: site, permission: "notifications", allow: true }] });
    const permissions = new BrowserSitePermissionStore("fixture", permissionIO);
    const certificateIO = memory({ exceptions: { [`local ${site}`]: fp } });
    const certificates = new BrowserCertificateExceptionStore("fixture", certificateIO);
    const loopbackIO = memory({ desktopLoopback: { "ssh-fixture": true } });
    const loopback = new BrowserDesktopLoopbackStore("fixture", loopbackIO);
    expect(permissions.get("owner", site, "notifications")).toBe(true);
    expect(permissions.get("owner", site, "notifications", NAMED)).toBeUndefined();
    expect(certificates.matches("local", site, fp)).toBe(true);
    expect(certificates.matches("local", site, fp, NAMED)).toBe(false);
    expect(loopback.enabled("ssh-fixture")).toBe(true);
    expect(loopback.enabled("ssh-fixture", NAMED)).toBe(false);

    permissions.set("owner", site, "notifications", false, NAMED);
    certificates.set("local", site, fp, NAMED);
    loopback.set("ssh-fixture", true, NAMED);
    new BrowserSitePermissionStore("fixture", permissionIO).forget({ pool: "owner", origin: site, browserIdentityId: NAMED });
    new BrowserCertificateExceptionStore("fixture", certificateIO).forget(NAMED);
    new BrowserDesktopLoopbackStore("fixture", loopbackIO).forgetIdentity(NAMED);
    expect(new BrowserSitePermissionStore("fixture", permissionIO).get("owner", site, "notifications")).toBe(true);
    expect(new BrowserCertificateExceptionStore("fixture", certificateIO).matches("local", site, fp)).toBe(true);
    expect(new BrowserDesktopLoopbackStore("fixture", loopbackIO).enabled("ssh-fixture")).toBe(true);
  });
});
