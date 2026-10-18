// The right side at App level (docs/desktop-modules.md §18; RFC §3.8–§3.9): the work area holds the
// conversation / page card and the side — the column of cards and, with ≥ 2 pages, the page buttons:
// 右栏布局 = 竖条 + 标签页 (★) the vertical lane (SideLane) beside the column, open or closed; 仅标签页 the
// tab row at the column's top (SideTabStrip), the lane only while it is closed. One box whose
// placement follows the frame (lib/sideFrame.ts): in the row (并排 / 让位), over the conversation
// (悬浮), a drawer (narrow window), over the work area (maximised) or the whole window (full screen).
// Instances never live here: cards hold placeholders, SideInstanceLayer draws the instances.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Shrink } from "lucide-react";
import cutexLogo from "../../assets/cutex-logo-64.png";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import { useAppearance } from "../../lib/appearance";
import { publishSideFrame } from "../../lib/gutterStore";
import { useUiPrefs } from "../../lib/prefs";
import { cardName, closeColumn, pageLabel } from "../../lib/sideActions";
import { useSideRegistry, useSideView, type SideRegistry } from "../../lib/sideComponents";
import { sideFrame, type SideFrame } from "../../lib/sideFrame";
import { findCard, lanePages, pageInView, pageVisibility, setOpen, visibleCards, type SidePage, type SideViewContext } from "../../lib/sideLayout";
import { setMode, setNarrow, updateLayout, useSide } from "../../lib/sideLayoutStore";
import { launch, launchable } from "../../lib/sideMenus";
import { setSideWorkWidth, useSideWidthHandle } from "../../lib/sideResize";
import { registerSideAnchor } from "../../lib/sideSlots";
import { CaptionSpace, LinuxControls } from "../WindowControls";
import { SideLane } from "./SideLane";
import { SidePageView } from "./SidePageView";
import { SideTabStrip } from "./SideTabStrip";

const win = bridge.window;

/** Launcher buttons (empty column / launcher page): every component that can be opened now. */
function Launchers({ pageId }: { pageId: string | null }) {
  const { t } = useI18n();
  useSideRegistry(); // re-render when components come and go
  const items = launchable();
  if (!items.length) return <p className="text-xs text-subtle">{t("side.launcher.none")}</p>;
  return (
    <div className="flex max-w-80 flex-wrap justify-center gap-1.5">
      {items.map((i) => (
        <button key={i.kind} onClick={() => launch(i.kind, i.params, pageId)} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-foreground">
          {i.icon}
          {i.label}
        </button>
      ))}
    </div>
  );
}

function EmptyCard({ title, hint, children, edge }: { title: string; hint?: string; children?: ReactNode; edge: ReactNode }) {
  return (
    <div className="shell-card relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 p-6 text-center text-[13px] text-subtle">
      {edge}
      <h3 className="m-0 text-[13px] font-semibold text-muted">{title}</h3>
      {hint && <div className="max-w-72">{hint}</div>}
      {children}
    </div>
  );
}

/** The column: the page in view (or the mode's card), the launcher page, or an empty state. */
function SideColumn({ frame, registry, ctx, currentWidth }: { frame: SideFrame; registry: SideRegistry; ctx: SideViewContext; currentWidth: () => number }) {
  const { t } = useI18n();
  const layout = useSide((s) => s.layout);
  const mode = useSide((s) => s.mode);
  const width = useSideWidthHandle(currentWidth);
  const resizable = frame.kind === "flow" || frame.kind === "float" || frame.kind === "drawer";
  const edge = resizable ? <div title={t("side.resizeHint")} className="side-handle-v absolute top-3.5 bottom-3.5 left-0 z-10 w-[5px] cursor-col-resize" {...width} /> : null;
  if (!layout.pages.length) {
    return (
      <EmptyCard title={t("side.empty.title")} hint={t("side.empty.hint")} edge={edge}>
        <Launchers pageId={null} />
      </EmptyCard>
    );
  }
  const page = pageInView(layout, ctx);
  if (!page) {
    return (
      <EmptyCard title={t("side.empty.title")} hint={t("side.empty.hint")} edge={edge}>
        <Launchers pageId={null} />
      </EmptyCard>
    );
  }
  const visibility = pageVisibility(layout, page, ctx);
  if (visibility === "launcher") {
    return (
      <EmptyCard title={t("side.launcher.title")} hint={t("side.launcher.hint")} edge={edge}>
        <Launchers pageId={page.id} />
      </EmptyCard>
    );
  }
  let cards = visibleCards(layout, page, ctx);
  const modeCard = mode?.card && page.cards.some((c) => c.id === mode.card) ? mode.card : null;
  if (modeCard) cards = cards.filter((c) => c.id === modeCard);
  return <SidePageView page={page} cards={cards} registry={registry} ctx={ctx} edge={resizable} currentWidth={currentWidth} />;
}

/** Full screen: the window's own 40 px title row (drag region, caption buttons) with 还原. */
function FullTitleRow({ ctx }: { ctx: SideViewContext }) {
  const { t } = useI18n();
  const layout = useSide((s) => s.layout);
  const mode = useSide((s) => s.mode);
  const page = pageInView(layout, ctx);
  const at = mode?.card ? findCard(layout, mode.card) : null;
  const shownCards = page ? visibleCards(layout, page, ctx) : [];
  const card = at?.card ?? (shownCards.length === 1 ? shownCards[0] : null);
  return (
    <div
      className={`flex h-10 shrink-0 items-center gap-2 px-3 select-none [app-region:drag] ${win?.nativeControls === "left" ? "pl-[76px]" : ""}`}
      onDoubleClick={(e) => win?.nativeControls === null && e.target === e.currentTarget && void win.control("toggleMaximize")}
    >
      <img src={cutexLogo} alt="" draggable={false} className="h-4 w-4 shrink-0" />
      <b className="min-w-0 truncate text-[13px] font-semibold">{page ? pageLabel(page) : ""}</b>
      {card && <span className="min-w-0 truncate text-[13px] text-subtle">· {cardName(card)}</span>}
      <span className="flex-1" />
      <button onClick={() => setMode(null)} title={t("side.restoreHint", { key: "Shift+F11" })} className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted hover:bg-hover hover:text-foreground [app-region:no-drag]">
        <Shrink size={13} />
        {t("side.restore")}
      </button>
      <LinuxControls />
      <CaptionSpace />
    </div>
  );
}

function SideArea({ frame, areaWidth }: { frame: SideFrame; areaWidth: number }) {
  const { t } = useI18n();
  const registry = useSideRegistry();
  const ctx = useSideView();
  const layout = useSide((s) => s.layout);
  const box = useRef<HTMLDivElement>(null);
  const currentWidth = () => box.current?.offsetWidth ?? 0;
  const gap = useSideWidthHandle(currentWidth);
  const pages = lanePages(layout, ctx);
  const column = frame.kind !== "closed";
  const lane = frame.lane && pages.length >= 2;
  const strip = frame.strip && pages.length >= 2;
  const { sidePageBar } = useUiPrefs();
  const resizable = frame.kind === "flow" || frame.kind === "float" || frame.kind === "drawer";
  if (frame.kind === "closed" && !lane) return null;

  let boxClass = "relative flex shrink-0";
  let style: CSSProperties = { width: frame.width };
  switch (frame.kind) {
    case "float":
      boxClass = "relative z-20 flex shrink-0 rounded-[14px] bg-win pb-0 shadow-[var(--shadow)]";
      style = { width: frame.width, marginLeft: frame.inFlow - frame.width };
      break;
    case "drawer":
      boxClass = "absolute inset-y-0 right-0 z-30 flex rounded-l-[14px] bg-win shadow-[var(--shadow)]";
      break;
    case "maximised":
      boxClass = "absolute inset-0 z-[25] flex bg-win";
      style = {};
      break;
    case "fullscreen":
      boxClass = "fixed inset-0 z-[38] flex flex-col bg-win";
      style = {};
      break;
  }
  const spacer = frame.kind === "drawer" || frame.kind === "maximised" || frame.kind === "fullscreen" ? frame.inFlow : 0;
  return (
    <>
      {spacer > 0 && <div className="shrink-0" style={{ width: spacer }} />}
      <div ref={box} data-side-root data-side-box data-customize-region="sides" className={boxClass} style={style} aria-label={t("side.column")}>
        {frame.kind === "fullscreen" && <FullTitleRow ctx={ctx} />}
        {/* The seam handle fills the 8 px left padding: the cards' (and the tab row's) left edge is flush against it. With the
            lane beside the open column the lane is the gap, the handle a thin strip over its left edge. */}
        <div className={`relative flex min-h-0 min-w-0 flex-1 ${frame.kind === "fullscreen" ? "px-2 pb-2" : ""} ${resizable && !(lane && column) ? "pl-2" : ""}`}>
          {resizable && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("pane.width")}
              tabIndex={0}
              title={t("side.resizeHint")}
              className={`side-handle-v absolute inset-y-0 left-0 z-10 cursor-col-resize outline-none ${lane ? "w-1" : "w-2"}`}
              {...gap}
            />
          )}
          {lane && <SideLane pages={pages} open={column} actions={sidePageBar !== "tabs"} registry={registry} ctx={ctx} />}
          {column && (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {strip && <SideTabStrip pages={pages} registry={registry} ctx={ctx} />}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-side-column={pageInView(layout, ctx)?.id ?? ""}>
                <SideColumn frame={frame} registry={registry} ctx={ctx} currentWidth={currentWidth} />
              </div>
            </div>
          )}
        </div>
      </div>
      {frame.kind === "drawer" && areaWidth > 0 && (
        <span className="sr-only">
          <button onClick={closeColumn}>{t("side.drawerClose")}</button>
        </span>
      )}
    </>
  );
}

/**
 * The work area: the main card (conversation or page) and, when `side`, the right side. Measures
 * itself (narrow window, the side's width limits) and sets --side-shift for 让位.
 */
export function SideWorkArea({ side, children }: { side: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [areaWidth, setAreaWidth] = useState(0);
  const { sidePaneWidth } = useAppearance();
  const { sideMode, sideLaneWhenHidden, sideNarrow, sidePageBar } = useUiPrefs();
  const ctx = useSideView();
  const layout = useSide((s) => s.layout);
  const mode = useSide((s) => s.mode);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setAreaWidth(w);
      setSideWorkWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const off = registerSideAnchor(el);
    return () => {
      ro.disconnect();
      off();
    };
  }, []);
  const frame = sideFrame({
    areaWidth,
    stored: sidePaneWidth,
    open: side && layout.open,
    pages: side ? lanePages(layout, ctx).length : 0,
    laneWhenHidden: sideLaneWhenHidden,
    pageBar: sidePageBar,
    mode: sideMode,
    layered: side ? (mode?.kind ?? null) : null,
  });
  useEffect(() => setNarrow(frame.narrow), [frame.narrow]);
  // The gutters (§19) follow the column: the 让位 shift, and the part of the card a float / drawer covers.
  const cover = frame.kind === "float" || frame.kind === "drawer" ? Math.max(0, frame.width - frame.inFlow) : 0;
  useEffect(() => publishSideFrame(frame.shift, cover), [frame.shift, cover]);
  // 窄窗口时 = 自动收起: entering a narrow window closes the column (it still opens as a drawer).
  const wasNarrow = useRef(frame.narrow);
  useEffect(() => {
    if (frame.narrow && !wasNarrow.current && sideNarrow === "auto-collapse" && useSide.getState().layout.open) updateLayout((l) => setOpen(l, false));
    wasNarrow.current = frame.narrow;
  }, [frame.narrow, sideNarrow]);
  const drawer = frame.kind === "drawer";
  return (
    <div ref={ref} data-side-work className="relative flex min-w-0 flex-1" style={{ "--side-shift": `${frame.shift}px` } as CSSProperties}>
      {/* A click on the conversation closes the narrow-window drawer. */}
      <div className="shell-card relative isolate flex min-w-0 flex-1 overflow-hidden" data-focus-region="main" onPointerDownCapture={drawer ? closeColumn : undefined}>
        {children}
      </div>
      {side && <SideArea frame={frame} areaWidth={areaWidth} />}
    </div>
  );
}
