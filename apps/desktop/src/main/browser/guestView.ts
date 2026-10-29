// Owner view controls of an in-app browser guest (the browser tab and the Shelf service page are the same
// <webview>, wired in install.ts): page zoom and the right-click menu. Both are decided here in main from the
// guest's own events; the renderer only shows the zoom chip and asks for a reset.
//
// Zoom (owner 2026-10-28): Ctrl+wheel / Ctrl+= / Ctrl+- / Ctrl+0 in the page (before-input-event and
// Electron's zoom-changed, which only fires when the page did not take the Ctrl+wheel itself, e.g. a map).
// Remembered per service (host + slug) for service pages and per site host name for other pages — Chromium
// itself keeps one level per host name in a partition, so two tabs of one site always agree. The stored value
// is relative to the app's own zoom (Settings → 外观): a guest follows its window's zoom (Electron resets every
// guest to the embedder's level when that changes), and 100 % means "same size as the app".
// Pinch: a precision touchpad pinch reaches Chromium as Ctrl+wheel, so it steps the same zoom (gated, one step
// per WHEEL_GATE_MS); Electron's default visual (pinch) zoom limits stay at 1 — no second, visual-only zoom.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BROWSER_ZOOM_BOUNDS, type BrowserZoomAction } from "../../shared/browser";
import { isTraditionalLocale } from "../../shared/locales";
import { parseBrowserServiceUrl } from "./services";

/** Chrome's own page zoom steps, 33 % … 300 %. */
export const BROWSER_ZOOM_STEPS = [0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export type { BrowserZoomAction };
const MIN = BROWSER_ZOOM_BOUNDS.min, MAX = BROWSER_ZOOM_BOUNDS.max;

/** The next step from `current` (any value: an off-step one moves to the nearest step in that direction). */
export function nextBrowserZoom(current: number, action: BrowserZoomAction): number {
  if (action === "reset" || !Number.isFinite(current)) return 1;
  if (action === "in") return BROWSER_ZOOM_STEPS.find(step => step > current + 0.001) ?? MAX;
  return [...BROWSER_ZOOM_STEPS].reverse().find(step => step < current - 0.001) ?? MIN;
}

/**
 * What a page's zoom is remembered by: `service:<hostId>/<slug>` for a service page (the same service on another
 * host is another service), `site:<host name>` for a web page (any host, either login pool). Null: nothing to
 * remember (about:blank, a data: page, an unparsable address) — such a page stays at 100 %.
 */
export function browserZoomKey(hostId: string, raw: string, connectionPort?: number): string | null {
  const service = parseBrowserServiceUrl(raw, connectionPort);
  if (service) return `service:${hostId}/${service.slug}`;
  try {
    const url = new URL(raw);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) return `site:${url.hostname.toLowerCase()}`;
  } catch { /* not a web page */ }
  return null;
}

/** The owner's zoom keys in a guest's before-input-event (keyDown only, no Alt; Ctrl, or ⌘ on macOS). */
export function browserZoomShortcut(input: { type: string; key?: string; code?: string; control?: boolean; meta?: boolean; alt?: boolean }, platform: string = process.platform): BrowserZoomAction | null {
  if (input.type !== "keyDown" || input.alt) return null;
  if (!(platform === "darwin" ? input.meta && !input.control : input.control && !input.meta)) return null;
  if (input.key === "=" || input.key === "+" || input.code === "NumpadAdd") return "in";
  if (input.key === "-" || input.key === "_" || input.code === "NumpadSubtract") return "out";
  if (input.key === "0" || input.code === "Numpad0" || input.code === "Digit0") return "reset";
  return null;
}

/** One zoom step per wheel gesture tick: Electron reports a notch more than once, a touchpad pinch many times. */
export const WHEEL_GATE_MS = 90;
export function createBrowserWheelGate(now: () => number = Date.now, interval = WHEEL_GATE_MS): () => boolean {
  let last = -Infinity;
  return () => {
    const at = now();
    if (at - last < interval && at >= last) return false;
    last = at;
    return true;
  };
}

interface Io { read(path: string): string; write(path: string, text: string): void }
const defaultIo: Io = {
  read: path => readFileSync(path, "utf8"),
  write: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(`${path}.tmp`, text, { mode: 0o600 }); renameSync(`${path}.tmp`, path); },
};
const MAX_ENTRIES = 500;
const KEY = /^(?:service:[^\s/]{1,200}\/[a-z0-9-]{1,63}|site:[^\s]{1,253})$/;

/**
 * userData/browser-zoom.json: `{ version: 1, levels: { <key>: factor } }`, only levels other than 100 %, the most
 * recently changed last (oldest dropped past MAX_ENTRIES). Unreadable or malformed = every page at 100 %.
 */
export class BrowserZoomStore {
  private levels: Map<string, number> | undefined;
  constructor(private readonly file: string | null, private readonly io: Io = defaultIo) {}
  private load(): Map<string, number> {
    if (this.levels) return this.levels;
    this.levels = new Map();
    if (!this.file) return this.levels;
    try {
      const parsed = JSON.parse(this.io.read(this.file)) as { version?: unknown; levels?: unknown };
      if (parsed?.version !== 1 || !parsed.levels || typeof parsed.levels !== "object" || Array.isArray(parsed.levels)) return this.levels;
      for (const [key, value] of Object.entries(parsed.levels).slice(-MAX_ENTRIES)) {
        if (KEY.test(key) && typeof value === "number" && value >= MIN && value <= MAX && value !== 1) this.levels.set(key, value);
      }
    } catch { /* nothing remembered */ }
    return this.levels;
  }
  get(key: string | null): number { return key ? this.load().get(key) ?? 1 : 1; }
  /** Stores a level (clamped to the steps' range; 100 % forgets the key). False: nothing changed. */
  set(key: string, factor: number): boolean {
    if (!KEY.test(key) || !Number.isFinite(factor)) return false;
    const value = Math.min(MAX, Math.max(MIN, factor)), levels = this.load();
    if ((levels.get(key) ?? 1) === value) return false;
    levels.delete(key);
    if (value !== 1) levels.set(key, value);
    while (levels.size > MAX_ENTRIES) levels.delete(levels.keys().next().value!);
    if (this.file) {
      try { this.io.write(this.file, JSON.stringify({ version: 1, levels: Object.fromEntries(levels) })); }
      catch { /* the level still applies for this run */ }
    }
    return true;
  }
}

// ── Right-click menu ─────────────────────────────────────────────────────────────────────────────

/** The parts of Electron's ContextMenuParams the menu reads. */
export interface BrowserMenuParams {
  mediaType: string;
  srcURL: string;
  hasImageContents?: boolean;
  isEditable: boolean;
  selectionText: string;
  editFlags: { canUndo: boolean; canRedo: boolean; canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}
export type BrowserMenuAction = "openImage" | "copyImage" | "saveImage" | "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";
export type BrowserMenuItem = { action: BrowserMenuAction; label: string; enabled: boolean } | { separator: true };

type Lang = "zh" | "hant" | "tw" | "en";
const lang = (locale: string | undefined): Lang => locale === "zh-Hant-CN" ? "hant" : isTraditionalLocale(locale) ? "tw" : locale?.startsWith("zh") ? "zh" : "en";
const LABELS: Record<Lang, Record<BrowserMenuAction, string>> = {
  zh: { openImage: "在新标签页中打开图片", copyImage: "复制图片", saveImage: "图片另存为…", undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选" },
  hant: { openImage: "在新標籤頁中打開圖片", copyImage: "複製圖片", saveImage: "圖片另存爲…", undo: "撤銷", redo: "重做", cut: "剪切", copy: "複製", paste: "粘貼", selectAll: "全選" },
  tw: { openImage: "在新分頁中開啟圖片", copyImage: "複製圖片", saveImage: "另存圖片…", undo: "復原", redo: "重做", cut: "剪下", copy: "複製", paste: "貼上", selectAll: "全選" },
  en: { openImage: "Open image in new tab", copyImage: "Copy image", saveImage: "Save image as…", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all" },
};

/** An image address a new app tab can open (the tab's own admission decides whether it may). */
export function browserOpenableImage(src: string): boolean {
  try { const url = new URL(src); return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password; }
  catch { return false; }
}
/** An image the save dialog can fetch: a web address, or the page's own data: / blob: image. */
function savableImage(src: string): boolean {
  return browserOpenableImage(src) || /^(?:data:image\/|blob:https?:)/i.test(src);
}

/**
 * The menu for one right-click in a guest page: image actions on an image, edit actions in a text field, copy on
 * a selection. Empty: no menu (nothing useful there — like Chrome's page menu without back / reload, which the
 * tab's own bar has).
 */
export function browserGuestMenu(params: BrowserMenuParams, locale: string | undefined): BrowserMenuItem[] {
  const l = LABELS[lang(locale)], items: BrowserMenuItem[] = [];
  const item = (action: BrowserMenuAction, enabled = true) => items.push({ action, label: l[action], enabled });
  if (params.mediaType === "image") {
    if (browserOpenableImage(params.srcURL)) item("openImage");
    item("copyImage", params.hasImageContents !== false);
    if (savableImage(params.srcURL)) item("saveImage");
  }
  const edit: BrowserMenuItem[] = [];
  if (params.isEditable) {
    const flags = params.editFlags;
    edit.push({ action: "undo", label: l.undo, enabled: flags.canUndo }, { action: "redo", label: l.redo, enabled: flags.canRedo }, { separator: true },
      { action: "cut", label: l.cut, enabled: flags.canCut }, { action: "copy", label: l.copy, enabled: flags.canCopy },
      { action: "paste", label: l.paste, enabled: flags.canPaste }, { action: "selectAll", label: l.selectAll, enabled: flags.canSelectAll });
  } else if (params.selectionText.trim()) {
    edit.push({ action: "copy", label: l.copy, enabled: true });
  }
  if (items.length && edit.length) items.push({ separator: true });
  return [...items, ...edit];
}
