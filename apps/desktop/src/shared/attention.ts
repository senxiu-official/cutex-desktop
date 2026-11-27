// Cross-device read state (design 061, cutex `attention-state-v1`): the owner person's unread replies and 需要你
// items as the host projects them. `GET /v2/attention` is the snapshot; `POST /v2/attention/read` advances the read
// cursor to the exact reply that was on screen; `POST /v2/attention/dismiss` hides 需要你 items on every device of the
// person; `cutex/summary/attentionChanged` on the summary stream says when to read the snapshot again. Older hosts
// keep the desktop's local marks (renderer lib/turnUnread, lib/needsYouDismiss).

/** The capability name in `GET /v2/capabilities` features. */
export const ATTENTION_FEATURE = "attention-state-v1";

/** One 需要你 item of an agent; `itemKey` names this exact occurrence (a new occurrence has a new key). */
export interface AttentionNeed {
  /** `approval` / `question` (native requests), `ownerApproval`, a delegation kind (`question` / `acceptance` / `review` / `check` …), `ownerMessage` / `ownerReply`, `runtimeError`. */
  kind: string;
  id: string | null;
  title: string;
  at: string | null;
  itemKey: string;
}

/** The newest finished turn of an agent (interrupted turns never are one). `through`: opaque read token of exactly that turn. */
export interface AttentionLatest {
  turnId: string;
  status: "completed" | "failed";
  endedAt: string;
  through: string;
}

export interface AttentionAgent {
  agentId: string;
  /** Finished turns after the person's read cursor. */
  unreadTurns: number;
  latest: AttentionLatest | null;
  /** The turn running now (null: none, or an older host that does not say). */
  running: { turnId: string; observedAt: string | null } | null;
  /** When the agent's last turn started (also after it ended; null: unknown / older host). */
  lastTurnStartedAt: string | null;
  /** 需要你 items the person has not dismissed (a runtime error is one, kind `runtimeError`). */
  needs: AttentionNeed[];
}

export interface AttentionSnapshot {
  /** The daemon instance; another one = a different host state (the desktop's cache of it goes). */
  instanceId: string;
  /** Which owner person this state belongs to (opaque). */
  personKey: string;
  cursor: { streamId: string; after: string };
  agents: AttentionAgent[];
  /** Needs of agents outside the summary's agent list. */
  unlistedNeeds: { agentId: string; needs: AttentionNeed[] }[];
  needsYouCount: number;
}

/**
 * Refusals the desktop handles: `attention_stale` (a read token of an older state: read the snapshot again and wait
 * for a new visible reply), `attention_dismissal_limit`, `attention_unavailable` (the host projection is still
 * starting), `attention_person_binding_required` / `attention_owner_identity_unconfirmed` (multi-person hosts), and
 * `owner_required`. Anything else (`http_*`, unreachable) is `unavailable` too.
 */
export type AttentionResult<T> = { ok: true; value: T } | { ok: false; code: string };

/** Whether main follows the host's attentionChanged events (`live`); while not, the renderer re-reads now and then. */
export interface AttentionFeedState { live: boolean }

/** `cutex/summary/attentionChanged` of one host (main forwards only this summary event). */
export type AttentionChange = { agentIds: string[] } | { resync: true };

export const ATTENTION_EVENT = "cutex/summary/attentionChanged";

const THROUGH = /^[0-9a-f]{32}\/[0-9a-f]{32}$/;
const ITEM_KEY = /^[0-9a-f]{64}$/;
const AGENT_ID = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
/** The host accepts at most this many reads / dismissals per call. */
export const ATTENTION_BATCH = 100;

export const isThrough = (v: unknown): v is string => typeof v === "string" && THROUGH.test(v);
export const isItemKey = (v: unknown): v is string => typeof v === "string" && ITEM_KEY.test(v);
export const isAttentionAgentId = AGENT_ID;

function needOf(v: unknown): AttentionNeed | null {
  const n = v as Partial<AttentionNeed> | null;
  if (!n || typeof n !== "object" || typeof n.kind !== "string" || !isItemKey(n.itemKey)) return null;
  return { kind: n.kind, id: typeof n.id === "string" ? n.id : null, title: typeof n.title === "string" ? n.title : "", at: typeof n.at === "string" ? n.at : null, itemKey: n.itemKey };
}

const needsOf = (v: unknown): AttentionNeed[] => (Array.isArray(v) ? v.map(needOf).filter((n): n is AttentionNeed => !!n) : []);

/** A checked snapshot (unknown fields dropped, malformed entries skipped); null when it is not one. */
export function readAttentionSnapshot(v: unknown): AttentionSnapshot | null {
  const s = v as Record<string, unknown> | null;
  if (!s || typeof s !== "object" || typeof s.instanceId !== "string" || typeof s.personKey !== "string") return null;
  const cursor = s.cursor as { streamId?: unknown; after?: unknown } | null;
  if (!cursor || typeof cursor.streamId !== "string" || typeof cursor.after !== "string" || !/^[0-9]+$/.test(cursor.after)) return null;
  const agents: AttentionAgent[] = [];
  for (const a of Array.isArray(s.agents) ? s.agents : []) {
    const row = a as Record<string, unknown> | null;
    if (!row || !AGENT_ID(row.agentId)) continue;
    const l = row.latest as Partial<AttentionLatest> | null;
    const latest = l && typeof l.turnId === "string" && (l.status === "completed" || l.status === "failed") && typeof l.endedAt === "string" && isThrough(l.through)
      ? { turnId: l.turnId, status: l.status, endedAt: l.endedAt, through: l.through }
      : null;
    const unread = typeof row.unreadTurns === "number" && Number.isSafeInteger(row.unreadTurns) && row.unreadTurns > 0 ? row.unreadTurns : 0;
    const r = row.running as { turnId?: unknown; observedAt?: unknown } | null | undefined;
    const running = r && typeof r === "object" && typeof r.turnId === "string" && r.turnId ? { turnId: r.turnId, observedAt: typeof r.observedAt === "string" ? r.observedAt : null } : null;
    const lastTurnStartedAt = typeof row.lastTurnStartedAt === "string" ? row.lastTurnStartedAt : null;
    agents.push({ agentId: row.agentId, unreadTurns: unread, latest, running, lastTurnStartedAt, needs: needsOf(row.needs) });
  }
  const unlistedNeeds: AttentionSnapshot["unlistedNeeds"] = [];
  for (const g of Array.isArray(s.unlistedNeeds) ? s.unlistedNeeds : []) {
    const row = g as Record<string, unknown> | null;
    if (!row || !AGENT_ID(row.agentId)) continue;
    const needs = needsOf(row.needs);
    if (needs.length) unlistedNeeds.push({ agentId: row.agentId, needs });
  }
  const count = typeof s.needsYouCount === "number" && Number.isSafeInteger(s.needsYouCount) && s.needsYouCount >= 0 ? s.needsYouCount : 0;
  return { instanceId: s.instanceId, personKey: s.personKey, cursor: { streamId: cursor.streamId, after: cursor.after }, agents, unlistedNeeds, needsYouCount: count };
}

/** A checked `attentionChanged` payload; null when it is not one. */
export function readAttentionChange(v: unknown): AttentionChange | null {
  const d = v as { agentIds?: unknown; resync?: unknown } | null;
  if (!d || typeof d !== "object") return null;
  if (d.resync === true) return { resync: true };
  if (Array.isArray(d.agentIds)) {
    const ids = d.agentIds.filter(AGENT_ID);
    return ids.length ? { agentIds: ids } : null;
  }
  return null;
}
