import { StickyNote } from "lucide-react";
import { useI18n } from "../../i18n";
import { useModulePref } from "../react";
import type { TurnAttachmentProps } from "../slots";
import { openTurnNotes } from "./floating";
import { useNotesQuery } from "./store";

/** Note chips on the collapsed line; the rest count as +N. */
const CHIPS = 2;

/**
 * Only a compact entry lives in the timeline, at the end of the turn in the turn summary's style
 * (「✎ 批注 · [chip] · [chip] · +N」); editors and note bodies float.
 */
export function TurnNotes({ hostId, sessionId, turnId }: TurnAttachmentProps) {
  const { t } = useI18n();
  const [show] = useModulePref("notes", "showTimeline", true);
  const result = useNotesQuery(hostId, { scope: "session", id: sessionId }, true, show);
  const notes = show ? result.notes.filter((n) => n.anchor?.sessionId === sessionId && n.anchor.turnId === turnId) : [];
  if (!notes.length) return null;
  const label = t("notes.viewFloat", { n: notes.length });
  const open = (el: HTMLElement) => openTurnNotes(hostId, sessionId, turnId, false, el);
  const more = notes.length - CHIPS;
  return (
    <div className="mt-1.5 flex h-5 min-w-0 items-center gap-1.5 text-xs text-muted" data-turn-notes={turnId}>
      <button onClick={(e) => open(e.currentTarget)} title={label} aria-label={label} aria-haspopup="dialog" className="flex shrink-0 items-center gap-1.5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">
        <StickyNote size={13} className="text-accent" />
        <span>{t("notes.title")}</span>
      </button>
      {notes.slice(0, CHIPS).map((note) => (
        <span key={note.id} className="flex min-w-12 items-center gap-1.5">
          <span className="shrink-0 text-subtle">·</span>
          <button
            onClick={(e) => open(e.currentTarget)}
            title={note.title || t("notes.untitled")}
            aria-haspopup="dialog"
            className="flex h-[18px] max-w-56 min-w-0 items-center rounded-md border border-border bg-surface px-1.5 text-[11px] text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="truncate">{note.title || t("notes.untitled")}</span>
          </button>
        </span>
      ))}
      {more > 0 && (
        <button onClick={(e) => open(e.currentTarget)} title={label} className="shrink-0 text-subtle hover:text-foreground">
          · +{more}
        </button>
      )}
    </div>
  );
}
