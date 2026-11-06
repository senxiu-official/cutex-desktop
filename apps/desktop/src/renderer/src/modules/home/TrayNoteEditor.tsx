// 「备注…」 on a tray entry (owner 2026-10-24): a small editor beside the item, away from the tray's edge. Enter saves,
// Shift+Enter starts a new line, Esc cancels; the tray shows only the first line (said under the field). A press
// outside closes it only when nothing was changed. What is edited and how it is saved: modules/home/trayNotes.
import { isImeComposing } from "../../lib/ime";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { useTrayPrefs } from "../../lib/trayPrefs";
import { closeNoteEdit, useNoteEdit, type NoteEdit } from "./trayNotes";
import { isNode } from "../../lib/ownerWindow";
import { useOwnerWindow } from "../../lib/ownerContext";

const W = 300;
const GAP = 8;

function place(anchor: NoteEdit["anchor"], edge: string, height: number, win: Window): CSSProperties {
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const left = Math.max(GAP, Math.min(anchor.left, vw - W - GAP));
  const top = Math.max(GAP, Math.min(anchor.top, vh - height - GAP));
  if (edge === "top") return { left, top: Math.min(anchor.bottom + GAP, vh - height - GAP) };
  if (edge === "left") return { left: Math.min(anchor.right + GAP, vw - W - GAP), top };
  if (edge === "right") return { left: Math.max(GAP, anchor.left - GAP - W), top };
  return { left, top: Math.max(GAP, anchor.top - GAP - height) };
}

let seq = 0;

/** Drawn by every dock (the tray, 「… N」's list): one of them hosts the editor. */
export function TrayNoteEditor() {
  const [id] = useState(() => ++seq);
  const host = useNoteEdit((s) => s.host);
  const edit = useNoteEdit((s) => s.edit);
  useEffect(() => {
    if (host === null) useNoteEdit.setState({ host: id });
  }, [host, id]);
  useEffect(
    () => () => {
      if (useNoteEdit.getState().host === id) useNoteEdit.setState({ host: null });
    },
    [id],
  );
  return edit && host === id ? <Editor key={`${edit.name}|${edit.anchor.left}|${edit.anchor.top}`} edit={edit} /> : null;
}

function Editor({ edit }: { edit: NoteEdit }) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const edge = useTrayPrefs((s) => s.edge);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(edit.initial);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({ left: -9999, top: 0 });
  useLayoutEffect(() => {
    setPos(place(edit.anchor, edge, box.current?.offsetHeight ?? 150, win));
    const el = field.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [edit, edge, win]);
  const dirty = text !== edit.initial;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (isNode(e.target) && !box.current?.contains(e.target) && !dirtyRef.current) closeNoteEdit();
    };
    win.addEventListener("pointerdown", away, true);
    return () => win.removeEventListener("pointerdown", away, true);
  }, [win]);
  const save = async (note: string | null) => {
    if (busy || (note !== null && note.length > edit.max)) return;
    setBusy(true);
    const ok = await edit.save(note?.trim() ? note : null).catch(() => false);
    setBusy(false);
    if (ok) closeNoteEdit();
  };
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={t("tray.note.title", { name: edit.name })}
      data-tray-note-editor=""
      className="tray-note-editor"
      style={{ ...pos, width: W }}
      onKeyDown={(e) => {
        if (!isImeComposing(e) && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeNoteEdit();
        }
      }}
    >
      <div className="mb-1.5 truncate text-meta font-semibold">{t("tray.note.title", { name: edit.name })}</div>
      <textarea
        ref={field}
        value={text}
        maxLength={edit.max}
        rows={3}
        placeholder={t("tray.note.placeholder")}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !isImeComposing(e)) {
            e.preventDefault();
            void save(text);
          }
        }}
        className="block w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-meta text-foreground outline-none focus:border-accent"
      />
      <div className="mt-1.5 flex items-center gap-2 text-caption text-subtle">
        <span className="min-w-0 flex-1 truncate" data-tip={t("tray.note.keys")}>
          {t("tray.note.firstLine")} · <span data-note-count="">{text.length} / {edit.max}</span>
        </span>
        {(edit.initial || text) && (
          <button type="button" data-note-clear="" disabled={busy} onClick={() => void save(null)} className="rounded-md px-2 py-0.5 text-foreground hover:bg-hover">
            {t("tray.note.clear")}
          </button>
        )}
        <button type="button" data-note-save="" disabled={busy || !dirty || text.length > edit.max} onClick={() => void save(text)} className="rounded-md bg-accent px-2.5 py-0.5 font-medium text-white hover:opacity-90 disabled:opacity-50">
          {t("tray.note.save")}
        </button>
      </div>
      <div className="mt-1 text-caption text-subtle">{t("tray.note.keys")}</div>
    </div>,
    win.document.body,
  );
}
