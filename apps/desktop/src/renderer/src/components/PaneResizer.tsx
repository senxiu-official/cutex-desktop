// A pane's draggable edge: the left sidebar's right edge (侧栏宽度) and the right side pane's left
// edge. Drag to resize (pointer capture), double-click to reset, arrow keys when focused (Shift = ×4).
// Widths live in Settings → 外观 (per machine) and are clamped so the conversation keeps room.
// The pane element is the handle's parent (marked `data-resizable-pane`).
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

export function PaneResizer({ field, edge }: { field: WidthKey; edge: "left" | "right" }) {
  const { t } = useI18n();
  const value = useAppearance()[field];
  const drag = useRef<{ x: number; width: number; room: number } | null>(null);
  const sign = edge === "right" ? 1 : -1;
  const set = (width: number, room: number, persist: boolean) => setAppearance({ [field]: clampPaneWidth(width, RANGES[field], room) }, persist);
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setAppearance({}, true);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t(field === "sidebarWidth" ? "appearance.sidebarWidth" : "pane.width")}
      aria-valuemin={RANGES[field][0]}
      aria-valuemax={RANGES[field][1]}
      aria-valuenow={value}
      tabIndex={0}
      title={t("pane.resizeHint")}
      className={`absolute top-0 bottom-0 z-20 w-2 cursor-col-resize outline-none hover:bg-accent/30 focus-visible:bg-accent/40 active:bg-accent/40 ${edge === "right" ? "-right-1" : "-left-1"}`}
      onDoubleClick={(e) => set(DEFAULT_APPEARANCE[field], roomFor(e.currentTarget.parentElement), true)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const pane = e.currentTarget.parentElement;
        drag.current = { x: e.clientX, width: pane?.offsetWidth ?? getAppearance()[field], room: roomFor(pane) };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // Live while dragging; stored once on release.
        set(d.width + sign * (e.clientX - d.x), d.room, false);
      }}
      onPointerUp={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => {
        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const pane = e.currentTarget.parentElement;
        set((pane?.offsetWidth ?? value) + dir * sign * (e.shiftKey ? STEP * 4 : STEP), roomFor(pane), true);
      }}
    />
  );
}
