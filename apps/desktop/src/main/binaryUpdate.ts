// Release-package (binary) self-update, main process side: ask GitHub for the latest release, download
// the platform package with its signatures, verify them (minisign, embedded release keys) and the
// package's sha256 against the signed SHA256SUMS, unpack it into <base>/releases/<version>. The updater
// (updater.ts) then switches `current` and relaunches exactly as after a source build.
//
// Network: through a Transport (updateTransport.ts; in the app Chromium's network stack with the OS
// proxy settings, updateNet.ts), https only; downloads start at github.com and follow redirects only to
// GitHub's asset hosts (shared/binaryUpdate.ts DOWNLOAD_HOSTS), each hop checked before it is requested.
// A proxy that asks for credentials fails the check / download quietly (ProxyAuthError, no prompt). Every download has a
// size cap, a stall timeout and an overall timeout. Files are written under <base> (never the system
// temp dir): <base>/.update-download while downloading, <base>/releases/.unpack-* while unpacking.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Blake2b512 } from "./blake2b";
import { verifyPrehashed, type MinisignPublicKey } from "./minisign";
import { assetUrl, downloadUrlAllowed, latestReleaseUrl, MAX_SIGNATURE_BYTES, MAX_SUMS_BYTES, parseLatestRelease, parseSha256Sums, SIG_SUFFIX, SUMS_FILE, unsafeArchiveMembers, updateAssets, versionReleaseName, type LatestRelease, type ReleasePlatform } from "../shared/binaryUpdate";
import { parseReleaseInfo, parseReleasePage } from "../shared/update";
import { ProxyAuthError, type Transport, type TransportResponse } from "./updateTransport";

const API_TIMEOUT_MS = 30_000;
const STALL_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const MAX_REDIRECTS = 5;
const MAX_API_BYTES = 1024 * 1024;
const USER_AGENT = "cutex-desktop-updater";

export interface BinarySource {
  repo: { owner: string; repo: string };
  platform: ReleasePlatform;
  /** https://api.github.com (test builds: a loopback fake). */
  apiBase: string;
  /** https://github.com (test builds: the same fake). */
  downloadBase: string;
  /** Origins allowed besides DOWNLOAD_HOSTS (test builds only: the fake's origin). */
  extraOrigins: string[];
  keys: MinisignPublicKey[];
  /** Test builds only (CUTEX_DESKTOP_UPDATE_TEST_PROXY): a fixed loopback proxy instead of the system one. */
  testProxy: string | null;
}

/** An HTTP answer the check treats as "try later" (network, rate limit, 5xx) vs "nothing published" (404). */
export class ReleaseCheckError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "noRelease" | "invalid",
  ) {
    super(message);
  }
}

/** Latest-release lookups with an ETag (a 304 does not count against GitHub's rate limit). */
export class LatestReleaseClient {
  private etag: string | null = null;
  private cached: LatestRelease | null = null;

  constructor(
    private readonly source: BinarySource,
    private readonly transport: Transport,
  ) {}

  async latest(): Promise<LatestRelease> {
    const url = latestReleaseUrl(this.source.apiBase, this.source.repo);
    const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": USER_AGENT };
    if (this.etag && this.cached) headers["If-None-Match"] = this.etag;
    const signal = AbortSignal.timeout(API_TIMEOUT_MS);
    let res: TransportResponse;
    try {
      res = await this.transport(url, { headers, signal });
    } catch (error) {
      if (error instanceof ProxyAuthError) throw new ReleaseCheckError(error.message, "unreachable");
      throw new ReleaseCheckError(`cannot reach ${new URL(url).host}: ${errorText(error)}`, "unreachable");
    }
    if (res.status === 304 && this.cached) {
      res.cancel();
      return this.cached;
    }
    if (res.status === 404) {
      res.cancel();
      throw new ReleaseCheckError("no published release yet", "noRelease");
    }
    if (res.status < 200 || res.status >= 300) {
      res.cancel();
      const limited = res.status === 403 || res.status === 429;
      const redirect = res.status >= 300 && res.status < 400;
      throw new ReleaseCheckError(`${new URL(url).host} answered ${res.status}${limited ? " (rate limited)" : redirect ? " (unexpected redirect)" : ""}`, "unreachable");
    }
    let text: string;
    try {
      text = await readCapped(res, MAX_API_BYTES);
    } catch (error) {
      if (error instanceof ReleaseCheckError) throw error;
      throw new ReleaseCheckError(`reading the release answer failed: ${errorText(error)}`, "unreachable");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ReleaseCheckError("the release answer is not JSON", "invalid");
    }
    const parsed = parseLatestRelease(raw);
    if ("reason" in parsed) throw new ReleaseCheckError(parsed.reason, "invalid");
    this.etag = res.header("etag");
    this.cached = parsed;
    return parsed;
  }
}

export type BinaryStep = "download" | "verify" | "unpack";

/**
 * Download, verify and unpack `release` into `<releasesDir>/<version>[-n][suffix]`. Returns the new
 * release dir. Throws (leaving nothing behind but what the next run cleans) on any failure.
 */
export async function installBinaryRelease(opts: {
  source: BinarySource;
  transport: Transport;
  release: LatestRelease;
  baseDir: string;
  releasesDir: string;
  /** Path segments of the executable inside a release dir (InstallLayout.launcher). */
  launcher: string[];
  /** Path segments of the packaged app's package.json inside a release dir. */
  packageJson: string[];
  win: boolean;
  /** macOS: unpack with ditto, strip the quarantine mark, require a valid code signature. */
  mac?: boolean;
  /** Release dir name suffix (macOS `.noindex`). */
  suffix?: string;
  onStep: (step: BinaryStep) => void;
  log: (text: string) => void;
}): Promise<string> {
  const { source, release } = opts;
  const assets = updateAssets(release, source.platform);
  if ("reason" in assets) throw new Error(assets.reason);
  const work = join(opts.baseDir, ".update-download");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const unpackDir = join(opts.releasesDir, `.unpack-${release.version}-${process.pid}`);
  try {
    opts.onStep("download");
    const get = (name: string, size: number, max: number) => download(opts.transport, assetUrl(source.downloadBase, source.repo, release.tag, name), join(work, name), { max, size, extraOrigins: source.extraOrigins });
    await get(assets.sums.name, assets.sums.size, MAX_SUMS_BYTES);
    await get(assets.sumsSig.name, assets.sumsSig.size, MAX_SIGNATURE_BYTES);
    await get(assets.archiveSig.name, assets.archiveSig.size, MAX_SIGNATURE_BYTES);
    opts.log(`downloading ${assets.archive.name} (${assets.archive.size} bytes) from release ${release.tag}`);
    await get(assets.archive.name, assets.archive.size, assets.archive.size);

    opts.onStep("verify");
    const archivePath = join(work, assets.archive.name);
    const sumsBytes = readFileSync(join(work, SUMS_FILE));
    const sumsSig = verifyPrehashed(new Blake2b512().update(sumsBytes).digest(), readFileSync(join(work, SUMS_FILE + SIG_SUFFIX), "utf8"), source.keys, SUMS_FILE);
    const sums = parseSha256Sums(sumsBytes.toString("utf8"));
    const { blake, sha256 } = await hashFile(archivePath);
    const archiveSig = verifyPrehashed(blake, readFileSync(archivePath + SIG_SUFFIX, "utf8"), source.keys, assets.archive.name);
    const listed = sums.get(assets.archive.name);
    if (!listed) throw new Error(`SHA256SUMS does not list ${assets.archive.name}`);
    if (listed !== sha256) throw new Error(`sha256 of ${assets.archive.name} does not match SHA256SUMS`);
    opts.log(`verified ${assets.archive.name}: signature by key ${archiveSig.keyId}, SHA256SUMS by key ${sumsSig.keyId}, sha256 ${sha256}`);

    opts.onStep("unpack");
    rmSync(unpackDir, { recursive: true, force: true });
    mkdirSync(unpackDir, { recursive: true });
    await unpack(archivePath, unpackDir, assets.topDir, opts.win, !!opts.mac);
    const top = join(unpackDir, assets.topDir);
    if (opts.mac) await prepareMacBundle(join(top, opts.launcher[0]!));
    // The unpacked tree must be a release of exactly this version, recording the same release page.
    if (!existsSync(join(top, ...opts.launcher))) throw new Error(`the package has no ${opts.launcher.join("/")}`);
    let packaged: unknown = null;
    try {
      packaged = JSON.parse(readFileSync(join(top, ...opts.packageJson), "utf8"));
    } catch {
      throw new Error(`the package has no readable ${opts.packageJson.join("/")}`);
    }
    const info = parseReleaseInfo(packaged);
    if ("reason" in info) throw new Error(`the package is not a release: ${info.reason}`);
    if (info.version !== release.version) throw new Error(`the package says version ${info.version ?? "(none)"}, the release is ${release.version}`);
    if (!parseReleasePage(info.releasePage)) throw new Error("the package records no release page (it could not update itself again)");
    const name = versionReleaseName(release.version, (n) => existsSync(join(opts.releasesDir, n)), opts.suffix ?? "");
    const dest = join(opts.releasesDir, name);
    renameSync(top, dest);
    return dest;
  } finally {
    rmSync(unpackDir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

/** Remove leftovers of an interrupted update (at start; the paths are fixed names under <base>). */
export function cleanBinaryLeftovers(baseDir: string, releasesDir: string): void {
  rmSync(join(baseDir, ".update-download"), { recursive: true, force: true });
  let names: string[] = [];
  try {
    names = readdirSync(releasesDir);
  } catch {
    return;
  }
  for (const name of names) if (/^\.unpack-[0-9A-Za-z.+-]+-\d+$/.test(name)) rmSync(join(releasesDir, name), { recursive: true, force: true });
}

async function hashFile(path: string): Promise<{ blake: Buffer; sha256: string }> {
  const blake = new Blake2b512();
  const sha = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    blake.update(chunk as Buffer);
    sha.update(chunk as Buffer);
  }
  return { blake: blake.digest(), sha256: sha.digest("hex") };
}

/**
 * GET `url` into `dest`, following redirects (each hop checked with downloadUrlAllowed). `size`: the
 * size the release API announced — more bytes abort, fewer fail. `max`: hard cap.
 */
export async function download(transport: Transport, url: string, dest: string, opts: { max: number; size: number; extraOrigins?: readonly string[] }): Promise<void> {
  if (opts.size > opts.max) throw new Error(`${url} is larger than ${opts.max} bytes`);
  const overall = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  let href = url;
  for (let hop = 0; ; hop++) {
    if (!downloadUrlAllowed(href, opts.extraOrigins)) throw new Error(`refusing to download from ${safeUrl(href)}`);
    const stall = new AbortController();
    let timer = setTimeout(() => stall.abort(new Error("download stalled")), STALL_TIMEOUT_MS);
    const signal = AbortSignal.any([overall, stall.signal]);
    try {
      let res: TransportResponse;
      try {
        res = await transport(href, { signal, headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" } });
      } catch (error) {
        throw new Error(error instanceof ProxyAuthError ? error.message : `download of ${safeUrl(url)} failed: ${errorText(error)}`);
      }
      if (res.status >= 300 && res.status < 400) {
        res.cancel();
        const location = res.header("location");
        if (!location || hop >= MAX_REDIRECTS) throw new Error(`download of ${safeUrl(url)}: bad redirect`);
        // Checked at the top of the loop before anything is requested from it.
        href = new URL(location, href).href;
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        res.cancel();
        throw new Error(`download of ${safeUrl(url)} answered ${res.status}`);
      }
      const declared = Number(res.header("content-length") ?? NaN);
      if (Number.isFinite(declared) && !res.header("content-encoding") && declared !== opts.size) {
        res.cancel();
        throw new Error(`download of ${safeUrl(url)}: ${declared} bytes, the release lists ${opts.size}`);
      }
      let received = 0;
      const counter = async function* (body: AsyncIterable<Uint8Array>) {
        for await (const chunk of body) {
          received += chunk.length;
          if (received > opts.size || received > opts.max) throw new Error(`download of ${safeUrl(url)} is larger than the release lists`);
          clearTimeout(timer);
          timer = setTimeout(() => stall.abort(new Error("download stalled")), STALL_TIMEOUT_MS);
          yield chunk;
        }
      };
      try {
        await pipeline(res.body, counter, createWriteStream(dest));
      } catch (error) {
        res.cancel();
        throw new Error(`download of ${safeUrl(url)} failed: ${errorText(error)}`);
      }
      if (received !== opts.size) throw new Error(`download of ${safeUrl(url)} is incomplete (${received} of ${opts.size} bytes)`);
      return;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Unpack with the system's tools: GNU tar on Linux; Windows 10+ ships bsdtar as System32\tar.exe, which
 * reads zip; macOS lists with bsdtar and extracts with `ditto -x -k` (keeps the bundle's symlinks,
 * modes and signature, and folds the `__MACOSX/` entries of a `ditto -c -k --sequesterRsrc` zip back
 * into extended attributes).
 */
async function unpack(archive: string, into: string, topDir: string, win: boolean, mac: boolean): Promise<void> {
  const tar = win ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : mac ? "/usr/bin/tar" : "tar";
  if (win && !existsSync(tar)) throw new Error(`${tar} not found (Windows 10 1803 or later ships it)`);
  const gz = archive.endsWith(".tar.gz");
  const listing = await run(tar, [gz ? "-tzf" : "-tf", archive]);
  const bad = unsafeArchiveMembers(listing, topDir, mac);
  if (bad.length) throw new Error(`the package has entries outside ${topDir}/: ${bad.slice(0, 3).join(", ")}`);
  if (mac) await run("/usr/bin/ditto", ["-x", "-k", archive, into]);
  else await run(tar, [gz ? "-xzf" : "-xf", archive, "-C", into]);
}

/**
 * macOS: the unpacked Cutex.app as a manual install would leave it — no `com.apple.quarantine` mark
 * (Node's downloads carry none, but strip it anyway) — and its (ad-hoc) signature must verify, deep
 * and strict, or the release is refused.
 */
async function prepareMacBundle(bundle: string): Promise<void> {
  if (!existsSync(join(bundle, "Contents", "Info.plist"))) throw new Error(`the package has no ${bundle}`);
  await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", bundle]).catch(() => {});
  try {
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  } catch (error) {
    throw new Error(`the package's Cutex.app signature does not verify: ${errorText(error)}`);
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out).toString("utf8")) : reject(new Error(`${command} ${args[0]} exited ${code}: ${err.trim()}`))));
  });
}

async function readCapped(res: TransportResponse, max: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let n = 0;
  for await (const chunk of res.body) {
    n += chunk.length;
    if (n > max) {
      res.cancel();
      throw new ReleaseCheckError("the release answer is too large", "invalid");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A URL for logs / errors: no query string (signed asset URLs carry tokens in it). */
function safeUrl(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "(bad url)";
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
  }
  return String(error);
}
