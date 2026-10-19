// A pane's draggable edge: the left sidebar's right edge (侧栏宽度) and the right side pane's left
// edge. Drag to resize (pointer capture), double-click to reset, arrow keys when focused (Shift = ×4).
// Widths live in Settings → 外观 (per machine) and are clamped so the conversation keeps room.
// The pane element is the handle's parent (marked `data-resizable-pane`).
// The same handle splits two conversation columns side by side (ColumnSplitter, panes step 2): there
// the left column's share of the pair is stored with the pane layout (lib/paneStore).
import { useRef } from "react";
import { useI18n } from "../i18n";
import { DEFAULT_APPEARANCE, getAppearance, RANGES, setAppearance, useAppearance } from "../lib/appearance";
import { clampPaneWidth } from "../lib/appearanceModel";

type WidthKey = "sidebarWidth" | "sidePaneWidth";

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
}

/** The shared drag / keyboard / double-click behaviour of a resize edge. */
function ResizeHandle({ mark, label, title, min, max, value, className, start, change, commit, reset, sign }: HandleProps) {
  const drag = useRef<{ x: number; width: number; handle: HTMLElement } | null>(null);
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    commit();
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
      className={`absolute top-0 bottom-0 z-20 w-2 cursor-col-resize outline-none hover:bg-accent/30 focus-visible:bg-accent/40 active:bg-accent/40 ${className}`}
      onDoubleClick={(e) => reset(e.currentTarget)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width: start(e.currentTarget), handle: e.currentTarget };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // Live while dragging; stored once on release.
        change(d.width + sign * (e.clientX - d.x), d.handle, false);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => {
        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        change(start(e.currentTarget) + dir * sign * (e.shiftKey ? STEP * 4 : STEP), e.currentTarget, true);
      }}
    />
  );
}

export function PaneResizer({ field, edge }: { field: WidthKey; edge: "left" | "right" }) {
  const { t } = useI18n();
  const value = useAppearance()[field];
  const room = useRef(Number.POSITIVE_INFINITY);
  const set = (width: number, roomPx: number, persist: boolean) => setAppearance({ [field]: clampPaneWidth(width, RANGES[field], roomPx) }, persist);
  return (
    <ResizeHandle
      label={t(field === "sidebarWidth" ? "appearance.sidebarWidth" : "pane.width")}
      title={t("pane.resizeHint")}
      min={RANGES[field][0]}
      max={RANGES[field][1]}
      value={value}
      className={edge === "right" ? "-right-1" : "-left-1"}
      sign={edge === "right" ? 1 : -1}
      start={(handle) => {
        const pane = handle.parentElement;
        room.current = roomFor(pane);
        return pane?.offsetWidth ?? getAppearance()[field];
      }}
      change={(width, handle, persist) => set(width, persist ? roomFor(handle.parentElement) : room.current, persist)}
      commit={() => setAppearance({}, true)}
      reset={(handle) => set(DEFAULT_APPEARANCE[field], roomFor(handle.parentElement), true)}
    />
  );
}

/**
 * The divider between two conversation columns (panes step 2), placed on the left edge of the right
 * column: drags move the left column's share of the pair (`onShare`, 0–1; the layout clamps it).
 * `left` / `right`: the two columns' elements are the handle's parent (right) and its previous sibling.
 */
export function ColumnSplitter({ share, onShare }: { share: number; onShare(share: number, persist: boolean): void }) {
  const { t } = useI18n();
  const pair = (handle: HTMLElement) => {
    const right = handle.parentElement;
    const left = right?.previousElementSibling as HTMLElement | null | undefined;
    return { left: left?.offsetWidth ?? 0, total: (left?.offsetWidth ?? 0) + (right?.offsetWidth ?? 0) };
  };
  return (
    <ResizeHandle
      mark="data-pane-split"
      label={t("pane.split")}
      title={t("pane.splitHint")}
      min={0}
      max={100}
      value={Math.round(share * 100)}
      className="-left-1"
      sign={1}
      start={(handle) => pair(handle).left}
      change={(width, handle, persist) => {
        const { total } = pair(handle);
        if (total > 0) onShare(width / total, persist);
      }}
      commit={() => onShare(share, true)}
      reset={() => onShare(0.5, true)}
    />
  );
}
