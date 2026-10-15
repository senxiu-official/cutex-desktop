// Release-package (binary) self-update: the pure parts (shared/binaryUpdate.ts) and which installs
// update from GitHub at all (main/updater.ts binarySource).
import { describe, expect, it, vi } from "vitest";
import { assetUrl, compareVersions, downloadUrlAllowed, githubRepoOf, isNewerVersion, latestReleaseUrl, packageNames, parseLatestRelease, parseSha256Sums, parseVersion, releasePlatform, unsafeArchiveMembers, updateAssets, versionOfTag, versionReleaseName, type LatestRelease } from "../src/shared/binaryUpdate";
import type { ReleaseInfo } from "../src/shared/update";

vi.mock("electron", () => ({ app: { isPackaged: false, getAppPath: () => "", getPath: () => "", relaunch: () => {}, exit: () => {} } }));
const { binarySource } = await import("../src/main/updater");

describe("githubRepoOf", () => {
  it("takes github.com/<owner>/<repo>[/releases…] over https", () => {
    expect(githubRepoOf("https://github.com/example-org/cutex-desktop/releases")).toEqual({ owner: "example-org", repo: "cutex-desktop" });
    expect(githubRepoOf("https://github.com/example-org/cutex-desktop/releases/tag/v0.1.0")).toEqual({ owner: "example-org", repo: "cutex-desktop" });
    expect(githubRepoOf("https://github.com/example-org/cutex-desktop")).toEqual({ owner: "example-org", repo: "cutex-desktop" });
  });

  it("refuses other hosts, http, credentials, ports, other paths and odd names", () => {
    for (const bad of [
      null,
      "",
      "http://github.com/a/b/releases",
      "https://gitlab.com/a/b/releases",
      "https://github.com.evil.example/a/b/releases",
      "https://www.github.com/a/b/releases",
      "https://user@github.com/a/b/releases",
      "https://github.com:8443/a/b/releases",
      "https://github.com/a/b/issues",
      "https://github.com/a",
      "https://github.com/-a/b/releases",
      "https://github.com/a/../releases",
    ]) expect(githubRepoOf(bad)).toBeNull();
  });
});

describe("versions", () => {
  it("parses semver with an optional v and pre-release, ignoring build metadata", () => {
    expect(parseVersion("v0.1.1")).toEqual({ major: 0, minor: 1, patch: 1, pre: [] });
    expect(parseVersion("1.2.3-rc.1+build.5")).toEqual({ major: 1, minor: 2, patch: 3, pre: ["rc", "1"] });
    for (const bad of ["", "1.2", "01.2.3", "1.2.3.4", "v", "latest", "1.2.3-", 1]) expect(parseVersion(bad)).toBeNull();
  });

  it("orders by semver precedence", () => {
    const order = ["0.1.0-alpha", "0.1.0-alpha.1", "0.1.0-alpha.beta", "0.1.0-beta", "0.1.0-beta.2", "0.1.0-beta.11", "0.1.0-rc.1", "0.1.0", "0.1.1", "0.2.0", "0.10.0", "1.0.0"];
    for (let i = 0; i < order.length - 1; i++) {
      expect(compareVersions(parseVersion(order[i])!, parseVersion(order[i + 1])!)).toBeLessThan(0);
      expect(compareVersions(parseVersion(order[i + 1])!, parseVersion(order[i])!)).toBeGreaterThan(0);
    }
    expect(compareVersions(parseVersion("1.0.0+a")!, parseVersion("1.0.0+b")!)).toBe(0);
  });

  it("isNewerVersion is strict and false for non-versions (never a downgrade or a re-install)", () => {
    expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("v0.1.1", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.0.9", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.1-rc.1", "0.1.1")).toBe(false);
    expect(isNewerVersion("nightly", "0.1.0")).toBe(false);
  });

  it("versionOfTag takes v<semver> only", () => {
    expect(versionOfTag("v0.1.1")).toBe("0.1.1");
    for (const bad of ["0.1.1", "v0.1", "v0.1.1/../x", "cutex-v0.1.1", null]) expect(versionOfTag(bad)).toBeNull();
  });
});

describe("platforms and names", () => {
  it("maps node's platform / arch to the published packages", () => {
    expect(releasePlatform("linux", "x64")).toBe("linux-x64");
    expect(releasePlatform("win32", "x64")).toBe("windows-x64");
    expect(releasePlatform("darwin", "arm64")).toBe("macos-arm64");
    expect(releasePlatform("darwin", "x64")).toBe("macos-x64");
    expect(releasePlatform("linux", "arm64")).toBeNull();
    expect(releasePlatform("freebsd", "x64")).toBeNull();
  });

  it("names packages like package-desktop.sh", () => {
    expect(packageNames("0.1.1", "linux-x64")).toEqual({ archive: "cutex-desktop-0.1.1-linux-x64.tar.gz", topDir: "cutex-desktop-0.1.1-linux-x64" });
    expect(packageNames("0.1.1", "windows-x64").archive).toBe("cutex-desktop-0.1.1-windows-x64.zip");
  });

  it("release dir names are the version, suffixed when taken", () => {
    const taken = new Set(["0.1.1", "0.1.1-2"]);
    expect(versionReleaseName("0.1.2", (n) => taken.has(n))).toBe("0.1.2");
    expect(versionReleaseName("0.1.1", (n) => taken.has(n))).toBe("0.1.1-3");
    expect(versionReleaseName("0.1.1", () => false, ".noindex")).toBe("0.1.1.noindex");
  });
});

const API_ANSWER = {
  tag_name: "v0.1.1",
  name: "Cutex 0.1.1",
  draft: false,
  prerelease: false,
  published_at: "2026-10-20T01:00:00Z",
  html_url: "https://github.com/example-org/cutex-desktop/releases/tag/v0.1.1",
  assets: [
    { name: "cutex-desktop-0.1.1-linux-x64.tar.gz", size: 120_000_000, browser_download_url: "https://github.com/x" },
    { name: "cutex-desktop-0.1.1-linux-x64.tar.gz.minisig", size: 330 },
    { name: "SHA256SUMS", size: 400 },
    { name: "SHA256SUMS.minisig", size: 300 },
    { name: "../evil", size: 1 },
    { name: "bad-size", size: -1 },
  ],
};

describe("parseLatestRelease / updateAssets", () => {
  it("reads GitHub's latest-release answer", () => {
    const r = parseLatestRelease(API_ANSWER) as LatestRelease;
    expect(r).toMatchObject({ tag: "v0.1.1", version: "0.1.1", name: "Cutex 0.1.1", publishedAt: "2026-10-20T01:00:00Z" });
    expect(r.assets.map((a) => a.name)).toEqual(["cutex-desktop-0.1.1-linux-x64.tar.gz", "cutex-desktop-0.1.1-linux-x64.tar.gz.minisig", "SHA256SUMS", "SHA256SUMS.minisig"]);
  });

  it("refuses drafts, prereleases, odd tags and non-objects", () => {
    expect(parseLatestRelease({ ...API_ANSWER, draft: true })).toHaveProperty("reason");
    expect(parseLatestRelease({ ...API_ANSWER, prerelease: true })).toHaveProperty("reason");
    expect(parseLatestRelease({ ...API_ANSWER, tag_name: "nightly" })).toHaveProperty("reason");
    expect(parseLatestRelease([])).toHaveProperty("reason");
    expect(parseLatestRelease(null)).toHaveProperty("reason");
  });

  it("finds the four files of a platform, or says what is missing / too big", () => {
    const r = parseLatestRelease(API_ANSWER) as LatestRelease;
    expect(updateAssets(r, "linux-x64")).toMatchObject({ archive: { name: "cutex-desktop-0.1.1-linux-x64.tar.gz" }, topDir: "cutex-desktop-0.1.1-linux-x64" });
    expect(updateAssets(r, "windows-x64")).toEqual({ reason: "release v0.1.1 has no cutex-desktop-0.1.1-windows-x64.zip" });
    const huge = { ...r, assets: r.assets.map((a) => (a.name === "SHA256SUMS" ? { ...a, size: 10_000_000 } : a)) };
    expect(updateAssets(huge, "linux-x64")).toEqual({ reason: "SHA256SUMS is larger than 65536 bytes" });
  });
});

describe("parseSha256Sums", () => {
  const h = "a".repeat(64);
  it("reads sha256sum output (text and binary marks)", () => {
    const m = parseSha256Sums(`${h}  cutex-desktop-0.1.1-linux-x64.tar.gz\n${"B".repeat(64)} *SHA-other.zip\n\n`);
    expect(m.get("cutex-desktop-0.1.1-linux-x64.tar.gz")).toBe(h);
    expect(m.get("SHA-other.zip")).toBe("b".repeat(64));
  });

  it("refuses malformed lines, paths and duplicates", () => {
    expect(() => parseSha256Sums(`${h.slice(1)}  x`)).toThrow(/malformed/);
    expect(() => parseSha256Sums(`${h}  dir/x`)).toThrow(/malformed/);
    expect(() => parseSha256Sums(`${h}  x\n${h}  x`)).toThrow(/twice/);
  });
});

describe("download URLs", () => {
  it("starts at github.com and follows redirects only to GitHub's asset hosts over https", () => {
    const repo = { owner: "example-org", repo: "cutex-desktop" };
    expect(assetUrl("https://github.com", repo, "v0.1.1", "SHA256SUMS")).toBe("https://github.com/example-org/cutex-desktop/releases/download/v0.1.1/SHA256SUMS");
    expect(latestReleaseUrl("https://api.github.com", repo)).toBe("https://api.github.com/repos/example-org/cutex-desktop/releases/latest");
    expect(downloadUrlAllowed("https://github.com/a/b/releases/download/v1.0.0/x")).toBe(true);
    expect(downloadUrlAllowed("https://objects.githubusercontent.com/github-production-release-asset/1?X-Amz=1")).toBe(true);
    expect(downloadUrlAllowed("https://release-assets.githubusercontent.com/github-production-release-asset/1")).toBe(true);
    for (const bad of ["http://github.com/x", "https://evil.example/x", "https://github.com:444/x", "https://u:p@github.com/x", "https://githubusercontent.com/x", "file:///etc/passwd", "nope"]) expect(downloadUrlAllowed(bad)).toBe(false);
    expect(downloadUrlAllowed("http://127.0.0.1:4000/x")).toBe(false);
    expect(downloadUrlAllowed("http://127.0.0.1:4000/x", ["http://127.0.0.1:4000"])).toBe(true);
  });
});

describe("unsafeArchiveMembers", () => {
  const top = "cutex-desktop-0.1.1-linux-x64";
  it("accepts a tree under the top directory", () => {
    expect(unsafeArchiveMembers(`${top}/\n${top}/cutex\n${top}/resources/app/package.json\n`, top)).toEqual([]);
  });
  it("macOS: accepts ditto's __MACOSX attribute entries for the top directory only", () => {
    const listing = `${top}/\n${top}/Cutex.app/\n__MACOSX/\n__MACOSX/${top}/\n__MACOSX/${top}/Cutex.app/._Info.plist\n__MACOSX/._${top}\n`;
    expect(unsafeArchiveMembers(listing, top, true)).toEqual([]);
    expect(unsafeArchiveMembers(listing, top)).toHaveLength(4);
    expect(unsafeArchiveMembers(`__MACOSX/other/x\n__MACOSX/${top}/../../x`, top, true)).toEqual(["__MACOSX/other/x", `__MACOSX/${top}/../../x`]);
  });
  it("flags absolute paths, .., drive letters and other top directories", () => {
    expect(unsafeArchiveMembers(`/etc/x\n${top}/../x\nC:/x\nother/x\n${top}x/y\n${top}/ok`, top)).toEqual(["/etc/x", `${top}/../x`, "C:/x", "other/x", `${top}x/y`]);
  });
});

describe("binarySource (which release packages update from GitHub)", () => {
  const info = (patch: Partial<ReleaseInfo> = {}): ReleaseInfo => ({ commit: "a".repeat(40), committedAt: null, sourceDir: null, nodeDir: null, channel: "release", codesignIdentity: null, releaseDir: null, releasePage: "https://github.com/example-org/cutex-desktop/releases", version: "0.1.0", updateTestHooks: false, ...patch });

  it("a Linux / Windows x64 release package on the release channel updates from api.github.com with the embedded keys", () => {
    const s = binarySource(info(), "release", {}, "linux", "x64");
    expect(s).toMatchObject({ repo: { owner: "example-org", repo: "cutex-desktop" }, platform: "linux-x64", apiBase: "https://api.github.com", downloadBase: "https://github.com", extraOrigins: [] });
    expect(!("reason" in s) && s.keys.map((k) => k.id)).toEqual(["00A0BD016183F447", "D12869DA9D6F784E"]);
    expect(binarySource(info(), "release", {}, "win32", "x64")).toMatchObject({ platform: "windows-x64" });
    expect(binarySource(info(), "release", {}, "darwin", "arm64")).toMatchObject({ platform: "macos-arm64" });
    expect(binarySource(info(), "release", {}, "darwin", "x64")).toMatchObject({ platform: "macos-x64" });
  });

  it("refuses another channel, other platforms, non-GitHub pages and missing versions", () => {
    expect(binarySource(info(), "main", {}, "linux", "x64")).toHaveProperty("reason");
    expect(binarySource(info(), "release", {}, "linux", "arm64")).toHaveProperty("reason");
    expect(binarySource(info({ releasePage: "https://example.org/releases" }), "release", {}, "linux", "x64")).toHaveProperty("reason");
    expect(binarySource(info({ version: null }), "release", {}, "linux", "x64")).toHaveProperty("reason");
    expect(binarySource(info({ version: "dev" }), "release", {}, "linux", "x64")).toHaveProperty("reason");
  });

  it("test overrides only in packages marked updateTestHooks, and only to loopback http", () => {
    const env = { CUTEX_DESKTOP_UPDATE_TEST_API: "http://127.0.0.1:4567", CUTEX_DESKTOP_UPDATE_TEST_PUBKEY: "RWTotchsxk+qB/3ZDKYG7sz5bYx5MIhX0cjGQjIIAY8/UvVF0wBC/no1" };
    const plain = binarySource(info(), "release", env, "linux", "x64");
    expect(plain).toMatchObject({ apiBase: "https://api.github.com", extraOrigins: [] });
    expect(!("reason" in plain) && plain.keys).toHaveLength(2);
    const hooked = binarySource(info({ updateTestHooks: true }), "release", env, "linux", "x64");
    expect(hooked).toMatchObject({ apiBase: "http://127.0.0.1:4567", downloadBase: "http://127.0.0.1:4567", extraOrigins: ["http://127.0.0.1:4567"] });
    expect(!("reason" in hooked) && hooked.keys.map((k) => k.id)).toEqual(["00A0BD016183F447", "D12869DA9D6F784E", "07AA4FC66CC8B5E8"]);
    expect(plain).toMatchObject({ testProxy: null });
    expect(binarySource(info({ updateTestHooks: true }), "release", { ...env, CUTEX_DESKTOP_UPDATE_TEST_PROXY: "http://127.0.0.1:3128" }, "linux", "x64")).toMatchObject({ testProxy: "http://127.0.0.1:3128" });
    expect(binarySource(info(), "release", { ...env, CUTEX_DESKTOP_UPDATE_TEST_PROXY: "http://127.0.0.1:3128" }, "linux", "x64")).toMatchObject({ testProxy: null });
    expect(binarySource(info({ updateTestHooks: true }), "release", { CUTEX_DESKTOP_UPDATE_TEST_PROXY: "http://proxy.example.org:3128" }, "linux", "x64")).toMatchObject({ testProxy: null });
    const remote = binarySource(info({ updateTestHooks: true }), "release", { CUTEX_DESKTOP_UPDATE_TEST_API: "http://evil.example:80" }, "linux", "x64");
    expect(remote).toMatchObject({ apiBase: "https://api.github.com", extraOrigins: [] });
  });
});

describe("renderer wording of a binary update", () => {
  it("offers by version and words noRelease quietly", async () => {
    vi.doMock("../src/renderer/src/bridge", () => ({ bridge: {} }));
    const { updateSummary, unsupportedHintKey } = await import("../src/renderer/src/lib/update");
    const t = (key: string, vars?: Record<string, string | number>) => `${key}:${JSON.stringify(vars ?? {})}`;
    expect(updateSummary(t, { commit: "", committedAt: "", subject: "Cutex 0.1.1", count: 0, version: "0.1.1" }, "release")).toBe('update.availableVersion:{"version":"0.1.1"}');
    expect(unsupportedHintKey("noRelease")).toBe("updater.unsupported.noRelease");
  });
});
