import { useState } from "react";
import { ArrowUpRight, Eye, Pencil, Pin, Quote } from "lucide-react";
import { Streamdown } from "streamdown";
import type { Note, NoteScope } from "../../../../shared/notes";
import { ArmedRemove, Button, IconButton } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useStreamdownTranslations } from "../../lib/streamdownTranslations";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { agentHost, useApp, viewHostOf } from "../../store";
import { anchorStatus, hasPin, noteQuote, togglePin } from "./model";
import { openNoteSource } from "./actions";
import { NoteEditor } from "./NoteEditor";
import { notesCache, setNoteDraft, useNoteDrafts, useHostSidebar } from "./store";
import { noteErrorText } from "./errors";

export function NoteCard({ hostId, note, projectId, readOnly = false, onDismissEditor }: { hostId: string; note: Note; projectId?: string; readOnly?: boolean; onDismissEditor?(): void }) {
  const { t, locale } = useI18n();
  const translations = useStreamdownTranslations();
  const now = useClock();
  const updated = Date.parse(note.updatedAt) / 1000;
  const draftKey = JSON.stringify([hostId, "edit", note.id]);
  const draft = useNoteDrafts((s) => s.drafts[draftKey]);
  const sourceSession = note.anchor?.sessionId ?? (note.scope.kind === "session" ? note.scope.id : undefined);
  // The source agent may be open from another host in the scope (multi-host P1): its own host, not the focus.
  const history = useApp((s) => sourceSession && viewHostOf(sourceSession) === hostId ? s.sessions[sourceSession] : undefined);
  useApp((s) => sourceSession && viewHostOf(sourceSession) === hostId ? s.sessions[sourceSession]?.version : undefined);
  const sidebar = useHostSidebar(hostId);
  const sourceName = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === sourceSession)?.displayName;
  const quoteTarget = useApp((s) => agentHost(s) === hostId ? s.selectedId : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = anchorStatus(note, history);
  const unavailable = status === "reverted" || status === "sessionDeleted";
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const openSource = (how: "peek" | "jump") => void run(async () => {
    const result = await openNoteSource(hostId, note, how, sourceName);
    if (result.status !== "opened") throw new Error(result.status === "stale" ? "stale" : result.reason);
  });
  const pin = (scope: NoteScope) => void run(() => notesCache.update(hostId, note.id, { expectedRevision: note.revision, pins: togglePin(note.pins, scope) }));
  const project = projectId ? { kind: "project" as const, id: projectId } : null;
  if (draft && !readOnly) return <NoteEditor hostId={hostId} draftKey={draftKey} currentNote={note} onDismiss={onDismissEditor} />;
  return <article className="min-w-0 space-y-2 rounded-lg border border-border bg-surface p-2.5" data-note-id={note.id}>
    <div className="flex min-w-0 items-start gap-1.5">
      <h3 className="min-w-0 flex-1 break-words text-sm font-medium">{note.title || t("notes.untitled")}</h3>
      {!!note.pins.length && <Pin size={12} className="mt-1 shrink-0 text-accent" aria-label={t("notes.pinned")} />}
      {!readOnly && <><IconButton label={t("notes.edit")} disabled={busy} onClick={() => setNoteDraft(draftKey, { clientNonce: crypto.randomUUID(), title: note.title, body: note.body, scope: note.scope, pins: note.pins, anchor: note.anchor, noteId: note.id, revision: note.revision })}><Pencil size={12} /></IconButton>
      <ArmedRemove title={t("notes.delete")} disabled={busy} armedLabel={t("notes.deleteConfirm")} onRemove={() => void run(() => notesCache.remove(hostId, note))} /></>}
    </div>
    {/* Wraps like a notification (styles.css .wrap-all): code and tables too, never a sideways scrollbar. */}
    <div className="wrap-all min-w-0 break-words text-[13px] leading-relaxed"><Streamdown mode="static" className="markdown" translations={translations}>{note.body}</Streamdown></div>
    {unavailable && <p className="text-xs text-warn" title={note.anchorStateAt ?? undefined}>{t(status === "sessionDeleted" ? "notes.sessionDeleted" : "notes.reverted")}</p>}
    {status === "unknown" && <p className="text-xs text-subtle">{t("notes.sourceUnknown")}</p>}
    {error && <p role="alert" className="text-xs text-danger">{noteErrorText(error, t)}</p>}
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
      {sourceSession && <><Button disabled={busy || unavailable} onClick={() => openSource("peek")}><Eye size={12} className="mr-1 inline" />{t(note.anchor?.turnId ? "notes.peekSource" : "notes.sourceSession")}</Button>
      {note.anchor?.turnId && <Button disabled={busy || unavailable} onClick={() => openSource("jump")}><ArrowUpRight size={12} className="mr-1 inline" />{t("notes.source")}</Button>}</>}
      {!readOnly && <><Button disabled={!quoteTarget} title={t(quoteTarget ? "notes.quoteHint" : "notes.quoteUnavailable")} onClick={() => {
        const s = useApp.getState();
        if (s.selectedId && agentHost(s) === hostId) s.insertIntoComposer(s.selectedId, noteQuote(note), "append");
      }}><Quote size={12} className="mr-1 inline" />{t("notes.quote")}</Button>
      {[{ kind: "host" as const }, ...(project ? [project] : [])].map((scope) => <button key={scope.kind} disabled={busy} aria-pressed={hasPin(note.pins, scope)} title={t("notes.pinHint")} className={`rounded px-1 py-1 text-xs hover:bg-hover ${hasPin(note.pins, scope) ? "text-accent" : "text-subtle"}`} onClick={() => pin(scope)}><Pin size={11} className="mr-1 inline" />{t(scope.kind === "host" ? "notes.scope.host" : "notes.scope.project")}</button>)}</>}
    </div>
    <p className="text-[11px] text-subtle" title={Number.isFinite(updated) ? formatAbsolute(updated) : undefined}>{sourceName ? `${sourceName} · ` : ""}{t("notes.savedAt", { time: Number.isFinite(updated) ? formatWhen(updated, now, locale) : note.updatedAt })}</p>
  </article>;
}
