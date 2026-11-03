import { isImeComposing } from "../lib/ime";
// The Settings Shelf (owner 2026-10-21; docs/desktop-modules.md §24.14; lib/settingsShelf): one global Shelf
// beside the real UI — on the left by default, between the sidebar card and the work area (a slot in
// components/PaneHost; the window bar's host / sidebar group stays over the sidebar), or at the window's
// right edge; the full height of the work row. One card (owner 2026-10-21: a normal width, the categories
// merged into it): the header (设置 › page, search, ⇄, ⤢, ×) across the top, then the category nav as the
// left column — search on top, icon + name rows with a line between the groups, folded to icons (the name
// in the tooltip) by the owner or when the card is really narrow — and the category page beside it
// (components/Settings `Settings`, the `settings.page` items of every module). It moves to the other side,
// is dragged wider at its inner edge, and maximises over the whole work row: then the nav is the wide nav
// with the group names outside the card (= the old full-window Settings). One element whatever the place:
// the Shelf is portalled into a node of its own that moves between the left slot and the App's anchor (no
// remount). Never a drop target (`data-no-drop`). The page header's 在主界面调整 puts a region of the real
// UI into edit state while this Shelf stays open (components/CustomizeHost). Ctrl+, toggles it; Esc closes
// it after the inner layers (lib/escChain, `close-settings`).
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { observeSync } from "../lib/syncResize";
import { ArrowLeftRight, ChevronRight, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { resetDragonSize } from "../lib/aboutDragon";
import { settingsNavGroups, settingsTab } from "../lib/settingsNav";
import { setSettingsHost } from "../lib/settingsHost";
import { useSettingsAffectsHover } from "../lib/panelSettings";
import {
  closeSettingsShelf,
  inSettingsShelf,
  moveSettingsShelf,
  setSettingsRailLabels,
  setSettingsShelfWidth,
  settingsShelfLayout,
  SETTINGS_NAV_W,
  SETTINGS_SHELF_DEFAULT_W,
  SETTINGS_SHELF_MIN_W,
  toggleSettingsShelfMaximized,
  setSettingsShelfLive,
  useSettingsShelf,
  useSettingsShelfLive,
  useSettingsShelfSlot,
  settingsRowKeep,
  useSettingsRowNeed,
} from "../lib/settingsShelf";
import { usePortraitOn, useSettingsShelfMaximized } from "../lib/portrait";
import { setReservedWidth } from "../lib/workspaces";
import { keyResize, resizeDrag } from "../lib/columnGlide";
import { rowGive } from "../lib/sideResize";
import { hideWidthTip, showWidthTip } from "../lib/widthTip";
import { ItemBoundary } from "../modules/Outlet";
import { useSlot } from "../modules/react";
import { useInWindow, useWindowKey } from "../lib/windowScope";
import type { AppSlotEntry, PageParams } from "../modules/slots";
import { SETTINGS_PAGE, useApp } from "../store";
import { holdPageBody, SUBNAV_ITEM, SUBNAV_OFF, SUBNAV_ON } from "./Page";
import { Settings, SettingsSearchResults } from "./Settings";
import { Tag } from "./Tag";
import { bindingLabel, keyVar, matchesCommand } from "../lib/keybindings";
import { withKey } from "../lib/useKeybindings";
import { ownerWindowOf } from "../lib/ownerWindow";

const RAIL_BTN = "relative flex size-[30px] shrink-0 items-center justify-center rounded-ctl text-muted transition-[background,color] duration-(--motion-short) ease-(--ease-standard) hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none";
const HEAD_BTN = "flex size-7 shrink-0 items-center justify-center rounded-md text-muted outline-none hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60";

/** One category of the nav: its icon (folded) or icon + name (named, maximised), the badge, the page in view marked. */
function Category({ entry, current, wide }: { entry: AppSlotEntry<"settings.page">; current: boolean; wide: boolean }) {
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  const { item } = entry;
  const badge = item.useBadge?.() ?? null;
  const Icon = item.icon;
  const disabled = entry.mode !== "show";
  const name = t(item.titleKey);
  const why = disabled && !entry.waiting ? t("modules.needsCapability", { list: entry.missing.join(", ") }) : null;
  const go = () => {
    // Hold the current page until the next one is ready (no building up card by card).
    if (!current) holdPageBody();
    openSettings(item.page);
  };
  if (wide) {
    return (
      <button
        data-settings-category={item.page}
        aria-current={current ? "page" : undefined}
        disabled={disabled}
        title={why ?? undefined}
        onClick={go}
        className={`${SUBNAV_ITEM} ${current ? SUBNAV_ON : SUBNAV_OFF} ${disabled && !current ? "opacity-60" : ""} focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none`}
      >
        <Icon size={15} strokeWidth={1.75} className="shrink-0" />
        <span className="truncate">{name}</span>
        {badge?.dot && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-label={t("settings.about.attention")} />}
        {badge?.text && <Tag className="ml-auto">{badge.text}</Tag>}
      </button>
    );
  }
  const tip = [name, why, badge?.text].filter(Boolean).join("\n");
  return (
    <button
      data-settings-category={item.page}
      aria-current={current ? "page" : undefined}
      aria-label={name}
      disabled={disabled}
      title={tip}
      onClick={go}
      className={`${RAIL_BTN} ${current ? "bg-surface-2 text-foreground" : ""} ${disabled && !current ? "opacity-50" : ""}`}
    >
      <Icon size={16} strokeWidth={1.75} />
      {(badge?.dot || badge?.text) && <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-danger" />}
    </button>
  );
}

/** The nav's 显示分类名称 / 只显示图标 toggle (folded by the owner, or too narrow for the names: then off). */
function NamesToggle({ named, labels }: { named: boolean; labels: boolean }) {
  const { t } = useI18n();
  const tooNarrow = labels && !named;
  const Icon = named ? PanelLeftClose : PanelLeftOpen;
  const label = t(tooNarrow ? "settingsShelf.railTooNarrow" : named ? "settingsShelf.railIcons" : "settingsShelf.railNames");
  return (
    <button
      data-settings-rail-names=""
      aria-pressed={named}
      disabled={tooNarrow}
      title={label}
      aria-label={label}
      onClick={() => setSettingsRailLabels(!named)}
      className={named ? `${SUBNAV_ITEM} ${SUBNAV_OFF} disabled:opacity-50` : `${RAIL_BTN} disabled:opacity-50`}
    >
      <Icon size={15} strokeWidth={1.75} className="shrink-0" />
      {named && <span className="truncate">{t("settingsShelf.railIcons")}</span>}
    </button>
  );
}

function useGroups() {
  const pages = useSlot("settings.page");
  return settingsNavGroups(pages);
}

/** Maximised (the old full-window Settings): the wide nav with the group names, outside the card on the window. */
function WideNav({ tab }: { tab: string }) {
  const { t } = useI18n();
  const groups = useGroups();
  return (
    <nav data-settings-rail="wide" aria-label={t("settingsShelf.rail")} className="flex shrink-0 flex-col overflow-y-auto pt-1 pr-2 pb-2 select-none" style={{ width: SETTINGS_NAV_W }}>
      {groups.map(({ group, entries }) => (
        <div key={group} className="mb-3">
          <div className="px-2 pt-1 pb-1 text-sm text-subtle">{t(`settings.group.${group}` as MessageKey)}</div>
          {entries.map((e) => (
            <ItemBoundary key={e.item.id} moduleId={e.moduleId}>
              <Category entry={e} current={tab === e.item.page} wide />
            </ItemBoundary>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * The category nav inside the card, its left column (owner 2026-10-21: merged, as the old Settings' nav):
 * search on top, then the categories by group (a thin line between groups), the names toggle at the bottom.
 * `named`: icon + name rows (the default); else icons with the names in the tooltips.
 */
function CategoryNav({ tab, named, labels, width, onSearch }: { tab: string; named: boolean; labels: boolean; width: number; onSearch(): void }) {
  const { t } = useI18n();
  const groups = useGroups();
  const search = t("shell.settingsSearch.placeholder");
  return (
    <nav data-settings-rail={named ? "named" : ""} aria-label={t("settingsShelf.rail")} className="flex shrink-0 flex-col border-r border-border/60 select-none" style={{ width }}>
      {/* The categories scroll; the names toggle stays at the bottom. */}
      <div className={`flex min-h-0 flex-1 flex-col gap-[2px] overflow-y-auto py-1.5 [scrollbar-width:none] ${named ? "px-2" : "items-center"}`}>
        <button data-settings-search-button="" title={withKey(search, bindingLabel("settingsSearch", " · "))} aria-label={search} onClick={onSearch} className={named ? `${SUBNAV_ITEM} ${SUBNAV_OFF}` : RAIL_BTN}>
          <Search size={named ? 15 : 16} strokeWidth={named ? 1.75 : 2} className="shrink-0" />
          {named && <span className="truncate">{search}</span>}
        </button>
        {groups.map(({ group, entries }) => (
          <Fragment key={group}>
            <span aria-hidden data-settings-rail-sep="" className={`my-1 h-px shrink-0 bg-border/70 ${named ? "mx-2" : "w-5"}`} />
            <div role="group" aria-label={t(`settings.group.${group}` as MessageKey)} className={`flex flex-col gap-[2px] ${named ? "" : "items-center"}`}>
              {entries.map((e) => (
                <ItemBoundary key={e.item.id} moduleId={e.moduleId}>
                  <Category entry={e} current={tab === e.item.page} wide={named} />
                </ItemBoundary>
              ))}
            </div>
          </Fragment>
        ))}
      </div>
      <div className={`flex shrink-0 flex-col border-t border-border/60 py-1 ${named ? "px-2" : "items-center"}`}>
        <NamesToggle named={named} labels={labels} />
      </div>
    </nav>
  );
}

/** 设置 › <page> (› <profile>) in the card's header (the `shell.settings` page item's useTitle); earlier crumbs open their page. */
function Crumbs({ entry, params }: { entry: AppSlotEntry<"main.page">; params: PageParams }) {
  const crumbs = entry.item.useTitle(params);
  return (
    <div data-settings-crumbs="" className="flex min-w-0 items-center gap-0.5">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        const to = c.to;
        return (
          <Fragment key={i}>
            {i > 0 && <ChevronRight size={13} className="shrink-0 text-subtle" />}
            {to && !last ? (
              <button onClick={() => useApp.getState().openSettings((to.params?.tab ?? "general") as never)} className="min-w-0 truncate rounded px-1 text-sm text-muted hover:bg-surface-2 hover:text-foreground">
                {c.text}
              </button>
            ) : (
              <span className={`min-w-0 truncate px-1 text-sm ${last ? "font-semibold" : "text-muted"}`}>{c.text}</span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** The search field in the card's header (as in the old nav): typing shows the results in place of the page. */
function SearchField({ query, setQuery, input }: { query: string; setQuery(q: string): void; input: RefObject<HTMLInputElement | null> }) {
  const { t } = useI18n();
  return (
    <div className="relative w-44 min-w-0 shrink">
      <Search size={13} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-subtle" />
      <input
        ref={input}
        data-settings-search=""
        type="search"
        role="combobox"
        aria-expanded={query.trim() !== ""}
        aria-controls="settings-search-results"
        aria-label={t("shell.settingsSearch.placeholder")}
        title={t("shell.settingsSearch.title", keyVar("settingsSearch", " · "))}
        placeholder={t("shell.settingsSearch.placeholder")}
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (isImeComposing(e)) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (query) setQuery("");
            else e.currentTarget.blur();
          }
        }}
        className="h-7 w-full rounded-md border border-border bg-background pr-6 pl-7 text-ui/[inherit] outline-none select-text placeholder:text-subtle focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <button aria-label={t("shell.settingsSearch.clear")} title={t("shell.settingsSearch.clear")} onClick={() => (setQuery(""), input.current?.focus())} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-subtle hover:text-foreground">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/** The width handle on the Shelf's inner edge: drag (live, stored on release), arrow keys, double-click = default. */
function useWidthHandle(side: "left" | "right", current: number, setLive: (w: number | null) => void) {
  // 宽度规则 3 (owner 2026-10-21): it takes only from the work row beside it, as much as the row can give (lib/sideResize rowGive).
  const drag = useRef<{ x: number; w: number; most: number } | null>(null);
  const sign = side === "right" ? -1 : 1;
  return {
    onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.currentTarget.setAttribute("data-dragging", "");
      resizeDrag(true);
      drag.current = { x: e.clientX, w: current, most: current + rowGive(side === "left" ? "left" : "right") };
      showWidthTip(e.currentTarget, current, { y: e.clientY });
    },
    onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
      const d = drag.current;
      if (!d) return;
      const w = Math.max(SETTINGS_SHELF_MIN_W, Math.min(d.most, d.w + sign * (e.clientX - d.x)));
      setLive(w);
      showWidthTip(e.currentTarget, w, { y: e.clientY });
    },
    onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
      const d = drag.current;
      drag.current = null;
      hideWidthTip();
      e.currentTarget.removeAttribute("data-dragging");
      if (!d) return;
      setSettingsShelfWidth(Math.min(d.most, d.w + sign * (e.clientX - d.x)));
      setLive(null);
      resizeDrag(false);
    },
    onDoubleClick() {
      setSettingsShelfWidth(SETTINGS_SHELF_DEFAULT_W);
      setLive(null);
    },
    onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const wider = (e.key === "ArrowLeft") === (side === "right");
      // As a pointer drag (宽度规则 1 / 3): it takes only what the work row beside it can give, the rest of the row
      // stays (a drag session, lib/columnGlide keyResize); stored once the keys rest.
      const width = Math.min(current + rowGive(side === "left" ? "left" : "right"), current + (wider ? 24 : -24));
      const handle = e.currentTarget;
      keyResize(
        () => {
          setLive(width);
          showWidthTip(handle, Math.max(SETTINGS_SHELF_MIN_W, width), { keys: true });
        },
        () => {
          setSettingsShelfWidth(width);
          setLive(null);
        },
      );
    },
  };
}

function OpenShelf({ row, inSlot }: { row: HTMLElement; inSlot: boolean }) {
  const win = ownerWindowOf(row);
  const { t } = useI18n();
  const params = useSettingsShelf((s) => s.params);
  const side = useSettingsShelf((s) => s.side);
  const stored = useSettingsShelf((s) => s.width);
  // Portrait (lib/portrait, P2): always maximised there (no room beside the stack) — its own toggle is not offered.
  const maximized = useSettingsShelfMaximized();
  const portrait = usePortraitOn();
  const labels = useSettingsShelf((s) => s.railLabels);
  const docked = useSettingsShelfSlot((s) => !!s.left);
  const tab = settingsTab(params);
  const affects = useSettingsAffectsHover(tab, maximized);
  const title = useSlot("main.page").find((e) => e.item.id === SETTINGS_PAGE && e.mode === "show");
  const box = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [rowWidth, setRowWidth] = useState(0);
  // Live while an edge is dragged: its inner edge, or the sidebar's edge beside it (lib/settingsShelf, #38).
  const live = useSettingsShelfLive((s) => s.width);
  const setLive = setSettingsShelfLive;
  // Leaving Settings: the 关于 dragon starts small next time; the host pages edit the focus host again.
  useEffect(() => resetDragonSize, []);
  useEffect(() => () => setSettingsHost(null), []);
  // The window's work row (the App row holding PaneHost and the anchor) less the docked sidebar card: the
  // card keeps a conversation's width beside it.
  useLayoutEffect(() => {
    const sidebar = () => row.querySelector<HTMLElement>("[data-pane-host] > .sidebar-card");
    // What the card and the conversation share: the row less the docked sidebar card, the 8 px margins round
    // the cards (PaneHost's padding, the gap after the sidebar card) and the Shelf's own 8 px seam.
    const measure = () => {
      const bar = sidebar();
      setRowWidth(row.clientWidth - (bar ? Math.round(bar.getBoundingClientRect().width) + 24 : 16) - 8);
    };
    measure();
    // In the same frame (lib/syncResize: flushed synchronously, a ResizeObserver runs after layout, before
    // paint): the card's width follows the window at once instead of a frame late (owner 2026-10-21: panels
    // flying on a window resize) — in the same commit as the work row's.
    const offs = [observeSync(row, measure)];
    const bar = sidebar();
    if (bar) offs.push(observeSync(bar, measure));
    return () => offs.forEach((off) => off());
    // The slot comes and goes with the docked sidebar: look for its card again.
  }, [row, docked]);
  // The work row's need (its conversation's Shelf expanded): the card gives that room before the Shelf would be a drawer.
  const need = useSettingsRowNeed((s) => s.need);
  const { card: width, nav, named } = settingsShelfLayout(live ?? stored, rowWidth, labels, settingsRowKeep(need, rowWidth));
  // The box: the card and the 8 px seam toward the work row (beside the sidebar card it is the box's own right padding).
  const taken = maximized ? 0 : width + 8;
  // The work row beside it is narrower (the sidebar's automatic rail with two workspaces, lib/workspaces).
  const inMine = useInWindow();
  useEffect(() => {
    inMine(() => setReservedWidth(taken));
    return () => inMine(() => setReservedWidth(0));
  }, [taken, inMine]);
  // Ctrl+F or "/" (outside a text field) focuses the search while the focus is in the Shelf, or it is maximised.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isImeComposing(e)) return;
      if (!maximized && !inSettingsShelf(e.target) && !inSettingsShelf(win.document.activeElement)) return;
      if (!matchesCommand("settingsSearch", e)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [maximized, win]);
  // Opening from elsewhere (Ctrl+, ⚙, a deep link): the focus comes into the Shelf, so Esc closes it.
  useEffect(() => {
    const el = box.current;
    if (el && !el.contains(el.ownerDocument.activeElement)) el.focus({ preventScroll: true });
  }, []);
  const handle = useWidthHandle(side, width, setLive);
  const focusSearch = () => {
    input.current?.focus();
    input.current?.select();
  };
  const right = side === "right";
  const page = query.trim() ? <SettingsSearchResults query={query} input={input} current={tab} onNavigate={() => setQuery("")} /> : <Settings params={params} />;
  // The card is `overflow-clip`, not `hidden`: a clipped box that is not a scroll container can never be scrolled by a focus /
  // scrollIntoView of something inside it (that slid the whole page up, nav and content stopping half way).
  const card = (
    <div data-settings-card="" className="shell-card relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-clip">
      <div data-settings-head="" className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/60 pr-1.5 pl-3">
        <span className="min-w-0 flex-1">
          {title ? (
            <ItemBoundary moduleId={title.moduleId} resetKey={SETTINGS_PAGE}>
              <Crumbs entry={title} params={params} />
            </ItemBoundary>
          ) : (
            <span className="px-1 text-sm font-semibold">{t("settings.title")}</span>
          )}
        </span>
        <SearchField query={query} setQuery={setQuery} input={input} />
        {!maximized && (
          <button data-settings-move="" title={t(right ? "shelf.moveLeft" : "shelf.moveRight")} aria-label={t(right ? "shelf.moveLeft" : "shelf.moveRight")} onClick={() => moveSettingsShelf()} className={HEAD_BTN}>
            <ArrowLeftRight size={14} />
          </button>
        )}
        {!portrait && (
          <button
            data-settings-maximize=""
            title={t(maximized ? "settingsShelf.restore" : "settingsShelf.maximize")}
            aria-label={t(maximized ? "settingsShelf.restore" : "settingsShelf.maximize")}
            aria-pressed={maximized}
            onClick={toggleSettingsShelfMaximized}
            className={HEAD_BTN}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        )}
        <button data-settings-close="" title={`${t("settings.close")} · Esc`} aria-label={t("settings.close")} onClick={closeSettingsShelf} className={HEAD_BTN}>
          <X size={15} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* Beside the row: the category nav is the card's left column (maximised it is the wide nav outside). */}
        {!maximized && <CategoryNav tab={tab} named={named} labels={labels} width={nav} onSearch={focusSearch} />}
        {/* The page column (components/Settings: header with the source tags, host picker, cards). */}
        {/* Design 006 v1 Q9: a card hovered outlines the panel(s) it affects in the real UI beside it. */}
        <div className="flex min-h-0 min-w-0 flex-1" data-settings-page-column="" {...affects}>
          {page}
        </div>
      </div>
    </div>
  );
  if (maximized) {
    // Over the whole work row (the real UI stays mounted under it): the wide nav, then the page.
    return (
      <aside ref={box} tabIndex={-1} data-settings-shelf="" data-settings-side={side} data-settings-max="" data-no-drop="" aria-label={t("settings.title")} className="absolute inset-0 z-[45] flex bg-win pt-2 pr-2 pb-2 pl-2 outline-none">
        <WideNav tab={tab} />
        {card}
      </aside>
    );
  }
  return (
    <aside
      ref={box}
      tabIndex={-1}
      data-settings-shelf=""
      data-settings-side={side}
      data-no-drop=""
      aria-label={t("settings.title")}
      data-settings-in-slot={inSlot ? "" : undefined}
      style={{ width: taken, order: inSlot ? undefined : right ? 1 : -1 }}
      className={`relative flex shrink-0 outline-none ${right ? "pr-1 pb-2" : inSlot ? "pr-2" : "pb-2 pl-1"}`}
    >
      {/* The inner edge: the width handle over the 8 px seam to the work row (in the slot the seam is the box's own right padding). */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("pane.width")}
        tabIndex={0}
        title={t("settingsShelf.resize")}
        data-settings-resize=""
        className={`side-handle-v absolute inset-y-0 z-10 w-2 cursor-col-resize outline-none ${right ? "-left-2" : inSlot ? "right-0" : "-right-2"}`}
        {...handle}
      />
      {card}
    </aside>
  );
}

/**
 * Mounted once in the window's work row (App): an anchor (its parent is the row), nothing else while closed.
 * The Shelf lives in a node of its own, portalled: on the left beside a docked sidebar the node sits in the
 * slot between the sidebar card and the work area (SettingsShelfSlot in components/PaneHost); right, left
 * without the sidebar, or maximised (over the whole row, outside the row's inert wrapper) at the anchor.
 * Moving the node never remounts the Shelf.
 */
export function SettingsShelf() {
  // The window it opened in draws it (multi-window P3).
  const here = useWindowKey();
  const open = useSettingsShelf((s) => s.open && s.win === here);
  const side = useSettingsShelf((s) => s.side);
  const maximized = useSettingsShelfMaximized();
  const slot = useSettingsShelfSlot((s) => s.left);
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [node] = useState(() => {
    const el = document.createElement("div");
    el.style.display = "contents";
    el.setAttribute("data-settings-node", "");
    return el;
  });
  const inSlot = !maximized && side === "left" && !!slot;
  // Placed before the Shelf opens (the node stays in place while closed): its content mounts attached.
  useLayoutEffect(() => {
    const target = inSlot ? slot : anchor;
    if (target && node.parentElement !== target) target.appendChild(node);
  }, [inSlot, slot, anchor, node]);
  useEffect(() => () => node.remove(), [node]);
  // Only while open: layoutParent reads computed styles (a style recalc on every render of a closed Shelf).
  const row = open && anchor ? layoutParent(anchor) : null;
  return (
    <div ref={setAnchor} data-settings-anchor="" style={{ display: "contents" }}>
      {open && row && createPortal(<OpenShelf row={row} inSlot={inSlot} />, node)}
    </div>
  );
}

/** The element that lays the anchor out: its first ancestor that is not `display: contents` (App wraps the row's children in one). */
function layoutParent(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p && p.parentElement && getComputedStyle(p).display === "contents") p = p.parentElement;
  return p;
}

/** The left place of the Settings Shelf: between the sidebar card and the work area (components/PaneHost). */
export function SettingsShelfSlot() {
  // This window's slot (multi-window P3).
  const slots = useSettingsShelfSlot.of(useWindowKey());
  const slotRef = useCallback((el: HTMLDivElement | null) => slots.setState({ left: el }), [slots]);
  return <div ref={slotRef} data-settings-slot="" style={{ display: "contents" }} />;
}
