// 通用 → 称呼: the words the UI uses for agent / sub-agent / Director / owner (lib/terms), per language. One
// row per term for the language picked at the top (the current UI language by default; owner 2026-10-15:
// not two languages × five rows), and one sample sentence under them. A field commits on Enter / blur
// ("" = default) and the whole UI follows at once.
import { useState } from "react";
import { loadedCatalog, useI18n, type MessageKey } from "../../i18n";
import { en } from "../../i18n/en";
import { applyTerms, DEFAULT_TERMS, resetTerm, resolveTerms, setTerm, subagentDefault, TERM_IDS, TERM_LOCALES, TERM_MAX, useTermOverrides, type TermId, type TermLocale } from "../../lib/terms";
import { settingsAnchorId } from "../../lib/settingsNav";
import { ResetButton, Section, Select, SettingRow, TextField } from "./Form";

const LANGUAGE: Record<TermLocale, string> = { "zh-CN": "简体中文", "zh-Hant-CN": "繁體中文", en: "English", "en-AU": "English (AU)", "ru-RU": "Русский", "fr-FR": "Français", "es-ES": "Español", "pt-BR": "Português", "it-IT": "Italiano", "de-DE": "Deutsch", "ja-JP": "日本語", "ko-KR": "한국어" };
const SAMPLE_KEY: MessageKey = "terms.sample";
// Partial, lazily loaded catalogs (see i18n/index.tsx): the sample sentence falls back to en when the
// picked language's catalog is not loaded.

export function TermsSection() {
  const { t, locale } = useI18n();
  // The language being edited follows the UI language; a language picked here holds only until the UI
  // language changes again.
  const [pick, setPick] = useState<{ ui: TermLocale; loc: TermLocale } | null>(null);
  const loc = pick && pick.ui === locale ? pick.loc : locale;
  const setLoc = (next: TermLocale) => setPick({ ui: locale, loc: next });
  const overrides = useTermOverrides();
  const resolved = resolveTerms(overrides, loc);
  return (
    <Section id={settingsAnchorId("terms")} title={t("terms.title")} hint={t("terms.hint")}>
      <SettingRow label={t("terms.language")}>
        <Select width="w-40" label={t("terms.language")} value={loc} options={TERM_LOCALES.map((l) => ({ value: l, label: LANGUAGE[l] }))} onChange={(v) => setLoc(v as TermLocale)} />
      </SettingRow>
      {TERM_IDS.map((id) => <TermRow key={`${loc}.${id}`} locale={loc} id={id} />)}
      <p data-testid={`terms-sample-${loc}`} className="pt-2 text-xs text-muted">{t("terms.preview", { text: applyTerms(loadedCatalog(loc)?.[SAMPLE_KEY] ?? en[SAMPLE_KEY], resolved, loc) })}</p>
    </Section>
  );
}

function TermRow({ locale, id }: { locale: TermLocale; id: TermId }) {
  const { t } = useI18n();
  const overrides = useTermOverrides();
  const saved = overrides[locale]?.[id] ?? {};
  const resolved = resolveTerms(overrides, locale);
  // The sub-agent default follows the current agent word (「子」 + agent).
  const defaults = id === "subagent" ? subagentDefault(resolved.agent, locale) : DEFAULT_TERMS[locale][id];
  const plural = !locale.startsWith("zh") && !locale.startsWith("ja") && !locale.startsWith("ko");
  return (
    <SettingRow
      label={DEFAULT_TERMS[locale][id].one}
      // The label is the built-in word; the hint only when the default says more (plural, a renamed agent word).
      hint={plural || defaults.one !== DEFAULT_TERMS[locale][id].one ? t("terms.default", { value: plural ? `${defaults.one} / ${defaults.many}` : defaults.one }) : undefined}
      reset={<ResetButton disabled={!saved.one && !saved.many} onClick={() => resetTerm(locale, id)} title={t("terms.reset")} />}
    >
      <TextField value={saved.one ?? ""} placeholder={defaults.one} maxLength={TERM_MAX} width="w-32" label={plural ? t("terms.singular") : undefined} onCommit={(v) => setTerm(locale, id, "one", v)} />
      {plural && <TextField value={saved.many ?? ""} placeholder={resolved[id].many} maxLength={TERM_MAX} width="w-32" label={t("terms.plural")} onCommit={(v) => setTerm(locale, id, "many", v)} />}
    </SettingRow>
  );
}
