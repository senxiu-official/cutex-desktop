// The conversation a subtree shows (docs/research/panes-20261019.md §3, step 1a): which host and agent
// a conversation pane is bound to, whether it holds the focus and whether it is on screen. Everything
// rendered inside a conversation reads its agent, host, capabilities and sidebar from here, never from
// the store's global selection (`selectedId`, `agentHost`, `selectedFeatures`, `selectedSidebar`), so
// a second conversation pane can later show another agent without these components changing.
//
// The shell (components/PaneHost) mounts one provider per conversation pane (panes step 2: up to two
// side by side). The focused pane's agent is the store's selection; the other pane keeps its own. Store
// actions get the scope's agent AND host (per-agent state is keyed by host + id), signals and notices
// name the scope's agent (convSignal / convNotify, lib/uiSignal).
//
// FALLBACK (explicit, on purpose): a component that is also rendered OUTSIDE a conversation (Markdown
// and tool rows in the side agent page's timeline, side cards, peek cards) has no provider above it;
// there every hook / accessor below falls back to the global selection — exactly what those
// components read before. `test/conversationScope.scan.test.ts` keeps the subtree on these hooks.
import { createContext, useContext } from "react";
import type { DaemonApi, SidebarSnapshot } from "../../../shared/ipc";
import { agentHost, featuresOf, hostApi, sidebarOf, useApp, viewHostIn, viewOf, type AgentAddress, type SessionView } from "../store";
import { MAIN_PANE } from "./paneLayout";
import { livePaneBinding } from "./paneStore";

export interface ConversationScopeValue {
  /** The pane showing the conversation ("main" while there is only the main area). */
  paneId: string;
  /** The agent's host (never null: the focus host when no agent is open, like `agentHost`). */
  hostId: string;
  /** The open agent (null: none — the empty conversation / first-run panel). */
  sessionId: string | null;
  /** This pane holds the focus (keyboard, the title bar, follow-bound side cards). */
  focused: boolean;
  /** The pane is on screen (not a background tab / chip). */
  visible: boolean;
}

/** The conversation pane of the default layout (lib/paneLayout MAIN_PANE). */
export const MAIN_CONVERSATION_PANE = MAIN_PANE;

export const ConversationScope = createContext<ConversationScopeValue | null>(null);

type AppNow = ReturnType<typeof useApp.getState>;

/** The enclosing provider's value; null outside any conversation (callers then use the global selection). */
export const useConvScope = (): ConversationScopeValue | null => useContext(ConversationScope);

// ---- non-hook accessors (callbacks, selectors): the scope's value, else the global selection ----

/** The scope's agent, else the store's selected agent. */
export const convSessionOf = (scope: ConversationScopeValue | null, s: AppNow): string | null => (scope ? scope.sessionId : s.selectedId);
/** The scope's host, else the selected agent's host (`agentHost`). */
export const convHostOf = (scope: ConversationScopeValue | null, s: AppNow): string => (scope ? scope.hostId : agentHost(s));
/** The capabilities of the scope's host, else the selected agent's host's (`selectedFeatures`). */
export const convFeaturesOf = (scope: ConversationScopeValue | null, s: AppNow): ReadonlySet<string> => featuresOf(s, convHostOf(scope, s));
/** The sidebar snapshot of the scope's host, else the selected agent's host's (`selectedSidebar`). */
export const convSidebarOf = (scope: ConversationScopeValue | null, s: AppNow): SidebarSnapshot | null => sidebarOf(s, convHostOf(scope, s));

/**
 * The host of `sessionId`'s view as seen from here (views are keyed by host + id, panes step 1c): the
 * scope's host for the scope's own agent, else the host of that id's latest view (store `viewHostIn`).
 */
export const convViewHostOf = (scope: ConversationScopeValue | null, s: AppNow, sessionId: string): string =>
  scope && scope.sessionId === sessionId ? scope.hostId : viewHostIn(s, sessionId);
/** `sessionId`'s view as seen from here (`convViewHostOf`). */
export const convViewOf = (scope: ConversationScopeValue | null, s: AppNow, sessionId: string): SessionView | undefined =>
  viewOf(s, convViewHostOf(scope, s, sessionId), sessionId);

/**
 * Daemon calls about `sessionId` as seen from here: its host's api (`convViewHostOf`; replaces the
 * compatibility `sessionApi(id)` in the conversation subtree, which routes a bare id to the host of its
 * latest view — the wrong one while the same id is open on two hosts).
 */
export function convApi(scope: ConversationScopeValue | null, sessionId: string): DaemonApi {
  return hostApi(convViewHostOf(scope, useApp.getState(), sessionId));
}

/** The scope's agent as an address (signals, notices; panes step 2), else the selected agent's; undefined: none. */
export function convAgentOf(scope: ConversationScopeValue | null, s: AppNow = useApp.getState()): AgentAddress | undefined {
  const sessionId = convSessionOf(scope, s);
  return sessionId ? { hostId: convHostOf(scope, s), sessionId } : undefined;
}

/** A notice for the scope's conversation (its composer shows it; store `notify` with the agent). */
export function convNotify(scope: ConversationScopeValue | null, text: string, tone: "info" | "error" = "info"): void {
  const s = useApp.getState();
  s.notify(text, tone, convAgentOf(scope, s));
}

/** An open request for the scope's conversation (store `signal` with the agent; lib/uiSignal). */
export function convSignal(scope: ConversationScopeValue | null, target: string, arg?: string): void {
  const s = useApp.getState();
  s.signal(target, arg, convAgentOf(scope, s));
}

// ---- hooks ----

/** A part of `sessionId`'s view (`convViewOf`; `pick` gets undefined while the store holds none). */
export function useConvView<T>(sessionId: string, pick: (view: SessionView | undefined) => T): T {
  const scope = useConvScope();
  return useApp((s) => pick(convViewOf(scope, s, sessionId)));
}

/** The host of `sessionId`'s view as seen from here (`convViewHostOf`): the host to pass to that agent's store actions. */
export function useConvViewHost(sessionId: string): string {
  const scope = useConvScope();
  return useApp((s) => convViewHostOf(scope, s, sessionId));
}

/** The conversation's agent (replaces `useApp((s) => s.selectedId)` in the conversation subtree). */
export function useConvSession(): string | null {
  const scope = useConvScope();
  return useApp((s) => convSessionOf(scope, s));
}

/** The conversation's host (replaces `useApp(agentHost)` in the conversation subtree). */
export function useConvHost(): string {
  const scope = useConvScope();
  return useApp((s) => convHostOf(scope, s));
}

/** The conversation host's capabilities (replaces `useApp(selectedFeatures)`). */
export function useConvFeatures(): ReadonlySet<string> {
  const scope = useConvScope();
  return useApp((s) => convFeaturesOf(scope, s));
}

/** The conversation host's sidebar snapshot (replaces `useApp(selectedSidebar)`). */
export function useConvSidebar(): SidebarSnapshot | null {
  const scope = useConvScope();
  return useApp((s) => convSidebarOf(scope, s));
}

/**
 * What a scope shows NOW (call time, not render time): for stale checks in callbacks that run after an
 * await or outside a render. A conversation pane's live binding is the pane layout's (lib/paneStore; the
 * focused pane's follows the selection); before the layout is in step with the store (unit tests without
 * the shell) the main pane is the selection's and any other pane what its value says. Outside any
 * conversation: the selection.
 */
export function convLiveOf(scope: ConversationScopeValue | null, s: AppNow = useApp.getState()): { hostId: string; sessionId: string | null } {
  if (!scope) return { hostId: agentHost(s), sessionId: s.selectedId };
  const live = livePaneBinding(scope.paneId);
  if (live) return live;
  if (scope.paneId === MAIN_CONVERSATION_PANE) return { hostId: agentHost(s), sessionId: s.selectedId };
  return { hostId: scope.hostId, sessionId: scope.sessionId };
}
