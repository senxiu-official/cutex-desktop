// A status-row chip (`conversation.status` items' Bar): a small label button with a panel floating
// up over the timeline, positioned against the status row (StatusBar is `relative`). The panel
// closes on an outside click or Esc. Open state is the caller's, so a request (slash command, chip
// elsewhere) can open it.
import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight, ChevronUp } from "lucide-react";
import { useTrackOverlay } from "../lib/openOverlays";

/** "+2" after a status line that stands for more than one item. */
export function StatusMore({ n }: { n: number }) {
  return n > 1 ? <span className="shrink-0 text-xs text-subtle tabular-nums">+{n - 1}</span> : null;
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
  const root = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  useTrackOverlay(open);
  useEffect(() => {
    if (!open) return;
    // Menus / dialogs opened from inside the panel (context menu, job output) don't close it.
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[role=dialog],[role=menu]") && change.current(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && change.current(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="shrink-0">
      <button onClick={() => onOpenChange(!open)} title={title} aria-expanded={open} className={`flex items-center gap-1 py-1 text-xs tabular-nums hover:text-foreground ${className}`}>
        {label}
        {open ? <ChevronUp size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && <div className={`absolute bottom-full z-30 max-h-80 max-w-[calc(100%-3rem)] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-xl ${panelClassName}`}>{children}</div>}
    </div>
  );
}
