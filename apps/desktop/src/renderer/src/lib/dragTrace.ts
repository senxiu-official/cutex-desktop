// The width-drag trace (delegation d17283, owner 2026-10-23: 「ABC 我拉 AB，C 变了，不过还是很难稳定复现」): a drag that
// changes a panel it does not touch is rare and hard to reproduce, so the window can record its drags. Off by default:
//   on:  localStorage.setItem("cutex-desktop.dragTrace", "1"), then reload (DevTools console, Ctrl+Shift+I)
//   off: localStorage.removeItem("cutex-desktop.dragTrace"), then reload
// While on, each width drag (lib/columnGlide onResizeDrag: an edge, a key step) records the row's panels — the
// sidebar, the conversation columns, the Shelves and their rails, the Settings Shelf: left / right edges in px — as
// it began, every frame while it goes on, at the release and once settled (SETTLE_MS), with the widths the stores
// hold (lib/appearance, lib/rowDrag, the pane layout's shares, the Shelves). The last KEEP drags stay in memory:
// `copy(__cutexDragTrace())` in DevTools puts them on the clipboard. A drag where more than the two panels beside the
// edge changed width, or an edge moved after the release (`dragSuspects`, the fuzz's own rule), is also written to
// the desktop's error log (Settings → 通用 → the logs folder, errors.jsonl, `"source":"drag-trace"`) — the owner can
// send that file. Nothing is recorded or measured while it is off.
// Multi-window P3.5: a drag is traced in its own window (the active one when it starts): that window's panels, frame
// clock and stores.
import { bridge } from "../bridge";
import { appWindowOfKey } from "./appWindowSet";
import { currentWindow, inWindow, type WindowKey } from "./windowScope";
import { getAppearance } from "./appearance";
import { onResizeDrag } from "./columnGlide";
import { usePanes } from "./paneStore";
import { useRowDrag } from "./rowDrag";
import { shelvesOf } from "./sideLayout";
import { useSide } from "./sideLayoutStore";

export const DRAG_TRACE_KEY = "cutex-desktop.dragTrace";
/** How many drags stay in memory. */
const KEEP = 20;
/** The release's settling: the row has laid itself out by then (glides included). */
const SETTLE_MS = 700;
/** At most this many suspects go to the error log per window. */
const LOG_MAX = 10;

/** One panel of the row on screen: what it is (and its id when it has one), its left / right edges (px). */
export interface TracePanel {
  tag: string;
  l: number;
  r: number;
}

export interface TraceFrame {
  /** ms since the drag began. */
  t: number;
  phase: "start" | "move" | "release" | "settled";
  panels: TracePanel[];
}

export interface DragTrace {
  at: string;
  frames: TraceFrame[];
  stores: { start: unknown; settled: unknown };
  suspects: string[];
}

/**
 * What a drag changed beyond the edge (pure; the same rule as the fuzz, scripts/edge-drag-fuzz.mjs): in any frame more
 * than two panels changed width, or two that are not beside each other (only collapsed rails, which slide, between
 * them); or any edge moved between the last frame of the drag and the settled row (the release did not keep it).
 */
export function dragSuspects(frames: readonly TraceFrame[]): string[] {
  const start = frames.find((f) => f.phase === "start");
  if (!start) return [];
  const out: string[] = [];
  const width = (p: TracePanel) => p.r - p.l;
  for (const f of frames) {
    if (f.phase === "start" || f.panels.length !== start.panels.length) continue;
    const changed = f.panels.map((_, i) => i).filter((i) => Math.abs(width(f.panels[i]!) - width(start.panels[i]!)) > 0.5);
    const beside = (a: number, b: number) => {
      const [x, y] = f.panels[a]!.l <= f.panels[b]!.l ? [f.panels[a]!, f.panels[b]!] : [f.panels[b]!, f.panels[a]!];
      const mid = f.panels.filter((p) => p.l >= x.r - 1 && p.r <= y.l + 1).sort((p, q) => p.l - q.l);
      if (mid.some((p) => !p.tag.startsWith("rail"))) return false;
      let at = x.r;
      for (const p of [...mid, y]) {
        if (Math.abs(p.l - at) > 10) return false;
        at = p.r;
      }
      return true;
    };
    if (changed.length > 2 || (changed.length === 2 && !beside(changed[0]!, changed[1]!)))
      out.push(`${f.phase}@${Math.round(f.t)}ms: ${changed.map((i) => `${start.panels[i]!.tag} ${Math.round(width(start.panels[i]!))}→${Math.round(width(f.panels[i]!))}`).join(", ")}`);
  }
  const moves = frames.filter((f) => f.phase === "move");
  const last = moves[moves.length - 1];
  const settled = frames.find((f) => f.phase === "settled");
  if (last && settled && last.panels.length === settled.panels.length)
    settled.panels.forEach((p, i) => {
      const q = last.panels[i]!;
      if (Math.abs(p.l - q.l) > 0.5 || Math.abs(p.r - q.r) > 0.5) out.push(`release moved ${p.tag}: ${Math.round(q.l)}–${Math.round(q.r)} → ${Math.round(p.l)}–${Math.round(p.r)}`);
    });
  return [...new Set(out)];
}

const PANELS = "aside[data-sidebar-mode], [data-conv-card], section[data-conv-pane], [data-shelf-card], [data-settings-shelf]";

/** The row's panels on screen now in `doc`, left to right (the outermost of nested ones). */
function panelsNow(doc: Document): TracePanel[] {
  const els = [...doc.querySelectorAll<HTMLElement>(PANELS)].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 120 && !e.closest("[hidden]");
  });
  const top = els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
  return top
    .map((e) => {
      const r = e.getBoundingClientRect();
      const id = e.closest<HTMLElement>("[data-conv-pane]")?.dataset.convPane ?? e.closest<HTMLElement>("[data-ws-shelf-box]")?.dataset.wsShelfBox ?? e.closest<HTMLElement>("[data-shelf-box]")?.dataset.shelfBox ?? "";
      const kind = e.tagName === "ASIDE" ? "sidebar" : e.matches("[data-conv-card], section[data-conv-pane]") ? "conv" : e.matches("[data-settings-shelf]") ? "settings" : e.hasAttribute("data-shelf-collapsed") ? "rail" : "shelf";
      return { tag: id ? `${kind}:${id}` : kind, l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10 };
    })
    .sort((a, b) => a.l - b.l);
}

/** The widths the stores hold (what the row is laid out from). */
function storesNow(): unknown {
  const a = getAppearance();
  const drag = useRowDrag.getState();
  return {
    sidebarWidth: a.sidebarWidth,
    singleColumnW: a.singleColumnW,
    workspaceWidth: a.workspaceWidth,
    rowDrag: { lead: drag.lead, leadShare: drag.leadShare, colW: drag.colW, push: drag.push },
    cols: usePanes.getState().layout.cols.map((c) => c.w),
    shelves: shelvesOf(useSide.getState().layout).map((s) => ({ id: s.id, side: s.side, width: s.width ?? null, collapsed: !!s.collapsed })),
    live: useSide.getState().liveWidth,
  };
}

const traces: DragTrace[] = [];
let logged = 0;

/** Whether the trace is switched on (localStorage, read when the window starts). */
export function dragTraceOn(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DRAG_TRACE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Records every width drag while the flag is on (App starts it; returns the stop). Nothing at all while it is off. */
export function startDragTrace(): () => void {
  if (!dragTraceOn() || typeof window === "undefined") return () => {};
  let now: { t0: number; frames: TraceFrame[]; stores: unknown; raf: number; win: Window; key: WindowKey } | null = null;
  const frame = (phase: TraceFrame["phase"]) => now?.frames.push({ t: performance.now() - now.t0, phase, panels: panelsNow(now.win.document) });
  const tick = () => {
    if (!now) return;
    frame("move");
    now.raf = now.win.requestAnimationFrame(tick);
  };
  const off = onResizeDrag((active) => {
    if (active) {
      const key = currentWindow();
      const win = appWindowOfKey(key) ?? window;
      now = { t0: performance.now(), frames: [], stores: storesNow(), raf: 0, win, key };
      frame("start");
      now.raf = win.requestAnimationFrame(tick);
      return;
    }
    const d = now;
    if (!d) return;
    d.win.cancelAnimationFrame(d.raf);
    frame("release");
    now = null;
    setTimeout(() => {
      d.frames.push({ t: performance.now() - d.t0, phase: "settled", panels: panelsNow(d.win.document) });
      const trace: DragTrace = { at: new Date().toISOString(), frames: d.frames, stores: { start: d.stores, settled: inWindow(d.key, storesNow) }, suspects: dragSuspects(d.frames) };
      traces.push(trace);
      if (traces.length > KEEP) traces.shift();
      if (!trace.suspects.length) return;
      console.warn("[drag-trace] a panel the edge does not touch changed:", trace.suspects, trace);
      if (logged++ >= LOG_MAX) return;
      // The start, the last frame of the drag, the release and the settled row (the whole trace stays in memory).
      const moves = d.frames.filter((f) => f.phase === "move");
      const brief = d.frames.filter((f) => f.phase !== "move").concat(moves.length ? [moves[moves.length - 1]!] : []);
      void bridge.shell?.logError({ kind: "reported", message: JSON.stringify({ source: "drag-trace", at: trace.at, suspects: trace.suspects, frames: brief, stores: trace.stores }) });
    }, SETTLE_MS);
  });
  (window as unknown as { __cutexDragTrace: () => string }).__cutexDragTrace = () => JSON.stringify(traces, null, 1);
  console.info("[drag-trace] on: every width drag is recorded; copy(__cutexDragTrace()) for the last ones");
  return () => {
    off();
    if (now) now.win.cancelAnimationFrame(now.raf);
    now = null;
  };
}
