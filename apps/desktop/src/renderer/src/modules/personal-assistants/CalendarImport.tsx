// 今日's calendar controls (cutex r296 read-only calendar snapshot): 导入日历 / 替换日历 opens a panel where the owner
// picks an .ics export or pastes a JSON snapshot (lib/calendarSnapshot), names the source and sees what will be sent —
// the event count and span, what was left out and why, the size — checked against cutex's limits before it is sent
// (1,000 events, byte limits per text, 1 MiB per import). 清除日历 is click-twice. Writes go at the revision shown; a lost
// reply is retried with the same action id; a conflict reads the calendar again.
import { useMemo, useRef, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { ArmedButton } from "../../components/ArmedButton";
import { btnFace, btnShape } from "../../components/Button";
import { Button, TextArea, TextInput } from "../../components/settings/Form";
import {
  PA_CALENDAR_BODY_MAX, PA_CALENDAR_EVENTS_MAX, paCalendarProblem, utf8Bytes,
  type PaCalendarInfo, type PaCalendarProblem, type PaCalendarSnapshot,
} from "../../../../shared/personalAssistants";
import { parseCalendarText, type ParsedCalendar } from "../../lib/calendarSnapshot";
import { hostApi } from "../../lib/hostLists";
import { keepsActionId, newActionId, paErrorCode, STALE_CODES } from "../../lib/personalAssistants";
import { formatAbsolute } from "../../lib/time";
import { paErrorText } from "./paHooks";

type Note = { tone: "ok" | "warn" | "error"; text: string };

/** What the import would send, and why it cannot (null when it fits). */
function check(snapshot: PaCalendarSnapshot | null, revision: number): { problem: PaCalendarProblem | { code: "parse" } | null; bytes: number } {
  if (!snapshot) return { problem: { code: "parse" }, bytes: 0 };
  const problem = paCalendarProblem(snapshot);
  // The body as main sends it (an action id of the longest kind this app makes).
  const bytes = utf8Bytes(JSON.stringify({ actionId: newActionId("calendar"), expectedRevision: revision, snapshot }));
  return { problem: problem ?? (bytes > PA_CALENDAR_BODY_MAX ? { code: "tooLarge" } : null), bytes };
}

export function CalendarImport({ hostId, assistantId, info, readOnly, onChanged }: { hostId: string; assistantId: string; info: PaCalendarInfo; readOnly: boolean; onChanged(): void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [pending, setPending] = useState<{ actionId: string; key: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed: ParsedCalendar | null = useMemo(() => (text.trim() ? parseCalendarText(text) : null), [text]);
  // Observed when read (fixed while the text stays, so a retry sends the same body).
  const readAt = useMemo(() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = source.trim() || parsed?.source || fileName?.replace(/\.[^.]+$/, "") || "";
  const snapshot: PaCalendarSnapshot | null = parsed ? { source: name, observedAt: parsed.observedAt ?? readAt, events: parsed.events } : null;
  const { problem, bytes } = check(snapshot, info.revision);
  const ready = !!snapshot && !problem && !readOnly && !busy;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setText(await file.text());
      setFileName(file.name);
      setNote(null);
    } catch (e) {
      setNote({ tone: "error", text: t("personal-assistants.calendar.readFailed", { error: e instanceof Error ? e.message : String(e) }) });
    }
  };
  const write = async (run: (actionId: string) => Promise<unknown>, kind: string, key: string, ok: string) => {
    const actionId = pending?.key === key ? pending.actionId : newActionId(kind);
    setBusy(true);
    setNote(null);
    try {
      await run(actionId);
      setPending(null);
      setNote({ tone: "ok", text: ok });
      return true;
    } catch (e) {
      setPending(keepsActionId(e) ? { actionId, key } : null);
      if (STALE_CODES.has(paErrorCode(e) ?? "")) setNote({ tone: "warn", text: t("personal-assistants.card.stale") });
      else setNote({ tone: "error", text: paErrorText(e, t) });
      return false;
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  const submit = async () => {
    if (!snapshot || problem) return;
    const done = await write((actionId) => hostApi(hostId).paCalendarImport(assistantId, { actionId, expectedRevision: info.revision, snapshot }), "calendar", `import\n${info.revision}\n${JSON.stringify(snapshot)}`, t("personal-assistants.calendar.done", { n: snapshot.events.length }));
    if (done) {
      setOpen(false);
      setText("");
      setFileName(null);
    }
  };
  const clear = () => void write((actionId) => hostApi(hostId).paCalendarClear(assistantId, { actionId, expectedRevision: info.revision }), "calendar", `clear\n${info.revision}`, t("personal-assistants.calendar.cleared"));
  const span = snapshot?.events.length ? `${day(snapshot.events[0]!.startsAt)}` : "";
  const spanEnd = snapshot?.events.length ? day(snapshot.events.reduce((m, e) => (e.endsAt > m ? e.endsAt : m), snapshot.events[0]!.endsAt)) : "";
  const problemText = problem
    ? t(`personal-assistants.calendar.problem.${problem.code}` as MessageKey, { n: "index" in problem && problem.index !== undefined ? problem.index + 1 : 0 })
    : null;
  return (
    <div data-pa-calendar-import="">
      {!readOnly && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Button onClick={() => setOpen(!open)} disabled={busy}>{t(info.status === "ready" ? "personal-assistants.calendar.replace" : "personal-assistants.calendar.import")}</Button>
          {info.status === "ready" && (
            <ArmedButton shape={btnShape()} idle={btnFace({ variant: "secondary" })} hint={t("personal-assistants.calendar.clearHint")} disabled={busy} onConfirm={clear} testId="pa-calendar-clear">
              {t("personal-assistants.calendar.clear")}
            </ArmedButton>
          )}
        </div>
      )}
      {note && <div className={`mt-1 text-caption/[inherit] ${note.tone === "ok" ? "text-subtle" : note.tone === "warn" ? "text-warn" : "text-danger"}`} role="status" data-pa-calendar-note={note.tone}>{note.text}</div>}
      {open && !readOnly && (
        <div className="mt-2 rounded-lg border border-border bg-surface px-3 py-2" data-pa-calendar-panel="">
          <div className="text-ui/[inherit] font-medium">{t("personal-assistants.calendar.title")}</div>
          <p className="mt-0.5 text-caption/[inherit] text-muted">{t("personal-assistants.calendar.hint")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".ics,.json,text/calendar,application/json" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} data-pa-calendar-file="" />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>{t("personal-assistants.calendar.pick")}</Button>
            {fileName && <span className="min-w-0 truncate text-caption/[inherit] text-subtle">{fileName}</span>}
          </div>
          <div className="mt-2">
            <TextArea value={text} onChange={(v) => (setText(v), setFileName(null))} rows={4} mono width="w-full" placeholder={t("personal-assistants.calendar.paste")} label={t("personal-assistants.calendar.paste")} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-caption/[inherit] text-subtle">{t("personal-assistants.calendar.source")}</span>
            <TextInput value={source} onChange={setSource} placeholder={parsed?.source ?? fileName?.replace(/\.[^.]+$/, "") ?? ""} label={t("personal-assistants.calendar.source")} />
          </div>
          <div className="mt-0.5 text-caption/[inherit] text-subtle">{t("personal-assistants.calendar.sourceHint")}</div>
          {text.trim() && (
            <div className="mt-2 flex flex-col gap-0.5 text-caption/[inherit]" data-pa-calendar-preview="">
              {snapshot && snapshot.events.length > 0 && <span>{t("personal-assistants.calendar.preview", { n: snapshot.events.length, from: span, to: spanEnd, kb: Math.max(1, Math.round(bytes / 1024)) })}</span>}
              {snapshot && snapshot.events.length === 0 && <span className="text-subtle">{t("personal-assistants.calendar.previewEmpty")}</span>}
              {parsed && parsed.skippedPast > 0 && <span className="text-subtle">{t("personal-assistants.calendar.skippedPast", { n: parsed.skippedPast })}</span>}
              {parsed && parsed.skippedRecurring > 0 && <span className="text-warn">{t("personal-assistants.calendar.skippedRecurring", { n: parsed.skippedRecurring })}</span>}
              {parsed && parsed.skippedZone > 0 && <span className="text-warn">{t("personal-assistants.calendar.skippedZone", { n: parsed.skippedZone })}</span>}
              {parsed?.truncated && <span className="text-warn">{t("personal-assistants.calendar.truncated", { max: PA_CALENDAR_EVENTS_MAX })}</span>}
              {problemText && <span className="text-danger" role="alert" data-pa-calendar-problem={problem!.code}>{problemText}</span>}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button primary disabled={!ready} onClick={() => void submit()}>{t("personal-assistants.calendar.confirm")}</Button>
            <Button onClick={() => setOpen(false)}>{t("personal-assistants.calendar.close")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function day(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatAbsolute(Math.floor(ms / 1000)) : iso;
}
