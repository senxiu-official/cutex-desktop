// The settings preview control (owner 2026-10-18, picked in /settings-variants.html: B6 + L1 + M3): the
// last band of a card, edge to edge, the window's darkest colour with a dot grid; a plain 「● 实时预览」
// head with a rule under it (not a box: a box read like part of the sample); the sample below in one
// line that wraps, inert (no pointer, no selection, hidden from the accessibility tree).
import { useContext, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useI18n } from "../../i18n";
import { PreviewMarkContext } from "../../lib/previewMark";
import type { TermId } from "../../lib/terms";

const DOTS = { backgroundImage: "radial-gradient(color-mix(in srgb, var(--fg) 13%, transparent) 1px, transparent 1px)", backgroundSize: "12px 12px" };

/**
 * Place as a card's last child (a `Section` body): it bleeds to the card's edges and bottom corners.
 * `inline`: a band between rows of the same card (one card, several previews): square, ruled below too.
 * `alone`: the only thing in its card (a page-level preview): fills the whole card.
 */
export function PreviewBand({ note, control, label, inline, alone, collapsible, children }: { note?: string; control?: ReactNode; label?: string; inline?: boolean; alone?: boolean; /** Closed: only the head, as a button; the sample renders once opened. */ collapsible?: { open: boolean; onToggle(): void }; children: ReactNode }) {
  const { t } = useI18n();
  const open = !collapsible || collapsible.open;
  return (
    <div data-settings-preview role="group" aria-label={label ?? t("settings.preview")} className={`-mx-4 bg-win px-4 pb-3 ${alone ? "-my-1 rounded-xl" : `-mt-px border-t border-border/70 ${inline ? "border-b" : "-mb-1 rounded-b-xl"}`}`} style={DOTS}>
      <div className={`-mx-4 flex min-h-8 items-center gap-2 bg-win px-4 py-1.5 text-[11px] text-subtle ${open ? "mb-3 border-b border-border/50" : "-mb-3 rounded-b-xl"} ${alone ? "rounded-t-xl" : ""}`}>
        {collapsible ? (
          <button type="button" aria-expanded={open} onClick={collapsible.onToggle} className="inline-flex items-center gap-1.5 font-medium tracking-wider text-muted hover:text-foreground">
            <ChevronRight size={12} aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`} />
            <span className={`h-1.5 w-1.5 rounded-full ${open ? "bg-ok" : "bg-subtle"}`} aria-hidden />
            {t("settings.preview")}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-medium tracking-wider text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
            {t("settings.preview")}
          </span>
        )}
        {note && <span className="ml-auto">{note}</span>}
        {control && <span className={note ? "" : "ml-auto"}>{control}</span>}
      </div>
      {open && (
        <div className="pointer-events-none select-none" aria-hidden>
          {children}
        </div>
      )}
    </div>
  );
}

/** A word in a preview that a setting changes: plain, or accent blue while marked (PreviewMarkContext). */
export function PreviewTerm({ id, children }: { id: TermId; children: ReactNode }) {
  const { all, focus } = useContext(PreviewMarkContext);
  return <span data-preview-term={id} className={`transition-colors duration-200 ${all || focus === id ? "text-accent" : ""}`}>{children}</span>;
}
