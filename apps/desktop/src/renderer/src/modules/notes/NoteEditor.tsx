import { useId, useState } from "react";
import { Pin } from "lucide-react";
import type { Note, NoteScope } from "../../../../shared/notes";
import { NOTE_BODY_LIMIT, NOTE_TITLE_LIMIT } from "../../../../shared/notes";
import { Button, Select, TextInput, Toggle } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { hasPin, sameScope, togglePin } from "./model";
import { notesCache, patchNoteDraft, setNoteDraft, useNoteDrafts, useHostSidebar } from "./store";
import { noteErrorText } from "./errors";

export function NoteEditor({ hostId, draftKey, currentNote, onSaved, onCancel, onDismiss }: { hostId: string; draftKey: string; currentNote?: Note; onSaved?(): void; onCancel?(): void; onDismiss?(): void }) {
  const { t } = useI18n();
  const id = useId();
  const draft = useNoteDrafts((state) => state.drafts[draftKey]);
  const projects = useHostSidebar(hostId)?.projects?.projects;
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!draft) return null;
  const patch = (value: Parameters<typeof patchNoteDraft>[1]) => patchNoteDraft(draftKey, value);
  const pinProject: NoteScope | null = projectId ? { kind: "project", id: projectId } : null;
  const conflict = !!currentNote && draft.revision !== currentNote.revision;
  const save = async () => {
    if (busy || conflict || !draft.body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const title = draft.title.trim() || draft.body.trim().split("\n")[0]!.replace(/^#+\s*/, "").slice(0, 120);
      if (draft.noteId) {
        await notesCache.update(hostId, draft.noteId, { expectedRevision: draft.revision!, title, body: draft.body, pins: draft.pins });
      } else {
        await notesCache.create(hostId, { clientNonce: draft.clientNonce, title, body: draft.body, scope: draft.scope, pins: draft.pins, anchor: draft.anchor });
      }
      // A late reply must never erase text typed after this request.
      if (useNoteDrafts.getState().drafts[draftKey] === draft) setNoteDraft(draftKey, null);
      onSaved?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setBusy(false); }
  };
  return (
    <section onKeyDown={(event) => {
      if (event.key === "Escape" && !event.repeat && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !busy) { event.preventDefault(); if (onDismiss) onDismiss(); else setNoteDraft(draftKey, null); }
    }} className="space-y-3 rounded-xl border border-accent/40 bg-surface p-3" aria-label={draft.noteId ? t("notes.edit") : t("notes.new")}>
      <TextInput label={t("notes.titleField")} placeholder={t("notes.titleField")} value={draft.title} onChange={(title) => patch({ title })} width="w-full" maxLength={NOTE_TITLE_LIMIT} disabled={busy} autoFocus />
      <label className="block text-xs text-subtle" htmlFor={id}>{t("notes.bodyField")}</label>
      <textarea id={id} value={draft.body} disabled={busy} onChange={(event) => patch({ body: event.target.value })} rows={7} maxLength={NOTE_BODY_LIMIT}
        className="min-h-24 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); }
        }} />
      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2"><Pin size={13} /><span>{t("notes.pins")}</span></div>
        <p className="text-subtle">{t("notes.pinHint")}</p>
        {draft.scope.kind === "session" && <div className="flex flex-wrap items-center gap-2">
          <Toggle label={t("notes.pinSession")} checked={hasPin(draft.pins, draft.scope)} disabled={busy} onChange={() => patch({ pins: togglePin(draft.pins, draft.scope) })} />
          <span>{t("notes.pinSession")}</span>
        </div>}
        <div className="flex flex-wrap items-center gap-2">
          <Toggle label={t("notes.pinHost")} checked={hasPin(draft.pins, { kind: "host" })} disabled={busy} onChange={() => patch({ pins: togglePin(draft.pins, { kind: "host" }) })} />
          <span>{t("notes.pinHost")}</span>
        </div>
        {!!projects?.length && <div className="flex flex-wrap items-center gap-2">
          <Select label={t("notes.chooseProject")} value={projectId} width="max-w-full w-44" disabled={busy}
            options={[{ value: "", label: t("notes.chooseProject") }, ...projects.map((project) => ({ value: project.project_id, label: project.presentation.display_name || project.project_id }))]} onChange={setProjectId} />
          <Button disabled={!pinProject || busy} onClick={() => pinProject && patch({ pins: togglePin(draft.pins, pinProject) })}>
            {pinProject && hasPin(draft.pins, pinProject) ? t("notes.unpin") : t("notes.pin")}
          </Button>
        </div>}
        <div className="flex flex-wrap gap-1">
          {draft.pins.filter((pin): pin is NoteScope & { kind: "project"; id: string } => pin.kind === "project").map((pin) => <button key={pin.id} disabled={busy}
            className="rounded bg-accent/10 px-2 py-1 text-accent hover:bg-accent/20" title={t("notes.unpin")}
            onClick={() => patch({ pins: draft.pins.filter((other) => !sameScope(pin, other)) })}>
            {projects?.find((project) => project.project_id === pin.id)?.presentation.display_name || pin.id} ×
          </button>)}
        </div>
      </div>
      {conflict && currentNote && <div className="space-y-2 rounded border border-warn/30 p-2 text-xs">
        <p className="text-warn">{t("notes.conflict")}</p>
        <details><summary className="cursor-pointer text-accent">{t("notes.latestVersion")}</summary><pre className="mt-2 whitespace-pre-wrap break-words">{currentNote.title}{"\n\n"}{currentNote.body}</pre></details>
        <button disabled={busy} className="text-accent hover:underline" onClick={() => { patch({ revision: currentNote.revision }); setError(null); }}>{t("notes.useLatestRevision")}</button>
      </div>}
      {error && <div role="alert" className="space-y-1 text-xs text-danger"><p>{noteErrorText(error, t)}</p><p>{t("notes.conflictHint")}</p></div>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button disabled={busy} onClick={() => { setNoteDraft(draftKey, null); onCancel?.(); }}>{t("notes.cancel")}</Button>
        <Button primary disabled={busy || conflict || !draft.body.trim()} onClick={() => void save()}>{t(busy ? "notes.saving" : "notes.save")}</Button>
      </div>
    </section>
  );
}
