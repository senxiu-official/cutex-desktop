// Structural sharing for sidebar snapshots (perf §9). Every refresh (after any agent activity, at most every
// 2 s per host) used to replace every session object, so every memoised row, group layout and selector
// downstream saw "new" data and the whole sidebar re-rendered, with App above it. A session, host row or
// the projects list whose content did not change keeps the previous object; a snapshot with nothing
// changed is the previous snapshot itself.
import type { SidebarSnapshot } from "../../../shared/ipc";

// Serialised fresh each time (no cache): a session object may be patched in place between two refreshes.
const key = (value: unknown): string => JSON.stringify(value) ?? "undefined";

/** `prev` when it is a different object with `next`'s content, else `next`. The very same object is never
 *  taken as unchanged: it may have been patched in place (IPC always delivers fresh copies; an in-process
 *  source such as the mock bridge may not). */
function keep<T>(prev: T | undefined, next: T): T {
  if (prev === undefined || prev === null || prev === next || typeof prev !== "object" || next === null || typeof next !== "object") return next;
  return key(prev) === key(next) ? prev : next;
}
/** Whether `kept` (from keep) is provably the previous value. */
const unchanged = <T,>(prev: T, next: T, kept: T) => kept === prev && (prev !== next || prev == null);

function shareList<T extends { cutexSessionId: string }>(prev: readonly T[], next: T[]): T[] {
  const old = new Map(prev.map((s) => [s.cutexSessionId, s]));
  let all = prev.length === next.length;
  const out = next.map((s, i) => {
    const kept = keep(old.get(s.cutexSessionId), s);
    if (!unchanged(prev[i], s, kept)) all = false;
    return kept;
  });
  return all ? (prev as T[]) : out;
}

const KNOWN = new Set(["active", "retired", "projects", "hostRows", "claudeRuntime"]);

/** `next` with every unchanged part replaced by `prev`'s object (`prev` itself when nothing changed). */
export function shareSidebar(prev: SidebarSnapshot | null | undefined, next: SidebarSnapshot): SidebarSnapshot {
  if (!prev || prev === next) return next;
  const active = shareList(prev.active, next.active);
  const retired = shareList(prev.retired, next.retired);
  const projects = keep(prev.projects, next.projects);
  const claudeRuntime = keep(prev.claudeRuntime, next.claudeRuntime);
  let rowsSame = Object.keys(prev.hostRows).length === Object.keys(next.hostRows).length;
  const hostRows: SidebarSnapshot["hostRows"] = {};
  for (const [id, row] of Object.entries(next.hostRows)) {
    const kept = keep(prev.hostRows[id], row);
    if (!unchanged(prev.hostRows[id], row, kept)) rowsSame = false;
    hostRows[id] = kept;
  }
  const extra = (s: SidebarSnapshot) => key(Object.entries(s).filter(([k]) => !KNOWN.has(k)));
  const all =
    active === prev.active &&
    retired === prev.retired &&
    unchanged(prev.projects, next.projects, projects) &&
    unchanged(prev.claudeRuntime, next.claudeRuntime, claudeRuntime) &&
    rowsSame &&
    "claudeRuntime" in prev === "claudeRuntime" in next &&
    extra(prev) === extra(next);
  if (all) return prev;
  return { ...next, active, retired, projects, hostRows: rowsSame ? prev.hostRows : hostRows, ...("claudeRuntime" in next ? { claudeRuntime } : {}) };
}
