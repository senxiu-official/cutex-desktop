// services.panes (docs/desktop-modules.md §24.5): one way to open any pane kind — a conversation (in the
// focused pane, or beside it), a page (in the focused conversation pane, over its conversation) or a
// tool kind (the tool area: the right-most column, ≤ 3 panes, then tabs; lib/sideServices). Also the
// v1.17 alias of services.side.open for the v1.16 `conversation.agent` component (merged into
// `core.conversation`: a conversation pane fixed to that agent). Shell code: names no feature.
import type { PaneOpenOptions, PaneOpenResult, SideOpenOptions, SideOpenResult } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { useApp } from "../store";
import { CONVERSATION_KIND, focusedConversation, isPageKind, PAGE_KIND_PREFIX, paneShowing } from "./paneLayout";
import { isFullWindowPage, paneKindsNow } from "./paneKinds";
import { openAgentBeside, setFullWindowPages, usePanes } from "./paneStore";
import { SIDE_AGENT_COMPONENT } from "./sideKinds";
import { locate } from "./sideLayout";
import { useSide } from "./sideLayoutStore";
import { sideOpen, whyUnavailable } from "./sideServices";

// A page with an Aside (设置) is full-window: lib/paneStore never puts it into a pane.
setFullWindowPages(isFullWindowPage);

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** A conversation pane for an agent: `beside` / `background` = a column beside the focused one. */
function openConversation(params: Json | undefined, opts: PaneOpenOptions): PaneOpenResult {
  const p = isRecord(params) ? params : {};
  const sessionId = typeof p.sessionId === "string" && p.sessionId ? p.sessionId : null;
  if (!sessionId) return { status: "unavailable", reason: "bad-params" };
  const s = useApp.getState();
  const hostId = typeof p.hostId === "string" && p.hostId ? p.hostId : (s.selectedHost ?? s.hosts?.active ?? "local");
  if (opts.beside || opts.background) openAgentBeside(hostId, sessionId, { focus: !opts.background });
  else void s.openAgent(sessionId, hostId);
  return { status: "opened", kind: CONVERSATION_KIND, paneId: paneShowing(usePanes.getState().layout, hostId, sessionId), instanceId: null };
}

/** A page kind: the page opens in the focused conversation pane (a full-window page over the window). */
function openPageKind(kind: string, params: Json | undefined): PaneOpenResult {
  const page = kind.slice(PAGE_KIND_PREFIX.length) as ItemId;
  const entry = paneKindsNow().find((k) => k.id === kind);
  if (!entry && !isFullWindowPage(page)) return { status: "unavailable", reason: "unknown-kind" };
  const flat: Record<string, string> = {};
  if (isRecord(params)) for (const [k, v] of Object.entries(params)) if (typeof v === "string") flat[k] = v;
  useApp.getState().openPage(page, flat);
  return { status: "opened", kind, paneId: isFullWindowPage(page) ? null : focusedConversation(usePanes.getState().layout), instanceId: null };
}

/** services.panes.open (§24.5). */
export function panesOpen(kind: string, params?: Json, opts: PaneOpenOptions = {}): PaneOpenResult {
  if (kind === CONVERSATION_KIND) return openConversation(params, opts);
  if (kind === SIDE_AGENT_COMPONENT) return openConversation(params, { ...opts, beside: true });
  if (isPageKind(kind)) return openPageKind(kind, params);
  const side: SideOpenOptions = { reveal: true, ...(opts.focus ? { focus: true } : {}), ...(opts.background ? { background: true } : {}) };
  const result = sideOpen(kind as ItemId, params ?? null, side);
  if (result.status !== "opened") return result.status === "stale" ? result : { status: "unavailable", reason: result.reason };
  const at = locate(useSide.getState().layout, result.instanceId);
  return { status: "opened", kind, paneId: at?.card.id ?? null, instanceId: result.instanceId };
}

/**
 * services.side.open (v1.17: an alias of services.panes.open for tool kinds). `conversation.agent`
 * (v1.16, another agent's live conversation in the right side) is a conversation pane beside the focused one now.
 */
export function sideOpenAlias(kind: ItemId, params?: Json, opts: SideOpenOptions = {}): SideOpenResult {
  if (kind !== SIDE_AGENT_COMPONENT) return sideOpen(kind, params ?? null, opts);
  const result = panesOpen(CONVERSATION_KIND, { ...(isRecord(params) ? params : {}), ...(opts.binding ? { hostId: opts.binding.hostId } : {}) }, { beside: true, ...(opts.background ? { background: true } : {}) });
  if (result.status === "opened") return { status: "opened", instanceId: result.paneId ?? "", where: "card", pageId: null, reused: false };
  return result.status === "stale" ? result : { status: "unavailable", reason: result.reason === "unknown-kind" ? whyUnavailable(kind) : result.reason };
}
