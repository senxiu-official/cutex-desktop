// timeline.tool for `artifact_publish`: a card 「发布了 regression.md v3 →」 that opens that pinned
// version (reference card / right side); 「有更新 v4」 once a newer version exists. Running: one live
// line; refused / failed: the error text like other tool rows.
import { FileBox, Loader2, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { contextMenu } from "../../lib/contextMenu";
import { toolErrorText } from "../../lib/taskRows";
import type { RawItem } from "../../lib/timeline";
import { useConvHost } from "../../lib/conversationScope";
import { services } from "../app";
import { artifactCutexRef, copyArtifactLink, explainOpen } from "./actions";
import { publishCallOf } from "./model";
import { useArtifactLink } from "./refTarget";

function Published({ name, refKey, newVersion, version }: { name: string; refKey: string; newVersion: boolean | null; version: number | null }) {
  const { t } = useI18n();
  const hostId = useConvHost();
  const label = version ? `${name} v${version}` : name;
  const cref = { ...artifactCutexRef(refKey, label), hostId };
  const view = useArtifactLink(cref);
  const Icon = view?.icon ?? FileBox;
  const open = (how: "auto" | "peek" | "page") => void services.refs.open(cref, { how }).then(explainOpen);
  return (
    <div className="my-1">
      <button
        onClick={() => open("page")}
        onContextMenu={contextMenu(() => [
          { label: t("gutter.openLeft"), onSelect: () => open("peek") },
          { label: t("gutter.openRight"), onSelect: () => open("page") },
          { label: t("artifacts.copyLink"), onSelect: () => copyArtifactLink(refKey, name) },
        ])}
        title={view?.tooltip ?? label}
        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs hover:bg-hover"
      >
        <Icon size={13} className="shrink-0 text-accent" />
        <span className="shrink-0 text-muted">{t("artifacts.tool.published")}</span>
        <span className="min-w-0 truncate font-medium text-foreground">{label}</span>
        {newVersion === false && <span className="shrink-0 rounded bg-surface-2 px-1 text-[10.5px] text-subtle">{t("artifacts.tool.unchanged")}</span>}
        {view?.badge && <span className={`shrink-0 rounded bg-surface-2 px-1 text-[10.5px] ${view.tone === "warn" ? "text-warn" : "text-subtle"}`}>{view.badge}</span>}
        <span className="shrink-0 text-accent">→</span>
      </button>
    </div>
  );
}

export function PublishToolRow({ item }: { item: RawItem; sessionId: string }) {
  const { t } = useI18n();
  const call = publishCallOf(item);
  if (!call) return null;
  if (call.status === "done" && call.ref) return <Published name={call.name} refKey={call.ref} newVersion={call.newVersion} version={call.version} />;
  if (call.status === "running")
    return (
      <div className="my-0.5 flex items-center gap-1.5 text-xs text-muted">
        <Loader2 size={13} className="animate-spin text-accent" />
        <span className="min-w-0 truncate">{t("artifacts.tool.publishing", { path: call.path ?? call.name })}</span>
      </div>
    );
  const error = toolErrorText(item);
  return (
    <div className="my-0.5 text-xs">
      <div className="flex items-center gap-1.5 text-danger">
        <X size={13} />
        <span className="font-medium">{t("artifacts.tool.failed")}</span>
        {call.path && <code className="min-w-0 truncate font-mono text-subtle">{call.path}</code>}
      </div>
      {error && <pre className="mt-0.5 ml-5 max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-danger opacity-80">{error}</pre>}
    </div>
  );
}

