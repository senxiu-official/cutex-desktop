import { describe, expect, it } from "vitest";
import { backoffMinutes, buildSteps, builtChannel, channelFileContent, checkoutPlan, cmdQuote, corepackEntryIn, displayRemote, isOwnClone, spawnPlan, fetchArgs, fetchFailure, isKnownChannel, KNOWN_CHANNELS, parseCodesignIdentity, parseUpdateRemotes, resolveUpdateRemote, parseChannel, resolveChannel, installLayout, isPathRemote, parseReleaseInfo, parseReleasePage, parseUpdateRemote, pathRemotePath, releaseName, resolveInstallLayout, resolveSourceDir, sourceDirtyCheck, tail, updateButtonVisible, updateOffer, updateRef, updateRemoteOverride } from "../src/shared/update";

const FULL = "7422695".padEnd(40, "a");

describe("parseReleaseInfo", () => {
  it("reads what package-portable records", () => {
    expect(parseReleaseInfo({ commit: FULL, committedAt: "2026-10-07T13:05:00+11:00", sourceDir: "D:\\src", nodeDir: "C:\\node" })).toEqual({
      commit: FULL,
      committedAt: "2026-10-07T13:05:00+11:00",
      sourceDir: "D:\\src",
      nodeDir: "C:\\node",
      channel: null,
      codesignIdentity: null,
      releaseDir: null,
      releasePage: null,
    });
  });

  it("accepts a --no-source package (explicit nulls)", () => {
    expect(parseReleaseInfo({ commit: FULL, committedAt: null, sourceDir: null, nodeDir: null })).toEqual({ commit: FULL, committedAt: null, sourceDir: null, nodeDir: null, channel: null, codesignIdentity: null, releaseDir: null, releasePage: null });
  });

  it("refuses releases packaged before self-update", () => {
    expect(parseReleaseInfo({ commit: "c20812e" })).toHaveProperty("reason");
    expect(parseReleaseInfo({ commit: FULL })).toHaveProperty("reason");
    expect(parseReleaseInfo(null)).toHaveProperty("reason");
  });
});

describe("parseReleaseInfo releasePage", () => {
  const base = { commit: FULL, sourceDir: null, nodeDir: null };
  it("keeps an https release page", () => {
    const page = "https://github.com/senxiu-official/cutex-desktop/releases";
    expect(parseReleaseInfo({ ...base, releasePage: page })).toMatchObject({ releasePage: page });
  });

  it("drops anything that is not a plain https URL", () => {
    for (const bad of ["http://github.com/x/releases", "javascript:alert(1)", "file:///etc/passwd", "https://user:pw@github.com/x", "https://token@github.com/x", "not a url", "https://a b", "", 42, null, `https://example.com/${"a".repeat(2100)}`]) {
      expect(parseReleasePage(bad)).toBeNull();
      expect(parseReleaseInfo({ ...base, releasePage: bad })).toMatchObject({ releasePage: null });
    }
  });

  it("is null when the package recorded none", () => {
    expect(parseReleaseInfo(base)).toMatchObject({ releasePage: null });
  });
});

describe("installLayout", () => {
  it("finds <base>/releases/<release> on both platforms", () => {
    expect(installLayout("D:\\Apps\\cutex-desktop-app\\releases\\7422695\\cutex.exe", "\\")).toEqual({
      baseDir: "D:\\Apps\\cutex-desktop-app",
      releaseDir: "D:\\Apps\\cutex-desktop-app\\releases\\7422695",
      releasesDir: "D:\\Apps\\cutex-desktop-app\\releases",
      currentLink: "D:\\Apps\\cutex-desktop-app\\current",
      launcher: ["cutex.exe"],
    });
    expect(installLayout("/home/u/Applications/cutex-desktop/releases/7422695/cutex", "/")).toEqual({
      baseDir: "/home/u/Applications/cutex-desktop",
      releaseDir: "/home/u/Applications/cutex-desktop/releases/7422695",
      releasesDir: "/home/u/Applications/cutex-desktop/releases",
      currentLink: "/home/u/Applications/cutex-desktop/current",
      launcher: ["cutex"],
    });
  });

  it("macOS: the release dir holds the .app bundle; relaunch goes through current/Cutex.app", () => {
    expect(installLayout("/Users/u/Applications/cutex-desktop/releases/7422695/Cutex.app/Contents/MacOS/Cutex", "/")).toEqual({
      baseDir: "/Users/u/Applications/cutex-desktop",
      releaseDir: "/Users/u/Applications/cutex-desktop/releases/7422695",
      releasesDir: "/Users/u/Applications/cutex-desktop/releases",
      currentLink: "/Users/u/Applications/cutex-desktop/current",
      launcher: ["Cutex.app", "Contents", "MacOS", "Cutex"],
    });
    // A bundle that is not in a release dir (the old ~/Applications-cutex/Cutex.app) is not portable.
    expect(installLayout("/Users/u/Applications-cutex/Cutex.app/Contents/MacOS/Cutex", "/")).toHaveProperty("reason");
    expect(installLayout("/Applications/Cutex.app/Contents/MacOS/Cutex", "/")).toHaveProperty("reason");
  });

  it("rejects other locations (dev runs, ad-hoc copies)", () => {
    expect(installLayout("D:\\Temp\\portable-test\\cutex.exe", "\\")).toHaveProperty("reason");
  });
});

describe("releaseName / buildSteps / tail", () => {
  it("suffixes a taken name", () => {
    expect(releaseName(FULL, () => false)).toBe("7422695");
    const taken = new Set(["7422695", "7422695-2"]);
    expect(releaseName(FULL, (n) => taken.has(n))).toBe("7422695-3");
  });

  it("puts the macOS .noindex suffix after the counter", () => {
    expect(releaseName(FULL, () => false, ".noindex")).toBe("7422695.noindex");
    const taken = new Set(["7422695.noindex"]);
    expect(releaseName(FULL, (n) => taken.has(n), ".noindex")).toBe("7422695-2.noindex");
  });

  it("builds into the destination with pnpm via corepack", () => {
    const steps = buildSteps("/x/releases/abc");
    expect(steps.install.args).toEqual(["pnpm", "install", "--frozen-lockfile"]);
    expect(steps.build.cwd).toBe("apps/desktop");
    expect(steps.package.args).toEqual(["scripts/package-portable.mjs", "/x/releases/abc"]);
    expect(buildSteps("/x/releases/abc", "release").package.args).toEqual(["scripts/package-portable.mjs", "/x/releases/abc", "--channel", "release"]);
  });

  it("keeps the last lines without colour codes", () => {
    expect(tail("a\n\n\x1b[31mb\x1b[0m\nc", 2)).toBe("b\nc");
  });
});

describe("updateButtonVisible", () => {
  const base = { current: { commit: FULL, committedAt: null }, latest: null };
  it("shows only when there is something to do", () => {
    expect(updateButtonVisible(null)).toBe(false);
    expect(updateButtonVisible({ ...base, state: "idle" })).toBe(false);
    expect(updateButtonVisible({ ...base, state: "unsupported" })).toBe(false);
    expect(updateButtonVisible({ ...base, state: "checking" })).toBe(false);
    const latest = { commit: FULL, committedAt: "", subject: "x", count: 1 };
    expect(updateButtonVisible({ ...base, state: "available", latest })).toBe(true);
    expect(updateButtonVisible({ ...base, state: "updating", step: "build" })).toBe(true);
    expect(updateButtonVisible({ ...base, state: "error", latest })).toBe(true);
  });
});

describe("updateOffer", () => {
  it("offers main when the build is behind it", () => expect(updateOffer(true, false)).toBe("ahead"));
  it("never updates a build that is newer than main", () => expect(updateOffer(false, true)).toBeNull());
  it("offers main to a build that is not on main (packaged by hand from another branch)", () => expect(updateOffer(false, false)).toBe("offMain"));
  it("after a channel switch an older head is offered as the switch (behind the button)", () => {
    expect(updateOffer(false, true, true)).toBe("switch");
    expect(updateOffer(true, false, true)).toBe("ahead");
    expect(updateOffer(false, false, true)).toBe("offMain");
  });
});

describe("update source (packages copied to other machines)", () => {
  const layout = installLayout("/opt/cutex/releases/abc1234/cutex", "/") as Exclude<ReturnType<typeof installLayout>, { reason: string }>;

  it("uses the recorded checkout when it exists here, else <base>/src, else none", () => {
    expect(resolveSourceDir("/build/src", layout, "/", (d) => d === "/build/src")).toBe("/build/src");
    expect(resolveSourceDir("/mnt/elsewhere/src", layout, "/", (d) => d === "/opt/cutex/src")).toBe("/opt/cutex/src");
    expect(resolveSourceDir(null, layout, "/", (d) => d === "/opt/cutex/src")).toBe("/opt/cutex/src");
    expect(resolveSourceDir("/mnt/elsewhere/src", layout, "/", () => false)).toBeNull();
  });

  it("reads the remote override: env first, unusable values ignored", () => {
    expect(updateRemoteOverride("https://example.com/a.git", "https://example.com/b.git")).toBe("https://example.com/a.git");
    expect(updateRemoteOverride(undefined, " https://example.com/b.git ")).toBe("https://example.com/b.git");
    expect(updateRemoteOverride("", undefined)).toBeNull();
    expect(parseUpdateRemote("--upload-pack=evil")).toBeNull();
    expect(parseUpdateRemote("https://x/y z")).toBeNull();
    expect(parseUpdateRemote("a\nb")).toBeNull();
    expect(parseUpdateRemote(42)).toBeNull();
    expect(parseUpdateRemote("x".repeat(2049))).toBeNull();
  });

  it("fetches the channel branch from origin, or from the override into its own ref", () => {
    expect(fetchArgs(null)).toEqual(["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
    expect(updateRef(null)).toBe("refs/remotes/origin/main");
    expect(fetchArgs(null, "release")).toEqual(["fetch", "--quiet", "origin", "+refs/heads/release:refs/remotes/origin/release"]);
    expect(fetchArgs("https://example.com/r.git", "release")).toEqual(["fetch", "--quiet", "--", "https://example.com/r.git", "+refs/heads/release:refs/remotes/cutex-update/release"]);
    expect(updateRef("https://example.com/r.git", "release")).toBe("refs/remotes/cutex-update/release");
  });

  it("resolves the channel: <base>/channel, else the packaged one, else main", () => {
    expect(resolveChannel(null, null)).toBe("main");
    expect(resolveChannel(null, "release")).toBe("release");
    expect(resolveChannel("release\n", null)).toBe("release");
    expect(resolveChannel("main", "release")).toBe("main");
    expect(resolveChannel("--evil", "release")).toBe("release");
    for (const bad of ["", "-x", "a..b", "a b", "x.lock", "a//b", "a/", 7]) expect(parseChannel(bad)).toBeNull();
    expect(parseChannel("release/2026-10")).toBe("release/2026-10");
    expect(parseReleaseInfo({ commit: FULL, sourceDir: null, nodeDir: null, channel: "release" })).toMatchObject({ channel: "release" });
  });

  it("tells path remotes from network remotes", () => {
    expect(isPathRemote("/mnt/share/cutex-desktop")).toBe(true);
    expect(isPathRemote("D:\\src\\cutex-desktop")).toBe(true);
    expect(isPathRemote("D:/src/cutex-desktop")).toBe(true);
    expect(isPathRemote("file:///srv/cutex-desktop.git")).toBe(true);
    expect(pathRemotePath("file:///srv/cutex%20desktop.git")).toBe("/srv/cutex desktop.git");
    expect(isPathRemote("https://github.com/o/r.git")).toBe(false);
    expect(isPathRemote("ssh://git@host/o/r.git")).toBe(false);
    expect(isPathRemote("git@github.com:o/r.git")).toBe(false);
    expect(isPathRemote("buildhost:/srv/r.git")).toBe(false);
  });

  it("backs off unreachable checks up to a day", () => {
    expect(backoffMinutes(10, 0)).toBe(10);
    expect(backoffMinutes(10, 1)).toBe(20);
    expect(backoffMinutes(10, 3)).toBe(80);
    expect(backoffMinutes(10, 40)).toBe(24 * 60);
  });

  it("never shows the sidebar button for an install that cannot update", () => {
    expect(updateButtonVisible({ state: "unsupported", code: "noSource", current: null, latest: null })).toBe(false);
    expect(updateButtonVisible({ state: "unsupported", code: "remoteUnreachable", retryable: true, current: null, latest: null })).toBe(false);
  });
});

describe("channels", () => {
  it("the two Settings channels; the per-install file content", () => {
    expect(KNOWN_CHANNELS).toEqual(["main", "release"]);
    expect(isKnownChannel("release")).toBe(true);
    expect(isKnownChannel("feature/x")).toBe(false);
    expect(channelFileContent("release")).toBe("release\n");
    expect(resolveChannel(channelFileContent("release"), null)).toBe("release");
  });

  it("the channel a release was built for: its packaged channel, else main", () => {
    expect(builtChannel({ channel: null })).toBe("main");
    expect(builtChannel({ channel: "release" })).toBe("release");
  });

  it("per-channel remotes: env > updateRemotes[channel] > updateRemote > origin", () => {
    const prefs = { updateRemote: "https://example.com/all.git", updateRemotes: { main: "ssh://buildbox/repo.git", release: " -x ", other: "x" } };
    expect(parseUpdateRemotes(prefs.updateRemotes)).toEqual({ main: "ssh://buildbox/repo.git" });
    expect(parseUpdateRemotes({ main: "" })).toBeNull();
    expect(parseUpdateRemotes(["a"])).toBeNull();
    expect(resolveUpdateRemote(undefined, prefs, "main")).toBe("ssh://buildbox/repo.git");
    expect(resolveUpdateRemote(undefined, prefs, "release")).toBe("https://example.com/all.git");
    expect(resolveUpdateRemote("/srv/env.git", prefs, "main")).toBe("/srv/env.git");
    expect(resolveUpdateRemote(undefined, { updateRemotes: { release: "https://github.com/o/r.git" } }, "release")).toBe("https://github.com/o/r.git");
    expect(resolveUpdateRemote(undefined, { updateRemotes: { release: "https://github.com/o/r.git" } }, "main")).toBeNull();
    expect(resolveUpdateRemote(undefined, {}, "feature/x")).toBeNull();
  });

  it("shows the update source without credentials", () => {
    expect(displayRemote("https://user:secret@github.com/o/r.git")).toBe("https://github.com/o/r.git");
    expect(displayRemote("https://ghp_token@github.com/o/r.git?x=1#y")).toBe("https://github.com/o/r.git");
    expect(displayRemote("ssh://alex:pw@buildbox/srv/repo.git")).toBe("ssh://alex@buildbox/srv/repo.git");
    expect(displayRemote("ssh://buildbox/srv/git/cutex-desktop.git")).toBe("ssh://buildbox/srv/git/cutex-desktop.git");
    expect(displayRemote("git@github.com:o/r.git")).toBe("git@github.com:o/r.git");
    expect(displayRemote("/srv/git/cutex-desktop.git")).toBe("/srv/git/cutex-desktop.git");
  });

  it("a fetch of a branch the remote does not have is channelMissing, not unreachable", () => {
    expect(fetchFailure("git fetch --quiet origin exited 128\nfatal: couldn't find remote ref refs/heads/release")).toBe("channelMissing");
    expect(fetchFailure("fatal: unable to access 'https://example.invalid/x.git/': Could not resolve host")).toBe("unreachable");
    expect(fetchFailure("spawn git ENOENT", "ENOENT")).toBe("noGit");
  });

  it("checkoutPlan: fast-forward, create, switch + fast-forward, or refuse (never drops commits)", () => {
    const ref = "refs/remotes/origin/release";
    expect(checkoutPlan("release", ref, { headBranch: "release", branchExists: true, branchBehindRef: true })).toEqual([["merge", "--ff-only", "--quiet", ref]]);
    expect(checkoutPlan("release", ref, { headBranch: "main", branchExists: false, branchBehindRef: false })).toEqual([["checkout", "--quiet", "-b", "release", ref]]);
    expect(checkoutPlan("release", ref, { headBranch: null, branchExists: true, branchBehindRef: true })).toEqual([["checkout", "--quiet", "release"], ["merge", "--ff-only", "--quiet", ref]]);
    expect(checkoutPlan("release", ref, { headBranch: "main", branchExists: true, branchBehindRef: false })).toHaveProperty("reason");
  });

  it("macOS codesign identity recorded at packaging (ad hoc = none)", () => {
    const base = { commit: "a".repeat(40), committedAt: null, sourceDir: "/src", nodeDir: "/node" };
    expect(parseReleaseInfo({ ...base, codesignIdentity: "Cutex Local Signing" })).toMatchObject({ codesignIdentity: "Cutex Local Signing" });
    expect(parseReleaseInfo({ ...base, codesignIdentity: "-" })).toMatchObject({ codesignIdentity: null });
    expect(parseReleaseInfo(base)).toMatchObject({ codesignIdentity: null });
    expect(parseCodesignIdentity("--deep")).toBeNull();
  });
});

describe("sourceDirtyCheck", () => {
  it("is clean for empty porcelain", () => {
    expect(sourceDirtyCheck("")).toEqual({ state: "clean" });
    expect(sourceDirtyCheck("\n")).toEqual({ state: "clean" });
  });

  it("restores a lockfile only the install rewrote", () => {
    expect(sourceDirtyCheck(" M pnpm-lock.yaml\n")).toEqual({ state: "restore", files: ["pnpm-lock.yaml"] });
    expect(sourceDirtyCheck(" M pnpm-lock.yaml\r\n")).toEqual({ state: "restore", files: ["pnpm-lock.yaml"] });
  });

  it("refuses anything else, the lockfile included when other files are dirty", () => {
    expect(sourceDirtyCheck(" M pnpm-lock.yaml\n M package.json\n")).toEqual({ state: "dirty", files: ["pnpm-lock.yaml", "package.json"] });
    expect(sourceDirtyCheck("M  pnpm-lock.yaml\n")).toEqual({ state: "dirty", files: ["pnpm-lock.yaml"] }); // staged
    expect(sourceDirtyCheck(" D pnpm-lock.yaml\n")).toEqual({ state: "dirty", files: ["pnpm-lock.yaml"] });
    expect(sourceDirtyCheck(" M apps/desktop/pnpm-lock.yaml\n")).toEqual({ state: "dirty", files: ["apps/desktop/pnpm-lock.yaml"] });
  });
});

describe("spawnPlan (no shell, paths with spaces)", () => {
  const dest = "C:\\Users\\John Smith\\AppData\\Local\\Programs\\cutex-desktop-app\\releases\\abc1234";

  it("runs node and git without a shell everywhere", () => {
    const pkg = buildSteps(dest).package;
    expect(spawnPlan(pkg.command, pkg.args, true, null)).toEqual({ command: "node", args: ["scripts/package-portable.mjs", dest], shell: false });
    expect(spawnPlan("git", ["-C", "C:\\a b&c", "status"], true, null)).toEqual({ command: "git", args: ["-C", "C:\\a b&c", "status"], shell: false });
    expect(spawnPlan("corepack", ["pnpm", "build"], false, null)).toEqual({ command: "corepack", args: ["pnpm", "build"], shell: false });
  });

  it("runs corepack's JS entry through node on Windows", () => {
    const entry = "C:\\Program Files\\nodejs\\node_modules\\corepack\\dist\\corepack.js";
    expect(spawnPlan("corepack", ["pnpm", "install", "--frozen-lockfile"], true, entry)).toEqual({ command: "node", args: [entry, "pnpm", "install", "--frozen-lockfile"], shell: false });
    expect(corepackEntryIn("C:\\Program Files\\nodejs\\", "\\")).toBe(entry);
  });

  it("falls back to cmd.exe only with quoted, safe arguments", () => {
    expect(spawnPlan("corepack", ["pnpm", "build"], true, null)).toEqual({ command: "corepack", args: ["pnpm", "build"], shell: true });
    expect(spawnPlan("corepack", ["pnpm", "a b"], true, null)).toEqual({ command: "corepack", args: ["pnpm", '"a b"'], shell: true });
    for (const bad of ["a&b", "50%", "x^y", 'q"', "a|b", "a>b"]) expect(spawnPlan("corepack", ["pnpm", bad], true, null)).toHaveProperty("reason");
  });

  it("quotes for cmd.exe", () => {
    expect(cmdQuote("plain")).toBe("plain");
    expect(cmdQuote("")).toBe('""');
    expect(cmdQuote("John Smith")).toBe('"John Smith"');
    expect(cmdQuote("a&b")).toBeNull();
  });
});

describe("sourceDirtyCheck outside the install's own clone", () => {
  it("never restores a developer tree's lockfile", () => {
    expect(sourceDirtyCheck(" M pnpm-lock.yaml\n", false)).toEqual({ state: "dirty", files: ["pnpm-lock.yaml"] });
    expect(sourceDirtyCheck("", false)).toEqual({ state: "clean" });
    expect(sourceDirtyCheck(" M pnpm-lock.yaml\n", true)).toEqual({ state: "restore", files: ["pnpm-lock.yaml"] });
  });

  it("recognises <base>/src", () => {
    expect(isOwnClone("/home/u/Applications/cutex-desktop/src", { baseDir: "/home/u/Applications/cutex-desktop" }, false)).toBe(true);
    expect(isOwnClone("/home/u/Applications/cutex-desktop/src/", { baseDir: "/home/u/Applications/cutex-desktop" }, false)).toBe(true);
    expect(isOwnClone("/home/u/dev/cutex-desktop", { baseDir: "/home/u/Applications/cutex-desktop" }, false)).toBe(false);
    expect(isOwnClone("c:\\apps\\cutex-desktop-app\\SRC", { baseDir: "C:\\Apps\\cutex-desktop-app" }, true)).toBe(true);
    expect(isOwnClone("/x/Src", { baseDir: "/x" }, false)).toBe(false);
  });
});

describe("parseReleaseInfo releaseDir", () => {
  it("reads the recorded release dir", () => {
    expect(parseReleaseInfo({ commit: FULL, sourceDir: null, nodeDir: null, releaseDir: "/u/a/cutex-desktop/releases/7422695.noindex" })).toMatchObject({ releaseDir: "/u/a/cutex-desktop/releases/7422695.noindex" });
  });
});

describe("resolveInstallLayout", () => {
  const release = "/u/a/cutex-desktop/releases/7422695.noindex";
  it("is installLayout for a process in a release dir", () => {
    const exec = `${release}/Cutex.app/Contents/MacOS/Cutex`;
    expect(resolveInstallLayout(exec, "/", release)).toEqual(installLayout(exec, "/"));
  });

  it("maps the macOS launcher clone onto its recorded release", () => {
    const layout = resolveInstallLayout("/u/a/Applications/Cutex.app/Contents/MacOS/Cutex", "/", release);
    expect(layout).toEqual({
      baseDir: "/u/a/cutex-desktop",
      releaseDir: release,
      releasesDir: "/u/a/cutex-desktop/releases",
      currentLink: "/u/a/cutex-desktop/current",
      launcher: ["Cutex.app", "Contents", "MacOS", "Cutex"],
      launcherBundle: "/u/a/Applications/Cutex.app",
    });
  });

  it("stays not portable without a recorded release or outside a bundle", () => {
    expect(resolveInstallLayout("/u/a/Applications/Cutex.app/Contents/MacOS/Cutex", "/", null)).toHaveProperty("reason");
    expect(resolveInstallLayout("/opt/cutex/cutex", "/", release)).toHaveProperty("reason");
    expect(resolveInstallLayout("/u/a/Applications/Cutex.app/Contents/MacOS/Cutex", "/", "/u/a/elsewhere/7422695")).toHaveProperty("reason");
  });
});
