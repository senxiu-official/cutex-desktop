// Agent message rendering via streamdown (as in ZCode's ai-elements/message.tsx).
// Streaming mode only while the message is still streaming: ZCode hit React #185 (max update depth)
// with long completed messages in streaming mode, so completed messages render static.
// Links whose href resolves to a workspace file open the side-pane preview (DESIGN §4.6); other
// file-looking links (outside the root, unknown root, `~`) preview by absolute host path when cutex
// has fs-file-read, else open a path menu instead of going dead. File links carry a file-type icon;
// image files (links and `![](path)`) show an inline thumbnail read through the same cutex routes.
// `cutex:<kind>/<key>` links / images (v1.7, docs/desktop-modules.md §19.6) become ref chips
// (components/CutexLink.tsx) when a module provides that kind; core never names one.
// Fenced code blocks of a live agent reply (CodeBlockScope, from Timeline.tsx) carry the modules'
// `timeline.codeBlockAction` items after Copy / Download (v1.14, §22); everywhere else they are
// streamdown's own blocks, unchanged.
import { openModifiers, type OpenModifiers } from "../lib/openModifiers";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createContext, memo, useContext, type AnchorHTMLAttributes, type ComponentType, type HTMLAttributes, type ImgHTMLAttributes, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { rehypeFontRuns } from "../lib/rehypeFontRuns";
import { createHastCachePlugin } from "../lib/markdownCache";
import { PreserveTextSelection } from "./PreserveTextSelection";
import { Image as ImageIcon } from "lucide-react";
import { defaultComponents, defaultRehypePlugins, Streamdown } from "streamdown";
import type { FsFile } from "../../../shared/ipc";
import { baseName, escapeFileHref, HOST_FILE_READ_FEATURE, resolveFileHref, rootFor, scopeFor, scopeKey, unescapeFileHref } from "../lib/workspace";
import { useHostHome } from "../lib/hostHome";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { agentHost, hostApi, selectedFeatures, selectedSidebar, useApp } from "../store";
import { api } from "../bridge";
import { useI18n } from "../i18n";
import { contextMenu, openMenuFrom, type MenuEntry } from "../lib/contextMenu";
import { copyText, fileMenu, outsideFileMenu } from "../lib/menus";
import { fileKind, isThumbnailPath, THUMBNAIL_MAX_BYTES, type FileKind } from "../lib/fileKinds";
import { FILE_KIND_ICON } from "../lib/fileKindIcons";
import { useThumbnail } from "../lib/fileThumbnails";
import { useUiPrefs } from "../lib/prefs";
import { openFile, openHostFile } from "../lib/sideOpen";
import { escapeCutexHref, parseCutexLink, unescapeCutexHref } from "../lib/cutexLinks";
import { CutexImage, CutexLink } from "./CutexLink";
import { CodeBlockScope, fenceLanguage } from "../lib/codeBlockScope";
import { ReplyCodeBlock } from "./ReplyCodeBlock";
import { useStreamdownTranslations } from "../lib/streamdownTranslations";

const plugins = { cjk, code };
// Default rehype plugins minus `harden`: with no defaultOrigin it blocks relative hrefs, which are
// exactly our workspace file links. Link safety is enforced in `FileAwareLink` instead.
// `D:/x`, `file:///x` and `README.md:12` would lose their href (or an image its src) in `sanitize`
// (unknown "protocol"): carry them through it escaped (see `escapeFileHref`), right before it.
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}
function escapeFileHrefs() {
  const walk = (node: HastNode) => {
    const attr = node.type === "element" ? (node.tagName === "a" ? "href" : node.tagName === "img" ? "src" : null) : null;
    const value = attr ? node.properties?.[attr] : undefined;
    if (attr && typeof value === "string") {
      const escaped = escapeCutexHref(value) ?? escapeFileHref(value);
      if (escaped) node.properties![attr] = escaped;
    }
    node.children?.forEach(walk);
  };
  return (tree: HastNode) => walk(tree);
}
const rehypePlugins = [
  ...Object.entries(defaultRehypePlugins)
    .filter(([name]) => name !== "harden")
    .flatMap(([name, plugin]) => (name === "sanitize" ? [escapeFileHrefs, plugin] : [plugin])),
  rehypeFontRuns,
];
// Completed messages: the same list plus the cross-mount hast cache (lib/markdownCache), last, so a
// remount (switching back to a session) skips the parse. Never while streaming: the text changes.
const staticRehypePlugins = [...rehypePlugins, createHastCachePlugin()];
const SAFE_EXTERNAL = /^(https?:|mailto:)/i;


/**
 * A file link rendered without a navigable href (the click is ours; middle-click / drag can never
 * hand a path or a disguised URL to the browser), still focusable and Enter-activated.
 */
function FileChip({ title, dotted, kind, onActivate, onContextMenu, children }: { title: string; dotted?: boolean; kind: FileKind; onActivate(el: HTMLElement, mods?: OpenModifiers): void; onContextMenu(e: ReactMouseEvent): void; children: ReactNode }) {
  const Icon = FILE_KIND_ICON[kind];
  return (
    <a
      role="link"
      tabIndex={0}
      title={title}
      className={`cursor-pointer text-accent hover:underline ${dotted ? "underline decoration-dotted underline-offset-2" : ""}`}
      onContextMenu={onContextMenu}
      onClick={(e) => {
        e.preventDefault();
        onActivate(e.currentTarget, openModifiers(e));
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onActivate(e.currentTarget, openModifiers(e));
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        onActivate(e.currentTarget, openModifiers(e));
      }}
    >
      <Icon aria-hidden size="1em" strokeWidth={1.75} className="mr-[0.2em] inline-block shrink-0 align-[-0.125em] opacity-80" />
      {children}
    </a>
  );
}

/** A markdown href / src that points at a file on the agent's host, with what a click does. */
interface FileLink {
  /** The path as written (decides the icon). */
  path: string;
  title: string;
  dotted: boolean;
  /** Click / Enter; `mods` = Ctrl/⌘ / middle click (lib/openModifiers): a new kept tab, background unless Shift. */
  activate(el: HTMLElement, mods?: OpenModifiers): void;
  menu(): MenuEntry[];
  /** Thumbnail cache key + reader through cutex fs/file; null when the file cannot be read. */
  key: string | null;
  read: (() => Promise<FsFile>) | null;
}

/**
 * false inside a document read on its own whose relative paths have no base here (an artifact: the
 * store serves only the artifact itself, not files next to its source). Relative links / images then
 * render as inert text / an image placeholder instead of resolving against the open agent's workspace.
 */
const RelativeFiles = createContext(true);
const ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|[\\/]|~(?=$|[\\/]))/;

function useFileLink(href: string | undefined): FileLink | null {
  const relativeFiles = useContext(RelativeFiles);
  const sidebar = useApp(selectedSidebar);
  const selectedId = useApp((s) => s.selectedId);
  const hostRead = useApp((s) => selectedFeatures(s).has(HOST_FILE_READ_FEATURE));
  // The open agent's host (it may not be the focus host).
  const hostId = useApp(agentHost);
  const remote = hostId !== LOCAL_HOST_ID;
  const { t } = useI18n();
  const home = useHostHome(!!href && /^~(?=$|[\\/])/.test(href));
  if (!href) return null;
  const scope = scopeFor(sidebar, selectedId);
  const root = scope ? rootFor(sidebar, scope) : null;
  const ref = resolveFileHref(href, root, home);
  if (!ref) return null;
  if (!relativeFiles && !ABSOLUTE_PATH.test(ref.path)) return null;
  // Inside the agent's workspace: the daemon serves it (fs/file), local or remote host alike.
  if (ref.rel && scope) {
    const rel = ref.rel;
    return {
      path: ref.path,
      title: ref.line ? `${rel}:${ref.line}` : rel,
      dotted: false,
      activate: (_el, mods) => void openFile(rel, ref.line, "link", mods),
      menu: () => fileMenu(rel, root, t),
      key: `${hostId}|${scopeKey(scope)}|${rel}`,
      read: () => hostApi(hostId).fsFile(scope, rel, THUMBNAIL_MAX_BYTES),
    };
  }
  // Outside what the workspace fs/file serves (outside the root, no known root, `~` with no
  // home): with fs-file-read and an absolute path, click previews it by host path (local or
  // remote host alike); otherwise click → full path + copy / reveal (local host only).
  const shown = ref.abs ?? ref.path;
  const full = ref.line ? `${shown}:${ref.line}` : shown;
  const abs = ref.abs;
  const preview = hostRead && abs ? (mods?: OpenModifiers) => void openHostFile(abs, ref.line, mods) : null;
  const menu = () => outsideFileMenu(ref, full, remote, t, preview);
  return {
    path: ref.path,
    title: full,
    dotted: !preview,
    activate: (el, mods) => (preview ? preview(mods) : openMenuFrom(el, menu())),
    menu,
    key: preview && abs ? `${hostId}|host|${abs}` : null,
    read: preview && abs ? () => hostApi(hostId).hostFile(abs, THUMBNAIL_MAX_BYTES) : null,
  };
}

/**
 * Inline image for a file link: a placeholder until scrolled near the viewport, then the bytes from
 * cutex. Renders `fallback` when the image cannot be shown (missing, too big, no capability).
 */
function Thumbnail({ link, alt, fallback }: { link: FileLink; alt: string; fallback: ReactNode }) {
  const { ref, state } = useThumbnail(link.key, link.read);
  if (state.status === "failed") return <>{fallback}</>;
  return (
    <span ref={ref} className="my-1.5 block">
      {state.status === "ok" ? (
        <img
          src={state.src}
          alt={alt}
          title={link.title}
          draggable={false}
          tabIndex={0}
          role="link"
          onClick={(e) => link.activate(e.currentTarget, openModifiers(e))}
          onAuxClick={(e) => e.button === 1 && link.activate(e.currentTarget, openModifiers(e))}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            link.activate(e.currentTarget, openModifiers(e));
          }}
          onContextMenu={contextMenu(link.menu)}
          className="block h-auto max-h-80 w-auto max-w-[min(100%,320px)] cursor-zoom-in rounded-md border border-border bg-surface-2 object-contain"
        />
      ) : (
        <span aria-hidden className="block h-24 w-40 animate-pulse rounded-md border border-border bg-surface-2" />
      )}
    </span>
  );
}

function FileAwareLink({ href: rawHref, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const { t } = useI18n();
  const images = useUiPrefs().messageImages;
  const href = rawHref ? unescapeFileHref(rawHref) : rawHref;
  const link = useFileLink(href);
  delete (rest as { node?: unknown }).node;
  if (link) {
    const chip = (
      <FileChip title={link.title} dotted={link.dotted} kind={fileKind(link.path)} onContextMenu={contextMenu(link.menu)} onActivate={link.activate}>
        {children}
      </FileChip>
    );
    if (images !== "thumbnail" || !link.read || !isThumbnailPath(link.path)) return chip;
    return (
      <>
        {chip}
        <Thumbnail link={link} alt={baseName(link.path)} fallback={null} />
      </>
    );
  }
  if (!href || !SAFE_EXTERNAL.test(href)) return <span title={href}>{children}</span>;
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent hover:underline"
      onContextMenu={contextMenu(() => [
        { label: t("menu.openLink"), onSelect: () => void api.openExternal(href) },
        { label: t("menu.copyLink"), onSelect: () => copyText(href) },
      ])}
    >
      {children}
    </a>
  );
}

/**
 * `![alt](path)`: a host / workspace image shows as a thumbnail (else an icon link named by its
 * alt text). Remote images are never fetched (the CSP blocks them anyway): they become a link.
 */
function FileAwareImage({ src: rawSrc, alt }: ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) {
  const { t } = useI18n();
  const images = useUiPrefs().messageImages;
  const src = typeof rawSrc === "string" ? unescapeFileHref(rawSrc) : undefined;
  const relativeFiles = useContext(RelativeFiles);
  const link = useFileLink(src);
  if (link) {
    const label = alt?.trim() || baseName(link.path);
    const chip = (
      <FileChip title={link.title} dotted={link.dotted} kind={fileKind(link.path)} onContextMenu={contextMenu(link.menu)} onActivate={link.activate}>
        {label}
      </FileChip>
    );
    if (images !== "thumbnail" || !link.read || !isThumbnailPath(link.path)) return chip;
    return <Thumbnail link={link} alt={label} fallback={chip} />;
  }
  if (src && /^https?:/i.test(src)) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        title={src}
        className="text-accent hover:underline"
        onContextMenu={contextMenu(() => [
          { label: t("menu.openLink"), onSelect: () => void api.openExternal(src) },
          { label: t("menu.copyLink"), onSelect: () => copyText(src) },
        ])}
      >
        <ImageIcon aria-hidden size="1em" strokeWidth={1.75} className="mr-[0.2em] inline-block align-[-0.125em] opacity-80" />
        {alt?.trim() || src}
      </a>
    );
  }
  // A relative image in a document without a base (RelativeFiles): a placeholder with its alt text.
  if (!relativeFiles && src && !/^data:/i.test(src))
    return (
      <span title={src} className="inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-[0.9em] text-subtle">
        <ImageIcon aria-hidden size="1em" strokeWidth={1.75} className="shrink-0 opacity-80" />
        {alt?.trim() || baseName(src)}
      </span>
    );
  // data: images and the like: allowed by the CSP, rendered as-is but bounded.
  if (src && /^data:image\/(png|jpeg|gif|webp|bmp);base64,/i.test(src)) return <img src={src} alt={alt ?? ""} className="my-1.5 block h-auto max-w-[min(100%,320px)] rounded-md border border-border" />;
  return <span title={src}>{alt}</span>;
}

/** `cutex:<kind>/<key>` (v1.7, §19.6) first: a separate component, so hooks never mix between the two. */
function MarkdownLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) {
  const href = unescapeCutexHref(props.href);
  const target = href ? parseCutexLink(href) : null;
  if (href && target) return <CutexLink href={href} target={target}>{props.children}</CutexLink>;
  return <FileAwareLink {...props} />;
}

function MarkdownImage(props: ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) {
  const src = unescapeCutexHref(typeof props.src === "string" ? props.src : null);
  const target = src ? parseCutexLink(src) : null;
  if (src && target) return <CutexImage src={src} target={target} alt={props.alt ?? ""} />;
  return <FileAwareImage {...props} />;
}

type CodeProps = HTMLAttributes<HTMLElement> & { node?: unknown; "data-block"?: string };
const DefaultCode = defaultComponents.code as ComponentType<CodeProps>;

/**
 * Inline code, untagged / mermaid blocks and any Markdown outside a reply scope: streamdown's own.
 * A tagged block in a reply scope asks the `timeline.codeBlockAction` items (§22).
 */
function MarkdownCode(props: CodeProps) {
  const scope = useContext(CodeBlockScope);
  const language = fenceLanguage(props.className);
  if (!scope || !("data-block" in props) || !language || language.toLowerCase() === "mermaid") return <DefaultCode {...props} />;
  return <ReplyCodeBlock {...props} scope={scope} language={language} />;
}

const components = { a: MarkdownLink, img: MarkdownImage, code: MarkdownCode };

/**
 * `document`: a whole file / artifact read on its own (side-pane preview): full-size headings. Everywhere
 * else (chat, cards) headings stay near the body size (UI review #14, styles.css `.markdown` headings).
 * `relativeFiles = false`: relative links / images have no base (see RelativeFiles) and stay inert.
 */
export const Markdown = memo(function Markdown({ text, streaming = false, compact = false, document = false, relativeFiles = true, uncappedCode = false }: { text: string; streaming?: boolean; /** 13px (reasoning text). */ compact?: boolean; document?: boolean; relativeFiles?: boolean; /** Code blocks grow to their full height (a whole file shown as one block; `document` implies it, and uncaps tables too); default: streamdown's 400px cap with an inner scroll. */ uncappedCode?: boolean }) {
  const translations = useStreamdownTranslations();
  return (
    <RelativeFiles.Provider value={relativeFiles}>
      <PreserveTextSelection revision={`${streaming ? "streaming" : "static"}:${text}`}>
        <Streamdown
          className={`markdown leading-relaxed ${document ? "markdown-document " : ""}${compact ? "text-[length:calc(var(--chat-font-size,14px)-1px)]" : "text-[length:var(--chat-font-size,14px)]"}`}
          mode={streaming ? "streaming" : "static"}
          isAnimating={streaming}
          parseIncompleteMarkdown={streaming}
          plugins={plugins}
          components={components}
          rehypePlugins={streaming ? rehypePlugins : staticRehypePlugins}
          shikiTheme={["github-light", "github-dark"]}
          translations={translations}
          // A whole document or file (side preview, artifact) scrolls as one: no inner height caps on its code
          // blocks and tables (streamdown defaults: 400px / 300px). Chat keeps them.
          {...(uncappedCode || document ? { codeBlockMaxHeight: Number.POSITIVE_INFINITY } : {})}
          {...(document ? { tableMaxHeight: Number.POSITIVE_INFINITY } : {})}
        >
          {text}
        </Streamdown>
      </PreserveTextSelection>
    </RelativeFiles.Provider>
  );
});
