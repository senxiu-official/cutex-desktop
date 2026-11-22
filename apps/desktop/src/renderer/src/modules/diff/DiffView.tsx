// The diff card's viewer (diff.view): a git working-tree diff of the selected agent's workspace, or
// one turn's changes to a file (text from the timeline, memory only), or a caller's unified diff (`text`, v1.7).
import { LocateFixed } from "lucide-react";
import { revealHostInTree, revealInTree } from "../../lib/sideOpen";
import { useEffect, useRef, useState } from "react";
import { ReadIssueLine } from "../../components/ReadIssueLine";
import { readIssue, retryDelay, type ReadIssue } from "../../lib/transientError";
import { UnifiedDiff } from "../../components/UnifiedDiff";
import { useI18n } from "../../i18n";
import { useSelectedWorkspace } from "../../lib/workspaceView";
import { selectedFeatures, useApp } from "../../store";
import type { SideBodyProps } from "../slots";
import { diffKey, diffLabel, turnTexts, type DiffState } from "./diffState";
import { Tag } from "../../components/Tag";
import { bindingLabel } from "../../lib/keybindings";
import { withKey } from "../../lib/useKeybindings";
import { useViewerRefresh } from "../../lib/useViewerRefresh";
import { rootFor } from "../../lib/workspace";
import { sidebarOf } from "../../store";

function GitDiff({ path, staged, visible }: { path: string; staged?: boolean; visible: boolean }) {
  const { t } = useI18n();
  const { api, scope, git, hostId } = useSelectedWorkspace();
  const root = useApp((s) => scope ? rootFor(sidebarOf(s, hostId), scope) : null);
  const { revision } = useViewerRefresh(hostId, path, root, visible);
  const selectedStage = staged ?? git?.files.find((f) => f.path === path)?.staged;
  const hasFs = useApp((s) => selectedFeatures(s).has("workspace-fs"));
  const [diff, setDiff] = useState<string | null>(null);
  // A failed read: transient ones read again by themselves (1, 2, 5, 10, 30 s); 重新加载 bumps `attempt`.
  const [issue, setIssue] = useState<ReadIssue | null>(null);
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  useEffect(() => {
    failures.current = 0;
    setDiff(null);
    setIssue(null);
  }, [api, scope, hasFs, path, selectedStage]);
  useEffect(() => {
    if (!scope || !hasFs) return;
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    api.gitDiff(scope, path, selectedStage).then(
      (d) => {
        if (!live) return;
        failures.current = 0;
        setIssue(null);
        setDiff(d.diff);
      },
      (e: unknown) => {
        if (!live) return;
        const next = readIssue(e);
        setIssue(next);
        if (next.retrying) retry = setTimeout(() => live && setAttempt((n) => n + 1), retryDelay(failures.current++));
      },
    );
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, [api, scope, hasFs, path, selectedStage, revision, attempt]);
  if (!hasFs) return <p className="p-3 text-xs text-subtle">{t("diff.noWorkspaceFs")}</p>;
  if (!scope) return <p className="p-3 text-xs text-subtle">{t("diff.noScope")}</p>;
  const issueLine = issue && <ReadIssueLine className="px-1 py-2" issue={issue} retryingText={t("diff.retrying")} failedText={t("diff.failed")} onReload={() => { failures.current = 0; setAttempt((n) => n + 1); }} />;
  // The last diff stays under the line while it retries.
  if (diff === null) return issueLine || <p className="p-3 text-xs text-subtle">…</p>;
  if (issueLine) return <>{issueLine}{diff ? <UnifiedDiff text={diff} className="py-2" /> : null}</>;
  return diff ? <UnifiedDiff text={diff} className="py-2" /> : <p className="p-2 text-subtle">{t("diff.noDiff")}</p>;
}

export function DiffBody({ instance, visible }: SideBodyProps<DiffState>) {
  const { t } = useI18n();
  const state = instance.state;
  const text = state.source === "git" ? undefined : turnTexts.get(diffKey(state));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1 text-xs">
        {state.source === "turn" && <Tag>{t("diff.turnBadge")}</Tag>}
        {state.source === "git" && state.staged && <Tag>{t("diff.staged")}</Tag>}
        <span className="min-w-0 flex-1 truncate text-muted" title={diffLabel(state)} dir={state.source === "text" ? undefined : "rtl"}>
          <bdi>{diffLabel(state)}</bdi>
        </span>
        {state.source !== "text" && (
          <button
            onClick={() => (/^([a-zA-Z]:)?[\\/]/.test(state.path) ? revealHostInTree(state.path) : revealInTree(state.path))}
            className="shrink-0 rounded p-1 text-subtle hover:bg-hover hover:text-foreground"
            title={withKey(t("workspace.revealInTreeKey"), bindingLabel("revealInTree"))}
            aria-label={t("workspace.revealInTree")}
          >
            <LocateFixed size={13} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 text-xs">
        {state.source !== "git" && <p className="py-2 text-xs text-subtle">{t("remote-copies.historical")}</p>}
        {state.source === "git" ? (
          <GitDiff path={state.path} staged={state.staged} visible={visible} />
        ) : text === undefined ? (
          <p className="p-3 text-xs text-subtle">{t(state.source === "text" ? "diff.textGone" : "diff.turnGone")}</p>
        ) : text ? (
          <UnifiedDiff text={text} className="py-2" />
        ) : (
          <p className="p-2 text-subtle">{t("diff.noDiff")}</p>
        )}
      </div>
    </div>
  );
}
