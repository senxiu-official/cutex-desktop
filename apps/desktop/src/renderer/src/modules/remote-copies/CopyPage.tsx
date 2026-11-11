import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { ArrowUpDown, Check, Download, ExternalLink, FileText, FolderOpen, LayoutList, MoreHorizontal, Pin, RefreshCw, Rows3, Search, X } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { sidebarOf, useApp } from "../../store";
import { rowsOf } from "../../lib/viewHost";
import { Button, btnFace, btnShape } from "../../components/Button";
import { ArmedButton } from "../../components/ArmedButton";
import { DataTable, type Column } from "../../components/DataTable";
import { Segmented, Select } from "../../components/settings/Form";
import { formatSize } from "../../lib/docPreview";
import { formatDate } from "../../lib/dateText";
import { fileKind } from "../../lib/fileKinds";
import { FILE_KIND_ICON } from "../../lib/fileKindIcons";
import { contextMenu, openMenuFrom } from "../../lib/contextMenu";
import { useSizeFlags, widthBelow } from "../../lib/sizeFlags";
import type { RemoteCopy } from "../../../../shared/remoteCopies";
import { chooseDownloadFolder, defaultDownloadFolder, dismissCopy, openDownloadFolder, refreshCopies, refreshDownloadFolder, startPrepared, useCopies } from "../../lib/remoteCopies";
import type { DownloadFolder } from "../../../../shared/remoteCopyRequests";
import { cancelCopy, copyCaps, copyMenu, downloadAgain, keepCopy, openCopy, openOriginal, removeCopy, revealCopy } from "./menu";
import { COPY_SORTS, SORT_DESC_FIRST, copyDate, filterCopies, pickSort, copyLocation, placeOf, placeOptions, setCopyView, sortCopies, useCopyView, type CopySort, type CopyView, type PlaceNames } from "./view";

/** Host labels and project names as the app knows them now (placeOf falls back to what the copy saved). */
function usePlaceNames(): PlaceNames {
  const hosts = useApp((s) => s.hosts?.hosts);
  const byHost = useApp((s) => s.byHost);
  const sidebar = useApp((s) => s.sidebar);
  return useMemo(() => {
    const state = useApp.getState();
    return {
      host: (id) => hosts?.find((h) => h.id === id)?.label,
      project: (hostId, projectId) => sidebarOf(state, hostId)?.projects?.projects.find((p) => p.project_id === projectId)?.presentation.display_name || undefined,
    };
  }, [hosts, byHost, sidebar]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** What a copy is from, beyond its host: the project (placeOf), else the agent whose workspace / artifact it is. */
function useSourceLabel(copy: RemoteCopy): string {
  const { t } = useI18n();
  const names = usePlaceNames();
  const agent = useApp((s) => (copy.source.scope?.kind === "session" ? rowsOf(sidebarOf(s, copy.source.hostId)).find((r) => r.cutexSessionId === copy.source.scope!.id)?.displayName ?? null : null));
  const place = placeOf(copy, names);
  const where = [place.host, place.project ?? agent].filter(Boolean).join(" · ");
  return copy.source.artifact ? `${where} · ${t("remote-copies.artifactVersion", { n: copy.source.artifact.version })}` : `${where} · ${copy.source.path}`;
}

/** The download folder: where it is, open it, move it (main's dialog) or back to the default. */
function FolderBar({ folder, busy }: { folder: DownloadFolder | null; busy: boolean }) {
  const { t } = useI18n();
  // Two lines: the path keeps the pane's width (a Shelf is narrow), the actions sit under it.
  return <div className="flex flex-col gap-1 border-b border-border/60 px-3 py-2 text-xs" data-download-folder={folder?.path ?? ""}>
    <div className="flex min-w-0 items-center gap-2">
      <FolderOpen size={14} className="shrink-0 text-muted" aria-hidden />
      <span className="shrink-0 text-muted">{t("remote-copies.folder")}</span>
      {folder?.isDefault && <span className="min-w-0 truncate text-subtle">{t("remote-copies.folderDefault")}</span>}
    </div>
    <span className="min-w-0 truncate font-mono text-caption [direction:rtl] text-left" title={folder?.path}><bdi>{folder?.path ?? "…"}</bdi></span>
    <span className="-ml-2 flex flex-wrap gap-1">
      <Button size="sm" variant="ghost" disabled={!folder} onClick={() => void openDownloadFolder()} data-download-folder-open>{t("remote-copies.openFolder")}</Button>
      <Button size="sm" variant="ghost" disabled={!folder || busy} title={t("remote-copies.changeFolderHint")} onClick={() => void chooseDownloadFolder()} data-download-folder-change>{t("remote-copies.changeFolder")}</Button>
      {folder && !folder.isDefault && <Button size="sm" variant="ghost" disabled={busy} title={t("remote-copies.changeFolderHint")} onClick={() => void defaultDownloadFolder()}>{t("remote-copies.defaultFolder")}</Button>}
    </span>
  </div>;
}

export function CopyPage() {
  const { t } = useI18n();
  const { state, folder, pending, busy, starting, error } = useCopies();
  const prefs = useCopyView();
  const names = usePlaceNames();
  const [text, setText] = useState("");
  const [place, setPlace] = useState("");
  useEffect(() => {
    void refreshCopies();
    void refreshDownloadFolder();
    const timer = window.setInterval(() => void refreshCopies(), 700);
    return () => window.clearInterval(timer);
  }, []);
  const copies = state?.copies;
  const places = useMemo(() => placeOptions(copies ?? [], names), [copies, names]);
  // A place filter whose last copy went away falls back to everywhere.
  const placeShown = places.some((p) => p.value === place) ? place : "";
  const shown = useMemo(() => sortCopies(filterCopies(copies ?? [], { text, place: placeShown }, names), prefs, names), [copies, text, placeShown, names, prefs]);
  const filtered = !!text.trim() || !!placeShown;
  const sortMenu = (el: HTMLElement) => {
    const check = (on: boolean) => (on ? <Check size={14} /> : <span className="inline-block w-3.5" />);
    openMenuFrom(el, [
      ...COPY_SORTS.map((k) => ({ label: t(`remote-copies.sort.${k}`), icon: check(prefs.sort === k), onSelect: () => { if (k !== prefs.sort) setCopyView({ sort: k, desc: SORT_DESC_FIRST[k] }); } })),
      "separator",
      { label: t("remote-copies.sortAsc"), icon: check(!prefs.desc), onSelect: () => setCopyView({ desc: false }) },
      { label: t("remote-copies.sortDesc"), icon: check(prefs.desc), onSelect: () => setCopyView({ desc: true }) },
    ]);
  };
  return <div className="flex h-full min-h-0 flex-col" data-remote-copies>
    <div className="flex items-start gap-2 border-b border-border/60 p-3">
      <p className="min-w-0 flex-1 text-xs text-muted">{t("remote-copies.hint")}</p>
      <Button size="sm" variant="ghost" aria-label={t("remote-copies.refresh")} onClick={() => void refreshCopies()}><RefreshCw size={14} data-icon="inline-start" /></Button>
    </div>
    <FolderBar folder={folder} busy={!!copies?.some((c) => c.status === "downloading")} />
    {!!copies?.length && <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2" data-copy-toolbar>
      <label className="flex min-w-[8rem] flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 focus-within:border-accent">
        <Search size={13} className="shrink-0 text-subtle" />
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && text) { e.stopPropagation(); setText(""); } }} placeholder={t("remote-copies.filter")} aria-label={t("remote-copies.filter")} className="min-w-0 flex-1 bg-transparent text-sm outline-none" data-copy-filter />
        {text && <button type="button" onClick={() => setText("")} aria-label={t("remote-copies.clearFilter")} className="shrink-0 rounded text-subtle hover:text-foreground"><X size={13} /></button>}
      </label>
      {places.length > 1 && <Select<string> width="w-36" label={t("remote-copies.place")} value={placeShown} onChange={setPlace} options={[{ value: "", label: t("remote-copies.allPlaces") }, ...places]} />}
      {prefs.view === "cards" && <Button size="sm" variant="ghost" onClick={(e) => sortMenu(e.currentTarget)} aria-label={t("remote-copies.sort")} title={t("remote-copies.sort")} data-copy-sort><ArrowUpDown size={14} data-icon="inline-start" />{t(`remote-copies.sort.${prefs.sort}`)}</Button>}
      <Segmented<CopyView> label={t("remote-copies.view")} value={prefs.view} onChange={(view) => setCopyView({ view })} options={[{ value: "cards", label: t("remote-copies.view.cards"), icon: <Rows3 size={13} /> }, { value: "list", label: t("remote-copies.view.list"), icon: <LayoutList size={13} /> }]} />
    </div>}
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {busy && <div className="flex items-center justify-between gap-2 py-2"><p className="text-xs text-muted" role="status">{t("remote-copies.preparing")}</p><Button size="sm" variant="ghost" onClick={dismissCopy}>{t("remote-copies.cancel")}</Button></div>}
      {error && <p role="alert" className="mb-3 break-words text-xs text-danger">{t("remote-copies.error", { error })}</p>}
      {pending && <section aria-label={t("remote-copies.confirm")} className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3" data-copy-confirm>
        <h3 className="text-sm font-medium">{t("remote-copies.confirm")}</h3>
        <p className="break-all text-xs">{pending.meta.name} · {formatSize(pending.meta.size)}</p>
        <p className="break-all text-xs text-muted">{pending.source.hostLabel} · {pending.source.path}</p>
        <p className="text-xs text-muted">{t("remote-copies.confirmHint")}</p>
        <div className="flex gap-2"><Button size="sm" variant="primary" disabled={starting} onClick={() => void startPrepared()}><Download size={14} data-icon="inline-start" />{t("remote-copies.start")}</Button><Button size="sm" variant="ghost" onClick={dismissCopy}>{t("remote-copies.cancel")}</Button></div>
      </section>}
      {copies?.length === 0 && !pending && !busy && <div className="flex flex-col items-center gap-2 py-12 text-center text-muted"><Download size={28} /><p className="text-sm">{t("remote-copies.empty")}</p><p className="text-xs">{t("remote-copies.emptyHint")}</p></div>}
      {!!copies?.length && !shown.length && filtered && <div className="flex flex-col items-center gap-2 py-8 text-center text-muted" data-copy-no-match><p className="text-sm">{t("remote-copies.noMatch")}</p><Button size="sm" variant="ghost" onClick={() => { setText(""); setPlace(""); }}>{t("remote-copies.clearFilter")}</Button></div>}
      {prefs.view === "list"
        ? !!shown.length && <CopyList copies={shown} names={names} sort={prefs.sort} desc={prefs.desc} />
        : <div className="flex flex-col gap-3">{shown.map(copy => <CopyRow key={copy.id} copy={copy} />)}</div>}
    </div>
  </div>;
}

function CopyRow({ copy }: { copy: RemoteCopy }) {
  const { t } = useI18n();
  const host = useApp(s => s.hosts?.hosts.find(h => h.id === copy.source.hostId));
  const { local, remote, active, openable } = copyCaps(copy, host);
  const source = useSourceLabel(copy);
  const folder = useCopies((s) => s.folder);
  const location = local ? copyLocation(folder, copy) : null;
  const date = (value: string) => new Date(value).toLocaleString();
  return <article className="flex flex-col gap-2 rounded-lg border border-border/70 p-3" data-copy-row={copy.id}>
    <div className="flex items-start gap-2"><FileText size={17} className="mt-0.5 shrink-0 text-muted" /><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-medium" title={copy.name}>{copy.name}</h3><p className="mt-0.5 break-all text-xs text-muted" data-copy-source>{source}</p>{location && <p className="mt-0.5 flex min-w-0 gap-1.5 text-caption text-subtle" title={location} data-copy-location><span className="shrink-0">{t("remote-copies.location")}</span><span className="min-w-0 truncate font-mono [direction:rtl] text-left"><bdi>{location}</bdi></span></p>}</div><span className="shrink-0 text-xs text-muted">{formatSize(copy.size)}</span></div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted"><span>{t(`remote-copies.${copy.status}`)}</span>{copy.kept ? <span>{t("remote-copies.kept")}</span> : copy.expiresAt ? <span>{t("remote-copies.expires", { at: date(copy.expiresAt) })}</span> : null}</div>
    {copy.downloadedAt && <p className="text-xs text-subtle">{t("remote-copies.downloaded", { at: date(copy.downloadedAt) })}</p>}
    {active && <div className="flex items-center gap-2"><progress className="h-1.5 min-w-0 flex-1 accent-accent" value={copy.received} max={Math.max(copy.size, 1)} aria-label={t("remote-copies.downloading")} /><span className="text-xs tabular-nums text-muted">{formatSize(copy.received)} / {formatSize(copy.size)}</span></div>}
    {copy.error && <p className="break-words text-xs text-danger" role="status">{copy.error}</p>}
    <div className="flex flex-wrap gap-1">
      <Button size="sm" disabled={!openable} onClick={() => openCopy(copy)}>{t("remote-copies.open")}</Button>
      <Button size="sm" variant="ghost" disabled={!local} onClick={() => revealCopy(copy)}><FolderOpen size={14} data-icon="inline-start" />{t("remote-copies.reveal")}</Button>
      <Button size="sm" variant="ghost" disabled={!remote} title={!remote ? t("remote-copies.offline") : undefined} onClick={() => openOriginal(copy)}>{t("remote-copies.original")}</Button>
      {active ? <Button size="sm" variant="ghost" onClick={() => cancelCopy(copy)}>{t("remote-copies.cancel")}</Button> : <Button size="sm" variant="ghost" disabled={!remote} title={!remote ? t("remote-copies.offline") : undefined} onClick={() => downloadAgain(copy)}>{t("remote-copies.refresh")}</Button>}
      {/* An artifact saved to this computer is always kept (main remoteCopies): no keep toggle. */}
      {!copy.source.artifact && <Button size="sm" variant="ghost" disabled={!local} onClick={() => keepCopy(copy)}>{t(copy.kept ? "remote-copies.unkeep" : "remote-copies.keep")}</Button>}
      <ArmedButton shape={btnShape({ size: "sm" })} idle={btnFace({ variant: "ghost", danger: true })} hint={t("remote-copies.removeConfirm")} disabled={active} onConfirm={() => removeCopy(copy)}>{t("remote-copies.remove")}</ArmedButton>
    </div>
  </article>;
}

// The list drops columns as the pane narrows (lib/sizeFlags, no @container): host / project first, then the date, then the size,
// so the name keeps about 12rem beside the fixed columns (34.25rem with all of them).
const LIST_SIZES = { noPlace: widthBelow(46), noDate: widthBelow(37), noSize: widthBelow(28) };
const ROW = "[data-copy-list-row]";

/** ↑ ↓ / Home / End move between rows, Enter opens the copy, the menu key or Shift+F10 opens its menu. */
function rowKeys(e: KeyboardEvent<HTMLTableRowElement>, copy: RemoteCopy, openable: boolean, menu: () => void) {
  if (e.target !== e.currentTarget) return;
  const rows = [...(e.currentTarget.closest("table")?.querySelectorAll<HTMLElement>(ROW) ?? [])];
  const i = rows.indexOf(e.currentTarget);
  const to = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : null;
  if (to !== null) {
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, to))]?.focus();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (openable) openCopy(copy);
  } else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
    e.preventDefault();
    menu();
  }
}

function CopyList({ copies, names, sort, desc }: { copies: RemoteCopy[]; names: PlaceNames; sort: CopySort; desc: boolean }) {
  const { t, locale } = useI18n();
  const hosts = useApp((s) => s.hosts?.hosts);
  const [ref, size] = useSizeFlags(LIST_SIZES);
  const [focusId, setFocusId] = useState<string | null>(null);
  const capsOf = (c: RemoteCopy) => copyCaps(c, hosts?.find((h) => h.id === c.source.hostId));
  const menu = (c: RemoteCopy) => copyMenu(c, capsOf(c), t);
  // Date and time formatted apart: formatDate drops the spaces next to numbers in zh, which would glue them together.
  const date = (at: string) => `${formatDate(new Date(at), locale, { year: "numeric", month: "2-digit", day: "2-digit" })} ${formatDate(new Date(at), locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
  const iconBtn = "rounded p-1 text-subtle opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-surface-2 hover:text-foreground focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-0";
  const tabStop = copies.some((c) => c.id === focusId) ? focusId : copies[0]?.id;
  const columns: Column<RemoteCopy>[] = [
    {
      key: "name", header: t("remote-copies.col.name"), sortable: true,
      cell: (c) => {
        const Icon = FILE_KIND_ICON[fileKind(c.name)];
        return <span className="flex min-w-0 items-center gap-2" title={`${c.name}\n${c.source.path}${c.source.artifact ? ` @${c.source.artifact.version}` : ""}`}>
          <Icon size={15} className="shrink-0 text-muted" aria-hidden />
          <span className={`min-w-0 truncate ${c.status === "expired" || c.status === "missing" ? "text-muted" : ""}`} data-copy-name>{c.name}</span>
          {c.kept && <Pin size={11} className="shrink-0 text-subtle" aria-label={t("remote-copies.kept")} />}
        </span>;
      },
    },
    {
      key: "host", header: t("remote-copies.col.place"), width: "9rem", sortable: true,
      cell: (c) => { const p = placeOf(c, names); const label = p.project ? `${p.host} · ${p.project}` : p.host; return <span className="block truncate text-xs text-muted" title={label}>{label}</span>; },
    },
    { key: "size", header: t("remote-copies.col.size"), width: "5rem", align: "right", sortable: true, cell: (c) => <span className="text-xs tabular-nums text-muted">{formatSize(c.size)}</span> },
    { key: "date", header: <span title={t("remote-copies.col.dateHint")}>{t("remote-copies.col.date")}</span>, width: "8.5rem", sortable: true, cell: (c) => <span className="block truncate text-xs tabular-nums text-muted" title={new Date(copyDate(c)).toLocaleString()}>{date(copyDate(c))}</span> },
    {
      key: "status", header: t("remote-copies.col.status"), width: "6.5rem",
      cell: (c) => c.status === "downloading"
        ? <span className="flex min-w-0 items-center gap-1.5" title={`${formatSize(c.received)} / ${formatSize(c.size)}`}><progress className="h-1 min-w-0 flex-1 accent-accent" value={c.received} max={Math.max(c.size, 1)} aria-label={t("remote-copies.downloading")} /><span className="shrink-0 text-xs tabular-nums text-muted">{Math.floor((c.received / Math.max(c.size, 1)) * 100)}%</span></span>
        : <span className={`block truncate text-xs ${c.status === "failed" ? "text-danger" : c.status === "complete" ? "text-muted" : "text-subtle"}`} title={c.error ?? t(`remote-copies.${c.status}` as MessageKey)}>{t(`remote-copies.${c.status}` as MessageKey)}</span>,
    },
    {
      key: "actions", header: "", width: "5.25rem", align: "right",
      cell: (c) => {
        const caps = capsOf(c);
        return <span className="inline-flex items-center justify-end gap-0.5">
          <button type="button" className={iconBtn} disabled={!caps.openable} onClick={() => openCopy(c)} aria-label={t("remote-copies.open")} title={t("remote-copies.open")}><ExternalLink size={14} /></button>
          <button type="button" className={iconBtn} disabled={!caps.local} onClick={() => revealCopy(c)} aria-label={t("remote-copies.reveal")} title={t("remote-copies.reveal")}><FolderOpen size={14} /></button>
          <button type="button" className={iconBtn} onClick={(e) => openMenuFrom(e.currentTarget, menu(c))} aria-label={t("remote-copies.more")} title={t("remote-copies.more")} data-copy-more><MoreHorizontal size={14} /></button>
        </span>;
      },
    },
  ];
  const shown = columns.filter((c) => !(size.noPlace && c.key === "host") && !(size.noDate && c.key === "date") && !(size.noSize && c.key === "size"));
  return <div ref={ref} className="min-w-0" data-copy-list>
    <DataTable
      columns={shown}
      groups={[{ key: "all", label: null, rows: copies }]}
      rowKey={(c) => c.id}
      foldPrefix="remote-copies"
      sort={{ key: sort, desc, onSort: (key) => setCopyView(pickSort({ sort, desc }, key as CopySort)) }}
      onRowContextMenu={(e, c) => contextMenu(() => menu(c))(e)}
      rowProps={(c) => ({
        tabIndex: c.id === tabStop ? 0 : -1,
        "aria-label": c.name,
        "data-copy-list-row": c.id,
        className: "focus-visible:bg-surface-2/70 focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent",
        onFocus: (e) => { if (e.target === e.currentTarget) setFocusId(c.id); },
        onDoubleClick: () => { if (capsOf(c).openable) openCopy(c); },
        onKeyDown: (e) => rowKeys(e, c, capsOf(c).openable, () => openMenuFrom(e.currentTarget, menu(c))),
      })}
    />
  </div>;
}
