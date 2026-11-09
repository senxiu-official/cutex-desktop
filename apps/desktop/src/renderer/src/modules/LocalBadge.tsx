// The 本地安装 marker next to a local module's navigation entry, page title and name (§23.14).
import { useI18n } from "../i18n";
import { useModuleDevView } from "./devModules";
import { usePackRuntime } from "./packs";

export function LocalBadge({ moduleId }: { moduleId: string }) {
  const { t } = useI18n();
  const view = usePackRuntime().view;
  const fromFolder = useModuleDevView()?.modules.some((m) => m.id === moduleId);
  if (!fromFolder && !view?.installed.some((p) => p.id === moduleId && p.local)) return null;
  return (
    <span className="shrink-0 truncate rounded bg-warn/15 px-1.5 py-0.5 text-caption/[inherit] text-warn-text" title={t(fromFolder ? "modules.dev.hint" : "modules.pack.local.hint")}>
      {t(fromFolder ? "modules.dev.badge" : "modules.pack.local.badge")}
    </span>
  );
}
