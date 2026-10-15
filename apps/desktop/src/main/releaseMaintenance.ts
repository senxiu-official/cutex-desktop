// Old-release housekeeping of a portable install (the decisions and guards: src/shared/releases.ts):
// move all releases but current's target + the previous one to <base>/old-releases, delete archived
// ones 30 days after the move (or all of them from Settings → 更新与诊断), measure what is left, and on
// macOS keep the launcher clone ~/Applications/Cutex.app on current's bundle.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { InstallLayout } from "../shared/update";
import {
  archiveOldReleases,
  DELETING_SUFFIX,
  isDirectChild,
  MOVED_AT_FILE,
  nodeReleaseOps,
  OLD_RELEASES_DIR,
  oldReleasesToDelete,
  parseMovedAt,
  staleLauncherTemps,
  syncMacLauncher,
  type ArchiveResult,
  type LauncherAction,
  type LauncherOps,
  type PathStyle,
} from "../shared/releases";

const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";
const STYLE: PathStyle = WIN ? { sep: "\\", win: true } : { sep: "/", win: false };

export interface OldReleasesSummary {
  count: number;
  bytes: number;
}

export class ReleaseMaintenance {
  private readonly ops: LauncherOps;

  constructor(
    private readonly layout: InstallLayout,
    private readonly log: (text: string) => void,
  ) {
    this.ops = nodeReleaseOps(fs, STYLE, (command, args) => void execFileSync(command, args, { stdio: "ignore", timeout: 60_000 }));
  }

  get oldReleasesDir(): string {
    return join(this.layout.baseDir, OLD_RELEASES_DIR);
  }

  /** Move releases other than current's target, the running one and `previous` to old-releases/. */
  archive(previous: string | null): ArchiveResult {
    const result = archiveOldReleases(this.layout.baseDir, this.ops, { ...STYLE, mac: MAC, running: this.layout.releaseDir, previous, now: Date.now() });
    if (result.reason) this.log(`old releases: not archived (${result.reason})`);
    for (const m of result.moved) this.log(`old releases: moved ${m.name} to ${m.to}`);
    for (const s of result.skipped) this.log(`old releases: kept ${s.name} for now (${s.error})`);
    return result;
  }

  /**
   * Delete archived releases: those moved more than 30 days ago (`all`: every one). Each is renamed to
   * `<name>.deleting` first (on Windows a locked dir fails here, whole) and then removed; a failure
   * leaves it for the next run.
   */
  async deleteOld(all: boolean): Promise<{ deleted: string[]; failed: string[] }> {
    const out = { deleted: [] as string[], failed: [] as string[] };
    const oldDir = this.oldReleasesDir;
    const realBase = this.ops.realpath(this.layout.baseDir);
    const realOld = this.ops.realpath(oldDir);
    if (!realBase || !realOld) return out;
    if (!isDirectChild(realBase, realOld, STYLE.win)) {
      this.log(`old releases: ${oldDir} is not a directory inside ${this.layout.baseDir}; not deleting`);
      return out;
    }
    let entries;
    try {
      entries = this.ops.list(oldDir).map((e) => ({ ...e, movedAtMs: e.kind === "dir" ? parseMovedAt(this.ops.readFile(join(oldDir, e.name, MOVED_AT_FILE))) : null }));
    } catch {
      return out;
    }
    for (const name of oldReleasesToDelete(entries, Date.now(), { all })) {
      let path = join(oldDir, name);
      const real = this.ops.realpath(path);
      const st = await lstat(path).catch(() => null);
      if (!real || !st || st.isSymbolicLink() || !st.isDirectory() || !isDirectChild(realOld, real, STYLE.win)) continue;
      try {
        if (!name.endsWith(DELETING_SUFFIX)) {
          const target = this.ops.exists(path + DELETING_SUFFIX) ? `${path}-${Date.now()}${DELETING_SUFFIX}` : path + DELETING_SUFFIX;
          this.ops.rename(path, target);
          path = target;
        }
        await rm(path, { recursive: true, force: true, maxRetries: 2 });
        out.deleted.push(name);
      } catch (error) {
        out.failed.push(name);
        this.log(`old releases: could not delete ${name} now (${error instanceof Error ? error.message : String(error)}); retrying later`);
      }
    }
    if (out.deleted.length) this.log(`old releases: deleted ${out.deleted.join(", ")}${all ? " (on request)" : " (moved more than 30 days ago)"}`);
    return out;
  }

  /** Archived releases and their size on disk (files only; links are not followed). */
  async measure(): Promise<OldReleasesSummary> {
    const oldDir = this.oldReleasesDir;
    let names: fs.Dirent[];
    try {
      names = await readdir(oldDir, { withFileTypes: true });
    } catch {
      return { count: 0, bytes: 0 };
    }
    let bytes = 0;
    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const path = join(dir, e.name);
        if (e.isDirectory()) await walk(path);
        else if (e.isFile()) bytes += (await lstat(path).catch(() => null))?.size ?? 0;
      }
    };
    const dirs = names.filter((e) => e.isDirectory() && !e.name.startsWith("."));
    for (const d of dirs) await walk(join(oldDir, d.name));
    return { count: dirs.length, bytes };
  }

  /**
   * macOS: where the launcher clone lives — `CUTEX_DESKTOP_SHORTCUT_ROOT` (stands in for ~/Applications),
   * else ~/Applications; side instances with their own userData leave it alone (null).
   */
  launcherDir(): string | null {
    if (!MAC) return null;
    if (process.env.CUTEX_DESKTOP_SHORTCUT_ROOT) return process.env.CUTEX_DESKTOP_SHORTCUT_ROOT;
    return process.env.CUTEX_DESKTOP_USER_DATA ? null : join(homedir(), "Applications");
  }

  /** macOS: make `<launcherDir>/Cutex.app` a clone of current's bundle; the launcher path when it is current. */
  syncLauncher(): { action: LauncherAction; launcher: string } | null {
    const dir = this.launcherDir();
    if (!dir) return null;
    try {
      for (const name of staleLauncherTemps(fs.existsSync(dir) ? fs.readdirSync(dir) : [])) this.ops.removeTree(join(dir, name));
    } catch {
      // retried next time
    }
    const result = syncMacLauncher(this.ops, { launcherDir: dir, baseDir: this.layout.baseDir, tag: String(process.pid) });
    if (result.action === "created" || result.action === "refreshed") this.log(`launcher ${result.launcher} ${result.action} from current`);
    else if (result.action === "foreign") this.log(`launcher ${result.launcher} belongs to another install; left alone`);
    else if (result.action === "failed") this.log(`launcher ${result.launcher} not updated: ${result.error ?? "unknown"}`);
    return result;
  }
}
