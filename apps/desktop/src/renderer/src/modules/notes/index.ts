// Notes are daemon-owned additions, never native chat items or model memory (contract §18–19).
import { NotebookPen, StickyNote } from "lucide-react";
import { NOTES_CAPABILITY } from "../../../../shared/notes";
import { useApp } from "../../store";
import { defineModule } from "../slots";
import type { Json } from "../types";
import { LIST, NOTE, parseList, parseNote, type ListState, type NoteState } from "./model";
import { NotesListCard } from "./NotesListBody";
import { NoteActions, NoteView } from "./NoteView";
import { draftFromTurn, startNotesSync, useTurnNotesState } from "./store";
import { useListTab, useNoteTab } from "./tabs";
import { TurnNotes } from "./TurnNotes";
import { NoteFloatHost } from "./NoteFloat";
import { NotesGutter, NotesTrigger } from "./NotesGutter";

export default defineModule({
  id: "notes", titleKey: "notes.title", descriptionKey: "notes.description", requires: { capabilities: [NOTES_CAPABILITY] },
  contributes: {
    "conversation.gutter": [{ id: "notes.gutter", side: "left", anchor: "top", order: 110, dockMinWidth: 240, titleKey: "notes.title", icon: NotebookPen, Trigger: NotesTrigger, Body: NotesGutter }],
    "conversation.overlay": [{ id: "notes.floating", Overlay: NoteFloatHost }],
    "side.component": [
      { id: LIST, titleKey: "notes.list", icon: NotebookPen, instances: "singleton", defaultBinding: "host", placement: { home: "chat", order: 200 }, parseParams: parseList,
        init: (params: ListState, previous: ListState | null) => ({ ...previous, ...params }), restore: (raw) => parseList(raw), useTab: useListTab, Body: NotesListCard,
        launcher: { order: 300, params: (): Json => { const id = useApp.getState().selectedId; return id ? { sessionId: id, scope: "session" } : {}; } } },
      { id: NOTE, titleKey: "notes.note", icon: StickyNote, instances: "multi", defaultBinding: "host", peekable: true, placement: { home: "chat", order: 210 },
        parseParams: parseNote, dedupeKey: (params: NoteState) => params.noteId, init: (params: NoteState, previous: NoteState | null) => ({ ...previous, ...params }), restore: (raw) => parseNote(raw),
        toRef: (state: NoteState) => ({ key: state.noteId, title: state.title ?? state.noteId, params: { noteId: state.noteId }, snippet: state.snippet }), fromRef: (params) => parseNote(params), useTab: useNoteTab, Body: NoteView, Actions: NoteActions },
    ],
    "ref.action": [{ id: "notes.addToTurn", kinds: ["turn"], icon: StickyNote, titleKey: "notes.addToTurn", useState: useTurnNotesState, run: draftFromTurn }],
    // Inline at the end of the turn (like its file-changes line), never in a margin: owner, 2026-10-15.
    "timeline.turnAttachment": [{ id: "notes.turn", order: 200, Attachment: TurnNotes }],
  },
  activate: startNotesSync,
});
