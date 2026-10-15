// The preview card's params / state (pure; tested): a workspace-relative path, or with `host` an
// absolute path on the host. `source` = Markdown / SVG shown as source (a line anchor opens as source).
import type { Json } from "../types";

export type PreviewParams = { path: string; line: number | null; host: boolean };
export type PreviewState = { path: string; line: number | null; host: boolean; source: boolean };

const MAX_PATH = 4000;

export function parsePreviewParams(raw: Json): PreviewParams | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const path = raw.path;
  if (typeof path !== "string" || !path || path.length > MAX_PATH) return null;
  const line = typeof raw.line === "number" && Number.isInteger(raw.line) && raw.line > 0 ? raw.line : null;
  return { path, line, host: raw.host === true };
}

export function previewKey(p: PreviewParams): string {
  return `${p.host ? "host:" : "ws:"}${p.path}`;
}

export function initPreview(p: PreviewParams, previous: PreviewState | null): PreviewState {
  // Reopening the same file with a line anchor shows the source again (the line must be visible).
  return { path: p.path, line: p.line, host: p.host, source: p.line ? true : (previous?.source ?? false) };
}

export function restorePreview(raw: Json, version: number): PreviewState | null {
  if (version !== 1 || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const params = parsePreviewParams(raw);
  return params ? { ...params, source: raw.source === true } : null;
}

export function isSourceToggleable(path: string): boolean {
  return /\.(md|markdown|mdx|svg)$/i.test(path);
}

export function baseOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
