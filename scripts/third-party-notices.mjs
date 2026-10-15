// THIRD_PARTY_NOTICES.md for a desktop package: every npm package in the production dependency
// closure of apps/desktop (workspace packages are walked through, not listed — they are ours), with
// its license field and the text of its LICENSE / NOTICE files. The renderer bundle inlines these
// packages, so their notices must ship with the app (scripts/package-portable.mjs writes the file
// next to Electron's LICENSE and LICENSES.chromium.html, which cover Electron / Chromium).
//
//   node scripts/third-party-notices.mjs [out-file]     (default: print to stdout)
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

/** Directory of package `name` as Node would resolve it from `fromDir` (symlinks resolved). */
function findPackage(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

/** Production packages reachable from `appDir`, sorted by name@version. */
export function collectPackages(appDir) {
  const seen = new Map();
  const visit = (dir, isRoot) => {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return;
    const ours = isRoot || (typeof pkg.name === "string" && pkg.name.startsWith("@cutex-desktop/"));
    seen.set(key, ours ? null : { name: pkg.name, version: pkg.version, license: licenseOf(pkg), repository: repoOf(pkg), dir });
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
    for (const name of Object.keys(deps)) {
      const found = findPackage(name, dir);
      if (found) visit(found, false);
    }
  };
  visit(realpathSync(appDir), true);
  return [...seen.values()].filter(Boolean).sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

function licenseOf(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l?.type ?? l).join(" OR ");
  return "UNKNOWN";
}

function repoOf(pkg) {
  const r = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  return typeof r === "string" ? r.replace(/^git\+/, "") : null;
}

function licenseTexts(dir) {
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim() }));
}

/** The THIRD_PARTY_NOTICES.md text for `appDir` (apps/desktop). */
export function thirdPartyNotices(appDir) {
  const pkgs = collectPackages(appDir);
  const out = [
    "# Third-party notices",
    "",
    "The Cutex desktop app bundles the following npm packages (production dependencies of",
    "`apps/desktop`). Electron and Chromium are covered by `LICENSE` and `LICENSES.chromium.html`",
    "next to the executable; code and assets adapted from other projects (for example the Fluent Emoji",
    "avatar pictures) are listed in `NOTICE`, with their license texts in `LICENSES/`.",
    "",
    "| Package | Version | License |",
    "|---|---|---|",
    ...pkgs.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`),
    "",
  ];
  for (const p of pkgs) {
    out.push(`## ${p.name}@${p.version}`, "", `License: ${p.license}${p.repository ? ` — ${p.repository}` : ""}`, "");
    const texts = licenseTexts(p.dir);
    if (!texts.length) out.push("(no license file in the package; see the license field above)", "");
    for (const t of texts) out.push(`### ${t.file}`, "", "```text", t.text, "```", "");
  }
  return out.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const text = thirdPartyNotices(join(root, "apps/desktop"));
  if (process.argv[2]) writeFileSync(process.argv[2], text);
  else process.stdout.write(text);
}
