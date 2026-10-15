// Coalescing for refreshes driven by host events (sidebar). A plain trailing debounce restarted on
// every event never fires while events keep coming, then fires once per quiet gap; with many busy
// agents that meant a full sidebar reload (sessions active + retired + projects + host rows) every
// gap, i.e. several daemon session reads per second (measured on a Linux host, 2026-10-09).

import type { EventEnvelope } from "@cutex-desktop/protocol";

export interface CoalescedRefresh {
  /** Ask for a refresh: runs `delayMs` after the first request, then at most every `minIntervalMs`. */
  request(): void;
  /** Drop a pending refresh (host switch). */
  cancel(): void;
}

export interface CoalescedRefreshOptions {
  delayMs: number;
  minIntervalMs: number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export function coalescedRefresh(run: () => void, options: CoalescedRefreshOptions): CoalescedRefresh {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let lastRun = Number.NEGATIVE_INFINITY;
  return {
    request() {
      // Already scheduled: that run starts later, so it sees this change too. A run already started
      // (timer cleared) gets a new one here: a change during an in-flight read is never dropped.
      if (timer !== null) return;
      const wait = Math.max(options.delayMs, lastRun + options.minIntervalMs - now());
      timer = setTimer(() => {
        timer = null;
        lastRun = now();
        run();
      }, wait);
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

/** Host events that never change sidebar rows (their own stores refresh on them). */
export function sidebarIgnoresMethod(method: string): boolean {
  return (
    method === "turn/plan/updated" ||
    method === "turn/diff/updated" ||
    method.startsWith("cutex/ask/") ||
    method.startsWith("cutex/runtimePackages/") ||
    method.startsWith("cutex/services/") ||
    method.startsWith("cutex/ownerNotify/")
  );
}

export function sidebarRefreshesForMethod(method: string): boolean {
  return !sidebarIgnoresMethod(method) && (
    method.startsWith("cutex/") || method.startsWith("turn/") || method.startsWith("thread/status") ||
    method === "thread/name/updated" || method === "thread/settings/updated"
  );
}

/** cutex MCP tools that add, archive, replace or (re)start agents (Agent Management). */
const AGENT_MANAGEMENT_TOOLS = new Set(["agent_create", "agent_archive", "member_replace", "member_runtime", "cutex_agent_management"]);

/**
 * A Director's / operator's Agent Management tool call finished. agent_create runs in the cutex
 * Agent Bus process, whose events (and the new agent's first runtime events) never reach the
 * live host feed before cutex r240 (`cutex/sessions/changed`); the caller's own `item/completed`
 * does, after the session and its project membership were committed.
 */
export function agentManagementToolCompleted(envelope: EventEnvelope): boolean {
  const message = envelope.native?.message;
  if (message?.method !== "item/completed") return false;
  const item = (message.params as { item?: { type?: unknown; tool?: unknown } } | undefined)?.item;
  if (item?.type !== "mcpToolCall" || typeof item.tool !== "string") return false;
  // Claude spells MCP tools `mcp__<server>__<tool>`.
  return AGENT_MANAGEMENT_TOOLS.has(item.tool.split("__").pop()!);
}
