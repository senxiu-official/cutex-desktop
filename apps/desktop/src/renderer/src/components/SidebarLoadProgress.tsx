// 「已加载 120 / 322」 at the top of the agent list while a host in view is still on its first read: its rows
// arrive as they are read (main sidebarPeek), this says how many of all have come. 「同步中…」 while a list kept
// from an earlier run (lib/sidebarCache) is shown and its host has not reported progress yet.
import { useI18n } from "../i18n";
import { sidebarOf, useApp } from "../store";
import { useHostScope } from "../lib/useHostScope";

export function SidebarLoadProgress() {
  const { t } = useI18n();
  const scope = useHostScope();
  // A string: an equal reading must not re-render (a new array would every store change).
  const key = useApp((s) => scope.ids.map((id) => {
    const sidebar = sidebarOf(s, id);
    if (sidebar?.loading) return `${id}\u0000${sidebar.loading.loaded}\u0000${sidebar.loading.total}`;
    return sidebar?.cached ? `${id}\u0000\u0000` : "";
  }).filter(Boolean).join("\u0001"));
  if (!key) return null;
  return (
    <div role="status" className="px-2 pb-1 text-caption text-subtle tabular-nums">
      {key.split("\u0001").map((entry) => {
        const [id, loaded, total] = entry.split("\u0000");
        const text = total ? t("sidebar.loadProgress", { loaded: loaded!, total }) : t("sidebar.syncing");
        return <p key={id}>{scope.multi ? `${scope.host(id!)?.label ?? id} · ${text}` : text}</p>;
      })}
    </div>
  );
}
