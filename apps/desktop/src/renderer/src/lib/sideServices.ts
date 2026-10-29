// services.side (docs/desktop-modules.md §18.8, §19): the one way modules, shell and core code open,
// reveal and close right-side content and reference cards (target "peek": the left gutter when it
// fits, lib/peekTarget.ts, else the right side). Never "opened" without something visible: a missing
// component / module / capability / agent says why. services.timeline / services.refs: lib/refServices.ts.
import { appModules } from "../modules/app";
import type { SideBinding, SideHoldLocator, SideInstanceInfo, SideOpenHeldOptions, SideOpenHeldResult, SideOpenOptions, SideOpenResult, SideReleaseHoldOptions, SideRevealResult, SideRevealTarget } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { agentHost, selectedSidebar, sidebarOf, useApp } from "../store";
import { hostEpoch, scopeHosts } from "../../../shared/hosts";
import { admitHold, holdScopeCheck, keepMountedLimit, releaseSideHold, takeTicketHold, useSideKeep, type HoldScopeInput } from "./sideKeep";
import { PEEK_MIN } from "./gutterLayout";
import { leftGutterNow, useGutter } from "./gutterStore";
import { showPeek, usePeek } from "./peekStore";
import { peekTarget, type PeekSetting } from "./peekTarget";
import { getUiPrefs } from "./prefs";
import { parseRef } from "./refs";
import { dedupeKeyOf, sideRegistry, sideViewNow, specFrom, type SideComponentEntry } from "./sideComponents";
import { STATUS_COMPONENT_PREFIX } from "./sideKinds";
import {
  applyOpen,
  chipHolding,
  DEFAULT_ORDER,
  instanceVisible,
  locate,
  locateChip,
  pinInstance,
  place,
  restoreCard,
  resolveBinding,
  revealInstance,
  sameBinding,
  type SideInstance,
  type SideLayout,
} from "./sideLayout";
import {
  adoptIntoConversation,
  bumpRevealed,
  closeInConversation,
  closeInstancesAnywhere,
  closeInstancesIn,
  findInConversation,
  flashInstance,
  homeConversation,
  instanceAnywhere,
  liveConversation,
  newInstanceIdFor,
  setMode,
  uncoverTools,
  updateLayout,
  useSide,
  withLiveShelf,
} from "./sideLayoutStore";
import { translate } from "../i18n";
import { ownerName } from "./hiddenPageNames";
import { showShelfNotice } from "./shelves";
import { scopeFor, scopeKey } from "./workspace";
import { roomForColumn } from "./paneRoom";
import { scopeHost } from "./paneFile";

type Unavailable = Extract<SideOpenResult, { status: "unavailable" }>["reason"];

/** The focus host (the side layout is stored per focus host). */
const activeHostId = () => useApp.getState().hosts?.active ?? "local";
/** The open agent's host (bindings, peeks, refs): another host's agent opens in place (multi-host P1). */
const viewHostId = () => agentHost(useApp.getState());

/**
 * Whether a card bound to `hostId` shows on the right side now: the side shows the open agent's host
 * only (useSideView), so an open bound to another host lands in the layout but stays out of view
 * until an agent of that host is opened. Interactive opens of another host's content (a remote
 * host's row on a merged list page) check this and fall back (system browser, inline view, notice).
 */
export function sideShowsHost(hostId: string): boolean {
  return hostId === viewHostId();
}

/** Why a component id is not available now (it is not in the registry). */
export function whyUnavailable(kind: ItemId): Unavailable {
  const host = appModules();
  const statusItem = kind.startsWith(STATUS_COMPONENT_PREFIX) ? kind.slice(STATUS_COMPONENT_PREFIX.length) : null;
  const owner = host.modules.find((m) =>
    statusItem ? m.contributes?.["conversation.status"]?.some((i) => i.id === statusItem) : m.contributes?.["side.component"]?.some((i) => i.id === kind) || m.contributes?.["pane.kind"]?.some((i) => i.id === kind),
  );
  if (!owner) return "unknown-kind";
  const state = host.statuses().get(owner.id)?.state;
  if (state?.kind === "unavailable" && state.missing.capabilities.length) return "capability";
  return "module-off";
}

/** The conversation a pane-originated open fills default bindings from (design 017): its Shelf's, not the focused one. */
type FillFrom = { hostId: string; sessionId: string };

/** The default binding of a component filled from the selected agent / its host (or `from`: the source Shelf's conversation). */
function fillBinding(kind: SideBinding["kind"], from?: FillFrom): SideBinding | null {
  const s = useApp.getState();
  const hostId = from?.hostId ?? viewHostId();
  const sessionId = from ? from.sessionId : s.selectedId;
  switch (kind) {
    case "follow":
      return { kind: "follow", hostId };
    case "agent":
      return sessionId ? { kind: "agent", hostId, sessionId } : null;
    case "workspace": {
      const scope = scopeFor(from ? sidebarOf(s, hostId) : selectedSidebar(s), sessionId);
      return scope ? { kind: "workspace", hostId, key: scopeKey(scope) } : null;
    }
    case "host":
      return { kind: "host", hostId };
  }
}

function lacksFeature(entry: SideComponentEntry, binding: SideBinding): boolean {
  const ctx = sideViewNow();
  const session = resolveBinding(binding, ctx).sessionId;
  return !!entry.item.agentFeature && !!ctx.lacks?.(entry.item.id, session);
}

/** v1.10 open({ hold }): what the scope rule (sideKeep holdScopeCheck) needs to know about `binding`. */
function holdScopeInput(binding: SideBinding, expectEpoch: string | undefined): HoldScopeInput {
  const s = useApp.getState();
  const hostId = binding.hostId;
  const known = hostId === "local" || !!s.hosts?.hosts.some((h) => h.id === hostId);
  const inScope = hostId === activeHostId() || (s.hosts ? scopeHosts(s.hosts).includes(hostId) : false);
  let agentKnown: boolean | null = null;
  if (binding.kind === "agent") {
    const sidebar = sidebarOf(s, hostId);
    agentKnown = sidebar ? [...sidebar.active, ...sidebar.retired].some((r) => r.cutexSessionId === binding.sessionId) : null;
  }
  return { known, inScope, agentKnown, epoch: hostEpoch(s.hosts, hostId), ...(expectEpoch === undefined ? {} : { expectEpoch }) };
}

/** v1.10 services.side.releaseHold (§18.14): drops an open({ hold })'s pre-hold; `discard` also closes the card that open created. */
export function sideReleaseHold(hold: SideHoldLocator, opts: SideReleaseHoldOptions = {}): boolean {
  const r = releaseSideHold(hold, !!opts.discard);
  if (r.close) closeInstancesIn(hold.scope, [hold.instanceId]);
  return r.released;
}

function staleScope(): boolean {
  const scope = useSide.getState().scope;
  return scope !== null && scopeHost(scope) !== activeHostId();
}

/** The conversation is on screen with its gutters measured and not covered by a maximised / full-screen side. */
function conversationShown(): boolean {
  const s = useApp.getState();
  return s.view.kind === "conversation" && !!s.selectedId && !useSide.getState().mode && useGutter.getState().geometry !== null;
}

export function sideOpen(kind: ItemId, params: Json = null, opts: SideOpenOptions = {}): SideOpenResult {
  return open(kind, params, opts, opts.target === "peek" ? getUiPrefs().peekTarget : null) as SideOpenResult;
}

/** A reference card where `setting` puts it (refs.open "peek" = 在左侧预览 forces "left"); else the right side. */
export function sideOpenPeek(kind: ItemId, params: Json, setting: PeekSetting, opts: Omit<SideOpenOptions, "target"> = {}): SideOpenResult {
  return open(kind, params, { ...opts, target: "peek" }, setting, setting) as SideOpenResult;
}

/**
 * v1.10 services.side.openHeld (§18.14): a background card held mounted from its first render. Never
 * reveals, focuses or switches page / scope / agent; refusals change nothing.
 */
export function sideOpenHeld(kind: ItemId, params: Json = null, opts: SideOpenHeldOptions = {}): SideOpenHeldResult {
  const { hostEpoch, ...rest } = opts;
  return open(kind, params, { ...rest, target: "page", held: hostEpoch === undefined ? {} : { hostEpoch } }, null) as SideOpenHeldResult;
}

/**
 * An open from inside another workspace's Shelf, run while that Shelf is the live layout (lib/shelfTarget,
 * design 017): like sideOpen, default bindings filled from that Shelf's conversation; never a reference card
 * (the left gutter is the focused conversation's).
 */
export function sideOpenAs(from: FillFrom, kind: ItemId, params: Json = null, opts: SideOpenOptions = {}): SideOpenResult {
  return open(kind, params, { ...opts, ...(opts.target === "peek" ? { target: "page" as const } : {}), fillFrom: from }, null) as SideOpenResult;
}

/** open() and openHeld() (v1.10: `held` = background open + first hold, no reveal / focus). */
type OpenOptions = SideOpenOptions & { held?: { hostEpoch?: string }; fillFrom?: FillFrom };

function open(kind: ItemId, params: Json, opts: OpenOptions, peek: PeekSetting | null, preference?: PeekSetting): SideOpenResult | SideOpenHeldResult {
  if (staleScope()) return { status: "stale" };
  const registry = sideRegistry();
  const entry = registry.get(kind);
  if (!entry) return { status: "unavailable", reason: whyUnavailable(kind) };
  const item = entry.item;
  let parsed: Json | null;
  try {
    parsed = item.parseParams(params ?? {});
  } catch {
    parsed = null;
  }
  if (parsed === null) return { status: "unavailable", reason: "bad-params" };
  const binding = opts.binding ?? fillBinding(item.defaultBinding, opts.fillFrom);
  if (!binding) return { status: "unavailable", reason: "no-agent" };
  if (lacksFeature(entry, binding)) return { status: "unavailable", reason: "agent-feature" };
  if (opts.held) {
    // v1.10 (§18.14): every refusal comes before any layout or hold change.
    if (item.keepAlive !== "hidden") return { status: "unavailable", reason: "not-holdable" };
    const why = holdScopeCheck(holdScopeInput(binding, opts.held.hostEpoch));
    if (why === "stale") return { status: "stale" };
    if (why !== "ok") return { status: "unavailable", reason: why };
  }
  const key = dedupeKeyOf(item, parsed);
  // The reference card (§19.4–§19.5): in the left gutter / over the column, outside the layout.
  const where = peek !== null && item.peekable ? peekTarget(peek, leftGutterNow(), PEEK_MIN, conversationShown()) : "page";
  if (where !== "page") {
    const current = usePeek.getState().peek;
    const same = !!current && current.kind === kind && key !== null && current.key === key;
    let state: Json;
    try {
      state = item.init(parsed, same ? current!.state : null);
    } catch {
      return { status: "unavailable", reason: "bad-params" };
    }
    const shown = showPeek({ kind, binding, key, params: parsed, state, v: item.stateVersion ?? 1, hostId: viewHostId(), where, ...(preference === undefined ? {} : { preference }) }, !!opts.focus);
    return { status: "opened", instanceId: shown.id, where: "peek", pageId: null, reused: shown.reused };
  }
  // An agent's own open for an agent not focused (owner 2026-10-23): that agent's own Shelf — the other workspace's
  // live Shelf when it is on screen, else its stored one, there when that agent is opened. Never the focused
  // conversation's, where it would not show.
  const home = homeConversation(binding);
  if (home) {
    if (useSide.getState().peers[home]) return withLiveShelf(home, () => open(kind, params, opts, null, preference));
    return openInto(home, kind, entry, parsed, binding, key, opts);
  }
  // links-new-tab: link opens arrive with pin (lib/sideOpen.ts); the rest replace like 替换.
  // A held open never replaces a preview in place (it would drop another tab): it opens pinned.
  const transient = !!item.transient && !opts.pin && !opts.held && getUiPrefs().sidePreview !== "new-tab";
  const spec = specFrom(registry, kind)!;
  const { scope } = useSide.getState();
  // Already open but collapsed to a chip (§24 step 4): it goes back to its place first, then reveals as usual.
  const chipped = opts.held ? null : chipHolding(useSide.getState().layout, kind, key, binding);
  if (chipped) updateLayout((l) => restoreCard(l, chipped.card.id, Date.now(), { roomForColumn: roomForColumn("tool") }));
  let layout = useSide.getState().layout;
  // minSize (§24 step 4): no new tool column the work area cannot fit — a tab instead.
  const roomForNewColumn = roomForColumn("tool");
  const decide = () => place(layout, { kind, binding, key, transient, page: opts.page, activePage: layout.activePage, columnOpen: layout.open, roomForColumn: roomForNewColumn }, spec, (k) => specFrom(registry, k)?.order ?? DEFAULT_ORDER);
  let decision = decide();
  // Replace guard (v1.11, §18.2): a transient tab whose closing would end something (its component's
  // closeConfirm warns) is not replaced — it is promoted to kept and the new item opens as its own transient tab.
  if (decision.op === "replace" && closeWarnings([decision.instance]).length) {
    const kept = decision.instance;
    updateLayout((l) => pinInstance(l, kept));
    layout = useSide.getState().layout;
    decision = decide();
  }
  const previous = decision.op === "activate" ? (layout.instances[decision.instance]?.state ?? null) : null;
  let state: Json;
  try {
    state = item.init(parsed, previous);
  } catch {
    return { status: "unavailable", reason: "bad-params" };
  }
  if (opts.held) {
    if (!scope) return { status: "stale" };
    const admitted = admitHold(useSideKeep.getState().holds, scope, decision.op === "activate" ? decision.instance : null, item.keepAlive, keepMountedLimit());
    if (admitted !== "ok") return { status: "unavailable", reason: admitted };
  }
  const background = !opts.held && !!opts.background;
  const reveal = opts.held || background ? false : (opts.reveal ?? true);
  if (reveal) uncoverTools();
  let applied: ReturnType<typeof applyOpen> | null = null;
  updateLayout((current: SideLayout) => {
    applied = applyOpen(current, decision, { kind, binding, key, state, v: item.stateVersion ?? 1, pinned: !!opts.pin || (!!item.transient && !transient) }, Date.now(), { reveal, home: spec.home, keepActive: background });
    return applied.layout;
  });
  const done = applied as ReturnType<typeof applyOpen> | null;
  if (!done) return { status: "stale" };
  if (opts.held && scope) {
    // Admitted above, in the same synchronous call: the Body's first render sees held = true.
    const inst = useSide.getState().layout.instances[done.instanceId];
    const hold = inst ? takeTicketHold(scope, done.instanceId, inst, !done.reused) : null;
    if (!hold) {
      if (!done.reused) closeInstancesIn(scope, [done.instanceId]);
      return { status: "unavailable", reason: "hold-limit" };
    }
    return { status: "opened", instanceId: done.instanceId, pageId: done.pageId, reused: done.reused, hold };
  }
  if (opts.target === "maximised" || opts.target === "fullscreen") {
    const at = locate(useSide.getState().layout, done.instanceId);
    if (at) setMode({ kind: opts.target, card: at.card.id });
  }
  if (background) flashInstance(done.instanceId);
  else if (opts.focus) bumpRevealed(done.instanceId);
  return { status: "opened", instanceId: done.instanceId, where: "card", pageId: done.pageId, reused: done.reused };
}

/**
 * open() into conversation `home`'s own Shelf, not on screen: its pane of that kind (the same item again: that tab),
 * else a page of its own; a background tab, held like any held open. The owner hears of it (noticeAgentOpen).
 */
function openInto(home: string, kind: ItemId, entry: SideComponentEntry, parsed: Json, binding: SideBinding, key: string | null, opts: OpenOptions): SideOpenResult | SideOpenHeldResult {
  const { scope } = useSide.getState();
  if (!scope) return { status: "stale" };
  const item = entry.item;
  const found = key === null ? null : findInConversation(home, (inst) => inst.kind === kind && inst.key === key && sameBinding(inst.binding, binding));
  let state: Json;
  try {
    state = item.init(parsed, found?.inst.state ?? null);
  } catch {
    return { status: "unavailable", reason: "bad-params" };
  }
  if (opts.held) {
    const admitted = admitHold(useSideKeep.getState().holds, scope, found?.id ?? null, item.keepAlive, keepMountedLimit());
    if (admitted !== "ok") return { status: "unavailable", reason: admitted };
  }
  const now = Date.now();
  const id = found?.id ?? newInstanceIdFor(home);
  const v = item.stateVersion ?? 1;
  const inst: SideInstance = found ? { ...found.inst, state, v, lastActiveAt: now } : { kind, binding, key, state, v, pinned: true, lastActiveAt: now };
  const pageId = adoptIntoConversation(home, id, inst, now);
  if (pageId === null) return { status: "stale" };
  if (opts.held) {
    const hold = takeTicketHold(scope, id, inst, !found);
    if (!hold) {
      if (!found) closeInConversation(home, [id]);
      return { status: "unavailable", reason: "hold-limit" };
    }
    noticeAgentOpen(home, binding, item.titleKey, id);
    return { status: "opened", instanceId: id, pageId, reused: !!found, hold };
  }
  noticeAgentOpen(home, binding, item.titleKey, id);
  return { status: "opened", instanceId: id, where: "card", pageId, reused: !!found };
}

/** When each conversation's last 「去看看」 notice was shown (one a minute per agent: an agent opening many tabs). */
const noticedAt = new Map<string, number>();

/**
 * 「小侦探 打开了浏览器，放在它自己的 Shelf 里 · 去看看」: an agent's open went to its own Shelf, not on screen. 去看看 opens
 * that agent and shows the tab there.
 */
function noticeAgentOpen(home: string, binding: SideBinding, titleKey: Parameters<typeof translate>[0], id: string): void {
  if (binding.kind !== "agent") return;
  const now = Date.now();
  if (now - (noticedAt.get(home) ?? -Infinity) < 60_000) return;
  noticedAt.set(home, now);
  const { hostId, sessionId } = binding;
  const name = ownerName(useApp.getState(), { hostId, sessionId });
  showShelfNotice(translate("shelf.toast.agentOpened", { name, kind: translate(titleKey) }), {
    label: translate("shelf.toast.goSee"),
    run: () =>
      void Promise.resolve(useApp.getState().select(sessionId, hostId)).then(() => {
        if (liveConversation() === home) sideReveal({ instanceId: id });
      }),
  });
}

export function sideReveal(target: SideRevealTarget): SideRevealResult {
  if (staleScope()) return { status: "stale" };
  const { layout } = useSide.getState();
  if ("instanceId" in target) {
    // A collapsed pane (a chip) holding it comes back first (§24 step 4).
    const chip = locateChip(layout, target.instanceId);
    if (chip) updateLayout((l) => restoreCard(l, chip.card.id, Date.now(), { roomForColumn: roomForColumn("tool") }));
    const at = locate(useSide.getState().layout, target.instanceId);
    if (!at) return { status: "unavailable", reason: "gone" };
    const kind = layout.instances[target.instanceId]!.kind;
    if (!sideRegistry().has(kind)) return { status: "unavailable", reason: whyUnavailable(kind) === "capability" ? "capability" : "module-off" };
    uncoverTools();
    updateLayout((l) => revealInstance(l, target.instanceId, Date.now()));
    bumpRevealed(target.instanceId);
    flashInstance(target.instanceId);
    return { status: "revealed", instanceId: target.instanceId, pageId: at.page.id };
  }
  const ref = parseRef(target.ref);
  if (!ref) return { status: "unavailable", reason: "bad-ref" };
  if (ref.hostId !== viewHostId()) return { status: "unavailable", reason: "host-offline" };
  const registry = sideRegistry();
  const entry = registry.get(ref.kind as ItemId);
  if (!entry) {
    const why = whyUnavailable(ref.kind as ItemId);
    return { status: "unavailable", reason: why === "unknown-kind" ? "bad-ref" : why === "capability" ? "capability" : "module-off" };
  }
  const ctx = sideViewNow();
  const live = Object.entries(layout.instances).find(([id, inst]) => inst.kind === ref.kind && inst.key === ref.key && instanceVisible(layout, id, ctx));
  if (live) return sideReveal({ instanceId: live[0] });
  let params: Json | null;
  try {
    params = entry.item.fromRef ? entry.item.fromRef(ref.params) : { ...ref.params };
  } catch {
    params = null;
  }
  if (params === null) return { status: "unavailable", reason: "bad-ref" };
  const opened = sideOpen(ref.kind as ItemId, params, { focus: true });
  if (opened.status !== "opened") return opened.status === "stale" ? opened : { status: "unavailable", reason: "gone" };
  flashInstance(opened.instanceId);
  return { status: "reopened", instanceId: opened.instanceId, pageId: opened.pageId ?? "" };
}

/** Closes instances through their components' onClose (false = keep). No confirm: callers ask first. */
export async function closeSideInstances(ids: readonly string[]): Promise<void> {
  const registry = sideRegistry();
  const closing: string[] = [];
  for (const id of ids) {
    // The focused Shelf's, or one of the other workspace's live Shelf (§24.13: its tools close there).
    const inst = instanceAnywhere(id);
    if (!inst) continue;
    const item = registry.get(inst.kind)?.item;
    let ok = true;
    if (item?.onClose) {
      try {
        ok = (await item.onClose({ id, kind: inst.kind, binding: inst.binding, state: inst.state, pinned: inst.pinned })) !== false;
      } catch {
        ok = true;
      }
    }
    if (ok) closing.push(id);
  }
  closeInstancesAnywhere(closing);
}

/** The one-line warnings of a bulk close (closeConfirm), for a single confirm. */
export function closeWarnings(ids: readonly string[]): string[] {
  const registry = sideRegistry();
  const out: string[] = [];
  for (const id of ids) {
    const inst = instanceAnywhere(id);
    const item = inst && registry.get(inst.kind)?.item;
    if (!inst || !item?.closeConfirm) continue;
    try {
      const line = item.closeConfirm({ id, kind: inst.kind, binding: inst.binding, state: inst.state, pinned: inst.pinned });
      if (line) out.push(line);
    } catch {
      // a broken closeConfirm does not block the close
    }
  }
  return out;
}

export function sideList(kind: ItemId): readonly SideInstanceInfo<Json>[] {
  const { layout } = useSide.getState();
  const ctx = sideViewNow();
  return Object.entries(layout.instances)
    .filter(([id, inst]) => inst.kind === kind && instanceVisible(layout, id, ctx))
    .map(([id, inst]) => ({ id, kind: inst.kind, binding: inst.binding, state: inst.state, pinned: inst.pinned }));
}
