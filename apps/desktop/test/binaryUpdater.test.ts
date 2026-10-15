// The Updater on a release-package install (Linux layout) against a local fake GitHub: check → offer by
// version → download → verify (minisign + signed SHA256SUMS) → unpack → switch `current`; and every
// refusal leaves `current`, releases/ and <base> as they were. Packages are real tar.gz files; signatures
// are made here with a throwaway Ed25519 key in minisign's format (test/minisign.test.ts checks that
// format against the minisign CLI).
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ appPath: "", userData: "", relaunched: [] as string[] }));
vi.mock("electron", () => ({
  app: { isPackaged: true, getAppPath: () => env.appPath, getPath: () => env.userData, relaunch: (o: { execPath: string }) => env.relaunched.push(o.execPath), exit: () => {} },
}));

const { Updater } = await import("../src/main/updater");
const { nodeTransport } = await import("../src/main/updateTransport");

/** The transport under test: Node, direct or through `proxyOf()` (the app uses Chromium's, updateNet.ts). */
let proxyOf: () => { host: string; port: number } | null = () => null;
const makeUpdater = (emit: (s: UpdateStatus) => void) => {
  const p = proxyOf();
  return new Updater(emit, null, { transport: nodeTransport(p ? { scheme: "http", ...p } : null) });
};

const OWNER = "example-org";
const REPO = "cutex-desktop";
const PAGE = `https://github.com/${OWNER}/${REPO}/releases`;
const linux = process.platform === "linux" && process.arch === "x64";

// ---- minisign signing (test side) ----
function keypair(): { privateKey: KeyObject; keyId: Buffer; pub: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = randomBytes(8);
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return { privateKey, keyId, pub: Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64") };
}
function minisig(data: Buffer, file: string, k: { privateKey: KeyObject; keyId: Buffer }): string {
  const sig = sign(null, createHash("blake2b512").update(data).digest(), k.privateKey);
  const trusted = `timestamp:1792000000\tfile:${file}\thashed`;
  const global = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), k.privateKey);
  return `untrusted comment: signature from minisign secret key\n${Buffer.concat([Buffer.from("ED"), k.keyId, sig]).toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`;
}

// ---- fake GitHub ----
interface Release {
  status?: number;
  tag: string;
  files: Record<string, Buffer>;
}
let server: Server;
let origin = "";
let release: Release | null = null;
let redirectTo: string | null = null;
const hits: string[] = [];

let root: string;
const key = keypair();
const otherKey = keypair();

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "cutex-binary-update-"));
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    hits.push(url.pathname);
    if (url.pathname === `/repos/${OWNER}/${REPO}/releases/latest`) {
      if (!release || release.status) {
        res.writeHead(release?.status ?? 404).end("{}");
        return;
      }
      const assets = Object.entries(release.files).map(([name, data]) => ({ name, size: data.length }));
      res.writeHead(200, { "content-type": "application/json", etag: `"${release.tag}"` }).end(JSON.stringify({ tag_name: release.tag, name: `Cutex ${release.tag}`, draft: false, prerelease: false, published_at: "2026-10-20T00:00:00Z", assets }));
      return;
    }
    const dl = new RegExp(`^/${OWNER}/${REPO}/releases/download/([^/]+)/([^/]+)$`).exec(url.pathname);
    if (dl && release && decodeURIComponent(dl[1]!) === release.tag) {
      // Like GitHub: a redirect to the asset store (here: the same origin, or `redirectTo`).
      res.writeHead(302, { location: `${redirectTo ?? origin}/assets/${dl[2]}` }).end();
      return;
    }
    const asset = /^\/assets\/([^/]+)$/.exec(url.pathname);
    const data = asset && release?.files[decodeURIComponent(asset[1]!)];
    if (data) {
      res.writeHead(200, { "content-type": "application/octet-stream", "content-length": data.length }).end(data);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  process.env.CUTEX_DESKTOP_UPDATE_TEST_API = origin;
  process.env.CUTEX_DESKTOP_UPDATE_TEST_PUBKEY = key.pub;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  delete process.env.CUTEX_DESKTOP_UPDATE_TEST_API;
  delete process.env.CUTEX_DESKTOP_UPDATE_TEST_PUBKEY;
  rmSync(root, { recursive: true, force: true });
});

const realExecPath = process.execPath;
afterEach(() => {
  Object.defineProperty(process, "execPath", { value: realExecPath, configurable: true });
  release = null;
  redirectTo = null;
  hits.length = 0;
  env.relaunched.length = 0;
});

function packageJson(version: string, patch: Record<string, unknown> = {}) {
  return { name: "@cutex-desktop/app", productName: "Cutex", version, main: "out/main/index.cjs", commit: createHash("sha1").update(version).digest("hex"), committedAt: null, sourceDir: null, nodeDir: null, releaseDir: null, channel: "release", releasePage: PAGE, updateTestHooks: true, ...patch };
}

/** A release dir's content: the launcher and resources/app/package.json. */
function writeRelease(dir: string, version: string, patch: Record<string, unknown> = {}) {
  mkdirSync(join(dir, "resources", "app"), { recursive: true });
  writeFileSync(join(dir, "cutex"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(join(dir, "resources", "app", "package.json"), JSON.stringify(packageJson(version, patch)));
}

/** A signed release on the fake GitHub, built like package-desktop.sh + sign-and-upload.sh. */
function publish(version: string, opts: { pkg?: Record<string, unknown>; signer?: typeof key; sumsOverride?: string; topDir?: string } = {}): Release {
  const name = `cutex-desktop-${version}-linux-x64`;
  const work = mkdtempSync(join(root, "pkg-"));
  writeRelease(join(work, opts.topDir ?? name), version, opts.pkg);
  execFileSync("tar", ["-C", work, "-czf", join(work, `${name}.tar.gz`), opts.topDir ?? name]);
  const archive = readFileSync(join(work, `${name}.tar.gz`));
  const sums = Buffer.from(opts.sumsOverride ?? `${createHash("sha256").update(archive).digest("hex")}  ${name}.tar.gz\n`);
  const signer = opts.signer ?? key;
  const files = {
    [`${name}.tar.gz`]: archive,
    [`${name}.tar.gz.minisig`]: Buffer.from(minisig(archive, `${name}.tar.gz`, signer)),
    SHA256SUMS: sums,
    "SHA256SUMS.minisig": Buffer.from(minisig(sums, "SHA256SUMS", signer)),
  };
  return { tag: `v${version}`, files };
}

/** A binary install at <base>/releases/<version> with <base>/current → it, running through current. */
function install(name: string, version = "0.1.0", patch: Record<string, unknown> = {}): string {
  const base = join(root, name);
  const rel = join(base, "releases", version);
  writeRelease(rel, version, patch);
  symlinkSync(rel, join(base, "current"));
  const userData = join(base, "userData");
  mkdirSync(userData, { recursive: true });
  env.appPath = join(rel, "resources", "app");
  env.userData = userData;
  Object.defineProperty(process, "execPath", { value: join(base, "current", "cutex"), configurable: true });
  return base;
}

/** Everything under <base> but userData (leftover check). */
const tree = (base: string) => readdirSync(base).filter((n) => n !== "userData").sort();

describe.runIf(linux)("binary self-update (Linux release package)", () => {
  it("offers a newer release by version, installs it into releases/<version> and switches current", async () => {
    const base = install("happy");
    const updater = makeUpdater(() => {});
    expect(updater.state()).toMatchObject({ state: "idle", binary: true, channel: "release", source: `github.com/${OWNER}/${REPO}`, releasePage: PAGE, current: { version: "0.1.0" } });
    release = publish("0.2.0");
    const s = await updater.check();
    expect(s).toMatchObject({ state: "available", latest: { version: "0.2.0", count: 0, subject: "Cutex v0.2.0" } });
    const steps: (string | undefined)[] = [];
    const tracked = makeUpdater((st) => steps.push(st.step));
    await tracked.check();
    const done = await tracked.apply();
    expect(done.state).toBe("ready");
    expect(steps).toEqual(expect.arrayContaining(["download", "verify", "unpack", "switch"]));
    expect(readlinkSync(join(base, "current"))).toBe(join(base, "releases", "0.2.0"));
    expect(JSON.parse(readFileSync(join(base, "releases", "0.2.0", "resources", "app", "package.json"), "utf8")).version).toBe("0.2.0");
    expect(readdirSync(join(base, "releases")).sort()).toEqual(["0.1.0", "0.2.0"]);
    expect(tree(base)).toEqual(["current", "releases"]);
    expect(JSON.parse(readFileSync(join(base, "userData", "update-pending.json"), "utf8"))).toMatchObject({ from: join(base, "releases", "0.1.0"), to: join(base, "releases", "0.2.0") });
    expect(readFileSync(join(base, "userData", "update.log"), "utf8")).toMatch(/verified cutex-desktop-0\.2\.0-linux-x64\.tar\.gz: signature by key [0-9A-F]{16}/);
    // Downloads started at the release download path and were redirected to the asset store.
    expect(hits.filter((h) => h.startsWith("/assets/"))).toHaveLength(4);
  });

  it("stays idle for the same or an older release (never a downgrade)", async () => {
    install("same", "0.2.0");
    release = publish("0.2.0");
    expect((await makeUpdater(() => {}).check()).state).toBe("idle");
    release = publish("0.1.5");
    expect((await makeUpdater(() => {}).check()).state).toBe("idle");
  });

  it("a release without this platform's files is not offered", async () => {
    install("no-asset");
    release = publish("0.2.0");
    delete release.files["SHA256SUMS.minisig"];
    expect((await makeUpdater(() => {}).check()).state).toBe("idle");
  });

  const refuse = async (name: string, rel: Release, error: RegExp, step = "verify") => {
    const base = install(name);
    release = rel;
    const updater = makeUpdater(() => {});
    expect((await updater.check()).state).toBe("available");
    const s = await updater.apply();
    expect(s).toMatchObject({ state: "error", step });
    expect(s.error).toMatch(error);
    expect(readlinkSync(join(base, "current"))).toBe(join(base, "releases", "0.1.0"));
    expect(readdirSync(join(base, "releases"))).toEqual(["0.1.0"]);
    expect(tree(base)).toEqual(["current", "releases"]);
    expect(existsSync(join(base, "userData", "update-pending.json"))).toBe(false);
    // Still offered: the button turns into 重试更新.
    expect(s.latest?.version).toBe("0.2.0");
  };

  it("refuses a package signed with an untrusted key", async () => {
    await refuse("untrusted", publish("0.2.0", { signer: otherKey }), /unknown key/);
  });

  it("refuses a package whose signature does not match it", async () => {
    const rel = publish("0.2.0");
    const other = publish("0.2.0", { pkg: { extra: 1 } });
    rel.files["cutex-desktop-0.2.0-linux-x64.tar.gz.minisig"] = other.files["cutex-desktop-0.2.0-linux-x64.tar.gz.minisig"]!;
    await refuse("bad-sig", rel, /signature does not verify/);
  });

  it("refuses a package whose sha256 differs from the signed SHA256SUMS", async () => {
    await refuse("sha-mismatch", publish("0.2.0", { sumsOverride: `${"0".repeat(64)}  cutex-desktop-0.2.0-linux-x64.tar.gz\n` }), /does not match SHA256SUMS/);
  });

  it("refuses a SHA256SUMS that does not list the package", async () => {
    await refuse("sha-missing", publish("0.2.0", { sumsOverride: `${"0".repeat(64)}  something-else.tar.gz\n` }), /does not list/);
  });

  it("refuses a package that says another version, or has entries outside its top directory", async () => {
    await refuse("wrong-version", publish("0.2.0", { pkg: { version: "0.1.9" } }), /says version 0\.1\.9/, "unpack");
    await refuse("wrong-top", publish("0.2.0", { topDir: "cutex-desktop-0.2.0-linux-x64-x" }), /outside cutex-desktop-0\.2\.0-linux-x64\//, "unpack");
  });

  it("refuses a redirect off the allowed hosts", async () => {
    redirectTo = "http://127.0.0.2:9";
    await refuse("redirect", publish("0.2.0"), /refusing to download from http:\/\/127\.0\.0\.2:9/, "download");
  });

  it("no release yet → quiet noRelease; GitHub unreachable → retryable remoteUnreachable", async () => {
    install("no-release");
    const updater = makeUpdater(() => {});
    expect(await updater.check()).toMatchObject({ state: "unsupported", code: "noRelease", retryable: true });
    release = { status: 503, tag: "", files: {} };
    expect(await updater.check()).toMatchObject({ state: "unsupported", code: "remoteUnreachable", retryable: true });
    release = publish("0.2.0");
    expect(await updater.check()).toMatchObject({ state: "available", latest: { version: "0.2.0" } });
  });

  it("through an HTTP proxy: every request goes via the proxy and the update completes", async () => {
    const seen: string[] = [];
    const proxy = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      // A plain forward proxy for http:// targets (absolute-form request lines).
      const target = new URL(req.url ?? "");
      const up = httpRequest({ host: target.hostname, port: target.port, path: target.pathname + target.search, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => res.writeHead(502).end());
      req.pipe(up);
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
    const port = (proxy.address() as { port: number }).port;
    proxyOf = () => ({ host: "127.0.0.1", port });
    try {
      const base = install("via-proxy");
      release = publish("0.2.0");
      const updater = makeUpdater(() => {});
      expect((await updater.check()).state).toBe("available");
      expect((await updater.apply()).state).toBe("ready");
      expect(readlinkSync(join(base, "current"))).toBe(join(base, "releases", "0.2.0"));
      expect(seen.some((l) => l.startsWith(`GET ${origin}/repos/${OWNER}/${REPO}/releases/latest`))).toBe(true);
      expect(seen.filter((l) => l.includes("/assets/"))).toHaveLength(4);
    } finally {
      proxyOf = () => null;
      await new Promise((r) => proxy.close(r));
    }
  });

  it("a proxy that wants credentials: quiet retryable remoteUnreachable naming proxy authentication", async () => {
    const proxy = createServer((_req, res) => res.writeHead(407, { "proxy-authenticate": 'Basic realm="corp"' }).end());
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", () => r()));
    const port = (proxy.address() as { port: number }).port;
    proxyOf = () => ({ host: "127.0.0.1", port });
    try {
      install("proxy-auth");
      release = publish("0.2.0");
      const s = await makeUpdater(() => {}).check();
      expect(s).toMatchObject({ state: "unsupported", code: "remoteUnreachable", retryable: true });
      expect(s.reason).toMatch(/proxy requires authentication/);
    } finally {
      proxyOf = () => null;
      await new Promise((r) => proxy.close(r));
    }
  });

  it("other release packages keep the Releases-page link: main channel, no version, a non-GitHub page", async () => {
    for (const [name, patch] of [
      ["main-channel", { channel: "main" }],
      ["no-version", { version: undefined }],
      ["not-github", { releasePage: "https://example.org/cutex/releases" }],
    ] as const) {
      install(name, "0.1.0", patch);
      const s: UpdateStatus = makeUpdater(() => {}).state();
      expect(s).toMatchObject({ state: "unsupported", code: "releasePackage" });
      expect(s.binary).toBeUndefined();
    }
  });
});
