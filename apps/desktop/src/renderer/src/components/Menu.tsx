import { isImeComposing } from "../lib/ime";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTrackOverlay } from "../lib/openOverlays";
import { useOwnerWindow } from "../lib/ownerContext";
import { resizeObserverFor } from "../lib/ownerWindow";
import { MenuLayersContext, menuLayerContains, useMenuLayer, useMenuLayers } from "../lib/menuLayers";

/** Upward-opening popover anchored to a small trigger button (composer settings row). Stacks above
 * the slash / @ palettes (z-50): it was opened on purpose. Popovers are over the foretell / drop previews (styles.css 「Layers」). */
export function Popover({
  trigger,
  children,
  align = "left",
  onOpen,
  onKey,
  triggerTitle,
  width = "min-w-56",
  height,
  fitViewport = true,
  openSignal = 0,
  disabled,
  triggerClassName,
  triggerLabel,
  focusContent = false,
  keepMounted = false,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  onOpen?(): void;
  /** Extra key handling while open (e.g. number shortcuts); return true if handled. */
  onKey?(e: KeyboardEvent, close: () => void): boolean;
  triggerTitle?: string;
  width?: string;
  /** Stable extent for asynchronously loaded panels; other menus size to their content. */
  height?: string;
  fitViewport?: boolean;
  /** Opens the popover whenever this changes to a non-zero value (slash commands). */
  openSignal?: number;
  disabled?: boolean;
  triggerClassName?: string;
  triggerLabel?: string;
  /** Focus a row action panel, retaining keyboard access to its confirmation form. */
  focusContent?: boolean;
  /** Retain an action's confirmation/pending state when its panel is dismissed. */
  keepMounted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const layers = useMenuLayers();
  useMenuLayer(panel, layers, open);
  const close = () => setOpen(false);
  useTrackOverlay(open);
  const win = useOwnerWindow();
  const doc = win?.document;
  useLayoutEffect(() => {
    if (!open || !fitViewport) return;
    const fit = () => {
      if (!ref.current || !panel.current) return;
      const anchor = ref.current.getBoundingClientRect(), box = panel.current.getBoundingClientRect();
      const start = align === "right" ? anchor.right - box.width : anchor.left;
      const left = Math.max(16, Math.min(start, win.innerWidth - box.width - 16));
      const top = Math.max(16, Math.min(anchor.top - box.height - 6, win.innerHeight - box.height - 16));
      setPosition((old) => old.left === left && old.top === top ? old : { left, top });
    };
    // Scroll events are also emitted by timeline follow-output and browser
    // anchoring. Only an ancestor can move this trigger; unrelated streams
    // must neither dismiss the panel nor cause repeated layout measurements.
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target === doc || target === event.currentTarget || (target && "nodeType" in target && (target as Node).contains(ref.current))) fit();
    };
    fit(); win.addEventListener("resize", fit);
    win.addEventListener("scroll", onScroll, true);
    const observer = resizeObserverFor(ref.current, fit);
    if (ref.current) observer?.observe(ref.current);
    if (panel.current) observer?.observe(panel.current);
    return () => { win.removeEventListener("resize", fit); win.removeEventListener("scroll", onScroll, true); observer?.disconnect(); };
  }, [open, fitViewport, width, align, win, doc]);
  useEffect(() => {
    if (!openSignal) return;
    onOpen?.();
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (doc.querySelector("dialog[open]")) return;
      if (!ref.current?.contains(e.target as Node) && !menuLayerContains(layers, e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (doc.querySelector("dialog[open]")) return;
      if (isImeComposing(e)) return;
      if (e.key === "Escape") setOpen(false);
      else if (onKey?.(e, close)) e.preventDefault();
    };
    // Dismiss on the user's outside scroll gesture, never on a programmatic
    // scroll (the same distinction as contextMenu.watchMenuDismiss).
    const onUserScroll = (event: Event) => {
      if (doc.querySelector("dialog[open]")) return;
      if (!menuLayerContains(layers, event.target)) setOpen(false);
    };
    const scrollOptions = { capture: true, passive: true } as const;
    doc.addEventListener("mousedown", onDown);
    doc.addEventListener("keydown", onKeyDown);
    doc.addEventListener("wheel", onUserScroll, scrollOptions);
    doc.addEventListener("touchmove", onUserScroll, scrollOptions);
    return () => {
      doc.removeEventListener("mousedown", onDown);
      doc.removeEventListener("keydown", onKeyDown);
      doc.removeEventListener("wheel", onUserScroll, scrollOptions);
      doc.removeEventListener("touchmove", onUserScroll, scrollOptions);
    };
  }, [open, onKey, doc, layers]);
  useEffect(() => {
    if (!open || !focusContent) return;
    const triggerButton = ref.current?.querySelector("button");
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') ?? []);
    focusable()[0]?.focus();
    const onPanelKey = (event: KeyboardEvent) => {
      if (isImeComposing(event) || event.key !== "Tab") return;
      const items = focusable();
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const element = panel.current;
    element?.addEventListener("keydown", onPanelKey);
    return () => {
      element?.removeEventListener("keydown", onPanelKey);
      if (doc.activeElement === doc.body || element?.contains(doc.activeElement)) triggerButton?.focus();
    };
  }, [open, focusContent, doc]);
  const content = open || keepMounted ? <div
    ref={panel}
    hidden={!open}
    style={{ ...(height ? { height, maxHeight: "calc(100dvh - 9rem)" } : { maxHeight: "min(24rem, calc(100dvh - 32px))" }), ...(fitViewport ? { position: "fixed", ...position, right: "auto", bottom: "auto", maxWidth: "calc(100vw - 32px)", minWidth: "min(14rem, calc(100vw - 32px))" } : {}) }}
    data-popover={open ? "" : undefined}
    className={`absolute bottom-full z-[51] mb-1.5 max-h-96 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl ${width} ${align === "right" ? "right-0" : "left-0"}`}
  ><MenuLayersContext.Provider value={layers}>{children(close)}</MenuLayersContext.Provider></div> : null;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={triggerLabel}
        aria-expanded={open}
        title={triggerTitle}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className={triggerClassName ?? `flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground ${open ? "bg-surface-2 text-foreground" : ""}`}
      >
        {trigger}
      </button>
      {fitViewport && content && doc ? createPortal(content, doc.body) : content}
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
