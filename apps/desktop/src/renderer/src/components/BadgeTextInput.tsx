import { useId, useState } from "react";
import { useI18n } from "../i18n";
import { displayWidth } from "../lib/badgeWidth";

/** A soft display-width limit: keep the complete draft, including an IME's phonetic spelling. */
export function BadgeTextInput({ value, onChange, maxWidth = 4, onCompositionChange, className, ...props }: {
  value: string; onChange(value: string): void; maxWidth?: number; onCompositionChange?(composing: boolean): void;
  className?: string; id?: string; "aria-label"?: string; placeholder?: string; disabled?: boolean; autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const [composing, setComposing] = useState(false);
  const hintId = useId();
  const width = composing ? null : displayWidth(value);
  const invalid = !composing && (width! > maxWidth || /[\s\p{Cc}]/u.test(value));
  return <div className="min-w-0 flex-1">
    <input {...props} value={value} className={className} aria-describedby={hintId} aria-invalid={invalid || undefined}
      onCompositionStart={() => { setComposing(true); onCompositionChange?.(true); }}
      onCompositionEnd={(event) => { onChange(event.currentTarget.value); setComposing(false); onCompositionChange?.(false); }}
      onChange={(event) => onChange(event.target.value)} />
    <p id={hintId} className={`mt-1 text-caption/[inherit] ${invalid ? "text-danger" : "text-subtle"}`} aria-live="polite">
      {composing ? "…" : t("info.badgeWidth", { n: width!, max: maxWidth })}
    </p>
    {invalid && <p role="alert" className="text-caption/[inherit] text-danger">{t("input.badgeInvalid")}</p>}
  </div>;
}
