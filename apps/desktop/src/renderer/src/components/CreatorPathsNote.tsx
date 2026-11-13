// The conversation's start line when cutex refused a child agent whose folders changed since it was created
// (shared/creatorPaths, 409 creator_paths_changed): says so in plain words and, for the owner on a host with
// session-path-reapproval, offers 重新批准文件夹 — medium risk, so the armed in-place confirm (ArmedButton), no
// dialog — which approves the current folders and starts the agent again. Older hosts get the CLI command.
import { useState } from "react";
import { reapproveFailure, reapprovePathsCommand, type ReapproveErrorCode } from "../../../shared/creatorPaths";
import { useI18n, type MessageKey } from "../i18n";
import { useApp } from "../store";
import { ArmedButton } from "./ArmedButton";

export function CreatorPathsNote({ sessionId, hostId, canReapprove }: { sessionId: string; hostId: string; canReapprove: boolean }) {
  const { t } = useI18n();
  const reapprove = useApp((s) => s.reapprovePathsAndStart);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<ReapproveErrorCode | null>(null);
  const command = reapprovePathsCommand(sessionId);
  return (
    <div data-creator-paths={canReapprove ? "reapprove" : "cli"} role="alert" className="side-col px-6 pb-1 text-xs">
      <p className="text-warn">
        {t("creatorPaths.changed")}
        {canReapprove && (
          <span className="ml-2 inline-flex">
            <ArmedButton
              shape="rounded-md px-2 py-0.5 text-xs"
              idle="text-accent hover:bg-surface-2"
              hint={t("creatorPaths.confirm")}
              disabled={busy}
              testId="creator-paths-reapprove"
              // Armed for this agent only: another conversation in the same pane never inherits the second click.
              resetKey={`${hostId}/${sessionId}`}
              onConfirm={() => {
                setBusy(true);
                setFailed(null);
                void reapprove(sessionId, hostId)
                  .catch((error: unknown) => setFailed(reapproveFailure(error) ?? "failed"))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? t("creatorPaths.working") : t("creatorPaths.reapprove")}
            </ArmedButton>
          </span>
        )}
      </p>
      {!canReapprove && (
        <p className="mt-0.5 text-subtle">
          {t("creatorPaths.cliHint")} <code className="rounded bg-surface-2 px-1 font-mono select-all">{command}</code>
        </p>
      )}
      {failed && <p className="mt-0.5 text-danger">{t(`creatorPaths.error.${failed}` as MessageKey)}</p>}
    </div>
  );
}
