// The window's work row as panes (docs/desktop-modules.md §24; research panes-20261019.md §3–§4): draws
// the pane layout (lib/paneLayout) — the left dock, then the work area with its conversation panes
// (lib/paneStore) and, right of them, the tool columns (components/side, lib/sideLayoutStore), and under
// them the tray of collapsed panes (components/ChipTray). Up to two conversation columns side by side.
// Every conversation column has its own two-line header (components/ConversationHeader, owner 2026-10-21:
// the conversation's name, role, project, state and host · cwd · branch moved off the window bar; its 2×2
// controls Shelf · 放大 / 关闭 · ⋯; drag it to move the column, double-click to maximise). One
// pane alone keeps its old frame (no column wrapper); next to another pane (a second conversation, a tool
// pane) the columns are framed, with a divider between two. A maximised conversation pane takes the rest of the
// work row (§24.16: the others stay mounted, hidden; its Shelves and the other workspace show as rails, drawn by
// components/side/SideArea); in full screen the sidebar is hidden entirely too (§24.16; owner 2026-10-28: only
// its left-edge pop-out stays). A page (services.ui.openPage)
// opens as its own pane in the focused conversation's Shelf (§24.4, 2026-10-21); with 页面打开位置 = 占用会话 it shows
// over the focused column's conversation with its own page header (components/PageHeader), never under the agent's. Each conversation pane has its own ConversationScope provider (its agent, host,
// focus); a pointer / focus inside a pane gives it the focus (the focused pane is the selection). A module's
// desktop layer (`pane.desktop`, §25, contract 1.20) is the bottom layer under the whole work area and shows
// through when nothing is in front (no agent, every pane in the tray, 显示桌面); the tray floats over it
// (components/ChipTray). No feature is named here (test/modules.test.ts).
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { MemoConversation } from "./Conversation";
import { CustomizeHost } from "./CustomizeHost";
import { SettingsShelfSlot } from "./SettingsShelf";
import { ErrorBoundary } from "./ErrorBoundary";
import { Sidebar } from "./Sidebar";
import { useSidebarCollapsed } from "../lib/windowSidebar";
import { usePortraitColumns, usePortraitOn, useWindowOrientation } from "../lib/portrait";
import { SideWorkArea } from "./side/SideArea";
import { WS_CONVERSATION_MIN_W } from "../lib/workspaces";
import { useWsRow } from "../lib/workspaceRowView";
import { columnHandleShown, STRIP_W } from "../lib/workspaceRow";
import { ConversationHeader } from "./ConversationHeader";
import { ConvStrip } from "./ConvStrip";
import { useIsFolded, useStripPanes } from "../lib/convStrips";
import { useShelfOnlyPanes } from "../lib/shelfOnly";
import { PageHeader } from "./PageHeader";
import { ColumnSplitter, RowSplitter } from "./PaneResizer";
import { DesktopStage } from "./ChipTray";
import { ConversationScope, type ConversationScopeValue } from "../lib/conversationScope";
import { CONVERSATION_MIN_W, conversationPanes, focusedConversation, paneBinding, panePage, type PaneLayout } from "../lib/paneLayout";
import { useSideDnd } from "../lib/sideDnd";
import { useSideView } from "../lib/sideComponents";
import { pagesOfShelf, shownPages, visibleCards, type SideLayout, type SideViewContext } from "../lib/sideLayout";
import { useSide } from "../lib/sideLayoutStore";
import { focusConversationPane, previewPaneColumns, resizePaneColumns, usePanes } from "../lib/paneStore";
import type { WorkspaceScope } from "../../../shared/ipc";
import { MainOutlet, PaneOutlet } from "../modules/Outlet";
import { useDesktopLayer, useDesktopShown } from "../lib/paneDesk";
import { useDesktop } from "../lib/paneActions";
import { useFullscreen } from "../lib/panelFull";
import { firstRunView } from "../lib/firstRun";
import { hasNoHost, isRemote } from "../lib/hosts";
import { useOpenPage, usePageOf } from "../modules/react";
import type { ItemId, PageParams } from "../modules/types";
import { agentHost, useApp } from "../store";
import { viewKey } from "../lib/viewKey";
import { isElement } from "../lib/ownerWindow";
import { useShownInWindow } from "../lib/windowScope";

/** One conversation pane: its scope (bound agent, focus, on screen) around the conversation. */
// Memo: the work area re-renders on every layout change (focus, a chip, a column resize); a pane whose
// binding did not change keeps its conversation as it is.
// Exported for desk windows (components/DeskWindows): the same pane, drawn into another window's document.
export const ConversationPane = memo(ConversationPaneImpl);

/**
 * Holds an agent's view live (store retainView, shared with the side agent page; the selected agent is
 * live already, so this only registers it) while its host is connected, and again after a host switch /
 * reconnect dropped it (the store forgets that host's views).
 */
function useRetainedView(hostId: string, sessionId: string | null): void {
  const focusHost = useApp((s) => s.hosts?.active ?? "local");
  const conn = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.conn?.epoch ?? null);
  const ready = useApp((s) => (hostId === focusHost ? s.daemon : s.byHost[hostId]?.daemon)?.kind === "connected");
  // The release waits a tick: going from one column to two (or back), or into the tray and out of it,
  // remounts the holder, and the new one retains the agent first — so its feed is not closed and re-read
  // in between.
  useEffect(() => {
    if (!ready || !sessionId) return;
    const release = useApp.getState().retainView(hostId, sessionId);
    return () => void setTimeout(release, 0);
  }, [ready, hostId, sessionId, conn, focusHost]);
}

/**
 * 显示桌面 puts the conversations away as a whole (§24.13: no conversation chips; lib/paneActions useDesktop
 * `work`): their agents keep their feeds meanwhile, so 恢复 shows the live view at once instead of re-reading
 * them (perf baseline 2026-10-20, H6). The feed is the same one the pane held, so nothing goes stale.
 */
function TrayFeeds() {
  const held = useDesktop((s) =>
    s.work
      ? conversationPanes(s.work)
          .flatMap((id) => {
            const b = paneBinding(s.work!, id);
            return b?.sessionId ? [`${b.hostId}\u0000${b.sessionId}`] : [];
          })
          .join("\n")
      : "",
  );
  if (!held) return null;
  return (
    <>
      {[...new Set(held.split("\n"))].map((key) => {
        const [hostId, sessionId] = key.split("\u0000") as [string, string];
        return <TrayFeed key={key} hostId={hostId} sessionId={sessionId} />;
      })}
    </>
  );
}

function TrayFeed({ hostId, sessionId }: { hostId: string; sessionId: string }) {
  useRetainedView(hostId, sessionId);
  return null;
}

function ConversationPaneImpl({ paneId, hostId, sessionId, focused, scope, stripped = false }: { paneId: string; hostId: string; sessionId: string | null; focused: boolean; scope: WorkspaceScope | null; stripped?: boolean }) {
  useRetainedView(hostId, sessionId);
  // On screen: every visible conversation counts as looked at (store looksAt; 「在看」 is a set).
  const live = useApp((s) => !!sessionId && !!s.views[viewKey(hostId, sessionId)]);
  // Folded to its strip / 只看 Shelf (docs/design/002, owner 2026-10-22), or the portrait stack's strip (`stripped`):
  // mounted but not looked at.
  const folded = useIsFolded(paneId) || stripped;
  useEffect(() => {
    if (!live || !sessionId || folded) return;
    useApp.getState().setViewVisible(hostId, sessionId, true);
    return () => useApp.getState().setViewVisible(hostId, sessionId, false);
  }, [live, hostId, sessionId, folded]);
  useShownInWindow(hostId, sessionId, live && !folded);
  const value = useMemo<ConversationScopeValue>(() => ({ paneId, hostId, sessionId, focused, visible: true }), [paneId, hostId, sessionId, focused]);
  return (
    <ConversationScope.Provider value={value}>
      <MemoConversation scope={scope} />
    </ConversationScope.Provider>
  );
}

/** The pane's own chrome (its ×, the column divider): using it does not make the pane the focused one. */
const paneChrome = (target: EventTarget | null): boolean => isElement(target) && !!target.closest("[data-pane-close], [data-pane-split], [data-pane-collapse], [data-pane-max]");

/**
 * Conversation columns with headers (two side by side, or one next to tool panes): dividers, a click /
 * focus inside one focuses it; a maximised one fills the work area while the others stay mounted, hidden.
 */
function ConversationColumns({ layout, panes, scope, split = false, single = false, bodyHidden = false }: { layout: PaneLayout; panes: string[]; scope: WorkspaceScope | null; split?: boolean; single?: boolean; bodyHidden?: boolean }) {
  const focus = focusedConversation(layout);
  const max = layout.max && panes.includes(layout.max) ? layout.max : null;
  const dragged = useSideDnd((s) => (s.drag?.type === "conversation" ? s.drag.paneId : null));
  // Two workspaces: each column's width and the side of the other's rail (components/side/SideArea, lib/workspaceRow).
  const row = useWsRow();
  split = split || !!row?.fill;
  // By content the columns keep their own widths (no handle); filling (铺满窗口, 智能 with two) they share the row.
  const byContent = split && !columnHandleShown(row?.mode ?? "fill", panes.length);
  // 收起一个会话 (docs/design/002, lib/convStrips): two workspaces, one folded to its strip — the column shows its
  // strip card; its conversation stays mounted under it, hidden (its state kept). No handle beside a strip.
  // 只看 Shelf (002 补充, lib/shelfOnly): the column is its strip too, its Shelf stays (SideWorkArea draws it).
  const onlyShelf = useShelfOnlyPanes();
  const strips = [...useStripPanes(), ...onlyShelf];
  const stripShown = split && strips.some((id) => panes.includes(id));
  // Portrait (lib/portrait, P2): two workspaces in the stack (components/side/SideArea) — the focused one is its
  // conversation part (flex / minimum / order / tray room from the stack's variables, portrait.css), the other a strip
  // across the top: a view only (lib/convStrips is not written); a click or keyboard focus on it switches the focus.
  const stacked = usePortraitOn() && split;
  // P3: a stack wide enough for both — each workspace a column of its own (its conversation over its Shelves), no strip.
  const columns = usePortraitColumns() && stacked;
  const singlePane = single && panes.length === 1 && !row?.fill;
  // §24.13 two workspaces: each conversation is a card of its own in the work row (SideWorkArea `split`),
  // ordered around the Shelves; SideWorkArea draws both workspaces' Shelves, both live (the focus never changes
  // the layout; lib/shelfSourceContext).
  return (
    <div data-pane-columns="" className={split ? "contents" : "flex min-w-0 flex-1"}>
      {panes.map((paneId, i) => {
        const binding = paneBinding(layout, paneId)!;
        const col = layout.cols.findIndex((c) => c.rows.some((r) => r.pane === paneId));
        const share = layout.cols[col]?.w ?? 1 / panes.length;
        const focused = paneId === focus;
        const leftCol = layout.cols[col - 1];
        const page = panePage(layout, paneId) as { page: ItemId; params: PageParams } | null;
        const hidden = !!max && max !== paneId;
        const width = split ? (row?.widths[i] ?? null) : null;
        // 只看 Shelf also with one workspace (framed beside its Shelf).
        const across = stacked && !focused && !columns;
        const strip = (split && strips.includes(paneId)) || onlyShelf.includes(paneId) || across;
        const sized = strip ? { flex: "none", width: width ?? STRIP_W, minWidth: 0 } : width !== null ? { flex: "0 1 auto", width, minWidth: 0 } : { flexGrow: max ? 1 : share, flexBasis: 0, minWidth: max ? undefined : split ? WS_CONVERSATION_MIN_W : `min(${CONVERSATION_MIN_W}px, ${Math.floor(100 / panes.length)}%)` };
        return (
          <Fragment key={paneId}>
            <section
              data-conv-pane={paneId}
              data-conv-single={singlePane ? paneId : undefined}
              data-conv-strip={strip ? paneId : undefined}
              data-portrait-part={stacked ? (across ? "strip" : "conversation") : undefined}
              data-portrait-col={columns ? i : undefined}
              data-pane-focused={focused ? "" : undefined}
              data-pane-maxed={max === paneId ? "" : undefined}
              aria-current={focused ? "true" : undefined}
              data-ws-focused={split && focused ? "" : undefined}
              data-glide={split ? paneId : undefined}
              hidden={hidden || bodyHidden}
              data-ws-width={width ?? undefined}
              style={singlePane || stacked ? undefined : { ...sized, ...(split ? { order: i * 3 + 2 } : {}) }}
              className={`${singlePane ? "relative flex min-w-0 flex-1 flex-col" : `pane-column relative flex min-w-0 flex-col ${split ? `shell-card ws-col isolate overflow-hidden ${i > 0 && !stacked && (!row?.fill || row.railAt[i] !== "left") ? "ml-2" : ""}` : i > 0 && !max ? "border-l border-border" : ""}`} ${dragged === paneId ? "opacity-40" : ""}`}
              onPointerDownCapture={(e) => !paneChrome(e.target) && focusConversationPane(paneId)}
              onFocusCapture={(e) => !paneChrome(e.target) && focusConversationPane(paneId)}
            >
              {/* By content each column has its own width (no shared split to drag). Two workspaces filling: the
                  explicit widths of the row (lib/workspaceRow fillWidths); a drag moves the two columns' elements
                  and stores the share on release (components/PaneResizer RowSplitter). */}
              {strip && <ConvStrip paneId={paneId} hostId={binding.hostId} sessionId={binding.sessionId} across={across || undefined} />}
              {i > 0 && leftCol && !max && !byContent && split && !stacked && !stripShown && !row?.shelfBetween && <RowSplitter widths={row?.widths ?? []} onShare={(s) => resizePaneColumns(col - 1, s)} />}
              {i > 0 && leftCol && !max && !byContent && !split && <ColumnSplitter share={leftCol.w / (leftCol.w + share)} onShare={(s) => resizePaneColumns(col - 1, s)} preview={(s) => previewPaneColumns(col - 1, s)} />}
              {/* A page over the column (占用会话) has its own header, never the agent's (§24.4, §26). */}
              {strip ? null : page ? (
                <PageHeader paneId={paneId} page={page} focused={focused} maxed={max === paneId} framed />
              ) : (
                <ConversationHeader paneId={paneId} hostId={binding.hostId} sessionId={binding.sessionId} focused={focused} closable={panes.length > 1} maxed={max === paneId} framed={!singlePane} />
              )}
              <div className="relative flex min-h-0 flex-1" hidden={strip}>
                <ColumnOutlet focused={focused} page={page}>
                  <ConversationPane paneId={paneId} hostId={binding.hostId} sessionId={binding.sessionId} focused={focused} scope={focused ? scope : null} stripped={across || undefined} />
                </ColumnOutlet>
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * What a conversation column shows: a page over it (the focused pane's is the store's view, MainOutlet; another
 * pane draws its own, PaneOutlet — §24.4), else its conversation. With no page the conversation sits at the same
 * place whichever pane has the focus: wrapped in MainOutlet / PaneOutlet by focus, every focus switch remounted
 * both conversations — timelines, composers, scroll positions (owner 2026-10-21: the frontend jitters).
 */
export function ColumnOutlet({ focused, page, children }: { focused: boolean; page: { page: ItemId; params: PageParams } | null; children: ReactNode }) {
  const main = useOpenPage();
  const own = usePageOf(focused ? null : page);
  if (!(focused ? main : own)) return <>{children}</>;
  return focused ? <MainOutlet>{children}</MainOutlet> : <PaneOutlet page={page}>{children}</PaneOutlet>;
}

/**
 * Tool panes on screen for the focused agent (a conversation pane next to them gets its header): a Shelf
 * in view with panes for this agent on any of its pages. Not only the page in view: Alt+1 / Alt+2 to an
 * empty page of that Shelf flipped this, and with it the conversation's place in the tree — the whole
 * column remounted (timeline, composer, scroll position) on every switch (#35).
 */
export function toolPanesShown(layout: SideLayout, ctx: SideViewContext): boolean {
  return shownPages(layout, ctx).some((page) => (page.shelf ? pagesOfShelf(layout, page.shelf) : [page]).some((p) => visibleCards(layout, p, ctx).length > 0));
}

function useToolPanesShown(): boolean {
  const ctx = useSideView();
  return useSide(({ layout }) => toolPanesShown(layout, ctx));
}

/** A maximise / restore (or a pane leaving / coming back): the panes on screen ease into their new place (styles.css). */
function useRelayoutEase(key: string): void {
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const root = document.documentElement;
    delete root.dataset.paneRelayout;
    void root.offsetWidth; // restart the animation
    root.dataset.paneRelayout = "";
    const timer = setTimeout(() => delete root.dataset.paneRelayout, 320);
    return () => clearTimeout(timer);
  }, [key]);
}

/**
 * The work row: the docked agent list (open, unless a full-window page replaces it), the work area —
 * the main card (an open page, else the conversation panes) and the right side — over the tray of
 * collapsed panes, and the 在主界面调整 panel.
 * `fullWindow`: a page with its own Aside (设置) runs in place of the agent list and the right side.
 * `scope`: the selected agent's workspace (the focused conversation's file links / git).
 */
export function PaneHost({ fullWindow, scope }: { fullWindow: boolean; scope: WorkspaceScope | null }) {
  // This window decides portrait / landscape from its own size (lib/portrait; a desk on a rotated monitor for itself).
  useWindowOrientation();
  // Hidden (the fold / two workspaces §24.13 / a pane full screen §24.16): the sidebar stays mounted — its
  // hint line and hot zone (components/SidebarPeek) — but nothing of it is in the flow.
  const collapsed = useSidebarCollapsed();
  const selectedId = useApp((s) => s.selectedId);
  const selectedHost = useApp(agentHost);
  const open = useOpenPage();
  const stored = usePanes((s) => s.layout);
  const tools = useToolPanesShown();
  const sideMode = useSide((s) => s.mode);
  const layer = useDesktopLayer();
  const desktopShown = useDesktopShown();
  const firstRun = useApp((s) => firstRunView(s.daemon, isRemote(s.hosts), s.sidebar ? s.sidebar.active.length + s.sidebar.retired.length : null, hasNoHost(s.hosts)) !== null);
  const full = useFullscreen();
  const docked = !fullWindow && !collapsed;
  const panes = conversationPanes(stored);
  // A maximised conversation pane covers the tool area (it stays mounted, hidden).
  const maxed = !fullWindow && !!stored.max && panes.includes(stored.max);
  const framed = !fullWindow && (panes.length > 1 || (tools && !!selectedId) || maxed);
  // §24.13: two workspaces side by side, each with its own Shelf (not while one is maximised).
  const split = framed && panes.length === 2 && !maxed;
  const splitFocus = split ? Math.max(0, panes.indexOf(focusedConversation(stored) ?? "")) : 0;
  useRelayoutEase(`${stored.max ?? ""}|${sideMode?.kind ?? ""}:${sideMode?.card ?? ""}:${sideMode?.shelf ?? ""}|${panes.join(",")}|${full ? "full" : ""}`);
  // The page over the single column (占用会话; a full-window page has no column).
  const columnPage = !framed && !fullWindow && open ? { page: open.page, params: open.params } : null;
  const shelfOnlyPanesNow = useShelfOnlyPanes();
  const singleOnly = !framed && !columnPage && shelfOnlyPanesNow.includes(panes[0] ?? focusedConversation(stored) ?? "main");
  let body;
  // A single conversation uses the same column fiber as it will beside a Shelf. The alternative (a
  // separate single wrapper) remounted the timeline on the first 查看变更: opening the Shelf changed
  // `framed`, every fold ref re-ran and the whole thread rendered twice before the diff appeared.
  if (framed || (selectedId && !columnPage)) body = <ConversationColumns layout={stored} panes={panes} scope={scope} split={split} single={!framed} bodyHidden={desktopShown} />;
  else {
    // One conversation pane alone: today's DOM (no wrapper, no header), bound to the selection.
    const paneId = panes[0] ?? focusedConversation(stored) ?? "main";
    body = <ConversationPane key={paneId} paneId={paneId} hostId={selectedHost} sessionId={selectedId} focused scope={scope} />;
    // Its two-line header (components/ConversationHeader) like every conversation column; a page over it
    // (占用会话) brings its own page header instead (components/PageHeader), Esc / × back to the conversation.
    if (columnPage)
      body = (
        <div key={paneId} data-conv-single={paneId} data-column-page={columnPage.page} className="relative flex min-w-0 flex-1 flex-col">
          <PageHeader paneId={paneId} page={columnPage} focused maxed={stored.max === paneId} framed={false} />
          <div className="relative flex min-h-0 flex-1">
            <MainOutlet>{body}</MainOutlet>
          </div>
        </div>
      );
    else if (selectedId)
      body = (
        <div key={paneId} data-conv-single={paneId} data-conv-strip={singleOnly ? paneId : undefined} className="relative flex min-w-0 flex-1 flex-col">
          {/* 只看 Shelf: the strip in place of the header; the conversation stays mounted under it, hidden. */}
          {singleOnly ? <ConvStrip paneId={paneId} hostId={selectedHost} sessionId={selectedId} /> : <ConversationHeader paneId={paneId} hostId={selectedHost} sessionId={selectedId} focused closable={false} maxed={false} framed={false} />}
          <div className="relative flex min-h-0 flex-1" hidden={singleOnly}>
            {body}
          </div>
        </div>
      );
  }
  // Nothing in front (no agent, every pane in the tray, 显示桌面): the desktop layer behind the work area
  // shows through (components/ChipTray DesktopStage) — no empty pane is drawn over it.
  // One conversation alone in the main card (no page over it): its column has the single width (lib/workSurface).
  const single = !fullWindow && !open && !!selectedId && panes.length <= 1 && !maxed ? (panes[0] ?? focusedConversation(stored) ?? "main") : null;
  const work = (desktop: string | null) => (
    // 显示桌面 (owner 2026-10-22): only the desktop — no Shelf, no Shelf Rail (their layout untouched for 恢复).
    <SideWorkArea side={!fullWindow && !desktopShown} covered={maxed} split={split ? { focused: splitFocus } : null} desk={!!desktop} single={desktop ? null : single}>
      {/* A page that fails to render shows a notice here; the sidebar stays usable to move on. */}
      <ErrorBoundary resetKey={`${open?.page ?? "conversation"}:${selectedId ?? ""}`}>
        {/* Columns with headers: each pane draws its own page; a full-window page (设置) replaces them all. */}
        {framed || columnPage || selectedId ? body : <MainOutlet>{desktop ? null : body}</MainOutlet>}
      </ErrorBoundary>
    </SideWorkArea>
  );
  return (
    // The window background holds the cards: the main card (conversation / page) and the right side
    // (page buttons + cards) in the work area, 8 px apart; the tray of chips under them. 8 px under the title bar too
    // (design 040 step 11, owner 2026-10-23: the bar stays a full-width strip, the cards no longer touch it).
    <div data-pane-host="" className={`relative flex min-h-0 flex-1 pt-2 pr-2 pb-2 ${docked ? "" : "pl-2"}`}>
      {!fullWindow && <Sidebar />}
      {/* The Settings Shelf's left place: between the sidebar card and the work area (components/SettingsShelf). */}
      {!fullWindow && <SettingsShelfSlot />}
      <div data-pane-stage="" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The desktop layer under the whole work area, the work area, the tray floating over them. */}
        <DesktopStage key={layer?.item.id ?? ""} entry={layer} hostId={selectedHost} input={{ fullWindow, framed, sessionId: selectedId, page: !!open, firstRun, desktopShown }}>
          {work}
        </DesktopStage>
      </div>
      {/* 在主界面调整: the region panel, placed in this row (not on a full-window page). */}
      {!fullWindow && <CustomizeHost />}
      <TrayFeeds />
    </div>
  );
}
