// What a thread's permission mode actually grants (composer permission menu footer).
import { useI18n } from "../i18n";
import { effectivePermissionLines, type EffectivePermissions } from "../lib/permissionModes";

export function PermissionDetail({ effective }: { effective: EffectivePermissions }) {
  const { t } = useI18n();
  return (
    <div className="max-w-72 text-xs text-subtle">
      <div className="mb-0.5">{t("composer.effective.title")}</div>
      {effectivePermissionLines(effective).map((line) => (
        <div key={line.key} className="text-muted">{t(line.key, line.params)}</div>
      ))}
      {effective.writableRoots.map((root) => (
        <div key={root} title={root} className="ml-2 truncate font-mono text-[11px]">{root}</div>
      ))}
    </div>
  );
}
