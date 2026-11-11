// 中文字体包 下载并安装 (main/fontPack.ts, owner 2026-11-10 option B): the pinned release asset is downloaded through the
// given transport (the updater's), its size and SHA-256 checked, then only catalog entries are installed, each checked
// against its own SHA-256. Interrupted downloads continue with a Range request; tampered archives are refused.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FontPackStore, handleFontPackRequest, type FontPackArchive } from "../src/main/fontPack";
import { ProxyAuthError, type Transport, type TransportResponse } from "../src/main/updateTransport";
import { downloadUrlAllowed } from "../src/shared/binaryUpdate";
import { FONT_PACK_ARCHIVE, PACK_FONTS, type FontCatalogEntry, type FontPackState } from "../src/shared/fontCatalog";

const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const bytes = (text: string, n = 3000) => Buffer.from(text.repeat(Math.ceil(n / text.length)).slice(0, n));
const A400 = bytes("a400"), A700 = bytes("a700", 5000), B400 = bytes("b400", 700);
const CATALOG: FontCatalogEntry[] = [
  { id: "fam-a", family: "Fam A", script: "cjk", delivery: "pack", faces: [
    { weight: "400", style: "normal", file: "fam-a-400.woff2", bytes: A400.length, sha256: sha(A400) },
    { weight: "700", style: "normal", file: "fam-a-700.woff2", bytes: A700.length, sha256: sha(A700) },
  ] },
  { id: "fam-b", family: "Fam B", script: "cjk", delivery: "pack", faces: [{ weight: "400", style: "normal", file: "fam-b-400.ttf", bytes: B400.length, sha256: sha(B400) }] },
];

/** A ustar archive like scripts/font-pack-archive.mjs writes. */
function tar(entries: [string, Buffer][], type = "0"): Buffer {
  const parts: Buffer[] = [];
  for (const [path, data] of entries) {
    const h = Buffer.alloc(512, 0);
    h.write(path, 0, 100, "utf8");
    h.write("0000644\0", 100, 8, "latin1");
    h.write("0000000\0", 108, 8, "latin1");
    h.write("0000000\0", 116, 8, "latin1");
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124, 12, "latin1");
    h.write("15274720000\0", 136, 12, "latin1");
    h.write("        ", 148, 8, "latin1");
    h.write(type, 156, 1, "latin1");
    h.write("ustar\0", 257, 6, "latin1");
    h.write("00", 263, 2, "latin1");
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}
const GOOD = tar([
  ["pack/README.txt", Buffer.from("readme")],
  ["pack/fonts/fam-a-400.woff2", A400],
  ["pack/fonts/fam-a-700.woff2", A700],
  ["pack/fonts/fam-b-400.ttf", B400],
  ["pack/licenses/fam-a/OFL.txt", Buffer.from("ofl")],
  ["other/fonts/fam-b-400.ttf", Buffer.from("not this one")],
]);
const URL_ = "https://github.com/senxiu-official/cutex-desktop/releases/download/fonts-test/pack.tar";
const archiveOf = (data: Buffer): FontPackArchive => ({ name: "pack.tar", url: URL_, sha256: sha(data), bytes: data.length, root: "pack" });

type Served = { data: Buffer; ranges?: boolean; failAfter?: number; status?: number; redirect?: string; throws?: Error };
/** A fake updater transport: serves `data`, honours Range when asked, can drop the connection after N bytes. */
function server(plan: Served[]) {
  const requests: { url: string; range: string | null }[] = [];
  const transport: Transport = async (url, init) => {
    const step = plan[Math.min(requests.length, plan.length - 1)]!;
    requests.push({ url, range: init.headers.Range ?? null });
    if (step.throws) throw step.throws;
    if (step.redirect) return response(302, { location: step.redirect }, Buffer.alloc(0));
    const match = /^bytes=(\d+)-$/.exec(init.headers.Range ?? "");
    const from = step.ranges && match ? Number(match[1]) : 0;
    const body = step.data.subarray(from);
    const headers: Record<string, string> = { "content-length": String(body.length) };
    if (from > 0) headers["content-range"] = `bytes ${from}-${step.data.length - 1}/${step.data.length}`;
    return response(step.status ?? (from > 0 ? 206 : 200), headers, body, step.failAfter, init.signal);
  };
  return { transport, requests };
}
function response(status: number, headers: Record<string, string>, body: Buffer, failAfter?: number, signal?: AbortSignal): TransportResponse {
  return {
    status,
    header: (name) => headers[name] ?? null,
    cancel: () => {},
    body: (async function* () {
      for (let off = 0; off < body.length; off += 1000) {
        if (signal?.aborted) throw signal.reason ?? new Error("aborted");
        if (failAfter !== undefined && off >= failAfter) throw new Error("socket hang up");
        yield body.subarray(off, Math.min(body.length, off + 1000));
        await new Promise((r) => setTimeout(r, 0));
      }
    })(),
  };
}

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "font-dl-"));
  dirs.push(dir);
  return join(dir, "fonts");
};
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("the pinned release asset", () => {
  it("is one tar on the public desktop repo's fonts-zh-1 release, a GitHub download host, with size and SHA-256", () => {
    expect(FONT_PACK_ARCHIVE.url).toBe(`https://github.com/senxiu-official/cutex-desktop/releases/download/fonts-zh-1/${FONT_PACK_ARCHIVE.name}`);
    expect(downloadUrlAllowed(FONT_PACK_ARCHIVE.url)).toBe(true);
    expect(FONT_PACK_ARCHIVE.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The fonts plus headers and licenses: at least the catalog's bytes.
    expect(FONT_PACK_ARCHIVE.bytes).toBeGreaterThan(PACK_FONTS.flatMap((e) => e.faces).reduce((n, f) => n + f.bytes, 0));
    expect(FONT_PACK_ARCHIVE.bytes % 512).toBe(0);
  });

  // Opt-in (the 84 MB file is not in the repo): CUTEX_FONT_PACK_ARCHIVE=<path to cutex-fonts-zh-1.tar>.
  it.skipIf(!process.env.CUTEX_FONT_PACK_ARCHIVE)("matches the catalog: pinned size + SHA-256, and every catalog file installs from it", async () => {
    const path = process.env.CUTEX_FONT_PACK_ARCHIVE!;
    const data = readFileSync(path);
    expect(data.length).toBe(FONT_PACK_ARCHIVE.bytes);
    expect(sha(data)).toBe(FONT_PACK_ARCHIVE.sha256);
    const root = temp(), store = new FontPackStore(root);
    await store.installFromTar(path, FONT_PACK_ARCHIVE.root);
    expect((await store.state()).families.every((f) => f.installed === f.total)).toBe(true);
  }, 120_000);
});

describe("下载并安装", () => {
  it("downloads through the given transport, checks the archive, installs only catalog entries, removes the download", async () => {
    const root = temp(), pushes: FontPackState[] = [];
    const store = new FontPackStore(root, CATALOG, (s) => pushes.push(s));
    const { transport, requests } = server([{ data: GOOD }]);
    const state = await store.downloadAndInstall({ transport, archive: archiveOf(GOOD) });
    expect(requests).toEqual([{ url: URL_, range: null }]);
    expect(state.families.map((f) => [f.id, f.installed])).toEqual([["fam-a", 2], ["fam-b", 1]]);
    expect(state.download).toBeUndefined();
    expect(readFileSync(join(root, "fam-b-400.ttf"))).toEqual(B400);
    expect(existsSync(join(root, "README.txt"))).toBe(false);
    expect(existsSync(join(root, ".download", "pack.tar.part"))).toBe(false);
    const phases = pushes.map((p) => p.download?.phase ?? "done");
    expect(phases[0]).toBe("downloading");
    expect(phases.slice(-3)).toEqual(["verifying", "installing", "done"]);
  });

  it("refuses a tampered archive: deleted, nothing installed, 'mismatch'", async () => {
    const root = temp(), store = new FontPackStore(root, CATALOG);
    const tampered = Buffer.from(GOOD);
    const at = GOOD.indexOf(A400) + 10;
    tampered[at] = tampered[at]! ^ 1;
    const { transport } = server([{ data: tampered }]);
    const state = await store.downloadAndInstall({ transport, archive: archiveOf(GOOD) });
    expect(state.download).toMatchObject({ phase: "failed", error: "mismatch" });
    expect(state.families.every((f) => f.installed === 0)).toBe(true);
    expect(existsSync(join(root, ".download", "pack.tar.part"))).toBe(false);
  });

  it("checks every file even when the archive hash is the pinned one (a file that does not match is not installed)", async () => {
    const root = temp(), store = new FontPackStore(root, CATALOG);
    const odd = tar([["pack/fonts/fam-a-400.woff2", A400], ["pack/fonts/fam-a-700.woff2", Buffer.from(A700).fill(1, 0, 1)], ["pack/fonts/fam-b-400.ttf", B400]]);
    const { transport } = server([{ data: odd }]);
    const state = await store.downloadAndInstall({ transport, archive: archiveOf(odd) });
    expect(state.download).toMatchObject({ phase: "failed", error: "mismatch" });
    expect(existsSync(join(root, "fam-a-700.woff2"))).toBe(false);
    expect(existsSync(join(root, "fam-a-700.woff2.import"))).toBe(false);
  });

  it("refuses links, devices and '..' paths in the archive", async () => {
    for (const bad of [tar([["pack/fonts/fam-a-400.woff2", A400]], "2"), tar([["pack/../fam-a-400.woff2", A400]])]) {
      const root = temp(), store = new FontPackStore(root, CATALOG);
      const { transport } = server([{ data: bad }]);
      const state = await store.downloadAndInstall({ transport, archive: archiveOf(bad) });
      expect(state.download).toMatchObject({ phase: "failed", error: "mismatch" });
      expect(state.families.every((f) => f.installed === 0)).toBe(true);
    }
  });

  it("an interrupted download keeps its part and continues with a Range request", async () => {
    const root = temp(), store = new FontPackStore(root, CATALOG);
    const { transport, requests } = server([{ data: GOOD, ranges: true, failAfter: 4000 }, { data: GOOD, ranges: true }]);
    const first = await store.downloadAndInstall({ transport, archive: archiveOf(GOOD) });
    expect(first.download).toMatchObject({ phase: "failed", error: "network" });
    const kept = statSync(join(root, ".download", "pack.tar.part")).size;
    expect(kept).toBeGreaterThanOrEqual(4000);
    expect(kept).toBeLessThan(GOOD.length);
    const second = await store.downloadAndInstall({ transport, archive: archiveOf(GOOD) });
    expect(requests[1]!.range).toBe(`bytes=${kept}-`);
    expect(second.download).toBeUndefined();
    expect(second.families.every((f) => f.installed === f.total)).toBe(true);
  });

  it("starts over when the server answers a Range request with the whole file", async () => {
    const root = temp(), store = new FontPackStore(root, CATALOG);
    const { transport, requests } = server([{ data: GOOD, failAfter: 4000 }, { data: GOOD, ranges: false }]);
    await store.downloadAndInstall({ transport, archive: archiveOf(GOOD) });
    const second = await store.downloadAndInstall({ transport, archive: archiveOf(GOOD) });
    expect(requests[1]!.range).toMatch(/^bytes=\d+-$/);
    expect(second.families.every((f) => f.installed === f.total)).toBe(true);
  });

  it("cancel stops it quietly (no error shown) and keeps the part for later", async () => {
    const root = temp(), store = new FontPackStore(root, CATALOG);
    const big = tar([["pack/fonts/fam-a-400.woff2", A400], ["pack/pad.bin", Buffer.alloc(400_000)]]);
    const { transport } = server([{ data: big }]);
    const running = store.downloadAndInstall({ transport, archive: archiveOf(big) });
    await new Promise((r) => setTimeout(r, 20));
    store.cancelDownload();
    const state = await running;
    expect(state.download).toBeUndefined();
    expect(state.families.every((f) => f.installed === 0)).toBe(true);
    expect(existsSync(join(root, ".download", "pack.tar.part"))).toBe(true);
  });

  it("names a proxy that wants a login, and refuses a redirect off GitHub's download hosts", async () => {
    const root = temp(), store = new FontPackStore(root, CATALOG);
    const proxied = server([{ data: GOOD, throws: new ProxyAuthError("CONNECT") }]);
    expect((await store.downloadAndInstall({ transport: proxied.transport, archive: archiveOf(GOOD) })).download).toMatchObject({ phase: "failed", error: "proxyAuth" });
    const redirected = server([{ data: GOOD, redirect: "https://example.com/pack.tar" }]);
    expect((await store.downloadAndInstall({ transport: redirected.transport, archive: archiveOf(GOOD) })).download).toMatchObject({ phase: "failed", error: "network" });
    expect(redirected.requests.map((r) => r.url)).toEqual([URL_]);
  });

  it("a second 下载并安装 while one runs joins it; the IPC ops reach the store", async () => {
    const root = temp(), store = new FontPackStore(root, CATALOG);
    const { transport, requests } = server([{ data: GOOD }]);
    const network = () => ({ transport, archive: archiveOf(GOOD) });
    const pick = async () => null, open = async () => {};
    const [a, b] = await Promise.all([handleFontPackRequest(store, { op: "download" }, pick, open, root, network), handleFontPackRequest(store, { op: "download" }, pick, open, root, network)]);
    expect(requests).toHaveLength(1);
    expect(a).toEqual(b);
    await handleFontPackRequest(store, { op: "cancelDownload" }, pick, open, root, network);
  });
});

describe("main wiring", () => {
  it("downloads through the updater's own network session with the user's update proxy, never another session", () => {
    const main = readFileSync(join(__dirname, "../src/main/index.ts"), "utf8");
    const line = main.split("\n").find((l) => l.startsWith("const fontPackNetwork"))!;
    expect(line).toContain("createUpdateNet({ contained: () => pluginNetwork?.engaged() ?? false, proxy: () => desktopShell.updateProxyConfig() })");
    expect(main).toContain('join(app.getPath("userData"), FONT_PACK_DIR), fontPackNetwork);');
  });
});
