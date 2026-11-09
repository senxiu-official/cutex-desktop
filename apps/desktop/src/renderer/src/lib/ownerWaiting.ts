// `services.activity.subscribeOwnerWaiting` (v1.30, docs/desktop-modules.md §29): what waits on the owner on every
// connected host, item by item: a native request (a question or an approval of a command / file change), an owner
// approval, an agent → owner message not handled yet. The same things the tray's attention count adds up
// (lib/shell.ts attentionByHost); agent ↔ agent traffic is not among them. Each item says whether its agent is on screen
// in a visible window, so a module can tell which items the owner has had in front of them.
//
// Costs nothing without a subscriber; with one, a store subscription that recomputes at most every SETTLE_MS when the
// parts it reads change (not per streamed token). The layout stores are loaded by the first subscriber, so the module
// host does not pull the whole workspace graph in at start.
import { useApp } from "../store";
import { useOwnerNotify } from "./ownerNotifyStore";
import { isViewOf, viewKeyParts } from "./viewKey";
import { isPending, OWNER_NOTIFY_FEATURE } from "../../../shared/ownerNotify";
import { LOCAL_HOST_ID } from "../../../shared/hosts";

export interface OwnerWaitingItem {
  hostId: string;
  agentId: string;
  /** Stable while the same thing waits; a new request, approval or message is a new key. */
  key: string;
  /** The agent is in a pane or a Shelf page in view, and the app window is visible. */
  onScreen: boolean;
}
export type OwnerWaitingListener = (items: readonly OwnerWaitingItem[]) => void;

type WaitingState = Pick<ReturnType<typeof useApp.getState>, "sessions" | "approvals" | "features" | "byHost" | "hosts"> & Partial<Pick<ReturnType<typeof useApp.getState>, "hostWaiting">>;

/** The items, without `onScreen` (pure apart from the stores it is given). */
export function ownerWaitingOf(state: WaitingState, notes = useOwnerNotify.getState().byId, others = useOwnerNotify.getState().others): Omit<OwnerWaitingItem, "onScreen">[] {
  const out: Omit<OwnerWaitingItem, "onScreen">[] = [];
  const focus = state.hosts?.active ?? LOCAL_HOST_ID;
  const add = (hostId: string, agentId: string, what: string) => out.push({ hostId, agentId, key: `${hostId}\n${agentId}\n${what}` });
  const viewed = new Set<string>();
  for (const [key, view] of Object.entries(state.sessions)) {
    if (!view.timeline.pending.size || !isViewOf(key, focus)) continue;
    const agent = viewKeyParts(key).sessionId;
    viewed.add(agent);
    for (const id of view.timeline.pending.keys()) add(focus, agent, `request:${id}`);
  }
  // The focus host's requests seen only on its feed (agents not open here) carry their methods, not ids.
  for (const [agent, methods] of Object.entries(state.hostWaiting ?? {})) if (!viewed.has(agent) && methods.length) add(focus, agent, `requests:${methods.join(",")}`);
  for (const a of state.approvals ?? []) add(focus, a.requesterCutexSessionId, `approval:${a.approvalId}`);
  if (state.features.has(OWNER_NOTIFY_FEATURE)) for (const n of Object.values(notes)) if (isPending(n)) add(focus, n.agentId, `note:${n.notificationId}`);
  for (const [hostId, slice] of Object.entries(state.byHost ?? {})) {
    for (const [agent, ids] of Object.entries(slice.waiting)) for (const id of ids) add(hostId, agent, `request:${id}`);
    for (const a of slice.approvals ?? []) add(hostId, a.requesterCutexSessionId, `approval:${a.approvalId}`);
    if (slice.features.has(OWNER_NOTIFY_FEATURE)) for (const n of Object.values(others[hostId] ?? {})) if (isPending(n)) add(hostId, n.agentId, `note:${n.notificationId}`);
  }
  // A request seen both in an open view and on the host feed is one item.
  return [...new Map(out.map((i) => [i.key, i])).values()];
}

const SETTLE_MS = 100;
const listeners = new Set<OwnerWaitingListener>();
let stop: (() => void) | null = null;
let last: readonly OwnerWaitingItem[] = [];

type OnScreen = (hostId: string, agentId: string) => boolean;

function compute(onScreen: OnScreen | null): readonly OwnerWaitingItem[] {
  const visible = typeof document === "undefined" || document.visibilityState === "visible";
  return ownerWaitingOf(useApp.getState()).map((i) => ({ ...i, onScreen: visible && !!onScreen?.(i.hostId, i.agentId) }));
}

const sameItems = (a: readonly OwnerWaitingItem[], b: readonly OwnerWaitingItem[]) => a.length === b.length && a.every((x, i) => x.key === b[i]!.key && x.onScreen === b[i]!.onScreen);

function start(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onScreen: OnScreen | null = null;
  let stopped = false;
  const offs: (() => void)[] = [];
  const run = () => {
    timer = null;
    const next = compute(onScreen);
    if (sameItems(next, last)) return;
    last = next;
    for (const l of [...listeners]) l(next);
  };
  const schedule = () => {
    timer ??= setTimeout(run, SETTLE_MS);
  };
  const offApp = useApp.subscribe((s, p) => {
    if (s.sessions !== p.sessions || s.approvals !== p.approvals || s.features !== p.features || s.byHost !== p.byHost || s.hosts !== p.hosts || s.hostWaiting !== p.hostWaiting) schedule();
  });
  const offNotes = useOwnerNotify.subscribe((s, p) => {
    if (s.byId !== p.byId || s.others !== p.others) schedule();
  });
  void Promise.all([import("./workspaces"), import("./paneStore"), import("./sideLayoutStore")]).then(([workspaces, panes, side]) => {
    if (stopped) return;
    onScreen = (hostId, agentId) => workspaces.isOnScreen({ kind: "agent", hostId, key: agentId });
    offs.push(panes.usePanes.subscribe(schedule), side.useSide.subscribe(schedule));
    schedule();
  }, () => {});
  const onVisibility = () => schedule();
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  last = compute(onScreen);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    offApp();
    offNotes();
    for (const off of offs) off();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    last = [];
  };
}

/** Calls `listener` now with the current items, then whenever they change. */
export function subscribeOwnerWaiting(listener: OwnerWaitingListener): () => void {
  listeners.add(listener);
  stop ??= start();
  listener(last);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
    }
  };
}
