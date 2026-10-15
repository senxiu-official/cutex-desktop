// Popup above the composer for the slash-command palette and @-file mentions: title, rows of
// "sigil+name  muted description", the keyboard-selected row highlighted, footer hint.
// Keyboard handling lives in the Composer (the textarea keeps focus).
import { useEffect, useRef } from "react";
import { Info } from "lucide-react";

export interface PaletteRow {
  key: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Small trailing tag (e.g. "skill"). */
  tag?: string;
}

export function SlashPalette({
  title,
  rows,
  selected,
  empty,
  footer,
  onHover,
  onPick,
}: {
  title: string;
  rows: PaletteRow[];
  selected: number;
  empty: string;
  footer?: string;
  onHover(index: number): void;
  onPick(index: number): void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div className="absolute right-0 bottom-full left-0 z-30 mb-1.5 rounded-xl border border-border bg-surface p-1 shadow-xl" onMouseDown={(e) => e.preventDefault()}>
      <div className="px-2.5 pt-1.5 pb-1 text-xs text-subtle">{title}</div>
      <div ref={list} role="listbox" className="max-h-64 overflow-y-auto">
        {rows.length === 0 && <p className="px-2.5 py-1.5 text-sm text-subtle">{empty}</p>}
        {rows.map((row, i) => (
          <button
            key={row.key}
            data-index={i}
            role="option"
            aria-selected={i === selected}
            onMouseMove={() => i !== selected && onHover(i)}
            onClick={() => onPick(i)}
            className={`flex w-full items-baseline gap-2.5 rounded-lg px-2.5 py-1.5 text-left ${i === selected ? "bg-surface-2" : ""} ${row.disabled ? "opacity-50" : ""}`}
          >
            <span className="shrink-0 text-sm text-foreground">{row.label}</span>
            {row.description && <span className="min-w-0 flex-1 truncate text-sm text-subtle">{row.description}</span>}
            {row.tag && <span className="ml-auto shrink-0 rounded bg-surface-2 px-1.5 py-px text-[10px] text-muted">{row.tag}</span>}
          </button>
        ))}
      </div>
      {footer && (
        <div className="mt-1 flex items-center gap-2 border-t border-border px-2.5 pt-1.5 pb-1 text-xs text-subtle">
          <Info size={13} className="shrink-0" />
          <span>{footer}</span>
        </div>
      )}
    </div>
  );
}
