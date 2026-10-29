// Remembers the app windows' size, position and maximized state in userData/window-state.json — the main
// window's record and one per desk window (main/deskShell.ts) — and restores them on start, fitted to the
// displays connected now (shared/windowBounds.ts). Saves are debounced while resizing / moving and flushed
// synchronously when a window closes.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, screen, type BrowserWindow } from "electron";
import { MAX_DESK_RECORDS, parseWindowStates, restoreDeskBounds, restoreWindowBounds, settleWindowBounds, type Rect, type WindowState, type WindowStates } from "../shared/windowBounds";

const SAVE_DELAY_MS = 500;

function file(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function load(): WindowStates {
  try {
    return parseWindowStates(JSON.parse(readFileSync(file(), "utf8")));
  } catch {
    return { main: null, desks: {} };
  }
}

/** Which record a window is: the main window, or a desk by its id. */
export type WindowKey = { kind: "main" } | { kind: "desk"; deskId: string };

function write(key: WindowKey, state: WindowState | null): void {
  try {
    const states = load();
    if (key.kind === "main") states.main = state;
    else {
      delete states.desks[key.deskId];
      // The newest record first; the oldest beyond MAX_DESK_RECORDS are dropped.
      if (state) states.desks = Object.fromEntries([[key.deskId, state] as const, ...Object.entries(states.desks)].slice(0, MAX_DESK_RECORDS));
    }
    const target = file();
    writeFileSync(`${target}.tmp`, `${JSON.stringify(states)}\n`, "utf8");
    renameSync(`${target}.tmp`, target);
  } catch (error) {
    console.warn("[cutex-desktop] saving the window state failed", error);
  }
}

function backgroundFile(): string {
  return join(app.getPath("userData"), "window-background.json");
}

/** The window colour the renderer last reported (theme + palette), or null before the first report. */
export function loadWindowBackground(): string | null {
  try {
    const color = (JSON.parse(readFileSync(backgroundFile(), "utf8")) as { color?: unknown }).color;
    return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
  } catch {
    return null;
  }
}

let savedBackground: string | null = null;

/** Persist the window colour for the next start (only when it changed). */
export function saveWindowBackground(color: string): void {
  if (color === savedBackground) return;
  savedBackground = color;
  try {
    const target = backgroundFile();
    writeFileSync(`${target}.tmp`, `${JSON.stringify({ color })}\n`, "utf8");
    renameSync(`${target}.tmp`, target);
  } catch (error) {
    console.warn("[cutex-desktop] saving the window background failed", error);
  }
}

/** The connected displays' work areas, primary first (empty without screen info). */
export function workAreas(): Rect[] {
  try {
    const primary = screen.getPrimaryDisplay();
    return [primary.workArea, ...screen.getAllDisplays().filter((d) => d.id !== primary.id).map((d) => d.workArea)];
  } catch {
    return [];
  }
}

/** Initial BrowserWindow bounds (call after app ready) and whether to maximize once shown. */
export function initialWindowBounds(): { bounds: Partial<Rect> & { width: number; height: number }; maximized: boolean } {
  return restoreWindowBounds(load().main, workAreas());
}

/**
 * Windows: make a just-created (still hidden) window's bounds read back as restored, so what is saved next is what was
 * stored — else a hidden-title-bar window grows a few DIP per start at 125 / 150 % (shared/windowBounds settleWindowBounds).
 */
export function settleRestoredBounds(win: BrowserWindow, bounds: Partial<Rect> & { width: number; height: number }): void {
  if (process.platform !== "win32") return;
  try {
    if (!win.isDestroyed()) settleWindowBounds(win, bounds);
  } catch (error) {
    // Cosmetic: never in the way of the window being set up.
    console.warn("[cutex-desktop] settling the window bounds failed", error);
  }
}

/** A desk window's first bounds: its own record, else next to the main window (`anchor`). */
export function initialDeskBounds(deskId: string, anchor: Rect | null): { bounds: Rect; maximized: boolean } {
  return restoreDeskBounds(load().desks[deskId] ?? null, workAreas(), anchor);
}

/** A desk closed by the owner: its record goes (reopening it later starts next to the main window). */
export function forgetDeskBounds(deskId: string): void {
  write({ kind: "desk", deskId }, null);
}

/** Track resize / move / maximize on an app window and persist them under `key`. */
export function trackWindowState(win: BrowserWindow, key: WindowKey = { kind: "main" }): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: string | null = null;
  const snapshot = (): WindowState | null => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return null;
    const b = win.getNormalBounds();
    return { bounds: { x: b.x, y: b.y, width: b.width, height: b.height }, maximized: win.isMaximized() };
  };
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const state = snapshot();
    if (!state) return;
    const body = JSON.stringify(state);
    if (body === last) return;
    last = body;
    write(key, state);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  };
  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  // Close may only hide to the tray; either way the current bounds are final for now.
  win.on("close", flush);
}
