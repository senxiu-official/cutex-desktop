// Agent messages v2 (留言 note / 唤醒 wake; docs/research/agent-messaging.md §4, capability
// `agent-messages-v2`): one record per agent-bus message id, built from the cutex events
// (`cutex/agentBus/messageSent|Queued|Delivered|Failed`) and the bootstrap snapshots
// (`cutexState.agentBusMessages` = messages to the agent, `agentBusSentMessages` = its sent ones).
// Feeds the sender's status dot (未读 / 已读入 / 失败) and the recipient's 待读留言 section.
// Pure and framework-free; lib/agentMessageStore.ts holds the state.

import type { MessageSettlement } from "@cutex-desktop/protocol";
import { MESSAGE_SETTLEMENT_EVENT, mergeMessageSettlement, readMessageSettlement } from "../../../shared/messageSettlement";

/** The capability that turns all of this on (`agentMessagesV2` in cutex MANAGEMENT_FEATURES). */
export const AGENT_MESSAGES_V2 = "agent-messages-v2";

export type DeliveryKind = "note" | "wake";

/**
 * `deliveryKind` as cutex reports it; older events only carry the wire `deliveryMode`:
 * passive → note, after_turn / soon → wake. Null when neither says.
 */
export function deliveryKindOf(kind: unknown, mode?: unknown): DeliveryKind | null {
  if (kind === "note" || kind === "wake") return kind;
  if (mode === "passive") return "note";
  if (mode === "after_turn" || mode === "after-turn" || mode === "soon") return "wake";
  return null;
}

/** pending: not read in yet · delivered: read into the recipient's context · failed (incl. quarantined). */
export type MessageState = "pending" | "delivered" | "failed";

export interface AgentMessageRecord {
  settlement?: MessageSettlement;
  /** A full snapshot or explicit stream projection has established presence/absence. */
  settlementKnown?: boolean;
  messageId: string;
  from: string | null;
  to: string | null;
  /**
   * `"service"` for a message a cutex service sent (alarm, Job Service …; then `from` is the service
   * id, e.g. "Cutex Alarm", not an agent session id), else null (lib/systemSenders).
   */
  sourceKind: string | null;
  /**
   * How cutex will deliver a pending wake to a busy agent, when it has decided already (bootstrap):
   * afterTurn = only after its running turn (system alarms: `afterTurnOnly`; or frozen `after_turn`),
   * nextStep = at its next step (frozen `soon`); null = not decided yet (the wake-busy-wait setting).
   */
  timing: "afterTurn" | "nextStep" | null;
  /**
   * A cross-host note (cutex `remote`, peers `agent_tell to="name@host"`): the sender is an agent on
   * another host, `from` / `senderName` its `name@host` label, never a local session or a service.
   */
  remote: RemoteSender | null;
  /** cutex-reported names (`sender.name` / `recipient.name`); null → the sidebar name. */
  senderName: string | null;
  recipientName: string | null;
  kind: DeliveryKind | null;
  /** A wake the loop guard delivered as a note (wakeDowngraded). */
  downgraded: boolean;
  body: string;
  state: MessageState;
  /** When it was sent / queued (unix s), null if unknown. */
  sentAt: number | null;
  /** When it was read in (unix s). */
  deliveredAt: number | null;
  /** The recipient turn that read it in. */
  turnId: string | null;
  error: string | null;
  /**
   * The failure was seen live (messageFailed) in this app session. Only those show in the
   * recipient's panel: the snapshot carries every old failed / quarantined message.
   */
  failedLive: boolean;
}

/** cutex `remote` of a cross-host note: this host's label for the sending host, its instance id and the sender's session id there. */
export interface RemoteSender {
  host: string;
  peerId: string | null;
  senderId: string | null;
}

export type MessageMap = Readonly<Record<string, AgentMessageRecord>>;

const RANK: Record<MessageState, number> = { pending: 0, failed: 1, delivered: 2 };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const time = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e12 ? v / 1000 : v;
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms / 1000 : null;
};
const party = (v: unknown): { id: string | null; name: string | null } => {
  const o = (v && typeof v === "object" ? v : {}) as { id?: unknown; name?: unknown };
  return { id: str(o.id), name: str(o.name) };
};

/** cutex `remote: {host, peerId, senderId}` (cross-host note), null when absent or without a host. */
export function remoteOf(v: unknown): RemoteSender | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { host?: unknown; peerId?: unknown; senderId?: unknown };
  const host = str(o.host);
  return host ? { host, peerId: str(o.peerId), senderId: str(o.senderId) } : null;
}

/**
 * Bus message ids of cross-host notes (cutex `agent_bus::peer_tell::MESSAGE_ID_PREFIX`; the bus
 * message id is the peer tell's external message id, which cutex requires to carry it).
 */
export const PEER_TELL_ID_PREFIX = "ptell-";

export const isPeerTellId = (messageId: string): boolean => messageId.startsWith(PEER_TELL_ID_PREFIX);

/**
 * A cross-host note from a cutex older than 0.1.5 (r245 / 0.1.4): a `ptell-` row without `remote`.
 * 0.1.5 (cutex 3225365) puts `remote` on every peer-tell snapshot entry and event, and emits
 * `messageDelivered` exactly for those (no `remote` = no delivered event, whatever the host's
 * version), so the missing field is the precise per-row signal; host capabilities
 * (`cross-host-tell-wake`, `client-remote-close`) only arrived in later commits of the same release.
 */
export function isLegacyPeerTell(m: Pick<AgentMessageRecord, "messageId" | "remote">): boolean {
  return isPeerTellId(m.messageId) && !m.remote;
}

/**
 * Sender of a cross-host note for display: `label` = `name@host`, `host` = the sending host. From
 * `remote` (0.1.5+), else for an older host's `ptell-` row parsed from its sender label (`from`,
 * cutex `sender.id` = `name@host`). Null for any other message.
 */
export function peerSenderOf(m: Pick<AgentMessageRecord, "messageId" | "remote" | "from" | "senderName">): { label: string; host: string } | null {
  if (m.remote) return { label: m.senderName ?? m.from ?? m.remote.host, host: m.remote.host };
  if (!isPeerTellId(m.messageId)) return null;
  for (const label of [m.senderName, m.from]) {
    const at = label?.lastIndexOf("@") ?? -1;
    if (label && at > 0 && at < label.length - 1) return { label, host: label.slice(at + 1) };
  }
  return null;
}

/**
 * Start (unix s) of the agent's latest finished turn (completed / interrupted / failed), null when
 * none. A note queued before it was read in at that turn's start (older cutex: lib/agentMessages
 * `pendingMessagesFor` `readSince`).
 */
export function lastFinishedTurnStart(turns: readonly { status: string; startedAt: number | null; completedAt: number | null }[] | null | undefined): number | null {
  let last: number | null = null;
  for (const t of turns ?? []) if (t.status !== "inProgress" && t.completedAt !== null && t.startedAt !== null && (last === null || t.startedAt > last)) last = t.startedAt;
  return last;
}

/** cutex error values are objects ({code, message, …}) or strings. */
export function errorText(error: unknown): string | null {
  if (error === null || error === undefined || error === "") return null;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const e = error as { message?: unknown; code?: unknown };
    return str(e.message) ?? str(e.code) ?? JSON.stringify(error);
  }
  return String(error);
}

/** Snapshot states still waiting to be read in (contract §6.5); delivered is read in; the rest are final failures. */
const WAITING = new Set(["pending", "inbox_accepted", "stale_held"]);

/** Snapshot `state` → ours (failed / quarantined / discarded … → failed). */
export function stateOf(raw: unknown): MessageState {
  if (raw === "delivered") return "delivered";
  return typeof raw === "string" && !WAITING.has(raw) ? "failed" : "pending";
}

/** cutex `senderKind` labels of service senders (agent bus `AgentMessageKind`). */
const SERVICE_KINDS = new Set(["alarm_service", "job_service", "task_service"]);

/**
 * Sender and timing of a received bootstrap entry that no agent sent (no `fromCutexSessionId`): the
 * cutex `sender` / `senderKind` / `afterTurnOnly` fields, else the frozen native envelope
 * (`externalInput.message`: `source {kind, id}`, `delivery`) older cutex already reports.
 */
function receivedOrigin(m: Record<string, unknown>): Pick<AgentMessageRecord, "sourceKind" | "timing"> & { serviceId: string | null } {
  const frozen = ((m.externalInput as { message?: unknown } | null | undefined)?.message ?? {}) as { source?: { kind?: unknown; id?: unknown }; delivery?: unknown };
  // A cross-host note is from an agent too (on another host), never a service.
  // Older cutex (before 0.1.5) reports a peer tell's frozen source as the `cutex-peers` service: its `ptell-` id says otherwise.
  const agentSent = !!str(m.fromCutexSessionId) || remoteOf(m.remote) !== null || isPeerTellId(str(m.messageId) ?? "");
  const sourceKind = agentSent ? null : (str(frozen.source?.kind) ?? (SERVICE_KINDS.has(m.senderKind as string) ? "service" : null));
  const timing = m.afterTurnOnly === true || frozen.delivery === "after_turn" ? "afterTurn" : frozen.delivery === "soon" ? "nextStep" : null;
  return { sourceKind: sourceKind === "service" ? "service" : null, timing, serviceId: agentSent ? null : str(frozen.source?.id) };
}

function blank(messageId: string): AgentMessageRecord {
  return { messageId, from: null, to: null, sourceKind: null, timing: null, remote: null, senderName: null, recipientName: null, kind: null, downgraded: false, body: "", state: "pending", sentAt: null, deliveredAt: null, turnId: null, error: null, failedLive: false };
}

/**
 * Merge `patch` into the record: identity fields fill in (a later event never blanks what an
 * earlier one said), and the state never goes back (a late queued event after delivered).
 */
function merge(map: MessageMap, messageId: string, patch: Partial<AgentMessageRecord>, authoritativeSettlement = false): MessageMap {
  const prev = map[messageId] ?? blank(messageId);
  const next: AgentMessageRecord = { ...prev };
  for (const [k, v] of Object.entries(patch) as [keyof AgentMessageRecord, unknown][]) {
    if (k === "state") continue;
    if (k === "settlement") {
      const incoming = v as MessageSettlement | undefined;
      next.settlement = authoritativeSettlement && prev.settlement?.state !== "closed"
        ? JSON.stringify(prev.settlement) === JSON.stringify(incoming) ? prev.settlement : incoming
        : mergeMessageSettlement(prev.settlement, incoming);
      if (authoritativeSettlement || v !== undefined) next.settlementKnown = true;
      continue;
    }
    if (v === null || v === undefined || v === "") continue;
    if (k === "remote" && prev.remote) continue; // fills in once (a fresh object would always differ)
    (next as unknown as Record<string, unknown>)[k] = v;
  }
  // Final states stick: a late queued / sent event never turns a read-in message back to 未读.
  if (patch.state && RANK[patch.state] > RANK[prev.state]) next.state = patch.state;
  // A positive delivery receipt outranks replayed observations; a durable closure is history.
  if (next.state === "delivered" && next.settlement?.state === "outcome_unknown") {
    next.settlement = undefined;
    next.settlementKnown = true;
  }
  const changed = !map[messageId] || (Object.keys(next) as (keyof AgentMessageRecord)[]).some((k) => next[k] !== prev[k]);
  return changed ? { ...map, [messageId]: next } : map;
}

export const AGENT_BUS_METHODS = new Set([MESSAGE_SETTLEMENT_EVENT, "cutex/agentBus/messageSent", "cutex/agentBus/messageQueued", "cutex/agentBus/messageDelivered", "cutex/agentBus/messageFailed"]);

/**
 * Apply one cutex agent-bus event (from any stream: the same event may arrive on the host feed and
 * on a session feed, and delivered / failed on both parties' streams — merging is idempotent).
 * `at`: when it was received (unix s), the fallback time. Returns `map` itself when nothing changed.
 */
export function applyMessageEvent(map: MessageMap, method: string, params: Record<string, unknown>, at: number): MessageMap {
  if (!AGENT_BUS_METHODS.has(method)) return map;
  const id = str(params.messageId);
  if (!id) return map;
  if (method === MESSAGE_SETTLEMENT_EVENT) {
    if (params.settlement === null) return map[id] ? merge(map, id, { settlement: undefined }, true) : map;
    const settlement = readMessageSettlement(params.settlement);
    return settlement ? merge(map, id, { settlement }, true) : map;
  }
  const sender = party(params.sender);
  const recipient = party(params.recipient);
  const base: Partial<AgentMessageRecord> = {
    settlement: readMessageSettlement(params.settlement),
    from: str(params.fromCutexSessionId) ?? sender.id,
    to: str(params.toCutexSessionId) ?? recipient.id,
    remote: remoteOf(params.remote),
    senderName: sender.name,
    recipientName: recipient.name,
    kind: deliveryKindOf(params.deliveryKind, params.deliveryMode),
    downgraded: params.wakeDowngraded === true || undefined,
    body: str(params.body) ?? undefined,
  };
  switch (method) {
    case "cutex/agentBus/messageSent":
    case "cutex/agentBus/messageQueued":
      return merge(map, id, { ...base, body: str(params.body) ?? str(params.content) ?? "", sentAt: time(params.queuedAt) ?? time(params.sentAt) ?? at, state: "pending" });
    case "cutex/agentBus/messageDelivered":
      return merge(map, id, { ...base, state: "delivered", deliveredAt: time(params.deliveredAt) ?? at, turnId: str(params.turnId) }, params.settlement == null);
    default:
      // A live failure (shows in the recipient's panel), unless it was read in already.
      if (map[id]?.state === "delivered") return map;
      return merge(map, id, { ...base, state: "failed", error: errorText(params.error), failedLive: true });
  }
}

/**
 * Bootstrap of agent `sessionId`: `received` = cutexState.agentBusMessages (its incoming messages,
 * all states), `sent` = cutexState.agentBusSentMessages (its latest sent ones, compact). Absent on
 * older cutex. Snapshot failures are not "live" (see `failedLive`).
 */
export function seedMessages(map: MessageMap, sessionId: string, received: unknown[] | null | undefined, sent: unknown[] | null | undefined): MessageMap {
  let next = map;
  for (const raw of received ?? []) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const id = str(m.messageId);
    if (!id) continue;
    const sender = party(m.sender);
    const origin = receivedOrigin(m);
    next = merge(next, id, {
      settlement: readMessageSettlement(m.settlement),
      from: str(m.fromCutexSessionId) ?? sender.id ?? origin.serviceId,
      to: str(m.toCutexSessionId) ?? sessionId,
      sourceKind: origin.sourceKind,
      timing: origin.timing,
      remote: remoteOf(m.remote),
      senderName: sender.name,
      recipientName: party(m.recipient).name,
      kind: deliveryKindOf(m.deliveryKind, m.deliveryMode),
      downgraded: m.wakeDowngraded === true || undefined,
      body: str(m.body) ?? str(m.content) ?? "",
      sentAt: time(m.queuedAt) ?? time(m.sentAt),
      deliveredAt: time(m.deliveredAt),
      turnId: str(m.contextTurnId),
      error: errorText(m.error),
      state: stateOf(m.state),
    }, true);
  }
  for (const raw of sent ?? []) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const id = str(m.messageId);
    if (!id) continue;
    const recipient = party(m.recipient);
    next = merge(next, id, {
      settlement: readMessageSettlement(m.settlement),
      from: sessionId,
      to: str(m.toCutexSessionId) ?? recipient.id,
      recipientName: recipient.name,
      kind: deliveryKindOf(m.deliveryKind, m.deliveryMode),
      downgraded: m.wakeDowngraded === true || undefined,
      body: str(m.body) ?? str(m.content) ?? "",
      sentAt: time(m.sentAt),
      deliveredAt: time(m.deliveredAt),
      turnId: str(m.contextTurnId),
      error: errorText(m.error),
      state: stateOf(m.state),
    }, true);
  }
  return next;
}

/**
 * The 待读留言 rows of agent `sessionId`: messages to it not read in yet (plus failures seen live),
 * oldest first. `readIn`: message ids already in its timeline (the native external_event item id
 * is the bus message id) — they are read in even if the delivered event has not arrived. `dismissed`:
 * failed rows the owner closed. `readSince`: start of the agent's latest finished turn
 * (`lastFinishedTurnStart`); a cross-host note from a cutex older than 0.1.5 (`isLegacyPeerTell`,
 * which never reports it delivered) queued before that turn started was read in at that turn's start.
 * `claudeRecipient`: the same for a note to a Claude agent queued CLAUDE_NOTE_MARGIN_S before such a turn
 * — the Claude adapter reads every waiting note into each turn it starts, but confirms them only when the
 * turn ends cleanly; after an interrupted or failed turn cutex keeps them 未读 (inbox_accepted) for good,
 * and 唤醒 reads nothing (owner 2026-10-23).
 */
export function pendingMessagesFor(map: MessageMap, sessionId: string, readIn: (messageId: string) => boolean = () => false, dismissed: ReadonlySet<string> = new Set(), readSince: number | null = null, claudeRecipient = false): AgentMessageRecord[] {
  const readByTurn = (m: AgentMessageRecord) =>
    readSince !== null && m.sentAt !== null && m.state === "pending" && ((isLegacyPeerTell(m) && readSince > m.sentAt) || (claudeRecipient && m.kind === "note" && readSince - m.sentAt >= CLAUDE_NOTE_MARGIN_S));
  return Object.values(map)
    .filter((m) => m.settlement?.state !== "closed" && m.to === sessionId && m.from !== sessionId && (m.settlement?.state === "outcome_unknown" || m.state === "pending" || (m.state === "failed" && m.failedLive && !dismissed.has(m.messageId))) && (m.settlement?.state === "outcome_unknown" || (!readIn(m.messageId) && !readByTurn(m))))
    .sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0) || a.messageId.localeCompare(b.messageId));
}

/** A note reaches the Claude adapter's inbox a moment after cutex queues it: a turn this much later took it. */
export const CLAUDE_NOTE_MARGIN_S = 5;

/** Pending notes (not wakes) of the agent — what the owner's 唤醒 would read in. */
export function wakeableNotes(rows: AgentMessageRecord[]): number {
  return rows.filter((m) => m.state === "pending" && m.kind === "note").length;
}

// ---------- received envelope (the model text's structured header) ----------

/** What the structured `Sender:` header (and the v2 view) says about a received agent message. */
export interface AgentEnvelope {
  /** `Sender: <name> (<id>)` as written. */
  sender: string | null;
  narrower: boolean;
  replyOnly: boolean;
  kind: DeliveryKind | null;
  bodyTruncated: boolean;
  downgraded: boolean;
}

const HEADER = /^Message Type: ([^\n]*)\n((?:[A-Za-z][A-Za-z ]*:[^\n]*\n)*?)Payload:\n/;

/**
 * Split cute-codex external-input text into header fields and payload: `Message Type: X\n` then
 * `Key: value` lines then `Payload:\n<body>`. Null when the text has no such header.
 */
export function splitEnvelopeText(text: string): { type: string; fields: Record<string, string>; payload: string } | null {
  const m = HEADER.exec(text);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[2]!.split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return { type: m[1]!.trim(), fields, payload: text.slice(m[0].length) };
}

/**
 * The display text and envelope of a received agent message. `data`: the view data
 * (cutex.agent-message.v1; v2 adds body / deliveryKind / narrowerCapabilities / replyOnly).
 * Old messages (no Sender header, no view body) come back as today: the payload after
 * `Message Type: MESSAGE\nPayload:\n`, no envelope.
 */
export function agentMessageText(text: string, data: Record<string, unknown>): { text: string; envelope: AgentEnvelope | null } {
  const split = splitEnvelopeText(text);
  if (split && split.type !== "MESSAGE") return { text, envelope: null };
  const body = typeof data.body === "string" ? data.body : null;
  const fields = split?.fields ?? {};
  const v2 = body !== null || "Sender" in fields || typeof data.deliveryKind === "string";
  const shown = body ?? split?.payload ?? text;
  if (!v2) return { text: shown, envelope: null };
  return {
    text: shown,
    envelope: {
      sender: fields.Sender ?? null,
      narrower: data.narrowerCapabilities === true || "Sender capabilities" in fields,
      replyOnly: data.replyOnly === true || "Reply" in fields,
      kind: deliveryKindOf(data.deliveryKind, data.deliveryMode),
      bodyTruncated: data.bodyTruncated === true,
      downgraded: data.wakeDowngraded === true,
    },
  };
}

/**
 * History fallback (contract §6.6): messages frozen before agent-messages-v2 still start with cutex's
 * default prefix. Only the exact default `[message from <senderName>] ` is removed (the template was
 * configurable, so nothing fuzzy); applied only with the capability, older UIs show the text as is.
 */
export function stripLegacyPrefix(text: string, senderName: string): string {
  const prefix = `[message from ${senderName}] `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}
