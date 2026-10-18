// 预览 card (workspace.preview): one file per tab. A workspace-relative path is read through the
// workspace route (fs/file); `host` = an absolute path on the active host outside the workspace root
// (fs-file-read). Transient: the next file replaces the unpinned tab (double-click / 保持打开 keeps it).
// Two rows: the card header carries only the file name (full width); the path row below ends with
// 源码 / 复制绝对路径.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { FsFile } from "../../../../shared/ipc";
import { DocumentPreview } from "../../components/DocumentPreview";
import { Markdown } from "../../components/Markdown";
import { useI18n } from "../../i18n";
import { docKindOf, loadFsDoc } from "../../lib/docPreview";
import { isThumbnailPath, THUMBNAIL_MAX_BYTES, thumbnailSrc } from "../../lib/fileKinds";
import { HOST_FILE_READ_FEATURE, languageFor, rootFor } from "../../lib/workspace";
import { useSelectedWorkspace, workspaceError } from "../../lib/workspaceView";
import { selectedFeatures, selectedSidebar, useApp } from "../../store";
import type { SideBodyProps } from "../slots";
import { fence } from "./shared";
import { isSourceToggleable, type PreviewState } from "./previewState";

/**
 * Scroll the preview to `line` (1-based) of a rendered code block and highlight it. streamdown's
 * code block renders one `span` per source line directly under `pre > code`; the first code block
 * in `container` is the file.
 */
function useLineFocus(container: RefObject<HTMLDivElement | null>, line: number | null, ready: unknown) {
  useEffect(() => {
    if (!line || !ready) return;
    let tries = 0;
    let timer = 0;
    let marked: Element | null = null;
    const focus = () => {
      const el = container.current?.querySelector("pre")?.querySelectorAll(":scope > code > span")[line - 1];
      if (!el) {
        // The highlighter renders asynchronously; retry for a moment.
        if (tries++ < 40) timer = window.setTimeout(focus, 50);
        return;
      }
      marked = el;
      el.setAttribute("data-focus-line", "");
      el.scrollIntoView({ block: "center" });
    };
    focus();
    return () => {
      window.clearTimeout(timer);
      marked?.removeAttribute("data-focus-line");
    };
  }, [container, line, ready]);
}

export function PreviewBody(props: SideBodyProps<PreviewState>) {
  const { instance } = props;
  const { t } = useI18n();
  const { api, scope } = useSelectedWorkspace();
  const hostRead = useApp((s) => selectedFeatures(s).has(HOST_FILE_READ_FEATURE));
  const { path, line, host, source } = instance.state;
  const [file, setFile] = useState<FsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const canRead = host ? hostRead : !!scope;
  // PDF / DOCX / other office formats: components/DocumentPreview.tsx reads them itself.
  const doc = docKindOf(path);
  useEffect(() => {
    setFile(null);
    setError(null);
    if (!canRead || doc) return;
    // Images up to the message-thumbnail limit (the default 2 MiB would cut a larger one off).
    const maxBytes = isThumbnailPath(path) ? THUMBNAIL_MAX_BYTES : undefined;
    const read = host ? api.hostFile(path, maxBytes) : api.fsFile(scope!, path, maxBytes);
    let live = true;
    read.then(
      (f) => live && setFile(f),
      (e: unknown) => live && setError(workspaceError(e)),
    );
    return () => {
      live = false;
    };
  }, [api, scope, path, host, canRead, doc]);
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(path);
  // SVG comes back as text: shown as an image (<img> from a data: URL), with 源码 as for Markdown.
  const image = file ? thumbnailSrc(file) : null;
  const isSvg = !!file && file.encoding === "utf8" && !!image;
  const asCode = !!file && file.encoding === "utf8" && (!(isMarkdown || isSvg) || !!source);
  useLineFocus(body, line ?? null, asCode ? file : null);
  if (!canRead) return <p className="p-3 text-xs text-subtle">{t(host ? "workspace.hostReadMissing" : "workspace.noScope")}</p>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-1 text-xs">
        {host && (
          <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-subtle" title={t("workspace.hostFileHint")}>
            {t("workspace.hostFile")}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-muted" title={path} dir={host ? "rtl" : undefined}>
          <bdi>
            {path}
            {line ? <span className="text-subtle">:{line}</span> : null}
          </bdi>
        </span>
        <PathActions {...props} />
      </div>
      {doc ? (
        <div className="min-h-0 flex-1">
          <DocumentPreview
            name={path}
            loadKey={`${host ? "host" : `${scope?.kind}:${scope?.id}`}|${path}`}
            load={() =>
              loadFsDoc(doc, path, (maxBytes) => (host ? api.hostFile(path, maxBytes) : api.fsFile(scope!, path, maxBytes))).catch((e: unknown) => {
                throw new Error(workspaceError(e));
              })
            }
          />
        </div>
      ) : (
      <div ref={body} className="min-h-0 flex-1 overflow-auto px-3 py-2 text-sm">
        {error && <p className="text-xs text-danger">{error}</p>}
        {!file && !error && <p className="text-xs text-subtle">…</p>}
        {file && image && (!isSvg || !source) && <img alt={file.path} src={image} className="max-w-full" />}
        {file && file.encoding === "base64" && !file.mime.startsWith("image/") && <p className="text-xs text-subtle">{t("workspace.binary", { mime: file.mime, size: file.size })}</p>}
        {file && file.encoding === "utf8" && !(isSvg && !source) && (isMarkdown && !source ? <Markdown text={file.content} document /> : <Markdown text={fence(languageFor(file.path), file.content)} uncappedCode />)}
        {file?.truncated && <p className="mt-2 text-xs text-warn">{t("workspace.truncated")}</p>}
      </div>
      )}
    </div>
  );
}

/** End of the path row: 源码 / 渲染 (Markdown, SVG) and 复制绝对路径. */
function PathActions({ instance, setState }: SideBodyProps<PreviewState>) {
  const { t } = useI18n();
  const { scope } = useSelectedWorkspace();
  const root = useApp((s) => (!instance.state.host && scope ? rootFor(selectedSidebar(s), scope) : null));
  const [copied, setCopied] = useState(false);
  const { path, source, host } = instance.state;
  const sep = root?.includes("\\") ? "\\" : "/";
  const absolute = root ? `${root.replace(/[\\/]+$/, "")}${sep}${sep === "\\" ? path.replace(/\//g, "\\") : path}` : path;
  const button = "shrink-0 rounded px-1.5 py-0.5 text-[11.5px] text-subtle hover:bg-hover hover:text-foreground";
  return (
    <>
      {isSourceToggleable(path) && (
        <button onClick={() => setState({ ...instance.state, source: !source })} className={button}>
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
          {copied ? t("workspace.copied") : t("workspace.copyPath")}
        </button>
      )}
    </>
  );
}
