// 项目 page left list, 「最近打开」 (owner 2026-11-25): the projects opened on this device, newest first, by host key.
// Device-local (localStorage), like the page's other view state; nothing about the project itself is stored. Every
// window of the app shares it: another window's change (a `storage` event) is read again, and a write starts from what
// is stored now, so two windows add to one list instead of overwriting each other's.
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "cutex-desktop.projects.recent";
export const RECENT_PROJECTS_MAX = 8;

let cache: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    cache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENT_PROJECTS_MAX) : [];
  } catch {
    cache = [];
  }
  return cache;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    cache = null;
    for (const l of listeners) l();
  });
}

/** Notes `key` (hostKey(hostId, projectId)) as just opened. */
export function noteProjectOpened(key: string): void {
  // What another window stored since this one last read.
  cache = null;
  const list = read();
  if (list[0] === key) return;
  cache = [key, ...list.filter((k) => k !== key)].slice(0, RECENT_PROJECTS_MAX);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full / unavailable: the list still holds for this run.
  }
  for (const l of listeners) l();
}

export function recentProjects(): readonly string[] {
  return read();
}

export function useRecentProjects(): readonly string[] {
  return useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), read, read);
}

/** Tests. */
export function resetRecentProjects(): void {
  cache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}
