// Settings → 协作 → 消息总线 → 卡住的消息 (cutex `agent-bus-stuck-messages`): undelivered bus
// messages with who sent them to whom, how long they have waited and a preview, 丢弃 per row (click
// twice) and 全部丢弃 (click twice, the button says how many). Discarding makes a message terminal in
// cutex and withdraws it from the live queue; it is never redelivered.
import { Loader2, X } from "lucide-react";
import type { StuckBusMessage } from "../../../../shared/ipc";
import { Button, EmptyState, ErrorNote, IconButton, ListRow, Loading, Notice, RefreshButton, Section, Select } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { FIELD_W } from "../../lib/fieldWidths";
import { ageParts, bulkTargets, KNOWN_ERRORS, knownKind, MIN_AGE_CHOICES, minAgeKey, partyName, protectedCount, reasonsTooltip, refusalText, senderLabel, stuckHints, type StuckHint } from "./stuck";
import { useStuckMessages, type StuckMessagesState } from "./useStuckMessages";

type T = ReturnType<typeof useI18n>["t"];

function ageText(secs: number | null, t: T): string | null {
  const age = ageParts(secs);
  return age ? t(`agent-bus.stuck.ago.${age.unit}` as MessageKey, { n: age.n }) : null;
}

function knownError(t: T) {
  return (code: string): string | null => ((KNOWN_ERRORS as readonly string[]).includes(code) ? t(`agent-bus.stuck.error.${code}` as MessageKey) : null);
}

export function StuckMessagesSection() {
  const { t } = useI18n();
  const s = useStuckMessages();
  const { view } = s;
  const targets = view ? bulkTargets(view.messages) : [];
  const working = s.busy.size > 0 || s.bulk !== null;
  const minAgeOptions = MIN_AGE_CHOICES.map((secs) => ({ value: String(secs), label: t(`agent-bus.stuck.minAge.${minAgeKey(secs)}` as MessageKey) }));
  return (
    <Section
      title={t("agent-bus.stuck.title")}
      hint={t("agent-bus.stuck.hint")}
      actions={
        <>
          <Select value={String(s.minAge)} options={minAgeOptions} width={FIELD_W.short} label={t("agent-bus.stuck.minAge")} disabled={s.bulk !== null} onChange={(v) => s.setMinAge(Number(v))} />
          {view && view.messages.length > 0 && <DiscardAllButton count={targets.length} progress={s.bulk} disabled={working && s.bulk === null} onDiscardAll={() => void s.discardEverything()} />}
          <RefreshButton disabled={s.loading || working} onClick={() => void s.refresh()} />
        </>
      }
    >
      {s.error && <ErrorNote>{s.error}</ErrorNote>}
      {!view && !s.error && <Loading rows={2} />}
      {view && <Body state={s} view={view} />}
    </Section>
  );
}

function Body({ state, view }: { state: StuckMessagesState; view: NonNullable<StuckMessagesState["view"]> }) {
  const { t } = useI18n();
  const { messages } = view;
  const protectedRows = protectedCount(messages);
  const working = state.busy.size > 0 || state.bulk !== null;
  return (
    <>
      <SummaryNotes state={state} />
      {!view.liveQueueAvailable && <Notice>{t("agent-bus.stuck.liveDown", { error: view.liveQueueError ?? "—" })}</Notice>}
      {messages.length === 0 ? (
        <EmptyState>{state.minAge === 0 ? t("agent-bus.stuck.emptyAll") : t("agent-bus.stuck.empty", { age: t(`agent-bus.stuck.minAge.${minAgeKey(state.minAge)}` as MessageKey) })}</EmptyState>
      ) : (
        <>
          {messages.map((m) => (
            <MessageRow key={m.messageId} message={m} busy={state.busy.has(m.messageId)} disabled={working} onDiscard={() => void state.discardOne(m)} />
          ))}
          {(view.total > messages.length || protectedRows > 0) && (
            <div className="py-2">
              {view.total > messages.length && <p className="text-xs text-subtle">{t("agent-bus.stuck.truncated", { shown: messages.length, total: view.total })}</p>}
              {protectedRows > 0 && <p className="text-xs text-subtle">{t("agent-bus.stuck.protectedNote", { n: protectedRows })}</p>}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** What the last discard / 全部丢弃 did: refusals and oddities always, the count after 全部丢弃. */
function SummaryNotes({ state }: { state: StuckMessagesState }) {
  const { t } = useI18n();
  const { summary } = state;
  if (!summary) return null;
  const lines: { tone: "info" | "warn" | "error"; text: string }[] = [];
  if (summary.bulk && summary.discarded > 0) lines.push({ tone: "info", text: t("agent-bus.stuck.summary.discarded", { n: summary.discarded }) });
  if (summary.gone > 0) lines.push({ tone: "info", text: t("agent-bus.stuck.summary.gone", { n: summary.gone }) });
  if (summary.liveWarnings > 0) lines.push({ tone: "warn", text: t("agent-bus.stuck.summary.live", { n: summary.liveWarnings }) });
  if (summary.failed.length > 0) {
    const first = summary.failed[0]!;
    lines.push({ tone: "error", text: t("agent-bus.stuck.summary.failed", { n: summary.failed.length, detail: refusalText(first, knownError(t)) }) });
  }
  if (summary.notAttempted > 0) lines.push({ tone: "warn", text: t("agent-bus.stuck.summary.notAttempted", { n: summary.notAttempted }) });
  if (lines.length === 0) return null;
  return (
    <div className="flex items-start gap-2 border-b border-border py-1">
      <div className="min-w-0 flex-1">
        {lines.map((line) =>
          line.tone === "error" ? (
            <ErrorNote key={line.text}>{line.text}</ErrorNote>
          ) : (
            <Notice key={line.text} tone={line.tone}>
              {line.text}
            </Notice>
          ),
        )}
      </div>
      <IconButton label={t("common.close")} onClick={state.dismissSummary}>
        <X size={14} />
      </IconButton>
    </div>
  );
}

function MessageRow({ message: m, busy, disabled, onDiscard }: { message: StuckBusMessage; busy: boolean; disabled: boolean; onDiscard(): void }) {
  const { t } = useI18n();
  const sender = senderLabel(m);
  const from = !sender ? t("agent-bus.stuck.unknownParty") : "name" in sender ? sender.name : t(`agent-bus.stuck.sender.${sender.kind}` as MessageKey);
  const to = partyName(m.to) ?? t("agent-bus.stuck.unknownParty");
  const kind = knownKind(m.senderKind);
  const stateLabel = (["pending", "stale_held", "live_only"] as const).includes(m.state as "pending") ? t(`agent-bus.stuck.state.${m.state}` as MessageKey) : m.state;
  const age = ageText(m.ageSecs, t);
  const detail = [stateLabel, kind ? t(`agent-bus.stuck.kind.${kind}` as MessageKey) : m.senderKind, age ? t("agent-bus.stuck.waited", { age }) : t("agent-bus.stuck.ageUnknown")].filter(Boolean).join(" · ");
  const ids = [m.from?.id && `${m.from.id}`, m.to?.id && `${m.to.id}`].filter(Boolean).join(" → ");
  return (
    <ListRow
      frame={busy ? "opacity-60" : undefined}
      title={
        <span title={[ids, m.messageId].filter(Boolean).join("\n")}>
          {from} <span className="text-subtle">→</span> {to}
        </span>
      }
      detail={detail}
      actions={<DiscardButton busy={busy} disabled={disabled} onDiscard={onDiscard} />}
      below={
        <div className="pt-0.5" title={reasonsTooltip(m)}>
          <p className="line-clamp-2 text-xs break-words text-muted" title={m.contentPreview || undefined}>
            {m.contentPreview.trim() || t("agent-bus.stuck.noContent")}
          </p>
          <ul className="mt-0.5">
            {stuckHints(m).map((hint) => (
              <li key={hint.key} className={`text-[11px] ${hint.key === "protected" ? "text-warn-text" : "text-subtle"}`}>
                {hintText(hint, t)}
              </li>
            ))}
          </ul>
        </div>
      }
    />
  );
}

function hintText(hint: StuckHint, t: T): string {
  return t(`agent-bus.stuck.hint.${hint.key}` as MessageKey, hint.params);
}

/** 丢弃: the first click arms (red, "再点一次丢弃"), the second discards. */
function DiscardButton({ busy, disabled, onDiscard }: { busy: boolean; disabled: boolean; onDiscard(): void }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed();
  if (armed && !busy)
    return (
      <button
        disabled={disabled}
        className={`${ARMED_FORM_BUTTON} whitespace-nowrap`}
        onClick={() => {
          setArmed(false);
          onDiscard();
        }}
      >
        {t("agent-bus.stuck.discardArmed")}
      </button>
    );
  return (
    <Button disabled={disabled || busy} onClick={() => setArmed(true)}>
      {busy ? <Loader2 size={12} className="inline animate-spin" /> : t("agent-bus.stuck.discard")}
    </Button>
  );
}

/** 全部丢弃: armed state names the count (Task / Job / control messages are never in it). */
function DiscardAllButton({ count, progress, disabled, onDiscardAll }: { count: number; progress: { done: number; total: number } | null; disabled: boolean; onDiscardAll(): void }) {
  const { t } = useI18n();
  const [armed, setArmed] = useArmed(count);
  if (progress)
    return (
      <Button disabled onClick={() => undefined}>
        <Loader2 size={12} className="mr-1 inline animate-spin" />
        {t("agent-bus.stuck.discardAllProgress", { done: progress.done, total: progress.total })}
      </Button>
    );
  if (armed && count > 0)
    return (
      <button
        disabled={disabled}
        className={`${ARMED_FORM_BUTTON} whitespace-nowrap`}
        onClick={() => {
          setArmed(false);
          onDiscardAll();
        }}
      >
        {t("agent-bus.stuck.discardAllArmed", { n: count })}
      </button>
    );
  return (
    <Button disabled={disabled || count === 0} title={count === 0 ? t("agent-bus.stuck.discardAllNone") : t("agent-bus.stuck.discardAllTitle", { n: count })} onClick={() => setArmed(true)}>
      {t("agent-bus.stuck.discardAll")}
    </Button>
  );
}
