// The queue panel's left rail (turn cards, owner 2026-10-12): a ~22px column at the start of each
// row that carries the row's label (a glyph or the turn number) instead of header rows. Section
// names and status are the rail's tooltip; section actions sit at the row end and show on hover /
// keyboard focus (HoverActions). Hovering a rail cell shows the section strip (lib/railStrip).
import { useContext } from "react";
import { RailStripContext, type StripLabel, type StripTone } from "../lib/railStrip";

const TONES: Record<StripTone, string> = {
  accent: "border-accent/40 text-accent",
  muted: "border-border text-muted",
  warn: "border-warn/50 text-warn",
  danger: "border-danger/50 text-danger",
};

/**
 * The section strip: a pill attached to the rail, sliding out to its left (inside the frame when
 * there is no room). Shown after a short hover delay, or at once while `forced` (a drop hint).
 * Never takes pointer events (drops go to the row under it).
 */
function Strip({ label, forced }: { label: StripLabel; forced: boolean }) {
  const { inside } = useContext(RailStripContext);
  const side = inside ? "left-full ml-0.5" : "right-full mr-1";
  const hidden = inside ? "-translate-x-1" : "translate-x-1";
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 rounded-full border bg-surface px-2 py-px text-[11px] leading-4 whitespace-nowrap shadow-sm transition-[opacity,translate] duration-[120ms] motion-reduce:transition-none ${side} ${TONES[label.tone]} ${
        forced ? "translate-x-0 opacity-100" : `${hidden} opacity-0 group-hover/rail:translate-x-0 group-hover/rail:opacity-100 group-hover/rail:delay-150`
      }`}
      data-testid={forced ? "rail-strip-forced" : "rail-strip"}
    >
      {label.text}
    </span>
  );
}

/**
 * The rail cell of a row; `label` = its tooltip (the section name / status). `strip` = the section
 * strip shown on hover (when the setting is on); `forced` = a drop hint shown now instead.
 */
export function Rail({ label, children, className = "", strip, forced }: { label?: string; children?: React.ReactNode; className?: string; strip?: StripLabel; forced?: StripLabel | null }) {
  const { enabled } = useContext(RailStripContext);
  const shown = enabled ? (forced ?? strip) : undefined;
  return (
    <span className={`group/rail relative flex w-[22px] shrink-0 items-center justify-center self-stretch text-[10px] text-subtle ${className}`} title={label}>
      {children}
      {shown && <Strip label={shown} forced={!!forced} />}
    </span>
  );
}

/** A 24px row: rail + content. `group` so hover actions and the grip appear together. */
export function RailRow({ rail, children, className = "", testId, ...rest }: { rail: React.ReactNode; children: React.ReactNode; className?: string; testId?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div {...rest} className={`group relative flex min-h-6 min-w-0 items-center ${className}`} data-testid={testId}>
      {rail}
      {children}
    </div>
  );
}

/**
 * Section actions at the row end: no room and invisible until the row is hovered or one of them has
 * focus (clipped, not display:none, so Tab still reaches them), so the row's meta stays at its end.
 */
export function HoverActions({ children }: { children: React.ReactNode }) {
  return <span className="flex max-w-0 shrink-0 items-center gap-0.5 overflow-hidden opacity-0 group-hover:max-w-none group-hover:overflow-visible group-hover:opacity-100 focus-within:max-w-none focus-within:overflow-visible focus-within:opacity-100">{children}</span>;
}
