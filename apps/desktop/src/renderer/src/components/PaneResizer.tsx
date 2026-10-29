// A pane's draggable edge: the left sidebar's right edge (侧栏宽度) and the right side pane's left
// edge. Drag to resize (pointer capture), double-click to reset, arrow keys when focused (Shift = ×4).
// Widths live in Settings → 外观 (per machine) and are clamped so the conversation keeps room.
// The pane element is the handle's parent (marked `data-resizable-pane`).
// The same handle splits two conversation columns side by side (ColumnSplitter, panes step 2): there
// the left column's share of the pair is stored with the pane layout (lib/paneStore).
import { useRef } from "react";
import { flushSync } from "react-dom";
import { useI18n } from "../i18n";
import { commitLiveWidths, DEFAULT_APPEARANCE, getAppearance, previewWidth, RANGES, setAppearance, useAppearance } from "../lib/appearance";
import { clampPaneWidth } from "../lib/appearanceModel";
import { keyResize, resizeDrag } from "../lib/columnGlide";
import { rowGive } from "../lib/sideResize";
import { sidebarDragMaxNow } from "../lib/workspaces";
import { SETTINGS_SHELF_DEFAULT_W, SETTINGS_SHELF_MIN_W, setSettingsShelfLive, setSettingsShelfWidth, settingsBesideSidebar, useSettingsShelfLive } from "../lib/settingsShelf";
import { hideWidthTip, showWidthTip, widthPct, workRowWidth } from "../lib/widthTip";
import { slotsRelayout } from "../lib/sideSlots";
import { fillWidths } from "../lib/workspaceRow";
import { WS_CONVERSATION_MIN_W } from "../lib/workspaces";
import { useDeskId } from "../lib/deskContext";
import { setDeskSidebarWidth, useDeskSidebarWidth } from "../lib/windowSidebar";

type WidthKey = "sidebarWidth" | "sidePaneWidth";

/** Between two conversation columns: the left one's width and its share of the work row. */
function columnMeasure(handle: HTMLElement): { px: number; pct: number | null } | null {
  const left = handle.parentElement?.previousElementSibling as HTMLElement | null | undefined;
  if (!left) return null;
  const px = left.offsetWidth;
  return { px, pct: widthPct(px, workRowWidth()) };
}

const STEP = 16;

/**
 * Width this pane shares with the conversation: its flex row. The left sidebar's row also holds the
 * right pane, which then gives way on its own (its CSS max-width keeps the conversation's minimum).
 */
function roomFor(pane: HTMLElement | null): number {
  return pane?.parentElement?.clientWidth ?? Number.POSITIVE_INFINITY;
}

interface HandleProps {
  /** Extra data attribute marking the handle (e.g. the column divider). */
  mark?: string;
  label: string;
  title: string;
  min: number;
  max: number;
  value: number;
  className: string;
  /** The width the drag starts from (px). */
  start(handle: HTMLElement): number;
  /** A new width (px): live while dragging (`persist` false), stored on release / keys / reset. */
  change(width: number, handle: HTMLElement, persist: boolean): void;
  /** The drag ended (store what was shown live). */
  commit(): void;
  reset(handle: HTMLElement): void;
  /** +1: dragging right grows the width; -1: dragging left does. */
  sign: 1 | -1;
  /** The width shown in the tip beside the edge (checklist #5): the panel's px, and % for a conversation column. */
  measure(handle: HTMLElement): { px: number; pct: number | null } | null;
}

/** The shared drag / keyboard / double-click behaviour of a resize edge. */
function ResizeHandle({ mark, label, title, min, max, value, className, start, change, commit, reset, sign, measure }: HandleProps) {
  const drag = useRef<{ x: number; width: number; handle: HTMLElement } | null>(null);
  const tip = (handle: HTMLElement, y?: number, keys = false) => {
    const m = measure(handle);
    if (m) showWidthTip(handle, m.px, { pct: m.pct, y, keys });
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    hideWidthTip();
    commit();
    resizeDrag(false);
  };
  return (
    <div
      role="separator"
      {...(mark ? { [mark]: "" } : {})}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      title={title}
      className={`absolute top-0 bottom-0 z-20 cursor-col-resize outline-none hover:bg-accent/30 focus-visible:bg-accent/40 active:bg-accent/40 ${className}`}
      onDoubleClick={(e) => reset(e.currentTarget)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width: start(e.currentTarget), handle: e.currentTarget };
        resizeDrag(true);
        tip(e.currentTarget, e.clientY);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // Live while dragging; stored once on release.
        change(d.width + sign * (e.clientX - d.x), d.handle, false);
        tip(d.handle, e.clientY);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => {
        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        // A short drag (宽度规则 1, owner 2026-10-21): live in a drag session — only the two panels beside the edge
        // change — and stored once the keys rest, like a pointer release (lib/columnGlide keyResize).
        const handle = e.currentTarget;
        const width = start(handle) + dir * sign * (e.shiftKey ? STEP * 4 : STEP);
        keyResize(() => {
          change(width, handle, false);
          tip(handle, undefined, true);
        }, commit);
      }}
    />
  );
}

export function PaneResizer({ field, edge }: { field: WidthKey; edge: "left" | "right" }) {
  const { t } = useI18n();
  // A desk's sidebar has its own width (multi-window P3, lib/windowSidebar): its edge sizes that one.
  const deskId = useDeskId();
  const deskWidth = useDeskSidebarWidth();
  const own = field === "sidebarWidth" && !!deskId;
  const appearance = useAppearance();
  const value = own ? (deskWidth ?? appearance[field]) : appearance[field];
  const room = useRef(Number.POSITIVE_INFINITY);
  // The Settings Shelf beside the sidebar (on the left, checklist #38): the edge between them changes only those
  // two — the sidebar takes from / gives to the Settings card (down to its minimum), the work row stays.
  const beside = useRef<{ sidebar: number; settings: number } | null>(null);
  // 宽度规则 3 (owner 2026-10-21): the sidebar's edge takes only from the panel beside it (the work row says how
  // much it can give: its column down to its minimum, the free desktop) and stops there.
  const most = useRef(Number.POSITIVE_INFINITY);
  const deskRoot = useRef<HTMLElement | null>(null);
  const livePx = useRef<number | null>(null);
  // While dragging only the width's CSS variable moves (lib/appearance previewWidth); keys, reset and
  // the release store it (all variables, fonts, the zoom IPC once).
  const set = (width: number, roomPx: number, persist: boolean) => {
    const px = Math.min(clampPaneWidth(width, RANGES[field], roomPx), Math.max(RANGES[field][0], most.current));
    const b = beside.current;
    if (b) setSettingsShelfLive(b.settings - (px - b.sidebar));
    if (own && deskId) {
      // Live on the desk's own root (its sidebar reads --sidebar-w there); stored for that desk on release.
      const root = deskRoot.current;
      root?.style.setProperty("--sidebar-w", `${px}px`);
      if (persist) setDeskSidebarWidth(deskId, px);
      else livePx.current = px;
      return;
    }
    if (persist) {
      setAppearance({ [field]: px }, true);
      if (b) {
        setSettingsShelfWidth(b.settings - (px - b.sidebar));
        setSettingsShelfLive(null);
        beside.current = null;
      }
    } else previewWidth(field, px);
  };
  return (
    <ResizeHandle
      label={t(field === "sidebarWidth" ? "appearance.sidebarWidth" : "pane.width")}
      title={t("pane.resizeHint")}
      min={RANGES[field][0]}
      max={RANGES[field][1]}
      value={value}
      // The sidebar's edge covers the whole 8 px gap to the next card (and 4 px of the sidebar): a column against the
      // sidebar draws no edge of its own there (lib/windowSidebar useSidebarEdge), so a press anywhere in the gap
      // resizes the sidebar (owner 2026-10-28).
      className={field === "sidebarWidth" && edge === "right" ? "-right-2 w-3" : edge === "right" ? "-right-1 w-2" : "-left-1 w-2"}
      sign={edge === "right" ? 1 : -1}
      measure={(handle) => (handle.parentElement ? { px: handle.parentElement.offsetWidth, pct: null } : null)}
      start={(handle) => {
        const pane = handle.parentElement;
        deskRoot.current = own ? handle.closest<HTMLElement>("[data-desk]") : null;
        room.current = roomFor(pane);
        const from = pane?.offsetWidth ?? getAppearance()[field];
        const settings = field === "sidebarWidth" ? settingsBesideSidebar() : null;
        // The card's width: the Shelf's box less its 8 px seam.
        beside.current = settings ? { sidebar: from, settings: settings.offsetWidth - 8 } : null;
        most.current = field !== "sidebarWidth" ? Number.POSITIVE_INFINITY : beside.current ? from + Math.max(0, beside.current.settings - SETTINGS_SHELF_MIN_W) : from + rowGive(edge === "right" ? "left" : "right");
        // Beside two workspaces it stops before the width that drops it to its automatic rail (lib/workspaces).
        if (field === "sidebarWidth") most.current = Math.min(most.current, Math.max(from, sidebarDragMaxNow()));
        return from;
      }}
      change={(width, handle, persist) => set(width, persist ? roomFor(handle.parentElement) : room.current, persist)}
      commit={() => {
        const b = beside.current;
        if (b) {
          const now = useSettingsShelfLive.getState().width;
          if (now !== null) setSettingsShelfWidth(now);
          setSettingsShelfLive(null);
          beside.current = null;
        }
        if (own && deskId && livePx.current !== null) setDeskSidebarWidth(deskId, livePx.current);
        livePx.current = null;
        commitLiveWidths();
      }}
      reset={(handle) => {
        most.current = Number.POSITIVE_INFINITY;
        // 宽度规则 7: the two panels beside the edge back to their defaults (the Settings card too when it is there).
        if (field === "sidebarWidth" && settingsBesideSidebar()) setSettingsShelfWidth(SETTINGS_SHELF_DEFAULT_W);
        beside.current = null;
        set(DEFAULT_APPEARANCE[field], roomFor(handle.parentElement), true);
      }}
    />
  );
}

/**
 * The divider between two conversation columns (panes step 2), placed on the left edge of the right
 * column: drags move the left column's share of the pair (`onShare`, 0–1; the layout clamps it).
 * `left` / `right`: the two columns' elements are the handle's parent (right) and its previous sibling.
 * While dragging only the two columns' `flex-grow` moves (`preview`: the clamped grows for a share, as
 * the layout would store them) — no store write, no React render of the panes; the release stores the
 * last share once (`onShare`).
 */
export function ColumnSplitter({ share, onShare, preview }: { share: number; onShare(share: number): void; preview(share: number): [number, number] | null }) {
  const { t } = useI18n();
  const pair = (handle: HTMLElement) => {
    const right = handle.parentElement;
    const left = right?.previousElementSibling as HTMLElement | null | undefined;
    return { left, right, leftWidth: left?.offsetWidth ?? 0, total: (left?.offsetWidth ?? 0) + (right?.offsetWidth ?? 0) };
  };
  // The pair's width, read once when a drag starts (no layout read per move).
  const total = useRef(0);
  const last = useRef<number | null>(null);
  return (
    <ResizeHandle
      mark="data-pane-split"
      label={t("pane.split")}
      title={t("pane.splitHint")}
      min={0}
      max={100}
      value={Math.round(share * 100)}
      className="-left-1 w-2"
      sign={1}
      measure={columnMeasure}
      start={(handle) => {
        const p = pair(handle);
        total.current = p.total;
        return p.leftWidth;
      }}
      change={(width, handle, persist) => {
        if (persist) {
          const { total: now } = pair(handle);
          if (now > 0) onShare(width / now);
          return;
        }
        if (total.current <= 0) return;
        const next = width / total.current;
        const grows = preview(next);
        const right = handle.parentElement;
        const left = right?.previousElementSibling as HTMLElement | null | undefined;
        if (!grows || !left || !right) return;
        last.current = next;
        left.style.flexGrow = String(grows[0]);
        right.style.flexGrow = String(grows[1]);
      }}
      commit={() => {
        const next = last.current;
        last.current = null;
        if (next !== null) onShare(next);
      }}
      reset={() => onShare(0.5)}
    />
  );
}

/**
 * The handle between two filling workspaces' columns (宽度规则 1, owner 2026-10-21): only those two columns change,
 * each kept at its minimum (the edge stops there; lib/workspaceRow fillWidths, the row's own rule); the release
 * stores the left one's share (the owner's ratio, kept when the window resizes); a double-click = half and half.
 * `widths`: the two columns as the row has them now. While dragging only the two columns' elements move (their
 * `width`, the handle's parent and its previous sibling) and the instance layer follows in the same frame
 * (lib/sideSlots slotsRelayout) — no store write, no React render of the row or the conversations per move
 * (perf re-run 2026-10-21 §7.3 N1: every move went through the row and re-rendered both columns); the release
 * stores the share once and the row takes over the widths again.
 */
export function RowSplitter({ widths, onShare }: { widths: readonly (number | null)[]; onShare(share: number): void }) {
  const { t } = useI18n();
  const total = useRef(0);
  const last = useRef<{ share: number; handle: HTMLElement } | null>(null);
  const [a, b] = widths;
  const pair = typeof a === "number" && typeof b === "number" ? a + b : 0;
  const columns = (handle: HTMLElement) => {
    const right = handle.parentElement;
    const left = right?.previousElementSibling as HTMLElement | null | undefined;
    return left && right ? ([left, right] as const) : null;
  };
  // The two columns at a share of the pair, as the row would lay them out.
  const show = (handle: HTMLElement, share: number) => {
    const els = columns(handle);
    if (!els) return;
    const [w0, w1] = fillWidths({ avail: total.current, split: share, mins: [WS_CONVERSATION_MIN_W, WS_CONVERSATION_MIN_W], pin: null });
    els[0].style.width = `${w0}px`;
    els[1].style.width = `${w1}px`;
    flushSync(slotsRelayout);
  };
  return (
    <ResizeHandle
      mark="data-pane-split"
      label={t("pane.split")}
      title={t("pane.splitHint")}
      min={0}
      max={100}
      value={pair > 0 ? Math.round(((a as number) / pair) * 100) : 50}
      className="-left-1 w-2"
      sign={1}
      measure={columnMeasure}
      start={() => {
        total.current = pair;
        return typeof a === "number" ? a : 0;
      }}
      change={(width, handle, persist) => {
        const now = persist ? pair : total.current;
        if (now <= 0) return;
        const share = Math.min(1, Math.max(0, width / now));
        if (persist) return onShare(share);
        last.current = { share, handle };
        show(handle, share);
      }}
      commit={() => {
        const next = last.current;
        last.current = null;
        if (next === null) return;
        flushSync(() => onShare(next.share));
        // The row owns the widths again: what it rendered for the stored share (the same rule, so normally what
        // the drag showed; React does not rewrite a style it did not change).
        for (const el of columns(next.handle) ?? []) if (el.dataset.wsWidth) el.style.width = `${el.dataset.wsWidth}px`;
      }}
      reset={() => onShare(0.5)}
    />
  );
}
