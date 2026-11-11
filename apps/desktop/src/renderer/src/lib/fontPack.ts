// 中文字体包 in this window (shared/fontCatalog.ts, main/fontPack.ts): which pack families are imported, shared by the
// font picker and Settings → 外观 → 中文字体包, with main's download progress (下载并安装). Importing, downloading or
// removing a family loads the fonts again.
import { useSyncExternalStore } from "react";
import { bridge } from "../bridge";
import { reloadFonts } from "./appearance";
import type { FontPackImportResult, FontPackState } from "../../../shared/fontCatalog";

let state: FontPackState | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const installedCount = (s: FontPackState | null) => s?.families.reduce((n, f) => n + f.installed, 0) ?? 0;

function set(next: FontPackState): void {
  const grew = installedCount(next) > installedCount(state);
  state = next;
  for (const l of listeners) l();
  // A download that finished (state pushes from main) makes new faces servable.
  if (grew && state) reloadFonts();
}

let subscribed = false;
function subscribe(): void {
  if (subscribed || !bridge.fontPack?.onState) return;
  subscribed = true;
  bridge.fontPack.onState(set);
}

function load(): void {
  if (loading || !bridge.fontPack) return;
  loading = bridge.fontPack.state().then(set, () => {}).finally(() => { loading = null; });
}

/** The pack state; null until read (or in a window without the bridge). */
export function useFontPack(): FontPackState | null {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    subscribe();
    if (!state) load();
    return () => { listeners.delete(l); };
  }, () => state, () => state);
}

/** Whether every face of a pack family is imported. */
export function packInstalled(pack: FontPackState | null, id: string): boolean {
  const family = pack?.families.find((f) => f.id === id);
  return !!family && family.installed === family.total;
}

export async function importFontPack(): Promise<FontPackImportResult | null> {
  if (!bridge.fontPack) return null;
  const result = await bridge.fontPack.import();
  set(result.state);
  return result;
}

export async function removeFontPack(id: string): Promise<void> {
  if (!bridge.fontPack) return;
  set(await bridge.fontPack.remove(id));
  reloadFonts();
}

/** 下载并安装: main downloads and installs the pack; progress arrives through onState. */
export async function downloadFontPack(): Promise<void> {
  if (!bridge.fontPack) return;
  set(await bridge.fontPack.download());
}

export function cancelFontPackDownload(): void {
  void bridge.fontPack?.cancelDownload().catch(() => {});
}

export function openFontPackFolder(): void {
  void bridge.fontPack?.openFolder().catch(() => {});
}
