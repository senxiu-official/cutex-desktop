// services.panes (docs/desktop-modules.md §24.5): one way to open any pane kind — a conversation (in the
// focused pane, or beside it), a page (its own pane in the focused conversation's Shelf; 页面打开位置 =
// 占用会话: over the focused conversation column, with its own page header) or a
// tool kind (the tool area: the right-most column, ≤ 3 panes, then tabs; lib/sideServices). Also the
// v1.17 alias of services.side.open for the v1.16 `conversation.agent` component (merged into
// `core.conversation`: a conversation pane fixed to that agent). Shell code: names no feature.
import type { PaneOpenOptions, PaneOpenResult, SideOpenOptions, SideOpenResult } from "../modules/slots";
import type { ItemId, Json, PageParams } from "../modules/types";
import { isColumnPage, useApp } from "../store";
import { kindsOnScreen, setPageOpener, setShelfKindsShown } from "./pageOpener";
import { sideViewNow } from "./sideComponents";
import { getAppearance } from "./appearance";
import type { PageOpenPlace } from "./appearanceModel";
import { CONVERSATION_KIND, focusedConversation, isPageKind, PAGE_KIND_PREFIX, pageKind, paneShowing } from "./paneLayout";
import { isFullWindowPage, paneKindsNow } from "./paneKinds";
import { openAgentBeside, setFullWindowPages, usePanes } from "./paneStore";
import { SIDE_AGENT_COMPONENT } from "./sideKinds";
import { locate } from "./sideLayout";
import { useSide } from "./sideLayoutStore";
import { sideOpen, whyUnavailable } from "./sideServices";
import { widenForPage } from "./pageShelfWidth";

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

/** 页面打开位置 now (Settings → 外观 → 窗口与卡片): the focused conversation's Shelf (default) or 占用会话. */
export const pageOpenPlace = (): PageOpenPlace => getAppearance().pageOpen;

/**
 * A page as its own pane in the focused conversation's Shelf (§24.4, 2026-10-21): placed like any tool kind (its
 * own page of the Shelf, or a tab per the Shelf's mixing rules), revealed and focused. A page already open there
 * shows the new params (single instance). Null: not opened there (a full-window page, unknown, the Shelf refused).
 */
export function openPageInShelf(page: ItemId, params: PageParams = {}): { instanceId: string; paneId: string | null } | null {
  if (isFullWindowPage(page)) return null;
  const r = sideOpen(pageKind(page) as ItemId, { ...params } as Json, { reveal: true, focus: true });
  if (r.status !== "opened" || r.where !== "card") return null;
  // Design 011: a page newly in a Shelf narrower than its own width widens it once.
  if (!r.reused) widenForPage(r.instanceId);
  return { instanceId: r.instanceId, paneId: locate(useSide.getState().layout, r.instanceId)?.card.id ?? null };
}

// store.openPage (services.ui.openPage, sidebar entries, ⌘K, links, deep links) asks here first.
setPageOpener((page, params) => pageOpenPlace() === "shelf" && openPageInShelf(page, params) !== null);
// What the Shelf shows (an approvals page there counts as looked at, like over the column).
setShelfKindsShown(() => kindsOnScreen(useSide.getState().layout, sideViewNow()));

/** A page kind: as services.ui.openPage — its own Shelf pane, or over the focused conversation column (占用会话). */
function openPageKind(kind: string, params: Json | undefined): PaneOpenResult {
  const page = kind.slice(PAGE_KIND_PREFIX.length) as ItemId;
  const entry = paneKindsNow().find((k) => k.id === kind);
  if (!entry && !isFullWindowPage(page)) return { status: "unavailable", reason: "unknown-kind" };
  const flat: Record<string, string> = {};
  if (isRecord(params)) for (const [k, v] of Object.entries(params)) if (typeof v === "string") flat[k] = v;
  if (isFullWindowPage(page)) {
    useApp.getState().openPage(page, flat);
    return { status: "opened", kind, paneId: null, instanceId: null };
  }
  const shelf = pageOpenPlace() === "shelf" && !isColumnPage(page) ? openPageInShelf(page, flat) : null;
  if (shelf) return { status: "opened", kind, paneId: shelf.paneId, instanceId: shelf.instanceId };
  useApp.setState({ view: { kind: "page", page, params: flat } });
  return { status: "opened", kind, paneId: focusedConversation(usePanes.getState().layout), instanceId: null };
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
