// In place of the composer while an archived agent is open: says it is archived and read-only, and
// restores it (its archived project first, lib/archivedAgent.ts). After the restore the store
// reloads the agent from a live bootstrap and the composer comes back.
import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import type { SessionResource } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { archivedProjectOf } from "../lib/archivedAgent";
import { restoreArchived } from "../lib/menus";
import { restoreWithDirector } from "../lib/projectArchive";
import { useApp } from "../store";
import { convSidebarOf, useConvScope } from "../lib/conversationScope";

export function ArchivedBanner({ session }: { session: SessionResource }) {
  const { t } = useI18n();
  const conv = useConvScope();
  const projects = useApp((s) => convSidebarOf(conv, s)?.projects);
  const project = archivedProjectOf(session, projects);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = async (withProject: boolean) => {
    setBusy(true);
    setError(null);
    try {
      // With its project: also offers 「同时恢复主管」 when that project's Director is archived too.
      if (withProject) await restoreWithDirector(session, t);
      else await restoreArchived(session, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="side-col px-6 pb-4" data-testid="archived-banner" data-gutter-anchor="banner">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/60 px-4 py-3">
        <Archive size={16} className="mt-0.5 shrink-0 text-subtle" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">{t("archive.banner.title")}</div>
          <div className="text-xs text-subtle">{t("archive.banner.body")}</div>
          {project && <div className="mt-1 text-xs text-warn">{t("archive.banner.projectArchived", { project: project.name })}</div>}
          {error && <div className="mt-1 text-xs text-danger">{error}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            disabled={busy}
            onClick={() => void restore(true)}
            className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            <ArchiveRestore size={13} />
            {busy ? t("archive.banner.restoring") : t(project ? "archive.banner.restoreWithProject" : "archive.banner.restore")}
          </button>
          {project && (
            <button disabled={busy} onClick={() => void restore(false)} className="text-[11px] text-subtle hover:text-foreground hover:underline disabled:opacity-50">
              {t("archive.banner.restoreOnly")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
