// Remembers the main window's size, position and maximized state in userData/window-state.json and
// restores it on start, fitted to the displays connected now (shared/windowBounds.ts). Saves are
// debounced while resizing / moving and flushed synchronously when the window closes.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, screen, type BrowserWindow } from "electron";
import { parseWindowState, restoreWindowBounds, type Rect, type WindowState } from "../shared/windowBounds";

const SAVE_DELAY_MS = 500;

function file(): string {
  return join(app.getPath("userData"), "window-state.json");
}

function load(): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(file(), "utf8")));
  } catch {
    return null;
  }
}

function write(state: WindowState): void {
  try {
    const target = file();
    writeFileSync(`${target}.tmp`, `${JSON.stringify(state)}\n`, "utf8");
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

/** Initial BrowserWindow bounds (call after app ready) and whether to maximize once shown. */
export function initialWindowBounds(): { bounds: Partial<Rect> & { width: number; height: number }; maximized: boolean } {
  let areas: Rect[] = [];
  try {
    const primary = screen.getPrimaryDisplay();
    areas = [primary.workArea, ...screen.getAllDisplays().filter((d) => d.id !== primary.id).map((d) => d.workArea)];
  } catch {
    // no screen info: defaults
  }
  return restoreWindowBounds(load(), areas);
}

/** Track resize / move / maximize on the main window and persist them. */
export function trackWindowState(win: BrowserWindow): void {
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
    write(state);
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
