// 自定义桌面 inside the guide (owner 2026-11-26: not a Settings page — docs/desktop-modules.md §5.1 — but a part of
// 开始使用): theme and colours, size, animation, wording, sidebar and layout, avatars. Each control is the real
// setting's own component and setter (lib/appearance, lib/prefs, lib/termPresets, lib/firstChoices, lib/portraitThemes),
// so a change applies at once and shows on its settings page; each part links there for the rest
// (「在设置里改更多」). Shown as the optional step 4 of the three-step card (./StartCard) and the 自定义桌面 item of
// 接下来可以试试 (./TryNext); 帮助 → 开始使用 opens the card with it unfolded.
import { useCallback, useState, type ReactNode } from "react";
import { ChoiceList, PortraitChoice, PortraitThemes } from "../../components/FirstChoices";
import { PerfStep, TermsStep, ThemeStep, ZoomStep } from "../../components/OnboardingSteps";
import { useI18n, type MessageKey } from "../../i18n";
import { getEnabledPortraitThemes, setEnabledPortraitThemes, usePortraitThemes } from "../../lib/portraitThemes";
import { initialPortraitAnswer, portraitThemesFor, type PortraitAnswer } from "../../lib/tour";
import { useApp } from "../../store";
import { CUSTOMIZE_SETTINGS, type CustomizePart } from "./pages";

function Part({ id, children }: { id: CustomizePart; children: ReactNode }) {
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  const where = CUSTOMIZE_SETTINGS[id];
  return (
    <section data-customize={id} className="border-t border-border pt-2.5 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 text-ui font-semibold text-foreground">{t(`start.customize.${id}` as MessageKey)}</h3>
        <button type="button" data-customize-more={id} onClick={() => openSettings(where.tab, { anchor: where.anchor })} className="text-meta text-accent hover:underline">
          {t("start.customize.more")}
        </button>
      </div>
      <div className="flex flex-col pb-1">{children}</div>
    </section>
  );
}

export function CustomizePanel() {
  const { themes } = usePortraitThemes();
  const [eggRevealed, setEggRevealed] = useState(false);
  const reveal = useCallback(() => setEggRevealed(true), []);
  // Today's avatars: whatever Settings holds (an existing choice is kept, never preselected anew).
  const [answer, setAnswer] = useState<PortraitAnswer>(() => initialPortraitAnswer(getEnabledPortraitThemes(), [], true));
  // Applied at once like the other choices; 用 waits for a theme (none = today's letters / emoji stay).
  const answerPortraits = useCallback((a: PortraitAnswer) => {
    setAnswer(a);
    if (a.use === false || a.themes.length) setEnabledPortraitThemes(portraitThemesFor(a));
  }, []);
  return (
    <div className="flex flex-col gap-3" data-customize-panel="">
      <Part id="theme"><ThemeStep /></Part>
      <Part id="zoom"><ZoomStep /></Part>
      <Part id="perf"><PerfStep /></Part>
      <Part id="terms"><TermsStep egg={{ revealed: eggRevealed, reveal }} /></Part>
      <Part id="layout"><div className="mt-2"><ChoiceList ids={["sidebarLayout", "threeColumns"]} /></div></Part>
      <Part id="portraits">
        <PortraitChoice answer={answer} onAnswer={answerPortraits} all={themes.map((th) => th.key)} />
        {answer.use && <PortraitThemes answer={answer} onAnswer={answerPortraits} />}
      </Part>
    </div>
  );
}
