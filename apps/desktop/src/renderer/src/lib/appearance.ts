// Settings → 外观: sizes and fonts, per machine (localStorage; each computer keeps its own),
// applied as CSS variables on <html> (styles.css reads them) plus the Electron zoom factor.
import { useSyncExternalStore } from "react";
import { bridge } from "../bridge";

import { appearanceVars, DEFAULT_APPEARANCE, parseAppearance, type Appearance } from "./appearanceModel";
import { cssString, FALLBACK_FONT_VARIABLES, FontRoutingController, type FontStatus, type FontVariables } from "./fontFaces";

export { DEFAULT_APPEARANCE, RANGES, type Appearance, type Density } from "./appearanceModel";

const KEY = "cutex-desktop.appearance";

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

export function getAppearance(): Appearance {
  return current;
}

export function applyAppearance(a: Appearance = current): void {
  const root = document.documentElement;
  // Sizes are synchronous; pending font loads keep the last complete generation.
  for (const [k, v] of Object.entries(appearanceVars(a, fontVariables))) root.style.setProperty(k, v);
  prepareFonts(a);
  root.dataset.density = a.density;
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
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const step = e.key === "=" || e.key === "+" ? 10 : e.key === "-" || e.key === "_" ? -10 : e.key === "0" ? 0 : null;
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
