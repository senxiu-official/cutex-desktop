// One appearance card: host colour, full avatar style (host when supported), host icon/usage category.
// Pictures and the opening retain their existing host sync / legacy local fallback. All are drafts.
import { useShownNotice } from "../ProfileLinkedAppearance";
import { Check, Pipette } from "lucide-react";
import { useState } from "react";
import type { ProfileDetail, ProfilePatch } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { useProfileAvatar } from "../../lib/profileAvatar";
import { INTRO_GREETING_MAX, resolveIntroGreeting, resolveIntroPortrait, useIntroAppearanceOf, type IntroDraft } from "../../lib/introAppearance";
import { useLaunchArt } from "../../lib/launchArt";
import { PROFILE_FEATURES } from "../../lib/profileKind";
import { inkOn, PROFILE_COLORS } from "../../lib/profileLook";
import { PROVIDER_LABEL, profileProvider, type Provider } from "../../lib/provider";
import { resolveTerms, useTermOverrides } from "../../lib/terms";
import { ProfileAvatar } from "../ProfileAvatar";
import { ProviderIcon } from "../ProviderIcon";
import { Button, ResetButton, SettingRow, Section, SettingsGroup, Select, TextArea, Toggle } from "./Form";
import type { LinkedAppearanceControls } from "../../lib/profileLinkAppearance";
import { useTargetFeatures } from "../../lib/targetHost";
import { getAppAvatarStyle, getProfileAvatarStyle, pendingLocalProfileAvatarStyle, saveLocalProfileAvatarStyle, useAvatarStyleVersion, type AvatarStyle } from "../../lib/avatarStyle";
import { AvatarStyleLabel, AvatarStylePicker } from "./AvatarStylePicker";
import { useProfileLooksSynced } from "../../lib/profileLooks";

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

export function ProfileAppearance({ detail, patch, set, host, picture, setPicture, onPicture, intro, setIntro, onIntroPortrait, introError, theme, setTheme, linked }: {
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
  /** Full style draft: undefined unchanged, null inherit app; local fallback for older hosts. */
  theme: AvatarStyle | null | undefined;
  setTheme(theme: AvatarStyle | null | undefined): void;
  linked?: { state: LinkedAppearanceControls; checked: boolean; onChecked(value: boolean): void };
}) {
  const { t, locale } = useI18n();
  // 已同步到 X only briefly (owner 2026-10-25); 取消同步 stays in the card's ⋯.
  const notice = useShownNotice(linked?.state.notice);
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

  useAvatarStyleVersion();
  const synced = useProfileLooksSynced(host);
  const storedStyle = getProfileAvatarStyle(host, detail.id);
  const localStyle = pendingLocalProfileAvatarStyle(host, detail.id);
  const [savingLocalStyle, setSavingLocalStyle] = useState(false);
  const [localStyleError, setLocalStyleError] = useState<string | null>(null);
  const shownStyle = theme !== undefined ? theme : storedStyle;

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
      <Section   title={t("settings.profile.look")} hint={t((features.has("profile-avatar-style") ? "avatarStyle.appearanceHostScope" : "avatarStyle.appearanceScope") as MessageKey, { name: detail.name })}>
        {linked?.state.linked && (
          <SettingRow source="host" agents="none" label={t("settings.profile.link.appearance.also")} hint={t("settings.profile.link.appearance.alsoHint")}>
            <Toggle checked={linked.checked} disabled={linked.state.busy || linked.state.conflict} onChange={linked.onChecked} />
          </SettingRow>
        )}
        {linked?.state.linked && linked.state.conflict && (
          <div className="my-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs">
            <p className="text-muted">{t("settings.profile.link.appearance.conflict")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {linked.state.choices.map((source) => (
                <Button key={`${source.hostId}:${source.profile.id}`} disabled={linked.state.busy} onClick={() => void linked.state.choose(source)}>
                  {t("settings.profile.link.appearance.useSource", { host: `${source.hostName} · ${source.profile.name}` })}
                </Button>
              ))}
              <Button disabled={linked.state.busy} onClick={linked.state.keepSeparate}>{t("settings.profile.link.appearance.keepSeparate")}</Button>
            </div>
          </div>
        )}
        {notice && linked && (
          <div role="status" className="my-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{t(`settings.profile.link.appearance.${notice.kind}`, { hosts: notice.hosts.join(", ") })}</span>
            {notice.undo && <Button disabled={linked.state.busy} onClick={() => void linked.state.undo()}>{t("settings.profile.link.appearance.undo")}</Button>}
            {["pending", "error", "storageError"].includes(notice.kind) && <Button disabled={linked.state.busy} onClick={linked.state.retry}>{t("settings.profile.link.appearance.retry")}</Button>}
          </div>
        )}
        <SettingRow source="host" agents="none" label={t("agent-config.profile.color")} info={t("settings.profile.color.hint")}>
          <div className="flex flex-wrap items-center gap-2">
            <Swatch color={auto} selected={chosen === null} title={t("settings.profile.color.auto")} onClick={() => set({ color: null })}>
              <span className="text-caption/[inherit] font-semibold">A</span>
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
        <SettingRow agents="none" source={features.has("profile-avatar-style") ? "host" : "local"} label={t("avatarStyle.title" as MessageKey)} hint={<>{t((features.has("profile-avatar-style") ? "avatarStyle.profileHost" : "avatarStyle.profileLocal") as MessageKey, { name: detail.name })}<span className="block">{t("avatarStyle.hint" as MessageKey)}</span></>}
          sample={<AvatarStylePicker value={shownStyle} allowInherit inherited={getAppAvatarStyle()} onChange={(next) => setTheme(JSON.stringify(next) === JSON.stringify(storedStyle) ? undefined : next)} />} />
        {localStyle && <SettingsGroup agents="none" source="host"><div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted" data-avatar-style-local-draft>
          <span>{t("avatarStyle.localDraft" as MessageKey)}: <AvatarStyleLabel style={localStyle} /></span>
          <Button disabled={savingLocalStyle || theme !== undefined} onClick={() => {
            setSavingLocalStyle(true); setLocalStyleError(null);
            void saveLocalProfileAvatarStyle(host, detail.id).catch((error) => setLocalStyleError(error instanceof Error ? error.message : String(error))).finally(() => setSavingLocalStyle(false));
          }}>{t("avatarStyle.saveToHost" as MessageKey)}</Button>
          {localStyleError && <span role="alert" className="text-danger">{localStyleError}</span>}
        </div></SettingsGroup>}
        <SettingRow source="host"
          agents="none" readOnly={!canProvider}
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
      {/* 本机 only while the host keeps none of this (older cutex); the title row has a fixed height, so the
          tag arriving once the host's Profile list loads moves nothing. */}
      <Section  title={t("settings.profileIa.picturesOpening" as MessageKey)}  hint={t((synced ? "settings.profileIa.hostProfile" : "settings.profileIa.localProfileDraft") as MessageKey, { name: detail.name })}>
        <SettingRow agents="none" source={synced ? "host" : "local"} label={t("settings.profile.picture")} info={t("settings.profile.picture.hint")}>
          <ProfileAvatar profile={previewProfile} size={32} badge picture={shownPicture} color={shownColor} />
          <Button onClick={onPicture}>{shownPicture ? t("settings.profile.picture.change") : t("settings.profile.picture.upload")}</Button>
          {shownPicture && <Button onClick={() => setPicture(stored ? null : undefined)}>{t("settings.profile.picture.remove")}</Button>}
        </SettingRow>
        <SettingRow agents="none" source={synced ? "host" : "local"} label={t("settings.profile.introPortrait")} hint={t("settings.profile.introPortrait.hint")}>
          {shownIntroPortrait && <img src={shownIntroPortrait} alt="" className="h-10 w-auto rounded-md border border-border bg-surface-2 object-contain" />}
          <Button onClick={onIntroPortrait}>{shownIntroPortrait ? t("settings.profile.introPortrait.change") : t("settings.profile.introPortrait.upload")}</Button>
          {shownIntroPortrait && <Button onClick={() => setIntro({ portrait: storedIntro.portrait ? null : undefined })}>{t("settings.profile.introPortrait.remove")}</Button>}
          {introError && (
            <span role="alert" className="text-xs text-danger">
              {t(`settings.profile.introPortrait.bad.${introError}`)}
            </span>
          )}
        </SettingRow>
        <SettingRow agents="none" source={synced ? "host" : "local"}
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
        <SettingRow agents="none" source={synced ? "host" : "local"} readOnly label={t("settings.profile.introPreview")}>
          <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-xl border border-border bg-surface-2/40 px-4 py-3 text-center">
            {introPortrait && <img src={introPortrait} alt="" className="max-h-24 w-auto object-contain" />}
            <p className="max-w-xs text-sm leading-relaxed text-muted">{introGreeting || "—"}</p>
          </div>
        </SettingRow>
      </Section>
    </>
  );
}
