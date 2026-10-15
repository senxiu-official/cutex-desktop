import { useEffect, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/settings/Form";
import type { NoteScope, NotesQuery } from "../../../../shared/notes";
import { useI18n } from "../../i18n";
import type { SideBodyProps } from "../slots";
import { type ListState, scopeKey } from "./model";
import { useModuleHostGate } from "../../lib/hostGatingView";
import { noteErrorText } from "./errors";
import { NoteCard } from "./NoteCard";
import { NotesUnsupported } from "./NotesUnsupported";
import { NoteEditor } from "./NoteEditor";
import { newDraft, notesCache, setNoteDraft, useHostSidebar, useNoteDrafts, useNotesQuery } from "./store";

const SELECT = "max-w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent";

/** The list has no page header or layout policy: the side container owns all of that. */
export function NotesListBody({ hostId, state, setState, visible = true }: { hostId: string; state: ListState; setState(next: ListState): void; visible?: boolean }) {
  const { t } = useI18n();
  const sidebar = useHostSidebar(hostId);
  const sessions = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])];
  const projects = sidebar?.projects?.projects ?? [];
  const [search, setSearch] = useState(state.query ?? "");
  useEffect(() => setSearch(state.query ?? ""), [state.query]);
  useEffect(() => { if (search === (state.query ?? "")) return; const timer = setTimeout(() => setState({ ...state, query: search }), 250); return () => clearTimeout(timer); }, [search, state, setState]);
  const kind = state.scope ?? (state.sessionId ? "session" : state.projectId ? "project" : "host");
  const id = kind === "session" ? state.sessionId : kind === "project" ? state.projectId : undefined;
  const scope: NoteScope = kind === "host" || !id ? { kind: "host" } : { kind, id };
  const query: NotesQuery = { scope: scope.kind, ...(scope.kind !== "host" ? { id: scope.id } : {}), query: state.query ?? "", pinnedOnly: state.pinnedOnly ?? false };
  const result = useNotesQuery(hostId, query, false, visible);
  const draftKey = JSON.stringify([hostId, "new", scopeKey(scope)]);
  const draft = useNoteDrafts((s) => s.drafts[draftKey]);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="space-y-2 border-b border-border p-2.5">
      <p className="text-xs text-subtle">{t("notes.noContext")}</p>
      <div className="flex flex-wrap gap-1.5">
        <select aria-label={t("notes.list")} className={SELECT} value={scope.kind} onChange={(e) => setState({ ...state, scope: e.target.value as ListState["scope"], sessionId: state.sessionId ?? sessions[0]?.cutexSessionId, projectId: state.projectId ?? projects[0]?.project_id })}>
          <option value="session" disabled={!sessions.length && !state.sessionId}>{t("notes.scope.session")}</option><option value="project" disabled={!projects.length && !state.projectId}>{t("notes.scope.project")}</option><option value="host">{t("notes.scope.host")}</option>
        </select>
        {scope.kind === "session" && <select aria-label={t("notes.chooseSession")} className={SELECT} value={scope.id} onChange={(e) => setState({ ...state, sessionId: e.target.value })}>
          {!sessions.some((s) => s.cutexSessionId === scope.id) && <option value={scope.id}>{scope.id}</option>}{sessions.map((s) => <option key={s.cutexSessionId} value={s.cutexSessionId}>{s.displayName || s.cutexSessionId}</option>)}
        </select>}
        {scope.kind === "project" && <select aria-label={t("notes.chooseProject")} className={SELECT} value={scope.id} onChange={(e) => setState({ ...state, projectId: e.target.value })}>
          {!projects.some((p) => p.project_id === scope.id) && <option value={scope.id}>{scope.id}</option>}{projects.map((p) => <option key={p.project_id} value={p.project_id}>{p.presentation.display_name || p.project_id}</option>)}
        </select>}
        <select aria-label={t("notes.pinnedOnly")} className={SELECT} value={state.pinnedOnly ? "pinned" : "all"} onChange={(e) => setState({ ...state, pinnedOnly: e.target.value === "pinned" })}><option value="all">{t("notes.all")}</option><option value="pinned">{t("notes.pinnedOnly")}</option></select>
      </div>
      <div className="flex min-w-0 items-center gap-2"><Search size={13} className="shrink-0 text-subtle" /><input aria-label={t("notes.search")} placeholder={t("notes.search")} value={search} maxLength={500} onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent" onKeyDown={(e) => { if (e.key === "Escape" && search && !e.repeat && !e.nativeEvent.isComposing && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setSearch(""); setState({ ...state, query: "" }); } }} />
        <button aria-label={t("notes.refresh")} title={t("notes.refresh")} disabled={result.loading} onClick={() => void notesCache.refresh(hostId, query)} className="text-subtle hover:text-accent"><RefreshCw size={13} className={result.loading ? "animate-spin" : ""} /></button>
      </div>
      <Button onClick={() => { if (!draft) setNoteDraft(draftKey, newDraft(scope)); }}><Plus size={12} className="mr-1 inline" />{t("notes.new")}</Button>
    </div>
    <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2.5">
      {draft && <NoteEditor hostId={hostId} draftKey={draftKey} />}
      {result.error && <p role="alert" className="break-words text-xs text-danger">{noteErrorText(result.error, t)}</p>}
      {!result.notes.length && <p className="py-4 text-center text-xs text-subtle">{t(result.loading ? "notes.loading" : "notes.empty")}</p>}
      {result.notes.map((note) => <NoteCard key={note.id} hostId={hostId} note={note} projectId={state.projectId} />)}
      {result.nextCursor && <Button disabled={result.loading} onClick={() => void notesCache.loadMore(hostId, query)}>{t("notes.more")}</Button>}
    </div>
  </div>;
}

export function NotesListCard({ hostId, instance, setState, visible }: SideBodyProps<ListState>) {
  // Host-bound singleton: selecting another agent must not silently retarget an explicitly open list.
  const gate = useModuleHostGate("notes", hostId);
  if (hostId && !gate.ok) return <NotesUnsupported waiting={gate.waiting} />;
  return hostId ? <NotesListBody hostId={hostId} state={instance.state} setState={setState} visible={visible} /> : null;
}
