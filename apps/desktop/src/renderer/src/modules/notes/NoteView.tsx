import { useEffect } from "react";
import { ArrowUpRight, Eye } from "lucide-react";
import { Button, IconButton } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useApp, viewOf } from "../../store";
import { services } from "../app";
import type { SideBodyProps } from "../slots";
import { anchorStatus, type NoteState } from "./model";
import { openNoteSource } from "./actions";
import { NoteCard } from "./NoteCard";
import { notesCache, useNote } from "./store";
import { noteErrorText } from "./errors";

export function NoteView({ hostId, instance, setState, visible, where }: SideBodyProps<NoteState>) {
  const { t } = useI18n();
  const state = instance.state;
  const result = useNote(hostId ?? "", state.noteId, visible && !!hostId);
  useEffect(() => {
    if (!result.note) return;
    const title = result.note.title.slice(0, 200), snippet = result.note.body.slice(0, 500);
    if (title !== state.title || snippet !== state.snippet) setState({ noteId: state.noteId, title, snippet });
  }, [result.note, state, setState]);
  if (!hostId) return null;
  return <div className="min-h-0 flex-1 overflow-auto p-2.5">
    {result.note ? <NoteCard hostId={hostId} note={result.note} readOnly={where === "peek"} /> : <div className="space-y-2 text-xs text-subtle">
      <p>{noteErrorText(result.error, t) ?? t(result.loading ? "notes.loading" : "notes.missing")}</p>
      {state.snippet && <p className="whitespace-pre-wrap break-words">{state.snippet}</p>}
      <Button disabled={result.loading} onClick={() => void notesCache.refreshNote(hostId, state.noteId)}>{t("notes.refresh")}</Button>
    </div>}
  </div>;
}

/** Container-owned card header / peek footer actions; neither one mutates the note or the main chat. */
export function NoteActions({ hostId, instance, visible }: SideBodyProps<NoteState>) {
  const { t } = useI18n();
  const { note } = useNote(hostId ?? "", instance.state.noteId, visible && !!hostId);
  const sessionId = note?.anchor?.sessionId;
  const history = useApp((s) => sessionId && hostId ? viewOf(s, hostId, sessionId) : undefined);
  useApp((s) => sessionId && hostId ? viewOf(s, hostId, sessionId)?.version : undefined);
  if (!hostId || !note?.anchor?.turnId) return null;
  const status = anchorStatus(note, history);
  const disabled = status === "reverted" || status === "sessionDeleted";
  const open = (how: "peek" | "jump") => void openNoteSource(hostId, note, how).then((r) => {
    if (r.status !== "opened") services.ui.notice(r.status === "stale" ? "stale" : r.reason, "error");
  }).catch((e) => services.ui.notice(String(e), "error"));
  return <>
    <IconButton label={t("notes.peekSource")} disabled={disabled} onClick={() => open("peek")}><Eye size={13} /></IconButton>
    <IconButton label={t("notes.source")} disabled={disabled} onClick={() => open("jump")}><ArrowUpRight size={13} /></IconButton>
  </>;
}
