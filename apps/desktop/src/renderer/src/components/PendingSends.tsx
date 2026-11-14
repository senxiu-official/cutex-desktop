import type { SessionDelivery } from "@cutex-desktop/protocol";
import { DeliveryStatus } from "./DeliveryStatus";
import { LocalSendStatus } from "./LocalSendStatus";
import { NEXT_UP_EFFECTS, NEXT_UP_STATES, langOf, stateLabelKey } from "../lib/inputLedger/nextUpRegistry";
import type { LedgerOwnerOutbox } from "../lib/inputLedger/owner";
import type { MessageKey } from "../i18n";
// The status line under an optimistic new-turn send (lib/outbox, placement "turn"). The bubble itself
// is the timeline's own user-message row (components/Timeline, Entry with `pending`), keyed by the
// clientUserMessageId like the native userMessage that replaces it — one element whose props change
// at the handoff (no remount, no jump). The status is laid over the row's action slot (Timeline: one h-7 slot
// for both), right-aligned, so it never sizes the row — appearing, changing or going moves nothing (owner
// 2026-10-24): a quiet 发送中… / 已送达 (with how long the agent has been silent), or the error with
// 重试 / 放回输入框 / 丢弃.
import { useRef } from "react";
import { useI18n } from "../i18n";
import { outboxStatusCopy, type OutboxEntry } from "../lib/legacyDelivery/outbox";
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

/** Over the slot (out of the layout): its right edge, centred in its height, never wider than the row. */
const OVER = "absolute inset-y-0 right-0 flex max-w-full items-center whitespace-nowrap";

export function PendingStatus({ sessionId, entry }: { sessionId: string; entry: OutboxEntry }) {
  const { t, locale } = useI18n();
  const lang = langOf(locale);
  const failed = entry.state === "failed";
  // Accepted, its entry not there yet, and the agent silent: say so instead of a bare 已送达.
  const silent = useSilentSeconds(sessionId, entry.state === "confirmed");
  if (failed) {
    const app = useApp.getState();
    return (
      <div className={`${OVER} gap-1.5 text-xs`} data-testid="outbox-status">
        {/* Old hosts too: the words and buttons of registry state 13 (发送失败 · 重新发送 / 放回输入框 / 放弃). */}
        <span className="min-w-0 truncate text-danger" title={entry.error ?? NEXT_UP_STATES.failed.meaning[lang]} data-next-up-state="failed">
          {t(stateLabelKey("failed") as MessageKey)}
          {entry.error ? ` · ${entry.error}` : ""}
        </span>
        <button onClick={() => app.retrySend(sessionId, entry.id)} title={NEXT_UP_EFFECTS.retry.tip[lang]} data-effect="retry" className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 hover:text-accent">
          {NEXT_UP_EFFECTS.retry.label[lang]}
        </button>
        <button onClick={() => app.editSend(sessionId, entry.id)} title={NEXT_UP_EFFECTS.moveToComposer.tip[lang]} data-effect="moveToComposer" className="shrink-0 rounded-md px-1.5 py-0.5 text-muted hover:text-foreground">
          {NEXT_UP_EFFECTS.moveToComposer.label[lang]}
        </button>
        <button onClick={() => app.discardSend(sessionId, entry.id)} title={NEXT_UP_EFFECTS.dismiss.tip[lang]} data-effect="dismiss" className="shrink-0 rounded-md px-1.5 py-0.5 text-muted hover:text-danger">
          {NEXT_UP_EFFECTS.dismiss.label[lang]}
        </button>
      </div>
    );
  }
  const status = outboxStatusCopy(entry, { silentSeconds: silent });
  return (
    <div className={`pending-status-in ${OVER} text-caption/[inherit] text-subtle`} title={t(status.hint)} data-testid="outbox-status">
      {t(status.label, status.vars)}
    </div>
  );
}

export function SessionDeliveryStatus({ delivery, sessionId, hostId }: { delivery: SessionDelivery | null; sessionId: string; hostId?: string }) {
  return delivery ? <DeliveryStatus delivery={delivery} sessionId={sessionId} hostId={hostId} leaseRecovery={false} /> : null;
}

export function LedgerPendingStatus({ entry, sessionId, hostId, readOnly = false }: { entry: LedgerOwnerOutbox; sessionId: string; hostId: string; readOnly?: boolean }) {
  // Words and buttons: the Next Up registry (components/LocalSendStatus), the same as the Next Up O0 row.
  return <span className={`${OVER} gap-2 text-caption text-subtle`} data-testid="ledger-outbox-status">
    <LocalSendStatus entry={entry} sessionId={sessionId} hostId={hostId} readOnly={readOnly} />
  </span>;
}
