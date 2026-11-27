// The UI language in the first-run question (components/GuidesAsk; onboarding v3, owner 2026-11-26: the first run keeps
// the language choice): every language named in itself (lib/languages, as in Settings → 通用); a click switches at once.
// Moved from the old flow's first card. Strings in modules/onboarding/i18n.ts.
import { useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { LANGUAGES, isTraditionalLocale, traditionalRegionOf, traditionalLocale, preferredTraditionalRegion } from "../lib/languages";
import { Segmented, SettingsGroup, Toggle } from "./settings/Form";

const TILE = "rounded-xl border-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";
const tile = (on: boolean) => `${TILE} ${on ? "border-accent bg-accent/10" : "border-border bg-background hover:bg-hover"}`;

/** Every UI language named in itself (lib/languages, as in Settings → 通用); a click switches at once. */
export function LanguageStep() {
  const { t, locale, setLocale } = useI18n();
  const region = traditionalRegionOf(locale);
  const traditional = isTraditionalLocale(locale);
  const [lastNonCN, setLastNonCN] = useState<"HK" | "MO" | "TW">(() => region && region !== "CN" ? region : preferredTraditionalRegion());
  const jiahao = region === "CN";
  const toggle = (on: boolean) => {
    if (region && region !== "CN") setLastNonCN(region);
    setLocale(on ? traditionalLocale("CN") : traditionalLocale(lastNonCN));
  };
  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("onboarding.language.title")}>
        {LANGUAGES.map((l) => {
          const selected = l.value === "zh-Hant-CN" ? traditional : locale === l.value;
          return <button key={l.value} role="radio" aria-checked={selected} lang={l.value} onClick={() => {
            // A manual family pick starts with CN; an already-selected family retains its region.
            if (l.value === "zh-Hant-CN") { if (!traditional) setLocale(traditionalLocale("CN")); }
            else setLocale(l.value);
          }} className={`${tile(selected)} truncate px-3 py-2 text-title font-normal`}>{l.label}</button>;
        })}
      </div>
      {traditional && (
        // This device's UI language, at once (as Settings → 通用); the group declares it without drawing its marker here.
        <SettingsGroup agents="none" source="local">{({ attributes }) => (
        <div {...attributes} className="mt-auto flex max-w-full flex-col items-start gap-2 pt-4" data-traditional-onboarding="">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Toggle checked={jiahao} onChange={toggle} label={t("onboarding.language.jiahao" as MessageKey)} />
            {t("onboarding.language.jiahao" as MessageKey)}
          </label>
          {jiahao ? <p className="text-xs text-subtle" data-jiahao-caption="">{t("onboarding.language.jiahaoCaption" as MessageKey)}</p> : (
            <Segmented
              label={t("shell.language.traditional.region" as MessageKey)}
              value={region ?? lastNonCN}
              options={(["HK", "MO", "TW"] as const).map((value) => ({ value, label: t(`shell.language.traditional.${value}` as MessageKey) }))}
              onChange={(value) => { setLastNonCN(value); setLocale(traditionalLocale(value)); }}
            />
          )}
        </div>
        )}</SettingsGroup>
      )}
    </>
  );
}
