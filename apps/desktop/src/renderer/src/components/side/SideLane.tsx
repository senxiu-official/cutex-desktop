// The page buttons (docs/desktop-modules.md §18.3): one pill per page (only with ≥ 2 pages; with one page
// the title-bar toggle does it all). Where they sit follows 右栏布局 (lib/sideFrame.ts `lane` / `strip`):
// - 竖条 + 标签页 (★, owner 2026-10-14): this vertical lane between the conversation and the column, open
//   or closed; while open its end away from the pills (bottom, or top with 页按钮位置 = 底) holds the page
//   in view's actions (钉住, ⤢ ⛶, ⋯) and 收起侧栏, visible on lane hover / keyboard focus, their slots
//   reserved while closed so the pills never jump. The
//   cards' own headers are the horizontal tab rows.
// - 仅标签页: while the column is open, a horizontal tab row at its top (SideTabStrip.tsx, page actions at
//   its right end); while it is closed (and 右栏收起时 = 保留页按钮), this lane with pills only.
// Pill position 顶 / 中 / 底 = Settings → 页按钮位置 (the lane only).
// A pill holds one icon per card (badges per icon), a grip along its left edge (dots stacked
// vertically) stands for the whole page; "+" after the last pill = new page.
// Click (lib/sideLaneClick): another page → open the column on it; the page in view → an icon of a
// collapsed card expands it, of a visible card focuses / flashes it; otherwise nothing (setting
// 点击当前页图标 = 收起侧栏: close the column). Right-click: the grip = page menu, an icon = card menu.
// Drag (lib/sideDnd.ts): an icon = that card, the grip = the whole page; while a card / tab is dragged
// the "+" slot becomes a dashed "新页" target and the pill shows the insertion / join / merge state.
import { Expand, Maximize2, Minimize2, MoreHorizontal, PanelRightClose, Pin, PinOff, Plus, Shrink } from "lucide-react";
import { useI18n } from "../../i18n";
import { contextMenu, openMenuFrom } from "../../lib/contextMenu";
import { cardName, newPage, pageButtonClick, pageLabel, pinnedFromFloatNow, toggleMode, togglePin } from "../../lib/sideActions";
import type { SideRegistry } from "../../lib/sideComponents";
import { pageInView, type SideLayout, type SidePage, type SideViewContext } from "../../lib/sideLayout";
import { useSide } from "../../lib/sideLayoutStore";
import { cardMenu, pageMenu } from "../../lib/sideMenus";
import { attentionText, pillContent, type PillContent } from "../../lib/sidePills";
import { useUiPrefs } from "../../lib/prefs";
import { pillTooltip } from "../../lib/sideText";
import { sideDragHandle, useSideDnd } from "../../lib/sideDnd";
import { toggleSideColumn } from "../../lib/sideOpen";

const ANCHOR = { top: "justify-start", center: "justify-center", bottom: "justify-end" } as const;

export function Badges({ attention, unread, busy, active }: { attention: number; unread: boolean; busy: boolean; active: boolean }) {
  const ring = active ? "shadow-[0_0_0_2px_var(--bg)]" : "shadow-[0_0_0_2px_var(--win)]";
  return (
    <>
      {attention > 0 && (
        <span className={`absolute -top-[3px] -right-[5px] z-[1] h-3.5 min-w-3.5 rounded-[7px] bg-danger px-[3px] text-center text-[9px] leading-[14px] font-bold text-white ${ring}`}>{attentionText(attention)}</span>
      )}
      {attention === 0 && unread && <span className={`absolute top-px right-px h-[7px] w-[7px] rounded-full bg-accent ${ring}`} />}
      {busy && <span className="side-busy absolute right-px bottom-px h-1.5 w-1.5 rounded-full bg-ok" />}
    </>
  );
}

/** One page button; `across` = in the horizontal tab row (icons left → right), else in the vertical lane. */
export function Pill({ page, index, pill, active, open, flash, layout, ctx, registry, across }: { page: SidePage; index: number; pill: PillContent; active: boolean; open: boolean; flash: boolean; layout: SideLayout; ctx: SideViewContext; registry: SideRegistry; across: boolean }) {
  const { t } = useI18n();
  const filled = active && open;
  const name = pageLabel(page);
  const tip = pillTooltip(page, index, pill, layout, ctx);
  const drop = useSideDnd((s) => (s.target?.kind === "pill" && s.target.pageId === page.id ? s.target : null));
  const draggedPage = useSideDnd((s) => s.drag?.type === "page" && s.drag.pageId === page.id);
  const draggedCard = useSideDnd((s) => (s.drag?.type === "card" ? s.drag.cardId : null));
  const joinCard = drop?.op === "join" ? drop.cardId : null;
  const dropLook =
    drop?.op === "merge" || drop?.op === "pin"
      ? "shadow-[0_0_0_2px_var(--accent)]"
      : drop?.op === "insert" || drop?.op === "join"
        ? "bg-[color-mix(in_srgb,var(--accent)_9%,transparent)]"
        : "";
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      aria-label={`${name}${pill.attention ? ` · ${t("side.pill.attention", { n: pill.attention })}` : ""}`}
      title={tip}
      data-side-pill={page.id}
      onClick={() => pageButtonClick(page.id)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        pageButtonClick(page.id);
      }}
      onContextMenu={contextMenu(() => pageMenu(page.id))}
      className={`relative flex shrink-0 items-center gap-px rounded-[15px] transition-[background,opacity,box-shadow] outline-offset-1 select-none ${
        across ? `h-[26px] flex-row py-px pr-px ${pill.launcher ? "pl-px" : "pl-2"}` : "w-[30px] flex-col py-[3px]"
      } ${
        filled ? "bg-background text-foreground shadow-[var(--card-shadow),0_0_0_1px_var(--card-border)]" : "text-muted hover:bg-hover hover:text-foreground"
      } ${flash ? "side-flash" : ""} ${dropLook} ${draggedPage ? "opacity-45" : ""}`}
    >
      {!pill.launcher && (
        <span
          aria-hidden
          data-side-pill-grip={page.id}
          {...sideDragHandle(() => ({ type: "page", pageId: page.id }))}
          className={`side-pill-grip absolute inset-y-0 left-0 z-[2] flex cursor-grab flex-col items-center justify-center gap-0.5 rounded-l-[15px] hover:bg-foreground/10 ${across ? "w-2 pl-px" : "w-1.5"}`}
        >
          <i className="block h-0.5 w-0.5 rounded-full bg-current" />
          <i className="block h-0.5 w-0.5 rounded-full bg-current" />
          <i className="block h-0.5 w-0.5 rounded-full bg-current" />
        </span>
      )}
      {pill.launcher ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-xl border-[1.5px] border-dashed border-subtle">
          <Plus size={12} />
        </span>
      ) : (
        pill.icons.map((icon) => {
          const entry = registry.get(icon.kind);
          const Icon = entry?.item.icon;
          const card = page.cards.find((c) => c.id === icon.cardId);
          return (
            <button
              key={icon.cardId}
              tabIndex={-1}
              data-side-pill-card={icon.cardId}
              aria-label={card ? cardName(card) : icon.kind}
              {...sideDragHandle(() => ({ type: "card", cardId: icon.cardId }))}
              onClick={(e) => {
                e.stopPropagation();
                pageButtonClick(page.id, icon.cardId);
              }}
              onContextMenu={(e) => {
                e.stopPropagation();
                contextMenu(() => cardMenu(icon.cardId))(e);
              }}
              className={`relative flex h-6 w-6 items-center justify-center rounded-xl hover:bg-hover ${
                joinCard === icon.cardId ? "bg-[color-mix(in_srgb,var(--accent)_25%,transparent)] outline-[1.5px] -outline-offset-1 outline-accent outline-dashed" : ""
              } ${draggedCard === icon.cardId ? "opacity-45" : ""}`}
            >
              {Icon ? <Icon size={14} className={icon.collapsed ? "opacity-40" : undefined} /> : <span className="text-[10px]">?</span>}
              <Badges attention={icon.attention} unread={icon.unread} busy={icon.busy} active={filled} />
            </button>
          );
        })
      )}
      {pill.more > 0 && <span className={`text-[10px] font-semibold text-subtle ${across ? "px-1 leading-6" : "h-4 leading-4"}`}>+{pill.more}</span>}
    </div>
  );
}

/**
 * The vertical lane (≥ 2 pages): beside the open column with 竖条 + 标签页 (`actions`: 收起侧栏 + page
 * actions on top, slots kept while closed), or, either layout, alone while the column is closed.
 */
export function SideLane({ pages, open, actions, registry, ctx }: { pages: readonly SidePage[]; open: boolean; actions: boolean; registry: SideRegistry; ctx: SideViewContext }) {
  const { t } = useI18n();
  const { sidePillAnchor } = useUiPrefs();
  const layout = useSide((s) => s.layout);
  const tabInfo = useSide((s) => s.tabInfo);
  const flash = useSide((s) => s.flash);
  return (
    <div data-side-lane className="group/lane relative flex w-11 shrink-0 flex-col items-center py-0.5">
      {actions && sidePillAnchor === "bottom" && <LaneActions open={open} ctx={ctx} end={false} />}
      <div role="tablist" aria-orientation="vertical" aria-label={t("side.lane")} className={`flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 py-1 ${ANCHOR[sidePillAnchor]}`}>
        {pages.map((page, k) => (
          <Pill
            key={page.id}
            page={page}
            index={k}
            pill={pillContent(layout, page, ctx, (id) => tabInfo[id])}
            active={layout.activePage === page.id}
            open={open}
            flash={flash?.pageId === page.id && (!open || layout.activePage !== page.id)}
            layout={layout}
            ctx={ctx}
            registry={registry}
            across={false}
          />
        ))}
        <Tail />
      </div>
      {actions && sidePillAnchor !== "bottom" && <LaneActions open={open} ctx={ctx} end />}
    </div>
  );
}

/**
 * 收起侧栏 + the page actions, at the lane's end away from the pills (owner 2026-10-14: no empty gap above
 * the pills): at the bottom with 页按钮位置 顶 / 中 (收起侧栏 last, in the corner), at the top with 底.
 */
function LaneActions({ open, ctx, end }: { open: boolean; ctx: SideViewContext; end: boolean }) {
  return end ? (
    <div className="mt-1.5 flex shrink-0 flex-col items-center">
      <PageActions open={open} ctx={ctx} />
      <CollapseButton open={open} />
    </div>
  ) : (
    <div className="mb-1.5 flex shrink-0 flex-col items-center">
      <CollapseButton open={open} />
      <PageActions open={open} ctx={ctx} />
    </div>
  );
}

/**
 * 收起侧栏 at the lane's outer end (same as the title-bar toggle / Ctrl+Alt+B). Shown only while the
 * pointer is over the lane or the button has keyboard focus (opacity, so nothing moves); its slot stays
 * reserved while the column is closed, so the pills do not jump when the column opens / closes.
 */
function CollapseButton({ open }: { open: boolean }) {
  const { t } = useI18n();
  if (!open) return <span aria-hidden className="h-7 w-7 shrink-0" />;
  return (
    <button
      onClick={toggleSideColumn}
      title={t("side.laneCollapseHint", { key: "Ctrl+Alt+B" })}
      aria-label={t("side.laneCollapse")}
      data-side-lane-collapse
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity group-hover/lane:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100"
    >
      <PanelRightClose size={16} />
    </button>
  );
}

const LANE_BTN = "flex h-6 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity group-hover/lane:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100";

/**
 * The page in view's actions under 收起侧栏 (§18.3): 钉住 (悬浮 only), ⤢ ⛶ for the page, ⋯ page menu. Same
 * hover-only look; the slots stay reserved while the column is closed (or on an empty launcher page) so
 * the pills do not jump.
 */
function PageActions({ open, ctx }: { open: boolean; ctx: SideViewContext }) {
  const { t } = useI18n();
  const { sideMode } = useUiPrefs();
  const layout = useSide((s) => s.layout);
  const mode = useSide((s) => s.mode);
  const narrow = useSide((s) => s.narrow);
  const page = open ? pageInView(layout, ctx) : null;
  const pinned = pinnedFromFloatNow();
  const pinSlot = sideMode === "float" || pinned;
  const pin = open && !mode && !narrow && pinSlot;
  const pageMode = mode && mode.card === null ? mode.kind : null;
  const modes = !!page && page.cards.length > 0;
  const blank = <span aria-hidden className="h-6 w-7 shrink-0" />;
  const modeButton = (kind: "maximised" | "fullscreen") => {
    if (!modes) return blank;
    const on = pageMode === kind;
    const Icon = kind === "maximised" ? (on ? Minimize2 : Maximize2) : on ? Shrink : Expand;
    const key = kind === "maximised" ? "Ctrl+Shift+M" : "Shift+F11";
    const tip = on ? t("side.restoreHint", { key }) : t(kind === "maximised" ? "side.maximisePage" : "side.fullscreenPage", { key });
    return (
      <button onClick={() => toggleMode(kind, null)} title={tip} aria-label={tip} aria-pressed={on} data-side-page-mode={kind} className={`${LANE_BTN} ${on ? "bg-hover text-foreground opacity-100" : ""}`}>
        <Icon size={14} />
      </button>
    );
  };
  return (
    <div role="toolbar" aria-orientation="vertical" aria-label={t("side.pageActions")} data-side-page-actions className="flex shrink-0 flex-col items-center">
      {pinSlot &&
        (pin ? (
          <button onClick={togglePin} title={t(pinned ? "side.unpin" : "side.pin")} aria-label={t(pinned ? "side.unpin" : "side.pin")} aria-pressed={pinned} className={`${LANE_BTN} ${pinned ? "text-accent" : ""}`}>
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        ) : (
          blank
        ))}
      {modeButton("maximised")}
      {modeButton("fullscreen")}
      {page ? (
        <button onClick={(e) => openMenuFrom(e.currentTarget, pageMenu(page.id))} title={t("side.pageMenu")} aria-label={t("side.pageMenu")} className={LANE_BTN}>
          <MoreHorizontal size={14} />
        </button>
      ) : (
        blank
      )}
    </div>
  );
}

/** The "+" after the last pill (新页面…); while a card / tab is dragged, a dashed "新页" drop target of the same slot. */
export function Tail({ across = false }: { across?: boolean }) {
  const { t } = useI18n();
  const dragging = useSideDnd((s) => s.drag !== null && s.drag.type !== "page");
  const over = useSideDnd((s) => s.target?.kind === "new" && s.target.via === "tail");
  const slot = across ? "h-[26px] w-[26px]" : "h-[30px] w-[30px]";
  return (
    <div data-side-tail className={`flex shrink-0 items-center justify-center ${slot}`}>
      {dragging ? (
        <span
          title={t("side.dnd.newPageShort")}
          className={`flex items-center justify-center rounded-full border-[1.5px] border-dashed text-accent ${slot} ${
            over ? "border-accent bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]" : "border-[color-mix(in_srgb,var(--accent)_55%,transparent)]"
          }`}
        >
          <Plus size={13} />
        </span>
      ) : (
        <button onClick={newPage} title={t("side.newPageHint", { key: "Ctrl+Shift+N" })} aria-label={t("side.newPageItem")} className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-subtle opacity-70 hover:bg-hover hover:text-foreground hover:opacity-100">
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}
