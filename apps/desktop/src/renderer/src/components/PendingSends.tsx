// The status line under an optimistic new-turn send (lib/outbox, placement "turn"). The bubble itself
// is the timeline's own user-message row (components/Timeline, Entry with `pending`), keyed by the
// clientUserMessageId like the native userMessage that replaces it — one element whose props change
// at the handoff (no remount, no jump). This line takes the action row's place (same h-6 height):
// a quiet 发送中… / 已送达 (with how long the agent has been silent), or the error with
// 重试 / 放回输入框 / 丢弃.
import { useRef } from "react";
import { useI18n } from "../i18n";
import { outboxStatusCopy, type OutboxEntry } from "../lib/outbox";
import { nextProgressAt, silentGapSeconds, turnProgressMark } from "../lib/silentGap";
import { turnActivity } from "../lib/turnActivity";
import { useNow } from "../lib/time";
import type { TimelineState } from "../lib/timeline";
import { useApp } from "../store";
import { useConvView } from "../lib/conversationScope";

const NO_TIMELINE: TimelineState | null = null;

/** Seconds the running turn has been silent (lib/silentGap), while `active`; else null. */
function useSilentSeconds(sessionId: string, active: boolean): number | null {
  const timeline = useConvView(sessionId, (v) => (active ? v?.timeline : undefined) ?? NO_TIMELINE);
  const now = useNow(active && !!timeline?.activeTurnId);
  const progress = useRef<{ mark: string | null; at: number } | null>(null);
  if (!timeline) return null;
  progress.current = nextProgressAt(progress.current, turnProgressMark(timeline), now);
  const activity = turnActivity(timeline);
  return silentGapSeconds(typeof activity === "string" ? activity : null, progress.current.at, now);
}

export function PendingStatus({ sessionId, entry }: { sessionId: string; entry: OutboxEntry }) {
  const { t } = useI18n();
  const failed = entry.state === "failed";
  // Accepted, its entry not there yet, and the agent silent: say so instead of a bare 已送达.
  const silent = useSilentSeconds(sessionId, entry.state === "confirmed");
  if (failed) {
    const app = useApp.getState();
    return (
      <div className="flex h-6 max-w-[75%] items-center gap-1.5 text-xs" data-testid="outbox-status">
        <span className="min-w-0 truncate text-danger" title={entry.error}>
          {t("outbox.failed")}
          {entry.error ? ` · ${entry.error}` : ""}
        </span>
        <button onClick={() => app.retrySend(sessionId, entry.id)} title={t("outbox.retryHint")} className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 hover:text-accent">
          {t("outbox.retry")}
        </button>
        <button onClick={() => app.editSend(sessionId, entry.id)} className="shrink-0 rounded-md px-1.5 py-0.5 text-muted hover:text-foreground">
          {t("outbox.edit")}
        </button>
        <button onClick={() => app.discardSend(sessionId, entry.id)} className="shrink-0 rounded-md px-1.5 py-0.5 text-muted hover:text-danger">
          {t("outbox.discard")}
        </button>
      </div>
    );
  }
  const status = outboxStatusCopy(entry, { silentSeconds: silent });
  return (
    <div className="pending-status-in flex h-6 items-center text-[11px] text-subtle" title={t(status.hint)} data-testid="outbox-status">
      {t(status.label, status.vars)}
    </div>
  );
}
