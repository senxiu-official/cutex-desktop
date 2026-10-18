// Signed module packs, main side (docs/desktop-modules.md §23.4–§23.5): index signature, strict parsing,
// download + hash + tar checks, atomic store, start-up re-verification, downgrade refusal, the protocol.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModulePackService, modulePackRequestAllowed, modulePackSource, readTar } from "../src/main/modulePacks";
import { parsePublicKey, RELEASE_PUBLIC_KEYS } from "../src/main/minisign";
import type { Transport } from "../src/main/updateTransport";
import { MODULE_PACK_TEST_PUBLIC_KEY, parseModulePacksRequest, type ModuleIndexPack } from "../src/shared/modulePacks";
import { publicKeyLine, signMinisig, testKey, type SigningKey } from "../scripts/module-packs/minisign.mjs";
import { gzipFixed, writeTar, writeTarGz } from "../scripts/module-packs/tar.mjs";

const BASE = "https://github.com/senxiu-official/cutex-desktop/releases/download/modules-release";
const sha = (d: Uint8Array) => createHash("sha256").update(d).digest("hex");

function otherKey(): SigningKey {
  return { privateKey: generateKeyPairSync("ed25519").privateKey, keyId: randomBytes(8) };
}

interface Built {
  entry: ModuleIndexPack;
  archive: Buffer;
}

function buildPack(id: string, version: string, opts: { moduleApi?: string; files?: Record<string, string>; archiveFiles?: Record<string, string> } = {}): Built {
  const files = opts.files ?? { "index.js": `export const moduleApi = "^1.16"; export const module = { id: "${id}", titleKey: "${id}.title" };`, "pack.json": JSON.stringify({ id, version }) };
  const archive = writeTarGz(Object.entries(opts.archiveFiles ?? files).map(([path, data]) => ({ path, data })));
  const entry: ModuleIndexPack = {
    id,
    version,
    moduleApi: opts.moduleApi ?? "^1.16",
    title: { en: "Pack", "zh-CN": "包" },
    entry: "index.js",
    styles: [],
    host: { react: ["useState"] },
    files: Object.entries(files).map(([path, data]) => ({ path, size: Buffer.byteLength(data), sha256: sha(Buffer.from(data)) })),
    archive: { name: `${id}-${version}.tar.gz`, url: `${BASE}/${id}-${version}.tar.gz`, size: archive.length, sha256: sha(archive) },
  };
  return { entry, archive };
}

function indexBytes(packs: Built[], serial = 100): Buffer {
  return Buffer.from(JSON.stringify({ schema: 1, serial, generatedAt: "2026-10-18T00:00:00Z", packs: packs.map((p) => p.entry) }, null, 2));
}

/** A fake GitHub: url → bytes (404 otherwise); counts requests. */
function fakeNet(files: Map<string, Buffer | string>): Transport & { hits: string[] } {
  const hits: string[] = [];
  const t = (async (url: string): ReturnType<Transport> => {
    hits.push(url);
    const body = files.get(url);
    if (body === undefined) return { status: 404, header: () => null, body: (async function* () {})(), cancel: () => {} };
    const bytes = Buffer.from(body);
    return {
      status: 200,
      header: (n: string) => (n === "content-length" ? String(bytes.length) : null),
      body: (async function* () {
        yield bytes;
      })(),
      cancel: () => {},
    };
  }) as unknown as Transport & { hits: string[] };
  t.hits = hits;
  return t;
}

let root: string;
const keys = [parsePublicKey(MODULE_PACK_TEST_PUBLIC_KEY)];
const source = { indexUrl: `${BASE}/modules.json`, signatureUrl: `${BASE}/modules.json.minisig`, extraOrigins: [], keys, testKey: true };

function publish(packs: Built[], opts: { serial?: number; key?: SigningKey; sigName?: string; tamperIndex?: boolean } = {}): Map<string, Buffer | string> {
  let bytes = indexBytes(packs, opts.serial);
  const sig = signMinisig(bytes, opts.sigName ?? "modules.json", opts.key ?? testKey());
  if (opts.tamperIndex) bytes = Buffer.from(bytes.toString().replace('"serial"', '"serial" '));
  const m = new Map<string, Buffer | string>([
    [`${BASE}/modules.json`, bytes],
    [`${BASE}/modules.json.minisig`, sig],
  ]);
  for (const p of packs) m.set(p.entry.archive.url, p.archive);
  return m;
}

function service(net: Transport, appModuleApi = "1.16") {
  return new ModulePackService({ root, source, transport: net, appModuleApi });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cutex-module-packs-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("keys and source", () => {
  it("the embedded test key is the one derived from the public seed", () => {
    expect(publicKeyLine(testKey())).toBe(MODULE_PACK_TEST_PUBLIC_KEY);
    expect(RELEASE_PUBLIC_KEYS).not.toContain(MODULE_PACK_TEST_PUBLIC_KEY);
  });

  it("a packaged app trusts only the release keys and GitHub; an unpackaged one also the test key and a loopback index", () => {
    const env = { CUTEX_DESKTOP_MODULES_INDEX: "http://127.0.0.1:4567/x/modules.json" };
    const packaged = modulePackSource({ releasePage: "https://github.com/someone/fork/releases", packaged: true, env });
    expect(packaged.testKey).toBe(false);
    expect(packaged.keys.map((k) => k.id)).toEqual(["00A0BD016183F447", "D12869DA9D6F784E"]);
    expect(packaged.indexUrl).toBe("https://github.com/someone/fork/releases/download/modules-release/modules.json");
    expect(packaged.extraOrigins).toEqual([]);
    const dev = modulePackSource({ releasePage: null, packaged: false, env });
    expect(dev.testKey).toBe(true);
    expect(dev.keys.map((k) => k.id)).toContain(parsePublicKey(MODULE_PACK_TEST_PUBLIC_KEY).id);
    expect(dev.indexUrl).toBe("http://127.0.0.1:4567/x/modules.json");
    expect(dev.signatureUrl).toBe("http://127.0.0.1:4567/x/modules.json.minisig");
    expect(dev.extraOrigins).toEqual(["http://127.0.0.1:4567"]);
    expect(modulePackSource({ releasePage: null, packaged: false, env: { CUTEX_DESKTOP_MODULES_INDEX: "http://evil.example/modules.json" } }).indexUrl).toBe(`${BASE}/modules.json`);
  });
});

describe("check, install, serve", () => {
  it("installs the newest compatible version, serves its files, and verifies again after a restart", async () => {
    const v1 = buildPack("claude-science", "1.0.0");
    const v2 = buildPack("claude-science", "1.1.0");
    const v3 = buildPack("claude-science", "2.0.0", { moduleApi: "^2.0" });
    const net = fakeNet(publish([v1, v2, v3]));
    const s = service(net);
    const checked = await s.check();
    expect(checked.check).toBeNull();
    expect(checked.index?.packs.map((p) => [p.version, p.compat])).toEqual([["1.0.0", "ok"], ["1.1.0", "ok"], ["2.0.0", "needsNewerApp"]]);
    const view = await s.install({ id: "claude-science" });
    expect(view.lastError).toBeNull();
    expect(view.installed).toMatchObject([{ id: "claude-science", version: "1.1.0", compat: "ok", entry: "cutex-module://pack/claude-science/1.1.0/index.js" }]);
    expect(readdirSync(root).sort()).toEqual(["claude-science", "state.json"]);
    expect(readdirSync(join(root, "claude-science", "1.1.0")).sort()).toEqual([".signed", "index.js", "pack.json"]);
    const res = s.respond(new Request("cutex-module://pack/claude-science/1.1.0/index.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/javascript/);
    expect(await res.text()).toContain('id: "claude-science"');

    const again = service(fakeNet(new Map()));
    expect(again.view().installed.map((p) => p.version)).toEqual(["1.1.0"]);
    expect(again.respond(new Request("cutex-module://pack/claude-science/1.1.0/index.js")).status).toBe(200);
    // A newer app past the pack's range: still installed, reported as needing a newer module.
    expect(service(fakeNet(new Map()), "2.0").view().installed[0]?.compat).toBe("needsNewerModule");
  });

  it("serves nothing else", async () => {
    const s = service(fakeNet(publish([buildPack("claude-science", "1.0.0")])));
    await s.install({ id: "claude-science" });
    for (const url of [
      "cutex-module://pack/claude-science/1.0.0/pack.json",
      "cutex-module://pack/claude-science/1.0.0/.signed/modules.json",
      "cutex-module://pack/claude-science/1.0.0/missing.js",
      "cutex-module://pack/claude-science/0.9.0/index.js",
      "cutex-module://pack/other/1.0.0/index.js",
      "cutex-module://evil/claude-science/1.0.0/index.js",
      "cutex-module://pack/claude-science/1.0.0/index.js?x=1",
      "cutex-module://pack/claude-science/1.0.0/../../state.json",
    ]) {
      expect(s.respond(new Request(url)).status, url).toBe(404);
    }
    expect(s.respond(new Request("cutex-module://pack/claude-science/1.0.0/index.js", { method: "POST", body: "x" })).status).toBe(404);
  });

  it("refuses a tampered archive file, an extra file and a missing file, leaving nothing behind", async () => {
    const good = buildPack("claude-science", "1.0.0");
    const tampered = { ...good, archive: writeTarGz([{ path: "index.js", data: "evil()" }, { path: "pack.json", data: JSON.stringify({ id: "claude-science", version: "1.0.0" }) }]) };
    tampered.entry = { ...good.entry, archive: { ...good.entry.archive, size: tampered.archive.length, sha256: sha(tampered.archive) } };
    const s = service(fakeNet(publish([tampered])));
    const view = await s.install({ id: "claude-science" });
    expect(view.lastError).toMatchObject({ id: "claude-science", code: "verify_failed" });
    expect(view.lastError?.message).toContain("index.js does not match the signed sha256");
    expect(view.installed).toEqual([]);
    expect(readdirSync(root).filter((n) => n !== "state.json")).toEqual([]);

    const extra = buildPack("claude-science", "1.0.0", { archiveFiles: { "index.js": "a", "pack.json": "b", "extra.js": "c" }, files: { "index.js": "a", "pack.json": "b" } });
    expect((await service(fakeNet(publish([extra]))).install({ id: "claude-science" })).lastError?.message).toContain("unlisted file extra.js");
    const missing = buildPack("claude-science", "1.0.0", { archiveFiles: { "index.js": "a" }, files: { "index.js": "a", "pack.json": "b" } });
    expect((await service(fakeNet(publish([missing]))).install({ id: "claude-science" })).lastError?.message).toContain("lacks pack.json");
  });

  it("refuses an archive whose bytes differ from the signed sha256", async () => {
    const p = buildPack("claude-science", "1.0.0");
    const net = publish([p]);
    const evil = Buffer.from(p.archive);
    evil[evil.length - 1] = evil[evil.length - 1]! ^ 1;
    net.set(p.entry.archive.url, evil);
    expect((await service(fakeNet(net)).install({ id: "claude-science" })).lastError).toMatchObject({ code: "verify_failed" });
  });
});

describe("the index", () => {
  it("refuses a bad signature, a wrong key, a signature for another file and a rolled-back serial", async () => {
    const p = buildPack("claude-science", "1.0.0");
    const bad = await service(fakeNet(publish([p], { tamperIndex: true }))).check();
    expect(bad.check).toMatchObject({ kind: "invalid" });
    expect(bad.check?.error).toContain("signature does not verify");
    const wrong = await service(fakeNet(publish([p], { key: otherKey() }))).check();
    expect(wrong.check?.error).toContain("unknown key");
    const other = await service(fakeNet(publish([p], { sigName: "SHA256SUMS" }))).check();
    expect(other.check?.error).toContain("not modules.json");
    expect(bad.index).toBeNull();

    expect((await service(fakeNet(publish([p], { serial: 200 }))).check()).check).toBeNull();
    const older = await service(fakeNet(publish([p], { serial: 150 }))).check();
    expect(older.check?.error).toContain("older (serial 150) than one already seen (200)");
    // Installing with only a refused index: nothing happens.
    expect((await service(fakeNet(publish([p], { serial: 150 }))).install({ id: "claude-science" })).lastError?.code).toBe("no_index");
  });

  it("reports a missing release as not published yet, and refuses archives off GitHub", async () => {
    expect((await service(fakeNet(new Map())).check()).check).toMatchObject({ kind: "noRelease" });
    const p = buildPack("claude-science", "1.0.0");
    p.entry.archive.url = "https://evil.example/claude-science-1.0.0.tar.gz";
    const view = await service(fakeNet(publish([p]))).check();
    expect(view.check?.error).toContain("archive url not allowed");
  });

  it("parses strictly", async () => {
    const p = buildPack("claude-science", "1.0.0");
    for (const mutate of [
      (e: Record<string, unknown>) => (e.id = "external-x"),
      (e: Record<string, unknown>) => (e.version = "1.0"),
      (e: Record<string, unknown>) => (e.moduleApi = "whatever"),
      (e: Record<string, unknown>) => (e.entry = "missing.js"),
      (e: Record<string, unknown>) => (e.files = [{ path: "../x.js", size: 1, sha256: "0".repeat(64) }]),
      (e: Record<string, unknown>) => (e.files = [{ path: ".signed/x.js", size: 1, sha256: "0".repeat(64) }]),
      (e: Record<string, unknown>) => (e.host = { fs: ["readFileSync"] }),
      (e: Record<string, unknown>) => (e.extra = true),
    ]) {
      const entry = structuredClone(p.entry) as unknown as Record<string, unknown>;
      mutate(entry);
      const bytes = Buffer.from(JSON.stringify({ schema: 1, serial: 5, generatedAt: "x", packs: [entry] }));
      const net = new Map<string, Buffer | string>([[`${BASE}/modules.json`, bytes], [`${BASE}/modules.json.minisig`, signMinisig(bytes, "modules.json")]]);
      const view = await service(fakeNet(net)).check();
      expect(view.check?.kind, JSON.stringify(entry)).toBe("invalid");
    }
  });
});

describe("downgrades, removal, interrupted installs, tampering at rest", () => {
  it("refuses a downgrade unless the owner picked the older version", async () => {
    const v1 = buildPack("claude-science", "1.0.0");
    const v2 = buildPack("claude-science", "1.1.0");
    const s = service(fakeNet(publish([v1, v2])));
    await s.install({ id: "claude-science" });
    const refused = await s.install({ id: "claude-science", version: "1.0.0" });
    expect(refused.lastError).toMatchObject({ code: "downgrade_refused", retry: { version: "1.0.0" } });
    expect(refused.installed[0]?.version).toBe("1.1.0");
    const older = await s.install({ id: "claude-science", version: "1.0.0", allowOlder: true });
    expect(older.lastError).toBeNull();
    expect(older.installed[0]?.version).toBe("1.0.0");
    expect(readdirSync(join(root, "claude-science"))).toEqual(["1.0.0"]);
    // The owner's choice survives a restart.
    expect(service(fakeNet(new Map())).view().installed[0]?.version).toBe("1.0.0");
    // A version needing a newer app is refused even when picked explicitly.
    const v3 = buildPack("claude-science", "3.0.0", { moduleApi: "^3.0" });
    expect((await service(fakeNet(publish([v1, v3], { serial: 101 }))).install({ id: "claude-science", version: "3.0.0" })).lastError?.code).toBe("incompatible");
  });

  it("removes a pack and everything of it", async () => {
    const s = service(fakeNet(publish([buildPack("claude-science", "1.0.0")])));
    await s.install({ id: "claude-science" });
    const view = await s.remove({ id: "claude-science" });
    expect(view.installed).toEqual([]);
    expect(existsSync(join(root, "claude-science"))).toBe(false);
    expect(JSON.parse(readFileSync(join(root, "state.json"), "utf8")).active).toEqual({});
  });

  it("cleans up an interrupted install at start and keeps the installed version", async () => {
    await service(fakeNet(publish([buildPack("claude-science", "1.0.0")]))).install({ id: "claude-science" });
    // An install of 1.1.0 interrupted mid-unpack: its staging dir, a half download, and a version dir that never got its signed index.
    mkdirSync(join(root, ".staging-claude-science-1.1.0-1-abcd"), { recursive: true });
    writeFileSync(join(root, ".staging-claude-science-1.1.0-1-abcd", "index.js"), "half");
    writeFileSync(join(root, ".download-claude-science-1.1.0-1-abcd"), "half");
    mkdirSync(join(root, "claude-science", "1.1.0"));
    writeFileSync(join(root, "claude-science", "1.1.0", "index.js"), "half");
    const s = service(fakeNet(new Map()));
    expect(s.view().installed.map((p) => p.version)).toEqual(["1.0.0"]);
    expect(readdirSync(root).sort()).toEqual(["claude-science", "state.json"]);
    expect(readdirSync(join(root, "claude-science"))).toEqual(["1.0.0"]);
  });

  it("reports a pack changed at rest as broken, and one changed while running as gone", async () => {
    await service(fakeNet(publish([buildPack("claude-science", "1.0.0")]))).install({ id: "claude-science" });
    const running = service(fakeNet(new Map()));
    expect(running.view().installed).toHaveLength(1);
    writeFileSync(join(root, "claude-science", "1.0.0", "index.js"), "evil()");
    expect(running.respond(new Request("cutex-module://pack/claude-science/1.0.0/index.js")).status).toBe(404);
    expect(running.view().installed).toEqual([]);
    expect(running.view().broken[0]?.error).toContain("changed after it was verified");

    const restarted = service(fakeNet(new Map()));
    expect(restarted.view().installed).toEqual([]);
    expect(restarted.view().broken[0]).toMatchObject({ id: "claude-science", version: "1.0.0" });
    expect(restarted.view().broken[0]?.error).toContain("does not match its signed hash");
    // A swapped signed index (another key) is refused too.
    writeFileSync(join(root, "claude-science", "1.0.0", ".signed", "modules.json.minisig"), signMinisig(readFileSync(join(root, "claude-science", "1.0.0", ".signed", "modules.json")), "modules.json", otherKey()));
    expect(service(fakeNet(new Map())).view().broken[0]?.error).toContain("unknown key");
  });

  it("refuses a second operation while one runs", async () => {
    const s = service(fakeNet(publish([buildPack("claude-science", "1.0.0")])));
    const first = s.install({ id: "claude-science" });
    await expect(s.install({ id: "claude-science" })).rejects.toThrow(/busy/);
    await expect(s.remove({ id: "claude-science" })).rejects.toThrow(/busy/);
    expect((await first).installed).toHaveLength(1);
  });
});

describe("tar reader", () => {
  const entry = (path: string, data = "x") => writeTar([{ path, data }]);
  it("reads what the pack builder writes", () => {
    const files = readTar(writeTar([{ path: "b.js", data: "2" }, { path: "a/x.css", data: "1" }]));
    expect([...files.keys()]).toEqual(["a/x.css", "b.js"]);
  });
  it("refuses links, traversal, dot files, bad checksums, trailing data and truncation", () => {
    const link = entry("a.js");
    link[156] = 0x32; // symlink
    let sum = 0;
    link.fill(0x20, 148, 156);
    for (let i = 0; i < 512; i++) sum += link[i]!;
    link.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
    expect(() => readTar(link)).toThrow(/regular files only/);
    expect(() => writeTar([{ path: "../x.js", data: "" }]) && readTar(writeTar([{ path: "../x.js", data: "" }]))).toThrow(/unsafe/);
    expect(() => readTar(entry(".hidden.js"))).toThrow(/unsafe/);
    const bad = entry("a.js");
    bad[0] = 0x62;
    expect(() => readTar(bad)).toThrow(/checksum/);
    expect(() => readTar(Buffer.concat([entry("a.js"), Buffer.from("junk")]))).toThrow(/after the end/);
    expect(() => readTar(entry("a.js").subarray(0, 600))).toThrow(/truncated/);
    expect(() => readTar(writeTar([{ path: "A.js", data: "" }, { path: "a.js", data: "" }]))).toThrow(/duplicate/);
  });
  it("gzip output is deterministic", () => {
    const files = [{ path: "index.js", data: "x" }];
    expect(gzipFixed(writeTar(files)).equals(writeTarGz(files))).toBe(true);
    expect(writeTarGz(files)[9]).toBe(0xff);
  });
});

describe("request guard (main's onBeforeRequest)", () => {
  it("lets only the app window's main frame load pack scripts and styles", () => {
    const mainFrame = { name: "main" };
    const main = { id: 7, mainFrame };
    const ok = { webContentsId: 7, frame: mainFrame, resourceType: "script" };
    expect(modulePackRequestAllowed(ok, main)).toBe(true);
    expect(modulePackRequestAllowed({ ...ok, resourceType: "stylesheet" }, main)).toBe(true);
    expect(modulePackRequestAllowed({ ...ok, frame: { name: "plugin subframe" } }, main)).toBe(false);
    expect(modulePackRequestAllowed({ ...ok, frame: undefined }, main)).toBe(false);
    expect(modulePackRequestAllowed({ ...ok, webContentsId: 8 }, main)).toBe(false);
    for (const resourceType of ["xhr", "subFrame", "mainFrame", "image", "other", "media"]) expect(modulePackRequestAllowed({ ...ok, resourceType }, main)).toBe(false);
    expect(modulePackRequestAllowed(ok, null)).toBe(false);
  });

  it("is installed in the one onBeforeRequest listener of the default session (a second call would replace the first)", () => {
    const src = readFileSync(join(__dirname, "../src/main/index.ts"), "utf8");
    expect(src.match(/defaultSession\.webRequest\.onBeforeRequest\(/g)).toHaveLength(1);
    expect(src).toMatch(/onBeforeRequest\(\{ urls: \[`\$\{MODULE_PACK_SCHEME\}:\/\/\*\/\*`, `\$\{PLUGIN_SCHEME\}:\/\/\*\/\*`\] \}/);
  });
});

describe("IPC requests", () => {
  it("accepts exactly the four ops", () => {
    expect(parseModulePacksRequest({ op: "state" })).toEqual({ op: "state" });
    expect(parseModulePacksRequest({ op: "install", id: "claude-science", version: "1.0.0", allowOlder: true })).toEqual({ op: "install", id: "claude-science", version: "1.0.0", allowOlder: true });
    expect(parseModulePacksRequest({ op: "remove", id: "nci" })).toEqual({ op: "remove", id: "nci" });
    for (const bad of [null, [], { op: "state", x: 1 }, { op: "install", id: "../x" }, { op: "install", id: "external-x" }, { op: "install", id: "nci", version: "1" }, { op: "install", id: "nci", url: "https://x" }, { op: "remove", id: "nci", path: "/" }, { op: "read" }]) {
      expect(() => parseModulePacksRequest(bad), JSON.stringify(bad)).toThrow();
    }
  });
});
