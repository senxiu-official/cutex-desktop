// 自己的名字 in 编辑信息… (owner-only, cutex formal-agent-name-rename-v1; lib/agentRename): the name other
// agents use, set apart from 显示名称 above it (only what the owner sees). Built like the dialog's other fields
// (label row, one field-high row, the 徽章 field's [field][buttons] grid) so it reads as one more field, not a
// card: at rest the name sits in a quiet surface row with 改名 at its end; 改名 turns that row into the input in
// place, with 取消 and the same 改名 button, which applies by the in-place armed confirm (medium risk, design
// 013; its hint floats above, over the empty end of the label row). The two short lines under it say what a
// rename does before it is applied (no restart, a running agent gets a quiet note, the old name stays reserved in
// the project and anyone using it gets a note). Refusals show under the field, with 重试 where it may help.
// 改名记录 (label row, right): cutex's permanent log, newest first, 50 per page, on a surface face below.
// Archived (`archived`): the 已归档 tag; renaming works the same (owner 2026-11-05: it stays archived and is
// restored separately under the new name, so a taken old name never makes it unrestorable). An agent without
// an own name (cutex: not_formal_agent) has nothing to rename: only the log (empty: 还没有改过名).
import { useState } from "react";
import { AlertCircle, Check, ChevronDown, History, Loader2 } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { renameErrorKey, FORMAL_NAME_MAX, type FormalRenameError, type FormalRenameRequest, type NameHistoryEvent } from "../../../shared/agentRename";
import { formalNameProblem, holderNames, nameHistory, newRenameRequest, scopeProjectName, sendRename, sessionOf } from "../lib/agentRename";
import { formatDate } from "../lib/dateText";
import { ArmedButton } from "./ArmedButton";
import { InfoTip } from "./settings/Form";
import { btn, btnFace, btnShape } from "./Button";
import { Tag } from "./Tag";

// The dialog's field metrics (AgentInfoDialog FIELD); the rest row keeps them with a transparent edge so the
// switch to the input does not move anything.
const BOX = "min-w-0 rounded-md border px-2.5 py-1.5 text-sm";
const FIELD = `${BOX} w-full border-border bg-background outline-none focus:border-accent aria-[invalid=true]:border-danger`;
const REST = `${BOX} flex items-center border-transparent bg-surface-2/70`;

type Failure = { error: FormalRenameError; request: FormalRenameRequest; name: string };
type HistoryState = { events: NameHistoryEvent[]; next: number | null; loading: boolean; error: string | null; before: number | null };

export function AgentOwnName({ host, sessionId, ownName, revision, archived, onRenamed }: { host: string; sessionId: string; ownName: string; revision: number; archived?: boolean; onRenamed?(name: string): void }) {
  const { t, locale } = useI18n();
  const [current, setCurrent] = useState(ownName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ownName);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<{ oldName: string; newName: string } | null>(null);
  const [history, setHistory] = useState<HistoryState | null>(null);
  const problem = formalNameProblem(draft, current);
  const name = draft.trim();
  // "unchanged" only keeps 改名 grey; the other local problems say why.
  const shownProblem = problem && problem !== "unchanged" ? problem : null;
  // No own name: nothing to rename (cutex not_formal_agent); the block is just the log.
  const renamable = !!current;

  const send = async (request: FormalRenameRequest) => {
    setSending(true);
    setFailure(null);
    try {
      const outcome = await sendRename(host, sessionId, request);
      if (outcome.ok) {
        setCurrent(outcome.newName);
        setDraft(outcome.newName);
        setEditing(false);
        setDone({ oldName: outcome.oldName, newName: outcome.newName });
        onRenamed?.(outcome.newName);
      } else {
        setFailure({ error: outcome.error, request: outcome.request, name: request.name });
      }
    } catch (error) {
      setFailure({ error: { code: "other", message: error instanceof Error ? error.message : String(error), retrySame: false }, request, name: request.name });
    } finally {
      setSending(false);
    }
  };
  const start = () => {
    const live = sessionOf(host, sessionId);
    void send(newRenameRequest({ revision: live?.revision ?? revision }, name));
  };
  // Uncertain (no answer / 503): the very same request. Stale revision: a fresh one on the re-read session.
  const retry = () => (failure?.error.retrySame ? void send(failure.request) : start());
  const retryable = failure && (failure.error.retrySame || failure.error.code === "stale_session_revision");

  const loadHistory = async (before: number | null) => {
    setHistory((h) => ({ events: before === null ? [] : h?.events ?? [], next: h?.next ?? null, loading: true, error: null, before }));
    try {
      const page = await nameHistory(host, sessionId, before);
      setHistory((h) => ({ events: [...(before === null ? [] : h?.events ?? []), ...page.events], next: page.next, loading: false, error: null, before }));
    } catch (error) {
      setHistory((h) => ({ events: h?.events ?? [], next: h?.next ?? null, loading: false, error: error instanceof Error ? error.message : String(error), before }));
    }
  };
  const openEdit = () => { setEditing(true); setDone(null); setFailure(null); setDraft(current); setHistory(null); };
  const closeEdit = () => { setEditing(false); setFailure(null); };

  const errorText = (f: Failure) => {
    const names = holderNames(host, f.error.holderSessionIds);
    return t(renameErrorKey(f.error.code) as MessageKey, { name: f.name, message: f.error.message, holders: names.length ? t("rename.holders", { names: names.join("、") }) : "" });
  };
  const when = (at: string) => {
    const date = new Date(Date.parse(at));
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return formatDate(date, locale, { ...(sameYear ? {} : { year: "numeric" }), month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="mb-3" data-testid="agent-own-name">
      <div className="mb-1.5 flex h-6 items-center gap-1">
        <span className="text-xs text-muted" id="agent-own-name-label">{t("rename.ownName")}</span>
        <InfoTip id="agent-own-name-hint">{t("rename.ownNameHint")}</InfoTip>
        {archived && <Tag className="ml-1" data-testid="agent-own-name-archived">{t("rename.archivedTag")}</Tag>}
        {!editing && (
          <button type="button" aria-expanded={!!history} aria-controls="agent-name-history" onClick={() => (history ? setHistory(null) : void loadHistory(null))}
            className={`ml-auto ${btn({ variant: "ghost", size: "sm" })}`}>
            <History size={12} />{t("rename.history")}<ChevronDown size={12} className={`transition-transform ${history ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {!editing ? (
        // Without an own name: no empty row, just the log.
        renamable && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <div className={REST} aria-labelledby="agent-own-name-label"><span className="min-w-0 truncate">{current}</span></div>
            <button type="button" onClick={openEdit} className={btn()}>{t("rename.change")}</button>
          </div>
        )
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
          <input aria-label={t("rename.inputLabel")} aria-invalid={!!(failure || shownProblem)} aria-describedby="agent-own-name-facts" autoFocus value={draft} maxLength={FORMAL_NAME_MAX * 2} disabled={sending}
            onChange={(e) => { setDraft(e.target.value); setFailure(null); }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); closeEdit(); } }}
            className={FIELD} />
          <button type="button" disabled={sending} onClick={closeEdit} className={btn({ variant: "ghost" })}>{t("dialog.cancel")}</button>
          {sending ? (
            <button type="button" disabled className={btn()}><Loader2 size={12} className="animate-spin" />{t("rename.sending")}</button>
          ) : (
            <ArmedButton shape={btnShape()} idle={btnFace()} testId="agent-own-name-apply" disabled={!!problem} resetKey={name}
              hint={t("rename.confirmHint", { name })} onConfirm={start}>
              {t("rename.change")}
            </ArmedButton>
          )}
        </div>
      )}

      {editing && (shownProblem || failure) && (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-meta text-danger" data-testid="agent-own-name-error">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0">
            {failure ? errorText(failure) : t(`rename.problem.${shownProblem}` as MessageKey)}
            {failure && retryable && <button type="button" onClick={retry} disabled={sending} className="ml-1.5 font-medium underline underline-offset-2 hover:text-foreground">{t("rename.retry")}</button>}
          </span>
        </p>
      )}
      {editing && (
        <ul id="agent-own-name-facts" className="mt-1.5 list-disc space-y-0.5 pl-4 text-caption/[inherit] text-subtle marker:text-subtle">
          <li>{t("rename.factNow")}</li>
          <li>{t("rename.factOld", { old: current })}</li>
        </ul>
      )}
      {!editing && done && (
        <p className="mt-1.5 flex items-center gap-1.5 text-meta text-ok-text" role="status">
          <Check size={13} className="shrink-0" />{t("rename.done", { old: done.oldName, name: done.newName })}
        </p>
      )}

      {!editing && history && (
        <div id="agent-name-history" className="mt-2 max-h-56 overflow-y-auto rounded-md bg-surface-2/70" data-testid="agent-name-history">
          {history.events.length > 0 && (
            <ol className="divide-y divide-border/60">
              {history.events.map((e) => (
                <li key={e.eventId} className="min-w-0 px-2.5 py-1.5">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-ui font-medium">{e.newName}</span>
                    <span className="shrink-0 text-meta text-subtle tabular-nums">{when(e.committedAt)}</span>
                  </div>
                  <div className="truncate text-meta text-subtle">
                    {t("rename.historyFrom", { old: e.oldName })} · {e.scope.kind === "project" ? t("rename.scopeProject", { project: scopeProjectName(host, e.scope.projectId) }) : t("rename.scopeUnassigned")}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {!history.loading && !history.error && !history.events.length && <p className="px-2.5 py-2 text-meta text-subtle">{t("rename.historyEmpty")}</p>}
          {history.loading && <p className="flex items-center gap-1.5 px-2.5 py-2 text-meta text-subtle"><Loader2 size={12} className="animate-spin" />{t("rename.historyLoading")}</p>}
          {history.error && (
            <p className="flex items-center gap-1.5 px-2.5 py-2 text-meta text-danger">
              <AlertCircle size={13} className="shrink-0" /><span className="min-w-0 flex-1">{t("rename.historyFailed", { message: history.error })}</span>
              <button type="button" onClick={() => void loadHistory(history.before)} className={btn({ variant: "ghost", size: "sm" })}>{t("rename.retry")}</button>
            </p>
          )}
          {!history.loading && !history.error && history.next !== null && (
            <div className="border-t border-border/60 p-1">
              <button type="button" onClick={() => void loadHistory(history.next)} className={`w-full ${btn({ variant: "ghost", size: "sm" })}`}>{t("rename.historyMore")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
