// A 接下来 row's text as a focusable trigger (cross-review of 040eefe42): hover or keyboard focus shows the app tip
// (the text up to ROW_TIP_MAX and the exact time, only while the row text is cut off); a click / Enter opens the whole
// text in the anchored panel 查看原因 uses (components/AnchoredPanel), selectable, with 复制. Esc gives focus back.
import { useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { rowTip } from "../lib/queueRowTime";
import { AnchoredPanel } from "./AnchoredPanel";

export function RowFullText({ full, exact, className = "", children }: { full: string; exact?: string | null; className?: string; children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const text = full.replace(/^[\s⏎↵]+|[\s⏎↵]+$/gu, "");
  return <>
    <button type="button" ref={anchor} onClick={(event) => { event.stopPropagation(); setOpen((o) => !o); }} aria-expanded={open} aria-haspopup="dialog"
      className={`min-w-0 cursor-default rounded-sm text-left focus-visible:outline focus-visible:outline-accent ${className}`}
      data-tip={rowTip(text, exact)} data-tip-overflow="" data-testid="row-text">
      {children}
    </button>
    {open && <AnchoredPanel anchor={anchor} side="above" label={t("queue.row.fullText")} onClose={(refocus) => { setOpen(false); if (refocus) anchor.current?.focus(); }} className="w-96" data-row-full-text="">
      {/* React bubbles portal events to the row: a text drag / click in here must not start the row's drag or keys. */}
      <div className="space-y-2 p-3 text-caption" onClick={(e) => e.stopPropagation()} onDragStart={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <div className="selectable max-h-72 overflow-auto whitespace-pre-wrap break-words text-foreground" data-testid="row-full-text">{text}</div>
        <div className="flex items-center gap-2">
          {exact && <span className="flex-1 text-subtle tabular-nums">{exact}</span>}
          <button type="button" onClick={() => void navigator.clipboard?.writeText(text)} className="ml-auto rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground hover:text-accent" data-panel-row="" data-testid="row-full-copy">{t("menu.copy")}</button>
        </div>
      </div>
    </AnchoredPanel>}
  </>;
}

/** The age on a row, focusable so keyboard users get its exact-time tip too. */
export function RowAge({ age, exact, className = "" }: { age: string | null; exact: string | null; className?: string }) {
  if (!age) return null;
  return <span tabIndex={0} className={`shrink-0 rounded-sm pl-1 text-caption font-normal whitespace-nowrap text-subtle tabular-nums focus-visible:outline focus-visible:outline-accent ${className}`} data-tip={exact ?? undefined} data-testid="row-age">{age}</span>;
}
