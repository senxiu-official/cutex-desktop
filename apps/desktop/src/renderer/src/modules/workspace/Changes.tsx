// 改动 card (workspace.changes): the git status list of the selected agent's workspace. A file opens
// its diff in the diff card (diff.view, key git:<path>); ↗ previews the file.
import { openModifiers } from "../../lib/openModifiers";
import { useI18n } from "../../i18n";
import { DIFF_COMPONENT } from "../../lib/sideKinds";
import { openFile, openGitDiff } from "../../lib/sideOpen";
import { useSelectedWorkspace } from "../../lib/workspaceView";
import type { SideBodyProps } from "../slots";
import { useCurrentField, useFileMenu } from "./shared";

const STATUS_LETTER: Record<string, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", typechange: "T", conflicted: "!", untracked: "U" };

export function ChangesBody(_props: SideBodyProps<null>) {
  const { t } = useI18n();
  const { scope, git, error } = useSelectedWorkspace();
  const menu = useFileMenu(scope);
  const current = useCurrentField(DIFF_COMPONENT, "path");
  if (!scope) return <p className="p-3 text-xs text-subtle">{t("workspace.noScope")}</p>;
  if (error) return <p className="p-3 text-xs text-danger">{error}</p>;
  if (!git) return <p className="p-3 text-xs text-subtle">…</p>;
  if (!git.isRepo) return <p className="p-3 text-xs text-subtle">{t("workspace.notRepo")}</p>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 px-3 py-2 text-xs text-muted">
        ⎇ {git.branch ?? "HEAD"}
        {git.ahead ? ` ↑${git.ahead}` : ""}
        {git.behind ? ` ↓${git.behind}` : ""}
        {git.head && <div className="truncate text-subtle">{git.head.sha.slice(0, 7)} {git.head.subject}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {git.files.length === 0 && <p className="px-3 py-2 text-xs text-subtle">{t("workspace.clean")}</p>}
        {git.files.map((f) => (
          <div key={`${f.path}:${f.staged}`} onContextMenu={menu(f.path, { changed: true })} className={`group flex items-center gap-2 px-3 py-[3px] text-[13px] hover:bg-surface-2 ${current === f.path ? "bg-surface-2" : ""}`}>
            <span className="w-3 text-center font-mono text-[11px] text-subtle">{STATUS_LETTER[f.status]}</span>
            <button onClick={() => void openGitDiff(f.path, f.staged)} className="min-w-0 flex-1 truncate text-left" title={f.path}>
              {f.path.split("/").pop()} <span className="text-xs text-subtle">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
            </button>
            {f.staged && <span className="text-[10px] text-subtle">{t("workspace.staged")}</span>}
            <span className="text-xs text-ok-text">{f.added ? `+${f.added}` : ""}</span>
            <span className="text-xs text-danger">{f.deleted ? `−${f.deleted}` : ""}</span>
            {f.status !== "deleted" && (
              <button onClick={(e) => void openFile(f.path, null, "browse", openModifiers(e))} onAuxClick={(e) => e.button === 1 && void openFile(f.path, null, "browse", openModifiers(e))} title={t("workspace.open")} className="hidden text-xs text-subtle hover:text-foreground group-hover:inline">
                ↗
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
