import type { EventEnvelope } from "@cutex-desktop/protocol";
import type { LiveDeltaFrame } from "@cutex-desktop/cutex-client";
import type { TimelineEntry, TimelineState } from "./timeline";

interface Channel { end: number; revision: number }
interface LiveItem {
  observed: boolean;
  startSequence: number;
  threadId: string;
  turnId: string | null;
  epoch: string | null;
  blocked: boolean;
  channels: Map<string, Channel>;
}
export interface LiveTimelineState {
  /** Desktop routing identity for child-view isolation (not the daemon hostId). */
  routeHost?: string;
  generation: number;
  streamId: string;
  sequence: number;
  hostId: string;
  sessionId: string;
  items: Map<string, LiveItem>;
}
const MAX_KEYS = 64;
const encoder = new TextEncoder();

function incomplete(state: TimelineState, id: string): boolean {
  const entry = state.entries.get(id);
  if (!entry || (entry.kind !== "agent" && entry.kind !== "reasoning") || entry.liveIncomplete) return false;
  state.entries.set(id, { ...entry, liveIncomplete: true });
  return true;
}

/** A reconnect/gap cannot recover incremental bytes. Keep the verified prefix until full repair. */
export function invalidateLiveDeltas(state: TimelineState, throughSequence = Infinity): boolean {
  let changed = false;
  for (const [id, item] of state.liveDeltas?.items ?? []) {
    if (item.startSequence > throughSequence || !item.observed) continue;
    item.blocked = true;
    changed = incomplete(state, id) || changed;
  }
  return changed;
}

/** Durable starts establish identity; completed/terminal records establish bounded fences. */
export function observeLiveDurable(state: TimelineState, envelope: EventEnvelope, enabled: boolean): void {
  if (!enabled && !state.liveDeltas) return;
  const generation = envelope.correlation?.runtimeGeneration;
  if (generation == null || !Number.isSafeInteger(generation)) return;
  let live = state.liveDeltas;
  if (live && generation < live.generation) return;
  if (!live || live.generation !== generation || live.streamId !== envelope.streamId) {
    invalidateLiveDeltas(state);
    live = state.liveDeltas = { generation, streamId: envelope.streamId, sequence: 0, hostId: envelope.hostId, sessionId: envelope.cutexSessionId, items: new Map() };
  }
  live.sequence = Math.max(live.sequence, envelope.sequence);
  const message = envelope.native?.message;
  const p = (message?.params ?? {}) as Record<string, unknown>;
  if (envelope.cutex?.method === "cutex/stream/reset") {
    invalidateLiveDeltas(state);
    live.items.clear();
  } else if (message?.method === "item/started") {
    const item = p.item as { id?: unknown; type?: unknown } | undefined;
    if (!item || typeof item.id !== "string" || !["agentMessage", "reasoning"].includes(String(item.type))) return;
    const threadId = typeof p.threadId === "string" ? p.threadId : state.threadId;
    if (threadId && (live.items.has(item.id) || live.items.size < MAX_KEYS)) live.items.set(item.id, {
      observed: false, startSequence: envelope.sequence, threadId, turnId: typeof p.turnId === "string" ? p.turnId : null, epoch: null, blocked: false, channels: new Map(),
    });
  } else if (message?.method === "item/completed") {
    const id = (p.item as { id?: unknown } | undefined)?.id;
    if (typeof id === "string") live.items.delete(id);
  } else if (message?.method === "turn/completed") {
    const id = (p.turn as { id?: unknown } | undefined)?.id;
    for (const [itemId, item] of live.items) if (item.turnId === id) live.items.delete(itemId);
  } else if (message?.method === "turn/started") {
    const id = (p.turn as { id?: unknown } | undefined)?.id;
    for (const [itemId, item] of live.items) if (item.turnId !== id) live.items.delete(itemId);
  }
}

/** Apply only verified native text. This function has no durable cursor or sequence writes. */
export function applyLiveDelta(state: TimelineState, frame: LiveDeltaFrame, generation: number): boolean {
  const live = state.liveDeltas;
  if (!live || generation !== live.generation || frame.runtimeGeneration !== generation || frame.hostId !== live.hostId ||
      frame.cutexSessionId !== live.sessionId || (frame.anchor && frame.anchor.streamId !== live.streamId)) return false;
  if (frame.kind === "gap" && frame.gapScope === "subscription") {
    for (const item of live.items.values()) item.observed = true;
    return invalidateLiveDeltas(state);
  }
  const item = live.items.get(frame.itemId);
  const entry = state.entries.get(frame.itemId);
  // A missing turn is never borrowed from an unrelated active turn.
  if (!item || (frame.kind !== "gap" && (!frame.anchor || frame.anchor.sequence < item.startSequence)) || !entry || item.blocked || frame.turnId === null || item.turnId !== frame.turnId || item.threadId !== frame.threadId ||
      state.threadId !== frame.threadId || entry.turnId !== frame.turnId ||
      (entry.kind !== "agent" && entry.kind !== "reasoning") || !entry.streaming ||
      state.turns.find(turn => turn.id === frame.turnId)?.status !== "inProgress") return false;
  item.observed = true;
  const fail = () => { item.blocked = true; return incomplete(state, frame.itemId); };
  if (frame.kind === "gap" || (item.epoch !== null && item.epoch !== frame.producerEpoch)) return fail();
  item.epoch ??= frame.producerEpoch;
  const params = frame.params ?? {};
  const field = frame.method === "item/agentMessage/delta" ? "text" : frame.method === "item/reasoning/textDelta" ? "content" : "summary";
  if ((field === "text") !== (entry.kind === "agent")) return fail();
  const index = field === "text" ? 0 : (params[field === "summary" ? "summaryIndex" : "contentIndex"] ?? 0);
  if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= MAX_KEYS) return fail();
  const key = `${field}:${index}`;
  const previous = item.channels.get(key);
  if (previous && frame.endOffset <= previous.end) return false;
  const delta = params.delta;
  if (typeof delta !== "string") return fail();
  const bytes = encoder.encode(delta);
  if (new TextDecoder().decode(bytes) !== delta || bytes.byteLength !== frame.endOffset - frame.startOffset ||
      frame.startOffset !== (previous?.end ?? 0) || frame.revision <= (previous?.revision ?? 0)) return fail();
  if (!previous && [...live.items.values()].reduce((sum, item) => sum + item.channels.size, 0) >= MAX_KEYS) return fail();
  let next: TimelineEntry;
  if (entry.kind === "agent") next = { ...entry, text: entry.text + delta };
  else {
    const values = [...entry[field as "summary" | "content"]];
    values[Number(index)] = (values[Number(index)] ?? "") + delta;
    next = { ...entry, [field]: values };
  }
  const turn = state.turns.find(turn => turn.id === frame.turnId);
  if (turn) turn.retry = null;
  item.channels.set(key, { end: frame.endOffset, revision: frame.revision });
  state.entries.set(entry.id, next);
  return true;
}

export function cloneLiveDeltas(live: LiveTimelineState | undefined): LiveTimelineState | undefined {
  return live && { ...live, items: new Map([...live.items].map(([id, item]) => [id, { ...item, channels: new Map(item.channels) }])) };
}


/** Host wire support is distinct from a runtime's audited terminal-text guarantee. */
export function fullTextItemTerminalOf(schema: unknown): boolean {
  const s = schema as { capabilities?: { features?: { fullTextItemTerminal?: unknown } } } | null | undefined;
  return s?.capabilities?.features?.fullTextItemTerminal === true;
}
