// 性能记录 (#27, docs/design/018-perf-log.md): one entry whenever the UI stalls for more than 100 ms — when,
// what was on screen, the owner's last action and the costliest code — kept on this device in a bounded ring
// (IndexedDB, the newest 500 entries, each ≤ 10 KB → ≤ 5 MB), never sent anywhere.
//
// Cost while nothing stalls: the browser's own observer (`long-animation-frame`, else `longtask`) calls back
// only for frames / tasks over 50 ms, and two passive capture listeners keep the last pointer / key action (a
// few field writes per event). Nothing runs per frame; the screen is read only when an entry is written.
// Frames of one stall (each over the threshold, < 1 s apart) merge into one entry.
import { useSyncExternalStore } from "react";
import { isElement } from "../../lib/ownerWindow";

export const STALL_MS = 100;
export const MAX_ENTRIES = 500;
/** Per entry (the JSON length); 500 × 10 KB = the 5 MB budget. */
export const MAX_ENTRY_BYTES = 10_000;
/** Frames over STALL_MS closer than this to the previous one belong to the same stall. */
export const MERGE_GAP_MS = 1000;
const TOP_SCRIPTS = 5;

export interface PerfScript {
  /** What ran: the invoker (`HTMLButtonElement.onclick`, `Window.requestAnimationFrame`, `Promise.then`, …) and the function. */
  what: string;
  /** Where: file name and character position (a production bundle is minified: map it with that build's source map). */
  src: string | null;
  ms: number;
  /** Of that, forced style / layout (a layout read after a write). */
  layoutMs: number;
}

export interface PerfAction {
  type: string;
  /** The element: its label (aria-label / title / short text), else its tag and data attributes. Never typed text. */
  target: string;
  /** Before the stall started. */
  agoMs: number;
}

export interface PerfScreen {
  /** The main view: conversation, a page id, settings … */
  view: string;
  /** Conversations on screen (names). */
  agents: string[];
  workspaces: number;
  /** Tool panes on screen, by kind. */
  tools: string[];
  desktop: boolean;
  /** Turns / rows of the focused conversation's timeline. */
  turns: number | null;
  rows: number | null;
  dom: number;
  window: string;
  hidden: boolean;
  material: string | null;
}

export interface PerfEntry {
  id?: number;
  /** Start of the stall (epoch ms). */
  at: number;
  /** The longest frame / task (ms). */
  ms: number;
  /** Frames / tasks merged into this stall, and their sum. */
  frames: number;
  totalMs: number;
  /** Style + layout of those frames (render phase and forced in scripts). */
  layoutMs: number;
  source: "frame" | "task";
  scripts: PerfScript[];
  action: PerfAction | null;
  screen: PerfScreen | null;
}

// ---------- the ring (IndexedDB) ----------

const DB = "cutex-desktop-perf-log";
const STORE = "entries";

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => ((tx.oncomplete = () => resolve()), (tx.onerror = () => reject(tx.error)), (tx.onabort = () => reject(tx.error))));

/** An entry within the per-entry budget: scripts dropped from the end, then long strings cut. */
export function fitEntry(entry: PerfEntry): PerfEntry {
  let e = entry;
  while (JSON.stringify(e).length > MAX_ENTRY_BYTES && e.scripts.length > 1) e = { ...e, scripts: e.scripts.slice(0, -1) };
  if (JSON.stringify(e).length > MAX_ENTRY_BYTES) {
    const cut = (s: string) => (s.length > 200 ? `${s.slice(0, 199)}…` : s);
    e = { ...e, scripts: e.scripts.map((s) => ({ ...s, what: cut(s.what), src: s.src && cut(s.src) })), action: e.action && { ...e.action, target: cut(e.action.target) }, screen: e.screen && { ...e.screen, agents: e.screen.agents.slice(0, 8).map(cut), tools: e.screen.tools.slice(0, 16) } };
  }
  return e;
}

async function append(entries: PerfEntry[]): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const e of entries) store.add(fitEntry(e));
  // Keep the newest MAX_ENTRIES.
  const count = store.count();
  count.onsuccess = () => {
    let extra = count.result - MAX_ENTRIES;
    if (extra <= 0) return;
    store.openCursor().onsuccess = (ev) => {
      const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor || extra-- <= 0) return;
      cursor.delete();
      cursor.continue();
    };
  };
  await done(tx);
}

/** Every stored entry, oldest first (the one still being merged included). */
export async function readEntries(): Promise<PerfEntry[]> {
  const d = await db();
  const tx = d.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).getAll();
  await done(tx);
  return [...(req.result as PerfEntry[]), ...unwrittenEntries()];
}

export async function clearEntries(): Promise<void> {
  queue = [];
  open = null;
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await done(tx);
  bump();
}

// ---------- on / off (this device; default on) ----------

const ENABLED_KEY = "cutex-desktop.perfLog";
export function perfLogEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}
export function setPerfLogEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {}
  if (on) startPerfLog();
  else stopPerfLog();
  bump();
}

// ---------- change notifications (the settings view) ----------

let rev = 0;
const listeners = new Set<() => void>();
function bump(): void {
  rev++;
  for (const l of listeners) l();
}
/** A number that moves when entries were written or cleared, or the switch changed. */
export function usePerfLogRev(): number {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => rev,
  );
}

// ---------- the last action ----------

let last: { type: string; el: Element | null; key: string | null; at: number } | null = null;

const onAction = (e: Event) => {
  const key = e.type === "keydown" ? keyName(e as KeyboardEvent) : null;
  last = { type: e.type, el: isElement(e.target) ? e.target : null, key, at: performance.now() };
};

/** A key, without what was typed: printable keys without Ctrl / Alt / Meta are "typing". */
export function keyName(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">): string {
  const mods = `${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.metaKey ? "Meta+" : ""}`;
  if (e.key.length === 1 && !mods) return "typing";
  return `${mods}${e.shiftKey && e.key.length > 1 ? "Shift+" : ""}${e.key.length === 1 ? e.key.toUpperCase() : e.key}`;
}

/** What an element is, in a few words: its label, else a short text (buttons, tabs, rows), else tag + data attributes. */
export function describeTarget(el: Element | null): string {
  if (!el) return "";
  // Typing in a field: say which field, never its value.
  const field = el.closest("textarea, input, [contenteditable='true'], .xterm");
  if (field) {
    const label = field.getAttribute("aria-label") ?? field.getAttribute("placeholder") ?? "";
    return `${field.classList.contains("xterm") ? "terminal" : field.tagName.toLowerCase()}${label ? ` 「${label.slice(0, 40)}」` : ""}`;
  }
  const control = el.closest("button, a, [role='button'], [role='tab'], [role='menuitem'], [role='option'], [data-row-selectable], summary, label");
  const hit = control ?? el;
  // A control's short text names it; any other element's text is just content.
  const label = hit.getAttribute("aria-label") ?? hit.getAttribute("title") ?? (control ? (control.textContent ?? "").replace(/\s+/g, " ").trim() : "");
  const data = [...hit.attributes]
    .filter((a) => a.name.startsWith("data-") && a.value.length < 40)
    .slice(0, 3)
    .map((a) => (a.value ? `${a.name}=${a.value}` : a.name));
  const tag = `${hit.tagName.toLowerCase()}${data.length ? `[${data.join(" ")}]` : ""}`;
  return label ? `${tag} 「${label.slice(0, 60)}」` : tag;
}

function actionBefore(start: number): PerfAction | null {
  if (!last) return null;
  return { type: last.key ? `${last.type} ${last.key}` : last.type, target: describeTarget(last.el), agoMs: Math.max(0, Math.round(start - last.at)) };
}

// ---------- the screen ----------

/** Reads what is on screen (registered by the module: the shell's stores). */
export type ScreenReader = () => Omit<PerfScreen, "dom" | "window" | "hidden" | "material">;
let readScreen: ScreenReader | null = null;
export function setScreenReader(reader: ScreenReader | null): void {
  readScreen = reader;
}

function screen(): PerfScreen | null {
  try {
    const base = readScreen?.() ?? { view: "", agents: [], workspaces: 0, tools: [], desktop: false, turns: null, rows: null };
    return {
      ...base,
      dom: document.getElementsByTagName("*").length,
      window: `${window.innerWidth}×${window.innerHeight}`,
      hidden: document.hidden,
      material: document.documentElement.dataset.cardMaterial ?? null,
    };
  } catch {
    return null;
  }
}

// ---------- the observer ----------

interface LoafScript {
  invoker?: string;
  invokerType?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
  sourceCharPosition?: number;
  duration: number;
  forcedStyleAndLayoutDuration?: number;
}
interface LoafEntry extends PerformanceEntry {
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: LoafScript[];
}

export function scriptsOf(entry: LoafEntry): PerfScript[] {
  return (entry.scripts ?? [])
    .map((s) => {
      const fn = s.sourceFunctionName ? ` ${s.sourceFunctionName}` : "";
      const file = s.sourceURL ? s.sourceURL.replace(/[?#].*$/, "").split("/").pop() || s.sourceURL : "";
      return {
        what: `${s.invoker || s.invokerType || "script"}${fn && !String(s.invoker).endsWith(fn.trim()) ? fn : ""}`,
        src: file ? `${file}${typeof s.sourceCharPosition === "number" && s.sourceCharPosition >= 0 ? `:${s.sourceCharPosition}` : ""}` : null,
        ms: Math.round(s.duration),
        layoutMs: Math.round(s.forcedStyleAndLayoutDuration ?? 0),
      };
    })
    .sort((a, b) => b.ms - a.ms);
}

/** Style + layout of a long animation frame: forced in scripts, plus the rendering phase's own. */
function layoutOf(entry: LoafEntry): number {
  const forced = (entry.scripts ?? []).reduce((a, s) => a + (s.forcedStyleAndLayoutDuration ?? 0), 0);
  const render = entry.styleAndLayoutStart ? Math.max(0, entry.startTime + entry.duration - entry.styleAndLayoutStart) : 0;
  return Math.round(forced + render);
}

/** Merge script lists of one stall: the same code adds up. */
export function mergeScripts(a: PerfScript[], b: PerfScript[]): PerfScript[] {
  const by = new Map<string, PerfScript>();
  for (const s of [...a, ...b]) {
    const k = `${s.what}\n${s.src}`;
    const had = by.get(k);
    by.set(k, had ? { ...had, ms: had.ms + s.ms, layoutMs: had.layoutMs + s.layoutMs } : s);
  }
  return [...by.values()].sort((x, y) => y.ms - x.ms).slice(0, TOP_SCRIPTS);
}

/** The stall being merged (written once no frame joined it for MERGE_GAP_MS), and entries waiting for the write. */
let open: (PerfEntry & { end: number }) | null = null;
let queue: PerfEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (open && performance.now() - open.end >= MERGE_GAP_MS) {
      const { end: _end, ...entry } = open;
      queue.push(entry);
      open = null;
    }
    if (open) return scheduleFlush();
    const batch = queue;
    queue = [];
    if (batch.length) void append(batch).then(bump, () => {});
  }, MERGE_GAP_MS);
}

/** One long frame / task (exported for tests). */
export function noteStall(entry: LoafEntry, source: PerfEntry["source"]): void {
  if (entry.duration <= STALL_MS) return;
  const start = entry.startTime;
  const end = start + entry.duration;
  const scripts = scriptsOf(entry).slice(0, TOP_SCRIPTS);
  const layoutMs = layoutOf(entry);
  if (open && start - open.end < MERGE_GAP_MS) {
    open = { ...open, ms: Math.max(open.ms, Math.round(entry.duration)), frames: open.frames + 1, totalMs: open.totalMs + Math.round(entry.duration), layoutMs: open.layoutMs + layoutMs, scripts: mergeScripts(open.scripts, scripts), end };
  } else {
    if (open) {
      const { end: _end, ...prev } = open;
      queue.push(prev);
    }
    open = { at: Math.round(performance.timeOrigin + start), ms: Math.round(entry.duration), frames: 1, totalMs: Math.round(entry.duration), layoutMs, source, scripts, action: actionBefore(start), screen: screen(), end };
  }
  bump();
  scheduleFlush();
}

/** Entries not written yet: the stall being merged last (tests; readEntries adds them to the stored ones). */
export function unwrittenEntries(): PerfEntry[] {
  return [...queue, ...(open ? [(({ end: _end, ...e }) => e)(open)] : [])];
}

let observer: PerformanceObserver | null = null;

export function startPerfLog(): void {
  if (observer || typeof PerformanceObserver === "undefined" || typeof indexedDB === "undefined" || !perfLogEnabled()) return;
  const types = PerformanceObserver.supportedEntryTypes ?? [];
  const type = types.includes("long-animation-frame") ? "long-animation-frame" : types.includes("longtask") ? "longtask" : null;
  if (!type) return;
  observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) noteStall(e as LoafEntry, type === "long-animation-frame" ? "frame" : "task");
  });
  observer.observe({ type, buffered: false });
  for (const t of ["pointerdown", "keydown", "wheel"]) window.addEventListener(t, onAction, { capture: true, passive: true });
}

export function stopPerfLog(): void {
  observer?.disconnect();
  observer = null;
  for (const t of ["pointerdown", "keydown", "wheel"]) window.removeEventListener(t, onAction, { capture: true });
}
