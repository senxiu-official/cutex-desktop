import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StickyNote, X } from "lucide-react";
import { useI18n } from "../../i18n";
import { useTrackOverlay } from "../../lib/openOverlays";
import { agentHost, useApp } from "../../store";
import type { OverlayLayout } from "../slots";
import { closeTurnNotes, finishTurnNote, noteFloatPosition, useNoteFloat, type NoteFloat as FloatState } from "./floating";
import { trackNoteFloat } from "./floatAnchor";
import { NoteCard } from "./NoteCard";
import { NoteEditor } from "./NoteEditor";
import { turnDraftKey, useNoteDrafts, useNotesQuery } from "./store";
import { noteErrorText } from "./errors";

function FloatingCard({ active }: { active: FloatState }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof noteFloatPosition>>(null);
  const key = turnDraftKey(active.hostId, active.sessionId, active.turnId);
  const draft = useNoteDrafts(s => s.drafts[key]);
  const result = useNotesQuery(active.hostId, { scope: "session", id: active.sessionId }, true);
  const notes = result.notes.filter(n => n.anchor?.sessionId === active.sessionId && n.anchor.turnId === active.turnId);
  // Uses the existing overlay Escape guard; no layout reservation or backdrop.
  useTrackOverlay(true);
  const close = (returnFocus = true) => {
    closeTurnNotes(active.id);
    if (returnFocus && active.trigger?.isConnected) active.trigger.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!origin.current) return;
    return trackNoteFloat(origin.current, active.turnId, setPosition, () => closeTurnNotes(active.id));
  }, [active.id, active.turnId]);
  const visible = !!position;
  useLayoutEffect(() => {
    if (visible && !box.current?.contains(document.activeElement)) box.current?.focus({ preventScroll: true });
  }, [visible]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (box.current?.contains(target) || active.trigger?.contains(target)) return;
      if (target instanceof Element && target.closest('[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"]')) return;
      close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (document.querySelector('[role="menu"],[role="listbox"],[role="alertdialog"]')) return;
      event.preventDefault(); close();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape);
    return () => { window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", escape); };
  }, [active]);
  return <><span ref={origin} hidden aria-hidden="true" />{position && createPortal(<div ref={box} role="dialog" aria-modal="false" aria-label={t("notes.floating")} tabIndex={-1} data-note-float
    className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-card-border bg-background text-foreground shadow-2xl outline-none" style={position}>
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <StickyNote size={15} className="text-accent" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{t(active.editing && draft ? "notes.new" : "notes.title")}</span>
      <button title={t("notes.closeFloat")} aria-label={t("notes.closeFloat")} onClick={() => close()} className="rounded p-1 text-subtle hover:bg-hover hover:text-foreground"><X size={15} /></button>
    </header>
    <div className="min-h-0 space-y-2 overflow-auto p-3">
      {active.editing && draft ? <NoteEditor hostId={active.hostId} draftKey={key} onSaved={() => finishTurnNote(active.id)} onCancel={() => close()} onDismiss={() => close()} /> : <>
        {result.error && <p role="alert" className="text-xs text-danger">{noteErrorText(result.error, t)}</p>}
        {!notes.length && <p className="py-4 text-center text-sm text-subtle">{t(result.loading ? "notes.loading" : "notes.empty")}</p>}
        {notes.map(note => <NoteCard key={note.id} hostId={active.hostId} note={note} onDismissEditor={() => close()} />)}
      </>}
    </div>
    {position.maxHeight >= 260 && <p className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-subtle">{t("notes.floatHint")}</p>}
  </div>, document.body)}</>;
}

/** Existing conversation.overlay slot, but always zero reserved space. */
export function NoteFloatHost({ sessionId, reserve }: { sessionId: string; reserve(layout: OverlayLayout | null): void }) {
  const hostId = useApp(agentHost);
  const active = useNoteFloat(s => s.active);
  useEffect(() => {
    reserve(null);
    return () => {
      reserve(null);
      const current = useNoteFloat.getState().active;
      if (current?.hostId === hostId && current.sessionId === sessionId) closeTurnNotes(current.id);
    };
  }, [hostId, sessionId, reserve]);
  return active?.hostId === hostId && active.sessionId === sessionId ? <FloatingCard key={active.id} active={active} /> : null;
}
