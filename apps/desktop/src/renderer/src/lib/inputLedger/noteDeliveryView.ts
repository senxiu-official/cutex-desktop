// The hover / details lines of a note's delivery (lib/inputLedger/noteDelivery): where it is, what it waits for, which
// row blocks it, the last error, and — on the input that started a turn — how many notes it carried. Only on hosts
// with the capabilities; absent fields say nothing (never "read", never stuck by themselves).
import type { InputRecord } from "@cutex-desktop/protocol";
import { useI18n, type MessageKey } from "../../i18n";
import { agentState, featuresOf, useApp } from "../../store";
import { formatAbsolute } from "../time";
import { rowText } from "../queueRow";
import { hasNoteDiagnostics, noteDiagnostics, passiveNotesReport, reportsPreTurnNotes, type NoteDiagnostics, type PassiveNotesReport, type WaitingFor } from "./noteDelivery";

type T = ReturnType<typeof useI18n>["t"];

const at = (iso: string | null) => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? formatAbsolute(ms / 1000) : null;
};

/** The line for one `waitingFor` value. */
export function waitingLine(t: T, waitingFor: WaitingFor | "other" | null, raw?: string | null): string | null {
  if (!waitingFor) return null;
  return waitingFor === "other" ? t("noteDelivery.wait.other", { code: raw ?? "?" }) : t(`noteDelivery.wait.${waitingFor}` as MessageKey);
}

/** The lines of one note's diagnostics; `blocker`: the blocking row in words (else its id). `raw`: the host's waitingFor. */
export function diagnosticLines(t: T, d: NoteDiagnostics, blocker?: string | null, raw?: string | null): string[] {
  const lines: (string | null)[] = [waitingLine(t, d.waitingFor, raw)];
  if (d.stage) {
    const stage = t(`noteDelivery.stage.${d.stage}` as MessageKey);
    const since = at(d.since);
    lines.push(since ? t("noteDelivery.whereSince", { stage, time: since }) : t("noteDelivery.where", { stage }));
  }
  if (d.blockedByInputId) lines.push(t("noteDelivery.blockedBy", { who: blocker || d.blockedByInputId }));
  // Why there is no Retry: the host proved the note is already in the recipient's conversation (a line, no state / button).
  if (d.retryBlocked) lines.push(t("noteDelivery.retryBlocked.timeline"));
  if (d.projection && d.projection.attempts > 0) lines.push(t("noteDelivery.projectionFailed", { n: d.projection.attempts, message: d.projection.message ?? d.projection.code }));
  // The last try is shown whether or not it failed (its kind when the host names a known one); the error on its own line.
  const when = at(d.lastAttemptAt);
  if (when) lines.push(d.lastAttemptKind ? t("noteDelivery.lastAttemptKind", { kind: t(`noteDelivery.attempt.${d.lastAttemptKind}` as MessageKey), time: when }) : t("noteDelivery.lastAttempt", { time: when }));
  if (d.lastError) lines.push(t("noteDelivery.lastError", { error: d.lastError }));
  return lines.filter((l): l is string => !!l);
}

/** The host's whole-report errors, shortened for a tip / notice (first three, each cut at 160 characters). */
export function reportErrorsText(errors: readonly string[]): string {
  const cut = (e: string) => (e.length > 160 ? `${e.slice(0, 159)}…` : e);
  return errors.slice(0, 3).map(cut).join("; ") + (errors.length > 3 ? ` (+${errors.length - 3})` : "");
}

/** The lines of a turn's note report (a turn start or 现在读取): carried, not confirmed carried, and errors — a report may
 *  hold only errors. None of it says a note was read. */
export function reportLines(t: T, report: PassiveNotesReport): string[] {
  const lines: string[] = [];
  if (report.admitted.length) lines.push(t("noteDelivery.carried", { n: report.admitted.length }));
  if (report.skipped.length) lines.push(t("noteDelivery.skipped", { n: report.skipped.length }));
  if (report.errors.length) lines.push(t("noteDelivery.reportErrors", { errors: reportErrorsText(report.errors) }));
  return lines;
}

/** A blocking row as words: its sender and first words, else its id. */
function who(blocker: InputRecord | undefined, id: string): string {
  if (!blocker) return id;
  const text = blocker.preview ? rowText(blocker.preview) : "";
  const short = text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return [blocker.sender?.name, short].filter(Boolean).join(" · ") || id;
}

/**
 * The delivery lines of `record` on this host (empty without the capability or the fields). Hover tips and the
 * details panel show them under the state's own meaning.
 */
export function useNoteDeliveryLines(record: InputRecord, host: string, sessionId: string): string[] {
  const { t } = useI18n();
  const diagnosticsOn = useApp((s) => hasNoteDiagnostics(featuresOf(s, host)));
  const reportOn = useApp((s) => reportsPreTurnNotes(featuresOf(s, host)));
  const d = diagnosticsOn ? noteDiagnostics(record) : null;
  const blocker = useApp((s) => (d?.blockedByInputId ? agentState(s.inputs, host, sessionId)?.records.get(d.blockedByInputId) : undefined));
  const lines: (string | null)[] = [];
  if (d) {
    const raw = (record.details?.deliveryDiagnostics as { waitingFor?: unknown } | undefined)?.waitingFor;
    lines.push(...diagnosticLines(t, d, d.blockedByInputId ? who(blocker, d.blockedByInputId) : null, typeof raw === "string" ? raw : null));
  }
  const report = reportOn ? passiveNotesReport(record.details?.passiveNotes) : null;
  if (report) lines.push(...reportLines(t, report));
  return lines.filter((l): l is string => !!l);
}
