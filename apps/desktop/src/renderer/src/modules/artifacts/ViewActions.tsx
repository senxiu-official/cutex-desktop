// The 成果 view's card header button (artifacts.view `Actions`), apart from the view itself (View.tsx) so the view
// loads when first shown (lib/lazyPage; 0.2.0 beta perf audit) while the header stays in the entry chunk.
import { Copy, Download, FolderOpen } from "lucide-react";
import { parseArtifactRef } from "../../../../shared/artifactStore";
import { useI18n, type MessageKey } from "../../i18n";
import { openMenuFrom } from "../../lib/contextMenu";
import type { SideBodyProps } from "../slots";
import { copyArtifactLink } from "./actions";
import { resolveVersion, type ViewState } from "./model";
import { canSaveArtifact, saveArtifact } from "../../lib/remoteCopies";
import { useCachedDetail } from "./store";
import { artifactFileVersion, artifactSourceFileEntries, openArtifactSourceFileMenu } from "./fileActions";

/** Card header button: the version's markdown link to the clipboard. */
export function ViewActions({ instance, hostId }: SideBodyProps<ViewState>) {
  const { t } = useI18n();
  const parts = parseArtifactRef(instance.state.ref);
  const detail = useCachedDetail(hostId, parts?.artifactId ?? null);
  const version = artifactFileVersion(detail, instance.state.ref);
  // The version shown (a latest view: the newest one now), whatever its kind or storage.
  const shown = parts && detail?.artifact.artifactId === parts.artifactId ? resolveVersion(detail, parts.version) ?? null : null;
  const canSave = !!hostId && !!shown && canSaveArtifact(hostId);
  return (
    <>
    <button type="button"
      title={canSave && shown ? t("artifacts.save.hint", { n: shown.version }) : t("artifacts.save.toComputer")} aria-label={t("artifacts.save.toComputer")}
      disabled={!canSave}
      onClick={() => { if (hostId && shown) void saveArtifact(hostId, shown, detail?.artifact.scope); }}
      className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground disabled:opacity-40" data-artifact-save>
      <Download size={13} />
    </button>
    <button type="button"
      title={t("artifacts.sourceFileActions" as MessageKey)} aria-label={t("artifacts.sourceFileActions" as MessageKey)}
      disabled={!hostId || !parts}
      onClick={(event) => {
        if (!hostId) return;
        const rows = artifactSourceFileEntries(hostId, version);
        if (rows.length) openMenuFrom(event.currentTarget, rows);
        else void openArtifactSourceFileMenu(hostId, instance.state.ref, event.currentTarget);
      }}
      className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground disabled:opacity-40">
      <FolderOpen size={13} />
    </button>
    <button
      title={t("artifacts.copyLink")}
      aria-label={t("artifacts.copyLink")}
      onClick={() => copyArtifactLink(instance.state.ref, detail?.artifact.name ?? instance.state.name ?? instance.state.ref)}
      className="flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-foreground"
    >
      <Copy size={13} />
    </button>
    </>
  );
}
