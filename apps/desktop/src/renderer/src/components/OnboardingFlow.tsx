// One merged onboarding: concepts first, one related choice per card. Existing choices are skipped.
// Closing keeps current preferences. Only continuing past a new portrait preselection commits it.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { X } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { closeOnboarding, getOnboarding, stepAsideOnboarding } from "../lib/onboarding";
import { GUIDE_ACTIONS, type GuideActionId } from "../lib/guideActions";
import { GuideActionButton } from "./GuideActionButton";
import { configuredFlowSteps, flowSteps, NEW_IN_02, type FlowMode, type FlowSection, type FlowStepId } from "../lib/onboardingFlow";
import { useTrackOverlay } from "../lib/openOverlays";
import { cachedProfileList, loadProfileList } from "../lib/profileSnapshot";
import { type FirstChoice } from "../lib/firstChoices";
import { getEnabledPortraitThemes, setEnabledPortraitThemes, usePortraitThemes } from "../lib/portraitThemes";
import { initialPortraitAnswer, portraitAnswered, portraitThemesFor, type PortraitAnswer } from "../lib/tour";
import { preloadOnboardingFaces } from "../lib/onboardingFaces";
import { useOnboardingInteraction } from "../lib/onboardingInteraction";
import { Button } from "./settings/Form";
import { btn } from "./Button";
import { useApp } from "../store";
import { Prose } from "./OnboardingProse";
import { ChoiceList, PortraitChoice, PortraitThemes } from "./FirstChoices";
import { LanguageStep, PerfStep, ProfileStep, TermsStep, ThemeStep, ZoomStep, type EggState } from "./OnboardingSteps";
import { GroupsArt, IntroArt, LookArt, MoreArt, PagesArt, ProjectArt, WindowArt } from "./TourArt";
import { isElement } from "../lib/ownerWindow";

interface StepView {
  title: MessageKey;
  body: MessageKey;
  /** A drawing beside the text. */
  Art?: ComponentType;
  /** First-contact choices on this card (lib/firstChoices). */
  choices?: readonly FirstChoice["id"][];
  /** 试一试: what it opens (lib/guideActions) once the flow stepped aside (「回到引导」 brings it back). */
  tryIt?: { label: MessageKey; action: GuideActionId };
}

const VIEWS: Record<FlowStepId, StepView> = {
  language: { title: "onboarding.language.title", body: "onboarding.language.body" },
  theme: { title: "onboarding.theme.title", body: "onboarding.theme.body" },
  zoom: { title: "onboarding.zoom.title", body: "onboarding.zoom.body" },
  perf: { title: "onboarding.perf.title", body: "onboarding.perf.body" },
  terms: { title: "onboarding.terms.title", body: "onboarding.terms.body" },
  portraits: { title: "onboarding.tour.portraits.title", body: "onboarding.tour.portraits.body" },
  portraitThemes: { title: "onboarding.flow.portraitThemes.title", body: "onboarding.flow.portraitThemes.body" },
  sidebar: { title: "onboarding.flow.sidebar.title", body: "onboarding.flow.sidebar.body", choices: ["sidebarLayout"] },
  layout: { title: "onboarding.flow.layout.title", body: "onboarding.flow.layout.body", choices: ["threeColumns"] },
  intro: { title: "onboarding.intro.title", body: "onboarding.intro.body", Art: IntroArt },
  window: { title: "onboarding.window.title", body: "onboarding.window.body", Art: WindowArt },
  project: { title: "onboarding.project.title", body: "onboarding.project.body", Art: ProjectArt },
  groups: { title: "onboarding.tour.groups.title", body: "onboarding.tour.groups.body", Art: GroupsArt, tryIt: { label: "onboarding.tour.groups.try", action: "tour.groups" } },
  pages: {
    title: "onboarding.tour.pages.title",
    body: "onboarding.tour.pages.body",
    Art: PagesArt,
    tryIt: { label: "onboarding.tour.pages.try", action: "tour.pages" },
  },
  look: { title: "onboarding.tour.look.title", body: "onboarding.tour.look.body", Art: LookArt },
  more: { title: "onboarding.tour.more.title", body: "onboarding.tour.more.body", Art: MoreArt, tryIt: { label: "onboarding.tour.more.try", action: "tour.more" } },
  profile: { title: "onboarding.profile.title", body: "onboarding.profile.body" },
};

const SECTION_LABEL: Record<FlowSection, MessageKey> = {
  setup: "onboarding.flow.section.setup",
  basics: "onboarding.flow.section.basics",
  new: "onboarding.flow.section.new",
  finish: "onboarding.flow.section.finish",
};

/** Whether the host has no Profile yet (the last card then offers 添加 Profile). */
function useNoProfile(enabled: boolean): boolean {
  const host = useApp((s) => s.hosts?.active ?? null);
  const [none, setNone] = useState(() => enabled && cachedProfileList()?.profiles.length === 0);
  useEffect(() => {
    if (!enabled) return;
    setNone(cachedProfileList()?.profiles.length === 0);
    let live = true;
    loadProfileList().then((list) => live && setNone(!!list && list.profiles.length === 0), () => {});
    return () => {
      live = false;
    };
  }, [enabled, host]);
  return none;
}

/**
 * `mode` full: the whole flow (OnboardingHost's `intro` view); `closeVersion` = the installed version, counted as seen.
 * whatsNew: 0.2 有什么 only (the `whatsNew` view of a version with a tour, lib/tour).
 */
export function OnboardingFlow({ mode, version, closeVersion = null, startAt }: { mode: FlowMode; version: string; closeVersion?: string | null; startAt?: string }) {
  const { t } = useI18n();
  useTrackOverlay(true);
  const { themes } = usePortraitThemes();
  const emptyProfiles = useNoProfile(mode === "full");
  const noProfile = emptyProfiles || startAt === "profile";
  const allThemes = useMemo(() => themes.map((th) => th.key), [themes]);
  const [configured] = useState(() => configuredFlowSteps());
  const [preserveExisting] = useState(() => getOnboarding().doneRevision > 0 || configured.includes("portraits"));
  const [answer, setAnswer] = useState<PortraitAnswer>(() => initialPortraitAnswer(getEnabledPortraitThemes(), allThemes, preserveExisting));
  // The packs can arrive after the first render: an untouched preselection then takes every theme.
  const touched = useRef(false);
  const answerPortraits = useCallback((a: PortraitAnswer) => {
    touched.current = true;
    setEnabledPortraitThemes(portraitThemesFor(a));
    setAnswer(a);
  }, []);
  useEffect(() => {
    if (!touched.current && answer.use && !answer.themes.length && allThemes.length) setAnswer({ use: true, themes: [...allThemes] });
  }, [allThemes, answer]);
  useEffect(() => preloadOnboardingFaces(), []);
  const portraitThemes = answer.use === true;
  const steps = useMemo(() => flowSteps(mode, { noProfile, portraitThemes, configured }), [mode, noProfile, portraitThemes, configured]);
  // 回到引导: the card an action left from.
  const [index, setIndex] = useState(() => Math.max(0, steps.findIndex((s) => s.id === startAt)));
  const at = Math.min(index, steps.length - 1);
  const step = steps[at]!;
  const view = VIEWS[step.id];
  const last = at === steps.length - 1;
  const [eggRevealed, setEggRevealed] = useState(false);
  const revealEgg = useCallback(() => setEggRevealed(true), []);
  const egg: EggState = { revealed: eggRevealed, reveal: revealEgg };
  const box = useRef<HTMLDivElement>(null);
  // Next waits for the 拟人头像 answer, and after 用 for at least one theme.
  const blocked = (step.id === "portraits" && answer.use === null) || (step.id === "portraitThemes" && !portraitAnswered(answer));
  const close = useCallback(() => closeOnboarding(closeVersion), [closeVersion]);
  const stepAside = () => stepAsideOnboarding(closeVersion, step.id);
  useOnboardingInteraction(box, close, step.id);
  const go = (n: number) => {
    if (n > at && blocked) return;
    // Moving on from the 拟人头像 cards writes what they show (the preselected 用 included).
    if (n > at && (step.id === "portraits" || step.id === "look" || step.id === "portraitThemes")) setEnabledPortraitThemes(portraitThemesFor(answer));
    setIndex(Math.max(0, Math.min(steps.length - 1, n)));
  };
  const next = () => (last ? close() : go(at + 1));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = isElement(e.target) ? e.target : null;
      if (target?.closest("input, textarea, select, button, a, [role=radio], [role=checkbox]")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!last) go(at + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(at - 1);
      } else if (e.key === "Enter" && !target?.closest("button")) {
        e.preventDefault();
        if (!blocked) next();
      }
    };
    const panel = box.current;
    panel?.addEventListener("keydown", onKey);
    return () => panel?.removeEventListener("keydown", onKey);
  });
  const label = mode === "whatsNew" ? t("onboarding.tour.label", { version }) : t("onboarding.dialogLabel");
  const Art = view.Art;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal
        aria-label={label}
        data-onboarding=""
        data-onboarding-mode={mode}
        data-onboarding-step={step.id}
        className="flex h-[35rem] max-h-full w-[58rem] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl outline-none"
      >
        {/* The one progress indicator: the sections by name, each with its dots. */}
        <div className="flex items-center gap-3 px-4 pt-4 sm:px-6 text-xs text-subtle">
          <span className="font-semibold text-accent">{label}</span>
          <nav className="min-w-0 flex-1 text-right" aria-label={t("onboarding.step", { n: at + 1, total: steps.length })} data-onboarding-progress="">
            <span className="font-medium text-foreground" data-onboarding-section={step.section}>{t(SECTION_LABEL[step.section])} · {at + 1}/{steps.length}</span>
          </nav>
          <button title={t("onboarding.skip")} aria-label={t("onboarding.skip")} onClick={close} className="rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        <div className={`grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 pt-4 pb-3 sm:px-8 md:gap-7 ${Art ? "grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : "grid-cols-1"}`} data-onboarding-body="">
          {/* A column, so a step can put something at the very bottom (节省资源 / 流畅优先: the jokes, mt-auto). */}
          <div className="flex min-w-0 flex-col">
            <h2 tabIndex={-1} aria-live="polite" className="mb-2 flex items-center gap-2 text-2xl font-semibold text-foreground">
              {t(view.title)}
              {mode === "full" && NEW_IN_02.has(step.id) && (
                <span data-onboarding-new="" className="rounded-md bg-accent/12 px-1.5 py-0.5 text-meta font-semibold text-accent">
                  {t("onboarding.flow.newTag")}
                </span>
              )}
            </h2>
            <Prose text={t(view.body)} large />
            {step.id === "intro" && <p className="mt-3 whitespace-pre-line text-sm text-subtle">{t("onboarding.flow.scope")}</p>}
            {step.id === "language" && <LanguageStep />}
            {step.id === "theme" && <ThemeStep />}
            {step.id === "zoom" && <ZoomStep />}
            {step.id === "perf" && <PerfStep />}
            {step.id === "terms" && <TermsStep egg={egg} />}
            {step.id === "profile" && <ProfileStep />}
            {(step.id === "portraits" || (step.id === "look" && !configured.includes("portraits"))) && <PortraitChoice answer={answer} onAnswer={answerPortraits} all={allThemes} />}
            {step.id === "portraitThemes" && <PortraitThemes answer={answer} onAnswer={answerPortraits} />}
            {view.choices && (
              <div className="mt-4">
                <ChoiceList ids={view.choices} />
              </div>
            )}
            {step.id === "profile" && (
              <div className="mt-4">
                <GuideActionButton id="profile.add" action={GUIDE_ACTIONS["profile.add"]} before={stepAside} className={btn({ variant: "primary" })}>
                  {t("onboarding.profile.add")}
                </GuideActionButton>
              </div>
            )}
            {view.tryIt && (
              <div className="mt-4" data-tour-try={step.id}>
                <GuideActionButton id={view.tryIt.action} action={GUIDE_ACTIONS[view.tryIt.action]} before={stepAside} className="rounded-lg border border-accent/50 px-3.5 py-2 text-sm text-accent hover:bg-accent/10">
                  {t("onboarding.tour.try")}：{t(view.tryIt.label)}
                </GuideActionButton>
              </div>
            )}
          </div>
          {Art && (
            <div className="hidden min-w-0 py-1 md:block">
              <Art />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-6">
          <button data-onboarding-keep="" onClick={close} className="min-w-0 text-left text-sm text-subtle hover:text-foreground">
            {t("onboarding.flow.keep")}
          </button>
          <span className="ml-auto" />
          {last && step.id === "more" && (
            <GuideActionButton id="tour.allChanges" action={GUIDE_ACTIONS["tour.allChanges"]} before={stepAside} className="text-sm text-subtle hover:text-foreground">
              {t("onboarding.tour.allChanges")}
            </GuideActionButton>
          )}
          {at > 0 && <Button onClick={() => go(at - 1)}>{t("onboarding.back")}</Button>}
          <Button primary onClick={next} disabled={blocked} title={blocked ? t(step.id === "portraitThemes" ? "onboarding.tour.portraits.askTheme" : "onboarding.tour.portraits.ask") : undefined}>
            {t(last ? "onboarding.finish" : "onboarding.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
