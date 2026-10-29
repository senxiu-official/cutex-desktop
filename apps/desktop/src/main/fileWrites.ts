// Small file writes of the main process (storage audit 2026-10-23): atomic replace and a size-rotated log.
import { renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

/** update.log rotates at this size; one older file (update.1.log) is kept (storage audit 2026-10-23). */
export const UPDATE_LOG_MAX_BYTES = 2 * 1024 * 1024;

/** Before an append: a log at or past `max` becomes `update.1.log` (replacing the older one). */
export function rotateUpdateLog(file: string, max = UPDATE_LOG_MAX_BYTES): void {
  try {
    if (statSync(file).size < max) return;
    renameSync(file, file.replace(/\.log$/, ".1.log"));
  } catch {
    // no log yet / rotation failed: keep appending
  }
}

/** A file written beside its target and renamed over it: a crash leaves the old one or the new one, never a torn one. */
export function writeFileAtomic(path: string, text: string): void {
  const temp = `${path}.${process.pid}-${Date.now().toString(36)}.tmp`;
  writeFileSync(temp, text, { flag: "wx" });
  try {
    renameSync(temp, path);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // the target is unchanged either way
    }
    throw error;
  }
}
