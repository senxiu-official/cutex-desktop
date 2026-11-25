// A 定期任务 being created or changed (cutex r296 recurring templates): what it asks (项目状态 / 到期请求 / 项目日程),
// which project of the assistant's set on its host, when (每天 / 每周 at a host-local time, or every n hours), and the
// Director it will be sent to — the project's current seat, shown and sent exactly (cutex refuses a seat that is no
// longer current). Confirming is the owner's approval of every run until the Director or the assistant changes. One
// action id per confirmation, kept across a lost reply (the form is locked meanwhile).
import { useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { Button, Segmented, Select, TextInput } from "../../components/settings/Form";
import { PA_TASKS, type PaAssistant, type PaRule, type PaTask, type PaTemplate } from "../../../../shared/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { assistantRefs, DEFAULT_RULE, keepsActionId, newActionId } from "../../lib/personalAssistants";
import { paErrorText, projectName, projectSeat, sessionName, type PaHost } from "./paHooks";

type Kind = PaRule["kind"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function TemplateForm({ hostId, assistant, host, initial, onDone, onClose }: { hostId: string; assistant: PaAssistant; host: PaHost | undefined; /** Changing an existing one. */ initial?: PaTemplate; onDone(t: PaTemplate): void; onClose(): void }) {
  const { t } = useI18n();
  const home = assistant.config.homeInstanceId;
  const projects = assistantRefs(assistant).filter((r) => r.instanceId === home && (!host?.instanceId || host.instanceId === home));
  const startRule = initial?.rule ?? DEFAULT_RULE;
  const [task, setTask] = useState<PaTask>((PA_TASKS as readonly string[]).includes(initial?.template?.task ?? "") ? (initial!.template!.task as PaTask) : "projectStatus");
  const [projectId, setProjectId] = useState(initial?.template?.projectRef.projectId ?? projects[0]?.projectId ?? "");
  const [kind, setKind] = useState<Kind>(startRule.kind);
  const [time, setTime] = useState(startRule.kind === "interval" ? "09:00" : startRule.time);
  const [weekday, setWeekday] = useState(String(startRule.kind === "weekly" ? startRule.weekday : 1));
  const [hours, setHours] = useState(String(startRule.kind === "interval" ? startRule.hours : 24));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ actionId: string; key: string } | null>(null);
  const seat = projectSeat(host, projectId);
  const hoursN = Number(hours);
  const rule: PaRule | null =
    kind === "interval" ? (Number.isInteger(hoursN) && hoursN >= 1 && hoursN <= 24 * 366 ? { kind, hours: hoursN } : null)
    : !TIME.test(time) ? null
    : kind === "weekly" ? { kind, weekday: Number(weekday), time } : { kind, time };
  const ready = !!rule && !!projectId && !!seat?.sessionId && !busy && !!host?.online;
  const submit = async () => {
    if (!rule || !seat?.sessionId) return;
    const input = {
      expectedAssistantRevision: assistant.revision,
      projectRef: { instanceId: home, projectId },
      confirmedSeat: { sessionId: seat.sessionId, epoch: seat.epoch },
      task,
      rule,
      ...(initial ? { expectedRevision: initial.revision } : {}),
    };
    const key = JSON.stringify([initial?.id ?? null, input]);
    const actionId = pending?.key === key ? pending.actionId : newActionId("template");
    setBusy(true);
    setError(null);
    try {
      const saved = await hostApi(hostId).paTemplateConfirm(assistant.id, initial?.id ?? null, { actionId, ...input });
      setPending(null);
      onDone(saved);
    } catch (e) {
      setPending(keepsActionId(e) ? { actionId, key } : null);
      setError(paErrorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const row = (label: string, body: React.ReactNode, hint?: string) => (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 py-1">
      <span className="pt-1 text-caption/[inherit] text-subtle">{label}</span>
      <div className="min-w-0">
        {body}
        {hint && <div className="mt-0.5 text-caption/[inherit] text-subtle">{hint}</div>}
      </div>
    </div>
  );
  const seatText = seat?.sessionId ? t("personal-assistants.card.seat", { name: sessionName(host, seat.sessionId) ?? seat.sessionId, epoch: seat.epoch }) : null;
  return (
    <div className="mb-3 rounded-lg border border-border bg-surface px-3 py-2" data-pa-template-form={initial?.id ?? "new"}>
      <div className="mb-1 text-ui/[inherit] font-medium">{initial ? t("personal-assistants.templates.edit") : t("personal-assistants.templates.new")}</div>
      {row(
        t("personal-assistants.templates.form.task"),
        <Select value={task} onChange={setTask} label={t("personal-assistants.templates.form.task")} options={PA_TASKS.map((k) => ({ value: k, label: t(`personal-assistants.templates.task.${k}` as MessageKey) }))} disabled={busy || !!pending} />,
        t(`personal-assistants.templates.taskHint.${task}` as MessageKey),
      )}
      {row(
        t("personal-assistants.templates.form.project"),
        projects.length ? (
          <Select value={projectId} onChange={setProjectId} label={t("personal-assistants.templates.form.project")} options={projects.map((r) => ({ value: r.projectId, label: projectName(host, r.projectId) }))} disabled={busy || !!pending} />
        ) : (
          <span className="text-caption/[inherit] text-warn">{t("personal-assistants.templates.form.projectNone")}</span>
        ),
      )}
      {row(
        t("personal-assistants.templates.form.rule"),
        <div className="flex flex-wrap items-center gap-2" data-pa-template-rule={kind}>
          <Segmented
            value={kind}
            onChange={setKind}
            label={t("personal-assistants.templates.form.rule")}
            disabled={busy || !!pending}
            options={[
              { value: "daily", label: t("personal-assistants.templates.form.daily") },
              { value: "weekly", label: t("personal-assistants.templates.form.weekly") },
              { value: "interval", label: t("personal-assistants.templates.form.interval") },
            ]}
          />
          {kind === "weekly" && (
            <Select value={weekday} onChange={setWeekday} width="w-24" label={t("personal-assistants.templates.form.weekly")} options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: t(`personal-assistants.templates.weekday.${d}` as MessageKey) }))} disabled={busy || !!pending} />
          )}
          {kind === "interval" ? (
            <span className="flex items-center gap-1">
              <TextInput value={hours} onChange={(v) => setHours(v.replace(/\D/g, "").slice(0, 4))} width="w-16" mono label={t("personal-assistants.templates.form.hours")} disabled={busy || !!pending} />
              <span className="text-caption/[inherit] text-subtle">{t("personal-assistants.templates.form.hours")}</span>
            </span>
          ) : (
            <TextInput value={time} onChange={(v) => setTime(v.slice(0, 5))} width="w-20" mono placeholder="09:00" label={t("personal-assistants.templates.form.timeHint")} disabled={busy || !!pending} />
          )}
        </div>,
        kind === "interval" ? undefined : t("personal-assistants.templates.form.timeHint"),
      )}
      {row(
        t("personal-assistants.templates.form.seat"),
        seatText ? (
          <span className="text-ui/[inherit]" data-pa-template-seat="">{t("personal-assistants.templates.form.seatValue", { seat: seatText })}</span>
        ) : (
          <span className="text-caption/[inherit] text-warn" data-pa-template-no-director="">{t("personal-assistants.templates.form.noDirector")}</span>
        ),
      )}
      <p className="mt-1 text-caption/[inherit] text-muted">{t("personal-assistants.templates.form.confirmNote")}</p>
      {error && <div className="mt-1 text-caption/[inherit] text-danger" role="alert" data-pa-template-error="">{error}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button primary disabled={!ready} title={pending ? t("personal-assistants.templates.form.retryHint") : undefined} onClick={() => void submit()}>
          {pending ? t("personal-assistants.form.retry") : initial ? t("personal-assistants.templates.form.confirmChange") : t("personal-assistants.templates.form.confirm")}
        </Button>
        <Button onClick={onClose} disabled={busy}>{t("personal-assistants.templates.form.close")}</Button>
      </div>
    </div>
  );
}
