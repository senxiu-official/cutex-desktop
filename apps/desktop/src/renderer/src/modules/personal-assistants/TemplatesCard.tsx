// An assistant's 定期任务 tab (cutex r296 recurring Director templates). Each task: what it asks, the project, when (in
// the host's local time) and its next run, the state (进行中 / 已暂停 / 已取消) and the Director it was confirmed for.
// When it needs 重新确认 (the project's Director changed or left, or a run was refused because the confirmation went
// stale) that is said plainly, with the 重新确认 action — it confirms the current seat, shown first. 暂停, 恢复 (a
// confirmation of the current seat), 修改 and 取消任务 (click twice). 运行记录 lists recent runs newest first with their
// outcome: 已发送 (with its request), 已合并, 被拒绝 and why, 已取消, or still open. Template changes are not announced as
// events, so the list is read again every POLL_MS while shown, and when the assistant's requests change (a run that
// handed off makes one). A host that announces them (change area `templates`) is not polled once it has. Opened from an owner notice (`focus`): that task is scrolled to and marked, and while its
// refused revision is still the current one it says why with 重新确认 ready (focused) even before this app sees the change.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { ArmedButton } from "../../components/ArmedButton";
import { btn, btnFace, btnShape } from "../../components/Button";
import { Button, Section } from "../../components/settings/Form";
import { Tag } from "../../components/Tag";
import type { PaAssistant, PaRun, PaSeat, PaTemplate } from "../../../../shared/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { hostOffset, hostWall, offsetOf, type ReconfirmReason, keepsActionId, newActionId, paErrorCode, reconfirmReason, runErrorCode, runKind, STALE_CODES, templateState, type TemplateState } from "../../lib/personalAssistants";
import { POLL_MS, usePa } from "../../lib/personalAssistantStore";
import { formatAbsolute } from "../../lib/time";
import { TemplateForm } from "./TemplateForm";
import type { TemplateFocus } from "./detailTabs";
import { paCodeText, paErrorText, projectName, projectSeat, sessionName, usePaTick, useVisiblePoll, type PaHost } from "./paHooks";

const MAX_PAGES = 10;
const RUNS_PAGE = 10;
type T = ReturnType<typeof useI18n>["t"];

const STATE_TONE: Record<TemplateState, "ok" | "neutral" | "attention"> = { active: "ok", paused: "attention", cancelled: "neutral" };
const ORDER: Record<TemplateState, number> = { active: 0, paused: 1, cancelled: 2 };

function ruleText(t: T, tpl: PaTemplate): string {
  const r = tpl.rule;
  if (!r) return t("personal-assistants.templates.rule.unknown");
  if (r.kind === "daily") return t("personal-assistants.templates.rule.daily", { time: r.time });
  if (r.kind === "weekly") return t("personal-assistants.templates.rule.weekly", { weekday: t(`personal-assistants.templates.weekday.${r.weekday}` as MessageKey), time: r.time });
  return t("personal-assistants.templates.rule.interval", { n: r.hours });
}
/**
 * A time in the host's local time when its offset is known (else this device's, said so). `bare`: no 主机时间 suffix
 * (a list that says it once).
 */
function hostTime(t: T, iso: string, offset: number | null, bare = false): string {
  if (offset !== null) {
    const w = hostWall(iso, offset);
    if (w) {
      const at = `${w.date.slice(5)} ${t(`personal-assistants.templates.weekday.${w.weekday}` as MessageKey)} ${w.time}`;
      return bare ? at : t("personal-assistants.templates.atZone", { at, zone: t("personal-assistants.templates.hostTime") });
    }
  }
  const ms = Date.parse(iso);
  return t("personal-assistants.templates.atZone", { at: Number.isFinite(ms) ? formatAbsolute(Math.floor(ms / 1000)) : iso, zone: t("personal-assistants.templates.deviceTime") });
}
/** Why a run was not sent, in plain words (the run's own sentence, else the refusal's, else cutex's text). */
const RUN_WHY: Readonly<Record<string, MessageKey>> = {
  director_changed: "personal-assistants.templates.runWhy.director_changed",
  director_missing: "personal-assistants.templates.runWhy.director_missing",
  confirmation_stale: "personal-assistants.templates.runWhy.confirmation_stale",
};

export function TemplatesCard({ hostId, assistant, host, readOnly, onOpenRequest, focus = null }: { hostId: string; assistant: PaAssistant; host: PaHost | undefined; readOnly: boolean; onOpenRequest(requestId: string): void; focus?: TemplateFocus | null }) {
  const { t } = useI18n();
  const [items, setItems] = useState<PaTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit?: PaTemplate } | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const tick = usePaTick(hostId, assistant.id, "requests", "assistant", "templates");
  // Hosts that announce 定期任务 changes (area `templates`) need no polling.
  const announced = usePa((s) => s.byHost[hostId]?.sendsTemplates === true);
  const load = useCallback(async () => {
    try {
      const out: PaTemplate[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await hostApi(hostId).paTemplates(assistant.id, { cursor, limit: 100 });
        out.push(...page.items);
        if (!page.nextCursor || page.nextCursor === cursor) break;
        cursor = page.nextCursor;
      }
      setItems(out);
      setError(null);
    } catch (e) {
      setError(paErrorText(e, t));
    }
  }, [hostId, assistant.id, t]);
  useEffect(() => {
    void load();
  }, [load, tick]);
  useVisiblePoll(() => void load(), POLL_MS, !announced);
  const take = (saved: PaTemplate) => setItems((cur) => (cur?.some((x) => x.id === saved.id) ? cur.map((x) => (x.id === saved.id ? saved : x)) : [...(cur ?? []), saved]));
  const sorted = [...(items ?? [])].sort((a, b) => ORDER[templateState(a)] - ORDER[templateState(b)] || a.createdAt.localeCompare(b.createdAt));
  const live = sorted.filter((x) => templateState(x) !== "cancelled");
  const cancelled = sorted.filter((x) => templateState(x) === "cancelled");
  return (
    <div data-pa-templates="">
      <Section
        title={t("personal-assistants.templates.title")}
        hint={t("personal-assistants.templates.hint")}
        actions={!readOnly && !form ? <Button onClick={() => setForm({})}><Plus size={13} className="mr-1 inline" />{t("personal-assistants.templates.new")}</Button> : undefined}
      >
        {error && <div className="mb-2 text-caption/[inherit] text-danger" role="alert">{t("personal-assistants.templates.loadFailed", { error })}</div>}
        {form && !form.edit && (
          <TemplateForm hostId={hostId} assistant={assistant} host={host} onClose={() => setForm(null)} onDone={(saved) => (take(saved), setForm(null))} />
        )}
        {items && live.length === 0 && !form && <div className="py-2 text-ui/[inherit] text-subtle" data-pa-templates-none="">{t("personal-assistants.templates.none")}</div>}
        <ul className="flex flex-col gap-2">
          {live.map((tpl) =>
            form?.edit?.id === tpl.id ? (
              <li key={tpl.id}>
                <TemplateForm hostId={hostId} assistant={assistant} host={host} initial={tpl} onClose={() => setForm(null)} onDone={(saved) => (take(saved), setForm(null))} />
              </li>
            ) : (
              <TemplateRow key={tpl.id} tpl={tpl} hostId={hostId} assistant={assistant} host={host} readOnly={readOnly} onSaved={take} onStale={() => void load()} onEdit={() => setForm({ edit: tpl })} onOpenRequest={onOpenRequest} focus={focus?.scheduleId === tpl.id ? focus : null} />
            ),
          )}
        </ul>
        {cancelled.length > 0 && (
          <div className="mt-2">
            <button type="button" className="press flex items-center gap-1 rounded-sm text-caption/[inherit] text-subtle hover:text-foreground" aria-expanded={showCancelled} onClick={() => setShowCancelled(!showCancelled)} data-pa-templates-cancelled={cancelled.length}>
              {showCancelled ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {t("personal-assistants.templates.cancelledGroup", { n: cancelled.length })}
            </button>
            {showCancelled && (
              <ul className="mt-1 flex flex-col gap-2">
                {cancelled.map((tpl) => (
                  <TemplateRow key={tpl.id} tpl={tpl} hostId={hostId} assistant={assistant} host={host} readOnly onSaved={take} onStale={() => void load()} onEdit={() => {}} onOpenRequest={onOpenRequest} />
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

/** A notice's reason as a re-confirm reason, while the refused revision is still the template's (null otherwise). */
function noticeReason(tpl: PaTemplate, focus: TemplateFocus | null): ReconfirmReason | null {
  if (!focus || templateState(tpl) === "cancelled" || !tpl.template) return null;
  if (focus.templateRevision !== null && tpl.template.templateRevision > focus.templateRevision) return null;
  return focus.reason === "director_changed" ? "director" : focus.reason === "director_missing" ? "directorMissing" : "assistant";
}

/** The notice says the Director changed but this app still sees the confirmed seat (its project list is behind). */
function sameSeat(a: PaSeat | null | undefined, b: PaSeat | null | undefined): boolean {
  return !!a?.sessionId && a.sessionId === b?.sessionId && a.epoch === b.epoch;
}

function TemplateRow({ tpl, hostId, assistant, host, readOnly, onSaved, onStale, onEdit, onOpenRequest, focus = null }: { tpl: PaTemplate; hostId: string; assistant: PaAssistant; host: PaHost | undefined; readOnly: boolean; onSaved(t: PaTemplate): void; onStale(): void; onEdit(): void; onOpenRequest(requestId: string): void; focus?: TemplateFocus | null }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<{ actionId: string; key: string } | null>(null);
  const [runsOpen, setRunsOpen] = useState(false);
  const state = templateState(tpl);
  const info = tpl.template;
  const ref = info?.projectRef;
  // The seat this app sees now (projects of the assistant's own host only).
  const current: PaSeat | undefined = ref && host?.instanceId === ref.instanceId ? projectSeat(host, ref.projectId) : undefined;
  const why = reconfirmReason(tpl, current) ?? noticeReason(tpl, focus);
  const rowRef = useRef<HTMLLIElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // From a notice: bring the task into view and put the focus on 重新确认 (once per notice).
  const focusKey = focus ? `${focus.scheduleId}\n${focus.templateRevision}` : null;
  useEffect(() => {
    if (!focusKey) return;
    rowRef.current?.scrollIntoView({ block: "center" });
    confirmRef.current?.focus({ preventScroll: true });
  }, [focusKey]);
  const offset = hostOffset(tpl);
  const seat = (s: PaSeat | null | undefined) => (s?.sessionId ? t("personal-assistants.card.seat", { name: sessionName(host, s.sessionId) ?? s.sessionId, epoch: s.epoch }) : t("personal-assistants.card.vacant"));
  const act = async (key: string, run: (actionId: string) => Promise<PaTemplate>) => {
    const actionId = pending?.key === key ? pending.actionId : newActionId("template");
    setBusy(true);
    setNote(null);
    try {
      onSaved(await run(actionId));
      setPending(null);
    } catch (e) {
      setPending(keepsActionId(e) ? { actionId, key } : null);
      const code = paErrorCode(e);
      if (STALE_CODES.has(code ?? "")) {
        onStale();
        setNote({ tone: "warn", text: paErrorText(e, t) });
      } else setNote({ tone: "error", text: paErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const stop = (how: "pause" | "cancel") => void act(`${how}\n${tpl.revision}`, (actionId) => hostApi(hostId).paTemplateStop(assistant.id, tpl.id, how, { actionId, expectedRevision: tpl.revision }));
  /** 恢复 / 重新确认: the same task and rule, confirmed for the seat shown now. */
  const confirm = () => {
    if (!info || !ref || !tpl.rule || !current?.sessionId) return;
    const input = { expectedRevision: tpl.revision, expectedAssistantRevision: assistant.revision, projectRef: ref, confirmedSeat: { sessionId: current.sessionId, epoch: current.epoch }, task: info.task as never, rule: tpl.rule };
    void act(`confirm\n${JSON.stringify(input)}`, (actionId) => hostApi(hostId).paTemplateConfirm(assistant.id, tpl.id, { actionId, ...input }));
  };
  const canConfirm = !!current?.sessionId && !!tpl.rule && !!info && !busy;
  return (
    <li ref={rowRef} className={`rounded-lg border px-3 py-2 ${focus ? "border-accent ring-1 ring-accent/30" : "border-border"}`} data-pa-template={tpl.id} data-pa-template-state={state} data-pa-template-focus={focus ? "" : undefined}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-ui/[inherit] font-medium">{info ? t(`personal-assistants.templates.task.${info.task}` as MessageKey) : tpl.id}</span>
        <Tag tone={STATE_TONE[state]}>{t(`personal-assistants.templates.state.${state}` as MessageKey)}</Tag>
        {why && <Tag tone="attention" data-pa-template-reconfirm={why}>{t("personal-assistants.templates.reconfirm")}</Tag>}
        <span className="flex-1" />
        {!readOnly && state === "active" && !why && (
          <>
            <Button disabled={busy} onClick={onEdit}>{t("personal-assistants.templates.edit")}</Button>
            <Button disabled={busy} onClick={() => stop("pause")}>{t("personal-assistants.templates.pause")}</Button>
          </>
        )}
        {!readOnly && state === "paused" && !why && (
          <Button primary disabled={!canConfirm} onClick={confirm}>{t("personal-assistants.templates.resume")}</Button>
        )}
        {!readOnly && state !== "cancelled" && (
          <ArmedButton shape={btnShape()} idle={btnFace({ variant: "secondary" })} hint={t("personal-assistants.templates.cancelHint")} disabled={busy} onConfirm={() => stop("cancel")} testId="pa-template-cancel">
            {t("personal-assistants.templates.cancel")}
          </ArmedButton>
        )}
      </div>
      <div className="mt-0.5 text-caption/[inherit] text-subtle" data-pa-template-meta="">
        {[ref ? projectName(host, ref.projectId) : null, ruleText(t, tpl), tpl.rule && tpl.rule.kind !== "interval" ? t("personal-assistants.templates.hostTime") : null].filter(Boolean).join(" · ")}
      </div>
      {state !== "cancelled" && (
        <div className="text-caption/[inherit] text-subtle" data-pa-template-next="">
          {tpl.nextRunAt ? t("personal-assistants.templates.next", { at: hostTime(t, tpl.nextRunAt, offset) }) : t("personal-assistants.templates.nextNone")}
        </div>
      )}
      {info && <div className="text-caption/[inherit] text-subtle">{t("personal-assistants.templates.confirmedSeat", { seat: seat(info.confirmedSeat) })}</div>}
      {why && (
        <div className="mt-1.5 rounded-md bg-attention/10 px-2.5 py-1.5" data-pa-template-why={why}>
          <div className="text-caption/[inherit] text-foreground">
            {why === "director" && sameSeat(info?.confirmedSeat, current)
              ? t("personal-assistants.templates.reconfirmWhy.refused")
              : why === "director"
              ? t("personal-assistants.templates.reconfirmWhy.director", { before: seat(info?.confirmedSeat), after: seat(current) })
              : t(`personal-assistants.templates.reconfirmWhy.${why}` as MessageKey)}
          </div>
          {!readOnly && current?.sessionId && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button ref={confirmRef} type="button" className={btn({ variant: "primary" })} disabled={!canConfirm} onClick={confirm} data-pa-template-reconfirm-action="">
                {t("personal-assistants.templates.reconfirmAction")}
              </button>
              <span className="text-caption/[inherit] text-subtle">{t("personal-assistants.templates.form.seatValue", { seat: seat(current) })}</span>
            </div>
          )}
        </div>
      )}
      {note && <div className={`mt-1 text-caption/[inherit] ${note.tone === "ok" ? "text-subtle" : note.tone === "warn" ? "text-warn" : "text-danger"}`} role="status" data-pa-template-note={note.tone}>{note.text}</div>}
      <button type="button" className="press mt-1 flex items-center gap-1 rounded-sm text-caption/[inherit] text-subtle hover:text-foreground" aria-expanded={runsOpen} onClick={() => setRunsOpen(!runsOpen)} data-pa-template-runs-toggle="">
        {runsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t("personal-assistants.templates.runsShow")}
        {tpl.lastRun && !runsOpen && <span className="ml-1"><RunTag run={tpl.lastRun} /></span>}
      </button>
      {runsOpen && <RunList hostId={hostId} assistantId={assistant.id} tpl={tpl} offset={offset} onOpenRequest={onOpenRequest} />}
    </li>
  );
}

function RunTag({ run }: { run: PaRun }) {
  const { t } = useI18n();
  const kind = runKind(run);
  const tone = kind === "sent" ? "ok" : kind === "refused" ? "danger" : kind === "cancelled" || kind === "other" ? "neutral" : "accent";
  return (
    <Tag tone={tone} data-pa-run-kind={kind}>
      {kind === "other" ? run.outcome : t(`personal-assistants.templates.run.${kind}` as MessageKey)}
    </Tag>
  );
}

function RunList({ hostId, assistantId, tpl, offset, onOpenRequest }: { hostId: string; assistantId: string; tpl: PaTemplate; offset: number | null; onOpenRequest(requestId: string): void }) {
  const { t } = useI18n();
  const [runs, setRuns] = useState<PaRun[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const read = useCallback(async (cursor: string | null) => {
    setBusy(true);
    try {
      const page = await hostApi(hostId).paTemplateRuns(assistantId, tpl.id, { cursor, limit: RUNS_PAGE });
      setRuns((cur) => (cursor ? [...(cur ?? []), ...page.items.filter((r) => !cur?.some((c) => c.id === r.id))] : page.items));
      setNext(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(paErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }, [hostId, assistantId, tpl.id, t]);
  // The template's last run moved (a run finished, or a re-confirmation): read the newest again.
  useEffect(() => {
    void read(null);
  }, [read, tpl.revision, tpl.lastRun?.id, tpl.lastRun?.outcome]);
  return (
    <div className="mt-1 border-l-2 border-border pl-2.5" data-pa-runs={tpl.id}>
      {error && <div className="text-caption/[inherit] text-danger" role="alert">{error}</div>}
      {runs && runs.length === 0 && <div className="text-caption/[inherit] text-subtle">{t("personal-assistants.templates.runsNone")}</div>}
      {runs && runs.length > 0 && <div className="text-caption/[inherit] text-subtle">{t("personal-assistants.templates.runsZone")}</div>}
      <ul className="flex flex-col">
        {runs?.map((run) => {
          const kind = runKind(run);
          const code = runErrorCode(run);
          const reason = kind === "refused" || kind === "retrying" || kind === "held" ? (code && RUN_WHY[code] ? t(RUN_WHY[code]!) : (paCodeText(code, t) ?? run.lastError)) : null;
          const slotOffset = offsetOf(run.slotLocal) ?? offset;
          return (
            <li key={run.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5" data-pa-run={run.id}>
              <span className="shrink-0 font-mono text-caption/[inherit] text-subtle">{hostTime(t, run.scheduledAt, slotOffset, slotOffset !== null)}</span>
              <RunTag run={run} />
              {run.coalescedUntil && (
                <span title={t("personal-assistants.templates.run.mergedHint", { at: hostTime(t, run.coalescedUntil, slotOffset) })}>
                  <Tag tone="neutral" data-pa-run-merged="">{t("personal-assistants.templates.run.merged")}</Tag>
                </span>
              )}
              {run.attempts > 1 && <span className="text-caption/[inherit] text-subtle">{t("personal-assistants.templates.run.attempts", { n: run.attempts })}</span>}
              {reason && <span className="min-w-0 basis-full text-caption/[inherit] text-warn break-words" data-pa-run-reason={code ?? ""}>{reason}</span>}
              {kind === "sent" && run.requestId && (
                <button type="button" className="press rounded-sm text-caption/[inherit] text-accent" onClick={() => onOpenRequest(run.requestId!)} data-pa-run-request={run.requestId}>
                  {t("personal-assistants.templates.run.openRequest")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {next && (
        <button type="button" className="press mt-0.5 rounded-sm text-caption/[inherit] text-accent" disabled={busy} onClick={() => void read(next)}>
          {t("personal-assistants.templates.runsMore")}
        </button>
      )}
    </div>
  );
}
