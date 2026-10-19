// services.refs / services.timeline (docs/desktop-modules.md §19.6–§19.9): the one entry point for
// every stored pointer. Refs are re-validated on every open (stored data is untrusted) and dispatched
// by kind:
//   turn                   content: the reference card (left gutter / right side); how "jump" = 跳过去
//   peekable component     content: a reference card of that component (fromRef params)
//   other component        tool: side.reveal — find the live instance (or reopen it), switch, flash
//   agent / side.page /    tools the shell finds and focuses itself
//   main.page
//   anything else          the kind's one `ref.target` provider (never starts / restarts anything)
// how: "auto" (content → reference card where the setting puts it; tools → focus), "peek" (在左侧预览:
// the gutter, or over the column when it is narrow), "page" (在右侧打开), "jump" (turns only).
import { appModules } from "../modules/app";
import type { CutexRef, FocusTurnResult, RefOpenResult, SideOpenResult } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { agentHost, sidebarOf, useApp, viewHostOf, viewOf } from "../store";
import { jumpToTurn } from "./jump";
import { usePeek } from "./peekStore";
import { agentRef, mainPageRef, pageParamsOf, parseRef, sidePageRef, turnRef } from "./refs";
import { sideRegistry, sideViewNow } from "./sideComponents";
import { TURN_PEEK } from "./sideKinds";
import { instanceVisible, pageInView } from "./sideLayout";
import { pageLabel } from "./sideActions";
import { updateLayout, useSide } from "./sideLayoutStore";
import { sideOpen, sideOpenPeek, sideReveal, whyUnavailable } from "./sideServices";

type How = "auto" | "peek" | "page" | "jump";
type Unavailable = Extract<RefOpenResult, { status: "unavailable" }>["reason"];

const activeHostId = () => useApp.getState().hosts?.active ?? "local";
/** The open agent's host (multi-host P1: an agent of another host in the scope opens in place). */
const viewHostId = () => agentHost(useApp.getState());

export function timelineFocusTurn(hostId: string, sessionId: string, turnId: string, opts?: { back?: boolean }): Promise<FocusTurnResult> {
  return jumpToTurn(hostId, sessionId, turnId, opts);
}

function fromOpen(r: SideOpenResult): RefOpenResult {
  if (r.status === "opened") return { status: "opened", where: r.where === "peek" ? "peek" : "card" };
  if (r.status === "stale") return r;
  const map: Record<typeof r.reason, Unavailable> = {
    "unknown-kind": "module-off",
    "module-off": "module-off",
    capability: "capability",
    "agent-feature": "capability",
    "bad-params": "bad-ref",
    "no-agent": "gone",
    "host-offline": "host-offline",
  };
  return { status: "unavailable", reason: map[r.reason] };
}

/** Content (a turn, a peekable component) by `how`. */
function openContent(kind: ItemId, params: Json, how: How): RefOpenResult {
  if (how === "page") return fromOpen(sideOpen(kind, params, { target: "page", focus: true }));
  if (how === "peek") return fromOpen(sideOpenPeek(kind, params, "left"));
  return fromOpen(sideOpen(kind, params, { target: "peek" }));
}

/** The reference card's open params of a `turn` ref (the snapshot travels along for a gone turn). */
export function turnPeekParams(ref: CutexRef): Json | null {
  const { sessionId, turnId, threadId, ordinal } = ref.params;
  if (!sessionId || !turnId) return null;
  return {
    hostId: ref.hostId,
    sessionId,
    turnId,
    ...(threadId ? { threadId } : {}),
    ...(ordinal && /^\d{1,9}$/.test(ordinal) ? { ordinal: Number(ordinal) } : {}),
    ...(ref.snapshot?.agentName ? { agentName: ref.snapshot.agentName } : {}),
    ...(ref.snapshot?.snippet ? { snippet: ref.snapshot.snippet } : {}),
  };
}

function rows(hostId: string = viewHostId()) {
  const sidebar = sidebarOf(useApp.getState(), hostId);
  return [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
}

export async function refsOpen(raw: CutexRef, opts: { how?: How } = {}): Promise<RefOpenResult> {
  const ref = parseRef(raw);
  if (!ref) return { status: "unavailable", reason: "bad-ref" };
  if (ref.hostId !== activeHostId() && ref.hostId !== viewHostId()) return { status: "unavailable", reason: "host-changed" };
  const how = opts.how ?? "auto";
  switch (ref.kind) {
    case "turn": {
      const params = turnPeekParams(ref);
      if (!params) return { status: "unavailable", reason: "bad-ref" };
      if (how === "jump") {
        const r = await jumpToTurn(ref.hostId, ref.params.sessionId!, ref.params.turnId!);
        if (r.status === "focused") return { status: "opened", where: "timeline" };
        if (r.status === "stale") return r;
        if (r.status === "host-offline") return { status: "unavailable", reason: "host-offline" };
        return { status: "unavailable", reason: r.reason === "reverted" ? "reverted" : "gone" };
      }
      return openContent(TURN_PEEK, params, how);
    }
    case "agent": {
      const id = ref.params.sessionId ?? ref.key;
      if (!rows(ref.hostId).some((r) => r.cutexSessionId === id)) return { status: "unavailable", reason: "gone" };
      await useApp.getState().openAgent(id, ref.hostId);
      return { status: "opened", where: "selected" };
    }
    case "main.page": {
      const page = ref.params.page;
      const params = pageParamsOf(ref.params.pageParams);
      if (!page || !/^[^.]+\..+$/.test(page) || !params) return { status: "unavailable", reason: "bad-ref" };
      const host = appModules();
      const entry = host.snapshot("main.page").find((e) => e.item.id === page);
      if (!entry || entry.mode !== "show") {
        const owner = host.modules.find((m) => m.contributes?.["main.page"]?.some((i) => i.id === page));
        if (!owner) return { status: "unavailable", reason: "bad-ref" };
        const state = host.statuses().get(owner.id)?.state;
        return { status: "unavailable", reason: state?.kind === "unavailable" && state.missing.capabilities.length ? "capability" : "module-off" };
      }
      let safe: Record<string, string> | null = null;
      try {
        safe = entry.item.refParams ? (entry.item.refParams(params) as Record<string, string> | null) : null;
      } catch {
        safe = null;
      }
      if (!safe) return { status: "unavailable", reason: "bad-ref" };
      useApp.getState().openPage(page as ItemId, safe);
      return { status: "opened", where: "page" };
    }
    case "side.page": {
      const { layout } = useSide.getState();
      const groups = (ref.params.groups ?? "").split(",").filter(Boolean);
      const page = layout.pages.find((p) => p.id === (ref.params.pageId ?? ref.key)) ?? layout.pages.find((p) => p.groups.some((g) => groups.includes(g)));
      if (!page) return { status: "unavailable", reason: "gone" };
      updateLayout((l) => ({ ...l, open: true, activePage: page.id }));
      return { status: "opened", where: "card" };
    }
  }
  const kind = ref.kind as ItemId;
  const entry = sideRegistry().get(kind);
  if (entry) {
    // The side column shows the open agent's host only: a card of another (e.g. the focus) host would
    // never be visible.
    if (ref.hostId !== viewHostId()) return { status: "unavailable", reason: "host-changed" };
    if (entry.item.peekable && how !== "page") {
      let params: Json | null;
      try {
        params = entry.item.fromRef ? entry.item.fromRef(ref.params) : { ...ref.params };
      } catch {
        params = null;
      }
      if (params === null) return { status: "unavailable", reason: "bad-ref" };
      return openContent(kind, params, how);
    }
    const r = sideReveal({ ref });
    if (r.status === "stale") return r;
    if (r.status === "unavailable") return { status: "unavailable", reason: r.reason };
    return { status: "opened", where: "card" };
  }
  if (appModules().modules.some((m) => m.contributes?.["side.component"]?.some((i) => i.id === kind))) {
    return { status: "unavailable", reason: whyUnavailable(kind) === "capability" ? "capability" : "module-off" };
  }
  const target = appModules()
    .snapshot("ref.target")
    .find((e) => e.mode === "show" && e.item.kind === ref.kind);
  if (!target) return { status: "unavailable", reason: "module-off" };
  try {
    return await target.item.open(ref, how === "jump" ? "auto" : how);
  } catch {
    return { status: "unavailable", reason: "gone" };
  }
}

/** A loaded turn's ref (hover bars, message menus): name, start time, ordinal when the whole history is known, the thread. */
export function turnRefNow(sessionId: string, turnId: string, snippet?: string): CutexRef {
  const s = useApp.getState();
  const hostId = viewHostOf(sessionId);
  const view = viewOf(s, hostId, sessionId);
  const turns = view?.timeline.turns ?? [];
  const index = turns.findIndex((x) => x.id === turnId);
  const complete = !!view && (!view.older || view.older.cursor === null);
  const name = rows(hostId).find((r) => r.cutexSessionId === sessionId)?.displayName;
  return turnRef({
    hostId,
    sessionId,
    turnId,
    agentName: name,
    startedAt: index >= 0 ? (turns[index]!.startedAt ?? null) : null,
    ordinal: complete && index >= 0 ? index + 1 : null,
    threadId: view?.timeline.threadId ?? null,
    snippet,
  });
}

/** A side instance's ref (toRef); the core reference component's refs are `turn` refs. */
export function instanceRef(hostId: string, kind: ItemId, state: Json): CutexRef | null {
  const item = sideRegistry().get(kind)?.item;
  if (!item?.toRef) return null;
  try {
    const r = item.toRef(state);
    if (!r) return null;
    const ref: CutexRef = { hostId, kind: kind === TURN_PEEK ? "turn" : kind, key: r.key, title: r.title, params: r.params, ...(r.snippet ? { snapshot: { at: new Date().toISOString(), snippet: r.snippet } } : {}) };
    return parseRef(ref);
  } catch {
    return null;
  }
}

/** Refs for what is on screen now (§19): the selected agent, the open page, the side page in view and its visible instances, the reference card. */
export function refsHere(): readonly CutexRef[] {
  const s = useApp.getState();
  const hostId = activeHostId();
  const out: (CutexRef | null)[] = [];
  const agent = s.selectedId ? rows().find((r) => r.cutexSessionId === s.selectedId) : null;
  if (s.selectedId) out.push(agentRef(viewHostId(), s.selectedId, agent?.displayName ?? s.selectedId));
  if (s.view.kind === "page") {
    const entry = appModules()
      .snapshot("main.page")
      .find((e) => e.mode === "show" && e.item.id === (s.view as { page: string }).page);
    try {
      const safe = entry?.item.refParams?.(s.view.params) ?? null;
      if (entry && safe) out.push(mainPageRef(hostId, entry.item.id, safe as Record<string, string>, entry.item.id));
    } catch {
      // not referable now
    }
  }
  const { layout } = useSide.getState();
  const ctx = sideViewNow();
  const page = layout.open ? pageInView(layout, ctx) : null;
  if (page) out.push(sidePageRef(hostId, page, pageLabel(page)));
  for (const [id, inst] of Object.entries(layout.instances)) {
    if (instanceVisible(layout, id, ctx)) out.push(instanceRef("hostId" in inst.binding ? inst.binding.hostId : hostId, inst.kind, inst.state));
  }
  const peek = usePeek.getState().peek;
  if (peek) out.push(instanceRef(peek.hostId, peek.kind, peek.state));
  return out.filter((r): r is CutexRef => !!r && parseRef(r) !== null);
}
