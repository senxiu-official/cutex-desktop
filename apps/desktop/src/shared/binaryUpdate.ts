// Pure logic of the release-package (binary) self-update (no Node / Electron imports): which GitHub
// repository a CI release package updates from, versions, the platform's asset names, the release
// API answer, SHA256SUMS, which download URLs may be followed. The main process
// (src/main/binaryUpdate.ts) does the network, signature and file work.
//
// A CI release package (scripts/package-portable.mjs --no-source --channel release --release-page
// https://github.com/<owner>/<repo>/releases --version <v>) installed in the portable layout
// (<base>/releases/<v>, <base>/current) updates from the latest GitHub release of <owner>/<repo>:
//   tag v<version>: cutex-desktop-<version>-<platform>.{tar.gz,zip} (+ .minisig), SHA256SUMS (+ .minisig)

/** https://github.com/<owner>/<repo>[/releases[/…]] → the repository; anything else (other hosts, http,
 *  credentials, ports, odd names) → null. */
export function githubRepoOf(releasePage: string | null | undefined): { owner: string; repo: string } | null {
  if (!releasePage) return null;
  let url: URL;
  try {
    url = new URL(releasePage);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || (parts.length > 2 && parts[2] !== "releases")) return null;
  const [owner, repo] = parts as [string, string];
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo };
}

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Pre-release identifiers (`1.0.0-rc.1` → ["rc", "1"]); empty for a release. */
  pre: string[];
}

/** `1.2.3`, `v1.2.3`, `1.2.3-rc.1` (build metadata `+…` ignored); null otherwise. */
export function parseVersion(text: unknown): SemVer | null {
  if (typeof text !== "string") return null;
  const m = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence: < 0 when a < b, 0 when equal, > 0 when a > b. */
export function compareVersions(a: SemVer, b: SemVer): number {
  for (const k of ["major", "minor", "patch"] as const) if (a[k] !== b[k]) return a[k] - b[k];
  if (!a.pre.length || !b.pre.length) return (a.pre.length ? -1 : 0) - (b.pre.length ? -1 : 0);
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Whether `candidate` is strictly newer than `current` (both version strings); false when either is not a version. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  return !!a && !!b && compareVersions(a, b) > 0;
}

/** The release platforms CI publishes (package-desktop.sh). */
export type ReleasePlatform = "linux-x64" | "windows-x64" | "macos-arm64" | "macos-x64";

export function releasePlatform(platform: string, arch: string): ReleasePlatform | null {
  if (arch !== "x64" && !(platform === "darwin" && arch === "arm64")) return null;
  if (platform === "linux") return "linux-x64";
  if (platform === "win32") return "windows-x64";
  if (platform === "darwin") return arch === "arm64" ? "macos-arm64" : "macos-x64";
  return null;
}

/** Package file and its top-level directory for a version on a platform. */
export function packageNames(version: string, platform: ReleasePlatform): { archive: string; topDir: string } {
  const topDir = `cutex-desktop-${version}-${platform}`;
  return { archive: `${topDir}.${platform === "linux-x64" ? "tar.gz" : "zip"}`, topDir };
}

export const SUMS_FILE = "SHA256SUMS";
export const SIG_SUFFIX = ".minisig";

/** Size caps of the downloads (bytes). */
export const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
export const MAX_SIGNATURE_BYTES = 4096;
export const MAX_SUMS_BYTES = 64 * 1024;

export interface ReleaseAsset {
  name: string;
  size: number;
}

export interface LatestRelease {
  tag: string;
  version: string;
  name: string;
  publishedAt: string | null;
  htmlUrl: string | null;
  assets: ReleaseAsset[];
}

/** A tag usable in a download URL and as a version: `v<semver>`. */
export function versionOfTag(tag: unknown): string | null {
  if (typeof tag !== "string" || !/^v[0-9A-Za-z.+-]{1,64}$/.test(tag)) return null;
  return parseVersion(tag) ? tag.slice(1) : null;
}

/**
 * GitHub's `GET /repos/<owner>/<repo>/releases/latest` answer (latest = newest non-draft, non-prerelease
 * release). Returns a reason for anything unusable: a draft / prerelease, a tag that is not `v<semver>`.
 */
export function parseLatestRelease(raw: unknown): LatestRelease | { reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { reason: "release answer is not an object" };
  const v = raw as Record<string, unknown>;
  if (v.draft === true || v.prerelease === true) return { reason: "latest release is a draft or prerelease" };
  const tag = typeof v.tag_name === "string" ? v.tag_name : "";
  const version = versionOfTag(tag);
  if (!version) return { reason: `latest release tag ${JSON.stringify(tag)} is not v<version>` };
  const assets: ReleaseAsset[] = [];
  if (Array.isArray(v.assets)) {
    for (const a of v.assets) {
      if (!a || typeof a !== "object") continue;
      const { name, size } = a as Record<string, unknown>;
      if (typeof name === "string" && /^[A-Za-z0-9._+-]{1,200}$/.test(name) && typeof size === "number" && Number.isSafeInteger(size) && size >= 0) assets.push({ name, size });
    }
  }
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : null);
  const html = str("html_url");
  return { tag, version, name: (str("name") || tag).slice(0, 200), publishedAt: str("published_at"), htmlUrl: html && html.startsWith("https://github.com/") ? html : null, assets };
}

/** The four files an update needs from a release, with their sizes; or what is missing / too big. */
export function updateAssets(release: LatestRelease, platform: ReleasePlatform): { archive: ReleaseAsset; archiveSig: ReleaseAsset; sums: ReleaseAsset; sumsSig: ReleaseAsset; topDir: string } | { reason: string } {
  const { archive, topDir } = packageNames(release.version, platform);
  const find = (name: string, max: number): ReleaseAsset | string => {
    const a = release.assets.find((x) => x.name === name);
    if (!a) return `release ${release.tag} has no ${name}`;
    if (a.size > max) return `${name} is larger than ${max} bytes`;
    return a;
  };
  const got = [find(archive, MAX_PACKAGE_BYTES), find(archive + SIG_SUFFIX, MAX_SIGNATURE_BYTES), find(SUMS_FILE, MAX_SUMS_BYTES), find(SUMS_FILE + SIG_SUFFIX, MAX_SIGNATURE_BYTES)];
  const missing = got.find((g): g is string => typeof g === "string");
  if (missing) return { reason: missing };
  const [a, as, s, ss] = got as ReleaseAsset[];
  return { archive: a!, archiveSig: as!, sums: s!, sumsSig: ss!, topDir };
}

/** `sha256sum` output → name → lowercase hex digest (`*name` binary marks accepted). Throws on a malformed line or a duplicate name. */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = /^([0-9a-fA-F]{64}) [ *]([^\s/\\][^/\\]*)$/.exec(line);
    if (!m) throw new Error(`malformed SHA256SUMS line: ${JSON.stringify(line.slice(0, 120))}`);
    const name = m[2]!;
    if (out.has(name)) throw new Error(`SHA256SUMS lists ${name} twice`);
    out.set(name, m[1]!.toLowerCase());
  }
  return out;
}

/** Hosts a download may be redirected to (GitHub's release-asset storage). Plus github.com itself. */
export const DOWNLOAD_HOSTS = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"] as const;

/** Whether a download (or one of its redirects) may be fetched: https on a GitHub host, no credentials, no port. */
export function downloadUrlAllowed(href: string, extraOrigins: readonly string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (extraOrigins.includes(url.origin)) return true;
  return url.protocol === "https:" && !url.port && !url.username && !url.password && (DOWNLOAD_HOSTS as readonly string[]).includes(url.hostname);
}

/** Where a release file is downloaded from (the redirect is followed only to DOWNLOAD_HOSTS). */
export function assetUrl(base: string, repo: { owner: string; repo: string }, tag: string, name: string): string {
  return `${base.replace(/\/+$/, "")}/${repo.owner}/${repo.repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

export const GITHUB_API = "https://api.github.com";
export const GITHUB_WEB = "https://github.com";

export function latestReleaseUrl(apiBase: string, repo: { owner: string; repo: string }): string {
  return `${apiBase.replace(/\/+$/, "")}/repos/${repo.owner}/${repo.repo}/releases/latest`;
}

/**
 * Background checks of a binary install ask GitHub's unauthenticated API (60 requests an hour per IP,
 * shared by everyone behind the same NAT): never more often than this, whatever the interval setting.
 */
export const BINARY_MIN_CHECK_MINUTES = 60;

/** Release directory name for a version: the version, suffixed -2, -3 … when taken (+ macOS `.noindex`). */
export function versionReleaseName(version: string, taken: (name: string) => boolean, suffix = ""): string {
  if (!taken(version + suffix)) return version + suffix;
  for (let i = 2; ; i++) if (!taken(`${version}-${i}${suffix}`)) return `${version}-${i}${suffix}`;
}

/**
 * Archive member names (`tar -t` output, one per line) that would land outside the top directory:
 * absolute paths, drive letters, `..` segments, or anything not under `<topDir>/`. Empty = fine.
 * `macResourceForks`: also accept ditto's `__MACOSX/<topDir>/…` attribute entries.
 */
export function unsafeArchiveMembers(listing: string, topDir: string, macResourceForks = false): string[] {
  const bad: string[] = [];
  for (const raw of listing.split(/\r?\n/)) {
    const name = raw.replace(/\\/g, "/");
    if (!name) continue;
    const segs = name.split("/");
    // macOS zips made with `ditto -c -k --sequesterRsrc` keep extended attributes under __MACOSX/<top>/…;
    // `ditto -x -k` folds them back into attributes instead of writing files there.
    if (macResourceForks && segs[0] === "__MACOSX" && !segs.includes("..") && (segs.length === 1 || segs[1] === "" || segs[1] === topDir || segs[1] === `._${topDir}`)) continue;
    if (name.startsWith("/") || /^[A-Za-z]:/.test(name) || segs.includes("..") || (name !== topDir && name !== `${topDir}/` && segs[0] !== topDir) || (segs[0] === topDir && name !== topDir && !name.startsWith(`${topDir}/`))) bad.push(raw);
  }
  return bad;
}
