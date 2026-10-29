// The desktop layer (`pane.desktop` home.desktop; panes-20261019.md §5; design 030 v2 + 032): full-bleed background
// (home cover, else the launch art over the sky scene), and on it the desktop widgets (`desktop.widget`, every
// module's: the built-in 名片 · 时钟 · 需要你 · 用量 · pinned tiles, the 世界时钟 …) placed by DeskSurface on the
// grid of 40 px units (contract 1.24). 编辑主页 / a long press / 整理桌面 arranges them. The 编辑主页 panel (the home's
// own settings) floats over the desktop under the arranging bar, as tall as its content, and can be dragged aside or
// folded into the bar (owner 2026-10-24: 「编辑主页好占位置」); a widget's settings open beside it (DeskSurface). The layer is the work area's bottom layer
// (contract 1.20): it is never squeezed — the panel and the tray float over it (lib/trayModel deskGeometry). The
// shell draws the background once behind the whole window ("covered": the background only, components/ChipTray
// DesktopBackground) and the content over the work area ("empty" / "desktop": no second background).
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronRight, GripHorizontal, Pencil, RotateCcw, Undo2, X } from "lucide-react";
import { useI18n } from "../../i18n";
import type { PaneDesktopProps } from "../slots";
import { EditPanel } from "./EditPanel";
import { setHomeEditing, useHomeEdit } from "./store";
import { useDeskBackdrop } from "./hooks";
import { ArtCredit, DesktopBackdrop } from "./Parts";
import { deskGeometry } from "../../lib/trayModel";
import { contextMenu } from "../../lib/contextMenu";
import { DeskSurface, deskMenu, useDeskUi } from "./DeskSurface";
import "./home.css";
import { isElement } from "../../lib/ownerWindow";
import { useOwnerWindow } from "../../lib/ownerContext";

/** The floating panel's top: under the arranging bar. */
const PANEL_TOP = 56;

/** Where the floating 编辑主页 panel was dragged to (this session only), as an offset from its place. */
function usePanelDrag() {
  const win = useOwnerWindow();
  const [off, setOff] = useState({ x: 0, y: 0 });
  const begin = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (isElement(e.target) && e.target.closest("button"))) return;
    e.preventDefault();
    const start = { x: e.clientX - off.x, y: e.clientY - off.y };
    const move = (ev: PointerEvent) => setOff({ x: Math.min(0, ev.clientX - start.x), y: Math.max(0, ev.clientY - start.y) });
    const up = () => {
      win.removeEventListener("pointermove", move, true);
      win.removeEventListener("pointerup", up, true);
    };
    win.addEventListener("pointermove", move, true);
    win.addEventListener("pointerup", up, true);
  };
  return { off, begin };
}

export function DesktopLayer({ reason, hostId: _focus, tray = false }: PaneDesktopProps) {
  const { t } = useI18n();
  const canUndo = useDeskUi((s) => s.canUndo);
  const editing = useHomeEdit((s) => s.editing) && reason !== "covered";
  // Known or remembered, never an unrelated portrait first (owner 2026-10-21, ./backdrop).
  const backdrop = useDeskBackdrop();
  const panel = useHomeEdit((s) => s.panel) && editing;
  const geo = deskGeometry({ editing: panel, tray: tray ? "desktop" : "none" });
  const drag = usePanelDrag();
  // The window's background (behind every card): the background only, nothing to read or click.
  if (reason === "covered")
    return (
      <div className="home-desk absolute inset-0" data-home-desktop="covered">
        <DesktopBackdrop backdrop={backdrop} />
      </div>
    );
  const box = (i: { top: number; right: number; bottom: number; left: number }) => ({ top: i.top, right: i.right, bottom: i.bottom, left: i.left });
  return (
    // Right-click on the desktop (design 006 v1): 编辑主页 and 「⚙ 桌面设置…」 (inputs keep the native menu).
    <div
      className={`home-desk absolute ${editing ? "home-editing" : ""}`}
      style={box(geo.layer)}
      data-home-desktop={reason}
      onContextMenu={(e) => {
        if (isElement(e.target) && e.target.closest("input, textarea, [contenteditable], [data-desk-widget]")) return;
        const build = deskMenu.build;
        if (build) contextMenu(() => build(e.clientX, e.clientY))(e);
      }}
    >
      {/* The background is the window's (DesktopBackground): only the art's credit here. */}
      <ArtCredit backdrop={backdrop} />
      <div className="relative h-full overflow-y-auto" style={{ paddingTop: geo.content.top, paddingRight: geo.content.right, paddingBottom: tray ? `calc(${geo.content.bottom}px + var(--tray-extra, 0px))` : geo.content.bottom, paddingLeft: geo.content.left }} data-home-content="">
        <DeskSurface />
      </div>
      {!editing && (
        <button onClick={() => setHomeEditing(true)} className="home-glass absolute right-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs" style={{ bottom: tray ? 18 : 16 }} data-home-editbtn="">
          <Pencil size={12} />
          {t("home.edit")}
        </button>
      )}
      {editing && (
        <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-raised py-1.5 pr-1.5 pl-4 text-xs whitespace-nowrap shadow-lg" data-home-editbar="">
          <Pencil size={12} />
          {t("home.desk.hint")}
          <button disabled={!canUndo} onClick={() => useDeskUi.getState().undo?.()} className="inline-flex items-center gap-1 rounded-full bg-hover px-2.5 py-1 disabled:opacity-40" data-home-undo="">
            <Undo2 size={12} />
            {t("home.desk.undo")}
          </button>
          <button onClick={() => useDeskUi.getState().reset?.()} className="inline-flex items-center gap-1 rounded-full bg-hover px-2.5 py-1" data-home-reset="">
            <RotateCcw size={12} />
            {t("home.desk.reset")}
          </button>
          <button onClick={() => setHomeEditing(true, !panel)} aria-expanded={panel} className="inline-flex items-center gap-1 rounded-full bg-hover px-2.5 py-1" data-home-openpanel="">
            <Pencil size={12} />
            {t("home.edit")}
            {panel ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <button onClick={() => setHomeEditing(false)} className="rounded-full bg-accent px-3 py-1 font-medium text-white">
            {t("home.done")}
          </button>
        </div>
      )}
      {geo.panel && (
        // 编辑主页: a card over the desktop's right side (the desktop keeps its size under it). Checklist #16: the
        // card system's card (.shell-card: material, radius, border, shadow; the row's edges) with a card header
        // (as the Settings Shelf's: h-10, a hairline under it, title + ×).
        // Floating under the arranging bar, as tall as its content (scrolls past the desktop's height), draggable by its
        // header; × folds it into the bar (arranging goes on).
        <aside className="shell-card absolute isolate flex flex-col overflow-hidden" style={{ top: PANEL_TOP + drag.off.y, right: 12 - drag.off.x, maxHeight: `calc(100% - ${PANEL_TOP + drag.off.y + geo.panel.bottom + 12}px - var(--tray-extra, 0px))`, width: geo.panel.width }} aria-label={t("home.edit")} data-home-editpanel="">
          <div className="flex h-10 shrink-0 cursor-grab items-center gap-1.5 border-b border-border/60 pr-1.5 pl-3 active:cursor-grabbing" data-home-edithead="" onPointerDown={drag.begin}>
            <GripHorizontal size={14} className="shrink-0 text-subtle" />
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{t("home.edit")}</h3>
            <button onClick={() => setHomeEditing(true, false)} title={t("home.desk.fold")} aria-label={t("home.desk.fold")} className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60">
              <X size={15} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 pb-6">
            <EditPanel />
          </div>
        </aside>
      )}
    </div>
  );
}
