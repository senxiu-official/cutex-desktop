// The introduction and the per-version 新功能 dialog (owner 2026-10-19; state in lib/onboarding, strings in
// modules/onboarding/i18n.ts — draft copy, the wording is the owner's). Opens by itself once at start
// (`automaticView`) or from Settings → 关于. Steps of the introduction: the UI language, the appearance
// (theme, palettes, zoom — the same setters as Settings → 外观, applied at once), an agent is a session
// (+ what Cutex adds), projects, the first Profile (only while the host has none), and the wording preset
// (lib/termPresets). A new step = one entry in `introSteps`.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { changelogText, type ChangelogRelease } from "../../../shared/changelog";
import { useI18n, type MessageKey } from "../i18n";
import { setAppearance, useAppearance } from "../lib/appearance";
import { LANGUAGES } from "../lib/languages";
import { automaticView, bundledReleases, closeOnboarding, getOnboarding, openOnboarding, testView, useOnboardingView, type OnboardingView } from "../lib/onboarding";
import { useTrackOverlay } from "../lib/openOverlays";
import { cachedProfileList, loadProfileList } from "../lib/profileSnapshot";
import { applyTermPreset, currentTermPreset, presetOverrides, termPresets, type TermPreset } from "../lib/termPresets";
import { applyDarkPalette, applyLightPalette, applyTheme, DARK_PALETTES, LIGHT_PALETTES, loadDarkPalette, loadLightPalette, loadTheme, PALETTE_SWATCH, type DarkPalette, type LightPalette, type ThemePref } from "../lib/theme";
import { applyTerms, resolveTerms, useTermOverrides, type TermLocale } from "../lib/terms";
import { useUpdateStatus } from "../lib/update";
import { useApp } from "../store";
import { Button, Segmented, SwatchPicker } from "./settings/Form";

/** Body text: paragraphs split on \n; lines starting with "• " are bullets. */
function Prose({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) out.push(<ul key={`u${out.length}`} className="my-1 list-disc space-y-0.5 pl-5">{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>);
    bullets = [];
  };
  for (const line of lines) {
    if (line.startsWith("• ")) bullets.push(line.slice(2));
    else {
      flush();
      if (line.trim()) out.push(<p key={`p${out.length}`} className="my-1.5">{line}</p>);
    }
  }
  flush();
  return <div className="text-sm leading-relaxed text-muted">{out}</div>;
}

// The preview line of the wording step, per language family (raw templates: each preset fills them).
const PREVIEW: Record<"zh" | "en", string> = {
  zh: "＋ 新建{{agent}}　·　3 个{{agent}}在线　·　{{director}}：2 个{{subagent}}工作中　·　等{{owner}}批准",
  en: "+ New {{agent}}  ·  3 {{agents}} online  ·  {{director}}: 2 {{subagents}} working  ·  waiting for {{owner}}",
};

/**
 * The hidden Maid chip (owner 2026-10-19): the plain choices are 智能体 / 代理 / agent; a small 🎀 at the end of
 * the preview line, with no label or hint, reveals the Maid wording when clicked.
 */

/** Whether the Maid chip shows, kept by the introduction so it stays revealed across its steps. */
export interface EggState {
  revealed: boolean;
  reveal(): void;
}

function TermsStep({ egg }: { egg: EggState }) {
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
  const template = locale.startsWith("zh") ? PREVIEW.zh : PREVIEW.en;
  const preview = (p: TermPreset) => applyTerms(template, resolveTerms(presetOverrides(termLocale, p), termLocale), termLocale);
  const shown = all.find((p) => p.id === current);
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup">
        {presets.map((p) => {
          const className = `rounded-full border px-3 py-1 ${p.easterEgg ? "text-xs" : "text-sm"} ${current === p.id ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted hover:bg-hover"}`;
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
      <div data-onboarding-preview="" className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted select-none">
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
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
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

/** Language step: every UI language named in itself (lib/languages, as in Settings → 通用); a click switches at once. */
function LanguageStep() {
  const { locale, setLocale } = useI18n();
  return (
    <div className="mt-3 grid grid-cols-3 gap-1.5" role="radiogroup">
      {LANGUAGES.map((l) => (
        <button
          key={l.value}
          role="radio"
          aria-checked={locale === l.value}
          lang={l.value}
          onClick={() => setLocale(l.value)}
          className={`truncate rounded-md border px-2.5 py-1.5 text-left text-sm ${locale === l.value ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted hover:bg-hover"}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

const ZOOMS = [90, 100, 110, 125] as const;

/** Appearance step: theme, the light and dark palettes, and zoom — Settings → 外观's own setters, live. */
function AppearanceStep() {
  const { t } = useI18n();
  const zoom = useAppearance().zoom;
  const [theme, setTheme] = useState<ThemePref>(loadTheme);
  const [lightPalette, setLightPalette] = useState<LightPalette>(loadLightPalette);
  const [darkPalette, setDarkPalette] = useState<DarkPalette>(loadDarkPalette);
  const row = (label: string, control: ReactNode) => (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-sm text-muted">{label}</span>
      {control}
    </div>
  );
  return (
    <div className="mt-3 space-y-2.5 rounded-lg border border-border px-3 py-3">
      {row(
        t("shell.theme"),
        <Segmented
          label={t("shell.theme")}
          value={theme}
          options={(["light", "dark", "system"] as ThemePref[]).map((v) => ({ value: v, label: t(`shell.theme.${v}` as MessageKey) }))}
          onChange={(v) => {
            setTheme(v);
            applyTheme(v);
          }}
        />,
      )}
      {row(
        t("appearance.lightPalette"),
        <SwatchPicker
          label={t("appearance.lightPalette")}
          value={lightPalette}
          options={LIGHT_PALETTES.map((v) => ({ value: v, label: t(`appearance.palette.${v}` as MessageKey), colors: PALETTE_SWATCH[v] }))}
          onChange={(v) => {
            setLightPalette(v);
            applyLightPalette(v);
          }}
        />,
      )}
      {row(
        t("appearance.darkPalette"),
        <SwatchPicker
          label={t("appearance.darkPalette")}
          value={darkPalette}
          options={DARK_PALETTES.map((v) => ({ value: v, label: t(`appearance.palette.${v}` as MessageKey), colors: PALETTE_SWATCH[v] }))}
          onChange={(v) => {
            setDarkPalette(v);
            applyDarkPalette(v);
          }}
        />,
      )}
      {row(
        t("appearance.zoom"),
        <Segmented<string>
          label={t("appearance.zoom")}
          value={String(zoom)}
          options={ZOOMS.map((z) => ({ value: String(z), label: `${z}%` }))}
          onChange={(v) => setAppearance({ zoom: Number(v) })}
        />,
      )}
    </div>
  );
}

interface IntroStep {
  id: string;
  title: MessageKey;
  body: MessageKey;
  extra?: () => ReactNode;
}

function introSteps(noProfile: boolean, addProfile: () => void, t: (k: MessageKey) => string, egg: EggState): IntroStep[] {
  return [
    { id: "language", title: "onboarding.language.title", body: "onboarding.language.body", extra: () => <LanguageStep /> },
    { id: "appearance", title: "onboarding.appearance.title", body: "onboarding.appearance.body", extra: () => <AppearanceStep /> },
    { id: "intro", title: "onboarding.intro.title", body: "onboarding.intro.body" },
    { id: "project", title: "onboarding.project.title", body: "onboarding.project.body" },
    { id: "terms", title: "onboarding.terms.title", body: "onboarding.terms.body", extra: () => <TermsStep egg={egg} /> },
    // Last: 「添加 Profile」 ends the introduction and opens the form, so nothing is skipped by it.
    ...(noProfile
      ? [{ id: "profile", title: "onboarding.profile.title", body: "onboarding.profile.body", extra: () => <div className="mt-3"><Button primary onClick={addProfile}>{t("onboarding.profile.add")}</Button></div> } satisfies IntroStep]
      : []),
  ];
}

/** One fixed size for every step (owner 2026-10-19: the box must not change size between steps); a long body scrolls inside. */
function Frame({ label, onClose, children, footer }: { label: string; onClose(): void; children: ReactNode; footer: ReactNode }) {
  const { t } = useI18n();
  useTrackOverlay(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35">
      <div role="dialog" aria-modal aria-label={label} data-onboarding="" className="flex h-[26rem] max-h-[86vh] w-[36rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex justify-end px-3 pt-3">
          <button title={t("onboarding.close")} onClick={onClose} className="rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-2">{children}</div>
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

function Intro({ version }: { version: string | null }) {
  const { t } = useI18n();
  const [noProfile, setNoProfile] = useState(() => cachedProfileList()?.profiles.length === 0);
  useEffect(() => {
    let live = true;
    loadProfileList().then((list) => live && setNoProfile(!!list && list.profiles.length === 0), () => {});
    return () => {
      live = false;
    };
  }, []);
  const close = () => closeOnboarding(version);
  const addProfile = () => {
    close();
    useApp.getState().openSettings("profiles", { create: true });
  };
  const [eggRevealed, setEggRevealed] = useState(false);
  const revealEgg = useCallback(() => setEggRevealed(true), []);
  const steps = introSteps(noProfile, addProfile, t, { revealed: eggRevealed, reveal: revealEgg });
  const [index, setIndex] = useState(0);
  const at = Math.min(index, steps.length - 1);
  const step = steps[at]!;
  const last = at === steps.length - 1;
  return (
    <Frame
      label={t("onboarding.dialogLabel")}
      onClose={close}
      footer={
        <>
          <button onClick={close} className="text-xs text-subtle hover:text-foreground">{t("onboarding.skip")}</button>
          <div className="mx-auto flex gap-1.5" aria-label={t("onboarding.step", { n: at + 1, total: steps.length })}>
            {steps.map((s, i) => (
              <span key={s.id} className={`h-1.5 w-1.5 rounded-full ${i === at ? "bg-accent" : "bg-border"}`} />
            ))}
          </div>
          {at > 0 && <Button onClick={() => setIndex(at - 1)}>{t("onboarding.back")}</Button>}
          <Button primary onClick={() => (last ? close() : setIndex(at + 1))}>{t(last ? "onboarding.finish" : "onboarding.next")}</Button>
        </>
      }
    >
      <div data-onboarding-step={step.id}>
        <h2 className="mb-2 text-lg font-semibold">{t(step.title)}</h2>
        <Prose text={t(step.body)} />
        {step.extra?.()}
      </div>
    </Frame>
  );
}

function WhatsNew({ version, release }: { version: string; release: ChangelogRelease | null }) {
  const { t, locale } = useI18n();
  const close = () => closeOnboarding(null);
  const summary = release?.blocks.find((b) => b.kind === "text");
  // Group headings are English in CHANGELOG.md: a Chinese UI shows only those with a Chinese text.
  const headings = release?.blocks.filter((b) => b.kind === "heading" && (!locale.startsWith("zh") || !!b.zh)) ?? [];
  return (
    <Frame
      label={t("onboarding.whatsNew.title", { version })}
      onClose={close}
      footer={
        <>
          <button
            onClick={() => {
              close();
              useApp.getState().openSettings("about");
            }}
            className="text-xs text-subtle hover:text-foreground"
          >
            {t("onboarding.whatsNew.more")}
          </button>
          <div className="ml-auto" />
          <Button primary onClick={close}>{t("onboarding.close")}</Button>
        </>
      }
    >
      <h2 className="mb-2 text-lg font-semibold">
        {t("onboarding.whatsNew.title", { version })}
        {release?.title && <span className="ml-2 text-sm font-normal text-subtle">“{release.title}”</span>}
      </h2>
      {summary ? <Prose text={changelogText(summary, locale)} /> : <p className="text-sm text-muted">{t("onboarding.whatsNew.empty")}</p>}
      {headings.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {headings.map((h, i) => (
            <span key={i} className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted">{changelogText(h, locale)}</span>
          ))}
        </div>
      )}
    </Frame>
  );
}

/** Mounted once in App: shows what lib/onboarding has open, and opens the automatic view once per start. */
export function OnboardingHost() {
  const view = useOnboardingView();
  const status = useUpdateStatus();
  const installed = status?.current?.version ?? null;
  // The build identity for the testing switch: a source build changes commit without a new version.
  const build = status?.current ? `${status.current.version ?? ""}@${status.current.commit}` : null;
  const daemonKind = useApp((s) => s.daemon.kind);
  const decided = useRef(false);
  const listed = useMemo(() => bundledReleases().map((r) => r.version), []);
  useEffect(() => {
    // Once per start, after the first host state is known. The introduction does not need the version
    // (a first run without cutex gets it too); a version's 新功能 waits for the installed version.
    if (decided.current || daemonKind === "connecting") return;
    const test = testView(getOnboarding(), build, listed);
    if (test) {
      decided.current = true;
      const timer = setTimeout(() => openOnboarding(test), 1200);
      return () => clearTimeout(timer);
    }
    if (getOnboarding().testEveryBuild && !build) return; // wait for the build before deciding
    const needsIntro = automaticView(getOnboarding(), null, listed)?.kind === "intro";
    if (!needsIntro && !installed) return;
    const timer = setTimeout(() => {
      if (decided.current) return;
      decided.current = true;
      const auto: OnboardingView | null = automaticView(getOnboarding(), installed, listed);
      if (auto) openOnboarding(auto);
    }, 1200);
    return () => clearTimeout(timer);
  }, [daemonKind, installed, build, listed]);
  if (!view) return null;
  if (view.kind === "intro") return <Intro version={installed} />;
  const release = bundledReleases().find((r) => r.version === view.version) ?? null;
  return <WhatsNew version={view.version} release={release} />;
}
