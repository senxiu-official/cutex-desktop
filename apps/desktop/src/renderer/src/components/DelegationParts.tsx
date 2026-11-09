// Small pieces shared by the delegation card, the received delegation rows, the overview and the
// capsule: the status mark (glyph + word — never colour alone) and the "#N" tag that jumps to a card.
import type { DelegationStatus, DelegationWait, StatusGlyph, StatusTone } from "../lib/delegations";
import { formatAbsolute, formatAt } from "../lib/time";
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
      {/* Stopped (owner 2026-10-23: the dashed ring read as a spinner): a circle with a stop square, static. */}
      {glyph === "ring" && (
        <>
          <circle cx="8" cy="8" r="5.5" />
          <rect x="6" y="6" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

/**
 * Glyph + word (+ trailing, e.g. "· 12s"). `error` (the attempt's lastError) underlines the word
 * with dots and shows on hover.
 */
/** What a `waitingForEvent` status waits for: "等 1 个作业 · 最晚 06:11" (null with neither fact). */
export function useWaitText(): (wait: DelegationWait | undefined) => string | null {
  const { t } = useI18n();
  return (wait) => {
    if (!wait) return null;
    const at = wait.timeoutAt ? Date.parse(wait.timeoutAt) : NaN;
    const parts = [
      wait.jobs === null ? null : wait.jobs === 1 ? t("delegation.wait.job") : t("delegation.wait.jobs", { n: wait.jobs }),
      Number.isFinite(at) ? t("delegation.wait.until", { time: formatAt(at / 1000, Date.now()) }) : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  };
}

export function DelegationStatusMark({ status, name, trailing, error, className = "" }: { status: DelegationStatus; name: string; trailing?: string | null; error?: string | null; className?: string }) {
  const { t } = useI18n();
  const word = useStatusWord()(status, name);
  // A delegation_await: what it waits for in place of any time (its attempt's run time is the finished turn's).
  const waitText = useWaitText()(status.wait);
  if (status.wait) trailing = waitText;
  const deadline = status.wait?.timeoutAt ? Date.parse(status.wait.timeoutAt) : NaN;
  const hint = status.wait ? [t("delegation.wait.hint"), status.wait.note, Number.isFinite(deadline) ? formatAbsolute(deadline / 1000) : null].filter(Boolean).join("\n") : undefined;
  const wordTone = status.dangerText ? "text-danger" : status.tone === "danger" ? "text-danger" : status.tone === "warn" ? "text-warn" : "text-muted";
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      <DelegationGlyph glyph={status.glyph} tone={status.tone} />
      {/* A wait's text is longer than a time: it gives way first, the status word stays whole. */}
      <span className={`${status.wait ? "shrink-0" : "truncate"} ${wordTone} ${error ? "cursor-help underline decoration-dotted underline-offset-2" : ""}`} title={error ?? hint}>
        {word}
      </span>
      {trailing && <span className={`${status.wait ? "min-w-0 truncate" : "shrink-0"} text-subtle tabular-nums`} title={status.wait ? hint : undefined}>· {trailing}</span>}
    </span>
  );
}

/** The short tag of a delegation (lib/tasks taskTag); with `onJump` a link (to the card). Design 040 §2: accent text, not a chip. */
export function DelegationTag({ askId, onJump }: { askId: string; onJump?: () => void }) {
  const tag = taskTag(askId);
  const className = "shrink-0 font-medium text-accent tabular-nums";
  if (!onJump)
    return (
      <span className={className} title={tag.label} data-delegation-tag="">
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
      data-delegation-tag=""
      title={tag.label}
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
    <span className="shrink-0 text-caption/[inherit] text-subtle tabular-nums" title={t("delegation.peer.hopsTitle", { n: hops })} data-testid="delegation-hops">
      {t("delegation.peer.hops", { n: hops })}
    </span>
  );
}
