// Local modules, main side (docs/desktop-modules.md §23.14): the switch, the owner's confirm, the same checks
// as a signed pack, the trust record, changed bytes, taken ids, failed starts.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanDialogText, installConfirmed, installDetail } from "../src/main/localModulePrompts";
import { LOCAL_FAILED_STARTS, localPacksDefault, ModulePackService, type LocalPackPrompt, type LocalPacksOptions } from "../src/main/modulePacks";
import { parsePublicKey } from "../src/main/minisign";
import type { Transport } from "../src/main/updateTransport";
import { MODULE_PACK_TEST_PUBLIC_KEY, packFileUrl, parseModulePacksRequest, type ModuleIndexPack } from "../src/shared/modulePacks";
import { signMinisig, testKey } from "../scripts/module-packs/minisign.mjs";
import { writeTarGz } from "../scripts/module-packs/tar.mjs";

vi.mock("electron", () => ({ dialog: {} }));

const BASE = "https://github.com/senxiu-official/cutex-desktop/releases/download/modules-release";
const source = { indexUrl: `${BASE}/modules.json`, signatureUrl: `${BASE}/modules.json.minisig`, extraOrigins: [], keys: [parsePublicKey(MODULE_PACK_TEST_PUBLIC_KEY)], testKey: true };
const sha = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");

const ENTRY = (id: string) => `export const moduleApi = "^1.16"; export const module = { id: "${id}", titleKey: "${id}.title" };`;
function packFiles(id: string, version: string, extra: Record<string, unknown> = {}): Record<string, string> {
  return { "index.js": ENTRY(id), "pack.json": JSON.stringify({ id, version, moduleApi: "^1.16", entry: "index.js", styles: [], host: {}, ...extra }) };
}
const targz = (files: Record<string, string>) => writeTarGz(Object.entries(files).map(([path, data]) => ({ path, data })));

/** One raw ustar member, for what the pack writer refuses to write. */
function rawMember(name: string, type: string, data = ""): Buffer {
  const body = Buffer.from(data);
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "latin1");
  h.write("0000644\0", 100, "latin1");
  h.write("0000000\0", 108, "latin1");
  h.write("0000000\0", 116, "latin1");
  h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  h.write("00000000000\0", 136, "latin1");
  h.write("        ", 148, "latin1");
  h.write(type, 156, "latin1");
  h.write("ustar\0", 257, "latin1");
  h.write("00", 263, "latin1");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([h, body, pad]);
}
const rawTarGz = (...members: Buffer[]) => gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));

function net(files: Map<string, Buffer | string> = new Map()): Transport {
  return (async (url: string) => {
    const body = files.get(url);
    if (body === undefined) return { status: 404, header: () => null, body: (async function* () {})(), cancel: () => {} };
    const bytes = Buffer.from(body);
    return { status: 200, header: (n: string) => (n === "content-length" ? String(bytes.length) : null), body: (async function* () { yield bytes; })(), cancel: () => {} };
  }) as unknown as Transport;
}

/** A published index with one signed pack (the same pack-file shape as a local one). */
function published(id: string, version: string): Map<string, Buffer | string> {
  const files = packFiles(id, version);
  const archive = targz(files);
  const entry: ModuleIndexPack = {
    id, version, moduleApi: "^1.16", entry: "index.js", styles: [], host: {},
    files: Object.entries(files).map(([path, data]) => ({ path, size: Buffer.byteLength(data), sha256: sha(Buffer.from(data)) })),
    archive: { name: `${id}-${version}.tar.gz`, url: `${BASE}/${id}-${version}.tar.gz`, size: archive.length, sha256: sha(archive) },
  };
  const bytes = Buffer.from(JSON.stringify({ schema: 1, serial: 100, generatedAt: "2026-11-08T00:00:00Z", packs: [entry] }));
  return new Map<string, Buffer | string>([[`${BASE}/modules.json`, bytes], [`${BASE}/modules.json.minisig`, signMinisig(bytes, "modules.json", testKey())], [entry.archive.url, archive]]);
}

let root: string;
let scratch: string;
let picked: string | null;
let confirmAnswer: boolean;
let allowAnswer: boolean;
let prompted: LocalPackPrompt[];
let allowAsked: number;

function service(opts: Partial<LocalPacksOptions> & { transport?: Transport } = {}) {
  const { transport, ...local } = opts;
  return new ModulePackService({
    root, source, transport: transport ?? net(), appModuleApi: "1.28",
    local: {
      defaultAllowed: true,
      reservedIds: ["claude-science"],
      prompts: {
        pickFile: async () => picked,
        confirmInstall: async (pack) => { prompted.push(pack); return confirmAnswer; },
        confirmAllow: async () => { allowAsked += 1; return allowAnswer; },
      },
      ...local,
    },
  });
}

function fileWith(bytes: Buffer, name = "a.tar.gz"): string {
  picked = join(scratch, name);
  writeFileSync(picked, bytes);
  return picked;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cutex-local-root-"));
  scratch = mkdtempSync(join(tmpdir(), "cutex-local-file-"));
  picked = null;
  confirmAnswer = true;
  allowAnswer = true;
  prompted = [];
  allowAsked = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const COMMIT = "a".repeat(40);
const selfBuilt = { commit: COMMIT, committedAt: "2026-11-08T00:00:00Z", sourceDir: "/src", nodeDir: "/node" };

describe("the build's default", () => {
  it("on for dev runs and self-built packages; off for a CI release package and anything it cannot read", () => {
    expect(localPacksDefault({ packaged: false, packageJson: null })).toBe(true);
    expect(localPacksDefault({ packaged: true, packageJson: selfBuilt })).toBe(true);
    expect(localPacksDefault({ packaged: true, packageJson: { ...selfBuilt, sourceDir: null, nodeDir: null, releasePage: "https://github.com/o/r/releases" } })).toBe(false);
    expect(localPacksDefault({ packaged: true, packageJson: null })).toBe(false);
    expect(localPacksDefault({ packaged: true, packageJson: { name: "x" } })).toBe(false);
  });

  it("does not read the switchable channel", () => {
    expect(localPacksDefault({ packaged: true, packageJson: { ...selfBuilt, channel: "release" } })).toBe(true);
    expect(localPacksDefault({ packaged: true, packageJson: { ...selfBuilt, releasePage: "https://github.com/o/r/releases", channel: "main" } })).toBe(false);
  });
});

describe("the switch", () => {
  it("a public build starts off: install does nothing, not even the file dialog", async () => {
    const pick = vi.fn(async () => fileWith(targz(packFiles("hello", "1.0.0"))));
    const s = service({ defaultAllowed: false, prompts: { pickFile: pick, confirmInstall: async () => true, confirmAllow: async () => true } });
    expect(s.view().local.allowed).toBe(false);
    const view = await s.installLocal();
    expect(pick).not.toHaveBeenCalled();
    expect(view.installed).toEqual([]);
    expect(view.local.error).toBe("local modules are off");
  });

  it("turning on takes main's own yes, and a no leaves it off; turning off needs none", async () => {
    allowAnswer = false;
    const s = service({ defaultAllowed: false });
    expect((await s.allowLocal(true)).local.allowed).toBe(false);
    allowAnswer = true;
    expect((await s.allowLocal(true)).local.allowed).toBe(true);
    expect(allowAsked).toBe(2);
    expect((await s.allowLocal(false)).local.allowed).toBe(false);
    expect(allowAsked).toBe(2);
  });

  it("the choice outlives a restart and beats the build's default", async () => {
    await service({ defaultAllowed: false }).allowLocal(true);
    expect(service({ defaultAllowed: false }).view().local.allowed).toBe(true);
    await service({ defaultAllowed: true }).allowLocal(false);
    expect(service({ defaultAllowed: true }).view().local.allowed).toBe(false);
  });

  it("a module reading the app's own files: a dev build says so in main's dialog and its view; a public build does neither", async () => {
    const internalFiles = packFiles("hello", "1.0.0", { host: { react: ["useState"], "@cutex-desktop/app/store": ["useApp"] } });
    fileWith(targz(internalFiles));
    const dev = service({ internal: true });
    const devView = await dev.installLocal();
    expect(devView.local.internal).toBe(true);
    expect(devView.installed.map((p) => p.id)).toEqual(["hello"]);
    expect(prompted.at(-1)?.internal).toBe(true);
    expect(installDetail(prompted.at(-1)!, "zh-CN")).toContain("使用内部接口，可能随应用更新失效");
    expect(installDetail(prompted.at(-1)!, "en")).toContain("Uses internal interfaces; may break with an app update");

    rmSync(root, { recursive: true, force: true });
    fileWith(targz(internalFiles));
    const pub = service({ internal: false });
    const pubView = await pub.installLocal();
    expect(pubView.local.internal).toBe(false);
    expect(prompted.at(-1)?.internal).toBeUndefined();
    expect(installDetail(prompted.at(-1)!, "zh-CN")).not.toContain("内部接口");

    // Public-API only: no line, on any build.
    rmSync(root, { recursive: true, force: true });
    fileWith(targz(packFiles("hello", "1.0.0", { host: { react: ["useState"], "@cutex-desktop/module-api": ["defineModule"] } })));
    await service({ internal: true }).installLocal();
    expect(prompted.at(-1)?.internal).toBeUndefined();
  });

  it("without the local option nothing local exists", async () => {
    const s = new ModulePackService({ root, source, transport: net(), appModuleApi: "1.28" });
    expect(s.view().local.allowed).toBe(false);
    expect((await s.allowLocal(true)).local.allowed).toBe(false);
  });
});

describe("what the renderer can say", () => {
  it("names no path and no answer", () => {
    expect(parseModulePacksRequest({ op: "installLocal" })).toEqual({ op: "installLocal" });
    expect(() => parseModulePacksRequest({ op: "installLocal", path: "C:/x.tar.gz" })).toThrow();
    expect(() => parseModulePacksRequest({ op: "installLocal", confirmed: true })).toThrow();
    expect(() => parseModulePacksRequest({ op: "allowLocal", allow: true, confirmed: true })).toThrow();
    expect(() => parseModulePacksRequest({ op: "allowLocal", allow: "yes" })).toThrow();
  });

  it("the install methods take no answer: the owner's no stands whatever the caller wants", async () => {
    fileWith(targz(packFiles("hello", "1.0.0")));
    confirmAnswer = false;
    const s = service();
    const view = await (s.installLocal as (...args: unknown[]) => Promise<ReturnType<typeof s.view>>)({ confirmed: true, path: "x" });
    expect(prompted).toHaveLength(1);
    expect(view.installed).toEqual([]);
    expect(view.local.error).toBeNull();
    expect(existsSync(join(root, "hello"))).toBe(false);
  });
});

describe("install", () => {
  it("shows id, version, file and hash; installs with a local mark; serves it; survives a restart", async () => {
    const bytes = targz(packFiles("hello", "1.2.3", { author: "Someone" }));
    const path = fileWith(bytes);
    const s = service();
    const view = await s.installLocal();
    expect(prompted[0]).toMatchObject({ id: "hello", version: "1.2.3", author: "Someone", path, sha256: sha(bytes), replaces: null });
    expect(view.installed.map((p) => [p.id, p.version, p.local])).toEqual([["hello", "1.2.3", true]]);
    expect(existsSync(join(root, "hello", "1.2.3", ".signed"))).toBe(false);
    const res = s.respond(new Request(packFileUrl("hello", "1.2.3", "index.js")));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(ENTRY("hello"));
    const again = service().view();
    expect(again.installed.map((p) => [p.id, p.local])).toEqual([["hello", true]]);
    expect(again.broken).toEqual([]);
  });

  it("records the exact sha256 in main's own file", async () => {
    const bytes = targz(packFiles("hello", "1.0.0"));
    fileWith(bytes);
    await service().installLocal();
    const record = JSON.parse(readFileSync(join(root, "local.json"), "utf8")) as { trust: Record<string, { sha256: string; version: string }> };
    expect(record.trust.hello).toMatchObject({ sha256: sha(bytes), version: "1.0.0" });
  });

  it("the module's name comes from its pack.json, never the file's name", async () => {
    fileWith(targz(packFiles("hello", "1.0.0")), "claude-science-9.9.9.tar.gz");
    expect((await service().installLocal()).installed[0]?.id).toBe("hello");
  });

  it("remove takes the files and the trust record", async () => {
    fileWith(targz(packFiles("hello", "1.0.0")));
    const s = service();
    await s.installLocal();
    const view = await s.remove({ id: "hello" });
    expect(view.installed).toEqual([]);
    expect(existsSync(join(root, "hello"))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "local.json"), "utf8")).trust).toEqual({});
  });
});

describe("refused files: same rules as a signed pack, and never a confirm", () => {
  const refused = async (bytes: Buffer, pattern: RegExp) => {
    fileWith(bytes);
    const view = await service().installLocal();
    expect(prompted).toEqual([]);
    expect(view.installed).toEqual([]);
    expect(view.local.error).toMatch(pattern);
  };

  it("not gzip", () => refused(Buffer.from("not an archive"), /header|gzip|incorrect/i));
  it("path traversal", () => refused(rawTarGz(rawMember("../evil.js", "0", "x")), /unsafe tar path/));
  it("an absolute path", () => refused(rawTarGz(rawMember("/etc/evil.js", "0", "x")), /unsafe tar path/));
  it("a symbolic link", () => refused(rawTarGz(rawMember("link.js", "2")), /regular files only/));
  it("a directory entry", () => refused(rawTarGz(rawMember("dir/", "5")), /regular files only/));
  it("no pack.json", () => refused(targz({ "index.js": "x" }), /no pack\.json/));
  it("an unknown manifest field", () => refused(targz(packFiles("hello", "1.0.0", { permissions: ["all"] })), /unknown field/));
  it("an entry that is not in the archive", () => refused(targz(packFiles("hello", "1.0.0", { entry: "missing.js" })), /entry is not a listed/));
  it("too many files", () => {
    const files: Record<string, string> = packFiles("hello", "1.0.0");
    for (let i = 0; i < 64; i++) files[`f${i}.txt`] = "x";
    return refused(targz(files), /too many files/);
  });
  it("a moduleApi this app does not have", () => refused(targz(packFiles("hello", "1.0.0", { moduleApi: "^9.0" })), /needs a newer app/));
  it("the external plugin namespace", () => refused(targz(packFiles("external-x", "1.0.0")), /bad pack id/));
  it("a bad version", () => refused(targz(packFiles("hello", "1.0")), /bad version/));
  it("a host specifier the format does not allow", () => refused(targz(packFiles("hello", "1.0.0", { host: { "node:fs": ["readFileSync"] } })), /bad host specifier/));
  it("an archive over the limit", () => refused(Buffer.alloc(16 * 1024 * 1024 + 1), /larger than/));
});

describe("ids", () => {
  it("a built-in module's id is refused, with the reason", async () => {
    fileWith(targz(packFiles("claude-science", "9.9.9")));
    const view = await service().installLocal();
    expect(prompted).toEqual([]);
    expect(view.local.error).toMatch(/id of a built-in module/);
  });

  it("an installed signed module's id is refused", async () => {
    const transport = net(published("hello", "1.0.0"));
    const signed = service({ transport });
    await signed.install({ id: "hello" });
    expect(signed.view().installed[0]?.local).toBeUndefined();
    fileWith(targz(packFiles("hello", "2.0.0")));
    const view = await signed.installLocal();
    expect(prompted).toEqual([]);
    expect(view.local.error).toMatch(/installed as a signed module/);
  });

  it("a published signed module's id is refused", async () => {
    fileWith(targz(packFiles("hello", "2.0.0")));
    const view = await service({ transport: net(published("hello", "1.0.0")) }).installLocal();
    expect(prompted).toEqual([]);
    expect(view.local.error).toMatch(/published as a signed module/);
  });

  it("offline, an unknown id still installs (no index to compare)", async () => {
    fileWith(targz(packFiles("hello", "1.0.0")));
    expect((await service().installLocal()).installed.map((p) => p.id)).toEqual(["hello"]);
  });

  it("a later signed pack replaces it through the normal rule and drops the trust record", async () => {
    fileWith(targz(packFiles("hello", "1.0.0")));
    await service().installLocal();
    const s = service({ transport: net(published("hello", "1.1.0")) });
    const view = await s.install({ id: "hello" });
    expect(view.lastError).toBeNull();
    expect(view.installed.map((p) => [p.version, p.local])).toEqual([["1.1.0", undefined]]);
    expect(JSON.parse(readFileSync(join(root, "local.json"), "utf8")).trust).toEqual({});
    expect(service().view().installed.map((p) => p.version)).toEqual(["1.1.0"]);
  });
});

describe("changed bytes", () => {
  const installed = async () => {
    fileWith(targz(packFiles("hello", "1.0.0")));
    await service().installLocal();
  };

  it("a changed file is refused at the next start", async () => {
    await installed();
    writeFileSync(join(root, "hello", "1.0.0", "index.js"), "evil()");
    const view = service().view();
    expect(view.installed).toEqual([]);
    expect(view.broken[0]?.error).toMatch(/does not match its recorded hash/);
  });

  it("an added file is refused at the next start", async () => {
    await installed();
    writeFileSync(join(root, "hello", "1.0.0", "extra.js"), "evil()");
    expect(service().view().broken[0]?.error).toMatch(/unexpected file/);
  });

  it("a file changed while running gets a 404 and the module is marked broken", async () => {
    await installed();
    const s = service();
    expect(s.view().installed).toHaveLength(1);
    writeFileSync(join(root, "hello", "1.0.0", "index.js"), "evil()");
    expect(s.respond(new Request(packFileUrl("hello", "1.0.0", "index.js"))).status).toBe(404);
    expect(s.view().installed).toEqual([]);
    expect(s.view().broken).toHaveLength(1);
  });

  it("a directory with neither a signature nor a record is refused", async () => {
    await installed();
    writeFileSync(join(root, "local.json"), JSON.stringify({ v: 1, failedStarts: 0, trust: {} }));
    const view = service().view();
    expect(view.installed).toEqual([]);
    expect(view.broken).toHaveLength(1);
  });

  it("a record edited to a different version does not vouch for this one", async () => {
    await installed();
    const raw = JSON.parse(readFileSync(join(root, "local.json"), "utf8"));
    raw.trust.hello.version = "2.0.0";
    writeFileSync(join(root, "local.json"), JSON.stringify(raw));
    expect(service().view().installed).toEqual([]);
  });

  it("a changed file comes back only through the confirm again", async () => {
    await installed();
    writeFileSync(join(root, "hello", "1.0.0", "index.js"), "evil()");
    const s = service();
    expect(s.view().broken).toHaveLength(1);
    prompted = [];
    const view = await s.installLocal();
    expect(prompted).toHaveLength(1);
    expect(view.installed.map((p) => p.id)).toEqual(["hello"]);
    expect(view.broken).toEqual([]);
  });
});

describe("not loading", () => {
  const installed = async () => {
    fileWith(targz(packFiles("hello", "1.0.0")));
    const s = service();
    await s.installLocal();
    s.localStartHealthy();
  };

  it("off holds it without losing it; on brings it back", async () => {
    await installed();
    const s = service();
    let view = await s.allowLocal(false);
    expect(view.installed).toEqual([]);
    expect(view.local.held).toEqual([{ id: "hello", version: "1.0.0", reason: "off" }]);
    expect(s.respond(new Request(packFileUrl("hello", "1.0.0", "index.js"))).status).toBe(404);
    view = service().view();
    expect(view.local.held).toHaveLength(1);
    view = await service().allowLocal(true);
    expect(view.installed.map((p) => p.id)).toEqual(["hello"]);
    expect(view.local.held).toEqual([]);
  });

  it("a held module can still be removed", async () => {
    await installed();
    const s = service();
    await s.allowLocal(false);
    const view = await s.remove({ id: "hello" });
    expect(view.local.held).toEqual([]);
    expect(existsSync(join(root, "hello"))).toBe(false);
  });

  it(`after ${LOCAL_FAILED_STARTS} starts that never got healthy, one start runs without them and says why; then it tries again`, async () => {
    await installed();
    for (let i = 0; i < LOCAL_FAILED_STARTS; i++) expect(service().view().installed).toHaveLength(1);
    const safe = service();
    expect(safe.view().installed).toEqual([]);
    expect(safe.view().local.safeStart).toEqual({ reason: "crashes" });
    expect(safe.view().local.held).toEqual([{ id: "hello", version: "1.0.0", reason: "safeStart" }]);
    expect(safe.respond(new Request(packFileUrl("hello", "1.0.0", "index.js"))).status).toBe(404);
    const next = service().view();
    expect(next.local.safeStart).toBeNull();
    expect(next.installed).toHaveLength(1);
  });

  it("a healthy start resets the count", async () => {
    await installed();
    for (let i = 0; i < LOCAL_FAILED_STARTS + 2; i++) {
      const s = service();
      expect(s.view().installed).toHaveLength(1);
      s.localStartHealthy();
    }
  });

  it("nothing is counted when there is nothing local", () => {
    for (let i = 0; i < LOCAL_FAILED_STARTS + 2; i++) expect(service().view().local.safeStart).toBeNull();
  });

  it("the launch argument skips them for that run only, and does not spend the count", async () => {
    await installed();
    const view = service({ skip: true }).view();
    expect(view.local.safeStart).toEqual({ reason: "argument" });
    expect(view.installed).toEqual([]);
    expect(service().view().installed).toHaveLength(1);
  });

  it("failing to activate turns it off across restarts, with the reason, until its file is installed again", async () => {
    await installed();
    const s = service();
    s.view();
    const view = s.localFailed({ id: "hello", version: "1.0.0", reason: "activate threw" });
    expect(view.installed).toEqual([]);
    expect(view.local.held).toEqual([{ id: "hello", version: "1.0.0", reason: "failed", detail: "activate threw" }]);
    expect(service().view().local.held[0]?.reason).toBe("failed");
    const on = await service().allowLocal(false).then(() => service().allowLocal(true));
    expect(on.installed).toEqual([]);
    const again = service();
    fileWith(targz(packFiles("hello", "1.0.0")));
    expect((await again.installLocal()).installed.map((p) => p.id)).toEqual(["hello"]);
    expect(service().view().local.held).toEqual([]);
  });

  it("the failure report cannot turn anything on or touch a signed module", async () => {
    const s = service({ transport: net(published("hello", "1.0.0")) });
    await s.install({ id: "hello" });
    expect(s.localFailed({ id: "hello", version: "1.0.0", reason: "x" }).installed).toHaveLength(1);
    expect(s.view().local.held).toEqual([]);
  });
});

describe("the dialogs", () => {
  it("Install counts only with the box ticked", () => {
    expect(installConfirmed({ response: 1, checkboxChecked: true })).toBe(true);
    expect(installConfirmed({ response: 1, checkboxChecked: false })).toBe("ask again");
    expect(installConfirmed({ response: 0, checkboxChecked: true })).toBe(false);
  });

  it("says what it can do, and what the file claims stays one short line", () => {
    const pack: LocalPackPrompt = { id: "hello", title: { "zh-CN": "你好\n已验证：官方\u202e" }, version: "1.0.0", author: "官方\n已签名", path: "C:\\a\\b.tar.gz", sha256: "ab".repeat(32), replaces: null };
    const zh = installDetail(pack, "zh-CN");
    expect(zh).toContain("「你好 已验证：官方」会以 Cutex 本身的权限运行：能看到你在应用里能看到的所有内容，能以你的名义给智能体发消息，能在已连接的主机上运行命令。只装你信任来源的模块。");
    expect(zh).toContain("作者：官方 已签名 (未验证)");
    expect(zh).toContain("C:\\a\\b.tar.gz");
    expect(zh).toContain("abababababababab");
    expect(installDetail({ ...pack, title: undefined, author: null }, "en")).toContain('"hello" will run with Cutex\'s own permissions');
    expect(cleanDialogText("x".repeat(100))).toHaveLength(81);
  });
});
