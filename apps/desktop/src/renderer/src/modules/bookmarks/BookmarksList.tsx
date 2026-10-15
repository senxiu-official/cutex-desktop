import { useState } from "react";
import { ArrowLeft, Bookmark, FileText, Layers, MessageSquare, MoreHorizontal, PanelRight, Plus, Search, StickyNote, Terminal, User, X } from "lucide-react";

// Design pass (2026-10-15): relative dates (absolute on hover), remove asks twice (armed menu row),
// the host only named for other hosts, an empty state that says how to add one, a search field in
// the gutter's 全部 view styled like the side list's, and the shared IconButton for back / close.
import { ArmedRemove, Button, Checkbox, IconButton } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { contextMenu, openMenuFrom, type MenuEntry } from "../../lib/contextMenu";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { agentHost, sidebarOf, useApp } from "../../store";
import { services } from "../app";
import type { GutterBodyProps, GutterTriggerProps, SideBodyProps } from "../slots";
import { homeBookmarks, groupBookmarks, matchingBookmarks, type BookmarkRecord, type ListState } from "./model";
import { refusalKey } from "./hooks";
import { currentRefs, editBookmark, openBookmark, problemKey, removeBookmark, resetBookmarkData, saveBookmark, useBookmarks } from "./state";
import { bookmarkContext, bookmarkProject } from "./context";

const iconFor = (record: BookmarkRecord) => {
  const icon = record.ref.snapshot?.icon;
  if (icon === "StickyNote" || record.ref.kind === "notes.note") return StickyNote;
  if (icon === "SquareTerminal" || record.ref.kind === "terminal.pty") return Terminal;
  if (record.ref.kind === "turn") return MessageSquare;
  if (record.ref.kind === "agent") return User;
  if (record.ref.kind === "side.page") return Layers;
  if (record.ref.kind === "main.page") return PanelRight;
  return FileText;
};

function BookmarkRow({ record, onPicked }: { record: BookmarkRecord; onPicked?(): void }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const created = Date.parse(record.createdAt) / 1000;
  const failure = useBookmarks((s) => s.failures[record.id]);
  const storageError = useBookmarks((s) => s.storageError);
  const [editing, setEditing] = useState(false), [title, setTitle] = useState(record.ref.title);
  const initialScope = record.scope ?? bookmarkContext(record.ref);
  const [scope, setScope] = useState(initialScope);
  const Icon = iconFor(record);
  const ordinal = record.ref.kind === "turn" && /^\d+$/.test(record.ref.params.ordinal ?? "") ? `#${record.ref.params.ordinal}` : null;
  const pick = (how: "auto" | "peek" | "page" | "jump" = "peek") => {
    void openBookmark(record, how).then(result => { if (result.status === "opened") onPicked?.(); }).catch((e) => services.ui.notice(String(e), "error"));
  };
  const menu = (): MenuEntry[] => [
    record.ref.kind === "turn" && { label: t("bookmarks.jump"), onSelect: () => pick("jump") },
    { label: t("bookmarks.peek"), onSelect: () => pick("peek") }, { label: t("bookmarks.page"), onSelect: () => pick("page") }, "separator",
    { label: t("bookmarks.rename"), disabled: !!storageError, onSelect: () => { setTitle(record.ref.title); setScope(initialScope); setEditing(true); } },
    { label: t("bookmarks.remove"), disabled: !!storageError, danger: true, armed: t("bookmarks.removeArmed"), onSelect: () => { removeBookmark(record.id); } },
  ];
  const save = () => { if (editBookmark(record.id, title, scope)) setEditing(false); };
  if (editing) return <div className="space-y-2 rounded-lg border border-accent/40 p-2" onKeyDown={(e) => {
    if (e.key === "Escape" && !e.repeat && !e.nativeEvent.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setEditing(false); }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
  }}><input autoFocus aria-label={t("bookmarks.rename")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent" />
    {scope.projectId && <label className="flex min-w-0 items-center gap-2 text-xs"><Checkbox label={t("bookmarks.projectPin")} checked={scope.projectExplicit === true} onChange={(v) => setScope({ ...scope, projectExplicit: v })} />{t("bookmarks.projectPin")}<span className="min-w-0 truncate text-subtle" title={scope.projectId}>{scope.projectId}</span></label>}
    <p className="text-[11px] text-subtle">{t("bookmarks.projectHint")}</p><div className="flex justify-end gap-2"><Button onClick={() => setEditing(false)}>{t("bookmarks.cancel")}</Button><Button primary disabled={!title.trim()} onClick={save}>{t("bookmarks.save")}</Button></div></div>;
  return <div className="group flex min-w-0 items-start rounded-lg hover:bg-hover" onContextMenu={contextMenu(menu)}>
    <button className={`flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left ${failure ? "text-subtle" : "text-foreground"}`} onClick={() => pick()}>
      <Icon size={14} className={`mt-0.5 shrink-0 ${failure ? "opacity-40" : "text-subtle"}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="line-clamp-2 break-words text-xs">{record.ref.title}</span>
        <span className="text-[11px] text-subtle" title={Number.isFinite(created) ? formatAbsolute(created) : undefined}>{ordinal ? `${ordinal} · ` : ""}{Number.isFinite(created) ? formatWhen(created, now, locale) : ""}</span>
        {failure ? <span className="text-[11px] text-warn-text">{t(refusalKey(failure))}</span> : record.ref.snapshot?.snippet && <span className="line-clamp-2 break-words text-[11px] text-subtle">{record.ref.snapshot.snippet}</span>}
      </span>
    </button>
    <button className="mt-1.5 mr-1 shrink-0 rounded p-1 text-subtle opacity-0 hover:bg-surface-2 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100" aria-label={t("gutter.more")} title={t("gutter.more")} onClick={(e) => openMenuFrom(e.currentTarget, menu())}><MoreHorizontal size={13} /></button>
  </div>;
}

function SaveCurrent({ hostId, sessionId }: { hostId: string; sessionId?: string }) {
  const { t } = useI18n();
  const [projectPin, setProjectPin] = useState(false);
  const projectId = sessionId ? bookmarkProject(hostId, sessionId) : undefined;
  return <div className="space-y-1"><Button onClick={(e) => {
    const refs = currentRefs();
    openMenuFrom(e.currentTarget, refs.length ? refs.map((ref) => ({ label: ref.title, hint: ref.kind, onSelect: () => { saveBookmark(ref, { ...bookmarkContext(ref), ...(projectPin && projectId && ref.hostId === hostId ? { projectId, projectExplicit: true } : {}) }); } })) : [{ label: t("bookmarks.hereEmpty"), disabled: true, onSelect: () => {} }]);
  }}><Plus size={12} className="mr-1 inline" />{t("bookmarks.here")}</Button>{projectId && <label className="flex items-center gap-1.5 text-[11px] text-subtle" title={t("bookmarks.projectHint")}><Checkbox label={t("bookmarks.projectPin")} checked={projectPin} onChange={setProjectPin} />{t("bookmarks.projectPin")}</label>}</div>;
}

function Groups({ records, hostId, sessionId, onPicked, searching }: { records: BookmarkRecord[]; hostId: string; sessionId?: string; onPicked?(): void; searching?: boolean }) {
  const { t } = useI18n();
  const groups = groupBookmarks(records, hostId, sessionId);
  if (!groups.length) return searching ? <p className="px-3 py-4 text-center text-xs text-subtle">{t("bookmarks.noMatch")}</p> : <div className="flex flex-col items-center gap-1.5 px-4 py-6 text-center">
    <Bookmark size={18} className="text-subtle" aria-hidden />
    <p className="text-xs text-muted">{t("bookmarks.empty")}</p>
    <p className="text-[11px] text-subtle">{t("bookmarks.emptyHint")}</p>
  </div>;
  return <>{groups.map((group) => <section key={group.key} className="space-y-0.5">
    <h3 className="truncate px-2 pt-2 pb-1 text-[11px] font-medium text-subtle">{group.current ? t("bookmarks.current") : group.records[0]?.ref.snapshot?.agentName ?? group.sessionId ?? t("bookmarks.other")}{group.hostId !== hostId ? ` · ${group.hostId}` : ""}</h3>
    {group.records.map((record) => <BookmarkRow key={record.id} record={record} onPicked={onPicked} />)}
  </section>)}</>;
}

function Errors() {
  const { t } = useI18n();
  const error = useBookmarks((s) => s.storageError), action = useBookmarks((s) => s.actionError);
  return error || action ? <p role="alert" className="px-2 py-1 text-xs text-danger">{error ? t(problemKey(error)) : action}</p> : null;
}

export function BookmarksTrigger({ hostId, sessionId, open, toggle }: GutterTriggerProps) {
  const { t } = useI18n();
  const projectId = useApp(s => sidebarOf(s, hostId)?.hostRows[sessionId]?.projectId ?? undefined);
  const count = useBookmarks((s) => homeBookmarks(s.document.records, hostId, sessionId, projectId).length);
  return <button onClick={toggle} aria-expanded={open} aria-label={t("bookmarks.title")} title={t("bookmarks.title")} className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${open ? "bg-accent/10 text-accent" : "text-subtle hover:bg-hover"}`}><Bookmark size={15} fill={count ? "currentColor" : "none"} /><span>{t("bookmarks.title")}</span>{!!count && <span>{count}</span>}</button>;
}
function BookmarksGutterBody({ hostId, sessionId, close, docked }: GutterBodyProps) {
  const { t } = useI18n();
  const document = useBookmarks((s) => s.document);
  const projectId = useApp(s => sidebarOf(s, hostId)?.hostRows[sessionId]?.projectId ?? undefined);
  const [all, setAll] = useState(false), [query, setQuery] = useState("");
  const records = all ? matchingBookmarks(document, query) : homeBookmarks(document.records, hostId, sessionId, projectId);
  return <div className="space-y-1 p-1"><div className="flex items-center gap-1 border-b border-border px-1 py-1.5">
    {all && <IconButton label={t("bookmarks.back")} onClick={() => { setAll(false); setQuery(""); }}><ArrowLeft size={13} /></IconButton>}
    <h3 className="min-w-0 flex-1 truncate px-1 text-xs font-medium">{t(all ? "bookmarks.list" : "bookmarks.home")}</h3>{!all && <button className="rounded px-1 text-xs text-accent hover:underline" onClick={() => setAll(true)}>{t("bookmarks.browseAll")}</button>}<IconButton label={t("bookmarks.close")} onClick={close}><X size={13} /></IconButton>
    </div><div className="px-1 pt-1"><SaveCurrent hostId={hostId} sessionId={sessionId} /></div>{all && <div className="flex min-w-0 items-center gap-2 px-1"><Search size={13} className="shrink-0 text-subtle" /><input autoFocus aria-label={t("bookmarks.search")} placeholder={t("bookmarks.search")} value={query} maxLength={500} onChange={e => setQuery(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent" onKeyDown={(e) => { if (e.key === "Escape" && query && !e.repeat && !e.nativeEvent.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setQuery(""); } }} /></div>}
    <Errors /><Groups records={records} hostId={hostId} sessionId={sessionId} searching={all && !!query.trim()} onPicked={() => { if (!docked) close(); }} /></div>;
}
export function BookmarksGutter(props: GutterBodyProps) { return <BookmarksGutterBody key={JSON.stringify([props.hostId, props.sessionId])} {...props} />; }
export function BookmarksList({ hostId, instance, setState }: SideBodyProps<ListState>) {
  const { t } = useI18n();
  const document = useBookmarks((s) => s.document);
  const selected = useApp((s) => agentHost(s) === hostId ? s.selectedId : null);
  const state = instance.state;
  if (!hostId) return null;
  const records = matchingBookmarks(document, state.query, state.allHosts ? undefined : hostId);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="space-y-2 border-b border-border p-2.5"><p className="text-xs text-subtle">{t("bookmarks.localHint")}</p>
      <div className="flex gap-2"><SaveCurrent key={selected} hostId={hostId} sessionId={selected ?? undefined} /><select aria-label={t("bookmarks.allHosts")} value={state.allHosts ? "all" : "host"} onChange={(e) => setState({ ...state, allHosts: e.target.value === "all" })} className="min-w-0 rounded border border-border bg-background text-xs"><option value="host">{t("bookmarks.thisHost")}</option><option value="all">{t("bookmarks.allHosts")}</option></select></div>
      <div className="flex items-center gap-2"><Search size={13} className="shrink-0 text-subtle" /><input aria-label={t("bookmarks.search")} placeholder={t("bookmarks.search")} value={state.query ?? ""} maxLength={500} onChange={(e) => setState({ ...state, query: e.target.value })} className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent" onKeyDown={(e) => { if (e.key === "Escape" && state.query && !e.repeat && !e.nativeEvent.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setState({ ...state, query: "" }); } }} /></div>
      <Errors />
    </div>
    <div className="min-h-0 flex-1 overflow-auto p-1"><Groups records={records} hostId={hostId} sessionId={selected ?? undefined} searching={!!state.query?.trim()} /></div>
    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-subtle"><span>{document.records.length} / 500</span><span className="flex items-center gap-1"><span>{t("bookmarks.clear")}</span><ArmedRemove title={t("bookmarks.clear")} armedLabel={t("bookmarks.clearConfirm")} onRemove={() => { resetBookmarkData(); }} /></span></div>
  </div>;
}
