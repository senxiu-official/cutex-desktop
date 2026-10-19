// Host ownership (docs/research/host-ownership-20261019.md §1.2 / §2): `/v2/host.owner` parsing, the
// token command per connect-as mode, the "auto" decision table, hosts.json defaults, HostManager's
// add / re-pair / switch flows (ssh mocked) and the preview's mock bridge.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ssh = vi.hoisted(() => ({
  commands: [] as string[],
  tunnelFails: false,
  issueFails: null as null | { code: number; stderr: string },
}));
vi.mock("electron", () => ({ app: { getPath: () => "/tmp/cutex-test-userdata" }, safeStorage: { isEncryptionAvailable: () => true } }));
vi.mock("@cutex-desktop/cutex-client/node", () => ({ discoverLocalDaemon: () => new Promise(() => {}) }));
vi.mock("../src/main/ssh", () => ({
  SshFailure: class extends Error {},
  SshTunnel: class {},
  TunnelPidFile: class {},
  openTemporaryTunnel: vi.fn(async () => {
    if (ssh.tunnelFails) throw new Error("tunnel refused");
    return { port: 40001, close: vi.fn() };
  }),
  runSsh: vi.fn(async (_target: unknown, command: string) => {
    ssh.commands.push(command);
    if (command.includes("client-token revoke")) return { code: 0, stdout: "", stderr: "" };
    const member = command.includes("--pending");
    if (member && ssh.issueFails) return { code: ssh.issueFails.code, stdout: "", stderr: ssh.issueFails.stderr };
    const body = member
      ? { tokenId: "ct_member", label: "desktop-x", token: "tok-member", createdAt: "2026-10-19T00:00:00Z", pending: true, userId: null }
      : { tokenId: "ct_owner", label: "desktop-x", token: "tok-owner", createdAt: "2026-10-19T00:00:00Z", pending: false, userId: "owner" };
    return { code: 0, stdout: `${JSON.stringify(body)}\n`, stderr: "" };
  }),
}));

import { HostManager } from "../src/main/hosts";
import {
  decideConnectAs,
  emptyHostsFile,
  issueTokenFindingCutex,
  ownerIsMe,
  parseHostsFile,
  parseTokenIssue,
  readHostOwner,
  tokenIssueCommand,
  type HostOwner,
  type HostResult,
  type HostsFile,
  type OwnerProbe,
} from "../src/shared/hosts";
import { HOST_METHOD_NAMES, type PreloadBridge } from "../src/shared/ipc";

const ME = "116df1968daccae0";
const OTHER = "6060078263515bfd";
const owner = (fingerprint: string | null, confirmed = true): HostOwner => ({ displayName: "ema", fingerprint, confirmed, source: confirmed ? "firstRootClaim" : null });

describe("token issue command per connect-as mode", () => {
  it("member adds --pending, owner (and the default) issues as today", () => {
    expect(tokenIssueCommand("cutex", "desktop-A")).toBe("cutex management client-token issue --label desktop-A");
    expect(tokenIssueCommand("cutex", "desktop-A", "owner")).toBe("cutex management client-token issue --label desktop-A");
    expect(tokenIssueCommand("/opt/cutex", "desktop-A", "member")).toBe("/opt/cutex management client-token issue --label desktop-A --pending");
  });

  it("issueTokenFindingCutex passes the mode through (also on the discovered path)", async () => {
    const seen: string[] = [];
    const run = async (command: string) => {
      seen.push(command);
      if (command.startsWith("cutex management")) return { code: 127, stdout: "", stderr: "bash: cutex: command not found" };
      if (command.startsWith("sh -c")) return { code: 0, stdout: "try 0\ntry 1\nfound 1 /home/u/bin/cutex\n", stderr: "" };
      return { code: 0, stdout: JSON.stringify({ tokenId: "ct_1", label: "l", token: "t", createdAt: "", pending: true, userId: null }), stderr: "" };
    };
    const r = await issueTokenFindingCutex(run, "cutex", "desktop-A", () => ({ code: "exited", detail: "" }), "member");
    expect(r.ok && r.token).toMatchObject({ tokenId: "ct_1", pending: true, userId: null });
    expect(seen.filter((c) => c.includes("client-token issue"))).toEqual(["cutex management client-token issue --label desktop-A --pending", "/home/u/bin/cutex management client-token issue --label desktop-A --pending"]);
  });

  it("parseTokenIssue reads pending / userId when present (older cutex: absent)", () => {
    const base = { tokenId: "ct_1", label: "l", token: "t", createdAt: "c" };
    expect(parseTokenIssue(JSON.stringify(base))).toEqual(base);
    expect(parseTokenIssue(JSON.stringify({ ...base, pending: true, userId: null }))).toEqual({ ...base, pending: true, userId: null });
    expect(parseTokenIssue(JSON.stringify({ ...base, pending: false, userId: "u-1" }))).toEqual({ ...base, userId: "u-1" });
    expect(parseTokenIssue(JSON.stringify({ ...base, userId: 7 }))).toEqual(base);
  });
});

describe("/v2/host owner", () => {
  it("is parsed defensively: absent → null, bad fields dropped, unconfirmed without a fingerprint", () => {
    expect(readHostOwner({ hostId: "H", platform: "linux" })).toBeNull();
    expect(readHostOwner(null)).toBeNull();
    expect(readHostOwner({ owner: null })).toBeNull();
    expect(readHostOwner({ owner: "ema" })).toBeNull();
    expect(readHostOwner({ owner: { displayName: " ema ", fingerprint: OTHER.toUpperCase(), confirmed: true, source: "audit" } })).toEqual({ displayName: "ema", fingerprint: OTHER, confirmed: true, source: "audit" });
    expect(readHostOwner({ owner: { displayName: "", fingerprint: "zz", confirmed: true, source: "weird" } })).toEqual({ displayName: null, fingerprint: null, confirmed: false, source: null });
    expect(readHostOwner({ owner: {} })).toEqual({ displayName: null, fingerprint: null, confirmed: false, source: null });
  });

  it("ownerIsMe: only a confirmed owner with a fingerprint and a known own fingerprint", () => {
    expect(ownerIsMe(owner(ME), ME)).toBe(true);
    expect(ownerIsMe(owner(ME), "116d f196 8dac cae0")).toBe(true);
    expect(ownerIsMe(owner(OTHER), ME)).toBe(false);
    expect(ownerIsMe(owner(ME, false), ME)).toBeNull();
    expect(ownerIsMe(owner(ME), null)).toBeNull();
    expect(ownerIsMe(null, ME)).toBeNull();
  });
});

describe("auto connect-as decision", () => {
  const probe = (o: HostOwner | null, capability = true, mine: string | null = ME): OwnerProbe => ({ ok: true, capability, owner: o, myFingerprint: mine });
  it.each<[string, OwnerProbe, string, string]>([
    ["owner is someone else", probe(owner(OTHER)), "member", "ownerIsSomeoneElse"],
    ["owner is me", probe(owner(ME)), "owner", "ownerIsMe"],
    ["owner unconfirmed", probe(owner(null, false)), "owner", "ownerUnconfirmed"],
    ["no capability (older cutex)", probe(null, false), "owner", "noCapability"],
    ["capability but no owner field", probe(null, true), "owner", "noCapability"],
    ["owner field without the capability", probe(owner(OTHER), false), "owner", "noCapability"],
    ["own key unknown", probe(owner(OTHER), true, null), "owner", "noOwnKey"],
    ["probe error", { ok: false, reason: "boom" }, "owner", "probeFailed"],
  ])("%s → %s", (_name, p, connectAs, reason) => {
    expect(decideConnectAs(p)).toEqual({ connectAs, reason });
  });
});

describe("hosts.json connectAs", () => {
  it("old entries default to owner; member is kept", () => {
    const f = parseHostsFile({
      version: 2,
      hosts: [
        { id: "ssh-aaaa1111", target: "workstation", remotePort: 24270, cutexPath: "cutex", tokenId: "ct_1" },
        { id: "ssh-bbbb2222", target: "ema@hachimi", connectAs: "member" },
        { id: "ssh-cccc3333", target: "alpha", connectAs: "root" },
      ],
    });
    expect(f.hosts.map((h) => h.connectAs)).toEqual(["owner", "member", "owner"]);
    expect(parseHostsFile({ hosts: [{ id: "ssh-aaaa1111", target: "workstation" }] }).hosts[0]!.connectAs).toBe("owner");
  });
});

describe("HostManager connect-as flows (ssh mocked)", () => {
  const STORED = "ssh-dddd4444";
  function harness(opts: { probe?: OwnerProbe | Error; myFingerprint?: string | null; stored?: "owner" | "member" | null } = {}) {
    const file: HostsFile = emptyHostsFile();
    if (opts.stored !== undefined) file.hosts.push({ id: STORED, label: "hachimi", target: "ema@hachimi", remotePort: 24270, cutexPath: "cutex", tokenId: "ct_old", createdAt: "", lastConnectedAt: null, autoConnect: false, color: "#f97316", platform: "linux", ...(opts.stored ? { connectAs: opts.stored } : {}) });
    const tokens = new Map<string, string>();
    const deleted: { credential: string; tokenId: string }[] = [];
    const opened: string[] = [];
    const manager = Object.assign(Object.create(HostManager.prototype), {
      file,
      conns: new Map(),
      scope: { kind: "host", id: "local" },
      local: { identity: { view: () => ({ publicKey: "k", fingerprint: opts.myFingerprint === undefined ? ME : opts.myFingerprint, claims: {} }) } },
      tokens: { get: (id: string) => tokens.get(id) ?? null, has: (id: string) => tokens.has(id), set: (id: string, t: string) => void tokens.set(id, t), delete: (id: string) => void tokens.delete(id) },
      pids: {},
      emit: () => {},
      save() {},
      open: (id: string) => void opened.push(id),
      promptSession: () => ({ close() {}, cancelled: false }),
      ownerProbe: async () => {
        if (opts.probe instanceof Error) throw opts.probe;
        return opts.probe ?? { ok: true, capability: false, owner: null, myFingerprint: null };
      },
      deleteToken: async (_port: number, credential: string, _host: unknown, tokenId: string) => void deleted.push({ credential, tokenId }),
    }) as HostManager;
    const host = (id: string) => (manager as unknown as { file: HostsFile }).file.hosts.find((h) => h.id === id);
    return { manager, tokens, deleted, opened, host };
  }
  const issued = () => ssh.commands.filter((c) => c.includes("client-token issue")).map((c) => (c.includes("--pending") ? "member" : "owner"));
  const okResult = (r: HostResult) => {
    if (!r.ok) throw new Error(`pairing failed: ${r.error.code}`);
    return r;
  };

  beforeEach(() => {
    ssh.commands = [];
    ssh.tunnelFails = false;
    ssh.issueFails = null;
  });

  it("member: one issue with --pending, stored as member", async () => {
    const h = harness();
    const r = okResult(await h.manager.addSshHost({ target: "ema@hachimi", connectAs: "member" }));
    expect(issued()).toEqual(["member"]);
    expect(r).toMatchObject({ connectAs: "member", pending: true, userId: null });
    expect(h.host(r.hostId)?.connectAs).toBe("member");
    expect(h.tokens.get(r.hostId)).toBe("tok-member");
    expect(h.deleted).toEqual([]);
  });

  it("owner: today's command, stored as owner", async () => {
    const h = harness();
    const r = okResult(await h.manager.addSshHost({ target: "ema@hachimi", connectAs: "owner" }));
    expect(issued()).toEqual(["owner"]);
    expect(r.connectAs).toBe("owner");
    expect(h.tokens.get(r.hostId)).toBe("tok-owner");
  });

  it("auto, owner is someone else: keeps the member token", async () => {
    const h = harness({ probe: { ok: true, capability: true, owner: owner(OTHER), myFingerprint: ME } });
    const r = okResult(await h.manager.addSshHost({ target: "ema@hachimi" }));
    expect(issued()).toEqual(["member"]);
    expect(r).toMatchObject({ connectAs: "member", autoReason: "ownerIsSomeoneElse" });
    expect(h.tokens.get(r.hostId)).toBe("tok-member");
    expect(h.host(r.hostId)?.connectAs).toBe("member");
    expect(h.deleted).toEqual([]);
    expect(h.opened).toEqual([r.hostId]);
  });

  it.each<[string, OwnerProbe | Error, string]>([
    ["owner is me", { ok: true, capability: true, owner: owner(ME), myFingerprint: ME }, "ownerIsMe"],
    ["owner unconfirmed", { ok: true, capability: true, owner: owner(null, false), myFingerprint: ME }, "ownerUnconfirmed"],
    ["no capability", { ok: true, capability: false, owner: null, myFingerprint: ME }, "noCapability"],
    ["probe error", new Error("403 forbidden"), "probeFailed"],
  ])("auto, %s: issues an owner token and revokes the member one", async (_name, probe, reason) => {
    const h = harness({ probe });
    const r = okResult(await h.manager.addSshHost({ target: "ema@hachimi", connectAs: "auto" }));
    expect(issued()).toEqual(["member", "owner"]);
    expect(r).toMatchObject({ connectAs: "owner", autoReason: reason });
    expect(h.tokens.get(r.hostId)).toBe("tok-owner");
    expect(h.host(r.hostId)?.connectAs).toBe("owner");
    // Revoked with the owner credential through the probe's tunnel.
    expect(h.deleted).toEqual([{ credential: "tok-owner", tokenId: "ct_member" }]);
  });

  it("auto, tunnel cannot open: owner, and the member token is revoked over the CLI", async () => {
    ssh.tunnelFails = true;
    const h = harness({ probe: { ok: true, capability: true, owner: owner(OTHER), myFingerprint: ME } });
    const r = okResult(await h.manager.addSshHost({ target: "ema@hachimi" }));
    expect(r).toMatchObject({ connectAs: "owner", autoReason: "probeFailed" });
    expect(ssh.commands.at(-1)).toBe("cutex management client-token revoke ct_member");
  });

  it("auto, cutex refuses --pending: today's owner token", async () => {
    ssh.issueFails = { code: 2, stderr: "error: unexpected argument '--pending' found" };
    const h = harness();
    const r = okResult(await h.manager.addSshHost({ target: "ema@hachimi" }));
    expect(issued()).toEqual(["member", "owner"]);
    expect(r).toMatchObject({ connectAs: "owner", autoReason: "probeFailed" });
  });

  it("auto, ssh auth fails: reported, no second try", async () => {
    ssh.issueFails = { code: 255, stderr: "user@host: Permission denied (publickey)." };
    const h = harness();
    const r = await h.manager.addSshHost({ target: "ema@hachimi" });
    expect(r).toMatchObject({ ok: false, error: { code: "auth" } });
    expect(issued()).toEqual(["member"]);
  });

  it("refuses an unknown connectAs", async () => {
    const h = harness();
    expect(await h.manager.addSshHost({ target: "ema@hachimi", connectAs: "root" as never })).toEqual({ ok: false, error: { code: "badInput", detail: "connectAs" } });
  });

  it("re-pair keeps the stored mode (member), an old entry re-pairs as owner", async () => {
    const member = harness({ stored: "member" });
    okResult(await member.manager.pairSshHost(STORED));
    expect(issued()).toEqual(["member"]);
    expect(member.host(STORED)).toMatchObject({ connectAs: "member", tokenId: "ct_member" });
    ssh.commands = [];
    const old = harness({ stored: null });
    okResult(await old.manager.pairSshHost(STORED));
    expect(issued()).toEqual(["owner"]);
    expect(old.host(STORED)?.connectAs).toBe("owner");
  });

  it("setSshConnectAs re-issues in that mode and revokes the old token", async () => {
    const h = harness({ stored: "owner" });
    const r = okResult(await h.manager.setSshConnectAs(STORED, "member"));
    expect(r).toMatchObject({ connectAs: "member", pending: true });
    expect(h.host(STORED)).toMatchObject({ connectAs: "member", tokenId: "ct_member" });
    expect(h.tokens.get(STORED)).toBe("tok-member");
    await vi.waitFor(() => expect(ssh.commands).toContain("cutex management client-token revoke ct_old"));
    expect(await h.manager.setSshConnectAs(STORED, "auto" as never)).toEqual({ ok: false, error: { code: "badInput", detail: "connectAs" } });
    expect(await h.manager.setSshConnectAs("ssh-gone0000", "owner")).toEqual({ ok: false, error: { code: "badInput", detail: "host" } });
  });

  it("the host list shows connectAs (old entries: owner) and setSshConnectAs is a host method", async () => {
    const h = harness({ stored: null });
    const view = (await h.manager.hosts()).hosts.find((x) => x.id === STORED);
    expect(view?.connectAs).toBe("owner");
    expect(HOST_METHOD_NAMES).toContain("setSshConnectAs");
  });
});

describe("mock bridge host ownership", () => {
  async function install(search = ""): Promise<PreloadBridge> {
    vi.resetModules();
    vi.useFakeTimers();
    const win: { cutex?: PreloadBridge } = {};
    vi.stubGlobal("window", win);
    vi.stubGlobal("location", { search });
    vi.stubGlobal("document", { title: "" });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const { installMockBridge } = await import("../src/renderer/src/dev/mockBridge");
    installMockBridge();
    return win.cutex!;
  }
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("HOST-A's owner is this desktop, workstation's someone else; only this machine may set it", async () => {
    const bridge = await install();
    const identity = await bridge.api.identityState();
    expect(await bridge.api.hostOwner()).toMatchObject({ confirmed: true, fingerprint: identity.fingerprint });
    await bridge.api.connectHost("ssh-7a3f01c2", true);
    await vi.advanceTimersByTimeAsync(3000);
    const ws = bridge.apiFor!("ssh-7a3f01c2");
    const other = await ws.hostOwner();
    expect(other).toMatchObject({ confirmed: true, displayName: "ema" });
    expect(other!.fingerprint).not.toBe(identity.fingerprint);
    expect(await ws.setOwnerPerson("k".repeat(43))).toMatchObject({ ok: false, error: { code: "owner_person_local_only" } });
    expect((await bridge.api.capabilities())?.featureList).toContain("host-owner-person");
  });

  it("?ownerunconfirmed: 是我 confirms it; ?legacy: no owner", async () => {
    const bridge = await install("?ownerunconfirmed");
    expect(await bridge.api.hostOwner()).toMatchObject({ confirmed: false, fingerprint: null });
    const r = await bridge.api.setOwnerPerson((await bridge.api.identityState()).publicKey!);
    expect(r).toMatchObject({ ok: true, value: { confirmed: true, source: "local" } });
    expect(await bridge.api.hostOwner()).toMatchObject({ confirmed: true });
    const legacy = await install("?legacy");
    expect(await legacy.api.hostOwner()).toBeNull();
  });

  it("adding a host on auto: member when its owner is someone else; setSshConnectAs switches", async () => {
    const bridge = await install();
    const add = bridge.api.addSshHost({ target: "ema@shared-box" });
    await vi.advanceTimersByTimeAsync(1500);
    const r = await add;
    expect(r).toMatchObject({ ok: true, connectAs: "member", pending: true, autoReason: "ownerIsSomeoneElse" });
    const id = (r as { hostId: string }).hostId;
    expect((await bridge.api.hosts()).hosts.find((h) => h.id === id)?.connectAs).toBe("member");
    const sw = bridge.api.setSshConnectAs(id, "owner");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await sw).toMatchObject({ ok: true, connectAs: "owner" });
    expect((await bridge.api.hosts()).hosts.find((h) => h.id === id)?.connectAs).toBe("owner");
    const plain = bridge.api.addSshHost({ target: "lab-gpu" });
    await vi.advanceTimersByTimeAsync(1500);
    expect(await plain).toMatchObject({ ok: true, connectAs: "owner", autoReason: "noCapability" });
  });
});
