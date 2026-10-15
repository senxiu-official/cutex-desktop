// Small pieces shared by the delegation card, the received delegation rows, the overview and the
// capsule: the status mark (glyph + word — never colour alone) and the "#N" tag that jumps to a card.
import type { DelegationStatus, StatusGlyph, StatusTone } from "../lib/delegations";
import { useStatusWord } from "../lib/delegationsView";
import { taskTag } from "../lib/tasks";
import { useI18n } from "../i18n";

const TONE: Record<StatusTone, string> = {
  warn: "text-warn",
  muted: "text-muted",
  accent: "text-accent",
  green: "text-ok",
  danger: "text-danger",
  neutral: "text-subtle",
};

export function DelegationGlyph({ glyph, tone, size = 12 }: { glyph: StatusGlyph; tone: StatusTone; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} className={`shrink-0 ${TONE[tone]} ${glyph === "pulse" ? "motion-safe:animate-pulse" : ""}`} aria-hidden>
      {glyph === "hollow" && <circle cx="8" cy="8" r="5" />}
      {glyph === "dot" && <circle cx="8" cy="8" r="5" fill="currentColor" stroke="none" />}
      {glyph === "pulse" && <circle cx="8" cy="8" r="5" fill="currentColor" stroke="none" />}
      {glyph === "check" && <path d="m3.5 8.5 3 3 6-7" />}
      {glyph === "cross" && <path d="m4.5 4.5 7 7m0-7-7 7" />}
      {glyph === "ring" && <circle cx="8" cy="8" r="5" strokeDasharray="3 2.2" />}
    </svg>
  );
}

/**
 * Glyph + word (+ trailing, e.g. "· 12s"). `error` (the attempt's lastError) underlines the word
 * with dots and shows on hover.
 */
export function DelegationStatusMark({ status, name, trailing, error, className = "" }: { status: DelegationStatus; name: string; trailing?: string | null; error?: string | null; className?: string }) {
  const word = useStatusWord()(status, name);
  const wordTone = status.dangerText ? "text-danger" : status.tone === "danger" ? "text-danger" : status.tone === "warn" ? "text-warn" : "text-muted";
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      <DelegationGlyph glyph={status.glyph} tone={status.tone} />
      <span className={`truncate ${wordTone} ${error ? "cursor-help underline decoration-dotted underline-offset-2" : ""}`} title={error ?? undefined}>
        {word}
      </span>
      {trailing && <span className="shrink-0 text-subtle tabular-nums">· {trailing}</span>}
    </span>
  );
}

/** "#N" of a delegation; with `onJump` a link (to the card). */
export function DelegationTag({ askId, onJump }: { askId: string; onJump?: () => void }) {
  const tag = taskTag(askId);
  const className = "shrink-0 rounded px-1 font-mono text-[11px] font-semibold";
  const style = { color: tag.color, background: `${tag.color}1f` };
  if (!onJump)
    return (
      <span className={className} style={style} title={askId}>
        {tag.label}
      </span>
    );
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={(e) => (e.stopPropagation(), onJump())}
      onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onJump())}
      className={`${className} cursor-pointer hover:underline`}
      style={style}
      title={askId}
    >
      {tag.label}
    </span>
  );
}

/** One hop is every peer ask (the globe already says so); only show multi-hop routes. */
export function DelegationHops({ hops }: { hops: number | null | undefined }) {
  const { t } = useI18n();
  if (!hops || hops < 2) return null;
  return (
    <span className="shrink-0 text-[10px] text-subtle tabular-nums" title={t("delegation.peer.hopsTitle", { n: hops })} data-testid="delegation-hops">
      {t("delegation.peer.hops", { n: hops })}
    </span>
  );
}
