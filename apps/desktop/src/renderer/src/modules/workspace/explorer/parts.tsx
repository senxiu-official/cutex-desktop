// The 文件 explorer's views (docs/design/019): the virtualised tree list with sticky parent folders, the
// gallery, the built-in preview and the search results. State and actions live in Explorer.tsx; these
// only draw what they are given and report clicks / keys.
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ChevronRight, CornerUpRight, ExternalLink, FolderOpen, MoreHorizontal } from "lucide-react";
import type { DaemonApi, FsEntry, FsFile, WorkspaceScope } from "../../../../../shared/ipc";
import { useI18n } from "../../../i18n";
import { fileKind, isThumbnailPath } from "../../../lib/fileKinds";
import { FILE_KIND_ICON } from "../../../lib/fileKindIcons";
import { FileView } from "../FileView";
import { rememberSourceChoice, useSourceChoice, viewKindOf } from "../viewChoice";
import { reconsiderFileRender } from "../../../lib/largeRenderChoices";
import { stickyAncestors, type EntryRow, type GitMark, type Row } from "./model";
import { cachedThumb, loadThumb, THUMB_MAX_BYTES } from "./thumbs";
import { Tag } from "../../../components/Tag";
import { useOwnerWindow } from "../../../lib/ownerContext";

export const ROW_H = 24;

const GIT_CLASS: Record<GitMark, string> = { M: "text-warn", A: "text-ok-text", U: "text-ok-text", D: "text-danger", R: "text-warn", C: "text-ok-text", T: "text-warn", "!": "text-danger" };

export function gitClass(mark: GitMark | null): string {
  return mark ? GIT_CLASS[mark] : "";
}

/** The row's kind icon (lib/fileKindIcons; a folder shows open while expanded). */
export function EntryIcon({ path, isDir, open = false, size = 14 }: { path: string; isDir: boolean; open?: boolean; size?: number }) {
  const Icon = isDir ? (open ? FolderOpen : FILE_KIND_ICON.folder) : FILE_KIND_ICON[fileKind(path)];
  return <Icon aria-hidden size={size} strokeWidth={1.75} className={`shrink-0 ${isDir ? "text-accent/80" : "text-subtle"}`} />;
}

/** `name` with the filter's first match marked. */
function Highlighted({ name, filter }: { name: string; filter: string }) {
  const f = filter.trim().toLowerCase();
  const i = f ? name.toLowerCase().indexOf(f) : -1;
  if (i < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, i)}
      <mark className="rounded-sm bg-warn/30 text-inherit">{name.slice(i, i + f.length)}</mark>
      {name.slice(i + f.length)}
    </>
  );
}

export interface RowHandlers {
  onClick(e: MouseEvent, row: EntryRow): void;
  onDoubleClick(row: EntryRow): void;
  onChevron(row: EntryRow): void;
  onAux(e: MouseEvent, row: EntryRow): void;
  onMenu(e: MouseEvent, row: EntryRow): void;
  onDragStart(e: DragEvent, row: EntryRow): void;
  /** Double-click on one folder of a merged chain: go into that one. */
  onEnterPart(path: string): void;
}

interface TreeListProps extends RowHandlers {
  rows: readonly Row[];
  sel: string | null;
  multi: ReadonlySet<string>;
  filter: string;
  flash: string | null;
  /** Scroll the row at `index` into view (`center`), once per `seq`. */
  scrollTo: { index: number; center: boolean; seq: number } | null;
  initialScroll: number;
  onScrollTop(top: number): void;
  onKeyDown(e: KeyboardEvent<HTMLDivElement>): void;
  note(row: Exclude<Row, EntryRow>): ReactNode;
  label: string;
  listRef: React.RefObject<HTMLDivElement | null>;
}

/** The tree as one flat, virtualised list (fixed row height; only rows on screen are drawn). */
export function TreeList(props: TreeListProps) {
  const win = useOwnerWindow();
  const { rows, sel, multi, filter, flash, scrollTo, onKeyDown, note, label, listRef } = props;
  const [top, setTop] = useState(props.initialScroll);
  const [height, setHeight] = useState(400);
  const reportTop = useRef(props.onScrollTop);
  reportTop.current = props.onScrollTop;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = props.initialScroll;
    setHeight(el.clientHeight || 400);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new win.ResizeObserver(() => setHeight(el.clientHeight || 400));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const seq = scrollTo?.seq;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !scrollTo || scrollTo.index < 0) return;
    const y = scrollTo.index * ROW_H;
    const h = el.clientHeight || height;
    if (scrollTo.center) el.scrollTop = Math.max(0, y - h / 2 + ROW_H / 2);
    else if (y < el.scrollTop + stickyRoom(rows, scrollTo.index)) el.scrollTop = Math.max(0, y - stickyRoom(rows, scrollTo.index));
    else if (y + ROW_H > el.scrollTop + h) el.scrollTop = y + ROW_H - h;
    setTop(el.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);
  const first = Math.max(0, Math.floor(top / ROW_H));
  const from = Math.max(0, first - 10);
  const to = Math.min(rows.length, Math.ceil((top + height) / ROW_H) + 10);
  const sticky = top > 0 ? stickyAncestors(rows, first) : [];
  const selIndex = sel === null ? -1 : rows.findIndex((r) => r.type === "entry" && (r.path === sel || r.chain.some((c) => c.path === sel)));
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {sticky.length > 0 && (
        <div className="absolute inset-x-0 top-0 z-10 border-b border-border/60 bg-surface shadow-sm" style={{ marginRight: 8 }}>
          {sticky.map((i) => {
            const r = rows[i] as EntryRow;
            return <RowView key={`s${i}`} {...props} row={r} index={i} sel={sel} multi={multi} filter={filter} flash={null} top={null} onClick={() => props.listRef.current && (props.listRef.current.scrollTop = i * ROW_H)} />;
          })}
        </div>
      )}
    <div
      ref={listRef}
      role="tree"
      aria-label={label}
      aria-multiselectable
      aria-activedescendant={selIndex >= 0 ? `fx-row-${selIndex}` : undefined}
      tabIndex={0}
      data-explorer-list=""
      onKeyDown={onKeyDown}
      onScroll={(e) => {
        const t = e.currentTarget.scrollTop;
        setTop(t);
        reportTop.current(t);
      }}
      className="group/list relative min-h-0 flex-1 overflow-y-auto outline-none"
    >
      <div style={{ height: rows.length * ROW_H, position: "relative" }}>
        {rows.slice(from, to).map((row, k) => {
          const i = from + k;
          if (row.type !== "entry")
            return (
              <div key={`n${i}:${row.path}:${row.type}`} className={`absolute inset-x-0 flex items-center truncate pr-2 text-xs ${row.type === "error" ? "text-danger" : "text-subtle"}`} style={{ top: i * ROW_H, height: ROW_H, paddingLeft: 22 + row.depth * 12 }}>
                {note(row)}
              </div>
            );
          return <RowView key={row.path} {...props} row={row} index={i} sel={sel} multi={multi} filter={filter} flash={flash} top={i * ROW_H} />;
        })}
      </div>
    </div>
    </div>
  );
}

/** How far the sticky folders reach down over the list for the row at `index`. */
function stickyRoom(rows: readonly Row[], index: number): number {
  return stickyAncestors(rows, index).length * ROW_H;
}

function RowView(props: RowHandlers & { row: EntryRow; index: number; sel: string | null; multi: ReadonlySet<string>; filter: string; flash: string | null; top: number | null }) {
  const { t } = useI18n();
  const { row, index, sel, multi, filter, flash, top } = props;
  const selected = sel !== null && (row.path === sel || row.chain.some((c) => c.path === sel));
  const outside = row.entry.kind === "symlink" && row.entry.targetKind === null;
  return (
    <div
      id={top === null ? undefined : `fx-row-${index}`}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.dir ? row.open : undefined}
      aria-selected={selected || multi.has(row.path)}
      data-path={row.path}
      data-selected={selected || undefined}
      data-flash={flash === row.path || undefined}
      draggable
      onDragStart={(e) => props.onDragStart(e, row)}
      onClick={(e) => props.onClick(e, row)}
      onDoubleClick={() => props.onDoubleClick(row)}
      onAuxClick={(e) => props.onAux(e, row)}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onContextMenu={(e) => props.onMenu(e, row)}
      title={outside ? t("workspace.fx.symlinkOutside") : row.path}
      className={`${top === null ? "relative" : "absolute inset-x-0"} flex cursor-default select-none items-center gap-1.5 pr-2 text-ui/[inherit] ${
        selected ? "bg-accent/20 group-focus/list:inset-ring group-focus/list:inset-ring-accent" : multi.has(row.path) ? "bg-accent/10" : "hover:bg-surface-2"
      } ${row.entry.ignored ? "text-muted" : ""} ${flash === row.path ? "fx-flash" : ""}`}
      style={{ top: top ?? undefined, height: ROW_H, paddingLeft: 4 + row.depth * 12 }}
    >
      <span
        className="flex w-3 shrink-0 justify-center text-subtle"
        onClick={(e) => {
          if (!row.dir) return;
          e.stopPropagation();
          props.onChevron(row);
        }}
      >
        {row.dir && <ChevronRight size={11} className={`transition-transform ${row.open ? "rotate-90" : ""}`} />}
      </span>
      <span className={row.entry.ignored ? "opacity-50" : ""}>
        <EntryIcon path={row.path} isDir={row.dir} open={row.open} />
      </span>
      <span className={`min-w-0 truncate ${gitClass(row.git)} ${row.entry.ignored ? "opacity-60" : ""}`}>
        {row.chain.length > 1
          ? row.chain.map((c, k) => (
              <span key={c.path}>
                {k > 0 && <span className="px-px text-subtle">/</span>}
                <span
                  className="hover:underline"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    props.onEnterPart(c.path);
                  }}
                >
                  {c.name}
                </span>
              </span>
            ))
          : <Highlighted name={row.entry.name} filter={filter} />}
      </span>
      {outside && <CornerUpRight size={11} className="shrink-0 text-subtle" aria-hidden />}
      {row.forced && <Tag>{t("workspace.fx.hiddenTag")}</Tag>}
      <span className="ml-auto" />
      {row.git && (
        <span className={`shrink-0 font-mono text-caption/[inherit] font-semibold ${gitClass(row.git)}`} title={t(`workspace.fx.git.${row.git === "!" ? "conflict" : row.git}` as never)}>
          {row.git}
        </span>
      )}
      {row.dir && row.dirty && !row.open && <span className="size-1.5 shrink-0 rounded-full bg-warn" title={t("workspace.fx.dirty")} />}
    </div>
  );
}

// ---------- gallery ----------

const TILE = [96, 132, 180] as const;

export function galleryColumns(width: number, thumb: 0 | 1 | 2): number {
  return Math.max(1, Math.floor((width - 16 + 8) / (TILE[thumb] + 8)));
}

interface GalleryProps {
  api: DaemonApi;
  scope: WorkspaceScope;
  thumbKey: string;
  entries: readonly FsEntry[];
  sel: string | null;
  multi: ReadonlySet<string>;
  thumb: 0 | 1 | 2;
  onClick(e: MouseEvent, entry: FsEntry): void;
  onDoubleClick(entry: FsEntry): void;
  onMenu(e: MouseEvent, entry: FsEntry): void;
  onDragStart(e: DragEvent, entry: FsEntry): void;
  onKeyDown(e: KeyboardEvent<HTMLDivElement>, columns: number): void;
  label: string;
  listRef: React.RefObject<HTMLDivElement | null>;
  empty: ReactNode;
}

export function Gallery(props: GalleryProps) {
  const win = useOwnerWindow();
  const { entries, sel, multi, thumb, listRef } = props;
  const [width, setWidth] = useState(400);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 400);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new win.ResizeObserver(() => setWidth(el.clientWidth || 400));
    ro.observe(el);
    return () => ro.disconnect();
  }, [listRef]);
  const columns = galleryColumns(width, thumb);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>("[data-selected]");
    el?.scrollIntoView?.({ block: "nearest" });
  }, [sel, listRef]);
  return (
    <div
      ref={listRef}
      role="grid"
      aria-label={props.label}
      tabIndex={0}
      data-explorer-list=""
      onKeyDown={(e) => props.onKeyDown(e, columns)}
      className="group/list min-h-0 flex-1 overflow-y-auto p-2 outline-none"
    >
      {entries.length === 0 && props.empty}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {entries.map((entry) => {
          const dir = entry.kind === "dir" || entry.targetKind === "dir";
          const selected = sel === entry.path;
          return (
            <div
              key={entry.path}
              role="gridcell"
              aria-selected={selected || multi.has(entry.path)}
              data-path={entry.path}
              data-selected={selected || undefined}
              draggable
              onDragStart={(e) => props.onDragStart(e, entry)}
              onClick={(e) => props.onClick(e, entry)}
              onDoubleClick={() => props.onDoubleClick(entry)}
              onContextMenu={(e) => props.onMenu(e, entry)}
              title={entry.name}
              className={`flex cursor-default select-none flex-col gap-1 rounded-lg p-1 ${selected ? "bg-accent/20 group-focus/list:ring-1 group-focus/list:ring-accent" : multi.has(entry.path) ? "bg-accent/10" : "hover:bg-surface-2"}`}
            >
              <div className="grid aspect-square place-items-center overflow-hidden rounded-md bg-surface-2">
                {dir ? <EntryIcon path={entry.path} isDir size={36} /> : <Thumb api={props.api} scope={props.scope} entry={entry} cacheKey={`${props.thumbKey}|${entry.path}|${entry.modifiedAt}`} />}
              </div>
              <div className="truncate text-center text-meta/[inherit]">{entry.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One thumbnail: read when it scrolls into view; too big / not an image = its icon. */
export function Thumb({ api, scope, entry, cacheKey }: { api: DaemonApi; scope: WorkspaceScope; entry: FsEntry; cacheKey: string }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const image = isThumbnailPath(entry.name);
  const tooBig = (entry.size ?? 0) > THUMB_MAX_BYTES;
  const [src, setSrc] = useState<string | null | undefined>(() => (image && !tooBig ? cachedThumb(cacheKey) : null));
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = box.current;
    if (!el || inView || typeof IntersectionObserver === "undefined") return;
    const io = new win.IntersectionObserver((list) => list.some((x) => x.isIntersecting) && setInView(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  useEffect(() => {
    if (!image || tooBig || !inView || src !== undefined) return;
    let live = true;
    void loadThumb(api, scope, entry.path, cacheKey).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [api, scope, entry.path, cacheKey, image, tooBig, inView, src]);
  return (
    <div ref={box} className="grid size-full place-items-center">
      {src ? (
        <img alt={entry.name} src={src} className="size-full object-cover" draggable={false} />
      ) : (
        <div className="flex flex-col items-center gap-1 px-1 text-center text-caption/[inherit] text-subtle">
          <EntryIcon path={entry.path} isDir={false} size={26} />
          {image && tooBig && <span>{t("workspace.fx.tooBig")}</span>}
        </div>
      )}
    </div>
  );
}

// ---------- built-in preview ----------

export interface PreviewTarget {
  path: string;
  name: string;
  dir: boolean;
  entry: FsEntry | null;
  git: GitMark | null;
}

interface InlinePreviewProps {
  visible: boolean;
  api: DaemonApi;
  hostId: string;
  scope: WorkspaceScope;
  thumbKey: string;
  target: PreviewTarget | null;
  multi: number;
  /** A folder's children (when read), for its summary. */
  children: readonly FsEntry[] | null;
  onOpenKept(): void;
  onEnter(): void;
  onMenu(el: HTMLElement): void;
  onFolder(): void;
}

export function InlinePreview({ api, hostId, scope, thumbKey, target, multi, children, onOpenKept, onEnter, onMenu, onFolder, visible }: InlinePreviewProps) {
  const { t } = useI18n();
  const [file, setFile] = useState<FsFile | null>(null);
  // Wait a moment before reading (holding ↓ does not read every row, 019 §6).
  const [shown, setShown] = useState<PreviewTarget | null>(target);
  // 预览 / 源码 follows the last choice for this kind of file (viewChoice; the toggle in the header changes it).
  const source = useSourceChoice(shown && !shown.dir ? viewKindOf(shown.path) : null);
  useEffect(() => {
    if (target?.path === shown?.path && target?.dir === shown?.dir) {
      setShown(target);
      return;
    }
    const timer = setTimeout(() => setShown(target), 120);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.path, target?.dir, target?.git]);
  if (multi > 1) return <p className="p-3 text-xs text-subtle">{t("workspace.fx.multi", { n: multi })}</p>;
  if (!shown) return <p className="p-3 text-xs text-subtle">{t("workspace.fx.pick")}</p>;
  const button = "grid size-6 shrink-0 place-items-center rounded text-subtle hover:bg-hover hover:text-foreground";
  const entry = shown.entry;
  const kind = shown.dir ? null : viewKindOf(shown.path);
  return (
    <div className="flex h-full min-h-0 flex-col" data-explorer-preview="">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 py-1 pl-2.5 pr-1 text-xs">
        <EntryIcon path={shown.path} isDir={shown.dir} />
        <span className="min-w-0 flex-1 truncate font-medium" title={shown.path}>
          {shown.name}
        </span>
        {shown.dir ? (
          <button className={button} onClick={onEnter} title={t("workspace.fx.enter")} aria-label={t("workspace.fx.enter")}>
            <ChevronRight size={14} />
          </button>
        ) : (
          <>
            {kind && (
              <button className="shrink-0 rounded px-1.5 py-0.5 text-subtle hover:bg-hover hover:text-foreground" onClick={() => { if (source) reconsiderFileRender(hostId, scope, shown.path); rememberSourceChoice(kind, !source); }} data-source-toggle="" aria-pressed={source}>
                {source ? t("workspace.showRendered") : t("workspace.showSource")}
              </button>
            )}
          <button className={button} onClick={onOpenKept} title={t("workspace.fx.openOwn")} aria-label={t("workspace.fx.openOwn")}>
            <ExternalLink size={13} />
          </button>
          </>
        )}
        <button className={button} onClick={(e) => onMenu(e.currentTarget)} aria-label={t("workspace.fx.more")}>
          <MoreHorizontal size={14} />
        </button>
      </div>
      {shown.dir ? (
        <FolderSummary api={api} scope={scope} thumbKey={thumbKey} children={children} />
      ) : (
        <FileView visible={visible} key={shown.path} api={api} hostId={hostId} scope={scope} path={shown.path} host={false} source={source} onSource={(next) => rememberSourceChoice(kind, next)} onFolder={onFolder} onLoaded={setFile} />
      )}
      {!shown.dir && (
        <div className="shrink-0 truncate border-t border-border/60 px-2.5 py-0.5 text-caption/[inherit] text-subtle">
          {[
            (file?.size ?? entry?.size) != null ? formatSize(file?.size ?? entry!.size!) : null,
            entry?.modifiedAt ? t("workspace.fx.modified", { at: new Date(entry.modifiedAt).toLocaleString() }) : null,
            shown.git ? t(`workspace.fx.git.${shown.git === "!" ? "conflict" : shown.git}` as never) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

function FolderSummary({ api, scope, thumbKey, children }: { api: DaemonApi; scope: WorkspaceScope; thumbKey: string; children: readonly FsEntry[] | null }) {
  const { t } = useI18n();
  if (!children) return <p className="p-3 text-xs text-subtle">…</p>;
  const dirs = children.filter((e) => e.kind === "dir" || e.targetKind === "dir").length;
  const images = children.filter((e) => isThumbnailPath(e.name) && (e.size ?? 0) <= THUMB_MAX_BYTES).slice(0, 6);
  return (
    <div className="p-3 text-xs text-muted">
      {t("workspace.fx.folderCounts", { dirs, files: children.length - dirs })}
      {images.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {images.map((e) => (
            <div key={e.path} className="size-16 overflow-hidden rounded-md bg-surface-2" title={e.name}>
              <Thumb api={api} scope={scope} entry={e} cacheKey={`${thumbKey}|${e.path}|${e.modifiedAt}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function formatSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

// ---------- search results ----------

interface SearchListProps {
  results: readonly string[] | null;
  sel: number;
  marks: ReadonlyMap<string, GitMark>;
  onSelect(index: number): void;
  onOpen(path: string): void;
  onMenu(e: MouseEvent, path: string): void;
  onEnterDir(dir: string): void;
  onDragStart(e: DragEvent, path: string): void;
}

export function SearchList({ results, sel, marks, onSelect, onOpen, onMenu, onEnterDir, onDragStart }: SearchListProps) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  useEffect(() => {
    win.document.querySelector<HTMLElement>('[data-search-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [sel]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label={t("workspace.fx.searchAll")}>
      <div className="flex items-center border-b border-border/60 px-2.5 py-1 text-meta/[inherit] text-subtle">{results === null ? t("workspace.fx.searchHint") : t("workspace.fx.searchCount", { n: results.length })}</div>
      {results?.map((path, i) => {
        const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        const mark = marks.get(path) ?? null;
        return (
          <div
            key={path}
            role="option"
            aria-selected={i === sel}
            data-search-selected={i === sel}
            data-path={path}
            draggable
            onDragStart={(e) => onDragStart(e, path)}
            onClick={() => onSelect(i)}
            onDoubleClick={() => onOpen(path)}
            onContextMenu={(e) => onMenu(e, path)}
            title={t("workspace.fx.searchRowHint")}
            className={`flex h-6 cursor-default items-center gap-1.5 px-2.5 text-ui/[inherit] ${i === sel ? "bg-accent/20" : "hover:bg-surface-2"}`}
          >
            <EntryIcon path={path} isDir={false} />
            <span className={`shrink-0 ${gitClass(mark)}`}>{path.split("/").pop()}</span>
            <button
              className="min-w-0 truncate text-left text-xs text-subtle hover:text-foreground hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onEnterDir(dir);
              }}
              title={t("workspace.fx.enter")}
            >
              {dir || t("workspace.fx.rootDir")}
            </button>
            <span className="ml-auto" />
            {mark && <span className={`shrink-0 font-mono text-caption/[inherit] font-semibold ${gitClass(mark)}`}>{mark}</span>}
          </div>
        );
      })}
    </div>
  );
}
