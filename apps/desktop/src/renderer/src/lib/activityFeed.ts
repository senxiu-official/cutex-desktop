// `services.activity` (docs/desktop-modules.md §29): "the owner sent a message" / "an agent ran a command or a tool", and
// (v1.30) what each token usage report adds, from what this desktop already receives. Local decoration, not business state: nothing here reads or asks the daemon.
//
// Costs nothing without a subscriber: the host-event listener is attached by the first subscriber and removed with
// the last, and `noteOwnerMessage` (called by the store's submit) is one size check. With a subscriber: a string compare per host
// event.
//
// What can be seen: every connected host's feed (subagents' calls included), and sends from this desktop. What cannot:
// hosts that are not connected, the time this app is closed, the gap after a feed resync (it restarts at the live
// tail), messages sent from another device, and calls a non-owner connection is not granted to see.
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { bridge } from "../bridge";

export type ActivityKind = "ownerMessage" | "command" | "tool";
/** `agentId` (v1.30): the agent of a command or tool call; absent for the owner's sends. */
export interface ActivityEvent { kind: ActivityKind; hostId: string; agentId?: string }
export type ActivityListener = (event: ActivityEvent) => void;

const TOOL_ITEMS: ReadonlySet<string> = new Set(["mcpToolCall", "dynamicToolCall", "fileChange", "webSearch"]);
const SEEN_MAX = 4096;

/** A native item event's kind and identity (a call has a started and a completed event; some runtimes send only one); null = not a call. */
export function classifyActivity(envelope: Pick<EventEnvelope, "native" | "cutexSessionId">): { kind: "command" | "tool"; key: string } | null {
  const native = envelope.native;
  if (!native || native.kind === "serverRequest") return null;
  const method = native.message.method;
  if (method !== "item/started" && method !== "item/completed") return null;
  const params = native.message.params as { threadId?: unknown; item?: { type?: unknown; id?: unknown } } | undefined;
  const type = params?.item?.type;
  const kind = type === "commandExecution" ? "command" : typeof type === "string" && TOOL_ITEMS.has(type) ? "tool" : null;
  if (!kind) return null;
  return { kind, key: `${envelope.cutexSessionId}/${String(params?.threadId ?? "")}/${String(params?.item?.id ?? "")}` };
}

/** First sight of a key, within the last `max` keys. */
export function seenOnce(seen: Set<string>, key: string, max = SEEN_MAX): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  if (seen.size > max) seen.delete(seen.values().next().value!);
  return true;
}

const listeners = new Set<ActivityListener>();
let off: (() => void) | null = null;
const seen = new Set<string>();

function emit(event: ActivityEvent): void {
  for (const listener of [...listeners]) listener(event);
}

/** The store's submit: the owner sent a message from this desktop. */
export function noteOwnerMessage(hostId: string): void {
  if (listeners.size) emit({ kind: "ownerMessage", hostId });
}

export function subscribeActivity(listener: ActivityListener): () => void {
  listeners.add(listener);
  off ??= bridge.on("hostEvent", ({ hostId, envelope }) => {
    const call = classifyActivity(envelope);
    if (call && seenOnce(seen, `${hostId}/${call.key}`)) emit({ kind: call.kind, hostId, agentId: envelope.cutexSessionId });
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && off) {
      off();
      off = null;
      seen.clear();
    }
  };
}

// ---- token usage (v1.30): what each usage report adds, by the same rule on every runtime ----
//
// A runtime reports `thread/tokenUsage/updated` with the thread's cumulative `total`. What a report adds is the growth of
// `total` since the last report seen for that thread, as cutex's usage ledger counts it. `last` is not used: the Claude
// runtime puts the context occupancy there. Counted: input not read from a cache (cache writes count) plus output;
// output already holds reasoning on every runtime. Cached input never counts.

export interface TokenBreakdown { inputTokens: number; cachedInputTokens: number; cacheWriteInputTokens: number; outputTokens: number; reasoningOutputTokens: number }
/** One usage report. `tokens` 0: a report with nothing new to count (a model request whose usage the runtime bills later). */
export interface UsageEvent { hostId: string; agentId: string; tokens: number }
export type UsageListener = (event: UsageEvent) => void;

const USAGE_METHOD = "thread/tokenUsage/updated";
const FIELDS = ["inputTokens", "cachedInputTokens", "cacheWriteInputTokens", "outputTokens", "reasoningOutputTokens"] as const;

function breakdown(raw: unknown): TokenBreakdown | null {
  if (!raw || typeof raw !== "object") return null;
  const out = {} as TokenBreakdown;
  for (const field of FIELDS) {
    const value = (raw as Record<string, unknown>)[field] ?? 0;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
    out[field] = value;
  }
  return out;
}

/** Input not read from a cache, plus output. */
export function countedTokens(b: TokenBreakdown): number {
  return Math.max(0, b.inputTokens - b.cachedInputTokens) + b.outputTokens;
}

/** A usage report's thread and figures; null = not one (one string compare for every other event). */
export function usageReportOf(envelope: Pick<EventEnvelope, "native" | "cutexSessionId">): { thread: string; total: TokenBreakdown; last: TokenBreakdown | null } | null {
  const native = envelope.native;
  if (!native || native.kind === "serverRequest" || native.message.method !== USAGE_METHOD) return null;
  const params = native.message.params as { threadId?: unknown; tokenUsage?: { total?: unknown; last?: unknown } } | undefined;
  const total = breakdown(params?.tokenUsage?.total);
  if (!total) return null;
  return { thread: String(params?.threadId ?? ""), total, last: breakdown(params?.tokenUsage?.last) };
}

const same = (a: TokenBreakdown | null, b: TokenBreakdown | null) => (a === null || b === null ? a === b : FIELDS.every((f) => a[f] === b[f]));

export interface ThreadUsage { total: TokenBreakdown; last: TokenBreakdown | null }

/**
 * What a report adds after `previous` (the thread's last report seen; undefined = none on this connection): tokens, 0 for
 * a report with nothing to count yet, null for a repeat of the last one. A first sight only sets the baseline, unless it
 * is a new thread's first request (`last` = `total`); a lower total (a reverted or new counter) starts a new baseline.
 */
export function usageAdded(previous: ThreadUsage | undefined, total: TokenBreakdown, last: TokenBreakdown | null): number | null {
  if (!previous) return last && same(last, total) ? countedTokens(total) : 0;
  if (same(previous.total, total)) return same(previous.last, last) ? null : 0;
  if (FIELDS.some((f) => total[f] < previous.total[f])) return 0;
  return Math.max(0, countedTokens(total) - countedTokens(previous.total));
}

const usageListeners = new Set<UsageListener>();
let offUsage: (() => void) | null = null;
let offUsageResync: (() => void) | null = null;
const threads = new Map<string, ThreadUsage>();

/** Usage reports on every connected host's feed, each once. Like `subscribeActivity`: nothing listens without a subscriber. */
export function subscribeUsage(listener: UsageListener): () => void {
  usageListeners.add(listener);
  offUsage ??= bridge.on("hostEvent", ({ hostId, epoch, envelope }) => {
    const report = usageReportOf(envelope);
    if (!report) return;
    // A new connection (epoch) starts at the live tail too.
    const key = `${hostId}\n${epoch}\n${envelope.cutexSessionId}\n${report.thread}`;
    const tokens = usageAdded(threads.get(key), report.total, report.last);
    threads.delete(key);
    threads.set(key, { total: report.total, last: report.last });
    if (threads.size > SEEN_MAX) threads.delete(threads.keys().next().value!);
    if (tokens === null) return;
    for (const l of [...usageListeners]) l({ hostId, agentId: envelope.cutexSessionId, tokens });
  });
  // The feed restarts at the live tail after a gap: the next report would add the whole gap at once.
  offUsageResync ??= bridge.on("hostResync", ({ hostId }) => {
    for (const key of [...threads.keys()]) if (key.startsWith(`${hostId}\n`)) threads.delete(key);
  });
  return () => {
    usageListeners.delete(listener);
    if (usageListeners.size === 0) {
      offUsage?.();
      offUsageResync?.();
      offUsage = offUsageResync = null;
      threads.clear();
    }
  };
}
