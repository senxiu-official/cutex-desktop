// First-contact choices apply directly. Portrait themes have an explicit Select all action.
import { useState } from "react";
import { useI18n } from "../i18n";
import { availableChoices, type FirstChoice } from "../lib/firstChoices";
import { setEnabledPortraitThemes, usePortraitThemes, type PortraitThemeInfo } from "../lib/portraitThemes";
import { ONBOARDING_FACES } from "../lib/onboardingFaces";
import { decidePortraitThemes, portraitThemesFor, type PortraitAnswer } from "../lib/tour";

const OPT = "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors";
const OPT_ON = "border-accent bg-accent/10 text-foreground";
const OPT_OFF = "border-border bg-surface text-foreground hover:bg-hover";
const DECIDE = "ml-auto shrink-0 rounded-md border border-accent/50 px-2 py-0.5 text-xs text-accent hover:bg-accent/10";

/** One decision, initialized from its current setting. */
export function ChoiceCard({ choice }: { choice: FirstChoice }) {
  const { t } = useI18n();
  const [value, setValue] = useState(() => choice.get());
  return (
    <div data-first-choice={choice.id} className="mb-2 rounded-xl border border-border bg-background p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {t(choice.titleKey)}
      </div>
      <div role="radiogroup" aria-label={t(choice.titleKey)} className="mt-2 flex flex-wrap gap-1.5">
        {choice.options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-choice-option={o.value}
              className={`${OPT} ${on ? OPT_ON : OPT_OFF}`}
              onClick={() => {
                choice.set(o.value);
                setValue(o.value);
              }}
            >
              {t(o.labelKey)}
              <span className="block text-caption/[inherit] text-subtle">{t(o.hintKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Available choices, in registry order. */
export function ChoiceList({ ids }: { ids?: readonly FirstChoice["id"][] }) {
  return (
    <>
      {availableChoices(ids).map((c) => (
        <ChoiceCard key={c.id} choice={c} />
      ))}
    </>
  );
}

/** A theme's fixed onboarding face (lib/onboardingFaces: shipped, preloaded); a theme without one shows its initial. */
export function ThemeFace({ theme, size = 32 }: { theme: Pick<PortraitThemeInfo, "key" | "name">; size?: number }) {
  const url = ONBOARDING_FACES.get(theme.key);
  return url ? (
    <img src={url} alt="" width={size} height={size} draggable={false} className="shrink-0 rounded-full bg-surface-2 object-cover" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-muted" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {[...theme.name][0]}
    </span>
  );
}

function ThemeCard({ theme, on, onToggle }: { theme: PortraitThemeInfo; on: boolean; onToggle(): void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} data-portrait-theme={theme.key} title={theme.subtitle ? `${theme.name} · ${theme.subtitle}` : theme.name} onClick={onToggle} className={`flex min-w-0 items-center gap-2 rounded-lg border p-1.5 text-left ${on ? "border-accent ring-1 ring-accent" : "border-border hover:bg-hover"} bg-background`}>
      <ThemeFace theme={theme} size={36} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-xs leading-tight font-semibold">{theme.name}</span>
        {theme.subtitle && <span className="block truncate text-caption text-subtle">{theme.subtitle}</span>}
      </span>
      <span aria-hidden className={`flex size-3.5 shrink-0 items-center justify-center self-start rounded border text-caption leading-none ${on ? "border-accent bg-accent text-white" : "border-border"}`}>{on ? "✓" : ""}</span>
    </button>
  );
}

const PORTRAIT_OPTIONS = [
  [true, "onboarding.tour.portraits.use", "onboarding.tour.portraits.useHint"],
  [false, "onboarding.tour.portraits.no", "onboarding.tour.portraits.noHint"],
] as const;

/**
 * 「要不要用拟人头像？」 (owner 2026-10-24): 用 is preselected with every theme, so 下一步 alone goes on; the other choice is
 * 极简风格 (emoji or letters, no character faces). A click applies at once (UiPrefs.portraitPacks); the flow applies the
 * preselected answer when the user moves past the card. After 用 the next card picks the themes (PortraitThemes).
 */
export function PortraitChoice({ answer, onAnswer, all }: { answer: PortraitAnswer; onAnswer(a: PortraitAnswer): void; all: readonly string[] }) {
  const { t } = useI18n();
  const { themes } = usePortraitThemes();
  const set = (a: PortraitAnswer) => {
    setEnabledPortraitThemes(portraitThemesFor(a));
    onAnswer(a);
  };
  return (
    <div data-portrait-choice="" className="mt-4">
      <div role="radiogroup" aria-label={t("onboarding.tour.portraits.title")} className="grid max-w-xl grid-cols-2 gap-3">
        {PORTRAIT_OPTIONS.map(([use, label, hint]) => (
          <button
            key={String(use)}
            type="button"
            role="radio"
            aria-checked={answer.use === use}
            data-portrait-use={use ? "yes" : "no"}
            className={`rounded-xl border-2 px-4 py-3 text-left transition-colors ${answer.use === use ? "border-accent bg-accent/10" : "border-border bg-background hover:bg-hover"}`}
            onClick={() => set({ use, themes: use ? (answer.themes.length ? answer.themes : [...all]) : answer.themes })}
          >
            <span className="block text-title text-foreground">{t(label)}</span>
            <span className="mt-0.5 block text-sm text-subtle">{t(hint)}</span>
          </button>
        ))}
      </div>
      {/* Owner 2026-10-24: one quiet line under the 拟人头像 option on how the faces were made. */}
      <div className="mt-1.5 grid max-w-xl grid-cols-2 gap-3">
        <p data-portrait-ai-note="" className="text-xs text-subtle">{t("onboarding.tour.portraits.aiNote")}</p>
      </div>
      {!themes.length ? (
        <div className="mt-3 text-sm text-subtle">{t("onboarding.tour.portraits.none")}</div>
      ) : (
        <div className="mt-4">
          <div className="flex gap-2">
            {themes.slice(0, 8).map((th) => (
              <ThemeFace key={th.key} theme={th} size={44} />
            ))}
          </div>
          <div className="mt-1.5 text-xs text-subtle">{t("onboarding.tour.portraits.sample")}</div>
        </div>
      )}
      <div className="mt-3 text-xs text-subtle">{t("onboarding.tour.portraits.where")}</div>
    </div>
  );
}

/** After 用: select one or more themes, or Select all. Every change is applied at once. */
export function PortraitThemes({ answer, onAnswer }: { answer: PortraitAnswer; onAnswer(a: PortraitAnswer): void }) {
  const { t } = useI18n();
  const { themes } = usePortraitThemes();
  const [said, setSaid] = useState<string | null>(null);
  const set = (a: PortraitAnswer) => {
    setEnabledPortraitThemes(portraitThemesFor(a));
    onAnswer(a);
  };
  const toggle = (key: string) => {
    const on = answer.themes.includes(key);
    set({ use: true, themes: on ? answer.themes.filter((k) => k !== key) : [...answer.themes, key] });
    setSaid(null);
  };
  const keys = themes.map((th) => th.key);
  return (
    <div data-portrait-themes="" className="mt-3">
      <div className="flex items-center gap-2 text-xs text-subtle">
        <span>{t("onboarding.tour.portraits.count", { n: answer.themes.length })}</span>
        {said && (
          <span role="status" className="text-ok">
            {said}
          </span>
        )}
        {!answer.themes.length && <span className="text-warn">{t("onboarding.tour.portraits.askTheme")}</span>}
        <button
          type="button"
          data-portrait-decide=""
          className={DECIDE}
          onClick={() => {
            set(decidePortraitThemes(answer, keys));
            setSaid(t("onboarding.tour.portraits.decided", { n: keys.length }));
          }}
        >
          {t("onboarding.tour.portraits.selectAll")}
        </button>
      </div>
      <div role="group" aria-label={t("onboarding.tour.portraits.use")} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {themes.map((th) => (
          <ThemeCard key={th.key} theme={th} on={answer.themes.includes(th.key)} onToggle={() => toggle(th.key)} />
        ))}
      </div>
    </div>
  );
}
