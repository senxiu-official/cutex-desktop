import type { Note } from "../../../../shared/notes";
import { services } from "../app";
import type { RefOpenResult } from "../slots";
import { sourceRef } from "./model";

/** The same source navigation in a note's body and the container's Actions outlet. */
export async function openNoteSource(hostId: string, note: Note, how: "peek" | "jump", name?: string): Promise<RefOpenResult> {
  if (note.anchorState === "reverted") return { status: "unavailable", reason: "reverted" };
  if (note.anchorState === "sessionDeleted") return { status: "unavailable", reason: "gone" };
  const ref = sourceRef(hostId, note, name);
  return ref ? services.refs.open(ref, { how }) : { status: "unavailable", reason: "gone" };
}
