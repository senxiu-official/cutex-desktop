import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTrackOverlay } from "../lib/openOverlays";

/** Upward-opening popover anchored to a small trigger button (composer settings row). Stacks above
 * the slash / @ palettes (z-30): it was opened on purpose. */
export function Popover({
  trigger,
  children,
  align = "left",
  onOpen,
  onKey,
  triggerTitle,
  width = "min-w-56",
  overflowVisible = false,
  openSignal = 0,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  onOpen?(): void;
  /** Extra key handling while open (e.g. number shortcuts); return true if handled. */
  onKey?(e: KeyboardEvent, close: () => void): boolean;
  triggerTitle?: string;
  width?: string;
  /** No max height / scroll, so absolutely positioned flyouts inside are not clipped. */
  overflowVisible?: boolean;
  /** Opens the popover whenever this changes to a non-zero value (slash commands). */
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useTrackOverlay(open);
  useEffect(() => {
    if (!openSignal) return;
    onOpen?.();
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (onKey?.(e, close)) e.preventDefault();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onKey]);
  return (
    <div ref={ref} className="relative">
      <button
        title={triggerTitle}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground ${open ? "bg-surface-2 text-foreground" : ""}`}
      >
        {trigger}
      </button>
      {open && (
        <div
          className={`absolute bottom-full z-40 mb-1.5 rounded-xl border border-border bg-surface p-1 shadow-xl ${overflowVisible ? "" : "max-h-96 overflow-y-auto"} ${width} ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export interface MenuItem<T> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  icon?: ReactNode;
  /** Rendered instead of `label` (e.g. a `ref.action` item's live state); `label` stays the key text. */
  labelNode?: ReactNode;
  /** Row tooltip, e.g. why it is disabled. */
  title?: string;
}

/** Single-choice menu; items 1–9 are selectable by number key while open. */
export function Menu<T>({
  title,
  items,
  selected,
  onSelect,
  numbered = true,
  footer,
  ...popover
}: {
  trigger: ReactNode;
  title?: string;
  /** Extra content under the items, styled by the caller (a status note with its own action, what is in effect beyond the selected value). */
  footer?: ReactNode;
  items: MenuItem<T>[];
  selected: T | null;
  onSelect(value: T): void;
  numbered?: boolean;
  align?: "left" | "right";
  onOpen?(): void;
  triggerTitle?: string;
  openSignal?: number;
}) {
  const pick = (item: MenuItem<T> | undefined, close: () => void) => {
    if (!item || item.disabled) return false;
    onSelect(item.value);
    close();
    return true;
  };
  return (
    <Popover
      {...popover}
      onKey={(e, close) => numbered && /^[1-9]$/.test(e.key) && pick(items[Number(e.key) - 1], close)}
    >
      {(close) => (
        <>
          {title && <div className="px-2.5 pt-1.5 pb-1 text-xs text-subtle">{title}</div>}
          {items.map((item, i) => (
            <button
              key={String(item.value)}
              disabled={item.disabled}
              title={item.title}
              onClick={() => pick(item, close)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {item.icon && <span className="w-4 text-center text-muted">{item.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.labelNode ?? item.label}</span>
                {item.description && <span className="block text-xs text-subtle">{item.description}</span>}
              </span>
              <span className="w-3 text-xs text-accent">{item.value === selected ? "✓" : ""}</span>
              {numbered && <span className="w-3 text-right text-xs text-subtle">{i < 9 ? i + 1 : ""}</span>}
            </button>
          ))}
          {footer}
        </>
      )}
    </Popover>
  );
}
