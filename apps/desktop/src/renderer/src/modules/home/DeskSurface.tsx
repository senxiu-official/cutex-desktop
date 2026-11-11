// The desktop surface (design 030 v2 + 032; contract 1.24 the unit grid, deskCells): every `desktop.widget`
// instance on whole units (40 px, 16 px apart; 1.23's 96 px cells are 2 × 2 units), the grid centred in the width. Owner instances come from
// `HomeDoc.desk.items`, module instances from their kind (`useInstances`, e.g. the pins). A band's boxes: its own
// (stored units), else derived from the nearest stored unit band (anchored edges), else the 1.23 cell band doubled,
// else migrated from the 1.22 px band (the backup in `desk.bands`), else the default layout. Arranging (编辑主页, a long press, the desktop's
// 整理桌面): a dot grid shows (a dot where four units meet); drag to a unit, the drop rule among widgets (swap / nearest free), the corner to resize
// by whole units within the kind's limits, arrows (one unit / Shift four; Ctrl/⌘ resizes), Delete, Ctrl/⌘+Z, Esc.
// Every change is one write of the band (and the icons' sizes for older desktops) through the home store
// (revision-checked, 409 retried). While it shows it is also the drop target of a tray avatar's drag (deskDrop): the
// avatar becomes an icon where it is dropped.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Copy, LayoutGrid, Pencil, Plus, RotateCcw, Settings2, Trash2, X } from "lucide-react";
import { create } from "zustand";
import { useI18n, type MessageKey } from "../../i18n";
import { contextMenu, openMenuAt, type MenuEntry } from "../../lib/contextMenu";
import { panelSettingsItem } from "../../lib/panelSettings";
import { showShelfToast } from "../../lib/shelves";
import { useApp } from "../../store";
import { services } from "../app";
import { useSlot } from "../react";
import { ItemBoundary } from "../Outlet";
import type { AppSlotEntry } from "../slots";
import { defaultStepsOf, unitSizesOf, unitsOfSteps, WIDGET_STEP, type DesktopWidgetItem, type WidgetActions, type WidgetInstanceRef, type WidgetSettings, type WidgetSource, type WidgetSteps, type WidgetUnits } from "../widgetTypes";
import type { HomeDoc, HomePin, HomeTileSize } from "../../../../shared/home";
import { currentDesk, mirrorBlocks, settingsOf, withUnitBand, withDesk, withItem, withoutItem, withSettings, type DeskDoc } from "./desk";
import { bandOf, type BandKey, type Box } from "./deskLayout";
import { anchoredCells, clampSize, colsFor, defaultCells, deriveCells, firstFree, migratePxBand, PITCH, place, reflowCells, spanPx, spansOf, toPx, unitsOfCellBand, visibleCols, type CellMoved, type Cells } from "./deskCells";
import { useDeskCover } from "./deskCover";
import { setDeskDropTarget, useDeskDropHint, withIconOnDesk, type DeskSpot } from "./deskDrop";
import { useColorScheme, useReducedMotion, useTicker } from "./deskEnv";
import { useHomeSource } from "./hooks";
import { isOnDesk, pinId, sizeOf as pinSizeOf, withDeskIconSize, withoutDeskIcon } from "./model";
import { openFailedText, openPin } from "./open";
import { setHomeEditing, useHomeEdit } from "./store";
import { pickerMenu } from "./Tiles";
import { setTileHost, tileInstanceId, tileSizeFor, TILE_UNITS, TILE_WIDGET } from "./widgets";
import { WidgetSettingsForm } from "./WidgetSettingsForm";
import { DROP_TINT } from "../../lib/dropTint";
import { isElement } from "../../lib/ownerWindow";
import { useOwnerWindow } from "../../lib/ownerContext";

const LONG_PRESS_MS = 400;
const SLOP = 8;
const mapAt = <A, B>(at: Readonly<Record<string, A>>, f: (a: A) => B): Record<string, B> => Object.fromEntries(Object.entries(at).map(([k, v]) => [k, f(v)]));

type Kind = AppSlotEntry<"desktop.widget">;
export interface Instance {
  id: string;
  kind: Kind;
  settings: WidgetSettings;
  source: WidgetSource;
  title: string;
  steps: WidgetSteps;
  /** Its initial size in grid units (1.24; 1.23 cells doubled, 1.22 steps mapped). */
  units: WidgetUnits;
  owner: boolean;
}

/** The surface's selection, the widget whose settings pop-over is open, and its undo / reset (the 编辑主页 bar and panel use them). */
export const useDeskUi = create<{ sel: string | null; settings: string | null; canUndo: boolean; undo: (() => void) | null; reset: (() => void) | null }>(() => ({ sel: null, settings: null, canUndo: false, undo: null, reset: null }));
export const selectWidget = (sel: string | null) => useDeskUi.setState({ sel });
/**
 * A widget's settings (owner 2026-10-24): a small pop-over beside the widget, not the 编辑主页 panel's whole column.
 * Arranges the desktop (so the widget is selected) without opening the panel.
 */
export function openWidgetSettings(id: string | null): void {
  if (id && !useHomeEdit.getState().editing) setHomeEditing(true, false);
  useDeskUi.setState(id ? { sel: id, settings: id } : { settings: null });
}

/** The pop-over's width and the room between it and its widget. */
const POP_W = 360;
const POP_GAP = 12;
/** While arranging, the widgets move down from under the arranging bar (its height and a little room). */
const ARRANGE_TOP = 44;

function useKinds(): readonly Kind[] {
  const all = useSlot("desktop.widget");
  return useMemo(() => all.filter((e) => e.mode === "show"), [all]);
}

/** A module kind's instances, reported up (hooks per kind, in their own component). */
function ModuleSource({ kind, onChange }: { kind: Kind; onChange(kind: string, list: readonly WidgetInstanceRef[]): void }) {
  const list = kind.item.useInstances!();
  useEffect(() => onChange(kind.item.id, list), [kind.item.id, list, onChange]);
  return null;
}

/** Where the desktop's instances are and what they are (`kinds` → the instances the desk shows, in order). */
export function deskInstances(kinds: readonly Kind[], desk: DeskDoc, mods: Readonly<Record<string, readonly WidgetInstanceRef[]>>, locale: string): Instance[] {
  const byId = new Map<string, Kind>(kinds.map((k) => [k.item.id, k]));
  const out: Instance[] = [];
  for (const it of desk.items) {
    const kind = byId.get(it.kind);
    if (!kind || kind.item.instances === "module") continue;
    out.push({ id: it.id, kind, settings: settingsOf(kind.item, it.settings, locale), source: kind.item.source ?? { kind: "module" }, title: it.id, steps: defaultStepsOf(kind.item.size), units: unitSizesOf(kind.item.size).default, owner: true });
  }
  for (const kind of kinds) {
    if (kind.item.instances !== "module" || (desk.off ?? []).includes(kind.item.id)) continue;
    for (const ref of mods[kind.item.id] ?? []) out.push({ id: ref.id, kind, settings: settingsOf(kind.item, undefined, locale), source: ref.source ?? kind.item.source ?? { kind: "module" }, title: ref.title ?? ref.id, steps: ref.size ?? defaultStepsOf(kind.item.size), units: ref.units ?? (ref.cells ? [ref.cells[0] * 2, ref.cells[1] * 2] : ref.size ? unitsOfSteps(ref.size) : unitSizesOf(kind.item.size).default), owner: false });
  }
  return out;
}

/** How a band's boxes came about: stored, derived from another stored band, migrated from 1.22 px, or the default. */
export type DeskHow = "own" | "derived" | "migrated" | "default";

/**
 * The boxes of the band at `width` on the cell grid: its own stored cells, else derived from the nearest stored
 * cell band, else migrated from the 1.22 px band (its own, else the nearest by width), else the default layout.
 * `cells` in cells, `at` the same in px (the grid's own coordinates: `cols` cells = `spanPx(cols)` px wide).
 */
export function deskLayoutFor(desk: DeskDoc, instances: readonly Instance[], width: number): { at: Record<string, Box>; cells: Record<string, Cells>; cols: number; band: BandKey; how: DeskHow } {
  const band = bandOf(width);
  const cols = colsFor(width);
  const ids = instances.map((i) => i.id);
  const by = new Map(instances.map((i) => [i.id, i]));
  const sizeOf = (id: string) => {
    const i = by.get(id)!;
    return { w: i.units[0], h: i.units[1], minW: unitSizesOf(i.kind.item.size).min[0], ratio: i.kind.item.size.ratio };
  };
  const out = (cells: Record<string, Cells>, how: DeskHow) => ({ at: mapAt(cells, toPx), cells, cols, band, how });
  type GridBand = NonNullable<NonNullable<DeskDoc["units"]>[BandKey]>;
  const nearest = (bands: DeskDoc["units"]) => (Object.values(bands ?? {}) as GridBand[]).sort((a, b) => Math.abs(a.cols - cols) - Math.abs(b.cols - cols))[0];
  const own = desk.units?.[band];
  if (own) return out(deriveCells(own, cols, ids, sizeOf), "own");
  const stored = nearest(desk.units);
  if (stored) return out(deriveCells(stored, cols, ids, sizeOf), "derived");
  // 1.23 (96 px cells): exactly two units each way.
  const big = desk.cells?.[band] ?? nearest(desk.cells);
  if (big) return out(deriveCells(unitsOfCellBand(big), cols, ids, sizeOf), "migrated");
  const old = desk.bands[band] ?? (Object.values(desk.bands) as NonNullable<DeskDoc["bands"][BandKey]>[]).sort((a, b) => Math.abs(a.width - width) - Math.abs(b.width - width))[0];
  if (old) return out(migratePxBand(old, cols, ids, sizeOf), "migrated");
  const entries = instances.map((i, k) => {
    const place = i.kind.item.defaultPlace ?? { area: "main" as const, order: 1000 };
    return { id: i.id, area: place.area, order: place.order * 1000 + k, w: i.units[0], h: i.units[1] };
  });
  return out(defaultCells(entries, cols), "default");
}

const SHAPE_CLASS: Record<string, string> = { card: "home-glass rounded-card", round: "home-glass rounded-full", path: "home-glass", bare: "" };

/** One click after a drag (in `view`, the drag's window) is not a click on what lies under the pointer. */
function swallowNextClick(view: Window): void {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  view.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => view.removeEventListener("click", stop, { capture: true }), 400);
}

interface Drag {
  id: string;
  mode: "move" | "resize";
  start: { x: number; y: number };
  origin: Cells;
  lifted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
interface Preview {
  id: string;
  /** Where the dragged box follows the pointer (move) or its size in whole cells (resize), in px. */
  raw: Box;
  /** The boxes after the drop, in cells. */
  at: Record<string, Cells>;
  moved: CellMoved[];
}

export function DeskSurface({ children }: { children?: ReactNode }) {
  const win = useOwnerWindow();
  const { t, locale } = useI18n();
  const kinds = useKinds();
  const home = useHomeSource();
  const doc = home.entry?.doc ?? null;
  const update = home.update;
  const arranging = useHomeEdit((s) => s.editing);
  const sel = useDeskUi((s) => s.sel);
  const theme = useColorScheme();
  const reducedMotion = useReducedMotion();
  const kindItems = useMemo(() => kinds.map((k) => k.item), [kinds]);
  const desk = useMemo(() => currentDesk(doc, kindItems), [doc, kindItems]);
  const [mods, setMods] = useState<Record<string, readonly WidgetInstanceRef[]>>({});
  const reportMods = useMemo(() => (kind: string, list: readonly WidgetInstanceRef[]) => setMods((m) => (m[kind] === list ? m : { ...m, [kind]: list })), []);
  const instances = useMemo(() => deskInstances(kinds, desk, mods, locale), [kinds, desk, mods, locale]);
  const area = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new win.ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setTileHost(() => home.hostId), [home.hostId]);
  const layout = useMemo(() => (width > 0 ? deskLayoutFor(desk, instances, width) : null), [desk, instances, width]);
  // A Shelf over part of the desktop (owner 2026-11-10): the widgets are drawn in the columns left free — a view of the
  // saved layout (deskCells reflowCells), never written back, so the desktop is exactly as it was once the room comes
  // back. Arranging draws (and stores) the whole width as before.
  const cover = useDeskCover(area, !arranging);
  const view = useMemo(() => {
    if (!layout || arranging || (cover.left === 0 && cover.right === 0)) return null;
    const free = visibleCols(width, layout.cols, cover);
    if (free.count >= layout.cols) return null;
    const flowed = reflowCells(layout.cells, free.from, free.count);
    // Some can't fit: the first row says how many (seen without scrolling), the widgets one row lower.
    const down = flowed.hidden.length > 0 ? 1 : 0;
    return { at: mapAt(flowed.at, (r) => toPx({ ...r, y: r.y + down })), hidden: flowed.hidden.length, from: free.from };
  }, [layout, arranging, cover, width]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const drag = useRef<Drag | null>(null);
  const undoStack = useRef<string[]>([]);
  const byId = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances]);

  // ── Writes ──────────────────────────────────────────────────────────────────────────────
  const pushUndo = () => {
    undoStack.current.push(JSON.stringify(doc?.desk ?? null));
    if (undoStack.current.length > 40) undoStack.current.shift();
    useDeskUi.setState({ canUndo: true });
  };
  const editDesk = (edit: (d: DeskDoc) => DeskDoc, extra?: (doc: HomeDoc) => HomeDoc) => {
    pushUndo();
    void update((d) => {
      let next = withDesk(d, kindItems, edit);
      next = mirrorBlocks(next, currentDesk(next, kindItems));
      return extra ? extra(next) : next;
    });
  };
  const commit = (at: Record<string, Cells>) => {
    if (!layout || !width) return;
    const { band, cols } = layout;
    // Older desktops show the pins at their nearest preset.
    const sizes: [string, HomeTileSize][] = [];
    for (const [id, r] of Object.entries(at)) {
      const inst = byId.get(id);
      if (inst?.kind.item.id !== TILE_WIDGET) continue;
      const before = layout.cells[id];
      if (before && before.w === r.w && before.h === r.h) continue;
      const p = toPx(r);
      sizes.push([id.slice("pin:".length), tileSizeFor({ w: p.w / WIDGET_STEP, h: p.h / WIDGET_STEP })]);
    }
    editDesk(
      (d) => withUnitBand(d, band, { cols, at: anchoredCells(at, cols) }),
      sizes.length ? (d) => sizes.reduce((acc, [pid, s]) => withDeskIconSize(acc, pid, s), d) : undefined,
    );
  };
  // One settings writer per widget for the life of the desk, calling the latest editDesk: WidgetHost is memo and
  // must not hold an old render's (its undo snapshot reads that render's doc).
  const editLatest = useRef(editDesk);
  useLayoutEffect(() => {
    editLatest.current = editDesk;
  });
  const settingsWriters = useRef(new Map<string, (next: WidgetSettings) => void>());
  const settingsFor = (id: string) => {
    let write = settingsWriters.current.get(id);
    if (!write) settingsWriters.current.set(id, (write = (next) => editLatest.current((d) => withSettings(d, id, next))));
    return write;
  };
  const undo = () => {
    const last = undoStack.current.pop();
    useDeskUi.setState({ canUndo: undoStack.current.length > 0 });
    if (last === undefined) return;
    const prev = JSON.parse(last) as unknown;
    void update((d) => {
      const { desk: _now, ...rest } = d;
      return prev === null ? (rest as HomeDoc) : { ...rest, desk: prev as HomeDoc["desk"] };
    });
  };
  const reset = () => {
    if (!layout) return;
    const fresh = deskLayoutFor({ ...desk, bands: {}, cells: {}, units: {} }, instances, width);
    commit(fresh.cells);
  };
  // Back to the layout as it was before the coarse grid (1.23): this band's units and cells go, so it is migrated again
  // from the kept 1.22 boxes (`desk.bands`). Offered while there is such a backup and this band has been arranged.
  const canRestoreOld = !!layout && layout.how === "own" && Object.keys(desk.bands).length > 0;
  const restoreOld = () => {
    if (!layout) return;
    const band = layout.band;
    editDesk((d) => {
      const { [band]: _c, ...cells } = d.cells ?? {};
      const { [band]: _u, ...units } = d.units ?? {};
      return { ...d, cells, units };
    });
  };
  useEffect(() => {
    useDeskUi.setState({ undo, reset });
  });
  useEffect(() => {
    if (!arranging) {
      undoStack.current = [];
      useDeskUi.setState({ canUndo: false, sel: null, settings: null });
    }
  }, [arranging]);
  // Esc / Ctrl+Z while arranging (not in a field).
  useEffect(() => {
    if (!arranging) return;
    const onKey = (e: KeyboardEvent) => {
      if (isElement(e.target) && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") {
        if (drag.current) return;
        e.preventDefault();
        setHomeEditing(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  });

  // ── Pointer: long press, drag to a cell, the corner ─────────────────────────────────────
  const limits = (inst: Instance) => {
    const c = unitSizesOf(inst.kind.item.size);
    return { min: c.min, max: c.max, ratio: inst.kind.item.size.ratio };
  };
  const sized = (inst: Instance, r: Cells, w: number, h: number): Cells => ({ ...r, ...clampSize(w, h, limits(inst), (layout?.cols ?? 1) - r.x) });
  const begin = (e: ReactPointerEvent, id: string, mode: "move" | "resize") => {
    if (e.button !== 0 || !layout) return;
    if (isElement(e.target) && e.target.closest("input, textarea, select, [contenteditable]")) return;
    const origin = layout.cells[id];
    if (!origin) return;
    const originPx = toPx(origin);
    const d: Drag = { id, mode, start: { x: e.clientX, y: e.clientY }, origin, lifted: false, timer: null };
    drag.current = d;
    const lift = () => {
      d.lifted = true;
      if (!useHomeEdit.getState().editing) setHomeEditing(true, false);
      selectWidget(id);
      setPreview({ id, raw: originPx, at: { ...layout.cells }, moved: [] });
    };
    if (useHomeEdit.getState().editing) {
      e.preventDefault();
      lift();
    } else if (mode === "move") d.timer = setTimeout(lift, LONG_PRESS_MS);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - d.start.x;
      const dy = ev.clientY - d.start.y;
      if (!d.lifted) {
        if (Math.hypot(dx, dy) > SLOP) stop(false);
        return;
      }
      const inst = byId.get(id);
      if (!inst) return;
      const cols = layout.cols;
      if (d.mode === "move") {
        const raw = { ...originPx, x: originPx.x + dx, y: originPx.y + dy };
        const to = { ...origin, x: Math.max(0, Math.min(cols - origin.w, Math.round(raw.x / PITCH))), y: Math.max(0, Math.round(raw.y / PITCH)) };
        const res = place(layout.cells, id, to, cols);
        setPreview({ id, raw, at: res.at, moved: res.moved });
      } else {
        const to = sized(inst, origin, spansOf(originPx.w + dx), spansOf(originPx.h + dy));
        const res = place(layout.cells, id, to, cols);
        setPreview({ id, raw: toPx(to), at: res.at, moved: res.moved });
      }
    };
    const stop = (drop: boolean) => {
      if (d.timer) clearTimeout(d.timer);
      win.removeEventListener("pointermove", move, true);
      win.removeEventListener("pointerup", up, true);
      win.removeEventListener("pointercancel", cancel, true);
      drag.current = null;
      if (d.lifted) swallowNextClick(win);
      setPreview((p) => {
        if (drop && p && d.lifted) {
          const to = p.at[id]!;
          if (to.x !== origin.x || to.y !== origin.y || to.w !== origin.w || to.h !== origin.h) queueMicrotask(() => commit(p.at));
        }
        return null;
      });
    };
    const up = () => stop(true);
    const cancel = () => stop(false);
    win.addEventListener("pointermove", move, true);
    win.addEventListener("pointerup", up, true);
    win.addEventListener("pointercancel", cancel, true);
  };

  // ── Keyboard (arranging): arrows one cell / Shift four, Ctrl/⌘ resize, Delete ─────────────
  const onKey = (e: ReactKeyboardEvent, inst: Instance) => {
    if (!arranging || !layout) return;
    const r0 = layout.cells[inst.id];
    if (!r0) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeInstance(inst);
      return;
    }
    const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (!dir) return;
    e.preventDefault();
    const n = e.shiftKey ? 4 : 1;
    const cols = layout.cols;
    if (e.ctrlKey || e.metaKey) {
      if (inst.kind.item.size.resizable === false) return;
      const to = sized(inst, r0, r0.w + dir[0] + (inst.kind.item.size.ratio ? dir[1] : 0), r0.h + dir[1]);
      if (to.w !== r0.w || to.h !== r0.h) commit(place(layout.cells, inst.id, to, cols).at);
    } else {
      const r = { ...r0, x: Math.max(0, Math.min(cols - r0.w, r0.x + dir[0] * n)), y: Math.max(0, r0.y + dir[1] * n) };
      if (r.x !== r0.x || r.y !== r0.y) commit(place(layout.cells, inst.id, r, cols).at);
    }
  };

  // ── Instances: add / duplicate / remove / settings ──────────────────────────────────────
  const removeInstance = (inst: Instance) => {
    if (inst.owner) editDesk((d) => withoutItem(d, inst.id));
    else inst.kind.item.remove?.(inst.id);
    if (useDeskUi.getState().sel === inst.id) selectWidget(null);
    if (useDeskUi.getState().settings === inst.id) openWidgetSettings(null);
  };
  const addKind = (kind: Kind, settings?: WidgetSettings) => {
    if (!layout) return;
    const size = unitSizesOf(kind.item.size).default;
    pushUndo();
    void update((d) => {
      let id = "";
      let next = withDesk(d, kindItems, (dk) => {
        const r = withItem(dk, kind.item.id, settings);
        id = r.id;
        // Its box: the first free place from the top left, in this band (other bands derive it).
        const at = { ...layout.cells };
        at[id] = firstFree(at, size[0], size[1], layout.cols);
        return withUnitBand(r.desk, layout.band, { cols: layout.cols, at: anchoredCells(at, layout.cols) });
      });
      next = mirrorBlocks(next, currentDesk(next, kindItems));
      queueMicrotask(() => selectWidget(id));
      return next;
    });
  };
  const ownerKinds = kinds.filter((k) => (k.item.instances ?? "owner") === "owner");
  const addable = ownerKinds.filter((k) => k.item.multiple || !desk.items.some((i) => i.kind === k.item.id));
  // 添加图标: the picker puts an icon on the desktop (the tray's pins stay as they are).
  const pin = (anchorX: number, anchorY: number) =>
    void pickerMenu({ isPinned: (p: HomePin) => isOnDesk(doc, p), add: (p: HomePin) => void update((d) => withIconOnDesk(d, p)) }, t).then((items) => openMenuAt(anchorX, anchorY, items));

  // ── A tray avatar dragged over the desk (deskDrop): its box under the pointer, the drop puts the icon there ──
  const spotFor = (p: HomePin, x: number, y: number): DeskSpot | null => {
    const el = grid.current;
    if (!layout || !el) return null;
    // Only where the desk itself is under the pointer (not a pane, the tray, a menu over it).
    const top = win.document.elementsFromPoint(x, y).find((e) => !e.closest("[data-ws-dnd]"));
    if (!top || !area.current?.contains(top)) return null;
    const r = el.getBoundingClientRect();
    const [w, h] = TILE_UNITS[pinSizeOf(p)];
    const cols = layout.cols;
    const ww = Math.min(w, cols);
    const cells = { x: Math.max(0, Math.min(cols - ww, Math.round((x - r.left) / PITCH - ww / 2))), y: Math.max(0, Math.round((y - r.top) / PITCH - h / 2)), w: ww, h };
    return { cells, already: byId.has(tileInstanceId(p)) };
  };
  const dropAt = (p: HomePin, spot: DeskSpot, name: string) => {
    if (!layout) return;
    const id = tileInstanceId(p);
    const { band, cols } = layout;
    const at = place(layout.cells, id, spot.cells, cols).at;
    const hadIcon = isOnDesk(doc, p);
    void update((d) => {
      const next = withDesk(withIconOnDesk(d, p), kindItems, (dk) => withUnitBand(dk, band, { cols, at: anchoredCells(at, cols) }));
      return mirrorBlocks(next, currentDesk(next, kindItems));
    }).then((ok) => {
      if (ok && !hadIcon) showShelfToast(t("home.desk.placed", { name }), () => void update((d) => withoutDeskIcon(d, pinId(p))));
    });
  };
  const dropLatest = useRef({ spotFor, dropAt });
  useLayoutEffect(() => {
    dropLatest.current = { spotFor, dropAt };
  });
  useEffect(
    () =>
      setDeskDropTarget({
        spot: (p, x, y) => dropLatest.current.spotFor(p, x, y),
        drop: (p, spot, name) => dropLatest.current.dropAt(p, spot, name),
      }),
    [],
  );
  const dropHint = useDeskDropHint((s) => s.hint);
  const sourceLine = (inst: Instance): string => {
    const s = inst.source;
    if (s.kind === "service") return t("home.desk.from.service", { name: s.slug });
    if (s.kind === "agent") return t("home.desk.from.agent", { name: inst.title });
    return t("home.desk.from.module", { name: t(inst.kind.item.titleKey) });
  };
  const widgetMenu = (inst: Instance): MenuEntry[] => {
    const presets = unitSizesOf(inst.kind.item.size).presets;
    return [
      { label: sourceLine(inst), note: true, disabled: true, onSelect: () => {} },
      inst.kind.item.settings?.length && {
        label: t("home.desk.settings"),
        icon: <Settings2 size={14} />,
        onSelect: () => openWidgetSettings(inst.id),
      },
      presets && layout?.cells[inst.id] && {
        label: t("home.desk.size"),
        submenu: Object.entries(unitSizesOf(inst.kind.item.size).presets ?? {}).map(([name, [w, h]]) => ({ label: `${name.toUpperCase()} · ${w}×${h}`, onSelect: () => commit(place(layout.cells, inst.id, sized(inst, layout.cells[inst.id]!, w, h), layout.cols).at) })),
        onSelect: () => {},
      },
      inst.owner && inst.kind.item.multiple && { label: t("home.desk.duplicate"), icon: <Copy size={14} />, onSelect: () => addKind(inst.kind, inst.settings) },
      "separator",
      !arranging && { label: t("home.desk.arrange"), icon: <LayoutGrid size={14} />, onSelect: () => setHomeEditing(true, false) },
      // A desktop icon leaves the desktop only (the tray keeps its pin): 从桌面移除, like the owner's widgets.
      { label: t(inst.owner || inst.kind.item.id === TILE_WIDGET ? "home.desk.remove" : "home.desk.unpin"), icon: <Trash2 size={14} />, danger: true, onSelect: () => removeInstance(inst) },
    ];
  };
  deskMenu.build = (x: number, y: number): MenuEntry[] => [
    !arranging && { label: t("home.desk.arrange"), icon: <LayoutGrid size={14} />, onSelect: () => setHomeEditing(true, false) },
    { label: t("home.desk.add"), icon: <Plus size={14} />, submenu: addable.length ? addable.map((k) => ({ label: t(k.item.titleKey), onSelect: () => addKind(k) })) : [{ label: t("home.desk.addNone"), disabled: true, onSelect: () => {} }], onSelect: () => {} },
    { label: t("home.desk.addIcon"), icon: <Plus size={14} />, onSelect: () => pin(x, y) },
    { label: t("home.desk.reset"), icon: <RotateCcw size={14} />, onSelect: reset },
    canRestoreOld && { label: t("home.desk.restoreOld"), icon: <RotateCcw size={14} />, onSelect: restoreOld },
    "separator",
    !arranging && { label: t("home.edit"), icon: <Pencil size={14} />, onSelect: () => setHomeEditing(true) },
    panelSettingsItem("desktop"),
  ];

  const actions: WidgetActions = useMemo(
    () => ({
      openAgent: async (hostId, sessionId) => {
        await useApp.getState().openAgent(sessionId, hostId);
        return true;
      },
      openPage: (page, params) => {
        services.ui.openPage(page, params);
        return true;
      },
      openService: async (hostId, slug) => {
        await openPin({ hostId, kind: "service", key: slug }, openFailedText);
        return true;
      },
      // Reserved (design 032 §3.4): arrives with agent-sourced widgets, behind main's confirm dialog.
      sendToAgent: async () => false,
    }),
    [t],
  );

  const at = preview ? mapAt(preview.at, toPx) : (view?.at ?? layout?.at ?? {});
  const bottom = Math.max(0, ...Object.values(at).map((r) => r.y + r.h));
  const hiddenNote = view && view.hidden > 0 ? { left: view.from * PITCH, top: 0, height: PITCH - 16, lineHeight: `${PITCH - 16}px` } : null;
  const height = Math.max(240, bottom) + (arranging ? 160 : 8);
  const draggedRaw = preview?.raw;
  const gridW = layout ? spanPx(layout.cols) : 0;
  const popId = useDeskUi((s) => s.settings);
  const popInst = popId ? byId.get(popId) : undefined;
  const popBox = popId ? at[popId] : undefined;
  // Beside the widget: on its right when there is room in the grid, else on its left (never off the grid's left edge).
  const popLeft = popBox ? (popBox.x + popBox.w + POP_GAP + POP_W <= gridW ? popBox.x + popBox.w + POP_GAP : Math.max(0, popBox.x - POP_GAP - POP_W)) : 0;
  return (
    <div ref={area} className={`desk-area relative w-full ${arranging ? "desk-arranging" : ""}`} style={{ height, marginTop: arranging ? ARRANGE_TOP : 0 }} data-desk-band={layout?.band} data-desk-how={layout?.how} data-desk-width={width} data-desk-cols={layout?.cols}>
      {/* The unit grid, centred in the width; its dots show while arranging. */}
      <div ref={grid} className="desk-grid absolute top-0 bottom-0" style={{ left: Math.max(0, Math.floor((width - gridW) / 2)), width: gridW }}>
      {arranging && <div className="desk-cells" aria-hidden />}
      {kinds
        .filter((k) => k.item.instances === "module" && k.item.useInstances)
        .map((k) => (
          <ItemBoundary key={k.item.id} moduleId={k.moduleId}>
            <ModuleSource kind={k} onChange={reportMods} />
          </ItemBoundary>
        ))}
      {instances.map((inst) => {
        const r0 = at[inst.id];
        if (!r0) return null;
        const lifted = preview?.id === inst.id;
        const r = lifted && draggedRaw ? draggedRaw : r0;
        const shape = inst.kind.item.shape ?? "card";
        const style: CSSProperties = { left: r.x, top: r.y, width: r.w, height: r.h, ...(shape === "path" && inst.kind.item.clipPath ? { clipPath: inst.kind.item.clipPath } : {}) };
        return (
          <div
            key={inst.id}
            data-desk-widget={inst.id}
            data-desk-kind={inst.kind.item.id}
            data-shape={shape}
            data-desk-selected={arranging && sel === inst.id ? "" : undefined}
            data-desk-lifted={lifted ? "" : undefined}
            tabIndex={arranging ? 0 : -1}
            role={arranging ? "button" : undefined}
            aria-label={arranging ? t("home.desk.itemLabel", { name: t(inst.kind.item.titleKey), w: Math.round(r.w), h: Math.round(r.h), x: Math.round(r.x), y: Math.round(r.y) }) : undefined}
            className={`desk-widget absolute ${SHAPE_CLASS[shape] ?? ""} ${reducedMotion || lifted ? "desk-still" : ""}`}
            style={style}
            onPointerDown={(e) => begin(e, inst.id, "move")}
            onFocus={() => arranging && selectWidget(inst.id)}
            onKeyDown={(e) => onKey(e, inst)}
            onContextMenu={(e) => {
              if (isElement(e.target) && e.target.closest("input, textarea, [contenteditable]")) return;
              contextMenu(() => widgetMenu(inst))(e);
            }}
          >
            <div className="desk-widget-body h-full w-full">
              <ItemBoundary moduleId={inst.kind.moduleId}>
                <WidgetHost inst={inst} r={r} theme={theme} reducedMotion={reducedMotion} arranging={arranging} hostId={home.hostId} actions={actions} onSettings={settingsFor(inst.id)} />
              </ItemBoundary>
            </div>
          </div>
        );
      })}
      {/* Widgets the free columns can't hold (a Shelf covers the rest): how many, in the first row. */}
      {hiddenNote && (
        <p className="home-bare pointer-events-none absolute text-xs whitespace-nowrap" style={hiddenNote} data-desk-hidden={view!.hidden}>
          {t("home.desk.hiddenByShelf", { n: view!.hidden })}
        </p>
      )}
      {arranging && sel && at[sel] && byId.get(sel) && !preview && (
        <>
          {(byId.get(sel)!.kind.item.shape ?? "card") !== "card" && <div className="desk-boxmark" style={{ left: at[sel]!.x, top: at[sel]!.y, width: at[sel]!.w, height: at[sel]!.h }} />}
          {byId.get(sel)!.kind.item.size.resizable !== false && (
            <span
              data-desk-resize={sel}
              title={t("home.desk.resize")}
              className="desk-resize"
              style={{ left: at[sel]!.x + at[sel]!.w - 16, top: at[sel]!.y + at[sel]!.h - 16 }}
              onPointerDown={(e) => {
                e.stopPropagation();
                begin(e, sel, "resize");
              }}
            />
          )}
        </>
      )}
      {dropHint ? (
        <div className={`desk-ghost desk-drop-hint ${DROP_TINT}`} style={box(toPx(dropHint.cells))} data-desk-drop-hint="">
          <span>{dropHint.text}</span>
        </div>
      ) : null}
      {preview?.moved.length ? <div className={`desk-ghost desk-ghost-target ${DROP_TINT}`} style={box(toPx(preview.at[preview.id]!))} data-desk-ghost="target"><span>{preview.moved.some((m) => m.swap) ? t("home.desk.swap") : t("home.desk.makeRoom", { n: preview.moved.length })}</span></div> : null}
      {preview?.moved.map((m) => (
        <div key={m.id} className={`desk-ghost desk-ghost-moved ${DROP_TINT}`} style={box(toPx(m.to))} data-desk-ghost="moved">
          <span>{t(m.swap ? "home.desk.swappedHere" : "home.desk.movedHere", { name: t((byId.get(m.id)?.kind.item.titleKey ?? "home.desk.widget") as MessageKey) })}</span>
        </div>
      ))}
      {popInst && popBox && popInst.owner && popInst.kind.item.settings?.length ? (
        <div className="shell-card desk-pop absolute flex max-h-[70vh] flex-col overflow-hidden" style={{ left: popLeft, top: popBox.y, width: POP_W }} data-home-widget-pop={popInst.kind.item.id} onPointerDown={(e) => e.stopPropagation()}>
          <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/60 pr-1.5 pl-4">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("home.desk.settingsOf", { name: t(popInst.kind.item.titleKey) })}</h3>
            <button onClick={() => openWidgetSettings(null)} title={t("home.desk.back")} aria-label={t("home.desk.back")} className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
              <X size={15} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4 text-ui/[inherit]">
            <p className="mb-2 text-meta/[inherit] text-subtle">{sourceLine(popInst)}</p>
            <WidgetSettingsForm fields={popInst.kind.item.settings} settings={popInst.settings} onChange={settingsFor(popInst.id)} />
          </div>
        </div>
      ) : null}
      </div>
      {children}
    </div>
  );
}

const box = (r: Box): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

/** The desktop background's menu (Desktop.tsx's right-click): built by the mounted surface. */
export const deskMenu: { build: ((x: number, y: number) => MenuEntry[]) | null } = { build: null };

// Memo on what the widget is given (its size, not its place): the desk lays its boxes out again on every step of a
// window resize, and every widget used to render again with it — clocks, stats and tiles recomputing (perf audit
// 2026-10-23 #28). Its own ticker still renders it on its cadence.
const WidgetHost = memo(function WidgetHost({ inst, r, theme, reducedMotion, arranging, hostId, actions, onSettings }: { inst: Instance; r: Box; theme: "light" | "dark"; reducedMotion: boolean; arranging: boolean; hostId: string | null; actions: WidgetActions; onSettings(next: WidgetSettings): void }) {
  const now = useTicker(inst.kind.item.refresh);
  const Widget = inst.kind.item.Widget;
  return (
    <Widget
      instanceId={inst.id}
      width={r.w}
      height={r.h}
      steps={{ w: Math.round(r.w / WIDGET_STEP), h: Math.round(r.h / WIDGET_STEP) }}
      cells={{ w: Math.max(1, Math.round((r.w + 16) / 112)), h: Math.max(1, Math.round((r.h + 16) / 112)) }}
      units={{ w: spansOf(r.w), h: spansOf(r.h) }}
      theme={theme}
      settings={inst.settings}
      setSettings={onSettings}
      reducedMotion={reducedMotion}
      arranging={arranging}
      now={now}
      hostId={hostId}
      source={inst.source}
      actions={actions}
    />
  );
}, (a, b) => a.inst === b.inst && a.r.w === b.r.w && a.r.h === b.r.h && a.theme === b.theme && a.reducedMotion === b.reducedMotion && a.arranging === b.arranging && a.hostId === b.hostId && a.actions === b.actions && a.onSettings === b.onSettings);

/** The selected instance's kind and settings (the 编辑主页 panel's form). */
export function useSelectedWidget(): { inst: Instance | null; save(next: WidgetSettings): void } {
  const { locale } = useI18n();
  const kinds = useKinds();
  const home = useHomeSource();
  const sel = useDeskUi((s) => s.sel);
  const kindItems = useMemo(() => kinds.map((k) => k.item), [kinds]);
  const desk = currentDesk(home.entry?.doc ?? null, kindItems);
  const item = sel ? desk.items.find((i) => i.id === sel) : undefined;
  const kind = item ? kinds.find((k) => k.item.id === item.kind) : undefined;
  const inst = item && kind ? { id: item.id, kind, settings: settingsOf(kind.item, item.settings, locale), source: kind.item.source ?? { kind: "module" as const }, title: item.id, steps: defaultStepsOf(kind.item.size), units: unitSizesOf(kind.item.size).default, owner: true } : null;
  return {
    inst,
    save: (next) => {
      if (!inst) return;
      void home.update((d) => withDesk(d, kindItems, (dk) => withSettings(dk, inst.id, next)));
    },
  };
}

/** The 编辑主页 panel's widget list: every owner kind (on / off; 添加 for a multiple one) and the module kinds (on / off). */
export function useDeskKinds(): { kinds: readonly Kind[]; desk: DeskDoc; toggle(kind: Kind, on: boolean): void; add(kind: Kind): void } {
  const kinds = useKinds();
  const home = useHomeSource();
  const kindItems = useMemo(() => kinds.map((k) => k.item), [kinds]);
  const desk = currentDesk(home.entry?.doc ?? null, kindItems);
  const write = (edit: (d: DeskDoc) => DeskDoc) =>
    void home.update((d) => {
      const next = withDesk(d, kindItems, edit);
      return mirrorBlocks(next, currentDesk(next, kindItems));
    });
  return {
    kinds,
    desk,
    toggle: (kind, on) =>
      write((d) => {
        if (kind.item.instances === "module") return { ...d, off: on ? (d.off ?? []).filter((k) => k !== kind.item.id) : [...new Set([...(d.off ?? []), kind.item.id])] };
        if (on) return d.items.some((i) => i.kind === kind.item.id) ? d : withItem(d, kind.item.id).desk;
        return d.items.filter((i) => i.kind === kind.item.id).reduce((acc, i) => withoutItem(acc, i.id), d);
      }),
    add: (kind) => write((d) => withItem(d, kind.item.id).desk),
  };
}

export type { DesktopWidgetItem };
