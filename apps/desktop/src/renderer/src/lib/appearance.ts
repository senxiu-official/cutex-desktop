// Settings → 外观: sizes and fonts, per machine (localStorage; each computer keeps its own),
// applied as CSS variables on <html> (styles.css reads them) plus the Electron zoom factor.
import { useSyncExternalStore } from "react";
import { bridge } from "../bridge";

import { appearanceVars, DEFAULT_APPEARANCE, parseAppearance, type Appearance } from "./appearanceModel";
import { cssString, FALLBACK_FONT_VARIABLES, FontRoutingController, type FontStatus, type FontVariables } from "./fontFaces";
import { APPEARANCE_KEY } from "./storedFonts";
import { matchesCommand } from "./keybindings";

export { DEFAULT_APPEARANCE, RANGES, type Appearance, type Density } from "./appearanceModel";

const KEY = APPEARANCE_KEY;

function load(): Appearance {
  try {
    return parseAppearance(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

let current: Appearance = load();
const listeners = new Set<() => void>();
const beforeFontListeners = new Set<() => void>();
const fontListeners = new Set<() => void>();
const fontStatusListeners = new Set<() => void>();
let fontVariables: FontVariables = FALLBACK_FONT_VARIABLES;
let fontStatus: FontStatus = { phase: "loading", generation: 0, failedFamilies: [] };
let fontController: FontRoutingController<FontFace> | undefined;

export const getFontStatus = (): FontStatus => fontStatus;
export function subscribeBeforeFontChange(listener: () => void): () => void {
  beforeFontListeners.add(listener);
  return () => { beforeFontListeners.delete(listener); };
}
/** Fired after loaded aliases and all seven variables have been published. */
export function subscribeFontChanges(listener: () => void): () => void {
  fontListeners.add(listener);
  return () => { fontListeners.delete(listener); };
}
export function useFontStatus(): FontStatus {
  return useSyncExternalStore((listener) => {
    fontStatusListeners.add(listener);
    return () => { fontStatusListeners.delete(listener); };
  }, getFontStatus);
}

function notifyFontListeners(subscribers: Set<() => void>): void {
  // A consumer's layout error must not prevent the font generation from committing.
  for (const listener of subscribers) {
    try { listener(); } catch (error) { console.error("Font change listener failed", error); }
  }
}

function prepareFonts(a: Appearance): void {
  if (typeof FontFace === "undefined" || !document.fonts) {
    if (fontStatus.phase !== "unsupported") {
      fontStatus = { phase: "unsupported", generation: 0, failedFamilies: [] };
      notifyFontListeners(fontStatusListeners);
    }
    return;
  }
  fontController ??= new FontRoutingController({
    createFace: ({ alias, source, descriptors }) => new FontFace(alias, source, descriptors),
    add: (face) => { document.fonts.add(face); },
    remove: (face) => { document.fonts.delete(face); },
    beforePublish: () => { notifyFontListeners(beforeFontListeners); },
    publish: (variables) => {
      fontVariables = variables;
      for (const [key, value] of Object.entries(variables)) document.documentElement.style.setProperty(key, value);
    },
    afterPublish: () => { notifyFontListeners(fontListeners); },
    statusChanged: (status) => { fontStatus = status; notifyFontListeners(fontStatusListeners); },
  });
  void fontController.update(a);
}

/** Loads the fonts again with the same choices (a 中文字体包 family was imported or removed). */
export function reloadFonts(): void {
  void fontController?.reload(current);
}

export function getAppearance(): Appearance {
  return current;
}

export function applyAppearance(a: Appearance = current): void {
  const root = document.documentElement;
  // Sizes are synchronous; pending font loads keep the last complete generation.
  for (const [k, v] of Object.entries(appearanceVars(a, fontVariables))) root.style.setProperty(k, v);
  prepareFonts(a);
  root.dataset.density = a.density;
  // 卡片材质 (styles.css: .shell-card / .sidebar-card / the rails under :root[data-card-material="acrylic"]).
  root.dataset.cardMaterial = a.cardMaterial;
  // 拖放落点预览: only :root[data-drop-preview="fill"] paints the drop previews' tint (lib/dropTint, styles.css).
  root.dataset.dropPreview = a.dropPreview;
  const factor = a.zoom / 100;
  // Electron: real zoom (layout + hit testing). Browser preview: CSS zoom on <html>.
  if (bridge.shell?.setZoom) void bridge.shell.setZoom(factor).catch(() => {});
  else root.style.zoom = factor === 1 ? "" : String(factor);
}

export function setAppearance(patch: Partial<Appearance>, persist = true): void {
  current = parseAppearance({ ...current, ...patch });
  applyAppearance(current);
  if (persist) {
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // per-machine preference just won't persist
    }
  }
  for (const l of listeners) l();
}

/**
 * Pane widths while a resize handle is dragged: only the width's CSS variable moves, on the elements that
 * read it (marked `data-live-width="<field>"`; on <html> an inherited custom property restyles the whole
 * document per step), and the few readers of `useLiveWidth`. The stored appearance — every variable,
 * fonts, the Electron zoom IPC, every `useAppearance` reader — changes once, on release (`commitLiveWidths`).
 */
export type LiveWidthKey = "sidebarWidth" | "sidePaneWidth";
const LIVE_VARS: Record<LiveWidthKey, string> = { sidebarWidth: "--sidebar-w", sidePaneWidth: "--sidepane-w" };
let live: Partial<Record<LiveWidthKey, number>> = {};

export function previewWidth(field: LiveWidthKey, px: number): void {
  if (live[field] === px) return;
  live = { ...live, [field]: px };
  for (const el of liveReaders(field)) el.style.setProperty(LIVE_VARS[field], `${px}px`);
  for (const l of listeners) l();
}

const liveReaders = (field: LiveWidthKey) => document.querySelectorAll<HTMLElement>(`[data-live-width~="${field}"]`);

/** The drag ended: store what was shown live (nothing previewed: nothing happens). */
export function commitLiveWidths(): void {
  const patch = live;
  if (!Object.keys(patch).length) return;
  live = {};
  setAppearance(patch, true);
  // <html> has the stored widths now: the readers inherit them again.
  for (const field of Object.keys(patch) as LiveWidthKey[]) for (const el of liveReaders(field)) el.style.removeProperty(LIVE_VARS[field]);
}

export function getLiveWidth(field: LiveWidthKey): number {
  return live[field] ?? current[field];
}

/** A width as shown now: the live drag's value, else the stored one. */
export function useLiveWidth(field: LiveWidthKey): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getLiveWidth(field),
  );
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Ctrl/Cmd + = / - / 0: zoom in, out, reset (10% steps). True when handled. */
export function zoomShortcut(e: KeyboardEvent): boolean {
  const step = matchesCommand("zoomIn", e) ? 10 : matchesCommand("zoomOut", e) ? -10 : matchesCommand("zoomReset", e) ? 0 : null;
  if (step === null) return false;
  setAppearance({ zoom: step === 0 ? 100 : current.zoom + step });
  return true;
}

/**
 * Whether a font family is installed: text in "<family>, <fallback>" measures differently from the
 * fallback alone for at least one of two fallbacks. (A missing family always falls back.)
 */
export function fontAvailable(family: string): boolean {
  if (!family) return true;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  const sample = "mmmmmmmmmmlli 永和九年 WwQq 0123";
  return (["monospace", "serif"] as const).some((fallback) => {
    ctx.font = `32px ${fallback}`;
    const base = ctx.measureText(sample).width;
    ctx.font = `32px ${cssString(family)}, ${fallback}`;
    return ctx.measureText(sample).width !== base;
  });
}
