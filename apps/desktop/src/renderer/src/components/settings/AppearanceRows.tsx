// Rows over lib/appearance values shared by Settings → 外观 / 状态胶囊 / 侧栏与标题栏: a slider +
// number row with reset, and the font picker row (the live sample is the page's one shared preview).
import { useCallback, useMemo } from "react";
import { useI18n, type MessageKey } from "../../i18n";
import { DEFAULT_APPEARANCE, fontAvailable, RANGES, setAppearance, useAppearance, type Appearance } from "../../lib/appearance";
import { FontCombo, type FontChoice } from "./FontCombo";
import { catalogFont } from "../../../../shared/fontCatalog";
import { fontLabel, FONT_SAMPLE, previewFontFamily, sampleKind } from "../../lib/fontPreview";
import { packInstalled, useFontPack } from "../../lib/fontPack";
import { NumberField, ResetButton, SettingRow } from "./Form";

type NumericKey = keyof typeof RANGES;

/** A slider + number setting from `appearance`, with reset to its default. */
export function AppearanceNumberRow({ field, label, hint, unit, step = 1, commitOnRelease }: { field: NumericKey; label: MessageKey; hint?: MessageKey; unit: string; step?: number; commitOnRelease?: boolean }) {
  const { t } = useI18n();
  const a = useAppearance();
  const value = a[field] as number;
  const def = DEFAULT_APPEARANCE[field] as number;
  const set = (v: number) => setAppearance({ [field]: v } as Partial<Appearance>);
  return (
    <SettingRow agents="none" source="local" label={t(label)} hint={hint ? t(hint) : undefined} reset={<ResetButton disabled={value === def} onClick={() => set(def)} />}>
      <NumberField slider commitOnRelease={commitOnRelease} value={value} range={RANGES[field]} unit={unit} step={step} onCommit={(v) => v !== null && set(v)} />
    </SettingRow>
  );
}

/**
 * Font picker row. Left: label and one-line scope description (外观 → 字体 has a live preview after each
 * part). Right: FontCombo, one line: pick a listed font or type any installed font name.
 */
export function FontRow({ label, hint, value, fonts, cjkFonts = [], mono, defaultLabel, onChange }: { label: string; hint?: string; value: string; fonts: string[]; /** Which listed fonts show a Han sample. */ cjkFonts?: readonly string[]; mono?: boolean; defaultLabel?: string; onChange(v: string): void }) {
  const { t, locale } = useI18n();
  const pack = useFontPack();
  // Fonts that come with the desktop are never looked up among the installed ones.
  const installed = useMemo(() => new Map(fonts.filter((f) => !catalogFont(f)).map((f) => [f, fontAvailable(f)])), [fonts]);
  const describe = useCallback((f: string): FontChoice => {
    const entry = catalogFont(f);
    const choice: FontChoice = { label: fontLabel(f, locale), preview: { fontFamily: previewFontFamily(f), sample: FONT_SAMPLE[sampleKind(f, cjkFonts, mono)] } };
    // A 中文字体包 family that is not imported yet says so; a bundled one is always there.
    if (entry) choice.note = entry.delivery === "pack" && !packInstalled(pack, entry.id) ? t("appearance.fontPack.notImported") : undefined;
    return choice;
  }, [locale, pack, cjkFonts, mono, t]);
  return (
    <SettingRow agents="none" source="local" label={label} hint={hint}>
      <FontCombo label={label} value={value} fonts={fonts} defaultLabel={defaultLabel ?? t("appearance.builtIn")} installed={(f) => installed.get(f) ?? fontAvailable(f)} describe={describe} onChange={onChange} />
    </SettingRow>
  );
}
