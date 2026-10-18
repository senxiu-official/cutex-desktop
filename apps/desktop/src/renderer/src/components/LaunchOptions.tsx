// Thread launch option controls (docs/launch-options.md): sandbox, approval, network, extra writable
// roots. Used by the New Agent "Advanced" section and Settings → New thread defaults.
import { useState } from "react";
import { AlertTriangle, FolderPlus, X } from "lucide-react";
import { APPROVAL_POLICIES, SANDBOX_MODES, addWritableRoot, type ApprovalPolicy, type SandboxMode } from "../../../shared/launch";
import { useI18n } from "../i18n";
import { defaultCutexHome, exposesCutexHome } from "../lib/cutexHomeExposure";
import { loadHostHome, useHostHomeOf } from "../lib/hostHome";
import { pickDirectory, useFolderPickBlocked } from "../lib/remoteMode";
import { useTargetHostId } from "../lib/targetHost";
import { shortenHome } from "../lib/workspace";
import { Button, Segmented } from "./settings/Form";

export function SandboxControl({ value, onChange }: { value: SandboxMode; onChange(v: SandboxMode): void }) {
  const { t } = useI18n();
  return <Segmented value={value} options={SANDBOX_MODES.map((m) => ({ value: m, label: t(`launch.sandbox.${m}`) }))} onChange={onChange} />;
}

export function ApprovalControl({ value, onChange }: { value: ApprovalPolicy; onChange(v: ApprovalPolicy): void }) {
  const { t } = useI18n();
  return <Segmented value={value} options={APPROVAL_POLICIES.map((p) => ({ value: p, label: t(`launch.approval.${p}`) }))} onChange={onChange} />;
}

/**
 * Extra writable roots: list with remove, add via the native folder chooser. A directory that contains
 * the host's cutex home (owner Q11: e.g. `~`) is allowed but warned about: picked, it waits for
 * 「仍然添加」; stored, its chip carries a warning mark (lib/cutexHomeExposure).
 */
export function WritableRootsEditor({ roots, onChange, disabled }: { roots: string[]; onChange(next: string[]): void; disabled?: boolean }) {
  const { t } = useI18n();
  const pickBlocked = useFolderPickBlocked();
  const hostId = useTargetHostId();
  const home = useHostHomeOf(hostId, true);
  const [confirm, setConfirm] = useState<string | null>(null);
  const exposes = (dir: string, h: string | null = home) => !!h && exposesCutexHome(dir, defaultCutexHome(h));
  const add = async () => {
    setConfirm(null);
    const dir = await pickDirectory(roots.at(-1), hostId);
    if (!dir) return;
    const next = addWritableRoot(roots, dir);
    if (next === roots) return;
    if (exposes(dir, home ?? (await loadHostHome(hostId)))) return setConfirm(dir);
    onChange(next);
  };
  const warning = t("launch.rootExposesCutex");
  return (
    <div className={`flex max-w-72 min-w-0 flex-col items-end gap-1 ${disabled ? "opacity-50" : ""}`}>
      {roots.length === 0 && <span className="text-xs text-subtle">{t("launch.noRoots")}</span>}
      {roots.map((root) => (
        <div key={root} className="flex max-w-full items-center gap-1 rounded-md bg-surface-2 py-0.5 pr-0.5 pl-2">
          {exposes(root) && (
            <span title={warning} role="img" aria-label={warning} className="shrink-0 text-warn-text" data-testid="root-exposes-cutex">
              <AlertTriangle size={11} />
            </span>
          )}
          <span className="truncate font-mono text-[11px]" title={root} style={{ direction: "rtl", textAlign: "left" }}>
            <bdi>{shortenHome(root)}</bdi>
          </span>
          <button disabled={disabled} title={t("launch.removeRoot")} aria-label={t("launch.removeRoot")} onClick={() => onChange(roots.filter((r) => r !== root))} className="rounded p-0.5 text-subtle hover:bg-surface hover:text-foreground">
            <X size={12} />
          </button>
        </div>
      ))}
      {confirm !== null && (
        <div role="status" className="flex w-60 flex-col items-end gap-1 rounded-md border border-warn/40 bg-warn/10 px-2 py-1 text-[11px] text-warn-text" data-testid="root-exposes-cutex-confirm">
          <span className="self-start">
            <AlertTriangle size={11} className="mr-1 inline align-[-1px]" />
            {warning}
          </span>
          <span className="max-w-full self-start truncate font-mono" title={confirm}>{shortenHome(confirm)}</span>
          <span className="flex gap-1">
            <Button onClick={() => setConfirm(null)}>{t("dialog.cancel")}</Button>
            <Button disabled={disabled} onClick={() => { const next = addWritableRoot(roots, confirm); setConfirm(null); if (next !== roots) onChange(next); }}>{t("launch.addRootAnyway")}</Button>
          </span>
        </div>
      )}
      <Button disabled={disabled || pickBlocked} title={pickBlocked ? t("remote.noDirBrowse") : undefined} onClick={() => void add()}>
        <FolderPlus size={13} className="mr-1 inline" />
        {t("launch.addRoot")}
      </Button>
    </div>
  );
}
