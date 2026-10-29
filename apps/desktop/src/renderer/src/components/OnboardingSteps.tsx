// The setup cards of the onboarding flow (components/OnboardingFlow, lib/onboardingFlow; owner 2026-10-24: one
// decision group per card, big enough to read at a glance): language, theme with its colours, scale, animation, wording. Each applies at
// once through the same setters as Settings (通用 / 外观). Strings in modules/onboarding/i18n.ts.
import { useEffect, useState } from "react";
import { englishCatalog, loadedCatalog, useI18n, type Locale, type MessageKey } from "../i18n";
import { setAppearance, useAppearance } from "../lib/appearance";
import { LANGUAGES, isTraditionalLocale, traditionalRegionOf, traditionalLocale, preferredTraditionalRegion } from "../lib/languages";
import { Segmented, Toggle } from "./settings/Form";
import { applyTermPreset, currentTermPreset, presetOverrides, termPresets, type TermPreset } from "../lib/termPresets";
import { applyDarkPalette, applyLightPalette, applyTheme, DARK_PALETTES, LIGHT_PALETTES, loadDarkPalette, loadLightPalette, loadTheme, PALETTE_SWATCH, type DarkPalette, type LightPalette, type ThemePref } from "../lib/theme";
import { applyTerms, resolveTerms, useTermOverrides, type TermLocale } from "../lib/terms";
import { PERF_MODES, setUiPref, useUiPrefs, type PerfMode } from "../lib/prefs";
import { OnboardingClaudeRuntime } from "./OnboardingClaudeRuntime";
import { useOwnerWindow } from "../lib/ownerContext";

const TILE = "rounded-xl border-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none";
const tile = (on: boolean) => `${TILE} ${on ? "border-accent bg-accent/10" : "border-border bg-background hover:bg-hover"}`;

/** Learn about the chosen profile kind without installing anything until explicitly requested. */
export function ProfileStep() {
  const { t } = useI18n();
  const [kind, setKind] = useState<"apiKey" | "chatgpt" | "claude">("apiKey");
  return <div className="mt-3" data-onboarding-profile="">
    <div className="flex flex-wrap gap-2" role="group" aria-label={t("onboarding.profile.title")}>
      {(["apiKey", "chatgpt", "claude"] as const).map(value => <button type="button" key={value} data-onboarding-profile-kind={value} aria-pressed={kind === value} onClick={() => setKind(value)} className={`${tile(kind === value)} px-3 py-2 text-sm`}>
        {t(`onboarding.guide.profile.${value}.title`)}
      </button>)}
    </div>
    {kind === "claude" && <OnboardingClaudeRuntime />}
  </div>;
}

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
        <div className="mt-auto flex max-w-full flex-col items-start gap-2 pt-4" data-traditional-onboarding="">
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
      )}
    </>
  );
}

/** A tiny window in fixed colours (the theme tiles show what light / dark look like before choosing). */
function MiniWindow({ bg, side, line, accent }: { bg: string; side: string; line: string; accent: string }) {
  return (
    <span aria-hidden className="flex h-20 overflow-hidden rounded-lg border border-black/10" style={{ background: bg }}>
      <span className="flex w-1/3 flex-col gap-1.5 p-2" style={{ background: side }}>
        <span className="h-2 w-3/4 rounded" style={{ background: accent }} />
        <span className="h-2 w-full rounded" style={{ background: line }} />
        <span className="h-2 w-2/3 rounded" style={{ background: line }} />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-2">
        <span className="h-2 w-5/6 rounded" style={{ background: line }} />
        <span className="h-2 w-2/3 rounded" style={{ background: line }} />
        <span className="mt-auto h-4 w-full rounded" style={{ background: side }} />
      </span>
    </span>
  );
}

const LIGHT = { bg: "#ffffff", side: "#f1f1ef", line: "#dcdcd8", accent: "#2f6fde" };
const DARK = { bg: "#1f1f22", side: "#2a2a2e", line: "#3c3c42", accent: "#6aa0ff" };

/** Theme (light / dark / follow the system, as three pictures) and, under it, the colours (owner 2026-10-24: one card). */
export function ThemeStep() {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemePref>(loadTheme);
  const pick = (v: ThemePref) => {
    setTheme(v);
    applyTheme(v);
  };
  return (
    <>
    <div className="mt-4 grid grid-cols-3 gap-3" role="radiogroup" aria-label={t("shell.theme")}>
      {(["light", "dark", "system"] as ThemePref[]).map((v) => (
        <button key={v} role="radio" aria-checked={theme === v} data-onboarding-theme={v} onClick={() => pick(v)} className={`${tile(theme === v)} p-2.5`}>
          {v === "system" ? (
            <span className="grid grid-cols-2 overflow-hidden rounded-lg">
              <MiniWindow {...LIGHT} />
              <MiniWindow {...DARK} />
            </span>
          ) : (
            <MiniWindow {...(v === "light" ? LIGHT : DARK)} />
          )}
          <span className="mt-1.5 block text-center text-title font-medium">{t(`shell.theme.${v}` as MessageKey)}</span>
        </button>
      ))}
    </div>
    <PaletteRows />
    </>
  );
}

function Swatches<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: readonly T[]; onPick(v: T): void }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold text-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {options.map((v) => {
          const [a, b] = PALETTE_SWATCH[v as LightPalette | DarkPalette];
          return (
            <button key={v} role="radio" aria-checked={value === v} data-onboarding-palette={v} onClick={() => onPick(v)} className={`${tile(value === v)} flex items-center gap-2 px-2.5 py-1.5 text-sm`}>
              <span aria-hidden className="size-5 shrink-0 rounded-full ring-1 ring-border" style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }} />
              {t(`appearance.palette.${v}` as MessageKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Colours: the light and the dark palette (both kept; the theme decides which one shows). */
function PaletteRows() {
  const { t } = useI18n();
  const [light, setLight] = useState<LightPalette>(loadLightPalette);
  const [dark, setDark] = useState<DarkPalette>(loadDarkPalette);
  return (
    <div className="mt-4 space-y-3" data-onboarding-palettes="">
      <Swatches
        label={t("appearance.lightPalette")}
        value={light}
        options={LIGHT_PALETTES}
        onPick={(v) => {
          setLight(v);
          applyLightPalette(v);
        }}
      />
      <Swatches
        label={t("appearance.darkPalette")}
        value={dark}
        options={DARK_PALETTES}
        onPick={(v) => {
          setDark(v);
          applyDarkPalette(v);
        }}
      />
    </div>
  );
}

export const ZOOMS = [90, 100, 110, 125] as const;

/** Scale: the interface zoom, each tile showing its own text size. */
export function ZoomStep() {
  const { t } = useI18n();
  const zoom = useAppearance().zoom;
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" role="radiogroup" aria-label={t("appearance.zoom")}>
      {ZOOMS.map((z) => (
        <button key={z} role="radio" aria-checked={zoom === z} data-onboarding-zoom={z} onClick={() => setAppearance({ zoom: z })} className={`${tile(zoom === z)} flex h-32 flex-col items-center justify-center gap-2`}>
          <span aria-hidden className="leading-none font-semibold text-foreground" style={{ fontSize: `${(z / 100) * 28}px` }}>
            Aa
          </span>
          <span className="text-sm text-muted">{z}%</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The preview line of the wording step: the raw catalog template (onboarding.terms.example; not t(), which would
 * apply the current wording before a preset can), the locale's, else English, else Chinese.
 */
function exampleTemplate(locale: Locale): string {
  const key = "onboarding.terms.example";
  return loadedCatalog(locale)?.[key] ?? englishCatalog()?.[key] ?? loadedCatalog("zh-CN")?.[key] ?? "";
}

/** Whether the Maid chip shows, kept by the flow so it stays revealed across its steps. */
export interface EggState {
  revealed: boolean;
  reveal(): void;
}

/**
 * The wording preset. The hidden Maid chip (owner 2026-10-19): the plain choices are 智能体 / 代理 / agent; a small 🎀
 * at the end of the preview line, with no label or hint, reveals the Maid wording when clicked.
 */
export function TermsStep({ egg }: { egg: EggState }) {
  const { t, locale } = useI18n();
  const termLocale = locale as TermLocale;
  const overrides = useTermOverrides();
  const all = termPresets(termLocale);
  const current = currentTermPreset(termLocale, overrides);
  // Shown without the gesture (and without animating in) when the wording already is the Maid set; it then
  // counts as revealed, so picking another preset does not take the way back away.
  const eggIsCurrent = all.some((p) => p.easterEgg && p.id === current);
  const [eggWasCurrent] = useState(eggIsCurrent);
  const { revealed, reveal } = egg;
  useEffect(() => {
    if (eggIsCurrent && !revealed) reveal();
  }, [eggIsCurrent, revealed, reveal]);
  const showEgg = revealed || eggIsCurrent;
  const presets = all.filter((p) => !p.easterEgg || showEgg);
  const template = exampleTemplate(locale);
  const preview = (p: TermPreset) => applyTerms(template, resolveTerms(presetOverrides(termLocale, p), termLocale), termLocale);
  const shown = all.find((p) => p.id === current);
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={t("onboarding.terms.title")}>
        {presets.map((p) => {
          const className = `rounded-full border-2 px-4 py-1.5 ${p.easterEgg ? "text-sm" : "text-title font-normal"} ${current === p.id ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted hover:bg-hover"}`;
          const label = `${p.easterEgg ? "🎀 " : ""}${t(`onboarding.preset.${p.id}` as MessageKey)}`;
          const select = () => applyTermPreset(termLocale, p.id);
          return p.easterEgg && !eggWasCurrent ? (
            <EggChip key={p.id} checked={current === p.id} className={className} label={label} onClick={select} />
          ) : (
            <button key={p.id} role="radio" aria-checked={current === p.id} onClick={select} className={className}>
              {label}
            </button>
          );
        })}
      </div>
      {current === null && <p className="text-xs text-subtle">{t("onboarding.preset.custom")}</p>}
      <div data-onboarding-preview="" className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted select-none">
        <span className="min-w-0 flex-1">
          <span className="mr-2 text-subtle">{t("onboarding.terms.preview")}</span>
          {shown ? preview(shown) : applyTerms(template, resolveTerms(overrides, termLocale), termLocale)}
        </span>
        {all.some((p) => p.easterEgg) && !showEgg && (
          <button data-onboarding-ribbon="" aria-label={t("onboarding.preset.more")} onClick={reveal} className="shrink-0 opacity-30 grayscale transition hover:opacity-100 hover:grayscale-0">
            🎀
          </button>
        )}
      </div>
    </div>
  );
}

/** The Maid chip once revealed: fades and grows in (a CSS transition from its first frame). */
function EggChip({ checked, className, label, onClick }: { checked: boolean; className: string; label: string; onClick(): void }) {
  const win = useOwnerWindow();
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = win.requestAnimationFrame(() => setEntered(true));
    return () => win.cancelAnimationFrame(frame);
  }, []);
  return (
    <button
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      data-onboarding-egg=""
      className={`${className} transition duration-500 ease-out motion-reduce:transition-none ${entered ? "scale-100 opacity-100" : "scale-50 opacity-0"}`}
    >
      {label}
    </button>
  );
}

/**
 * 动画与性能 (Settings → 通用 → 性能, lib/perfMode): 节省资源 / 流畅优先 under their real names, each saying what it does,
 * and a small slanted joke for each at the very bottom of the card, under the options and their descriptions, each
 * under its own option (owner 2026-10-24: 「我很节约」 / 「我是少爷」; not inside the options).
 */
export function PerfStep() {
  const { t } = useI18n();
  const mode = useUiPrefs().perfMode;
  const views: Record<PerfMode, { label: MessageKey; quip: MessageKey; hint: MessageKey }> = {
    save: { label: "shell.perf.save", quip: "onboarding.perf.quip.save", hint: "shell.perf.saveHint" },
    smooth: { label: "shell.perf.smooth", quip: "onboarding.perf.quip.smooth", hint: "shell.perf.smoothHint" },
  };
  return (
    <>
      <div className="mt-5 grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("shell.perf.mode")}>
        {PERF_MODES.map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} data-onboarding-perf={m} onClick={() => setUiPref("perfMode", m)} className={`${tile(mode === m)} px-4 py-3`}>
            <span className="block text-title text-foreground">{t(views[m].label)}</span>
            <span className="mt-1.5 block text-sm leading-relaxed text-muted">{t(views[m].hint)}</span>
          </button>
        ))}
      </div>
      <div className="mt-auto grid grid-cols-2 gap-3 pt-6" data-onboarding-quips="">
        {PERF_MODES.map((m) => (
          <span key={m} data-onboarding-quip={m} className="justify-self-center -skew-x-12 text-meta text-subtle italic">{t(views[m].quip)}</span>
        ))}
      </div>
    </>
  );
}
