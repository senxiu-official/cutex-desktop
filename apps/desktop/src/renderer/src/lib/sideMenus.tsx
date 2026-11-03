// Right-side menus (docs/desktop-modules.md §18.7): tab, card and page menus, the title bar's ＋ and
// the launcher lists. The menu way to every user override (移到页 / 移到新页面 / 拆到新卡片 / 合并到 /
// 恢复默认位置 / 重置 Shelf 布局) — drag and drop (P1b) runs the same reducers. Shell code: no feature names.
import { cardCloseForetell, cardMoveForetell } from "./menuForetells";
import { ArrowDown, ArrowRight, ArrowUp, Bot, ChevronDown, Columns2, Combine, Expand, Layers, Maximize2, Pencil, Pin, PinOff, Plus, RotateCcw, Split, X } from "lucide-react";
import { translate } from "../i18n";
import type { ItemId, Json } from "../modules/types";
import type { SideComponentItem } from "../modules/slots";
import { closeWarnings, sideReveal } from "./sideServices";
import { promptDialog, type MenuAction, type MenuEntry } from "./contextMenu";
import { openAgentSide, openSide } from "./sideOpen";
import { buildSidebar, type AgentRow } from "./sidebar";
import {
  cardCloseWarnings,
  cardName,
  closeCard,
  closeOtherTabs,
  closePage,
  closeTab,
  joinWarnings,
  newPage,
  otherTabsCloseWarnings,
  pageCloseWarnings,
  pageLabel,
  pinnedFromFloatNow,
  runLaneAction,
  toggleMode,
  togglePin,
} from "./sideActions";
import { getUiPrefs, setUiPref } from "./prefs";
import { launcherClickAction, sortLaunchers, splitLaunchers, withPin, type LauncherGroup, type LauncherPinDefault } from "./sideLaunchers";
import { STATUS_COMPONENT_PREFIX } from "./sideKinds";
import { newInstanceKey, newInstanceOpts, PLAIN_OPEN, type OpenModifiers } from "./openModifiers";
import { sideRegistry, sideViewNow, specFrom } from "./sideComponents";
import {
  activateTab,
  cardHolds,
  DEFAULT_ORDER,
  findCard,
  findPage,
  instanceVisible,
  lanePages,
  locate,
  MAX_CARDS,
  MAX_SHELF_PAGES,
  mergePages,
  moveCard,
  moveInstance,
  movePage,
  moveToNewPage,
  pageInView,
  pagesOfShelf,
  pinInstance,
  renamePage,
  resetLayout,
  restoreDefault,
  restoreKindDefault,
  setCollapsed,
  shelfLanePages,
  shelfOfPage,
  shownTab,
  splitInstance,
  switchPage,
  visibleCards,
  visibleTabs,
  type MoveTarget,
  type SidePage,
} from "./sideLayout";
import { liveConversation, setFocusedCard, setMode, updateLayout, useSide } from "./sideLayoutStore";
import { canGrow, toggleGrow, useGrow } from "./panelGrow";

const paneGrown = (cardId: string): boolean => {
  const t = useGrow.getState().target;
  return t?.kind === "shelf" && t.card === cardId;
};
import { agentHost, isColumnPage, useApp } from "../store";
import { entryGateNow } from "./hostGatingView";
import { refActionEntries } from "./refActions";
import { sidePageRef } from "./refs";
import { instanceRef } from "./refServices";
import { appModules } from "../modules/app";
import { pageKind } from "./paneLayout";

const activeHost = () => useApp.getState().hosts?.active ?? "local";

const ICON = 14;

const orderOf = (kind: ItemId) => specFrom(sideRegistry(), kind)?.order ?? DEFAULT_ORDER;
const specOf = (kind: ItemId) => specFrom(sideRegistry(), kind);

/** A close row that would end something confirms in place (click twice), naming what it ends. */
function armedClose(lines: readonly string[]): string | undefined {
  return lines.length ? translate("side.closeArmedMenu", { what: joinWarnings(lines) }) : undefined;
}

function title(text: string): MenuAction {
  return { label: text, note: true, disabled: true, onSelect: () => {} };
}

/** A component that can be opened from a launcher now (＋ menu, title-bar launcher, launcher page, empty column). */
export interface Launchable {
  kind: ItemId;
  label: string;
  icon: MenuAction["icon"];
  Icon: SideComponentItem["icon"];
  params: Json;
  order: number;
  pin: LauncherPinDefault;
  /** `instances: "multi"`: offers 「新…」 / Ctrl/⌘-click. */
  multi: boolean;
  /** Optional module-declared section for the empty Shelf. */
  category?: "content" | "tool";
  /** Status categories (`status:<id>`, §18.9) come after the tool kinds. */
  group: LauncherGroup;
}

function safeParams(read: (() => Json | null) | undefined): Json | null {
  if (!read) return null;
  try {
    return read();
  } catch {
    return null;
  }
}

/** Components that can be opened from a launcher (＋ menus, launcher page, empty column), by launcher order.
 * A new instance binds to the selected agent's host: components whose capabilities it lacks are left out. */
export function launchable(includePages = false): Launchable[] {
  const out: Launchable[] = [];
  const host = agentHost(useApp.getState());
  const registry = sideRegistry();
  for (const [kind, entry] of registry) {
    const launcher = entry.item.launcher;
    if (!launcher || !entryGateNow(host, entry).ok) continue;
    const params = safeParams(() => launcher.params());
    if (params === null) continue;
    const Icon = entry.item.icon;
    out.push({ kind, label: translate(entry.item.titleKey), icon: <Icon size={ICON} />, Icon, params, order: launcher.order, pin: launcher.pin, multi: entry.item.instances === "multi", category: launcher.category,
      group: kind.startsWith(STATUS_COMPONENT_PREFIX) ? "status" : "tool" });
  }
  // The same nav registry as the title bar's More menu. Derived page components omit Aside pages;
  // pure actions have no page target. Existing status launchers keep their single entry.
  if (includePages) for (const nav of appModules().snapshot("nav.primary")) {
    if (nav.mode !== "show" || (nav.item.area ?? "top") !== "top" || !("page" in nav.item.target)) continue;
    if (isColumnPage(nav.item.target.page)) continue;
    const kind = pageKind(nav.item.target.page) as ItemId;
    const entry = registry.get(kind);
    if (!entry || !entryGateNow(host, entry).ok || !entryGateNow(host, nav).ok) continue;
    const label = nav.item.title ?? translate(nav.item.titleKey);
    if (out.some((item) => item.kind === kind || (item.group === "status" && item.label === label && registry.get(item.kind)?.moduleId === nav.moduleId))) continue;
    const Icon = nav.item.icon;
    out.push({ kind, label, icon: <Icon size={ICON} />, Icon, params: Object.fromEntries(Object.entries(nav.item.target.params ?? {}).filter((pair): pair is [string, string] => pair[1] !== undefined)), order: nav.item.order ?? 500, pin: "never", multi: false, group: "page" });
  }
  return sortLaunchers(out);
}

/** Opens a launcher entry: into `pageId` (explicit page, beats overrides) or by the rules. */
export function launch(kind: ItemId, params: Json, pageId: string | null): void {
  openSide(kind, params, { ...(pageId ? { page: pageId } : {}), focus: true, reveal: true });
}

/** The params a `tabRow: "always"` card's ＋ opens (§18.4), or null when it offers no ＋ now. */
export function cardNewTabParams(item: SideComponentItem): Json | null {
  const launcher = item.launcher;
  if (item.tabRow !== "always" || item.instances !== "multi" || !launcher) return null;
  return safeParams(launcher.newParams) ?? safeParams(() => launcher.params());
}

/** A `tabRow: "always"` card's ＋: a new instance of its kind as a tab of THIS card (same page, same binding as the
 * tab it shows), shown and focused. The shown tab is touched first so placement's "most recently used card of the
 * kind" is this one even when the page holds two cards of the kind. */
export function newTabInCard(cardId: string): void {
  const layout = useSide.getState().layout;
  const at = findCard(layout, cardId);
  const shown = at?.card.active ?? at?.card.tabs[0];
  const inst = shown ? layout.instances[shown] : undefined;
  const entry = inst ? sideRegistry().get(inst.kind) : undefined;
  if (!at || !shown || !inst || !entry) return;
  const params = cardNewTabParams(entry.item);
  if (params === null) return;
  updateLayout((l) => activateTab(l, shown, Date.now()));
  openSide(inst.kind, params, { page: at.page.id, binding: inst.binding, focus: true, reveal: true });
}

/** The column a launcher works on: the focused tool column, or the one the hidden tool area would show. */
function launcherPage(): SidePage | null {
  return pageInView(useSide.getState().layout, sideViewNow());
}

/** v1.17 (§24): every tool column is on screen — the column with a visible pane of `kind`, else the focused one. */
function launcherPageFor(kind: ItemId): SidePage | null {
  const { layout } = useSide.getState();
  const ctx = sideViewNow();
  return lanePages(layout, ctx).find((p) => visibleCards(layout, p, ctx).some((c) => c.kind === kind)) ?? launcherPage();
}

/** The most recently used instance of `kind` the current agent can see, outside `page`. */
function instanceElsewhere(page: SidePage | null, kind: ItemId): string | null {
  const { layout } = useSide.getState();
  const ctx = sideViewNow();
  let best: string | null = null;
  for (const [id, inst] of Object.entries(layout.instances)) {
    if (inst.kind !== kind || !instanceVisible(layout, id, ctx)) continue;
    const at = locate(layout, id);
    if (!at || at.page.id === page?.id) continue;
    if (!best || inst.lastActiveAt > layout.instances[best]!.lastActiveAt) best = id;
  }
  return best;
}

/** This kind's card on `page` that the current agent can see. */
function cardOnPage(page: SidePage | null, kind: ItemId) {
  return page ? (visibleCards(useSide.getState().layout, page, sideViewNow()).find((c) => c.kind === kind) ?? null) : null;
}

/**
 * A title-bar launcher (or its ＋ menu row) pressed (lib/sideLaunchers launcherClickAction): not on the
 * current page → the normal placement rule; there → the page-button icon rule; `mods.newInstance` (Ctrl/⌘ / middle
 * click, 「新…」; lib/openModifiers) → a new tab of a multi-instance kind, in the
 * background unless `mods.focus` (Shift, or a menu row).
 */
export function pressLauncher(kind: ItemId, mods: OpenModifiers = PLAIN_OPEN): void {
  const newInstance = mods.newInstance;
  const entry = sideRegistry().get(kind);
  const launcher = entry?.item.launcher;
  if (!entry || !launcher) return;
  // v1.17 (§24): every tool column is on screen — the column holding a visible pane of this kind becomes
  // the focused one, and the same-column rule applies there (collapsed → expand, visible → focus + flash).
  const page = launcherPageFor(kind);
  if (page && useSide.getState().layout.open && page.id !== useSide.getState().layout.activePage && cardOnPage(page, kind)) updateLayout((l) => switchPage(l, page.id));
  const s = useSide.getState();
  const card = cardOnPage(page, kind);
  const action = launcherClickAction({
    newInstance,
    multi: entry.item.instances === "multi",
    open: s.layout.open,
    activePage: s.layout.activePage,
    layered: !!s.mode,
    page: page?.id ?? null,
    card: card ? { id: card.id, collapsed: card.collapsed } : null,
    elsewhere: card ? null : instanceElsewhere(page, kind),
    // 点击当前页图标 is no longer a setting (design 006 v1 Q5): the page in view stays (as the Rail, 10-22).
    setting: "stay",
  });
  if (action.kind === "reveal") {
    // Maximised / full screen: the mode follows the page (as a page-button switch does).
    if (s.mode?.card) setMode({ kind: s.mode.kind, card: null });
    if (sideReveal({ instanceId: action.instanceId }).status === "revealed") {
      const at = locate(useSide.getState().layout, action.instanceId);
      if (at) setFocusedCard(at.card.id);
    }
    return;
  }
  if (action.kind !== "open") {
    runLaneAction(action);
    return;
  }
  const params = action.fresh ? (safeParams(launcher.newParams) ?? safeParams(() => launcher.params())) : safeParams(() => launcher.params());
  if (params === null) return;
  if (action.fresh && !mods.focus) openSide(kind, params, { ...(action.page ? { page: action.page } : {}), ...newInstanceOpts(mods) });
  else launch(kind, params, action.page);
}

/** A 「新…」 menu row: a new instance, shown. */
const NEW_SHOWN: OpenModifiers = { newInstance: true, focus: true };
const newHint = () => translate("side.launcherNewHint", { key: newInstanceKey() });

/** Pin / unpin a launcher on the title bar (per device). */
export function setLauncherPinned(kind: ItemId, on: boolean): void {
  const pin = sideRegistry().get(kind)?.item.launcher?.pin;
  setUiPref("sideLauncherPins", withPin(getUiPrefs().sideLauncherPins, kind, pin, on));
}

function newLabel(label: string): string {
  return translate("side.launcherNew", { name: label });
}

/** Whether a multi-instance kind can open a new instance now (its `newParams`, else `params`). */
function canOpenNew(item: Launchable): boolean {
  if (!item.multi) return false;
  const launcher = sideRegistry().get(item.kind)?.item.launcher;
  return !!launcher && (launcher.newParams ? safeParams(launcher.newParams) !== null : true);
}

function pinToggle(item: Launchable, pinned: boolean): MenuAction["toggle"] {
  if (item.pin === "never") return undefined;
  return {
    on: pinned,
    onIcon: <Pin size={13} className="fill-current" />,
    offIcon: <Pin size={13} />,
    onLabel: translate("side.launcherUnpin"),
    offLabel: translate("side.launcherPin"),
    onToggle: (next) => setLauncherPinned(item.kind, next),
  };
}

/**
 * ＋ ▸ 智能体: the focus host's agents (online ones by project, then 未在线 ▸), each opened in the side area
 * beside the open agent (lib/sideOpen openAgentSide; the same as Ctrl/⌘-click in the sidebar). The agent
 * open in the main area is left out.
 */
export function agentsSubmenu(): MenuEntry[] {
  const { sidebar, hosts, selectedId } = useApp.getState();
  const hostId = hosts?.active ?? "local";
  if (!sidebar) return [title(translate("side.agentsNone"))];
  const { groups } = buildSidebar(sidebar, { hostId });
  const row = (r: AgentRow): MenuAction => ({ label: r.name, onSelect: () => void openAgentSide(r.id, hostId) });
  const shown = (rows: AgentRow[]) => rows.filter((r) => r.id !== selectedId);
  const online: MenuEntry[] = [];
  for (const g of groups) {
    const rows = shown(g.online);
    if (!rows.length) continue;
    if (online.length) online.push("separator");
    online.push(title(g.kind === "project" ? g.name : translate("titlebar.independent")), ...rows.map(row));
  }
  const offline = groups.flatMap((g) => shown(g.offline));
  if (!online.length && !offline.length) return [title(translate("side.agentsNone"))];
  return [
    ...online,
    offline.length > 0 && "separator",
    offline.length > 0 && { label: translate("side.agentsOffline", { n: offline.length }), onSelect: () => {}, submenu: offline.map(row) },
  ];
}

/**
 * Title bar ＋ (the launcher menu): every launchable component (pinned first, by order; each with a pin
 * toggle), 「新…」 for multi-instance ones, 新页面, and the page in view's actions (最大化 / 全屏 / 钉住 / 页菜单).
 */
export function launcherMenu(): MenuEntry[] {
  const items = launchable();
  const { pinned, others } = splitLaunchers(items, getUiPrefs().sideLauncherPins);
  const row = (i: Launchable, on: boolean): MenuAction => ({ label: i.label, icon: i.icon, onSelect: () => pressLauncher(i.kind), toggle: pinToggle(i, on) });
  const tools = others.filter((i) => i.group === "tool");
  const statuses = others.filter((i) => i.group === "status");
  const fresh = items.filter(canOpenNew);
  const { layout, mode } = useSide.getState();
  const page = layout.open ? launcherPage() : null;
  const emptyPage = !!page && !page.cards.length;
  const pageMode = mode && mode.card === null ? mode.kind : null;
  const pin = layout.open && !mode && !useSide.getState().narrow && (getUiPrefs().sideMode === "float" || pinnedFromFloatNow());
  return [
    !items.length && title(translate("side.launcher.none")),
    ...pinned.map((i) => row(i, true)),
    "separator",
    ...tools.map((i) => row(i, false)),
    "separator",
    ...statuses.map((i) => row(i, false)),
    "separator",
    ...fresh.map((i) => ({ label: newLabel(i.label), icon: <Plus size={ICON} />, hint: newHint(), onSelect: () => pressLauncher(i.kind, NEW_SHOWN) })),
    { label: translate("side.agents"), icon: <Bot size={ICON} />, onSelect: () => {}, submenu: agentsSubmenu() },
    "separator",
    { label: translate("side.newPage"), icon: <Layers size={ICON} />, hint: "Ctrl+Shift+N", onSelect: () => void newPage() },
    page && {
      label: translate("side.thisPage"),
      icon: <Layers size={ICON} />,
      onSelect: () => {},
      submenu: [
        !emptyPage && { label: translate(pageMode === "maximised" ? "panel.exclusiveOff" : "panel.exclusive"), icon: <Maximize2 size={ICON} />, title: translate("panel.exclusiveHint"), onSelect: () => toggleMode("maximised", null) },
        !emptyPage && { label: translate(pageMode === "fullscreen" ? "side.restore" : "side.fullscreen"), icon: <Expand size={ICON} />, hint: "F11", onSelect: () => toggleMode("fullscreen", null) },
        pin && { label: translate(pinnedFromFloatNow() ? "side.unpin" : "side.pin"), icon: <Pin size={ICON} />, onSelect: togglePin },
        "separator",
        ...pageMenu(page.id).slice(1),
      ],
    },
  ];
}

/** Right-click on a title-bar launcher: 「新…」 (multi) and 从标题栏取消固定. */
export function launcherContextMenu(kind: ItemId): MenuEntry[] {
  const item = launchable().find((i) => i.kind === kind);
  if (!item) return [];
  return [
    title(item.label),
    canOpenNew(item) && { label: newLabel(item.label), icon: <Plus size={ICON} />, hint: newHint(), onSelect: () => pressLauncher(kind, NEW_SHOWN) },
    "separator",
    { label: translate("side.launcherUnpinBar"), icon: <PinOff size={ICON} />, onSelect: () => setLauncherPinned(kind, false) },
  ];
}

/** Empty-column / launcher-page buttons and ＋ submenus: every launchable component, opened into the page. */
export function addMenu(pageId: string | null): MenuEntry[] {
  const items = launchable();
  if (!items.length) return [title(translate("side.launcher.none"))];
  return items.map((i) => ({ label: i.label, icon: i.icon, onSelect: () => launch(i.kind, i.params, pageId) }));
}

/** 移到页 ▸: the other pages (by name) and, unless nothing would change, 新页面. */
function moveTargets(currentPage: string, allowNew: boolean, move: (target: MoveTarget) => void): MenuEntry[] {
  const { layout } = useSide.getState();
  const others = lanePages(layout, sideViewNow()).filter((p) => p.id !== currentPage && p.cards.length > 0);
  return [
    ...others.map((p) => ({ label: pageLabel(p), icon: <Layers size={ICON} />, onSelect: () => move({ page: p.id }) })),
    allowNew && others.length > 0 && "separator",
    allowNew && { label: translate("side.newPageItem"), icon: <Plus size={ICON} />, onSelect: () => move({ newPage: true }) },
  ];
}

export function tabMenu(instanceId: string): MenuEntry[] {
  const { layout } = useSide.getState();
  const at = locate(layout, instanceId);
  const inst = layout.instances[instanceId];
  if (!at || !inst) return [];
  const entry = sideRegistry().get(inst.kind);
  const ctx = sideViewNow();
  const info = useSide.getState().tabInfo[instanceId];
  const visible = visibleTabs(layout, at.card, ctx);
  // The only tab of the only card: a new page would look exactly the same.
  const alone = at.page.cards.length === 1 && at.card.tabs.length === 1;
  const move = moveTargets(at.page.id, !alone, (target) => updateLayout((l) => moveInstance(l, instanceId, target, Date.now(), orderOf)));
  return [
    title(info?.title ?? (entry ? translate(entry.item.titleKey) : inst.kind)),
    entry?.item.transient && !inst.pinned && { label: translate("side.keepOpen"), icon: <Pin size={ICON} />, onSelect: () => updateLayout((l) => pinInstance(l, instanceId)) },
    { label: translate("side.moveToPage"), icon: <ArrowRight size={ICON} />, disabled: !move.some(Boolean), onSelect: () => {}, submenu: move },
    at.card.tabs.length > 1 && { label: translate("side.split"), icon: <Split size={ICON} />, onSelect: () => updateLayout((l) => splitInstance(l, instanceId, Date.now())) },
    {
      label: translate("side.restoreDefault"),
      icon: <RotateCcw size={ICON} />,
      hint: layout.overrides[inst.kind] ? translate("side.overridden") : "",
      onSelect: () => updateLayout((l) => restoreDefault(l, instanceId, specOf, Date.now())),
    },
    // The modules' `ref.action` items for a referable component (§19.8).
    ...refActionEntries(instanceRef("hostId" in inst.binding ? inst.binding.hostId : activeHost(), inst.kind, inst.state), true),
    "separator",
    visible.length > 1 && { label: translate("side.closeOthers"), icon: <X size={ICON} />, armed: armedClose(otherTabsCloseWarnings(instanceId)), onSelect: () => closeOtherTabs(instanceId) },
    // A component's close warning (closeConfirm) names what closing ends, e.g. its process; then the
    // close is confirmed in place like the card's (nothing running = no warning = closes at once).
    { label: closeLabel(instanceId), icon: <X size={ICON} />, armed: armedClose(closeWarnings([instanceId])), onSelect: () => closeTab(instanceId) },
  ];
}

function closeLabel(instanceId: string): string {
  const warning = closeWarnings([instanceId])[0];
  return warning ? translate("side.closeWith", { what: warning }) : translate("side.close");
}

function shownRefActions(card: Parameters<typeof shownTab>[1]): MenuEntry[] {
  const { layout } = useSide.getState();
  const id = shownTab(layout, card, sideViewNow());
  const inst = id ? layout.instances[id] : undefined;
  if (!inst) return [];
  return refActionEntries(instanceRef("hostId" in inst.binding ? inst.binding.hostId : activeHost(), inst.kind, inst.state), true);
}

export function cardMenu(cardId: string): MenuEntry[] {
  const { layout, mode } = useSide.getState();
  const at = findCard(layout, cardId);
  if (!at) return [];
  const cards = visibleCards(layout, at.page, sideViewNow());
  const k = cards.findIndex((c) => c.id === cardId);
  const multi = at.page.cards.length >= 2;
  const move = moveTargets(at.page.id, multi, (target) => updateLayout((l) => moveCard(l, cardId, target, Date.now(), orderOf)));
  const step = (delta: -1 | 1) => {
    // Visible neighbours only: hop over the cards hidden for this agent.
    const other = cards[k + delta];
    if (!other) return;
    const from = at.page.cards.findIndex((c) => c.id === cardId);
    const to = at.page.cards.findIndex((c) => c.id === other.id);
    updateLayout((l) => {
      let next = l;
      for (let n = 0; n < Math.abs(to - from); n++) next = moveCard(next, cardId, { delta }, Date.now(), orderOf);
      return next;
    });
  };
  const inMode = (kind: "maximised" | "fullscreen") => mode?.kind === kind && mode.card === cardId;
  return [
    title(cardName(at.card)),
    multi && { label: translate("side.moveToNewPage"), icon: <Plus size={ICON} />, onSelect: () => updateLayout((l) => moveCard(l, cardId, { newPage: true }, Date.now(), orderOf)) },
    { label: translate("side.moveToPage"), icon: <ArrowRight size={ICON} />, disabled: !move.some(Boolean), onSelect: () => {}, submenu: move },
    cards.length > 1 && { label: translate("side.moveUp"), icon: <ArrowUp size={ICON} />, disabled: k <= 0, onSelect: () => step(-1) },
    cards.length > 1 && { label: translate("side.moveDown"), icon: <ArrowDown size={ICON} />, disabled: k === cards.length - 1, onSelect: () => step(1) },
    cards.length > 1 && {
      label: translate(at.card.collapsed ? "side.expand" : "side.collapse"),
      icon: <ChevronDown size={ICON} />,
      onSelect: () => updateLayout((l) => setCollapsed(l, cardId, !at.card.collapsed)),
    },
    // 最大化 (rule 2): its Shelf takes every gap of the row, it fills its page; 独占: the former 最大化 (§24.16).
    { label: translate(paneGrown(cardId) ? "side.restore" : "side.maximise"), icon: <Maximize2 size={ICON} />, hint: "Ctrl+Shift+M", disabled: !paneGrown(cardId) && !canGrow({ kind: "shelf", conv: liveConversation(), shelfId: at.page.shelf ?? "", card: cardId }), title: translate("panel.maxNoGap"), onSelect: () => void toggleGrow({ kind: "shelf", conv: liveConversation(), shelfId: at.page.shelf ?? "", card: cardId }) },
    { label: translate(inMode("maximised") ? "panel.exclusiveOff" : "panel.exclusive"), icon: <Columns2 size={ICON} />, title: translate("panel.exclusiveHint"), onSelect: () => toggleMode("maximised", cardId) },
    { label: translate(inMode("fullscreen") ? "side.restore" : "side.fullscreen"), icon: <Expand size={ICON} />, hint: "F11", onSelect: () => toggleMode("fullscreen", cardId) },
    // The shown tab's `ref.action` items (§19.8), as in its tab menu.
    ...shownRefActions(at.card),
    "separator",
    { label: translate("side.closeCard"), icon: <X size={ICON} />, danger: true, armed: armedClose(cardCloseWarnings(cardId)), foretell: () => cardCloseForetell(cardId), onSelect: () => closeCard(cardId) },
  ];
}

/**
 * #7 (owner 2026-10-21): a tool pane header's 「—」 — no tray any more: 移到另一页 ▸ (the other pages of its
 * Shelf; 新的一页 when the pane does not have its page to itself, below MAX_SHELF_PAGES) and 关闭 (confirmed in
 * place when closing would end something, like ×).
 */
export function paneDashMenu(cardId: string): MenuEntry[] {
  const { layout } = useSide.getState();
  const at = findCard(layout, cardId);
  if (!at) return [];
  const shelf = shelfOfPage(layout, at.page.id)?.id ?? null;
  const others = shelf ? shelfLanePages(layout, shelf, sideViewNow()).filter((p) => p.id !== at.page.id) : [];
  // A page with 3 panes and none of this kind would merge panes into tabs: not offered.
  const full = (p: SidePage) => p.cards.length >= MAX_CARDS && !p.cards.some((c) => cardHolds(layout, c, at.card.kind));
  const roomForPage = !!shelf && pagesOfShelf(layout, shelf).length < MAX_SHELF_PAGES;
  const allowNew = roomForPage && (at.page.cards.length > 1 || !!at.page.kept);
  const move: MenuEntry[] = [
    ...others.map((p) => ({ label: pageLabel(p), icon: <Layers size={ICON} />, disabled: full(p), foretell: () => cardMoveForetell(cardId, pageLabel(p)), onSelect: () => updateLayout((l) => moveCard(l, cardId, { page: p.id }, Date.now(), orderOf)) })),
    allowNew && others.length > 0 && "separator",
    allowNew && { label: translate("pane.newPageItem"), icon: <Plus size={ICON} />, foretell: () => cardMoveForetell(cardId, null), onSelect: () => updateLayout((l) => moveToNewPage(l, { card: cardId }, shelf!, Date.now())) },
  ];
  return [
    { label: translate("pane.moveToOtherPage"), icon: <ArrowRight size={ICON} />, disabled: !move.some(Boolean), onSelect: () => {}, submenu: move },
    "separator",
    { label: translate("side.close"), icon: <X size={ICON} />, danger: true, armed: armedClose(cardCloseWarnings(cardId)), onSelect: () => closeCard(cardId) },
  ];
}

export function pageMenu(pageId: string): MenuEntry[] {
  const { layout } = useSide.getState();
  const page = findPage(layout, pageId);
  if (!page) return [];
  const pages = lanePages(layout, sideViewNow());
  const k = layout.pages.findIndex((p) => p.id === pageId);
  const others = pages.filter((p) => p.id !== pageId && p.cards.length > 0);
  const launcher = !page.cards.length;
  return [
    title(pageLabel(page)),
    { label: translate("side.newPage"), icon: <Plus size={ICON} />, hint: "Ctrl+Shift+N", onSelect: () => void newPage() },
    "separator",
    !launcher && {
      label: translate("side.mergeInto"),
      icon: <Combine size={ICON} />,
      disabled: !others.length,
      onSelect: () => {},
      submenu: others.map((p) => ({ label: pageLabel(p), icon: <Layers size={ICON} />, onSelect: () => updateLayout((l) => mergePages(l, pageId, p.id)) })),
    },
    !launcher && {
      label: translate("side.rename"),
      icon: <Pencil size={ICON} />,
      onSelect: async () => {
        const name = await promptDialog(translate("side.renameTitle"), page.name ?? "");
        if (name !== null) updateLayout((l) => renamePage(l, pageId, name));
      },
    },
    layout.pages.length > 1 && { label: translate("side.moveUp"), icon: <ArrowUp size={ICON} />, disabled: k <= 0, onSelect: () => updateLayout((l) => movePage(l, pageId, -1)) },
    layout.pages.length > 1 && { label: translate("side.moveDown"), icon: <ArrowDown size={ICON} />, disabled: k === layout.pages.length - 1, onSelect: () => updateLayout((l) => movePage(l, pageId, 1)) },
    ...(launcher ? [] : refActionEntries(sidePageRef(activeHost(), page, pageLabel(page)), true)),
    "separator",
    { label: translate("side.closePage"), icon: <X size={ICON} />, danger: true, armed: armedClose(pageCloseWarnings(pageId)), onSelect: () => closePage(pageId) },
    { label: translate("side.resetLayout"), icon: <RotateCcw size={ICON} />, onSelect: resetSideLayout },
  ];
}

/** 重置 Shelf 布局 (page menu, settings card): nothing is closed. */
export function resetSideLayout(): void {
  updateLayout((l) => resetLayout(l, specOf, Date.now()));
  // a notice, so a reset that changes little still says what it did
  useApp.getState().notify(translate("side.resetDone"), "info");
}

/** Settings → 组件默认位置 → 恢复默认: the kind's override goes, its instances move back. */
export function restoreKindDefaultNow(kind: ItemId): void {
  updateLayout((l) => restoreKindDefault(l, kind, specOf, Date.now()));
}
