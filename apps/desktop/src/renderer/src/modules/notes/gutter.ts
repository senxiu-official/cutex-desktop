import type { Note } from "../../../../shared/notes";
import { hasPin } from "./model";

/** The entry page is not the daemon's broad project/host aggregate. Natural project
 * membership stays discoverable under All; only an explicit scope/pin promotes it here. */
export function conversationNotes(notes: readonly Note[], sessionId: string, projectId?: string) {
  const unique = [...new Map(notes.map((note) => [note.id, note])).values()];
  const sessionScope = { kind: "session" as const, id: sessionId };
  const mine = (note: Note) => note.anchor?.sessionId === sessionId
    || note.scope.kind === "session" && note.scope.id === sessionId
    || hasPin(note.pins, sessionScope);
  const current = unique.filter(mine);
  const project = projectId ? unique.filter((note) => !mine(note)
    && (note.scope.kind === "project" && note.scope.id === projectId || hasPin(note.pins, { kind: "project", id: projectId }))) : [];
  return { current, project };
}
