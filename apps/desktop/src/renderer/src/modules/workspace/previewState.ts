// The preview card's params / state (pure; tested): a workspace-relative path, or with `host` an
// absolute path on the host. `source` = Markdown / SVG / HTML shown as source (a line anchor opens as source;
// otherwise the owner's last choice for that kind of file, viewChoice.ts).
import type { Json } from "../types";
import { sourceChoice, viewKindOf } from "./viewChoice";
import type { WorkspaceScope } from "../../../../shared/ipc";

export type PreviewParams = { path: string; line: number | null; host: boolean; scope?: { kind: "session" | "project"; id: string } };
export type PreviewState = PreviewParams & { source: boolean };

const MAX_PATH = 4000;

export function parsePreviewParams(raw: Json): PreviewParams | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const path = raw.path;
  if (typeof path !== "string" || !path || path.length > MAX_PATH) return null;
  const line = typeof raw.line === "number" && Number.isInteger(raw.line) && raw.line > 0 ? raw.line : null;
  const s = raw.scope;
  const scope = s && typeof s === "object" && !Array.isArray(s) && (s.kind === "project" || s.kind === "session") && typeof s.id === "string" && s.id && s.id.length <= 160 ? { kind: s.kind, id: s.id } as WorkspaceScope : null;
  if (s !== undefined && (!scope || raw.host === true)) return null;
  return { path, line, host: raw.host === true, ...(scope ? { scope } : {}) };
}

export function previewKey(p: PreviewParams): string {
  return `${p.host ? "host:" : "ws:"}${p.scope ? `${p.scope.kind}:${p.scope.id}:` : ""}${p.path}`;
}

export function initPreview(p: PreviewParams, _previous: PreviewState | null): PreviewState {
  // A line anchor shows the source (the line must be visible); else the last 预览 / 源码 choice for this kind.
  return { ...p, source: p.line ? true : sourceChoice(viewKindOf(p.path)) };
}

export function restorePreview(raw: Json, version: number): PreviewState | null {
  if (version !== 1 || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const params = parsePreviewParams(raw);
  return params ? { ...params, source: raw.source === true } : null;
}

export function isSourceToggleable(path: string): boolean {
  return viewKindOf(path) !== null;
}

export function baseOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
