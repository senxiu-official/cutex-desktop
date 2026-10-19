// The window's work row as panes (docs/desktop-modules.md §24; research panes-20261019.md §3–§4): draws
// the pane layout (lib/paneLayout) — the left dock, then the work area with its conversation panes
// (lib/paneStore) and, right of them, the tool columns (components/side, lib/sideLayoutStore). Up to two
// conversation columns side by side. One conversation pane is drawn exactly as the window looked
// before (no wrapper, no header); with two, each column gets a slim header (agent, host or the page it
// shows, ×) and a divider between them. A page (services.ui.openPage) shows in the focused pane, over its
// conversation (§24.4). Each conversation pane has its own ConversationScope provider (its agent, host,
// focus); a pointer / focus inside a pane gives it the focus (the focused pane is the selection). No
// feature is named here (test/modules.test.ts).
import { Fragment, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { Conversation } from "./Conversation";
import { CustomizeHost } from "./CustomizeHost";
import { ErrorBoundary } from "./ErrorBoundary";
import { Sidebar } from "./Sidebar";
import { SideWorkArea } from "./side/SideArea";
import { Avatar } from "./Avatar";
import { HostDot } from "./HostMark";
import { ScriptText } from "./ScriptText";
import { ColumnSplitter } from "./PaneResizer";
import { useI18n } from "../i18n";
import { ConversationScope, type ConversationScopeValue } from "../lib/conversationScope";
import { conversationPanes, focusedConversation, paneBinding, panePage, type PaneLayout } from "../lib/paneLayout";
import { closeConversationPane, closePanePage, focusConversationPane, resizePaneColumns, usePanes } from "../lib/paneStore";
import { useUiPrefs } from "../lib/prefs";
import { useHostScope } from "../lib/useHostScope";
import type { WorkspaceScope } from "../../../shared/ipc";
import { MainOutlet, PaneOutlet } from "../modules/Outlet";
import { useOpenPage, usePageOf } from "../modules/react";
import type { ItemId, PageParams } from "../modules/types";
import { agentHost, sidebarOf, useApp } from "../store";
import { viewKey } from "../lib/viewKey";

/** One conversation pane: its scope (bound agent, focus, on screen) around the conversation. */
function ConversationPane({ paneId, hostId, sessionId, focused, scope }: { paneId: string; hostId: string; sessionId: string | null; focused: boolean; scope: WorkspaceScope | null }) {
  // The pane holds its agent's view live (store retainView, shared with the side agent page; the
  // selected agent is live already, so this only registers it) while its host is connected, and again
  // after a host switch / reconnect dropped it (the store forgets that host's views).
  const focusHost = useApp((s) => s.hosts?.active ?? "local");
  const conn = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.conn?.epoch ?? null);
  const ready = useApp((s) => (hostId === focusHost ? s.daemon : s.byHost[hostId]?.daemon)?.kind === "connected");
  // The release waits a tick: going from one column to two (or back) remounts the pane that stays, and
  // its new mount retains the agent first — so its feed is not closed and re-read in between.
  useEffect(() => {
    if (!ready || !sessionId) return;
    const release = useApp.getState().retainView(hostId, sessionId);
    return () => void setTimeout(release, 0);
  }, [ready, hostId, sessionId, conn, focusHost]);
  // On screen: every visible conversation counts as looked at (store looksAt; 「在看」 is a set).
  const live = useApp((s) => !!sessionId && !!s.views[viewKey(hostId, sessionId)]);
  useEffect(() => {
    if (!live || !sessionId) return;
    useApp.getState().setViewVisible(hostId, sessionId, true);
    return () => useApp.getState().setViewVisible(hostId, sessionId, false);
  }, [live, hostId, sessionId]);
  const value = useMemo<ConversationScopeValue>(() => ({ paneId, hostId, sessionId, focused, visible: true }), [paneId, hostId, sessionId, focused]);
  return (
    <ConversationScope.Provider value={value}>
      <Conversation scope={scope} />
    </ConversationScope.Provider>
  );
}

/** The page's name (its breadcrumb's last part) in a pane header. */
function PageName({ page }: { page: { page: ItemId; params: PageParams } }) {
  const open = usePageOf(page);
  const entry = open?.entry;
  if (!entry) return <span className="min-w-0 truncate">{page.page}</span>;
  return <PageCrumb entry={entry} params={page.params} />;
}

function PageCrumb({ entry, params }: { entry: NonNullable<ReturnType<typeof usePageOf>>["entry"] & object; params: PageParams }) {
  const crumbs = entry.item.useTitle(params);
  return <span className="min-w-0 truncate font-medium">{crumbs[crumbs.length - 1]?.text ?? entry.item.id}</span>;
}

/** A conversation column's slim header (two columns only): avatar, agent name, its host, the page it shows, close. */
function PaneHeader({ paneId, hostId, sessionId, focused, page }: { paneId: string; hostId: string; sessionId: string | null; focused: boolean; page: { page: ItemId; params: PageParams } | null }) {
  const { t } = useI18n();
  const hosts = useHostScope();
  const session = useApp((s) => {
    const sidebar = sidebarOf(s, hostId);
    return sessionId ? [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((r) => r.cutexSessionId === sessionId) : undefined;
  });
  const host = hosts.host(hostId);
  const name = session?.displayName ?? sessionId ?? t("conversation.empty");
  return (
    <div
      data-pane-header=""
      className={`flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs ${focused ? "border-accent/40 text-foreground" : "border-border text-muted"}`}
    >
      {session && <Avatar name={session.displayName} avatar={session.avatar} seed={session.cutexSessionId} size={16} />}
      <span className={`min-w-0 truncate ${focused ? "font-semibold" : ""}`}>
        <ScriptText text={name} />
      </span>
      {host && (
        <span className="inline-flex max-w-28 shrink-0 items-center gap-1 rounded bg-surface-2/60 px-1.5 py-px text-[11px] text-subtle" title={t("titlebar.hostTip", { host: host.label })} data-pane-host="">
          <HostDot color={host.color} status={host.indicator.status} size={6} />
          <span className="truncate">{host.label}</span>
        </span>
      )}
      {page && (
        <span className="flex min-w-0 items-center gap-1 text-subtle" data-pane-page="">
          <span aria-hidden>·</span>
          <PageName page={page} />
        </span>
      )}
      <span className="flex-1" />
      <button
        title={t(page ? "pane.closePage" : "pane.close")}
        aria-label={t(page ? "pane.closePage" : "pane.close")}
        data-pane-close=""
        onClick={() => (page ? closePanePage(paneId) : closeConversationPane(paneId))}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** The pane's own chrome (its ×, the column divider): using it does not make the pane the focused one. */
const paneChrome = (target: EventTarget | null): boolean => target instanceof Element && !!target.closest("[data-pane-close], [data-pane-split]");

/** Two (or more) conversation columns: headers, dividers, a click / focus inside one focuses it. */
function ConversationColumns({ layout, panes, scope }: { layout: PaneLayout; panes: string[]; scope: WorkspaceScope | null }) {
  const focus = focusedConversation(layout);
  return (
    <div data-pane-columns="" className="flex min-w-0 flex-1">
      {panes.map((paneId, i) => {
        const binding = paneBinding(layout, paneId)!;
        const col = layout.cols.findIndex((c) => c.rows.some((r) => r.pane === paneId));
        const share = layout.cols[col]?.w ?? 1 / panes.length;
        const focused = paneId === focus;
        const leftCol = layout.cols[col - 1];
        const page = panePage(layout, paneId) as { page: ItemId; params: PageParams } | null;
        return (
          <Fragment key={paneId}>
            <section
              data-conv-pane={paneId}
              data-pane-focused={focused ? "" : undefined}
              aria-current={focused ? "true" : undefined}
              style={{ flexGrow: share, flexBasis: 0 }}
              className={`relative flex min-w-0 flex-col ${i > 0 ? "border-l border-border" : ""}`}
              onPointerDownCapture={(e) => !paneChrome(e.target) && focusConversationPane(paneId)}
              onFocusCapture={(e) => !paneChrome(e.target) && focusConversationPane(paneId)}
            >
              {i > 0 && leftCol && <ColumnSplitter share={leftCol.w / (leftCol.w + share)} onShare={(s) => resizePaneColumns(col - 1, s)} />}
              <PaneHeader paneId={paneId} hostId={binding.hostId} sessionId={binding.sessionId} focused={focused} page={page} />
              <div className="relative flex min-h-0 flex-1">
                {/* The focused pane's page is the store's view (MainOutlet); another pane draws its own (§24.4). */}
                {focused ? (
                  <MainOutlet>
                    <ConversationPane paneId={paneId} hostId={binding.hostId} sessionId={binding.sessionId} focused={focused} scope={scope} />
                  </MainOutlet>
                ) : (
                  <PaneOutlet page={page}>
                    <ConversationPane paneId={paneId} hostId={binding.hostId} sessionId={binding.sessionId} focused={focused} scope={null} />
                  </PaneOutlet>
                )}
              </div>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * The work row: the docked agent list (open, unless a full-window page replaces it), the work area —
 * the main card (an open page, else the conversation panes) and the right side — and the 在主界面调整 panel.
 * `fullWindow`: a page with its own Aside (设置) runs in place of the agent list and the right side.
 * `scope`: the selected agent's workspace (the focused conversation's file links / git).
 */
export function PaneHost({ fullWindow, scope }: { fullWindow: boolean; scope: WorkspaceScope | null }) {
  const { sidebarOpen } = useUiPrefs();
  const selectedId = useApp((s) => s.selectedId);
  const selectedHost = useApp(agentHost);
  const open = useOpenPage();
  const stored = usePanes((s) => s.layout);
  const docked = !fullWindow && sidebarOpen;
  const panes = conversationPanes(stored);
  let body;
  if (panes.length > 1) body = <ConversationColumns layout={stored} panes={panes} scope={scope} />;
  else {
    // One conversation pane: today's DOM (no wrapper, no header), bound to the selection.
    const paneId = panes[0] ?? focusedConversation(stored) ?? "main";
    body = <ConversationPane key={paneId} paneId={paneId} hostId={selectedHost} sessionId={selectedId} focused scope={scope} />;
  }
  return (
    // The window background holds the cards: the main card (conversation / page) and the right side
    // (page buttons + cards) in the work area, 8 px apart.
    <div className={`relative flex min-h-0 flex-1 pr-2 pb-2 ${docked ? "" : "pl-2"}`}>
      {docked && <Sidebar />}
      <SideWorkArea side={!fullWindow}>
        {/* A page that fails to render shows a notice here; the sidebar stays usable to move on. */}
        <ErrorBoundary resetKey={`${open?.page ?? "conversation"}:${selectedId ?? ""}`}>
          {/* Several columns: each pane draws its own page; a full-window page (设置) replaces them all. */}
          {panes.length > 1 && !fullWindow ? body : <MainOutlet>{body}</MainOutlet>}
        </ErrorBoundary>
      </SideWorkArea>
      {/* 在主界面调整: the region panel, placed in this row (not on a full-window page). */}
      {!fullWindow && <CustomizeHost />}
    </div>
  );
}
