// diff.view params / state (pure; tested). Three sources share one viewer: a workspace file's git
// diff (`git:<path>`), one turn's changes to a file (`turn:<turnId>:<path>`), or (v1.7) a unified
// diff the caller computed (`text:<key>`, e.g. two versions of a stored artifact). Turn and text
// diffs live in memory only: the state keeps the pointer, the text sits in `turnTexts` (gone after a
// restart → the card says how to reopen it; restore drops them).
import type { Json } from "../types";

export type DiffParams =
  | { source: "git"; path: string; staged?: boolean }
  | { source: "turn"; sessionId: string; turnId: string; path: string; diff: string }
  | { source: "text"; key: string; title: string; diff: string };
export type DiffState =
  | { source: "git"; path: string; staged?: boolean }
  | { source: "turn"; sessionId: string; turnId: string; path: string }
  | { source: "text"; key: string; title: string };

const MAX = 4000;
const str = (v: unknown, max = MAX): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Turn / text diff texts by dedupe key (this run only). */
export const turnTexts = new Map<string, string>();

export function parseDiffParams(raw: Json): DiffParams | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.source === "git") {
    if (!str(raw.path)) return null;
    return typeof raw.staged === "boolean" ? { source: "git", path: raw.path, staged: raw.staged } : { source: "git", path: raw.path };
  }
  if (raw.source === "turn") {
    if (!str(raw.sessionId, 400) || !str(raw.turnId, 400) || !str(raw.path) || typeof raw.diff !== "string") return null;
    return { source: "turn", sessionId: raw.sessionId, turnId: raw.turnId, path: raw.path, diff: raw.diff };
  }
  if (raw.source === "text") {
    if (!str(raw.key, 400) || !str(raw.title, 400) || typeof raw.diff !== "string") return null;
    return { source: "text", key: raw.key, title: raw.title, diff: raw.diff };
  }
  return null;
}

export function diffKey(p: DiffParams | DiffState): string {
  if (p.source === "git") return `git:${p.path}`;
  if (p.source === "turn") return `turn:${p.turnId}:${p.path}`;
  return `text:${p.key}`;
}

export function initDiff(p: DiffParams): DiffState {
  if (p.source === "git") return p.staged === undefined ? { source: "git", path: p.path } : { source: "git", path: p.path, staged: p.staged };
  turnTexts.set(diffKey(p), p.diff);
  if (p.source === "text") return { source: "text", key: p.key, title: p.title };
  return { source: "turn", sessionId: p.sessionId, turnId: p.turnId, path: p.path };
}

/** A git diff comes back after a restart; a turn / text diff does not (its text was never stored). */
export function restoreDiff(raw: Json, version: number): DiffState | null {
  if (version !== 1 || !raw || typeof raw !== "object" || Array.isArray(raw) || raw.source !== "git") return null;
  const p = parseDiffParams(raw);
  return p ? initDiff(p) : null;
}

export function diffName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** What the card header / tab show: the path, or a text diff's title. */
export function diffLabel(s: DiffState): string {
  return s.source === "text" ? s.title : s.path;
}
