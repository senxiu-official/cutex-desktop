// One masked identity digest (lib/maskedText): `abcd••••••` by default, an eye button reveals this row
// (local state, so it resets when the page closes), the copy button always copies the full value.
// Used for person-key fingerprints (你 / 用户), the NCI key fingerprint and peer instance ids (互联).
import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useI18n } from "../i18n";
import { copyQuietly } from "../lib/copyFeedback";
import { maskDigest } from "../lib/maskedText";

export function MaskedText({
  value,
  shown,
  keep,
  copy = false,
  copyLabel,
  title,
  className = "font-mono text-xs",
  testId,
}: {
  /** The full value (copied; masked from its first characters). */
  value: string;
  /** How the revealed value reads (default: `value`), e.g. grouped by 4. */
  shown?: string;
  /** Visible characters before the mask (default 4). */
  keep?: number;
  /** Show a copy button (copies `value` in full, also while masked). */
  copy?: boolean;
  copyLabel?: string;
  /** Hover text, only while revealed (e.g. the public key). */
  title?: string;
  className?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const button = "flex h-5 w-5 shrink-0 items-center justify-center rounded text-subtle hover:bg-surface-2 hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
  return (
    <span className="inline-flex min-w-0 items-center gap-0.5" data-testid={testId} data-masked={revealed ? "false" : "true"}>
      <span className={`whitespace-nowrap ${className}`} title={revealed ? title : undefined}>
        {revealed ? (shown ?? value) : maskDigest(value, keep)}
      </span>
      <button
        type="button"
        className={button}
        aria-label={t(revealed ? "mask.hide" : "mask.reveal")}
        title={t(revealed ? "mask.hide" : "mask.reveal")}
        aria-pressed={revealed}
        onClick={(e) => {
          e.stopPropagation();
          setRevealed((v) => !v);
        }}
      >
        {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
      {copy && (
        <button
          type="button"
          className={button}
          aria-label={copied ? t("mask.copied") : (copyLabel ?? t("mask.copy"))}
          title={copied ? t("mask.copied") : (copyLabel ?? t("mask.copy"))}
          onClick={(e) => {
            e.stopPropagation();
            void copyQuietly(value).then(() => setCopied(true), () => {});
          }}
        >
          {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
        </button>
      )}
    </span>
  );
}
