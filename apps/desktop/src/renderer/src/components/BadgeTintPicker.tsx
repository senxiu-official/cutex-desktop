import { useRef, type KeyboardEvent } from "react";
import type { SessionBadge } from "@cutex-desktop/protocol";
import { useI18n } from "../i18n";
import { BADGE_TINTS, badgeColor } from "../lib/sessionBadge";
import { projectColor } from "../lib/sidebar";

type Tint = NonNullable<SessionBadge["tint"]>;

export function BadgeTintPicker({ value, onChange, className = "" }: { value: Tint; onChange(tint: Tint): void; className?: string }) {
  const { t } = useI18n();
  const group = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent, step: number) => {
    e.preventDefault();
    const next = BADGE_TINTS[(BADGE_TINTS.indexOf(value) + step + BADGE_TINTS.length) % BADGE_TINTS.length]!;
    onChange(next);
    group.current?.querySelector<HTMLElement>(`[data-tint="${next}"]`)?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label={t("info.badgeTint")} className={`flex items-center gap-1.5 ${className}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") move(e, 1);
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(e, -1);
      }}>
      {BADGE_TINTS.map((tint) => {
        const name = t(`info.badgeTint.${tint}`);
        const on = tint === value;
        return (
          <button key={tint} type="button" role="radio" aria-checked={on} aria-label={name} data-tip={name} data-tint={tint} tabIndex={on ? 0 : -1}
            onClick={() => onChange(tint)}
            // The outline's offset gap shows whatever is behind, so the selection reads on any surface and theme.
            className={`size-5 shrink-0 rounded-full border border-foreground/20 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${on ? "outline-2 outline-foreground" : ""}`}
            style={{ background: projectColor(badgeColor(tint)) }} />
        );
      })}
    </div>
  );
}
