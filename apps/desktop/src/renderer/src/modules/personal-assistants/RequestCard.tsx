// The confirmation card of one assistant request (plan 「桌面接入规格」 4–5): assistant, source (the assistant's own
// words, shown as text), project, the Director and term, what it asks for, constraints and versions. 发给主管 sends
// exactly what is shown (both revisions and the seat); 取消请求 is a click-twice button. A changed seat says who it
// was and who it is now; no Director disables sending. While the card is open and the request waits for the owner it
// is read again every few seconds; a refusal because something changed reads it again and asks to check.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { useOwnerWindow } from "../../lib/ownerContext";
import { ArmedButton } from "../../components/ArmedButton";
import { btnFace, btnShape } from "../../components/Button";
import { Button } from "../../components/settings/Form";
import { Tag } from "../../components/Tag";
import type { PaAssistant, PaRequest, PaRequestDetail, PaSeat } from "../../../../shared/personalAssistants";
import { hostApi } from "../../lib/hostLists";
import { cancellable, confirmable, KNOWN_REQUEST_STATES, paErrorCode, STALE_CODES } from "../../lib/personalAssistants";
import { cancelRequest, confirmRequest, refreshAssistant } from "../../lib/personalAssistantStore";
import { formatAbsolute } from "../../lib/time";
import { paErrorText, projectName, sessionName, type PaHost } from "./paHooks";

/** Re-read interval of an open card waiting for the owner. */
const CARD_POLL_MS = 5_000;

export function RequestCard({ hostId, assistant, request, host, readOnly }: { hostId: string; assistant: PaAssistant; request: PaRequest; host: PaHost | undefined; readOnly: boolean }) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<PaRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const win = useOwnerWindow();
  const load = useCallback(async () => {
    try {
      setDetail(await hostApi(hostId).paRequest(assistant.id, request.id));
      setError(null);
    } catch (e) {
      setError(paErrorText(e, t));
    }
  }, [hostId, assistant.id, request.id, t]);
  const waiting = (detail?.request.state ?? request.state) === "awaitingOwner";
  useEffect(() => {
    void load();
    if (!waiting) return;
    const timer = setInterval(() => win.document.visibilityState === "visible" && void load(), CARD_POLL_MS);
    return () => clearInterval(timer);
  }, [load, waiting, request.revision, win]);
  const seat = (s: PaSeat | null) => (s?.sessionId ? t("personal-assistants.card.seat", { name: sessionName(host, s.sessionId) ?? s.sessionId, epoch: s.epoch }) : t("personal-assistants.card.vacant"));
  const r = detail?.request ?? request;
  const current = detail?.currentDirector ?? null;
  const seatChanged = !!detail && JSON.stringify(current) !== JSON.stringify(r.director);
  const act = async (run: () => Promise<PaRequest>, ok: string) => {
    setBusy(true);
    setNote(null);
    try {
      await run();
      setNote({ tone: "ok", text: ok });
      await Promise.all([load(), refreshAssistant(hostId, assistant.id).catch(() => {})]);
    } catch (e) {
      if (STALE_CODES.has(paErrorCode(e) ?? "")) {
        await load();
        setNote({ tone: "warn", text: t("personal-assistants.card.stale") });
      } else setNote({ tone: "error", text: paErrorText(e, t) });
    } finally {
      setBusy(false);
    }
  };
  const send = () => {
    if (!detail || !current?.sessionId) return;
    void act(
      () => confirmRequest(hostId, assistant.id, r.id, { expectedRevision: detail.request.revision, expectedAssistantRevision: detail.currentAssistantRevision, director: current }),
      t("personal-assistants.card.sent", { name: sessionName(host, current.sessionId) ?? current.sessionId }),
    );
  };
  const cancel = () => void act(() => cancelRequest(hostId, assistant.id, r.id, { expectedRevision: r.revision }), t("personal-assistants.state.cancelled"));
  const field = (label: string, value: ReactNode, attr?: string) => (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 py-0.5" data-pa-card-field={attr}>
      <dt className="text-caption/[inherit] text-subtle">{label}</dt>
      <dd className="min-w-0 text-ui/[inherit] break-words whitespace-pre-wrap">{value}</dd>
    </div>
  );
  return (
    <div className="mt-1 mb-2 rounded-lg border border-border bg-surface px-3 py-2" data-pa-request-card={r.id}>
      {error && <div className="mb-1 text-caption/[inherit] text-danger" role="alert">{error}</div>}
      {!detail && !error && <div className="text-caption/[inherit] text-subtle" role="status">{t("personal-assistants.card.loading")}</div>}
      <dl>
        {field(t("personal-assistants.card.assistant"), assistant.config.name)}
        {field(t("personal-assistants.card.source"), r.sourceRef || "—", "source")}
        {field(t("personal-assistants.card.project"), `${projectName(host, r.projectId)}${host ? ` · ${host.label}` : ""}`, "project")}
        {field(t("personal-assistants.card.director"), detail ? seat(current) : seat(r.director), "director")}
        {field(t("personal-assistants.card.outcome"), r.outcome, "outcome")}
        {r.constraints && field(t("personal-assistants.card.constraints"), r.constraints, "constraints")}
        {r.detail && field(t("personal-assistants.card.detail"), r.detail, "detail")}
      </dl>
      {detail?.needsReview && confirmable(r) && <div className="mt-1 text-caption/[inherit] text-warn" data-pa-needs-review="">{t("personal-assistants.card.needsReview")}</div>}
      {seatChanged && confirmable(r) && current?.sessionId && (
        <div className="text-caption/[inherit] text-warn" data-pa-seat-changed="">{t("personal-assistants.card.seatChanged", { before: seat(r.director), after: seat(current) })}</div>
      )}
      {detail && confirmable(r) && !current?.sessionId && (
        <div className="mt-1 text-caption/[inherit] text-warn" data-pa-no-director="">{detail.projectIssue ? t("personal-assistants.card.projectIssue", { issue: detail.projectIssue }) : t("personal-assistants.card.noDirector")}</div>
      )}
      {note && <div className={`mt-1 text-caption/[inherit] ${note.tone === "ok" ? "text-subtle" : note.tone === "warn" ? "text-warn" : "text-danger"}`} role="status" data-pa-card-note={note.tone}>{note.text}</div>}
      {(confirmable(r) || cancellable(r)) && !readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {confirmable(r) && (
            <Button primary disabled={busy || !detail || !current?.sessionId} onClick={send}>
              {t("personal-assistants.card.send")}
            </Button>
          )}
          {cancellable(r) && (
            <ArmedButton shape={btnShape()} idle={btnFace({ variant: "secondary" })} hint={t("personal-assistants.card.cancelHint")} disabled={busy} onConfirm={cancel} testId="pa-cancel-request">
              {t("personal-assistants.card.cancel")}
            </ArmedButton>
          )}
        </div>
      )}
      <div className="mt-1 text-caption/[inherit] text-subtle" title={r.updatedAt}>{t("personal-assistants.card.updated", { at: atText(r.updatedAt) })}</div>
    </div>
  );
}

/** The request's state as a tag (an unknown state as its own text). */
export function RequestStateTag({ state }: { state: string }) {
  const { t } = useI18n();
  const tone = state === "awaitingOwner" ? "attention" : state === "completed" ? "ok" : state === "declined" ? "danger" : state === "cancelled" ? "neutral" : "accent";
  return (
    <Tag tone={tone} data-pa-state={state}>
      {KNOWN_REQUEST_STATES.includes(state) ? t(`personal-assistants.state.${state}` as MessageKey) : state}
    </Tag>
  );
}

function atText(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatAbsolute(Math.floor(ms / 1000)) : iso;
}
