// What a thread's permission mode actually grants (composer permission menu footer).
import { useI18n } from "../i18n";
import { effectivePermissionLines, type EffectivePermissions } from "../lib/permissionModes";

/** `editable`: network / extra directories are shown as controls below (LiveSandboxExtras), not as lines. */
export function PermissionDetail({ effective, editable }: { effective: EffectivePermissions; editable?: boolean }) {
  const { t } = useI18n();
  const lines = effectivePermissionLines(effective).filter((line) => !editable || !/^composer\.effective\.(network|roots)/.test(line.key));
  return (
    <div className="max-w-72 text-xs text-subtle">
      <div className="mb-0.5">{t("composer.effective.title")}</div>
      {lines.map((line) => (
        <div key={line.key} className="text-muted">{t(line.key, line.params)}</div>
      ))}
      {!editable && effective.writableRoots.map((root) => (
        <div key={root} title={root} className="ml-2 truncate font-mono text-[11px]">{root}</div>
      ))}
    </div>
  );
}
