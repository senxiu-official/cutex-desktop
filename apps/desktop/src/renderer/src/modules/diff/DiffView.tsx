// The diff card's viewer (diff.view): a git working-tree diff of the selected agent's workspace, or
// one turn's changes to a file (text from the timeline, memory only), or a caller's unified diff (`text`, v1.7).
import { useEffect, useState } from "react";
import { UnifiedDiff } from "../../components/UnifiedDiff";
import { useI18n } from "../../i18n";
import { useSelectedWorkspace, workspaceError } from "../../lib/workspaceView";
import { selectedFeatures, useApp } from "../../store";
import type { SideBodyProps } from "../slots";
import { diffKey, diffLabel, turnTexts, type DiffState } from "./diffState";

function GitDiff({ path, staged }: { path: string; staged?: boolean }) {
  const { t } = useI18n();
  const { api, scope, git, revision } = useSelectedWorkspace();
  const hasFs = useApp((s) => selectedFeatures(s).has("workspace-fs"));
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDiff(null);
    setError(null);
    if (!scope || !hasFs) return;
    let live = true;
    const entry = git?.files.find((f) => f.path === path);
    api.gitDiff(scope, path, staged ?? (entry ? entry.staged : undefined)).then(
      (d) => live && setDiff(d.diff),
      (e: unknown) => {
        if (!live) return;
        setError(workspaceError(e));
        setDiff("");
      },
    );
    return () => {
      live = false;
    };
  }, [api, scope, hasFs, path, staged, git, revision]);
  if (!hasFs) return <p className="p-3 text-xs text-subtle">{t("diff.noWorkspaceFs")}</p>;
  if (!scope) return <p className="p-3 text-xs text-subtle">{t("diff.noScope")}</p>;
  if (error) return <p className="p-3 text-xs text-danger">{error}</p>;
  if (diff === null) return <p className="p-3 text-xs text-subtle">…</p>;
  return diff ? <UnifiedDiff text={diff} className="py-2" /> : <p className="p-2 text-subtle">{t("diff.noDiff")}</p>;
}

export function DiffBody({ instance }: SideBodyProps<DiffState>) {
  const { t } = useI18n();
  const state = instance.state;
  const text = state.source === "git" ? undefined : turnTexts.get(diffKey(state));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1 text-xs">
        {state.source === "turn" && <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-subtle">{t("diff.turnBadge")}</span>}
        {state.source === "git" && state.staged && <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-subtle">{t("diff.staged")}</span>}
        <span className="min-w-0 flex-1 truncate text-muted" title={diffLabel(state)} dir={state.source === "text" ? undefined : "rtl"}>
          <bdi>{diffLabel(state)}</bdi>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 text-xs">
        {state.source === "git" ? (
          <GitDiff path={state.path} staged={state.staged} />
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
