import { useState } from "react";
import { ArrowLeft, NotebookPen, Plus, StickyNote, X } from "lucide-react";
import type { Note } from "../../../../shared/notes";
import { Button, IconButton } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import type { GutterBodyProps, GutterTriggerProps } from "../slots";
import { useModuleHostGate } from "../../lib/hostGatingView";
import { noteErrorText } from "./errors";
import { conversationNotes } from "./gutter";
import type { ListState } from "./model";
import { NoteCard } from "./NoteCard";
import { NoteEditor } from "./NoteEditor";
import { NotesListBody } from "./NotesListBody";
import { NotesUnsupported } from "./NotesUnsupported";
import { newDraft, setNoteDraft, useHostSidebar, useNote, useNoteDrafts, useNotesQuery } from "./store";

export function NotesTrigger({ hostId, sessionId, open, toggle }: GutterTriggerProps) {
  const { t } = useI18n();
  const result = useNotesQuery(hostId, { scope: "session", id: sessionId }, true);
  return <button onClick={toggle} aria-expanded={open} aria-label={t("notes.title")} title={t("notes.title")} className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs ${open ? "bg-accent/10 text-accent" : "text-subtle hover:bg-hover"}`}>
    <NotebookPen size={15} /><span>{t("notes.title")}</span>{!!result.notes.length && <span>{result.notes.length}</span>}
  </button>;
}

function NoteRows({ notes, onPick }: { notes: Note[]; onPick(id: string): void }) {
  const { t, locale } = useI18n();
  const now = useClock();
  return <>{notes.map((note) => {
    const updated = Date.parse(note.updatedAt) / 1000;
    return <button key={note.id} data-note-row={note.id} onClick={() => onPick(note.id)} className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
      <StickyNote size={13} className={`mt-0.5 shrink-0 ${note.anchor?.turnId ? "text-accent" : "text-subtle"}`} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-xs font-medium">{note.title || t("notes.untitled")}</span>{Number.isFinite(updated) && <span className="shrink-0 text-[10.5px] text-subtle" title={formatAbsolute(updated)}>{formatWhen(updated, now, locale)}</span>}</span>
        <span className="mt-0.5 line-clamp-2 text-[11px] [overflow-wrap:anywhere] text-subtle">{note.body.slice(0, 200)}</span>
      </span>
    </button>;
  })}</>;
}

function NoteDetail({ hostId, noteId, projectId }: { hostId: string; noteId: string; projectId?: string }) {
  const { t } = useI18n();
  const result = useNote(hostId, noteId);
  return result.note ? <NoteCard hostId={hostId} note={result.note} projectId={projectId} /> : <p role={result.error ? "alert" : undefined} className="p-2 text-xs text-subtle">{noteErrorText(result.error, t) ?? t(result.loading ? "notes.loading" : "notes.missing")}</p>;
}

function NotesGutterBody({ hostId, sessionId, close }: GutterBodyProps) {
  const { t } = useI18n();
  const sidebar = useHostSidebar(hostId);
  const projectId = sidebar?.hostRows[sessionId]?.projectId ?? undefined;
  const [all, setAll] = useState(false), [noteId, setNoteId] = useState<string | null>(null);
  const [list, setList] = useState<ListState>({ scope: "host", sessionId, projectId });
  const current = useNotesQuery(hostId, { scope: "session", id: sessionId }, true);
  const project = useNotesQuery(hostId, { scope: "project", id: projectId ?? "" }, true, !!projectId && !all);
  const groups = conversationNotes([...current.notes, ...(projectId ? project.notes : [])], sessionId, projectId);
  const draftKey = JSON.stringify([hostId, "new", `session:${sessionId}`]);
  const draft = useNoteDrafts((s) => s.drafts[draftKey]);
  return <div className="flex min-h-0 flex-col" data-notes-gutter>
    <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
      {(all || noteId) && <IconButton label={t("notes.backToConversation")} onClick={() => { setNoteId(null); setAll(false); }}><ArrowLeft size={13} /></IconButton>}
      <h3 className="min-w-0 flex-1 truncate text-xs font-medium">{t(all ? "notes.list" : noteId ? "notes.note" : "notes.conversation")}</h3>
      {!all && !noteId && <button className="text-xs text-accent hover:underline" onClick={() => setAll(true)}>{t("notes.browseAll")}</button>}
      <IconButton label={t("notes.closeList")} onClick={close}><X size={13} /></IconButton>
    </div>
    {all ? <NotesListBody hostId={hostId} state={list} setState={setList} /> : noteId ? <div className="p-1"><NoteDetail hostId={hostId} noteId={noteId} projectId={projectId} /></div> : <div className="space-y-1 p-1">
      <div className="px-1 py-1"><Button onClick={() => { if (!draft) setNoteDraft(draftKey, newDraft({ kind: "session", id: sessionId })); }}><Plus size={12} className="mr-1 inline" />{t("notes.new")}</Button></div>
      {draft && <NoteEditor hostId={hostId} draftKey={draftKey} />}
      {current.error && <p role="alert" className="break-words p-2 text-xs text-danger">{noteErrorText(current.error, t)}</p>}
      {!groups.current.length && (current.loading ? <p className="p-2 text-xs text-subtle">{t("notes.loading")}</p> : <div className="flex flex-col items-center gap-1.5 px-4 py-5 text-center">
        <NotebookPen size={18} className="text-subtle" aria-hidden />
        <p className="text-xs text-muted">{t("notes.empty")}</p>
        <p className="text-[11px] text-subtle">{t("notes.emptyHint")}</p>
      </div>)}
      <NoteRows notes={groups.current} onPick={setNoteId} />
      {!!groups.project.length && <><h4 className="px-2 pt-2 text-[11px] text-subtle">{t("notes.projectSelected")}</h4><NoteRows notes={groups.project} onPick={setNoteId} /></>}
      {projectId && project.error && <p role="alert" className="break-words p-2 text-xs text-danger">{noteErrorText(project.error, t)}</p>}
    </div>}
  </div>;
}

/** Navigation and note details remain in the container that opened them, never auto-open the right workspace. */
export function NotesGutter(props: GutterBodyProps) {
  const gate = useModuleHostGate("notes", props.hostId);
  if (!gate.ok) return <NotesUnsupported waiting={gate.waiting} />;
  return <NotesGutterBody key={JSON.stringify([props.hostId, props.sessionId])} {...props} />;
}
