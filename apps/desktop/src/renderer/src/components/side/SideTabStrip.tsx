// The page tab row (docs/desktop-modules.md §18.3, owner 2026-10-12 方案 A; 右栏布局 = 仅标签页 since
// 2026-10-14, the default being the vertical lane beside the open column): while the column is open
// with ≥ 2 pages, the page buttons are a horizontal row at the column's top, above the first card and
// aligned with the cards (the vertical lane, SideLane.tsx, is then only there while the column is closed).
// Same pills, clicks (lib/sideLaneClick) and drags (lib/sideDnd: read along x here) as the lane; "+"
// after the last pill. Its right end holds the page in view's actions — 钉住 (悬浮 only), ⤢ ⛶
// (Ctrl+Shift+M / Shift+F11), ⋯ (page menu), 收起侧栏 (Ctrl+Alt+B) — visible only while the pointer is
// over the row or one of them has keyboard focus (opacity, nothing moves). With one page there is no
// row: the title bar's toggle collapses, ＋ → 本页 has the page actions.
import { useEffect, useRef } from "react";
import { Expand, Maximize2, Minimize2, MoreHorizontal, PanelRightClose, Pin, PinOff, Shrink } from "lucide-react";
import { useI18n } from "../../i18n";
import { openMenuFrom } from "../../lib/contextMenu";
import { useUiPrefs } from "../../lib/prefs";
import { pinnedFromFloatNow, toggleMode, togglePin } from "../../lib/sideActions";
import type { SideRegistry } from "../../lib/sideComponents";
import { pageInView, type SidePage, type SideViewContext } from "../../lib/sideLayout";
import { useSide } from "../../lib/sideLayoutStore";
import { pageMenu } from "../../lib/sideMenus";
import { toggleSideColumn } from "../../lib/sideOpen";
import { pillContent } from "../../lib/sidePills";
import { Pill, Tail } from "./SideLane";

const ACTION = "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity group-hover/strip:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100";

export function SideTabStrip({ pages, registry, ctx }: { pages: readonly SidePage[]; registry: SideRegistry; ctx: SideViewContext }) {
  const { t } = useI18n();
  const layout = useSide((s) => s.layout);
  const tabInfo = useSide((s) => s.tabInfo);
  const flash = useSide((s) => s.flash);
  const tabs = useRef<HTMLDivElement>(null);
  const inView = pageInView(layout, ctx)?.id ?? null;
  // Many pages may overflow the row: keep the page in view scrolled into it.
  useEffect(() => {
    if (!inView) return;
    tabs.current?.querySelector(`[data-side-pill="${CSS.escape(inView)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [inView]);
  return (
    <div data-side-strip className="group/strip mb-1 flex h-8 shrink-0 items-center gap-1">
      <div
        ref={tabs}
        role="tablist"
        aria-orientation="horizontal"
        aria-label={t("side.strip")}
        data-side-strip-tabs
        // A vertical wheel scrolls the row sideways (its scrollbar is hidden).
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden px-[3px] [scrollbar-width:none]"
      >
        {pages.map((page, k) => (
          <Pill
            key={page.id}
            page={page}
            index={k}
            pill={pillContent(layout, page, ctx, (id) => tabInfo[id])}
            active={layout.activePage === page.id}
            open
            flash={flash?.pageId === page.id && layout.activePage !== page.id}
            layout={layout}
            ctx={ctx}
            registry={registry}
            across
          />
        ))}
        <Tail across />
      </div>
      <PageActions ctx={ctx} />
    </div>
  );
}

/** The page in view's actions at the row's right end, then 收起侧栏 (same as the title-bar toggle). */
function PageActions({ ctx }: { ctx: SideViewContext }) {
  const { t } = useI18n();
  const { sideMode } = useUiPrefs();
  const layout = useSide((s) => s.layout);
  const mode = useSide((s) => s.mode);
  const narrow = useSide((s) => s.narrow);
  const page = pageInView(layout, ctx);
  const pinned = pinnedFromFloatNow();
  const pin = !mode && !narrow && (sideMode === "float" || pinned);
  const pageMode = mode && mode.card === null ? mode.kind : null;
  const modes = !!page && page.cards.length > 0;
  const modeButton = (kind: "maximised" | "fullscreen") => {
    const on = pageMode === kind;
    const Icon = kind === "maximised" ? (on ? Minimize2 : Maximize2) : on ? Shrink : Expand;
    const key = kind === "maximised" ? "Ctrl+Shift+M" : "Shift+F11";
    const tip = on ? t("side.restoreHint", { key }) : t(kind === "maximised" ? "side.maximisePage" : "side.fullscreenPage", { key });
    return (
      <button onClick={() => toggleMode(kind, null)} title={tip} aria-label={tip} aria-pressed={on} data-side-page-mode={kind} className={`${ACTION} ${on ? "bg-hover text-foreground opacity-100" : ""}`}>
        <Icon size={14} />
      </button>
    );
  };
  return (
    <div role="toolbar" aria-label={t("side.pageActions")} data-side-page-actions className="flex shrink-0 items-center">
      {pin && (
        <button onClick={togglePin} title={t(pinned ? "side.unpin" : "side.pin")} aria-label={t(pinned ? "side.unpin" : "side.pin")} aria-pressed={pinned} className={`${ACTION} ${pinned ? "text-accent" : ""}`}>
          {pinned ? <PinOff size={14} /> : <Pin size={14} />}
        </button>
      )}
      {modes && modeButton("maximised")}
      {modes && modeButton("fullscreen")}
      {page && (
        <button onClick={(e) => openMenuFrom(e.currentTarget, pageMenu(page.id))} title={t("side.pageMenu")} aria-label={t("side.pageMenu")} className={ACTION}>
          <MoreHorizontal size={14} />
        </button>
      )}
      <button onClick={toggleSideColumn} title={t("side.laneCollapseHint", { key: "Ctrl+Alt+B" })} aria-label={t("side.laneCollapse")} data-side-lane-collapse className={ACTION}>
        <PanelRightClose size={15} />
      </button>
    </div>
  );
}
