// One file's contents, as the 预览 card and the 文件 explorer's built-in preview show it (docs/design/019 §6:
// the same renderer for both): code highlighted, Markdown / SVG / HTML rendered (or as source; HTML as a page in the
// shared opaque frame, components/FilePageFrame — main reads its bytes, nothing loads), images, PDF / DOCX /
// other office formats (components/DocumentPreview), a binary note, the truncation note. The bytes come from
// cutex: a workspace path through the workspace route (fs/file), `host` = an absolute path on the host
// (fs-file-read).
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { FILE_PAGE_MAX_BYTES } from "../../../../shared/frames";
import type { DaemonApi, FsFile, WorkspaceScope } from "../../../../shared/ipc";
import { DocumentPreview } from "../../components/DocumentPreview";
import { FilePageFrame, type FilePageProblem } from "../../components/FilePageFrame";
import { Markdown } from "../../components/Markdown";
import { SideImage } from "../../components/SideImage";
import { useI18n } from "../../i18n";
import { docKindOf, formatSize, loadFsDoc } from "../../lib/docPreview";
import { isNotAFileError } from "../../lib/pathKind";
import { isThumbnailPath, THUMBNAIL_MAX_BYTES, thumbnailSrc } from "../../lib/fileKinds";
import { languageFor } from "../../lib/workspace";
import { workspaceError } from "../../lib/workspaceView";
import { fence } from "./shared";
import { viewKindOf } from "./viewChoice";
import { useViewerRefresh } from "../../lib/useViewerRefresh";
import { rootFor } from "../../lib/workspace";
import { sidebarOf, useApp } from "../../store";

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

export interface FileViewProps {
  visible?: boolean;
  api: DaemonApi;
  /** The host the file is on (an HTML page is read by main from that host). */
  hostId?: string;
  scope: WorkspaceScope | null;
  path: string;
  host: boolean;
  line?: number | null;
  /** Markdown / SVG / HTML as source. */
  source?: boolean;
  /** Switch to / from source from inside the view (an HTML page that cannot be shown offers 看源码). */
  onSource?(source: boolean): void;
  /** The path turned out to be a folder (a restored tab, a bookmark). */
  onFolder?(): void;
  /** The file was read (size / time for a footer). */
  onLoaded?(file: FsFile | null): void;
}

export function FileView({ api, hostId, scope, path, host, visible = true, line = null, source = false, onSource, onFolder, onLoaded }: FileViewProps) {
  const { t } = useI18n();
  const [file, setFile] = useState<FsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const folder = useRef(onFolder);
  folder.current = onFolder;
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  // PDF / DOCX / other office formats: components/DocumentPreview.tsx reads them itself.
  const doc = docKindOf(path);
  // HTML shown as a page: main reads the bytes itself; the renderer does not.
  const page = viewKindOf(path) === "html" && !source && !!hostId && (host || !!scope);
  const root = useApp((s) => hostId && scope ? rootFor(sidebarOf(s, hostId), scope) : null);
  // Source previews are read-only. Opaque HTML may contain unsaved form input; never remount it silently.
  const refresh = useViewerRefresh(hostId, path, host ? null : root, visible, page);
  useEffect(() => {
    setFile(null);
    setError(null);
    loaded.current?.(null);
    if ((!host && !scope) || doc || page) return;
    // Images up to the message-thumbnail limit (the default 2 MiB would cut a larger one off).
    const maxBytes = isThumbnailPath(path) ? THUMBNAIL_MAX_BYTES : undefined;
    const read = host ? api.hostFile(path, maxBytes) : api.fsFile(scope!, path, maxBytes);
    let live = true;
    read.then(
      (f) => {
        if (!live) return;
        setFile(f);
        loaded.current?.(f);
      },
      (e: unknown) => {
        if (!live) return;
        if (isNotAFileError(e) && folder.current) return folder.current();
        setError(workspaceError(e));
      },
    );
    return () => {
      live = false;
    };
  }, [api, scope, path, host, doc, page, refresh.revision]);
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(path);
  // SVG comes back as text: shown as an image (<img> from a data: URL), with 源码 as for Markdown.
  const image = file ? thumbnailSrc(file) : null;
  const isSvg = !!file && file.encoding === "utf8" && !!image;
  const asCode = !!file && file.encoding === "utf8" && (!(isMarkdown || isSvg) || source);
  useLineFocus(body, line, asCode ? file : null);
  if (page) return <>{refresh.changed && <div data-file-changed="" role="status" className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-xs"><span className="min-w-0 flex-1">{t("workspace.changedOnDisk")}</span><button className="shrink-0 whitespace-nowrap rounded border border-border px-2 py-1 hover:bg-hover" onClick={refresh.reload}>{t("workspace.reloadChanged")}</button></div>}<HtmlPage key={`${hostId}|${scope?.kind}:${scope?.id}|${path}|${refresh.revision}`} hostId={hostId!} scope={host ? null : scope} path={path} onSource={onSource} /></>;
  if (doc)
    return (
      <div className="min-h-0 flex-1">
        <DocumentPreview
          name={path}
          loadKey={`${host ? "host" : `${scope?.kind}:${scope?.id}`}|${path}|${refresh.revision}`}
          load={() =>
            loadFsDoc(doc, path, (maxBytes) => (host ? api.hostFile(path, maxBytes) : api.fsFile(scope!, path, maxBytes))).catch((e: unknown) => {
              throw new Error(workspaceError(e));
            })
          }
        />
      </div>
    );
  return (
    <div ref={body} className="min-h-0 flex-1 overflow-auto px-3 py-2 text-sm">
      {error && <p className="text-xs text-danger">{error}</p>}
      {!file && !error && <p className="text-xs text-subtle">…</p>}
      {file && image && (!isSvg || !source) && <SideImage key={image} alt={file.path} src={image} hostId={hostId} imgClassName="block max-w-full" />}
      {file && file.encoding === "base64" && !file.mime.startsWith("image/") && <p className="text-xs text-subtle">{t("workspace.binary", { mime: file.mime, size: file.size })}</p>}
      {file && file.encoding === "utf8" && !(isSvg && !source) && (isMarkdown && !source ? <Markdown text={file.content} document /> : <Markdown text={fence(languageFor(file.path), file.content)} uncappedCode />)}
      {file?.truncated && <p className="mt-2 text-xs text-warn">{t("workspace.truncated")}</p>}
    </div>
  );
}

/**
 * An HTML file as a page (owner 2026-10-24): FilePageFrame mounts main's offline document. Over
 * FILE_PAGE_PROMPT_BYTES it asks first; over FILE_PAGE_MAX_BYTES (one cutex read) it can only show the source.
 * Inline-only: when the page refers to files next to it or to the network, a note says they do not load.
 */
function HtmlPage({ hostId, scope, path, onSource }: { hostId: string; scope: WorkspaceScope | null; path: string; onSource?(source: boolean): void }) {
  const { t } = useI18n();
  const [large, setLarge] = useState(false);
  const [problem, setProblem] = useState<{ kind: FilePageProblem; bytes?: number } | null>(null);
  const [refs, setRefs] = useState(0);
  const [ready, setReady] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const [mount, setMount] = useState(0);
  const name = path.split(/[\\/]/).pop() ?? path;
  const sourceButton = onSource && (
    <button onClick={() => onSource(true)} data-page-source="" className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-hover">
      {t("workspace.page.viewSource")}
    </button>
  );
  const note = (text: string, actions?: ReactNode) => (
    <div data-page-note="" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface p-4 text-center text-xs text-subtle">
      <p className="max-w-80">{text}</p>
      <div className="flex gap-2">
        {actions}
        {sourceButton}
      </div>
    </div>
  );
  let overlay: ReactNode = null;
  if (problem) {
    const size = problem.bytes != null ? formatSize(problem.bytes) : "";
    if (problem.kind === "too-large" && !large && (problem.bytes ?? 0) <= FILE_PAGE_MAX_BYTES)
      overlay = note(
        t("workspace.page.large", { size }),
        <button
          data-page-show-large=""
          onClick={() => {
            setProblem(null);
            setLarge(true);
          }}
          className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-hover"
        >
          {t("workspace.page.showLarge")}
        </button>,
      );
    else if (problem.kind === "too-large") overlay = note(t("workspace.page.tooLarge", { size, max: formatSize(FILE_PAGE_MAX_BYTES) }));
    else overlay = note(t(problem.kind === "not-text" ? "workspace.page.notText" : problem.kind === "host-offline" ? "workspace.page.offline" : problem.kind === "unavailable" ? "workspace.page.unavailable" : "workspace.page.failed"));
  } else if (navigated)
    overlay = note(
      t("workspace.page.navigated"),
      <button
        onClick={() => {
          setNavigated(false);
          setReady(false);
          setMount((n) => n + 1);
        }}
        className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-hover"
      >
        {t("workspace.page.reload")}
      </button>,
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {ready && refs > 0 && !problem && (
        <p data-page-refs="" className="shrink-0 border-b border-border/60 bg-surface px-3 py-1 text-caption/[inherit] text-subtle">
          {t("workspace.page.refs", { n: refs })}
        </p>
      )}
      <div className="relative min-h-72 flex-1">
        {!problem && (
          <FilePageFrame
            hostId={hostId}
            path={path}
            scope={scope}
            title={t("workspace.page.title", { name })}
            large={large}
            mount={mount}
            onProblem={(kind, bytes) => setProblem({ kind, ...(bytes != null ? { bytes } : {}) })}
            onReady={(n) => {
              setRefs(n);
              setReady(true);
            }}
            onNavigated={() => setNavigated(true)}
          />
        )}
        {!ready && !problem && !navigated && <p className="absolute left-3 top-2 text-xs text-subtle">{t("workspace.page.loading")}</p>}
        {overlay}
      </div>
    </div>
  );
}
