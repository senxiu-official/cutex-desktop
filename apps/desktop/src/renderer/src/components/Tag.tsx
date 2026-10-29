// The one tag / count badge of the visual language (docs/design/040 §2): a Tag is 18 px high, `rounded-chip`,
// `text-caption`, a soft face with text of the same colour and no border; a CountBadge is the 16 px pill with a
// number (attention = solid `--attention`). An id like #11 is not a chip: it is accent text (a link).
import type { HTMLAttributes, ReactNode } from "react";

export type TagTone = "neutral" | "accent" | "attention" | "ok" | "danger";

const TAG: Record<TagTone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  attention: "bg-attention-soft text-warn-text",
  ok: "bg-ok-soft text-ok-text",
  danger: "bg-danger-soft text-danger",
};

type SpanProps = Omit<HTMLAttributes<HTMLSpanElement>, "children">;

export function Tag({ tone = "neutral", className = "", children, ...rest }: SpanProps & { tone?: TagTone; children?: ReactNode }) {
  return (
    <span {...rest} data-tag={tone} className={`inline-flex h-[18px] shrink-0 items-center gap-1 rounded-chip px-1.5 text-caption leading-none font-medium whitespace-nowrap ${TAG[tone]} ${className}`}>
      {children}
    </span>
  );
}

const COUNT: Record<"attention" | "accent" | "danger" | "neutral", string> = {
  attention: "bg-attention text-on-attention",
  accent: "bg-accent text-on-accent",
  danger: "bg-danger-solid text-white",
  neutral: "bg-surface-2 text-muted",
};

/** A number (or `?` / `!`) in a 16 px pill; `max` shows `9+`. */
export function CountBadge({ count, max = 99, tone = "attention", className = "", ...rest }: SpanProps & { count: number | string; max?: number; tone?: keyof typeof COUNT }) {
  const text = typeof count === "number" && count > max ? `${max}+` : String(count);
  return (
    <span {...rest} data-count-badge={tone} className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 font-fixed text-caption leading-none font-semibold tabular-nums ${COUNT[tone]} ${className}`}>
      {text}
    </span>
  );
}
