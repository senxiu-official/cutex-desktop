// Rows over lib/appearance values shared by Settings → 外观 / 状态胶囊 / 侧栏与标题栏: a slider +
// number row with reset, and the font picker row (the live sample is the page's one shared preview).
import { useMemo, useState } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { DEFAULT_APPEARANCE, fontAvailable, RANGES, setAppearance, useAppearance, type Appearance } from "../../lib/appearance";
import { FIELD_W } from "../../lib/fieldWidths";
import { NumberField, ResetButton, Select, SettingRow } from "./Form";

type NumericKey = keyof typeof RANGES;

/** A slider + number setting from `appearance`, with reset to its default. */
export function AppearanceNumberRow({ field, label, hint, unit, step = 1 }: { field: NumericKey; label: MessageKey; hint?: MessageKey; unit: string; step?: number }) {
  const { t } = useI18n();
  const a = useAppearance();
  const value = a[field] as number;
  const def = DEFAULT_APPEARANCE[field] as number;
  const set = (v: number) => setAppearance({ [field]: v } as Partial<Appearance>);
  return (
    <SettingRow label={t(label)} hint={hint ? t(hint) : undefined} reset={<ResetButton disabled={value === def} onClick={() => set(def)} />}>
      <NumberField slider value={value} range={RANGES[field]} unit={unit} step={step} onCommit={(v) => v !== null && set(v)} />
    </SettingRow>
  );
}

const CUSTOM = "\u0000custom";

/**
 * Font picker. Left: label and one-line scope description (Settings → 外观 shows one shared
 * preview for all slots). Right: a fixed-width column — the select, and under it, at the same
 * width, the font-name field while 自定义… is picked. The column never wraps, so switching between
 * a listed font and a custom one only grows the row downwards.
 */
export function FontRow({ label, hint, value, fonts, defaultLabel, onChange }: { label: string; hint: string; value: string; fonts: string[]; defaultLabel?: string; onChange(v: string): void }) {
  const { t } = useI18n();
  const installed = useMemo(() => new Map(fonts.map((f) => [f, fontAvailable(f)])), [fonts]);
  const known = value === "" || fonts.includes(value);
  const [custom, setCustom] = useState(!known);
  const options = [
    { value: "", label: defaultLabel ?? t("appearance.builtIn") },
    ...fonts.map((f) => ({ value: f, label: installed.get(f) ? f : `${f}（${t("appearance.notInstalled")}）` })),
    { value: CUSTOM, label: t("appearance.customFont") },
  ];
  return (
    <SettingRow
      label={label}
      hint={hint}
    >
      <div className={`flex ${FIELD_W.generic} shrink-0 flex-col gap-1`}>
        <Select
          width="w-full"
          value={custom ? CUSTOM : value}
          options={options}
          onChange={(v) => {
            if (v === CUSTOM) {
              setCustom(true);
              return;
            }
            setCustom(false);
            onChange(v);
          }}
        />
        {custom && (
          <input
            type="text"
            value={value}
            title={value || undefined}
            placeholder={t("appearance.customFontHint")}
            aria-label={`${label} · ${t("appearance.customFont")}`}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent"
          />
        )}
      </div>
    </SettingRow>
  );
}
