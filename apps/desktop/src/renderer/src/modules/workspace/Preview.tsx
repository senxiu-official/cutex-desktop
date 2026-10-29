// 预览 card (workspace.preview): one file per tab. A workspace-relative path is read through the
// workspace route (fs/file); `host` = an absolute path on the active host outside the workspace root
// (fs-file-read). Transient: the next file replaces the unpinned tab (double-click / 保持打开 keeps it).
// Two rows: the card header carries only the file name (full width); the path row below is a breadcrumb
// back to the 文件 explorer (docs/design/019 §3: each folder opens there, ◎ shows the file in it) and ends
// with 源码 / 复制绝对路径.
import { useRef, useState } from "react";
import { LocateFixed, MoreHorizontal } from "lucide-react";
import { useI18n } from "../../i18n";
import { openFolder, openHostFolder, revealHostInTree, revealInTree } from "../../lib/sideOpen";
import { HOST_FILE_READ_FEATURE, rootFor } from "../../lib/workspace";
import { useSelectedWorkspace, WorkspaceContext } from "../../lib/workspaceView";
import { apiFor } from "../../bridge";
import { featuresOf, sidebarOf, useApp } from "../../store";
import type { SideBodyProps } from "../slots";
import { relativeTo } from "./explorer/model";
import { FileView } from "./FileView";
import { isSourceToggleable, type PreviewState } from "./previewState";
import { rememberSourceChoice, viewKindOf } from "./viewChoice";
import { Tag } from "../../components/Tag";
import { fileActions } from "../../lib/fileActions";
import { openMenuFrom } from "../../lib/contextMenu";
import { bindingLabel } from "../../lib/keybindings";
import { withKey } from "../../lib/useKeybindings";

export function PreviewBody(props: SideBodyProps<PreviewState>) {
  const workspace = useSelectedWorkspace();
  const scope = props.instance.state.scope;
  if (scope && props.hostId) return <WorkspaceContext.Provider value={{ ...workspace, hostId: props.hostId, api: apiFor(props.hostId), scope }}><PreviewContent {...props} /></WorkspaceContext.Provider>;
  return <PreviewContent {...props} />;
}

function PreviewContent(props: SideBodyProps<PreviewState>) {
  const { instance } = props;
  const close = useRef(props.close);
  close.current = props.close;
  const { t } = useI18n();
  const { api, scope, hostId } = useSelectedWorkspace();
  const hostRead = useApp((s) => featuresOf(s, hostId).has(HOST_FILE_READ_FEATURE));
  const { path, line, host, source } = instance.state;
  const canRead = host ? hostRead : !!scope;
  if (!canRead) return <p className="p-3 text-xs text-subtle">{t(host ? "workspace.hostReadMissing" : "workspace.noScope")}</p>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1 text-xs">
        {host && (
          <Tag title={t("workspace.hostFileHint")}>
            {t("workspace.hostFile")}
          </Tag>
        )}
        <PathCrumbs path={path} line={line} host={host} />
        <PathActions {...props} />
      </div>
      <FileView
        api={api}
        hostId={hostId}
        scope={scope}
        path={path}
        host={host}
        visible={props.visible}
        line={line}
        source={source}
        onSource={(next) => {
          rememberSourceChoice(viewKindOf(path), next);
          props.setState({ ...instance.state, source: next });
        }}
        // A folder that got here without the openers (a restored tab, a bookmark): the 文件 tree shows it.
        onFolder={() => {
          close.current();
          if (host) openHostFolder(path);
          else openFolder(path);
        }}
      />
    </div>
  );
}

/**
 * The path as a breadcrumb (019 §3, rule 19 of the audit): each folder opens in the 文件 explorer; a host
 * path outside the workspace stays plain text. Long paths keep their end visible.
 */
function PathCrumbs({ path, line, host }: { path: string; line: number | null; host: boolean }) {
  const { t } = useI18n();
  const { scope, hostId } = useSelectedWorkspace();
  const root = useApp((s) => (scope ? rootFor(sidebarOf(s, hostId), scope) : null));
  // A host path inside the root opens there too.
  const rel = host ? (root ? relativeTo(path, root) : null) : path;
  const parts = path.split(/[\\/]/);
  const relParts = rel !== null ? rel.split("/") : null;
  // How many leading parts of `path` are above the workspace root (not clickable).
  const above = relParts ? parts.length - relParts.length : parts.length;
  return (
    <span className="selectable min-w-0 flex-1 overflow-hidden whitespace-nowrap text-muted" title={line ? `${path}:${line}` : path} dir="rtl">
      <bdi className="inline-flex items-center">
        {parts.map((name, i) => {
          const last = i === parts.length - 1;
          const folder = relParts && i >= above && !last ? relParts.slice(0, i - above + 1).join("/") : null;
          return (
            <span key={i} className="inline-flex items-center">
              {i > 0 && <span className="px-0.5 text-subtle/70">/</span>}
              {folder !== null ? (
                <button onClick={() => openFolder(folder)} title={t("workspace.crumbOpen")} className="rounded px-0.5 hover:bg-hover hover:text-foreground">
                  <span className="selectable">{name}</span>
                </button>
              ) : (
                <span className={last ? "font-medium text-foreground" : ""}>{name}</span>
              )}
            </span>
          );
        })}
        {line ? <span className="text-subtle">:{line}</span> : null}
      </bdi>
    </span>
  );
}

/** End of the path row: ◎ 在文件树中显示, 源码 / 预览 (Markdown, SVG, HTML; remembered per kind) and 复制绝对路径. */
function PathActions({ instance, setState }: SideBodyProps<PreviewState>) {
  const { t } = useI18n();
  const { scope, hostId } = useSelectedWorkspace();
  const hostLabel = useApp((state) => state.hosts?.hosts.find((item) => item.id === hostId)?.label) ?? hostId;
  const root = useApp((s) => (!instance.state.host && scope ? rootFor(sidebarOf(s, hostId), scope) : null));
  const [copied, setCopied] = useState(false);
  const { path, source, host } = instance.state;
  const sep = root?.includes("\\") ? "\\" : "/";
  const absolute = root ? `${root.replace(/[\\/]+$/, "")}${sep}${sep === "\\" ? path.replace(/\//g, "\\") : path}` : path;
  const button = "shrink-0 rounded px-1.5 py-0.5 text-meta/[inherit] text-subtle hover:bg-hover hover:text-foreground";
  return (
    <>
      <button
        onClick={() => (host ? revealHostInTree(path) : revealInTree(path))}
        className="shrink-0 rounded p-1 text-subtle hover:bg-hover hover:text-foreground"
        title={withKey(t("workspace.revealInTreeKey"), bindingLabel("revealInTree"))}
        aria-label={t("workspace.revealInTree")}
      >
        <LocateFixed size={13} />
      </button>
      {isSourceToggleable(path) && (
        <button
          onClick={() => {
            rememberSourceChoice(viewKindOf(path), !source);
            setState({ ...instance.state, source: !source });
          }}
          className={button}
          data-source-toggle=""
          aria-pressed={source}
        >
          {source ? t("workspace.showRendered") : t("workspace.showSource")}
        </button>
      )}
      {(root || host) && (
        <button
          onClick={() => {
            void navigator.clipboard.writeText(absolute);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className={button}
          title={absolute}
        >
          {copied ? t("workspace.copied") : `${t("workspace.copyPath")} · ${hostLabel}`}
        </button>
      )}
      {(root || host) && (
        <button
          onClick={(event) => openMenuFrom(event.currentTarget, fileActions({ hostId, path: absolute, ...(instance.state.scope ? { scope: instance.state.scope } : {}) }, t))}
          className="shrink-0 rounded p-1 text-subtle hover:bg-hover hover:text-foreground"
          aria-label={t("workspace.fx.more")}
          title={t("workspace.fx.more")}
        >
          <MoreHorizontal size={13} />
        </button>
      )}
    </>
  );
}
