// 预览 / 源码 per file kind (owner 2026-10-24): Markdown, SVG and HTML open rendered by default; the owner's last
// choice for a kind is what the next file of that kind opens with (this device; localStorage). A line anchor
// still opens as source (previewState). Pure apart from storage; tested.
import { useSyncExternalStore } from "react";

export type ViewKind = "markdown" | "svg" | "html";

const KEY = "cutex-desktop:file-view-source";

export function viewKindOf(path: string): ViewKind | null {
  if (/\.(md|markdown|mdx)$/i.test(path)) return "markdown";
  if (/\.svg$/i.test(path)) return "svg";
  if (/\.html?$/i.test(path)) return "html";
  return null;
}

const listeners = new Set<() => void>();
let cache: Partial<Record<ViewKind, boolean>> | null = null;

function read(): Partial<Record<ViewKind, boolean>> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}") as unknown;
    const out: Partial<Record<ViewKind, boolean>> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw))
      for (const k of ["markdown", "svg", "html"] as const) if (typeof (raw as Record<string, unknown>)[k] === "boolean") out[k] = (raw as Record<string, boolean>)[k];
    cache = out;
  } catch {
    cache = {};
  }
  return cache;
}

/** Whether a file of `kind` opens as source (false = rendered, the default). */
export function sourceChoice(kind: ViewKind | null): boolean {
  return kind ? read()[kind] === true : false;
}

export function rememberSourceChoice(kind: ViewKind | null, source: boolean): void {
  if (!kind || read()[kind] === source) return;
  cache = { ...read(), [kind]: source };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode / quota: kept for this run */
  }
  for (const l of listeners) l();
}

export function useSourceChoice(kind: ViewKind | null): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sourceChoice(kind),
  );
}

/** Tests: forget the cached choices (the storage is read again). */
export function resetSourceChoiceCache(): void {
  cache = null;
}
