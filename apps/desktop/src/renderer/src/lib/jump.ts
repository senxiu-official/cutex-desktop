// 跳过去 and 「回到」 (services.timeline.focusTurn; docs/desktop-modules.md §19.7; RFC §7.7–§7.8).
// A jump: notes where the owner was reading (the return point, lib/returnPoint.ts), selects the
// target agent (cross-agent), pages older history into the main timeline until the turn is there
// (≤ 5 pages of 200, reusing the reference cache), then focuses it (lib/focusRequest.ts). A turn
// older than that: the 「太早了」 chip offers the reference card instead. The conversation registers
// a viewport probe (capture / restore the reading position) and reports its scrolls.
import { create } from "zustand";
import type { FocusTurnResult } from "../modules/slots";
import { agentHost, useApp, viewOf } from "../store";
import { viewRow } from "./viewHost";
import { useFocusRequest } from "./focusRequest";
import { returnReduce, type ReturnEvent, type ReturnPoint, type ReturnState } from "./returnPoint";
import { LOOKUP_PAGES } from "./turnFetch";
import { cachedReader } from "./turnRefs";

export interface ViewportProbe {
  sessionId: string;
  /** The reading position now: the turn at the viewport's top and the offset into it, or stuck at the bottom. */
  capture(): { turnId: string | null; offset: number; atBottom: boolean } | null;
  /** Re-attach to the bottom. */
  toBottom(): void;
  scroller(): HTMLElement | null;
}

export interface JumpMiss {
  hostId: string;
  sessionId: string;
  turnId: string;
  reason: "too-old" | "reverted" | "unknown";
  nonce: number;
}

export interface JumpState {
  back: ReturnState | null;
  /** The last jump could not land (the chip offers the reference card for a too-old turn). */
  miss: JumpMiss | null;
  /** A jump is selecting / paging. */
  busy: boolean;
}

export const useJump = create<JumpState>(() => ({ back: null, miss: null, busy: false }));

let probe: ViewportProbe | null = null;
/** The agent a jump (or 回到) is selecting: that switch does not dismiss the return point. */
let expected: string | null = null;
/** Scroll reports before this (ms) come from the jump itself, not the owner. */
let settleUntil = 0;
let watching = false;

const activeHost = () => useApp.getState().hosts?.active ?? "local";

export function dispatchReturn(e: ReturnEvent): void {
  const back = useJump.getState().back;
  const next = returnReduce(back, e);
  if (next !== back) useJump.setState({ back: next });
}

function watch(): void {
  if (watching) return;
  watching = true;
  useApp.subscribe((s, prev) => {
    if ((s.hosts?.active ?? "local") !== (prev.hosts?.active ?? "local")) {
      expected = null;
      dispatchReturn({ type: "scope" });
      useJump.setState({ miss: null });
      return;
    }
    if (s.selectedId !== prev.selectedId) {
      const byJump = expected !== null && s.selectedId === expected;
      expected = null;
      dispatchReturn({ type: "select", sessionId: s.selectedId, byJump });
      if (!byJump) useJump.setState({ miss: null });
    }
  });
}

/** The conversation's viewport (one at a time). */
export function registerViewport(p: ViewportProbe): () => void {
  watch();
  probe = p;
  return () => {
    if (probe === p) probe = null;
  };
}

const nameOf = (sessionId: string) => viewRow(useApp.getState(), viewHost(), sessionId)?.displayName ?? sessionId;
/** The open agent's host (multi-host P1: it may not be the focus host). */
const viewHost = () => agentHost(useApp.getState());
/** Open `sessionId` of `hostId` (in place when that host is not the focus host). */
const openOn = (hostId: string, sessionId: string) => (hostId === activeHost() ? useApp.getState().select(sessionId) : useApp.getState().openAgent(sessionId, hostId));
const isOpen = (hostId: string, sessionId: string) => {
  const app = useApp.getState();
  return app.selectedId === sessionId && viewHost() === hostId;
};

function capturePoint(): ReturnPoint | null {
  const s = useApp.getState();
  if (!probe || s.view.kind !== "conversation" || probe.sessionId !== s.selectedId) return null;
  const pos = probe.capture();
  if (!pos) return null;
  const view = viewOf(s, viewHost(), probe.sessionId);
  const turns = view?.timeline.turns ?? [];
  const complete = !!view && (!view.older || view.older.cursor === null);
  const index = pos.atBottom || !pos.turnId ? turns.length - 1 : turns.findIndex((t) => t.id === pos.turnId);
  return { hostId: viewHost(), sessionId: probe.sessionId, agentName: nameOf(probe.sessionId), turnId: pos.turnId, offset: pos.offset, atBottom: pos.atBottom, ordinal: complete && index >= 0 ? index + 1 : null };
}

/** Resolves once `test` holds (or false after `ms`). */
function until(test: () => boolean, ms: number): Promise<boolean> {
  if (test()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const off = useApp.subscribe(() => {
      if (!test()) return;
      off();
      clearTimeout(timer);
      resolve(true);
    });
    const timer = setTimeout(() => {
      off();
      resolve(test());
    }, ms);
  });
}

const viewReady = (hostId: string, sessionId: string) => {
  const v = viewOf(useApp.getState(), hostId, sessionId);
  return !!v && !v.loading;
};

/** Pages older history in until the turn is loaded: null = there, else why not. */
async function pageTo(hostId: string, sessionId: string, turnId: string): Promise<null | "too-old" | "reverted" | "unknown"> {
  const viewNow = () => viewOf(useApp.getState(), hostId, sessionId);
  const has = () => !!viewNow()?.timeline.turns.some((t) => t.id === turnId);
  const read = cachedReader(hostId, sessionId);
  let pages = 0;
  for (let guard = 0; guard < LOOKUP_PAGES * 3; guard++) {
    if (has()) return null;
    const view = viewNow();
    if (!view || view.error) return "unknown";
    if (view.older?.loading) {
      // The owner's own scroll-to-top paging: let it finish first.
      await until(() => !viewNow()?.older?.loading, 15_000);
      continue;
    }
    const cursor = view.older?.cursor;
    if (!cursor) return "reverted";
    if (pages >= LOOKUP_PAGES) return "too-old";
    pages++;
    await useApp.getState().loadOlder(sessionId, { read, hostId });
    const after = viewNow()?.older;
    if (after?.error || (after?.cursor === cursor && !has())) return "unknown";
  }
  return has() ? null : "unknown";
}

/** Asks the conversation to show the turn (and waits for it to say whether it could). */
function focusNow(sessionId: string, turnId: string, land?: (el: Element) => void): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      resolve(ok);
    };
    useFocusRequest.setState({ request: { sessionId, turnId, nonce: Date.now() + Math.random(), onDone: finish, ...(land ? { land } : {}) } });
    setTimeout(() => finish(false), 10_000);
  });
}

/** services.timeline.focusTurn. `back: false` = no 「回到」 point. */
export async function jumpToTurn(hostId: string, sessionId: string, turnId: string, opts: { back?: boolean } = {}): Promise<FocusTurnResult> {
  watch();
  const host = activeHost();
  if (hostId !== host && hostId !== viewHost()) return { status: "host-offline" };
  const stale = () => activeHost() !== host;
  const point = opts.back === false ? null : capturePoint();
  const target = { sessionId, turnId };
  settleUntil = Number.POSITIVE_INFINITY;
  useJump.setState({ busy: true, miss: null });
  try {
    const app = useApp.getState();
    if (!isOpen(hostId, sessionId) || app.view.kind !== "conversation") {
      if (!isOpen(hostId, sessionId)) expected = sessionId;
      await openOn(hostId, sessionId);
    }
    if (!(await until(() => viewReady(hostId, sessionId), 20_000)) || stale()) return stale() ? { status: "stale" } : { status: "not-found", reason: "unknown" };
    const missing = await pageTo(hostId, sessionId, turnId);
    if (stale()) return { status: "stale" };
    // After a switch the way back stays offered even when the turn is not there.
    if (point && (!missing || point.sessionId !== sessionId)) dispatchReturn({ type: "jump", point, target });
    if (missing) {
      useJump.setState({ miss: { hostId, sessionId, turnId, reason: missing, nonce: Date.now() } });
      return { status: "not-found", reason: missing };
    }
    const found = await focusNow(sessionId, turnId);
    if (!found) useJump.setState({ miss: { hostId, sessionId, turnId, reason: "unknown", nonce: Date.now() } });
    return found ? { status: "focused" } : { status: "not-found", reason: "unknown" };
  } finally {
    settleUntil = Date.now() + 600;
    useJump.setState({ busy: false });
  }
}

/** 「回到」: back to the noted reading position (another agent: select it again first). */
export async function goBack(): Promise<void> {
  const state = useJump.getState().back;
  if (!state) return;
  dispatchReturn({ type: "used" });
  useJump.setState({ miss: null });
  const p = state.point;
  if (activeHost() !== p.hostId && viewHost() !== p.hostId) return;
  settleUntil = Number.POSITIVE_INFINITY;
  try {
    const app = useApp.getState();
    if (!isOpen(p.hostId, p.sessionId) || app.view.kind !== "conversation") {
      if (!isOpen(p.hostId, p.sessionId)) expected = p.sessionId;
      await openOn(p.hostId, p.sessionId);
      await until(() => viewReady(p.hostId, p.sessionId), 20_000);
    }
    if (p.atBottom || !p.turnId) {
      // A switch back already sticks to the bottom; the same agent re-attaches now.
      if (probe?.sessionId === p.sessionId) probe.toBottom();
      return;
    }
    await focusNow(p.sessionId, p.turnId, (el) => {
      const sc = probe?.scroller();
      if (!sc) return el.scrollIntoView({ block: "start" });
      sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top + p.offset;
    });
  } finally {
    settleUntil = Date.now() + 600;
  }
}

/** The owner sent a message in `sessionId` (the composer). */
export function noteSent(sessionId: string): void {
  dispatchReturn({ type: "sent", sessionId });
}

export function dismissMiss(): void {
  useJump.setState({ miss: null });
}

/** The conversation scrolled: distances (in screens) to the return point and the target. */
export function reportScroll(): void {
  const state = useJump.getState().back;
  if (!state || !probe || Date.now() < settleUntil) return;
  const el = probe.scroller();
  if (!el) return;
  const screen = Math.max(1, el.clientHeight);
  const base = el.getBoundingClientRect().top - el.scrollTop;
  const yOf = (turnId: string) => {
    const a = el.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`);
    return a ? a.getBoundingClientRect().top - base : null;
  };
  const view = el.scrollTop;
  const target = probe.sessionId === state.target.sessionId ? yOf(state.target.turnId) : null;
  let point: number | null = null;
  if (probe.sessionId === state.point.sessionId) {
    if (state.point.atBottom || !state.point.turnId) point = el.scrollHeight - el.clientHeight;
    else {
      const y = yOf(state.point.turnId);
      point = y === null ? null : y + state.point.offset;
    }
  }
  dispatchReturn({
    type: "scroll",
    sessionId: probe.sessionId,
    fromPoint: point === null ? null : Math.abs(view - point) / screen,
    fromTarget: target === null ? null : Math.abs(view - target) / screen,
  });
}
