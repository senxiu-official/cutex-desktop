// Provider launcher artwork (portrait + victory pose), from two sources:
// - bundled: the owner's images are not in git (assets/launcher/.gitignore; scripts/copy-launcher-art.{ps1,sh}
//   copy them in). They are loaded with an eager glob instead of static imports so a checkout without
//   them — the in-app updater's clean clone, CI, another machine — still builds: missing files yield no entry.
// - imported: Settings → 外观 → 启动页立绘 imports them at runtime from a folder (main/launchArt.ts); main
//   hands them over as data URLs (shared/launchArt.ts), so the CSP stays as it is.
// Imported art wins per provider (main only reports complete providers); a provider with neither shows
// the icon + greeting intro.
import { useSyncExternalStore } from "react";
import type { PreloadBridge } from "../../../shared/ipc";
import { LAUNCH_ART_FILES as FILES, type LaunchArtBridge, type LaunchArtImages, type LaunchArtImportResult, type LaunchArtProvider, type LaunchArtState } from "../../../shared/launchArt";
import type { PortraitProvider } from "./launchPortraits";

// The launcher's providers and the art's are the same set.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const SAME_PROVIDERS: Same<PortraitProvider, LaunchArtProvider> = true;
void SAME_PROVIDERS;

export const LAUNCH_ART_FILES: Record<PortraitProvider, { portrait: string; victory: string }> = FILES;

export type LaunchArt = Partial<Record<PortraitProvider, { portrait: string; victory: string }>>;

/** Glob result (path → URL) → per-provider art; a provider counts only with both of its files. */
export function launchArtFrom(urls: Record<string, string>): LaunchArt {
  const byName = new Map(Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]));
  const art: LaunchArt = {};
  for (const [provider, files] of Object.entries(LAUNCH_ART_FILES) as [PortraitProvider, { portrait: string; victory: string }][]) {
    const portrait = byName.get(files.portrait);
    const victory = byName.get(files.victory);
    if (typeof portrait === "string" && typeof victory === "string") art[provider] = { portrait, victory };
  }
  return art;
}

export const BUNDLED_LAUNCH_ART: LaunchArt = launchArtFrom(
  import.meta.glob<string>("../assets/launcher/*.png", { eager: true, query: "?url", import: "default" }),
);

/** Imported over bundled, per provider; an imported entry counts only with both images. */
export function mergeLaunchArt(bundled: LaunchArt, imported: LaunchArtImages | null | undefined): LaunchArt {
  const art: LaunchArt = { ...bundled };
  for (const provider of Object.keys(LAUNCH_ART_FILES) as PortraitProvider[]) {
    const entry = imported?.[provider];
    if (entry && typeof entry.portrait === "string" && typeof entry.victory === "string" && entry.portrait && entry.victory) art[provider] = { portrait: entry.portrait, victory: entry.victory };
  }
  return art;
}

export type LaunchArtSource = "imported" | "bundled" | "none";

/** What Settings shows per provider. */
export function launchArtSource(provider: PortraitProvider, bundled: LaunchArt, imported: LaunchArtImages | null | undefined): LaunchArtSource {
  if (mergeLaunchArt({}, imported)[provider]) return "imported";
  return bundled[provider] ? "bundled" : "none";
}

// ── the imported art (main), loaded once per window ───────────────────────────────────────────────

export interface LaunchArtView {
  /** What the launcher and the opening use. */
  art: LaunchArt;
  imported: LaunchArtImages;
  /** False until main answered (or there is no bridge): the launcher holds its frame meanwhile. */
  ready: boolean;
}

function source(): LaunchArtBridge | undefined {
  return (globalThis as { cutex?: PreloadBridge }).cutex?.launchArt;
}

let view: LaunchArtView = { art: BUNDLED_LAUNCH_ART, imported: {}, ready: false };
let loading = false;
const listeners = new Set<() => void>();

function apply(state: LaunchArtState | null): void {
  const imported = state?.imported ?? {};
  view = { art: mergeLaunchArt(BUNDLED_LAUNCH_ART, imported), imported, ready: true };
  for (const l of listeners) l();
}

function load(): void {
  if (loading || view.ready) return;
  const bridge = source();
  if (!bridge) return apply(null);
  loading = true;
  bridge
    .state()
    .then(
      (state) => apply(state),
      () => apply(null),
    )
    .finally(() => {
      loading = false;
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  load();
  return () => listeners.delete(listener);
}

function snapshot(): LaunchArtView {
  return view;
}

export function useLaunchArtView(): LaunchArtView {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The art the launcher and the opening use (imported over bundled). */
export function useLaunchArt(): LaunchArt {
  return useLaunchArtView().art;
}

/** Whether this window can import (the Electron bridge, or the preview's mock). */
export function canImportLaunchArt(): boolean {
  return !!source();
}

/** 从文件夹导入…: main opens the folder dialog and copies the art; the view updates with the result. */
export async function importLaunchArt(): Promise<LaunchArtImportResult> {
  const bridge = source();
  if (!bridge) throw new Error("launch art import is unavailable");
  const result = await bridge.import();
  apply(result.state);
  return result;
}

/** 清除: back to the bundled art, else the icon intro. */
export async function clearLaunchArt(): Promise<void> {
  const bridge = source();
  if (!bridge) throw new Error("launch art import is unavailable");
  apply(await bridge.clear());
}
