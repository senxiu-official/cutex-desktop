// Background work of the selected agent (DESIGN §4.14): long-running terminals from cute-codex
// `thread/backgroundTerminals/list`, and sub-agents derived from collabAgentToolCall items.
import { useEffect, useMemo, useState } from "react";
import type { BackgroundTerminal } from "../../../shared/ipc";
import { sessionApi, useApp } from "../store";
import { viewRow } from "./viewHost";
import { childStatusFromThreadRead, liveAtGeneration, subAgentMetaFromThreadRead, subAgentsOf, takeSubAgentReads, type SubAgentLive, type SubAgentReadLog } from "./subagents";
import { recordSubAgentMeta, useSubAgentMeta } from "./subagentMetaStore";
import { lacks, opensClaudeSubagents } from "./agentFeatures";
import { agentFeaturesFor } from "./agentFeaturesView";
import type { TimelineState } from "./timeline";
import { RequestCoalescer, terminalsRefreshKey } from "./terminalsFetch";

export { activeSubAgents } from "./subagents";

/** Sub-agent thread reads asked for in this app session (lib/subagents `takeSubAgentReads`). */
const subAgentReads: SubAgentReadLog = { settle: new Set(), name: new Map() };

/** The agent's current cutex `runtimeGeneration`: the newer of the sidebar resource's and the
 *  session view's (bootstrap / event correlation); 0 = unknown. */
export function useAgentRuntimeGeneration(sessionId: string | null): number {
  return useApp((s) => {
    if (!sessionId) return 0;
    const resource = viewRow(s, sessionId)?.runtime.runtimeGeneration ?? 0;
    return Math.max(resource, s.sessions[sessionId]?.runtimeGeneration ?? 0);
  });
}

/** Child-thread statuses as of the agent's current runtime generation (lib/subagents `liveAtGeneration`):
 *  a sub-agent seen working under a runtime that has since been stopped shows as interrupted. */
export function useSubAgentLive(sessionId: string | null): SubAgentLive {
  const live = useApp((s) => s.subAgentLive);
  const seenAt = useApp((s) => s.subAgentLiveGen);
  const generation = useAgentRuntimeGeneration(sessionId);
  return useMemo(() => liveAtGeneration(live, seenAt, generation), [live, seenAt, generation]);
}

/** The parent's timeline only has call-time snapshots (a spawn says `pendingInit`), and a child
 *  that finished before this window loaded sent its events before we listened. While the parent
 *  is online, read each sub-agent that still looks active and has no child-thread status yet once
 *  per runtime generation (`thread/read` on the child) and record the settled status. The same read
 *  gives the child's nickname / role; a sub-agent whose nickname is still unknown gets one light read
 *  (no turns) for it. A Claude task is read only when its adapter keeps subagent transcripts
 *  (lib/claudeTasks); otherwise the adapter's own `subAgentActivity` items say when it ends. */
export function useSettleSubAgents(sessionId: string | null, timeline: TimelineState | null, version: number, online: boolean): void {
  const live = useSubAgentLive(sessionId);
  const generation = useAgentRuntimeGeneration(sessionId);
  const meta = useSubAgentMeta();
  useEffect(() => {
    if (!sessionId || !online) return;
    const claudeReads = opensClaudeSubagents(agentFeaturesFor(sessionId));
    for (const { threadId, settle } of takeSubAgentReads(sessionId, subAgentsOf(timeline).values(), live, meta, subAgentReads, Date.now(), generation, claudeReads)) {
      sessionApi(sessionId).subAgentThread(sessionId, threadId, settle ? undefined : { includeTurns: false }).then(
        (result) => {
          recordSubAgentMeta(threadId, subAgentMetaFromThreadRead(result));
          const status = settle ? childStatusFromThreadRead(result) : null;
          if (status) useApp.getState().setSubAgentStatus(threadId, status, generation);
        },
        () => {},
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, online, version, live, meta, generation]);
}

/** Whether the agent's runtime is online (sidebar snapshot). */
export function useAgentOnline(sessionId: string | null): boolean {
  return useApp((s) => !!sessionId && viewRow(s, sessionId)?.runtime.status === "online");
}

/** Shared by the status capsule and the status bar (lib/terminalsFetch). */
const terminalRequests = new RequestCoalescer<BackgroundTerminal[]>(2_000);

/**
 * Background terminals of the agent's thread: re-read when a command starts / finishes or the turn
 * changes (`terminalsRefreshKey`, not on every streamed event), polled lightly while any run.
 */
export function useBackgroundTerminals(sessionId: string | null, threadId: string | null, timeline: TimelineState | null) {
  const [terminals, setTerminals] = useState<BackgroundTerminal[]>([]);
  const [tick, setTick] = useState(0);
  const refreshKey = terminalsRefreshKey(timeline);
  useEffect(() => {
    // Claude agents have no background terminals (features.backgroundTerminals = false): don't poll.
    if (!sessionId || !threadId || lacks(agentFeaturesFor(sessionId), "backgroundTerminals")) return setTerminals([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      terminalRequests.get(`${sessionId}\n${threadId}`, () => sessionApi(sessionId).backgroundTerminals(sessionId, threadId)).then(
        (list) => {
          if (cancelled) return;
          setTerminals(list);
          useApp.getState().setBackgroundItems(sessionId, list.map((x) => x.itemId));
        },
        () => {
          if (cancelled) return;
          setTerminals([]);
          useApp.getState().setBackgroundItems(sessionId, []);
        },
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, threadId, refreshKey, tick]);
  // Light polling only while something is running (CPU / memory figures change).
  useEffect(() => {
    if (terminals.length === 0) return;
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, [terminals.length]);
  const refresh = () => {
    // After a terminate: read again, not the shared result from just before it.
    if (sessionId && threadId) terminalRequests.invalidate(`${sessionId}\n${threadId}`);
    setTick((n) => n + 1);
  };
  return { terminals, refresh };
}
