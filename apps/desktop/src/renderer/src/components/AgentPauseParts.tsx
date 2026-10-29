// 暂停智能体 in the UI (lib/agentPause; cutex agent-pause): the state tag (sidebar row, conversation header), the
// composer's queue-card row with 继续, and the note under the composer with 继续并发送. Nothing when the agent is
// running or the host lacks the capability. Wording stays apart from 暂停新委托 (delegations only).
import { useState } from "react";
import { useI18n } from "../i18n";
import type { AgentPause } from "../../../shared/agentPause";
import { resumeAgent, resumeAndSend, useAgentPause } from "../lib/agentPause";
import { sidebarOf, useApp } from "../store";
import { Tag } from "./Tag";

/** The tooltip: what the state means for what waits (and who paused it, when a Director did). */
export function useAgentPauseHint(hostId: string | null | undefined, pause: AgentPause | null): string {
  const { t } = useI18n();
  const director = useApp((s) => (pause?.by === "director" && pause.byCutexSessionId ? sidebarOf(s, hostId)?.active.find((r) => r.cutexSessionId === pause.byCutexSessionId)?.displayName ?? pause.byCutexSessionId : null));
  if (!pause) return "";
  const hint = t(pause.phase === "pausing" ? "agentPause.tagHint.pausing" : "agentPause.tagHint.paused");
  return pause.by === "director" ? `${hint}\n${t("agentPause.byDirector", { name: director ?? "" })}` : hint;
}

/** 暂停中… / 已暂停 beside the agent's name. */
export function AgentPauseTag({ hostId, sessionId }: { hostId: string | null | undefined; sessionId: string }) {
  const { t } = useI18n();
  const pause = useAgentPause(hostId, sessionId);
  const hint = useAgentPauseHint(hostId, pause);
  if (!pause) return null;
  return (
    <Tag tone="attention" title={hint} data-agent-pause={pause.phase}>
      {t(pause.phase === "pausing" ? "agentPause.tag.pausing" : "agentPause.tag.paused")}
    </Tag>
  );
}

/** The queue card's row (like 新委托已暂停): ❚❚ 已暂停 · what waits, and 继续. */
export function AgentPausedSection({ hostId, sessionId, railed = false }: { hostId: string; sessionId: string; railed?: boolean }) {
  const { t } = useI18n();
  const pause = useAgentPause(hostId, sessionId);
  const hint = useAgentPauseHint(hostId, pause);
  const [busy, setBusy] = useState(false);
  if (!pause) return null;
  return (
    <div className={`flex min-w-0 ${railed ? "" : "pl-0.5"}`} data-testid="agent-paused" data-agent-pause={pause.phase}>
      <div className="flex h-6 min-w-0 flex-1 items-center gap-1.5 pr-1 text-caption/[inherit] text-warn-text">
        <span className="flex w-4 shrink-0 items-center justify-center self-stretch text-[8px] leading-none" aria-hidden>
          ❚❚
        </span>
        <span className="min-w-0 flex-1 truncate" title={hint}>
          {t(pause.phase === "pausing" ? "agentPause.section.pausing" : "agentPause.section.paused")}
        </span>
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void resumeAgent(hostId, sessionId).finally(() => setBusy(false));
          }}
          title={t("agentPause.resumeHint")}
          className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground hover:text-accent disabled:opacity-50"
          data-testid="agent-resume"
        >
          {t("agentPause.resumeButton")}
        </button>
      </div>
    </div>
  );
}

/**
 * Under the input while the agent is paused and there is a draft: sending queues it (cutex holds it), or
 * 继续并发送 = resume first, then this send (two steps; nothing is sent if resuming fails).
 */
export function AgentPausedSendHint({ hostId, sessionId, send }: { hostId: string; sessionId: string; send: () => Promise<void> }) {
  const { t } = useI18n();
  const pause = useAgentPause(hostId, sessionId);
  const [busy, setBusy] = useState(false);
  if (!pause) return null;
  return (
    <div className="mb-1.5 flex min-w-0 items-center gap-2 text-caption/[inherit] text-warn-text" data-testid="agent-paused-send" data-agent-pause={pause.phase}>
      <span className="min-w-0 flex-1 truncate" title={t("agentPause.sendHint")}>
        {t("agentPause.sendHint")}
      </span>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void resumeAndSend(hostId, sessionId, send).finally(() => setBusy(false));
        }}
        title={t("agentPause.resumeAndSendHint")}
        className="shrink-0 rounded-md bg-accent px-2 py-0.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
        data-testid="agent-resume-send"
      >
        {t("agentPause.resumeAndSend")}
      </button>
    </div>
  );
}
