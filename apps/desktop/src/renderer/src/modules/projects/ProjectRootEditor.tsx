// 项目目录 row of the project settings: shows the root; 修改 opens an inline editor (type / paste,
// or 选择… = the folder picker of the project's host, remote ones over the daemon). Replacing or
// clearing an existing root first explains what that does (lib/projectRoot); cutex's refusals
// show as words under the field.
import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { useI18n } from "../../i18n";
import { confirmDialog } from "../../lib/contextMenu";
import { shortenHome } from "../../lib/workspace";
import { pickDirectory, useFolderPickBlocked } from "../../lib/remoteMode";
import { nextWorkspaceRoot, rootConfirmKind, workspaceRootErrorKey } from "../../lib/projectRoot";
import { Button, TextInput } from "../../components/settings/Form";

/** `apply`: the CAS'd `set_workspace_root` mutation; throws cutex's refusal. */
export function ProjectRootEditor({ hostId, current, remote, apply }: { hostId: string; current: string | null; remote: boolean; apply(root: string | null): Promise<void> }) {
  const { t } = useI18n();
  const pickBlocked = useFolderPickBlocked();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setValue(current ?? "");
    setError(null);
    setEditing(true);
  };
  const submit = async (input: string) => {
    const next = nextWorkspaceRoot(input);
    const kind = rootConfirmKind(current, next);
    if (kind === "same") return setEditing(false);
    if (kind === "change" && !(await confirmDialog(t("projects.root.changeConfirm", { path: next! }), false, { ok: t("projects.root.changeOk"), cancel: t("dialog.cancel") }))) return;
    if (kind === "clear" && !(await confirmDialog(t("projects.root.clearConfirm"), true, { ok: t("projects.root.clearOk"), cancel: t("dialog.cancel") }))) return;
    setBusy(true);
    setError(null);
    try {
      await apply(next);
      setEditing(false);
    } catch (e) {
      const key = workspaceRootErrorKey(e);
      setError(key ? t(key) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <>
        <span className="max-w-72 truncate font-mono text-xs text-muted" title={current ?? undefined}>
          {current ? shortenHome(current) : t("projects.noDirectory")}
        </span>
        <Button onClick={open}>
          <FolderOpen size={13} className="mr-1 inline" />
          {t("projects.change")}
        </Button>
      </>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <TextInput
          width="w-72"
          mono
          autoFocus
          value={value}
          onChange={setValue}
          disabled={busy}
          placeholder={remote ? "/home/me/project" : "D:\\path\\to\\project"}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit(value);
            } else if (e.key === "Escape") setEditing(false);
          }}
        />
        <Button
          disabled={busy || pickBlocked}
          title={pickBlocked ? t("remote.noDirBrowse") : undefined}
          onClick={() =>
            void pickDirectory(value.trim() || current || undefined, hostId).then((picked) => {
              if (picked) setValue(picked);
            })
          }
        >
          <FolderOpen size={13} className="mr-1 inline" />
          {t("agent-config.newAgent.pickFolder")}
        </Button>
        {current && (
          <Button disabled={busy} onClick={() => void submit("")}>
            {t("projects.root.clear")}
          </Button>
        )}
        <Button disabled={busy} onClick={() => setEditing(false)}>
          {t("dialog.cancel")}
        </Button>
        <Button primary disabled={busy || rootConfirmKind(current, nextWorkspaceRoot(value)) === "same"} onClick={() => void submit(value)}>
          {t("projects.root.apply")}
        </Button>
      </div>
      {error && <p className="max-w-[36rem] text-xs text-danger">{error}</p>}
    </div>
  );
}
