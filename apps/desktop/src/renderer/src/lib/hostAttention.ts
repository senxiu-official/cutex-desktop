// Cross-device read state (design 061, cutex `attention-state-v1`, shared/attention.ts): each capable host's
// snapshot of the owner person's unread replies and 需要你 items. On such a host this replaces the device-local
// records (lib/turnUnread marks, lib/needsYouDismiss dismissals): unread badges and the 需要你 list read it, a reply
// counts as read only once it was on screen (lib/readOnSight), and a × hides an item on every device of the person.
// Older hosts — and a capable host that refuses (person not bound, owner key unconfirmed, projection starting) —
// keep the local records. Pure state + calls; no React components (Fast Refresh).
import { useSyncExternalStore } from "react";
import { ATTENTION_BATCH, type AttentionAgent, type AttentionNeed, type AttentionResult, type AttentionSnapshot } from "../../../shared/attention";
import type { TurnMark } from "./turnUnread";

/** A capable host's state as the desktop uses it. */
export interface HostAttention {
  instanceId: string;
  personKey: string;
  /** Listed agents and the agents of unlisted needs (those have no turns). */
  agents: ReadonlyMap<string, AttentionAgent>;
  needsYouCount: number;
}

/** Why a capable host's state is not in use (the local records are): a cutex refusal code, or `unavailable`. */
export type AttentionOff = { code: string };

interface Entry {
  /** The host connection this entry follows (a new epoch reads again). */
  epoch: string;
  state: HostAttention | null;
  off: AttentionOff | null;
  inFlight: boolean;
  again: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** The slow re-read while in use and main's attentionChanged feed is not live (refused, host away, reconnecting). */
  poll: ReturnType<typeof setTimeout> | null;
  /** Main follows this host's attentionChanged events (main/attentionFeed status). */
  eventsLive: boolean;
  retries: number;
  /** Read tokens sent and not refused (one POST per visible reply). */
  sent: Set<string>;
}

// The bridge is loaded lazily: node-side tests import this module (through lib/turnUnread) without a window.
const hostApi = async (hostId: string) => (await import("../bridge")).apiFor(hostId);

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const readyListeners = new Set<(hostId: string) => void>();
let version = 0;
const COALESCE_MS = 120;
const POLL_MS = 60_000;
const RETRY_MS = [2_000, 5_000, 15_000, 60_000];
/** Refusals that last until the person / host changes (the next feature or connection change reads again). */
const LASTING = new Set(["attention_person_binding_required", "attention_owner_identity_unconfirmed", "owner_required"]);

function drop(entry: Entry): void {
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.poll) clearTimeout(entry.poll);
  entry.timer = entry.poll = null;
}

function changed(): void {
  version++;
  for (const l of [...listeners]) l();
}

function toState(snapshot: AttentionSnapshot): HostAttention {
  const agents = new Map<string, AttentionAgent>();
  for (const a of snapshot.agents) agents.set(a.agentId, a);
  for (const g of snapshot.unlistedNeeds) if (!agents.has(g.agentId)) agents.set(g.agentId, { agentId: g.agentId, unreadTurns: 0, latest: null, running: null, lastTurnStartedAt: null, needs: g.needs });
  return { instanceId: snapshot.instanceId, personKey: snapshot.personKey, agents, needsYouCount: snapshot.needsYouCount };
}

/** The host's state when the overlay is in use for it; null = the local records apply. */
export function attentionOn(hostId: string): HostAttention | null {
  return entries.get(hostId)?.state ?? null;
}

/** Why a capable host's overlay is off (null: in use, or the host is not capable). */
export function attentionOffOn(hostId: string): AttentionOff | null {
  return entries.get(hostId)?.off ?? null;
}

export function subscribeHostAttention(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Bumps on any change of any host's state. */
export function hostAttentionVersion(): number {
  return version;
}

export function useHostAttentionVersion(): number {
  return useSyncExternalStore(subscribeHostAttention, hostAttentionVersion, hostAttentionVersion);
}

export function useHostAttention(hostId: string): HostAttention | null {
  const read = () => attentionOn(hostId);
  return useSyncExternalStore(subscribeHostAttention, read, read);
}

/**
 * Called each time a host's overlay comes into use (first snapshot, or again after a refusal): the device-local
 * records of that host go (the one-time clean start: the host's baseline already holds what was read before).
 */
export function onAttentionReady(listener: (hostId: string) => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

/**
 * Follow `hostId`: `capable` = its features include `attention-state-v1`; `epoch` = its connection. Not capable:
 * the entry goes (local records). A new connection reads the snapshot again.
 */
export function syncHostAttention(hostId: string, capable: boolean, epoch: string): void {
  const entry = entries.get(hostId);
  if (!capable) {
    if (!entry) return;
    drop(entry);
    entries.delete(hostId);
    changed();
    return;
  }
  if (entry && entry.epoch === epoch) return;
  if (entry) drop(entry);
  // A new connection keeps the state shown until its own snapshot replaces it (no flicker back to local marks).
  entries.set(hostId, { epoch, state: entry?.state ?? null, off: null, inFlight: false, again: false, timer: null, poll: null, eventsLive: false, retries: 0, sent: entry?.sent ?? new Set() });
  refreshHostAttention(hostId, 0);
}

/** The slow re-read, only while the host's events do not come (each read schedules the next one). */
function schedulePoll(hostId: string, entry: Entry): void {
  if (entry.poll) clearTimeout(entry.poll);
  entry.poll = null;
  if (entry.eventsLive || !entry.state) return;
  entry.poll = setTimeout(() => {
    entry.poll = null;
    if (entries.get(hostId) === entry && !entry.eventsLive) refreshHostAttention(hostId, 0);
  }, POLL_MS);
}

/** main/attentionFeed's status for a host: live events make the slow re-read unnecessary; losing them starts it. */
export function attentionFeedOn(hostId: string, live: boolean): void {
  const entry = entries.get(hostId);
  if (!entry || entry.eventsLive === live) return;
  entry.eventsLive = live;
  schedulePoll(hostId, entry);
}

/** Forget hosts no longer configured (their state, timers). */
export function pruneHostAttention(alive: ReadonlySet<string>): void {
  let gone = false;
  for (const [id, entry] of entries) {
    if (alive.has(id)) continue;
    drop(entry);
    entries.delete(id);
    gone = true;
  }
  if (gone) changed();
}

/** Read the host's snapshot again (coalesced: changes arriving close together read once). */
export function refreshHostAttention(hostId: string, delay = COALESCE_MS): void {
  const entry = entries.get(hostId);
  if (!entry) return;
  if (entry.inFlight) {
    entry.again = true;
    return;
  }
  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void load(hostId, entry);
  }, delay);
}

async function load(hostId: string, entry: Entry): Promise<void> {
  if (entries.get(hostId) !== entry) return;
  entry.inFlight = true;
  let result: AttentionResult<AttentionSnapshot>;
  try {
    result = await (await hostApi(hostId)).attention();
  } catch {
    result = { ok: false, code: "unavailable" };
  }
  entry.inFlight = false;
  if (entries.get(hostId) !== entry) return;
  if (result.ok) {
    const next = toState(result.value);
    const before = entry.state;
    // Another daemon instance or another person: nothing of the old state carries over.
    if (before && (before.instanceId !== next.instanceId || before.personKey !== next.personKey)) entry.sent = new Set();
    const wasOff = !before;
    entry.state = next;
    entry.off = null;
    entry.retries = 0;
    schedulePoll(hostId, entry);
    if (wasOff) for (const l of [...readyListeners]) l(hostId);
    changed();
  } else {
    entry.state = null;
    entry.off = { code: result.code };
    changed();
    if (!LASTING.has(result.code)) {
      const wait = RETRY_MS[Math.min(entry.retries++, RETRY_MS.length - 1)]!;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void load(hostId, entry);
      }, wait);
      return;
    }
  }
  if (entry.again) {
    entry.again = false;
    refreshHostAttention(hostId);
  }
}

/** `cutex/summary/attentionChanged` of a host (any payload: the snapshot is read again). */
export function attentionChangedOn(hostId: string): void {
  refreshHostAttention(hostId);
}

function patch(hostId: string, agentId: string, change: (agent: AttentionAgent) => AttentionAgent): void {
  const state = attentionOn(hostId);
  const agent = state?.agents.get(agentId);
  if (!state || !agent) return;
  const agents = new Map(state.agents);
  const next = change(agent);
  agents.set(agentId, next);
  const had = agent.needs.length > 0, has = next.needs.length > 0;
  entries.get(hostId)!.state = { ...state, agents, needsYouCount: Math.max(0, state.needsYouCount - (had && !has ? 1 : 0)) };
  changed();
}

/**
 * The person saw `turnId`, the newest reply of `agentId` (rendered at the visible end of a conversation, or an
 * explicit 标为已读 of what the snapshot holds). Sent only when it is that agent's `latest` turn and still unread; a
 * stale token reads the snapshot again (the reply must be seen again in it). Returns whether a read was sent.
 */
export function readReply(hostId: string, agentId: string, turnId?: string): boolean {
  return readReplies(hostId, [agentId], turnId) > 0;
}

/**
 * Explicit 标为已读 of several agents (a project's): each one's newest unread reply as the snapshot holds it, sent in
 * batches of up to 100 (`turnId`: only when that is the latest turn; for one agent). Returns how many were sent.
 */
export function readReplies(hostId: string, agentIds: readonly string[], turnId?: string): number {
  const entry = entries.get(hostId);
  if (!entry?.state) return 0;
  const reads: { agentId: string; through: string }[] = [];
  for (const agentId of new Set(agentIds)) {
    const agent = entry.state.agents.get(agentId);
    const latest = agent?.latest;
    if (!agent || !latest || agent.unreadTurns === 0) continue;
    if (turnId !== undefined && latest.turnId !== turnId) continue;
    if (entry.sent.has(latest.through)) continue;
    reads.push({ agentId, through: latest.through });
  }
  if (!reads.length) return 0;
  for (const r of reads) {
    entry.sent.add(r.through);
    // Shown read at once; the host's attentionChanged confirms it (or the snapshot read after a refusal restores it).
    patch(hostId, r.agentId, (a) => ({ ...a, unreadTurns: 0 }));
  }
  void (async () => {
    let failed = false;
    for (let i = 0; i < reads.length; i += ATTENTION_BATCH) {
      const batch = reads.slice(i, i + ATTENTION_BATCH);
      const r = await hostApi(hostId).then((api) => api.attentionRead(batch)).catch(() => ({ ok: false as const, code: "unavailable" }));
      if (r.ok) continue;
      failed = true;
      for (const b of batch) entry.sent.delete(b.through);
    }
    // A stale token (or a refusal): the snapshot is read again; the reply has to be seen again in it.
    if (failed) refreshHostAttention(hostId, 0);
  })();
  return reads.length;
}

/** Hide 需要你 items of an agent on every device of the person: exactly these current keys (others stay). */
export function dismissNeeds(hostId: string, agentId: string, itemKeys: readonly string[]): void {
  const keys = new Set(itemKeys);
  if (!keys.size || !attentionOn(hostId)?.agents.get(agentId)) return;
  patch(hostId, agentId, (a) => ({ ...a, needs: a.needs.filter((n) => !keys.has(n.itemKey)) }));
  const items = [...keys].map((itemKey) => ({ agentId, itemKey }));
  void (async () => {
    let failed = false;
    for (let i = 0; i < items.length; i += ATTENTION_BATCH) {
      const r = await hostApi(hostId).then((api) => api.attentionDismiss(items.slice(i, i + ATTENTION_BATCH))).catch(() => ({ ok: false as const, code: "unavailable" }));
      if (!r.ok) failed = true;
    }
    // A refusal (e.g. attention_dismissal_limit) shows the items again from the host's state.
    if (failed) refreshHostAttention(hostId, 0);
  })();
}

// ---------- what the rest of the app reads ----------

/** The unread mark of an agent from the host's state (lib/turnUnread's shape); undefined = nothing unread. */
export function markOf(agent: AttentionAgent | undefined): TurnMark | undefined {
  const latest = agent?.latest;
  if (!agent || !latest || agent.unreadTurns === 0) return undefined;
  const at = Date.parse(latest.endedAt);
  return { at: Number.isFinite(at) ? at : 0, failed: latest.status === "failed" && !startedSince(agent, at), turnId: latest.turnId, count: agent.unreadTurns };
}

/**
 * A later turn started after the latest (failed) reply (owner 2026-11-05: a failure only asks for a look until the agent
 * moved on; it stays a plain unread reply): another turn is running, or the last turn start is after the failure ended.
 * Older hosts without the fields: never.
 */
function startedSince(agent: AttentionAgent, endedAt: number): boolean {
  if (agent.running && agent.running.turnId !== agent.latest?.turnId) return true;
  const started = agent.lastTurnStartedAt ? Date.parse(agent.lastTurnStartedAt) : NaN;
  return Number.isFinite(started) && Number.isFinite(endedAt) && started > endedAt;
}

/** All unread marks of a host's state by agent id. */
export function marksOf(state: HostAttention): Record<string, TurnMark> {
  const out: Record<string, TurnMark> = {};
  for (const [id, agent] of state.agents) {
    const mark = markOf(agent);
    if (mark) out[id] = mark;
  }
  return out;
}

/** The agent's current 需要你 items, its runtime error apart (that one is the 出错 chip's). */
export function needsOf(state: HostAttention | null, agentId: string): { needs: AttentionNeed[]; runtimeError: AttentionNeed | null } {
  const all = state?.agents.get(agentId)?.needs ?? [];
  return { needs: all.filter((n) => n.kind !== "runtimeError"), runtimeError: all.find((n) => n.kind === "runtimeError") ?? null };
}

/** Test seam: forget every host. */
export function resetHostAttention(): void {
  for (const e of entries.values()) drop(e);
  entries.clear();
  changed();
}
