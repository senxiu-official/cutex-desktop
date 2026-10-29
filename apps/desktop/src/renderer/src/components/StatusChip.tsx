import { isImeComposing } from "../lib/ime";
// A status-row chip (`conversation.status` items' Bar): a small label button with a panel floating
// up over the timeline, positioned against the status row (StatusBar is `relative`). The panel
// closes on an outside click or Esc. Open state is the caller's, so a request (slash command, chip
// elsewhere) can open it.
import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { useTrackOverlay } from "../lib/openOverlays";
import { useOwnerWindow } from "../lib/ownerContext";

/** "+2" after a status line that stands for more than one item. */
export function StatusMore({ n }: { n: number }) {
  return n > 1 ? <span className="shrink-0 text-xs text-subtle tabular-nums">+{n - 1}</span> : null;
}

/**
 * A chip's words that give way in a narrow status row (StatusBar `data-tight`, lib/statusRow): `full` normally,
 * `short` (e.g. the count alone) when tight — `full` then stays for screen readers.
 */
export function StatusChipWords({ full, short }: { full: ReactNode; short: ReactNode }) {
  return (
    <>
      <span className="group-data-[tight]/status:sr-only">{full}</span>
      <span aria-hidden className="hidden group-data-[tight]/status:inline">
        {short}
      </span>
    </>
  );
}

export function StatusChip({
  open,
  onOpenChange,
  label,
  title,
  className = "text-muted",
  panelClassName = "right-6 w-[26rem]",
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Icon + text of the button. */
  label: ReactNode;
  title?: string;
  /** Button tone. */
  className?: string;
  /** Panel side + width. */
  panelClassName?: string;
  children: ReactNode;
}) {
  const win = useOwnerWindow();
  const root = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  useTrackOverlay(open);
  useEffect(() => {
    if (!open) return;
    // Menus / dialogs opened from inside the panel (context menu, job output) don't close it.
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[role=dialog],[role=menu]") && change.current(false);
    const onKey = (e: KeyboardEvent) => !isImeComposing(e) && e.key === "Escape" && change.current(false);
    win.document.addEventListener("mousedown", onDown);
    win.document.addEventListener("keydown", onKey);
    return () => {
      win.document.removeEventListener("mousedown", onDown);
      win.document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="shrink-0">
      <button onClick={() => onOpenChange(!open)} title={title} aria-expanded={open} className={`flex items-center gap-1 py-1 text-xs tabular-nums hover:text-foreground ${className}`}>
        {label}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && <div data-popover="" className={`absolute bottom-full z-50 max-h-80 max-w-[calc(100%-3rem)] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl ${panelClassName}`}>{children}</div>}
    </div>
  );
}
