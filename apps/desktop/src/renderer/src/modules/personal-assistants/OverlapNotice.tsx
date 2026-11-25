// The overlap warning (owner 2026-11-25: overlapping project sets are allowed, with a warning that can be dismissed):
// one line per project naming the other assistants that cover it. The dismissal is kept on this device per assistant
// and exact set of overlaps, so a new overlap shows again.
import { TriangleAlert } from "lucide-react";
import { useI18n } from "../../i18n";
import { overlapDismissKey } from "../../lib/personalAssistants";
import type { PaOverlap } from "../../../../shared/personalAssistants";
import { dismissOverlap, projectName, useOverlapDismissals, type PaHost } from "./paHooks";

export function OverlapNotice({ rows, more, selfId, host }: { rows: readonly PaOverlap[]; more?: boolean; selfId: string | null; host: PaHost | undefined }) {
  const { t, locale } = useI18n();
  const key = overlapDismissKey(selfId, rows);
  const dismissed = useOverlapDismissals((s) => s.keys.includes(key));
  if (rows.length === 0 || dismissed) return null;
  const byProject = new Map<string, string[]>();
  for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r.name]);
  return (
    <div className="my-2 flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-caption/[inherit] text-foreground" role="status" data-pa-overlap="">
      <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t("personal-assistants.overlap.title")}</div>
        <ul className="mt-0.5">
          {[...byProject].map(([projectId, names]) => (
            <li key={projectId} data-pa-overlap-project={projectId}>
              {t("personal-assistants.overlap.row", { project: projectName(host, projectId), names: names.join(locale.startsWith("zh") ? "、" : ", ") })}
            </li>
          ))}
        </ul>
        {more && <div className="text-subtle">{t("personal-assistants.overlap.more")}</div>}
        <div className="mt-0.5 text-subtle">{t("personal-assistants.overlap.note")}</div>
      </div>
      <button type="button" className="press shrink-0 rounded-sm px-1.5 text-caption/[inherit] text-muted hover:text-foreground" onClick={() => dismissOverlap(key)} data-pa-overlap-dismiss="">
        {t("personal-assistants.overlap.dismiss")}
      </button>
    </div>
  );
}
