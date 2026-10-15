// End of install-portable.sh / .ps1: the same housekeeping the app does after an update
// (apps/desktop/src/shared/releases.ts, imported directly through Node 24's type stripping):
// move every release but current's target and the previous one to <base>/old-releases (nothing is
// deleted; the app deletes archived ones 30 days after the move), and on macOS refresh the launcher
// clone ~/Applications/Cutex.app.
//
//   node scripts/archive-releases.mjs --base <dir> [--previous <release dir or name>] [--no-launcher]
//
// Prints what it moved and how to remove old-releases by hand. Exit 0 even when something is skipped
// (a locked dir on Windows is retried by the app at its next start).
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { archiveOldReleases, nodeReleaseOps, OLD_RELEASE_MAX_AGE_DAYS, syncMacLauncher } from "../apps/desktop/src/shared/releases.ts";

const args = process.argv.slice(2);
const value = (flag) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] ?? null : null;
};
const base = value("--base");
if (!base) {
  console.error("usage: node scripts/archive-releases.mjs --base <dir> [--previous <release>] [--no-launcher]");
  process.exit(2);
}
const win = process.platform === "win32";
const mac = process.platform === "darwin";
const style = win ? { sep: "\\", win: true } : { sep: "/", win: false };
const ops = nodeReleaseOps(fs, style, (command, commandArgs) => void execFileSync(command, commandArgs, { stdio: "ignore", timeout: 60_000 }));

if (mac && !args.includes("--no-launcher")) {
  const dir = process.env.CUTEX_DESKTOP_SHORTCUT_ROOT || join(homedir(), "Applications");
  const r = syncMacLauncher(ops, { launcherDir: dir, baseDir: base, tag: String(process.pid) });
  if (r.action === "created" || r.action === "refreshed" || r.action === "current") console.log(`launcher ${r.launcher} (open this one; keep it in the Dock)`);
  else if (r.action === "foreign") console.log(`launcher: ${r.launcher} belongs to another install; left alone (open ${base}/current/Cutex.app instead)`);
  else console.log(`launcher not updated (${r.action}${r.error ? `: ${r.error}` : ""}); open ${base}/current/Cutex.app`);
}

const result = archiveOldReleases(base, ops, { ...style, mac, running: null, previous: value("--previous"), now: Date.now() });
if (result.reason) console.log(`old releases left in place: ${result.reason}`);
for (const s of result.skipped) console.log(`kept ${s.name} for now: ${s.error}`);
if (result.moved.length) {
  const dir = result.oldReleasesDir;
  console.log(`moved ${result.moved.length} old release(s) to ${dir} (nothing deleted)`);
  console.log(`they are deleted automatically ${OLD_RELEASE_MAX_AGE_DAYS} days after the move; to remove them now: Settings → Updates & diagnostics → Delete old versions, or`);
  console.log(win ? `  Remove-Item -LiteralPath "${dir}" -Recurse -Force` : `  rm -rf "${dir}"`);
}
