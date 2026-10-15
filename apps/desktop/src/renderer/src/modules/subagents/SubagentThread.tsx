// A Codex sub-agent's own thread, read-only, as a right-side card (subagents.thread; DESIGN §4.16).
// cute-codex rejects direct user input to multi-agent v2 sub-agents, so there is no composer — only
// the parent agent can steer it. Data: cutex `thread/read` on the child thread (`subagent-threads`);
// the sub-agent list comes from the bound agent's own timeline (the card lives outside the conversation).
import { useEffect, useMemo, useState } from "react";
import { Bot } from "lucide-react";
import { TimelineBody } from "../../components/Timeline";
import { useI18n, type MessageKey } from "../../i18n";
import { useAgentRuntimeGeneration } from "../../lib/background";
import { openSubagentThread } from "../../lib/sideOpen";
import { childStatusFromThreadRead, SubAgentContext, subAgentMetaFromThreadRead, subAgentName, subAgentTooltip } from "../../lib/subagents";
import { recordSubAgentMeta, useSubAgentMeta } from "../../lib/subagentMetaStore";
import { orderedEntries, timelineFromThreadRead } from "../../lib/timeline";
import { sessionApi, useApp } from "../../store";
import type { SideBodyProps } from "../slots";
import { useBoundSubAgents, type ThreadState } from "./threadState";

const STATUS_TONE: Record<string, string> = {
  running: "text-accent",
  pendingInit: "text-accent",
  completed: "text-ok-text",
  errored: "text-danger",
  interrupted: "text-warn",
};

export function SubagentThreadBody({ instance, sessionId }: SideBodyProps<ThreadState>) {
  const { t } = useI18n();
  const threadId = instance.state.threadId;
  const agents = useBoundSubAgents(sessionId);
  const info = agents.get(threadId);
  const sub = useApp((s) => s.subTimelines[threadId]);
  const setSubTimeline = useApp((s) => s.setSubTimeline);
  const generation = useAgentRuntimeGeneration(sessionId);
  const [error, setError] = useState<string | null>(null);
  const timeline = sub?.timeline ?? null;

  // Read once on open (and to settle when the parent sees the subagent finish, or its runtime
  // restarted). After that the store applies this thread's live events, which cutex forwards on the
  // parent's stream.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    sessionApi(sessionId).subAgentThread(sessionId, threadId).then(
      (r) => {
        if (cancelled) return;
        setSubTimeline(threadId, timelineFromThreadRead(r));
        setError(null);
        recordSubAgentMeta(threadId, subAgentMetaFromThreadRead(r));
        const settled = childStatusFromThreadRead(r);
        if (settled) useApp.getState().setSubAgentStatus(threadId, settled, generation);
      },
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, threadId, info?.status, generation, setSubTimeline]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => (timeline ? orderedEntries(timeline) : []), [timeline, sub?.version]);
  const nameOf = (id: string) => agents.get(id)?.name ?? id;
  const meta = useSubAgentMeta();
  const status = info?.status ?? "running";
  const context = useMemo(() => ({ agents, open: (id: string) => void openSubagentThread(id) }), [agents]);

  return (
    <SubAgentContext.Provider value={context}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm">
            <Bot size={15} className="shrink-0 text-subtle" />
            <span className="min-w-0 truncate font-semibold" title={subAgentTooltip(threadId, info)}>
              {subAgentName(threadId, agents, meta)}
            </span>
            <span className={`shrink-0 text-xs ${STATUS_TONE[status] ?? "text-muted"}`}>{t(`sub.status.${status}` as MessageKey)}</span>
          </div>
          <p className="mt-1 text-[11px] text-subtle">{t("sub.readOnly")}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[13px]">
          {error && <p className="text-xs text-danger">{error}</p>}
          {!timeline && !error && <p className="text-xs text-subtle">…</p>}
          {timeline && sessionId && <TimelineBody timeline={timeline} entries={entries} sessionId={sessionId} nameOf={nameOf} readOnly />}
        </div>
      </div>
    </SubAgentContext.Provider>
  );
}
