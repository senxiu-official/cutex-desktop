// Thread launch option controls (docs/launch-options.md): sandbox, approval, network, extra writable
// roots. Used by the New Agent "Advanced" section and Settings → New thread defaults.
import { FolderPlus, X } from "lucide-react";
import { APPROVAL_POLICIES, SANDBOX_MODES, addWritableRoot, type ApprovalPolicy, type SandboxMode } from "../../../shared/launch";
import { useI18n } from "../i18n";
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

/** Extra writable roots: list with remove, add via the native folder chooser. */
export function WritableRootsEditor({ roots, onChange, disabled }: { roots: string[]; onChange(next: string[]): void; disabled?: boolean }) {
  const { t } = useI18n();
  const pickBlocked = useFolderPickBlocked();
  const hostId = useTargetHostId();
  const add = async () => {
    const dir = await pickDirectory(roots.at(-1), hostId);
    if (!dir) return;
    const next = addWritableRoot(roots, dir);
    if (next !== roots) onChange(next);
  };
  return (
    <div className={`flex max-w-72 min-w-0 flex-col items-end gap-1 ${disabled ? "opacity-50" : ""}`}>
      {roots.length === 0 && <span className="text-xs text-subtle">{t("launch.noRoots")}</span>}
      {roots.map((root) => (
        <div key={root} className="flex max-w-full items-center gap-1 rounded-md bg-surface-2 py-0.5 pr-0.5 pl-2">
          <span className="truncate font-mono text-[11px]" title={root} style={{ direction: "rtl", textAlign: "left" }}>
            <bdi>{shortenHome(root)}</bdi>
          </span>
          <button disabled={disabled} title={t("launch.removeRoot")} aria-label={t("launch.removeRoot")} onClick={() => onChange(roots.filter((r) => r !== root))} className="rounded p-0.5 text-subtle hover:bg-surface hover:text-foreground">
            <X size={12} />
          </button>
        </div>
      ))}
      <Button disabled={disabled || pickBlocked} title={pickBlocked ? t("remote.noDirBrowse") : undefined} onClick={() => void add()}>
        <FolderPlus size={13} className="mr-1 inline" />
        {t("launch.addRoot")}
      </Button>
    </div>
  );
}
