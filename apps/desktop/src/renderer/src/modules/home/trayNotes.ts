// Notes on the tray's entries (owner 2026-10-24, preview-tray-notes-badges v2 layout 甲): the note's first line is written
// on the item (right of the avatar; under it in a vertical tray), shortened before anything folds into 「… N」, whose
// list shows the whole note. Right-click 「备注…」 edits it in place (TrayNoteEditor). Where it is kept: an agent's note is
// its cutex session `note` (one fenced metadata update, lib/menus setAgentNote); an app's is `pins[i].note` in the home
// document (unknown pin keys are kept by cutex and the client). A capsule of several agents has no note of its own.
import { create } from "zustand";
import type { HomeDoc, HomePin } from "../../../../shared/home";
import { pinId, pinsOf } from "./model";

/** cutex's limit on a session note. */
export const AGENT_NOTE_MAX = 280;
/** An app's note (the home document is capped at 64 KB with up to 64 pins). */
export const APP_NOTE_MAX = 140;

/** The whole note (trimmed), or null for none. */
export function noteText(note: unknown): string | null {
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

/** What the tray writes on the item: the note's first line (trimmed), or null. */
export function noteLine(note: unknown): string | null {
  const text = noteText(note);
  return text ? text.split(/\r?\n/, 1)[0]!.trim() || null : null;
}

/** A pinned app's note. */
export const pinNote = (pin: HomePin): string | null => noteText(pin.note);

/** The document with pin `id`'s note set (null / blank: removed), cut to APP_NOTE_MAX. */
export function withPinNote(doc: HomeDoc, id: string, note: string | null): HomeDoc {
  const text = noteText(note)?.slice(0, APP_NOTE_MAX) ?? null;
  const pins = pinsOf(doc);
  const at = pins.findIndex((p) => pinId(p) === id);
  if (at < 0 || noteText(pins[at]!.note) === text) return doc;
  const next = { ...pins[at]! };
  if (text) next.note = text;
  else delete next.note;
  return { ...doc, pins: pins.map((p, i) => (i === at ? next : p)) };
}

/** An open 「备注…」 editor: whose note, where, and how it is saved (false: not saved, the editor stays). */
export interface NoteEdit {
  name: string;
  initial: string;
  max: number;
  /** The item's box when the menu was opened (the editor opens beside it, away from the tray's edge). */
  anchor: { left: number; top: number; right: number; bottom: number };
  save(note: string | null): Promise<boolean>;
}

/** `host`: the dock that draws the editor (several docks are mounted: the tray, 「… N」's list). */
export const useNoteEdit = create<{ edit: NoteEdit | null; host: number | null }>(() => ({ edit: null, host: null }));

export function openNoteEdit(edit: NoteEdit): void {
  useNoteEdit.setState({ edit });
}

export function closeNoteEdit(): void {
  useNoteEdit.setState({ edit: null });
}
