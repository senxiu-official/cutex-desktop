// 本机备注: a device-local note per project (prefs `projectRemarks`, keyed by hostKey(hostId, projectId);
// no daemon state). One line, trimmed, at most REMARK_MAX characters; empty = no note.
import { hostKey, parseHostKey } from "./hostKeys";
import type { AgentRow, SidebarGroup } from "./sidebar";

export const REMARK_MAX = 200;

/** One line (newlines / tabs → a space, runs collapsed), trimmed, at most REMARK_MAX characters (code points). */
export function sanitizeRemark(text: string): string {
  // Any whitespace but a plain space (newlines, tabs, line / paragraph separators) becomes a space.
  const line = text.replace(/[^\S ]+/g, " ").replace(/ {2,}/g, " ").trim();
  const chars = Array.from(line);
  return chars.length > REMARK_MAX ? chars.slice(0, REMARK_MAX).join("").trimEnd() : line;
}

/** Sanitised `projectRemarks` from storage: host keys only, string values, empty ones dropped. */
export function migrateRemarks(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (!parseHostKey(key) || typeof text !== "string") continue;
    const clean = sanitizeRemark(text);
    if (clean) out[key] = clean;
  }
  return out;
}

/** `remarks` with the note of `projectId` on `hostId` set (sanitised; empty removes it). Same object when unchanged. */
export function withRemark(remarks: Readonly<Record<string, string>>, hostId: string, projectId: string, text: string): Record<string, string> {
  const key = hostKey(hostId, projectId);
  const clean = sanitizeRemark(text);
  if ((remarks[key] ?? "") === clean) return remarks as Record<string, string>;
  const next = { ...remarks };
  if (clean) next[key] = clean;
  else delete next[key];
  return next;
}

/** The note of a sidebar group (projects only; a group without a host is the focus host's). */
export function groupRemark(remarks: Readonly<Record<string, string>>, group: Pick<SidebarGroup, "kind" | "id" | "hostId">, focus: string): string {
  return group.kind === "project" ? (remarks[hostKey(group.hostId ?? focus, group.id)] ?? "") : "";
}

/**
 * Sidebar search over groups: `q` (lower-cased, trimmed) keeps a group whole when its note matches,
 * otherwise only its matching agents (groups left with none drop out).
 */
export function searchGroups<G extends SidebarGroup>(groups: readonly G[], q: string, rowMatch: (row: AgentRow) => boolean, remarkOf: (group: G) => string): G[] {
  if (!q) return [...groups];
  return groups.flatMap((g) => {
    if (remarkOf(g).toLowerCase().includes(q)) return [g];
    const online = g.online.filter(rowMatch);
    const offline = g.offline.filter(rowMatch);
    return online.length + offline.length > 0 ? [{ ...g, online, offline }] : [];
  });
}
