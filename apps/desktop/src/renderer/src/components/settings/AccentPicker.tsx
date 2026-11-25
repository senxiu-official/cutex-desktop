// 外观 → 强调色 (owner 2026-11-25): eight preset dots plus 自定义 (the system colour picker), one radio group;
// lib/accent turns the pick into light / dark values that stay readable as text, applied at once.
import { useRef } from "react";
import { Pipette } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { ACCENT_PRESETS, accentSeed, accentValues, isAccentPreset, type AccentPref } from "../../lib/accent";
import { radioKeyTarget, useRowA11y } from "../../lib/formA11y";
import { settingsControlChanged } from "../../lib/settingsDrafts";

const RING = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

export function AccentPicker({ value, onChange, label }: { value: AccentPref; onChange(v: AccentPref): void; label?: string }) {
  const { t } = useI18n();
  const aria = useRowA11y(label);
  const colorInput = useRef<HTMLInputElement>(null);
  const custom = !isAccentPreset(value);
  const customSeed = custom ? accentSeed(value) : null;
  const count = ACCENT_PRESETS.length + 1;
  const selected = custom ? ACCENT_PRESETS.length : ACCENT_PRESETS.findIndex((p) => p.id === value);
  const pickAt = (i: number, el: HTMLElement) => {
    if (i < ACCENT_PRESETS.length) settingsControlChanged(el, onChange(ACCENT_PRESETS[i]!.id));
    else openCustom();
  };
  const openCustom = () => {
    const input = colorInput.current;
    if (!input) return;
    input.value = customSeed ?? accentValues(value).light;
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  };
  return (
    <div role="radiogroup" {...aria} data-accent-picker="" className="relative flex flex-wrap items-center justify-end gap-1.5">
      {ACCENT_PRESETS.map((p, i) => {
        const on = p.id === value;
        const name = t(`appearance.accent.${p.id}` as MessageKey);
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={name}
            title={name}
            tabIndex={i === selected ? 0 : -1}
            data-accent-choice={p.id}
            onClick={(e) => pickAt(i, e.currentTarget)}
            onKeyDown={(e) => {
              const next = radioKeyTarget(e.key, i, count);
              if (next === null) return;
              e.preventDefault();
              (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
              if (next < ACCENT_PRESETS.length) pickAt(next, e.currentTarget);
            }}
            className={`press-solid relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${RING}`}
          >
            <span aria-hidden className={`h-[18px] w-[18px] rounded-full ${on ? "ring-2 ring-foreground/70 ring-offset-2 ring-offset-surface" : "ring-1 ring-black/10"}`} style={{ background: p.seed }} />
          </button>
        );
      })}
      <button
        type="button"
        role="radio"
        aria-checked={custom}
        aria-label={customSeed ? `${t("appearance.accent.custom")} ${customSeed}` : t("appearance.accent.custom")}
        title={t("appearance.accent.customPick")}
        tabIndex={selected === ACCENT_PRESETS.length ? 0 : -1}
        data-accent-choice="custom"
        onClick={openCustom}
        onKeyDown={(e) => {
          const next = radioKeyTarget(e.key, ACCENT_PRESETS.length, count);
          if (next === null) return;
          e.preventDefault();
          (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
          if (next < ACCENT_PRESETS.length) pickAt(next, e.currentTarget);
        }}
        className={`press inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-1.5 text-xs ${custom ? "border-foreground/50 text-foreground" : "border-border text-muted hover:text-foreground"} ${RING}`}
      >
        <span
          aria-hidden
          className="flex h-3.5 w-3.5 items-center justify-center rounded-full ring-1 ring-black/10"
          style={{ background: customSeed ?? "conic-gradient(#f43f5e, #f97316, #eab308, #22c55e, #14b8a6, #3b82f6, #8b5cf6, #ec4899, #f43f5e)" }}
        />
        {customSeed ? <span className="font-mono text-caption/[inherit]">{customSeed}</span> : t("appearance.accent.custom")}
        <Pipette size={11} aria-hidden className="text-subtle" />
      </button>
      {/* The system picker; React's onChange is the `input` event, so the app follows while dragging. */}
      <input
        ref={colorInput}
        type="color"
        tabIndex={-1}
        aria-hidden
        data-accent-input=""
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        onChange={(e) => settingsControlChanged(e.currentTarget, onChange(e.currentTarget.value as AccentPref))}
      />
    </div>
  );
}

/** The two values a pick becomes, each on its theme's page: link text and a switch, as the app will show them. */
export function AccentSample({ value }: { value: AccentPref }) {
  const { t } = useI18n();
  const { light, dark, onLight, onDark } = accentValues(value);
  return (
    <div data-accent-sample="" className="mt-1.5 flex flex-wrap gap-1.5">
      {([["light", light, onLight, "#ffffff", "#1d1d1f"], ["dark", dark, onDark, "#161616", "#ececec"]] as const).map(([mode, accent, on, bg, fg]) => (
        <div key={mode} data-accent-sample-mode={mode} className="flex h-6 items-center gap-2 rounded-md px-2 text-caption/[inherit] ring-1 ring-border" style={{ background: bg, color: fg }}>
          <span className="opacity-70">{t(`appearance.accent.sample.${mode}` as MessageKey)}</span>
          <span style={{ color: accent }} className="font-medium">{t("appearance.accent.sample.link")}</span>
          <span aria-hidden className="relative inline-block h-3.5 w-6 rounded-full" style={{ background: accent }}>
            <span className="absolute top-0.5 right-0.5 h-2.5 w-2.5 rounded-full" style={{ background: on }} />
          </span>
          <span className="font-mono opacity-60">{accent}</span>
        </div>
      ))}
    </div>
  );
}
