// Settings → Profiles → <profile> → 外观: colour and provider (cutex PATCH color / providerCategory),
// then a sub-section tagged 本机 with the picture and the opening (portrait + greeting,
// lib/introAppearance), which stay on this device. All are drafts saved with the page's sticky bar.
import { Check, Pipette } from "lucide-react";
import { useState } from "react";
import type { ProfileDetail, ProfilePatch } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { useProfileAvatar } from "../../lib/profileAvatar";
import { INTRO_GREETING_MAX, resolveIntroGreeting, resolveIntroPortrait, useIntroAppearanceOf, type IntroDraft } from "../../lib/introAppearance";
import { useLaunchArt } from "../../lib/launchArt";
import { PROFILE_FEATURES } from "../../lib/profileKind";
import { inkOn, PROFILE_COLORS } from "../../lib/profileLook";
import { PROVIDER_LABEL, profileProvider, type Provider } from "../../lib/provider";
import { resolveTerms, useTermOverrides } from "../../lib/terms";
import { ProfileAvatar } from "../ProfileAvatar";
import { ProviderIcon } from "../ProviderIcon";
import { Button, SettingRow, Section, Select, TextArea } from "./Form";
import { useTargetFeatures } from "../../lib/targetHost";

const CATEGORIES: (Provider | "other")[] = ["kimi", "glm", "zai", "claude", "deepseek", "codex", "other"];

function Swatch({ color, selected, title, onClick, children }: { color: string; selected: boolean; title: string; onClick(): void; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-surface transition-shadow focus-visible:ring-2 focus-visible:ring-accent ${selected ? "ring-2 ring-foreground/70" : "hover:ring-2 hover:ring-border"}`}
      style={{ background: color, color: inkOn(color) }}
    >
      {children ?? (selected && <Check size={13} strokeWidth={2.5} />)}
    </button>
  );
}

export function ProfileAppearance({ detail, patch, set, host, picture, setPicture, onPicture, intro, setIntro, onIntroPortrait, introError }: {
  detail: ProfileDetail;
  patch: ProfilePatch;
  set(p: ProfilePatch): void;
  /** The edited profile's host (hosts-list id): the opening store's key, unlike the focus-keyed picture. */
  host: string;
  /** Picture draft: undefined = unchanged, null = remove, string = new picture (data URL). */
  picture: string | null | undefined;
  setPicture(p: string | null | undefined): void;
  onPicture(): void;
  /** Opening draft (portrait / greeting, lib/introAppearance), saved with the sticky bar like the picture. */
  intro: IntroDraft;
  setIntro(patch: Partial<IntroDraft>): void;
  onIntroPortrait(): void;
  /** Why the last pick or save failed; null = none. */
  introError: "type" | "tooLarge" | "bad" | "full" | null;
}) {
  const { t, locale } = useI18n();
  const features = useTargetFeatures();
  const stored = useProfileAvatar(detail.id);
  const shownPicture = picture !== undefined ? picture : stored;
  const storedIntro = useIntroAppearanceOf(host, detail.id);
  const shownIntroPortrait = intro.portrait !== undefined ? intro.portrait : storedIntro.portrait;
  const greetingDraft = intro.greeting !== undefined ? intro.greeting : storedIntro.greeting ?? "";

  // Colour: null = automatic (cutex's effective colour).
  const chosen = patch.color !== undefined ? patch.color : detail.appearance.color;
  const auto = detail.appearance.effectiveColor ?? PROFILE_COLORS[0]!;
  const shownColor = chosen ?? auto;
  const custom = !!chosen && !PROFILE_COLORS.includes(chosen.toLowerCase());

  // Provider: "" = automatic (what cutex infers).
  const canProvider = features.has(PROFILE_FEATURES.providerCategory);
  const manual = patch.providerCategory !== undefined ? patch.providerCategory : detail.appearance.providerCategory;
  // What 自动 means: cutex's effective value while nothing is stored by hand, else the local guess.
  const inferred = profileProvider({ ...detail, appearance: { ...detail.appearance, providerCategory: null, effectiveProviderCategory: detail.appearance.providerCategory ? null : detail.appearance.effectiveProviderCategory } });
  const label = (c: Provider | "other") => (c === "other" ? t("settings.profile.provider.other") : PROVIDER_LABEL[c]);
  const previewProfile = { ...detail, appearance: { ...detail.appearance, providerCategory: manual ?? null, effectiveProviderCategory: manual ?? detail.appearance.effectiveProviderCategory } };

  // The opening preview resolves like the timeline intro will (lib/introAppearance): the draft
  // portrait over the provider artwork, the draft greeting over the provider pool.
  const [introSample] = useState(() => Math.random());
  const ownerTerm = resolveTerms(useTermOverrides(), locale).owner.one;
  const introProvider = profileProvider(previewProfile);
  const launchArt = useLaunchArt();
  const introPortrait = resolveIntroPortrait(shownIntroPortrait, introProvider, launchArt);
  const introGreeting = resolveIntroGreeting({
    custom: intro.greeting !== undefined ? intro.greeting.trim() || null : storedIntro.greeting,
    provider: introProvider,
    locale,
    minute: new Date().getHours() * 60 + new Date().getMinutes(),
    owner: ownerTerm,
    agentName: detail.name,
    sample: introSample,
  });

  return (
    <>
      <Section title={t("settings.profile.look")}>
        <SettingRow label={t("agent-config.profile.color")} hint={t("settings.profile.color.hint")}>
          <div className="flex flex-wrap items-center gap-2">
            <Swatch color={auto} selected={chosen === null} title={t("settings.profile.color.auto")} onClick={() => set({ color: null })}>
              <span className="text-[10px] font-semibold">A</span>
            </Swatch>
            <span className="mx-0.5 h-4 w-px bg-border" />
            {PROFILE_COLORS.map((c) => (
              <Swatch key={c} color={c} selected={chosen?.toLowerCase() === c} title={c} onClick={() => set({ color: c })} />
            ))}
            <label
              title={t("settings.profile.color.custom")}
              className={`relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-surface ${custom ? "ring-2 ring-foreground/70" : "border border-dashed border-border text-subtle hover:text-foreground"}`}
              style={custom ? { background: chosen!, color: inkOn(chosen!) } : undefined}
            >
              <Pipette size={12} />
              <input type="color" value={shownColor} onChange={(e) => set({ color: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          </div>
        </SettingRow>
        <SettingRow
          label={t("settings.profile.provider")}
          hint={
            <>
              {t("settings.profile.provider.hint")}
              {!canProvider && <span className="block text-warn">{t("agent-config.profile.cutexReadOnly")}</span>}
            </>
          }
        >
          <span className="flex items-center gap-2">
            <ProviderIcon provider={profileProvider(previewProfile)} name={detail.name} size={14} />
            <Select
              disabled={!canProvider}
              value={manual ?? ""}
              options={[
                { value: "", label: inferred ? t("settings.profile.provider.autoAs", { name: label(inferred) }) : t("settings.profile.provider.auto") },
                ...CATEGORIES.map((c) => ({ value: c, label: label(c) })),
              ]}
              onChange={(v) => set({ providerCategory: v || null })}
            />
          </span>
        </SettingRow>
      </Section>
      <Section title={t("agent-config.profile.localLook")} source="local">
        <SettingRow label={t("settings.profile.picture")} hint={t("settings.profile.picture.hint")}>
          <ProfileAvatar profile={previewProfile} size={32} badge picture={shownPicture} color={shownColor} />
          <Button onClick={onPicture}>{shownPicture ? t("settings.profile.picture.change") : t("settings.profile.picture.upload")}</Button>
          {shownPicture && <Button onClick={() => setPicture(stored ? null : undefined)}>{t("settings.profile.picture.remove")}</Button>}
        </SettingRow>
        <SettingRow label={t("settings.profile.introPortrait")} hint={t("settings.profile.introPortrait.hint")}>
          {shownIntroPortrait && <img src={shownIntroPortrait} alt="" className="h-10 w-auto rounded-md border border-border bg-surface-2 object-contain" />}
          <Button onClick={onIntroPortrait}>{shownIntroPortrait ? t("settings.profile.introPortrait.change") : t("settings.profile.introPortrait.upload")}</Button>
          {shownIntroPortrait && <Button onClick={() => setIntro({ portrait: storedIntro.portrait ? null : undefined })}>{t("settings.profile.introPortrait.remove")}</Button>}
          {introError && (
            <span role="alert" className="text-xs text-danger">
              {t(`settings.profile.introPortrait.bad.${introError}`)}
            </span>
          )}
        </SettingRow>
        <SettingRow
          label={t("settings.profile.introGreeting")}
          hint={
            <>
              {t("settings.profile.introGreeting.hint")}
              <br />
              {t("settings.profile.introGreeting.vars", { owner: "{{owner}}", name: "{{name}}" })}
            </>
          }
        >
          <TextArea
            value={greetingDraft}
            onChange={(v) => {
              const capped = [...v].slice(0, INTRO_GREETING_MAX).join("");
              setIntro({ greeting: capped === (storedIntro.greeting ?? "") ? undefined : capped });
            }}
            placeholder={t("settings.profile.introGreeting.placeholder")}
            width="w-72"
            rows={3}
          />
        </SettingRow>
        <SettingRow label={t("settings.profile.introPreview")}>
          <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-xl border border-border bg-surface-2/40 px-4 py-3 text-center">
            {introPortrait && <img src={introPortrait} alt="" className="max-h-24 w-auto object-contain" />}
            <p className="max-w-xs text-sm leading-relaxed text-muted">{introGreeting || "—"}</p>
          </div>
        </SettingRow>
      </Section>
    </>
  );
}
