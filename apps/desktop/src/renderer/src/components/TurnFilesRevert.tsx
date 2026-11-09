// 撤销文件改动 in the turn summary's expanded card (Codex agents, lib/filesRevert): the footer's
// 撤销这些改动 button, then cutex's dry-run plan in place — what happens to each file, why a file blocks,
// later turns that touched the same files — with 撤销 N 个文件 / 取消. Files only: history stays.
import { AlertTriangle, Check, CircleSlash, Loader2, Undo2 } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import type { FilesRevertFile, FilesRevertPlan } from "../../../shared/filesRevert";
import { applyFilesRevert, canApply, closeFilesRevert, filesRevertKey, previewFilesRevert, useFilesRevert } from "../lib/filesRevert";
import { btn } from "./Button";

const ACTIONS = new Set(["restore", "delete", "recreate", "moveBack"]);
const STATUSES = new Set(["ok", "alreadyReverted", "conflict", "missing", "outsideWorkspace", "unsupported"]);
/** cutex codes with their own sentence; others show cutex's message. */
const ERRORS = new Set(["revert_conflict", "nothing_to_revert", "session_busy", "turn_in_progress", "turn_history_too_large", "turn_not_found", "thread_unbound", "history_changed", "revert_rolled_back", "revert_partial", "codex_app_server_unavailable", "native_history_unavailable", "unreachable"]);

/** The footer button (expanded card only). */
export function FilesRevertButton({ hostId, sessionId, turnId }: { hostId: string; sessionId: string; turnId: string }) {
  const { t } = useI18n();
  const open = useFilesRevert((s) => !!s.byKey[filesRevertKey(hostId, sessionId, turnId)]);
  if (open) return null;
  return (
    <button type="button" data-testid="files-revert-start" onClick={() => void previewFilesRevert(hostId, sessionId, turnId)} title={t("conversation.filesRevert.startHint")} className={btn({ variant: "ghost", size: "sm" })}>
      <Undo2 size={12} />
      {t("conversation.filesRevert.start")}
    </button>
  );
}

function FileRow({ file }: { file: FilesRevertFile }) {
  const { t } = useI18n();
  const shown = file.relativePath ?? file.path;
  const ok = file.status === "ok";
  const blocks = !ok && file.status !== "alreadyReverted";
  const action = ACTIONS.has(file.action) ? t(`conversation.filesRevert.action.${file.action}` as MessageKey) : file.action;
  const status = STATUSES.has(file.status) ? t(`conversation.filesRevert.status.${file.status}` as MessageKey) : file.status;
  return (
    <li className="flex h-6 min-w-0 items-center gap-2" data-files-revert-file={file.status}>
      {ok ? <Undo2 size={12} className="shrink-0 text-subtle" /> : blocks ? <AlertTriangle size={12} className="shrink-0 text-warn-text" /> : <Check size={12} className="shrink-0 text-subtle" />}
      <span className="min-w-0 flex-1 truncate text-foreground" title={file.path}>{shown}</span>
      {ok && <span className="shrink-0 text-subtle">{action}</span>}
      {!ok && (
        <span className={`shrink-0 ${blocks ? "text-warn-text" : "text-subtle"}`} title={file.reason ?? undefined}>
          {status}
        </span>
      )}
    </li>
  );
}

function Warnings({ plan }: { plan: FilesRevertPlan }) {
  const { t } = useI18n();
  const lines: string[] = [];
  for (const w of plan.warnings) {
    if (w.kind === "laterTurnsTouchedFiles") {
      const names = (w.paths ?? []).map((p) => p.split(/[\\/]/).pop() ?? p);
      lines.push(t("conversation.filesRevert.warn.later", { n: w.turnIds?.length ?? 0, files: names.slice(0, 3).join(", ") + (names.length > 3 ? " …" : "") }));
    } else if (w.kind === "laterTurnsNotFullyScanned") {
      lines.push(t("conversation.filesRevert.warn.partialScan"));
    }
  }
  if (plan.recovered.length) lines.push(t("conversation.filesRevert.warn.recovered", { n: plan.recovered.length }));
  if (!lines.length) return null;
  return (
    <>
      {lines.map((line) => (
        <p key={line} className="flex items-start gap-1.5 text-warn-text">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{line}</span>
        </p>
      ))}
    </>
  );
}

/** The plan / progress / outcome under the file list while the revert is open. */
export function FilesRevertPanel({ hostId, sessionId, turnId }: { hostId: string; sessionId: string; turnId: string }) {
  const { t } = useI18n();
  const state = useFilesRevert((s) => s.byKey[filesRevertKey(hostId, sessionId, turnId)]);
  if (!state) return null;
  const close = () => closeFilesRevert(hostId, sessionId, turnId);
  const closeButton = (label: MessageKey = "conversation.filesRevert.close") => (
    <button type="button" onClick={close} className={btn({ variant: "ghost", size: "sm" })}>
      {t(label)}
    </button>
  );
  const frame = (children: React.ReactNode) => (
    <div className="mx-2 mt-1 space-y-1.5 border-t border-border pt-1.5 text-xs" data-testid="files-revert-panel" data-phase={state.phase}>
      {children}
    </div>
  );
  if (state.phase === "previewing") {
    return frame(
      <p className="flex items-center gap-1.5 text-muted">
        <Loader2 size={12} className="animate-spin" />
        {t("conversation.filesRevert.checking")}
      </p>,
    );
  }
  if (state.phase === "error") {
    const known = ERRORS.has(state.code);
    return frame(
      <>
        <p className="flex items-start gap-1.5 text-danger-text" role="alert">
          <CircleSlash size={12} className="mt-0.5 shrink-0" />
          <span>{known ? t(`conversation.filesRevert.error.${state.code}` as MessageKey) : t("conversation.filesRevert.error.other", { message: state.message })}</span>
        </p>
        {state.journalPath && <p className="break-all text-subtle" title={state.journalPath}>{t("conversation.filesRevert.journal", { path: state.journalPath })}</p>}
        {state.plan && state.plan.files.length > 0 && (
          <ul>
            {state.plan.files.map((f) => <FileRow key={f.path} file={f} />)}
          </ul>
        )}
        <div className="flex justify-end gap-1">
          {state.code !== "revert_partial" && (
            <button type="button" onClick={() => void previewFilesRevert(hostId, sessionId, turnId)} className={btn({ variant: "ghost", size: "sm" })}>
              {t("conversation.filesRevert.retry")}
            </button>
          )}
          {closeButton()}
        </div>
      </>,
    );
  }
  const plan = state.plan;
  if (state.phase === "done") {
    const n = plan.files.filter((f) => f.status === "ok").length;
    return frame(
      <>
        <p className="flex items-center gap-1.5 text-ok-text" role="status">
          <Check size={12} className="shrink-0" />
          {t("conversation.filesRevert.done", { n })}
        </p>
        <p className="text-subtle">{t("conversation.filesRevert.doneNote")}</p>
        <div className="flex justify-end">{closeButton()}</div>
      </>,
    );
  }
  const applying = state.phase === "applying";
  const runnable = canApply(plan);
  const n = plan.files.filter((f) => f.status === "ok").length;
  const blocked = plan.files.some((f) => f.status !== "ok" && f.status !== "alreadyReverted");
  return frame(
    <>
      {state.phase === "preview" && state.changed && <p className="text-warn-text">{t("conversation.filesRevert.changed")}</p>}
      <p className="text-muted">{runnable ? t("conversation.filesRevert.willRevert", { n }) : blocked ? t("conversation.filesRevert.blocked") : t("conversation.filesRevert.nothing")}</p>
      <ul>
        {plan.files.map((f) => <FileRow key={f.path} file={f} />)}
      </ul>
      <Warnings plan={plan} />
      <p className="text-subtle">{t("conversation.filesRevert.scope")}</p>
      <div className="flex justify-end gap-1">
        {runnable && (
          <button type="button" data-testid="files-revert-apply" disabled={applying} onClick={() => void applyFilesRevert(hostId, sessionId, turnId)} className={btn({ size: "sm", danger: true })}>
            {applying ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
            {applying ? t("conversation.filesRevert.applying") : t("conversation.filesRevert.apply", { n })}
          </button>
        )}
        {!applying && closeButton(runnable ? "conversation.filesRevert.cancel" : "conversation.filesRevert.close")}
      </div>
    </>,
  );
}
