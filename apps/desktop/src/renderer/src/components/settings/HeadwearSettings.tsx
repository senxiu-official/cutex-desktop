// 主管头饰 (lib/directorHeadwear, owner 2026-10-24): what a project Director wears on its avatar — on 设置 › 外观 › 头像
// since 2026-11-27 (lib/portraitSettingsNav). The card keeps its `headwear` anchor; its two switches (下属也戴, 节日头饰)
// are short, so they stay on 外观's 头像 card (components/settings/AvatarSettings.tsx, owner 2026-11-28).
import { useRef } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { settingsAnchorId } from "../../lib/settingsNav";
import { DIRECTOR_HEADWEARS, DEFAULT_DIRECTOR_HEADWEAR, headwearSources, type DirectorHeadwear } from "../../lib/directorHeadwear";
import { radioKeyTarget, useRowA11y } from "../../lib/formA11y";
import { ResetButton, Section, SettingRow } from "./Form";

export function HeadwearSection() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  return (
  <Section id={settingsAnchorId("headwear")} title={t("appearance.headwear")}  >
    {/* A picture picker wider than a segmented control sits under its label, the full width of the card. */}
    <SettingRow agents="none" source="local" label={t("appearance.headwear.style")} hint={t("appearance.headwearHint")} reset={<ResetButton disabled={ui.directorHeadwear === DEFAULT_DIRECTOR_HEADWEAR} onClick={() => setUiPref("directorHeadwear", DEFAULT_DIRECTOR_HEADWEAR)} />}
      sample={<HeadwearPicker label={t("appearance.headwear.style")} value={ui.directorHeadwear} onChange={(v) => setUiPref("directorHeadwear", v)} />} />
  </Section>
  );
}

/**
 * 主管头饰's styles as a grid of small pictures (eleven choices are too many for a segmented row): a radio group,
 * arrow keys move between choices like Segmented's.
 */
function HeadwearPicker({ value, onChange, label }: { value: DirectorHeadwear; onChange(v: DirectorHeadwear): void; label: string }) {
  const { t } = useI18n();
  const aria = useRowA11y(label);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, DIRECTOR_HEADWEARS.indexOf(value));
  return (
    <div role="radiogroup" {...aria} data-headwear-picker="" className="mt-2 flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
      {DIRECTOR_HEADWEARS.map((v, i) => {
        const on = v === value;
        const label = t(`appearance.headwear.${v}` as MessageKey);
        return (
          <button
            key={v}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            title={label}
            tabIndex={i === selected ? 0 : -1}
            data-headwear-choice={v}
            onClick={() => onChange(v)}
            onKeyDown={(e) => {
              const next = radioKeyTarget(e.key, i, DIRECTOR_HEADWEARS.length);
              if (next === null) return;
              e.preventDefault();
              refs.current[next]?.focus();
              onChange(DIRECTOR_HEADWEARS[next]!);
            }}
            className={`flex w-[84px] flex-col items-center gap-1 rounded-md px-1 pt-1.5 pb-1 text-xs focus-visible:outline-2 focus-visible:outline-accent ${on ? "bg-raised text-foreground shadow-sm ring-1 ring-border" : "text-muted hover:bg-hover hover:text-foreground"}`}
          >
            <span className="flex h-6 items-center justify-center">
              {v === "none" ? <span aria-hidden className="text-base text-subtle">∅</span> : <img src={headwearSources(v).src} alt="" aria-hidden draggable={false} data-headwear-option={v} className="max-h-6 w-auto max-w-[44px] object-contain" />}
            </span>
            <span className="w-full truncate text-center">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
