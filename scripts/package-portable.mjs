// Assemble a portable desktop release without a packager: the platform's Electron runtime from
// node_modules plus the built app (apps/desktop/out) as resources/app. The main and preload bundles
// only require electron and node builtins (plus the icon files in resources/icons).
//
//   node scripts/package-portable.mjs <dest-dir> [--no-source] [--channel <branch>] [--release-page <https-url>] [--version <semver>] [--update-test-hooks]
//   (run `pnpm --filter @cutex-desktop/app build` first)
//
// --no-source: a package for other machines — the builder's checkout and node paths are not recorded
// (sourceDir / nodeDir = null), so the in-app updater looks for <base>/src instead and otherwise says
// 「不支持自动更新」 quietly.
// --channel <branch>: the update branch recorded in the package (`release` for colleagues' packages);
// `<base>/channel` of an install overrides it, and without either the install follows main.
// --release-page <https-url>: where new packages are published (CI release packages: the GitHub
// Releases page), recorded as `releasePage`. Installed in the releases layout on the `release` channel
// (Linux / Windows) such a package updates itself from the latest GitHub release of that repository
// (src/main/binaryUpdate.ts); otherwise Settings → 更新与诊断 links to the page.
// --version <semver>: the package version recorded as `version` (CI: the release's version, e.g. 0.1.1;
// default apps/desktop/package.json's). The binary self-update compares it with the latest release tag.
// --update-test-hooks: local end-to-end tests of the binary self-update only (never CI / releases): the
// package records `updateTestHooks: true` and then honours CUTEX_DESKTOP_UPDATE_TEST_API (a loopback fake
// GitHub) and CUTEX_DESKTOP_UPDATE_TEST_PUBKEY (an extra trusted minisign key). NOTICE, THIRD_PARTY_NOTICES.md and LICENSES/ ship next to Electron's own
// LICENSE / LICENSES.chromium.html in every package, with docs/QUICKSTART.md and skills/cutex-docs/.
//
// The executable is renamed to cutex(.exe) (macOS: Cutex.app/Contents/MacOS/Cutex) so app.isPackaged
// is true (Electron checks the executable's name); userData stays "Cutex" (productName), the same as dev runs.
//
// macOS signing: ad hoc by default (`codesign -s -`): every package is a new identity for the keychain,
// so 「Cutex Safe Storage」 asks again after each update. With env CUTEX_DESKTOP_CODESIGN_IDENTITY=<name>
// (a code-signing identity in the login keychain, e.g. a self-signed certificate) the bundle is signed
// with it instead, and the keychain's "Always Allow" survives updates; the identity is recorded in the
// package so the in-app updater signs the next release with it too. On Windows cutex.exe also gets the app icon and "Cutex"
// version strings (resedit, pure JS — the `rcedit` npm package is deprecated) instead of
// Electron's, so Explorer and the taskbar show the dragon.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { thirdPartyNotices } from "./third-party-notices.mjs";

/** The packaged app's copyright line (Windows version info, macOS Info.plist); same as NOTICE. */
const COPYRIGHT = "Copyright 2026 The Cutex Authors";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "apps/desktop");
const args = process.argv.slice(2);
const noSource = args.includes("--no-source");
const channelAt = args.indexOf("--channel");
const channel = channelAt >= 0 ? args[channelAt + 1] : null;
if (channelAt >= 0 && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(channel ?? "")) throw new Error("--channel needs a branch name");
const pageAt = args.indexOf("--release-page");
const releasePage = pageAt >= 0 ? releasePageUrl(args[pageAt + 1]) : null;
const versionAt = args.indexOf("--version");
const versionArg = versionAt >= 0 ? args[versionAt + 1] : null;
// The same shape the updater accepts (shared/binaryUpdate.ts parseVersion): x.y.z[-pre][+build].
if (versionAt >= 0 && !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z.-]+)?$/.test(versionArg ?? "")) throw new Error("--version needs a version like 0.1.1");
const testHooks = args.includes("--update-test-hooks");
const valueAt = new Set([channelAt, pageAt, versionAt].filter((i) => i >= 0).map((i) => i + 1));
const destArg = args.find((a, i) => !a.startsWith("--") && !valueAt.has(i));
if (!destArg) throw new Error("usage: node scripts/package-portable.mjs <dest-dir> [--no-source] [--channel <branch>] [--release-page <https-url>] [--version <semver>] [--update-test-hooks]");
const dest = resolve(destArg);
const signIdentity = process.platform === "darwin" ? codesignIdentity(process.env.CUTEX_DESKTOP_CODESIGN_IDENTITY) : null;
if (existsSync(dest)) throw new Error(`${dest} already exists`);
if (!existsSync(join(app, "out/main/index.cjs"))) throw new Error("apps/desktop/out is missing — build first");

const require = createRequire(join(app, "package.json"));
const electronDir = dirname(require.resolve("electron/package.json"));
const dist = join(electronDir, "dist");
// pnpm can skip electron's postinstall (e.g. a side-effects-cache hit after a version change), so
// run its downloader here rather than failing the update at this step.
if (!existsSync(dist)) execFileSync(process.execPath, [join(electronDir, "install.js")], { cwd: electronDir, stdio: "inherit" });
if (!existsSync(dist)) throw new Error(`${dist} is missing (electron install.js did not produce it)`);

mkdirSync(dirname(dest), { recursive: true });
cpSync(dist, dest, { recursive: true, verbatimSymlinks: true });
// macOS: the runtime is the .app bundle; its Resources dir is Contents/Resources (the top-level
// resources/ of the Linux/Windows dist does not exist here — creating one would silently put the
// app payload outside the bundle and the launch would fall back to Electron's default app).
const bundle = process.platform === "darwin" ? join(dest, "Cutex.app") : null;
if (bundle) {
  stampAppBundle(bundle);
  rmSync(join(bundle, "Contents", "Resources", "default_app.asar"), { force: true });
} else {
  rmSync(join(dest, "resources/default_app.asar"), { force: true });
}
const exe = process.platform === "win32" ? "electron.exe" : "electron";
if (process.platform !== "darwin") renameSync(join(dest, exe), join(dest, process.platform === "win32" ? "cutex.exe" : "cutex"));

const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
if (process.platform === "win32") await stampExe(join(dest, "cutex.exe"), join(app, "resources/icons/icon.ico"), pkg);
const target = bundle ? join(bundle, "Contents", "Resources", "app") : join(dest, "resources/app");
mkdirSync(target, { recursive: true });
cpSync(join(app, "out"), join(target, "out"), { recursive: true });
// Main references resources/icons as ../../resources/icons from out/main (electron-vite leaves
// resources/ in place), so ship the icon set next to out/; the source logo stays behind.
cpSync(join(app, "resources/icons"), join(target, "resources/icons"), { recursive: true });
// Attribution: our NOTICE + license texts, and the notices of the npm packages bundled into out/.
cpSync(join(root, "NOTICE"), join(dest, "NOTICE"));
cpSync(join(root, "LICENSES"), join(dest, "LICENSES"), { recursive: true });
writeFileSync(join(dest, "THIRD_PARTY_NOTICES.md"), thirdPartyNotices(app));
// Docs that a package without a source checkout still needs (a few dozen KB): the identity menu's
// 帮助与文档 opens docs/QUICKSTART.md (src/shared/quickstart.ts), and AGENT-INSTALL §13 copies the
// skills/cutex-docs manual from <base>/current/skills/cutex-docs.
mkdirSync(join(dest, "docs"), { recursive: true });
cpSync(join(root, "docs/QUICKSTART.md"), join(dest, "docs/QUICKSTART.md"));
cpSync(join(root, "skills/cutex-docs"), join(dest, "skills/cutex-docs"), { recursive: true });
// Self-update (src/main/updater.ts) pulls and rebuilds in the checkout recorded here, with this node.
// releaseDir: where this package lives, so a macOS launcher clone of the bundle finds its install
// (apps/desktop/src/shared/releases.ts syncMacLauncher).
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
let commit = null;
let committedAt = null;
let dirty = false;
try {
  commit = git("rev-parse", "HEAD");
  committedAt = git("log", "-1", "--format=%cI");
  dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
} catch {}
writeFileSync(
  join(target, "package.json"),
  JSON.stringify(
    { name: pkg.name, productName: pkg.productName, version: versionArg ?? pkg.version, private: true, main: pkg.main, commit, committedAt, dirty, sourceDir: noSource ? null : root, nodeDir: noSource ? null : dirname(process.execPath), releaseDir: noSource ? null : dest, ...(channel ? { channel } : {}), ...(releasePage ? { releasePage } : {}), ...(testHooks ? { updateTestHooks: true } : {}), ...(signIdentity && !noSource ? { codesignIdentity: signIdentity } : {}) },
    null,
    2,
  ) + "\n",
);
// macOS: seal the finished bundle (stampAppBundle). Signing before the payload was copied in left
// "a sealed resource is missing or invalid" (codesign --verify) on every package.
if (bundle) {
  execFileSync("codesign", ["--force", "--deep", "--sign", signIdentity ?? "-", bundle], { stdio: "pipe" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], { stdio: "pipe" });
}
console.log(`portable ${pkg.productName} ${versionArg ?? pkg.version} (${commit?.slice(0, 7)}${dirty ? ", dirty" : ""}${bundle ? `, signed ${signIdentity ?? "ad hoc"}` : ""}) → ${dest}`);

/** --release-page: an https URL the app opens in the system browser (shared/update.ts parseReleasePage accepts the same). */
function releasePageUrl(value) {
  const v = (value ?? "").trim();
  let url = null;
  try {
    url = new URL(v);
  } catch {
    // reported below
  }
  if (!url || v.length > 2048 || /[\s\x00-\x1f\x7f]/.test(v) || url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error("--release-page needs an https URL without credentials (at most 2048 characters)");
  }
  return url.href;
}

/** CUTEX_DESKTOP_CODESIGN_IDENTITY: a codesign identity (name or SHA-1); unset / "-" = ad hoc. */
function codesignIdentity(value) {
  const v = (value ?? "").trim();
  if (!v || v === "-") return null;
  if (v.startsWith("-") || v.length > 200 || /[\x00-\x1f\x7f]/.test(v)) throw new Error("CUTEX_DESKTOP_CODESIGN_IDENTITY is not a usable identity name");
  return v;
}

/**
 * macOS: the Electron runtime is `Electron.app`; turn it into a double-clickable `Cutex.app`
 * (name, bundle id dev.cutex.desktop, icon from resources/icons) without an external packager.
 * Editing the bundle invalidates Electron's signature seal, and Apple Silicon refuses to launch
 * binaries without a valid signature, so the bundle is re-signed ad hoc (`codesign -`) once its
 * contents are final (after the app payload is in, at the end of the script); this is not a
 * developer-ID signature and nothing is notarized.
 */
function stampAppBundle(bundle) {
  renameSync(join(dest, "Electron.app"), bundle);
  const plist = join(bundle, "Contents", "Info.plist");
  const pb = (op, ...args) => execFileSync("/usr/libexec/PlistBuddy", ["-c", [op, ...args].join(" "), plist], { stdio: "pipe" });
  pb("Set", ":CFBundleName", "Cutex");
  try { pb("Set", ":CFBundleDisplayName", "Cutex"); } catch { pb("Add", ":CFBundleDisplayName", "string", "Cutex"); }
  pb("Set", ":CFBundleIdentifier", "dev.cutex.desktop");
  try { pb("Set", ":NSHumanReadableCopyright", COPYRIGHT); } catch { pb("Add", ":NSHumanReadableCopyright", "string", COPYRIGHT); }
  // app.isPackaged is false while the executable is called "Electron" (the updater would then call the
  // install a dev run). The helper apps keep their names: Electron finds "Electron Helper.app" first.
  renameSync(join(bundle, "Contents", "MacOS", "Electron"), join(bundle, "Contents", "MacOS", "Cutex"));
  pb("Set", ":CFBundleExecutable", "Cutex");
  const iconFile = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIconFile", plist], { encoding: "utf8" }).trim() || "electron.icns";
  const icns = buildIcns();
  cpSync(icns, join(bundle, "Contents", "Resources", iconFile.endsWith(".icns") ? iconFile : iconFile + ".icns"));
  rmSync(icns);
}

/** Build a `.icns` from the pngs in resources/icons (sips + iconutil, both ship with macOS). */
function buildIcns() {
  // iconutil requires the directory to carry the `.iconset` extension.
  const iconset = join(dest, "icon.iconset");
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset);
  const entries = [
    ["icon_16x16.png", "icon-16.png"], ["icon_16x16@2x.png", "icon-32.png"],
    ["icon_32x32.png", "icon-32.png"], ["icon_32x32@2x.png", "icon-64.png"],
    ["icon_128x128.png", "icon-128.png"], ["icon_128x128@2x.png", "icon-256.png"],
    ["icon_256x256.png", "icon-256.png"], ["icon_256x256@2x.png", "icon-512.png"],
    ["icon_512x512.png", "icon-512.png"],
  ];
  for (const [name, source] of entries) cpSync(join(app, "resources/icons", source), join(iconset, name));
  const icns = join(dest, "cutex.icns");
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", icns], { stdio: "pipe" });
  rmSync(iconset, { recursive: true, force: true });
  return icns;
}

/** Replace Electron's icon and version strings in the Windows executable. */
async function stampExe(exePath, icoPath, pkg) {
  const { NtExecutable, NtExecutableResource, Data, Resource } = await import("resedit");
  // electron.exe is Authenticode-signed; editing resources invalidates that, so drop the certificate.
  const exe = NtExecutable.from(readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);
  const ico = Data.IconFile.from(readFileSync(icoPath));
  // Reuse Electron's main icon group id / language (the first group is the one Explorer shows).
  const group = Resource.IconGroupEntry.fromEntries(res.entries)[0] ?? { id: 1, lang: 1033 };
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, ico.icons.map((i) => i.data));
  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] ?? Resource.VersionInfo.createEmpty();
  const name = pkg.productName ?? "Cutex";
  // LegalCopyright replaces Electron's own ("GitHub, Inc."), which would otherwise show in Explorer → Properties.
  const strings = { FileDescription: name, ProductName: name, CompanyName: name, LegalCopyright: COPYRIGHT, InternalName: "cutex", OriginalFilename: "cutex.exe", FileVersion: pkg.version, ProductVersion: pkg.version };
  const langs = vi.getAllLanguagesForStringValues();
  for (const lang of langs.length ? langs : [{ lang: 1033, codepage: 1200 }]) vi.setStringValues(lang, strings);
  const numeric = String(pkg.version).match(/^\d+(\.\d+){0,3}/)?.[0] ?? "0.0.0";
  vi.setFileVersion(numeric);
  vi.setProductVersion(numeric);
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
}
