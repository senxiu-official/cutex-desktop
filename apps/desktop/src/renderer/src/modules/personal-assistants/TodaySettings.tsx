// An assistant's 设置 for 今日 (owner 2026-11-27): 默认助理 (the title-bar button opens the default one; the first one
// created is it, any other can be made it here — this device for now) and 简报时间 (off by default; one or more
// times a day, the owner's choice; cutex phase 1, ./phase1Contract).
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { Tag } from "../../components/Tag";
import { Button, Section, SettingRow } from "../../components/settings/Form";
import type { PaView } from "../../../../shared/personalAssistants";
import { localTimeZone } from "../../lib/dateText";
import { newActionId, paErrorCode, STALE_CODES } from "../../lib/personalAssistants";
import { setDefaultAssistant, useDefaultAssistantRef } from "./defaultAssistant";
import { phase1 } from "./phase1Api";
import type { PaBriefView } from "./phase1Contract";
import { paErrorText, type PaHost } from "./paHooks";
import { allAssistants } from "./todayModel";
import { usePa } from "../../lib/personalAssistantStore";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function TodaySettingsCard({ hostId, view, host, readOnly }: { hostId: string; view: PaView; host: PaHost | undefined; readOnly: boolean }) {
  const { t } = useI18n();
  const a = view.assistant;
  const stored = useDefaultAssistantRef();
  // The default when none is stored: the first assistant (the title-bar button opens it).
  const first = usePa((s) => {
    const f = allAssistants(s.byHost)[0];
    return f ? `${f.hostId}\n${f.assistant.id}` : "";
  });
  const isDefault = stored ? stored.hostId === hostId && stored.assistantId === a.id : first === `${hostId}\n${a.id}`;
  return (
    <div data-pa-today-settings="">
      <Section title={t("personal-assistants.todayView.title")}>
        <SettingRow agents="none" source="local" label={t("personal-assistants.default.label")} hint={t("personal-assistants.default.hint")}>
          {isDefault ? (
            <Tag tone="accent" data-pa-default="on">{t("personal-assistants.default.tag")}</Tag>
          ) : (
            <Button onClick={() => setDefaultAssistant({ hostId, assistantId: a.id })}>{t("personal-assistants.default.set")}</Button>
          )}
        </SettingRow>
        <BriefTimesRow hostId={hostId} view={view} host={host} readOnly={readOnly} />
      </Section>
    </div>
  );
}

function BriefTimesRow({ hostId, view, host, readOnly }: { hostId: string; view: PaView; host: PaHost | undefined; readOnly: boolean }) {
  const { t } = useI18n();
  const a = view.assistant;
  const [brief, setBrief] = useState<PaBriefView | null | undefined>(undefined);
  const [times, setTimes] = useState<string[]>([]);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const online = !!host?.online;
  const load = () =>
    phase1.brief(hostId, host?.featureSet, a.id).then(
      (b) => (setBrief(b), setTimes(b?.times ?? [])),
      (e: unknown) => (setBrief(null), setNote({ tone: "error", text: paErrorText(e, t) })),
    );
  useEffect(() => {
    if (online) void load();
  }, [hostId, a.id, online, host?.featureSet]); // eslint-disable-line react-hooks/exhaustive-deps -- read on open
  const label = t("personal-assistants.brief.label");
  if (!brief) {
    return (
      <SettingRow agents="none" source="host" label={label}>
        <span className="text-ui/[inherit] text-subtle" data-pa-brief-times="unsupported">{brief === undefined && online ? t("personal-assistants.rail.loading") : note?.text ?? t("personal-assistants.todayView.briefUnsupported")}</span>
      </SettingRow>
    );
  }
  const changed = times.join() !== brief.times.join();
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const next = await phase1.saveBriefSchedule(hostId, a.id, { actionId: newActionId("brief"), expectedRevision: brief.revision, times: [...times].sort(), timezone: brief.timezone ?? localTimeZone() });
      setBrief(next);
      setTimes(next.times);
      setNote({ tone: "ok", text: t("personal-assistants.form.saved") });
    } catch (e) {
      if (STALE_CODES.has(paErrorCode(e) ?? "")) {
        await load();
        setNote({ tone: "warn", text: t("personal-assistants.form.stale") });
      } else setNote({ tone: "error", text: paErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    if (!TIME.test(adding) || times.includes(adding)) return;
    setTimes([...times, adding].sort());
    setAdding("");
  };
  const off = readOnly || busy;
  return (
    <SettingRow agents="none" source="host" label={label} hint={t("personal-assistants.brief.hint")}>
      <div className="flex flex-col items-end gap-1.5" data-pa-brief-times={times.length ? times.join(",") : "off"}>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {times.length === 0 && <span className="text-ui/[inherit] text-subtle">{t("personal-assistants.brief.off")}</span>}
          {times.map((x) => (
            <span key={x} className="flex items-center gap-0.5 rounded-md bg-surface-2 py-0.5 pr-0.5 pl-1.5 font-mono text-caption/[inherit]">
              {x}
              <button type="button" className="press flex size-5 items-center justify-center rounded-sm text-subtle hover:text-foreground disabled:opacity-50" disabled={off} aria-label={t("personal-assistants.brief.remove", { time: x })} onClick={() => setTimes(times.filter((y) => y !== x))}>
                <X size={11} />
              </button>
            </span>
          ))}
          <input type="time" value={adding} disabled={off} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} className="h-7 rounded-md border border-border bg-surface px-1.5 text-ui/[inherit]" aria-label={t("personal-assistants.brief.addTime")} />
          <button type="button" className="press flex h-7 items-center gap-0.5 rounded-md px-1.5 text-ui/[inherit] text-accent disabled:text-subtle" disabled={off || !TIME.test(adding) || times.includes(adding)} onClick={add} data-pa-brief-add="">
            <Plus size={12} aria-hidden />
            {t("personal-assistants.brief.add")}
          </button>
          <Button primary disabled={off || !changed} onClick={() => void save()}>{t("personal-assistants.form.save")}</Button>
        </div>
        {note && <div className={`text-caption/[inherit] ${note.tone === "ok" ? "text-subtle" : note.tone === "warn" ? "text-warn" : "text-danger"}`} role="status">{note.text}</div>}
      </div>
    </SettingRow>
  );
}
