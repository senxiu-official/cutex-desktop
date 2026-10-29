import { ProfileSessionSwitch } from "./ProfileSessionSwitch";
export { ProfileSessionSwitch } from "./ProfileSessionSwitch";
// Settings → Profiles → <profile> detail page (DESIGN §4.5), full width, top to bottom:
//   header (picture, name, kind, status · quota left, agents using it · default / ⋯ actions)
//   account · models/context · input images · quota · tools/permissions · local browser claim
//   · proxy · appearance (host, or local pictures on legacy hosts) · advanced (API-key only).
// Everything editable collects into one draft; a sticky bar saves it (cutex PATCH
// `/v2/profiles/{p}` + PUT `/quota-config`). Login / logout and model-catalog edits stay immediate.
// Writes apply to newly launched runtimes.
import { ProfileAccountBadge } from "../ProfileAccountBadge";
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Bot, Camera, KeyRound, MoreHorizontal } from "lucide-react";
import type { AgentTurnQuestions, CutexRefusal, ProfileDetail, ProfileItem, ProfileModelsView, ProfilePatch, QuotaConfigView, QuotaGauge } from "../../../../shared/ipc";
import { bridge } from "../../bridge";
import { useApp } from "../../store";
import { useI18n, type MessageKey } from "../../i18n";
import { ARMED_FORM_BUTTON, ARMED_FRAME, useArmed } from "../../lib/armedConfirm";
import { claudeAccountPatch, claudeAccountRowShown, storedClaudeAccount } from "../../lib/claudeAccounts";
import { openMenuFrom } from "../../lib/contextMenu";
import { PROFILE_FAMILY_FEATURE, refusalText } from "../../lib/profileCreate";

/** cutex: the per-profile `toolSchemaCompat` switch (off | strict). */
const PROFILE_TOOL_SCHEMA_COMPAT_FEATURE = "profile-tool-schema-compat";
import { defaultableState, fieldEditable, fieldOffered, headerPlan, isAcpKind, MAX_PLAN_LABEL_CHARS, planLabelPatch, planLabelReset, planLabelResettable, PROFILE_AGENT_FEATURES, PROFILE_FEATURES, profileKind, sessionsUsingProfile, type ProfileKind } from "../../lib/profileKind";
import { baseUrlState, urlRegion, validBaseUrl } from "../../lib/profilePresets";
import { privateChatgptProfile } from "../../lib/privateChatgptProfile";
import { useProfileLooksSynced } from "../../lib/profileLooks";
import { ProfileProviderSummary } from "./ProfileProviderSummary";
import { useUiPrefs } from "../../lib/prefs";
import { noteProfileAvatarStyleSaved, setProfileAvatarStyle, type AvatarStyle } from "../../lib/avatarStyle";
import { setProfileAvatar, useHostKey } from "../../lib/profileAvatar";
import { INTRO_PORTRAIT_TOO_LARGE, introPortraitProblem, prepareIntroPortrait, setIntroAppearance, type IntroDraft } from "../../lib/introAppearance";
import { headerExtras, profileKindLabel } from "../../lib/profileCards";
import { cachedProfile, loadProfileSnapshot, updateCachedProfile } from "../../lib/profileSnapshot";
import { useProfilePresets } from "../../lib/useProfilePresets";
import { formatBalance, gaugeShortLabel, latestObservedAt, observedClock, PROFILE_GENERIC_SWITCHES_FEATURE, QUOTA_DISPLAY_LABEL_FEATURE, QUOTA_UPDATED_EVENT, quotaDraftNeedsReader, quotaEventPlanChanged, quotaFill, quotaTextKey, resetsInCompact, usesQuotaReaders, withQuotaLabel, type QuotaView } from "../../lib/quota";
import { Avatar } from "../Avatar";
import { GaugeBar } from "../GaugeBar";
import { ProfileAvatar } from "../ProfileAvatar";
import { AccountRows } from "./AccountSection";
import { PROFILE_AUTO_PICK_FEATURE, providerTermsUrl } from "../../../../shared/profileAutoPick";
import { api as appApi } from "../../bridge";
import { Button, DefaultableToggleRow, HintAction, InfoTip, Loading, NumberField, SettingRow, Section, SettingsGroup, Segmented, TextInput, Toggle } from "./Form";
import { ClaudeAccountRow } from "./ProfileClaudeAccount";
import { ComponentNotice } from "../ComponentCard";
import { CLAUDE_RUNTIME_COMPONENT } from "../../lib/componentCard";
import { ModelList } from "./ProfileModels";
import { ProfileModelFields } from "./ProfileModelFields";
import { ProfileToolFields } from "./ProfileToolFields";
import { ClaudeCompactionRow } from "./ClaudeCompactionRow";
import { CLAUDE_COMPACTION_MODELS_FEATURE } from "../../../../shared/claudeCompaction";
import { ImageHistoryTrimRow } from "./ImageHistoryTrimRow";
import { IMAGE_HISTORY_TRIM_FEATURE, sameImageHistoryTrim } from "../../../../shared/imageHistoryTrim";
import { ProfileAppearance } from "./ProfileAppearance";
import { ProfilePictureCrop } from "./ProfilePictureCrop";
import { ProfileInUse } from "./ProfileInUse";
import type { DeleteProfileOptions } from "../../lib/profileRefs";
import { OfficialQuotaSection, QuotaConfigSection } from "./ProfileQuota";
import { useTargetApi, useTargetFeatures, useTargetHostId, useTargetLoadQuota, useTargetQuotas, useTargetSelect, useTargetSidebar } from "../../lib/targetHost";
import { BrowserProfileClaimMode, BrowserProfileTools } from "./ProfileBrowserTools";
import { ProfileProxy, ProfileProxySummary } from "./ProfileProxy";
import { ClaudeCodeSourceRows, ClaudeSkillsImportRow } from "./ProfileClaudeCode";
import { AcpRuntimeCard } from "../DshRuntimeCard";
import { ACP_RUNTIME_INFO } from "../../lib/acpRuntimes";
import { DshModelFields } from "./DshModelFields";
import { ProfileCredentialSection } from "./ProfileCredentialSection";
import { ProfileVariantsSection } from "./ProfileVariantsSection";
import { variantsOn } from "../../lib/profileVariants";
import { Tag } from "../../components/Tag";
import { cleanAppearanceChanges, ProfileAppearanceSyncError, useProfileLinkAppearance } from "../../lib/profileLinkAppearance";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function KindIcon({ kind, size = 13 }: { kind: ProfileKind; size?: number }) {
  const Icon = kind === "apiKey" ? KeyRound : kind === "claude" || isAcpKind(kind) ? Bot : BadgeCheck;
  return <Icon size={size} strokeWidth={1.75} className="shrink-0 text-subtle" />;
}

/** One quota gauge in the header: label, bar, what is left / used, reset countdown. */
function HeaderGauge({ gauge: g, view }: { gauge: QuotaGauge; view: QuotaView }) {
  const { t } = useI18n();
  const fill = quotaFill(g, view);
  const reset = resetsInCompact(g.resetAt);
  return (
    <span className={`flex min-w-0 items-center gap-2 tabular-nums ${g.stale ? "opacity-60" : ""}`} title={g.error ?? undefined}>
      <span className="shrink-0 text-subtle">{gaugeShortLabel(g)}</span>
      {g.kind === "balance" ? (
        <span className="text-foreground">{formatBalance(g.balance)}</span>
      ) : fill === null ? (
        <span className="text-muted">—</span>
      ) : (
        <>
          <GaugeBar ratio={fill} view={view} className="h-1.5 w-20" />
          <span className="shrink-0 text-foreground">{t(quotaTextKey(view), { percent: Math.round(fill * 100) })}</span>
          {reset && <span className="shrink-0 text-subtle">{t("composer.quota.resets", { in: reset })}</span>}
        </>
      )}
      {g.error && <span className="text-danger">!</span>}
    </span>
  );
}

const SHOWN_AGENTS = 5;

/** Header: who the profile is (picture, name, kind, status) and how it is doing (quota, agents). */
function Overview({ detail, livePlan, patch, set, picture, onPicture, isDefault, refusal, onChanged, onDuplicate, onDelete }: {
  detail: ProfileDetail;
  /** ChatGPT profiles: the signed-in account's plan (login view); older cutex let it win over the stored label (headerPlan). */
  livePlan: string | null;
  patch: ProfilePatch;
  set(p: ProfilePatch): void;
  /** Picture draft (see ProfileAppearance) and a click on the picture (→ choose a file). */
  picture: string | null | undefined;
  onPicture(): void;
  isDefault: boolean;
  refusal: CutexRefusal | null;
  onChanged(): void;
  onDuplicate(): void;
  onDelete(options?: DeleteProfileOptions): Promise<void>;
}) {
  const targetHost = useTargetHostId();
  const pictureSynced = useProfileLooksSynced(targetHost);
  const api = useTargetApi();
  const { t } = useI18n();
  const features = useTargetFeatures();
  const sidebar = useTargetSidebar();
  const select = useTargetSelect();
  const gauges = useTargetQuotas()[detail.name] ?? [];
  const view = useUiPrefs().quotaView;
  const presets = useProfilePresets();
  // 删除 arms the whole card first (lib/armedConfirm); the second click deletes.
  const [armed, setArmed] = useArmed(detail.name);
  const [deleting, setDeleting] = useState(false);
  const family = features.has(PROFILE_FAMILY_FEATURE) ? (detail.providerFamilyLabel ?? detail.providerFamily ?? null) : null;
  const plan = headerPlan(detail.planLabel, livePlan, features.has(PROFILE_FEATURES.planLabelOverride));
  const kind = profileKind(detail);
  const kindLabel = profileKindLabel(detail, t("agent-config.profile.preset.custom"), presets);
  const extras = headerExtras(kindLabel, plan, family);
  const agents = sessionsUsingProfile(sidebar?.active ?? [], detail);
  const renamable = detail.detail?.editable?.name === true;
  const observed = latestObservedAt(gauges);
  const needsCutex = t("agent-config.profile.needsCutex");
  const status =
    kind === "claude"
      ? { text: t("agent-config.profile.status.claude"), warn: false }
      : detail.credential?.source === "kimiAccount"
        ? { text: t(detail.credential.present ? "variants.credential.kimiSignedIn" : "variants.credential.kimiSignedOut"), warn: !detail.credential.present }
      : kind === "chatgpt"
        ? detail.authPresent
          ? { text: t("agent-config.profile.loggedIn"), warn: false }
          : { text: t("agent-config.profile.notLoggedIn"), warn: true }
        : detail.detail?.apiKeyPresent || patch.apiKey
          ? { text: t("settings.profile.keyReady"), warn: false }
          : { text: t("agent-config.profile.keyMissing"), warn: true };
  // Unsaved colour / provider show in the header right away.
  const color = patch.color !== undefined ? (patch.color ?? detail.appearance.effectiveColor ?? undefined) : undefined;
  const look = patch.providerCategory !== undefined ? { ...detail, appearance: { ...detail.appearance, providerCategory: patch.providerCategory, effectiveProviderCategory: patch.providerCategory } } : detail;
  const makeDefault = async () => {
    try {
      await api.patchSettings({ defaultProfile: detail.name });
      onChanged();
    } catch {
      /* the list keeps showing the old default */
    }
  };
  const canDelete = features.has(PROFILE_FEATURES.delete);
  const more = (el: HTMLElement) =>
    openMenuFrom(el, [
      { label: t("agent-config.profile.duplicate"), disabled: !features.has(PROFILE_FEATURES.duplicate), hint: features.has(PROFILE_FEATURES.duplicate) ? undefined : needsCutex, onSelect: onDuplicate },
      {
        label: t("agent-config.profile.delete"),
        danger: true,
        disabled: !canDelete || isDefault,
        hint: canDelete ? (isDefault ? t("agent-config.profile.deleteDefault") : undefined) : needsCutex,
        onSelect: () => setArmed(true),
      },
    ]);
  const confirmDelete = () => {
    setDeleting(true);
    void onDelete().finally(() => (setDeleting(false), setArmed(false)));
  };
  return (
    <section className={`mb-6 rounded-xl border ${armed ? ARMED_FRAME : "border-border bg-surface"}`}>
      {/* Narrow panel (r265 D6): the actions wrap under the name instead of squeezing it to 「ds-fina」. */}
      <div className="flex flex-wrap items-center gap-4 p-4">
        <SettingsGroup agents="none" source={pictureSynced ? "host" : "local"}>
        <button type="button" onClick={onPicture} title={t("settings.profile.picture.change")} className="group relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <ProfileAvatar profile={look} size={52} badge picture={picture} color={color} />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Camera size={18} strokeWidth={1.75} />
          </span>
        </button>
        </SettingsGroup>
        <div className="min-w-[11rem] flex-1">
          <SettingsGroup agents="none" source="host" readOnly={!renamable}>
          <div className="flex min-w-0 items-center gap-2">
            {renamable ? (
              <input
                value={patch.name ?? detail.name}
                onChange={(e) => set({ name: e.target.value })}
                title={t("settings.profile.rename")}
                className="-ml-1 min-w-0 rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold outline-none [field-sizing:content] hover:border-border focus:border-accent"
              />
            ) : (
              <h3 className="truncate text-lg font-semibold" title={t("agent-config.profile.renameNeedsCutex")}>{detail.name}</h3>
            )}
            {isDefault && <Tag tone="accent">{t("agent-config.profile.default")}</Tag>}
          </div>
          </SettingsGroup>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-subtle">
            <KindIcon kind={kind} size={12} />
            <span>{kindLabel}</span>
            {extras.plan && <span>· {extras.plan}</span>}
            {extras.family && <span title={t("settings.profile.familyHint")}>· {extras.family}</span>}
            <span className={status.warn ? "text-warn" : undefined}>· {status.warn ? "⚠ " : ""}{status.text}</span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 self-start">
          {armed ? (
            <>
              <span className="text-xs text-danger">{t("agent-config.profile.deleteArmed")}</span>
              <button disabled={deleting} onClick={confirmDelete} className={ARMED_FORM_BUTTON}>
                {t("agent-config.profile.delete")}
              </button>
            </>
          ) : (
            <>
              {!isDefault && <SettingsGroup agents="newAgents" source="host"><Button onClick={() => void makeDefault()}>{t("agent-config.profile.makeDefault")}</Button></SettingsGroup>}
              <button title={t("agent-config.profile.more")} onClick={(e) => more(e.currentTarget)} className="rounded-md border border-border p-1 hover:bg-surface-2">
                <MoreHorizontal size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 border-t border-border px-4 py-3 text-xs">
        <span className="text-subtle">{t("settings.profile.quota")}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1.5">
          {gauges.length ? gauges.map((g) => <HeaderGauge key={g.id} gauge={g} view={view} />) : <span className="text-subtle">—</span>}
          {/* 同一账号 · X 也在用 (042 profile-link): here and on 用量, not in the composer. */}
          <ProfileAccountBadge hostId={targetHost} profile={detail} />
          {observed !== null && <span className="ml-auto text-subtle">{t("composer.quota.observedAt", { at: observedClock(observed) })}</span>}
        </div>
        <span className="text-subtle">{t("settings.profile.inUse")}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {agents.length === 0 && <span className="text-subtle">{t("settings.profile.inUseNone")}</span>}
          {agents.slice(0, SHOWN_AGENTS).map((a) => (
            <button key={a.cutexSessionId} onClick={() => void select(a.cutexSessionId)} className="flex max-w-40 items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-2 pl-0.5 hover:text-accent">
              <Avatar name={a.displayName} avatar={a.avatar} seed={a.cutexSessionId} color={color ?? detail.appearance.effectiveColor} size={20} minor />
              <span className="truncate">{a.displayName}</span>
            </button>
          ))}
          {agents.length > SHOWN_AGENTS && (
            <button
              onClick={(e) => openMenuFrom(e.currentTarget, agents.slice(SHOWN_AGENTS).map((a) => ({ label: a.displayName, onSelect: () => void select(a.cutexSessionId) })))}
              className="rounded-full px-1.5 py-0.5 text-muted hover:bg-surface-2 hover:text-foreground"
            >
              +{agents.length - SHOWN_AGENTS}
            </button>
          )}
        </div>
        <ProfileProxySummary detail={detail} />
      </div>
      {refusal && (
        <div className="border-t border-border px-4 py-3 text-xs">
          {refusal.code === "profile_in_use" ? <ProfileInUse refusal={refusal} color={color ?? detail.appearance.effectiveColor} profile={detail.name} onDeleteProfile={onDelete} /> : <p className="text-danger">{refusalText(refusal, t)}</p>}
        </div>
      )}
    </section>
  );
}

/**
 * 行为 rows from cutex's agent-tool security work, each shown only when this cutex has it:
 * native subagents (Codex), "agents need my approval to use it", delegation_wait (default Codex
 * on, Claude off), and for Claude profiles the write / exec rules, file checkpoints and what
 * AskUserQuestion does in agent-started turns. Options with a cutex default are one switch (the
 * effective value) + ↺ back to the default (DefaultableToggleRow).
 */
function AgentBehaviourRows({ detail, kind, patch, set, timing }: { detail: ProfileDetail; kind: ProfileKind; patch: ProfilePatch; set(p: ProfilePatch): void; timing: "next" | "now" }) {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const onOff = (v: boolean) => (v ? t("agent-config.profile.on") : t("agent-config.profile.off"));
  const resetTitle = (def: boolean) => t("agent-config.profile.resetDefault", { def: onOff(def) });
  const subagents = !isAcpKind(kind) && kind !== "claude" && (features.has(PROFILE_AGENT_FEATURES.nativeSubagents) || detail.detail?.nativeSubagentsExplicit !== undefined);
  const subDefault = detail.detail?.nativeSubagentsDefault ?? true;
  const sub = defaultableState(patch.nativeSubagents, detail.detail?.nativeSubagentsExplicit, subDefault);
  const approval = features.has(PROFILE_AGENT_FEATURES.agentApproval) || detail.agentUseRequiresApproval !== undefined;
  // profile-auto-pick (design 041): owner opt-in per account, off by default; the terms line always shows.
  const autoPick = features.has(PROFILE_AUTO_PICK_FEATURE) && detail.autoPick !== undefined;
  const termsUrl = providerTermsUrl(detail.providerFamily);
  const delegation = features.has(PROFILE_AGENT_FEATURES.delegationTools);
  const waitDefault = detail.detail?.delegationWaitDefault ?? kind !== "claude";
  const wait = defaultableState(patch.delegationWait, detail.detail?.delegationWaitExplicit, waitDefault);
  const questionsStored = detail.agentTurnQuestions ?? detail.detail?.agentTurnQuestions;
  const claudeTools = kind === "claude" && detail.claudeAllowWrite != null;
  const checkpoints = kind === "claude" && detail.detail?.claudeFileCheckpointingExplicit !== undefined;
  const checkpointsDefault = detail.detail?.claudeFileCheckpointingDefault ?? false;
  const questions = kind === "claude" && (questionsStored !== undefined || "agentTurnQuestions" in (detail.detail?.editable ?? {}));
  return (
    <>
      {timing === "next" && subagents && (
        <DefaultableToggleRow
           label={t("agent-config.profile.nativeSubagents")}
          hint={t("agent-config.profile.nativeSubagentsHint")}
          {...sub}
          disabled={!fieldEditable(detail, "nativeSubagents")}
          resetTitle={resetTitle(subDefault)}
          onChange={(v) => set({ nativeSubagents: v })}
          onReset={() => set({ nativeSubagents: null })}
         source="host" agents="next"/>
      )}
      {timing === "now" && delegation && (
        <DefaultableToggleRow
           label={<span title="delegation_wait">{t("agent-config.profile.delegationWait")}</span>}
          hint={<>{t("agent-config.profile.delegationWaitHint")}<span className="block">{t("settings.profileTiming.delegation" as MessageKey)}</span></>}
          {...wait}
          disabled={!fieldEditable(detail, "delegationWait")}
          resetTitle={resetTitle(waitDefault)}
          onChange={(v) => set({ delegationWait: v })}
          onReset={() => set({ delegationWait: null })}
         source="host" agents="now"/>
      )}
      {timing === "now" && approval && (
        <SettingRow source="host" agents="now" label={t("agent-config.profile.agentApproval")} info={t("agent-config.profile.agentApprovalHint")}>
          <Toggle
            checked={patch.agentUseRequiresApproval ?? detail.agentUseRequiresApproval ?? false}
            disabled={!fieldEditable(detail, "agentUseRequiresApproval")}
            onChange={(v) => set({ agentUseRequiresApproval: v })}
          />
        </SettingRow>
      )}
      {timing === "now" && autoPick && (
        <SettingRow source="host" agents="newAgents" label={<>{t("autoPick.setting")}<InfoTip>{t("autoPick.settingHint")}</InfoTip></>}
          hint={<span data-testid="auto-pick-terms">{t("autoPick.terms")}{termsUrl && <> · <button type="button" className="underline hover:text-foreground" title={termsUrl} onClick={() => void appApi.openExternal(termsUrl)}>{t("autoPick.termsLink")}</button></>}</span>}>
          <Toggle label={t("autoPick.setting")} checked={patch.autoPick ?? detail.autoPick ?? false} onChange={(v) => set({ autoPick: v })} />
        </SettingRow>
      )}
      {timing === "next" && claudeTools &&
        (["Write", "Exec"] as const).map((rule) => {
          const key = rule === "Write" ? "claudeAllowWrite" : "claudeAllowExec";
          const label = t(rule === "Write" ? "agent-config.profile.claudeWrite" : "agent-config.profile.claudeExec");
          const explicit = detail.detail[`claudeAllow${rule}Explicit`];
          // claude-tool-defaults: switch + ↺ (unset = on); older cutex: a plain switch (stored value).
          if (explicit === undefined)
            return (
              <SettingRow source="host" agents="next" key={rule} label={label} hint={t("agent-config.profile.claudeToolsHint")}>
                <Toggle checked={(patch[key] ?? detail[key]) === true} disabled={!fieldEditable(detail, "claudeTools")} onChange={(v) => set({ [key]: v })} />
              </SettingRow>
            );
          const def = detail.detail[`claudeAllow${rule}Default`] ?? true;
          return (
            <DefaultableToggleRow
              key={rule}

              label={label}
              hint={t("agent-config.profile.claudeToolsFollowHint")}
              {...defaultableState(patch[key], explicit, def)}
              disabled={!fieldEditable(detail, "claudeTools")}
              resetTitle={resetTitle(def)}
              onChange={(v) => set({ [key]: v })}
              onReset={() => set({ [key]: null })}
             source="host" agents="next"/>
          );
        })}
      {timing === "next" && checkpoints && (
        <DefaultableToggleRow
           label={t("agent-config.profile.claudeFileCheckpointing")}
          hint={t("agent-config.profile.claudeFileCheckpointingHint")}
          {...defaultableState(patch.claudeFileCheckpointing, detail.detail?.claudeFileCheckpointingExplicit, checkpointsDefault)}
          disabled={!fieldEditable(detail, "claudeFileCheckpointing")}
          resetTitle={resetTitle(checkpointsDefault)}
          onChange={(v) => set({ claudeFileCheckpointing: v })}
          onReset={() => set({ claudeFileCheckpointing: null })}
         source="host" agents="next"/>
      )}
      {timing === "next" && questions && (
        <SettingRow source="host" agents="next" label={t("agent-config.profile.agentTurnQuestions")} hint={t("agent-config.profile.agentTurnQuestionsHint")}>
          <Segmented<AgentTurnQuestions>
            value={patch.agentTurnQuestions ?? questionsStored ?? "decide"}
            disabled={!fieldEditable(detail, "agentTurnQuestions")}
            options={[
              { value: "decide", label: t("agent-config.profile.agentTurnQuestions.decide") },
              { value: "wait", label: t("agent-config.profile.agentTurnQuestions.wait") },
            ]}
            onChange={(v) => set({ agentTurnQuestions: v })}
          />
        </SettingRow>
      )}
    </>
  );
}

export function ProfileEditor({ profile, item, isDefault, refusal, onChanged, onDuplicate, onDelete, onCreateProvider }: {
  profile: string;
  item: ProfileItem;
  isDefault: boolean;
  /** Why cutex refused the last delete of this profile (shown in the overview card). */
  refusal: CutexRefusal | null;
  /** `renamed`: the new name after a rename (PATCH `{name}`), so the page keeps it selected. */
  onChanged(renamed?: string): void;
  onDuplicate(): void;
  onDelete(options?: DeleteProfileOptions): Promise<void>;
  onCreateProvider?(id: string): void;
}) {
  const api = useTargetApi();
  const { t } = useI18n();
  const loadQuota = useTargetLoadQuota();
  const features = useTargetFeatures();
  const presets = useProfilePresets();
  // Keyed by profile (remounts per profile). Starts from the cached snapshot when there is one and
  // otherwise waits for detail + models + account together, so the page paints once.
  const targetHost = useTargetHostId();
  const [syncAppearance, setSyncAppearance] = useState(true);
  const [cached] = useState(() => cachedProfile(profile, targetHost));
  const [detail, setDetailState] = useState<ProfileDetail | null>(cached?.detail ?? null);
  const [models, setModelsState] = useState<ProfileModelsView | null>(cached?.models ?? null);
  const [ready, setReady] = useState(cached !== null);
  const [quota, setQuota] = useState<QuotaConfigView | null>(cached?.quota ?? null);
  const [quotaDraft, setQuotaDraft] = useState<QuotaConfigView | null>(cached?.quota ?? null);
  const [account, setAccount] = useState(cached?.account);
  const setDetail = (d: ProfileDetail) => (setDetailState(d), updateCachedProfile(profile, { detail: d }, targetHost));
  const setModels = (m: ProfileModelsView | null) => (setModelsState(m), updateCachedProfile(profile, { models: m }, targetHost));
  const [patch, setPatch] = useState<ProfilePatch>({});
  /** Picture draft: undefined = unchanged, null = remove (stays on this device; lib/profileAvatar). */
  const [picture, setPicture] = useState<string | null | undefined>(undefined);
  const pictureFile = useRef<HTMLInputElement>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  /** Opening draft (portrait + greeting, lib/introAppearance): saved with the sticky bar like the picture. */
  const [intro, setIntroState] = useState<IntroDraft>({ portrait: undefined, greeting: undefined });
  const [introError, setIntroError] = useState<"type" | "tooLarge" | "bad" | "full" | null>(null);
  /** Full avatar style: undefined unchanged, null inherit app; saved locally with the sticky bar. */
  const [avatarTheme, setAvatarTheme] = useState<AvatarStyle | null | undefined>(undefined);
  const introFile = useRef<HTMLInputElement>(null);
  /** Picture drafts save under the focus host's daemon key (lib/profileAvatar); the opening under the edited host (targetHost). */
  const host = useHostKey();
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The last save failed with a Claude account in the draft (shown under the 账户 select too). */
  const [accountError, setAccountError] = useState<string | null>(null);
  const kind = profileKind(item);
  /** cutex profile-runtime-variants reported on this host and this profile. */
  const variants = variantsOn(features) && !!detail?.runtimeVariants?.length;
  const linkedAppearance = useProfileLinkAppearance(targetHost, detail ?? item);
  const hasAppearanceDraft = Object.keys(patch).length > 0 || picture !== undefined || avatarTheme !== undefined || intro.portrait !== undefined || intro.greeting !== undefined || JSON.stringify(quotaDraft) !== JSON.stringify(quota);
  useEffect(() => {
    if (linkedAppearance.notice?.kind !== "synced" || saving || hasAppearanceDraft) return;
    let live = true;
    void api.getProfile(profile).then((next) => {
      if (!live) return;
      setDetailState(next);
      updateCachedProfile(profile, { detail: next }, targetHost);
    }, () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedAppearance.notice?.id, saving, hasAppearanceDraft, profile, targetHost]);

  const reloadDetail = () => api.getProfile(profile).then(setDetail, (e: unknown) => setError(errorText(e)));
  /** 服务与凭证 / 运行时变体 changed something at once: show cutex's answer, and let the list follow. */
  const afterVariantChange = (next?: ProfileDetail) => {
    if (next) setDetail(next);
    void (next ? Promise.resolve() : reloadDetail()).then(() => onChanged());
  };
  useEffect(() => {
    let live = true;
    loadProfileSnapshot(item, targetHost).then(
      (snap) => {
        if (!live) return;
        setDetailState(snap.detail);
        setModelsState(snap.models);
        setAccount(snap.account);
        // A background refresh must not clobber an unsaved quota edit.
        setQuotaDraft((draft) => (draft === null || JSON.stringify(draft) === JSON.stringify(quota) ? snap.quota : draft));
        setQuota(snap.quota);
        setReady(true);
      },
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);
  // cutex observed a different account plan (quota event `planChanged`): re-read the label and the login's plan.
  useEffect(
    () =>
      bridge.on("hostEvent", ({ hostId, envelope }) => {
        if (envelope.cutex?.method !== QUOTA_UPDATED_EVENT || hostId !== targetHost) return;
        const named = quotaEventPlanChanged(envelope.cutex.params);
        if (!named.includes(profile) && !named.includes(item.id)) return;
        void reloadDetail();
        if (kind === "chatgpt") api.profileAccount(profile).then((a) => (setAccount(a), updateCachedProfile(profile, { account: a }, targetHost)), () => {});
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile],
  );

  if (error && !detail) return <p className="text-sm text-danger">{error}</p>;
  if (!detail || !ready)
    return (
      <Section>
        <Loading rows={4} />
      </Section>
    );
  // Claude profiles have no Codex config: their default model / effort are the item's own values
  // (claude-profile-default-model; ProfileModelFields).
  const baseConfig = detail.detail?.config ?? (kind === "claude" ? { model: detail.model, modelReasoningEffort: detail.modelReasoningEffort } : {});
  const cfg = { ...baseConfig, ...patch } as ProfileDetail["detail"]["config"];
  const set = (p: ProfilePatch) => {
    setStatus(null);
    setPatch((prev) => ({ ...prev, ...p }));
  };
  /** Sets one draft field, or drops it when it is back at the saved value (nothing to save). */
  const setOrDrop = <K extends keyof ProfilePatch>(key: K, value: ProfilePatch[K], stored: ProfilePatch[K] | undefined) => {
    setStatus(null);
    setPatch((prev) => {
      const next = { ...prev };
      if (value === stored) delete next[key];
      else next[key] = value;
      return next;
    });
  };
  /** API-key profiles: the saved Base URL (the profile's config, else the list item's). */
  const storedUrl = detail.detail?.config?.providerBaseUrl ?? detail.baseUrl ?? null;
  const quotaDirty = quotaDraft !== null && JSON.stringify(quotaDraft) !== JSON.stringify(quota);
  const dirty = Object.keys(patch).some((k) => (k === "apiKey" ? !!patch.apiKey : true)) || quotaDirty || picture !== undefined || intro.portrait !== undefined || intro.greeting !== undefined || avatarTheme !== undefined;
  /** Sets one part of the opening draft (empty patch parts keep their previous value); any new
   *  draft action clears the old picker / save error, removing a portrait included. */
  const setIntro = (patchIntro: Partial<IntroDraft>) => {
    setStatus(null);
    setIntroError(null);
    setIntroState((prev) => ({ ...prev, ...patchIntro }));
  };
  /** Claude account: kept in the draft only when it differs from the stored binding. */
  const chooseClaudeAccount = (choice: string) => {
    setStatus(null);
    setAccountError(null);
    const value = claudeAccountPatch(choice, storedClaudeAccount(detail));
    setPatch((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next.claudeAccount;
      else next.claudeAccount = value;
      return next;
    });
  };
  const save = async () => {
    const body: ProfilePatch = { ...patch };
    if (avatarTheme !== undefined && features.has("profile-avatar-style")) body.avatarStyle = avatarTheme;
    // API-key profiles always need a usable endpoint (an emptied field would drop the profile's URL).
    if ("providerBaseUrl" in body) {
      const url = body.providerBaseUrl?.trim() ?? "";
      if (!url) return setError(t("agent-config.profile.error.baseUrlMissing"));
      if (!validBaseUrl(url)) return setError(t("agent-config.profiles.new.error.baseUrlInvalid"));
      if (url === storedUrl) delete body.providerBaseUrl;
      else body.providerBaseUrl = url;
    }
    // profile-generic-switches: cutex refuses the legacy `auto`; the 额度 section asks for a reader.
    if (quotaDirty && quotaDraftNeedsReader(quotaDraft, usesQuotaReaders(quotaDraft, features.has(PROFILE_GENERIC_SWITCHES_FEATURE)))) return setError(t("agent-config.quota.legacyAuto"));
    const changedLooks = cleanAppearanceChanges({ ...body,
      ...(picture !== undefined ? { avatar: picture } : {}),
      ...(avatarTheme !== undefined && features.has("profile-avatar-style") ? { avatarStyle: avatarTheme } : {}),
      ...(intro.portrait !== undefined ? { introPortrait: intro.portrait } : {}),
      ...(intro.greeting !== undefined ? { introGreeting: intro.greeting } : {}),
    });
    const syncLooks = linkedAppearance.linked && Object.keys(changedLooks).length > 0;
    const finishAppearanceEdit = syncLooks ? linkedAppearance.beginEdit() : () => {};
    setSaving(true);
    setError(null);
    setAccountError(null);
    try {
      if (!body.apiKey) delete body.apiKey;
      if ("planLabel" in body) {
        const label = planLabelPatch(body.planLabel, detail.detail?.planLabelManual);
        if (label === undefined) delete body.planLabel;
        else body.planLabel = label;
      }
      if (body.name !== undefined) {
        body.name = body.name.trim();
        if (!body.name || body.name === detail.name) delete body.name;
      }
      // A rename moves the profile: later calls use the name cutex answered with.
      let name = profile;
      if (Object.keys(body).length) {
        const next = await api.patchProfile(profile, body);
        if ("avatarStyle" in body) noteProfileAvatarStyleSaved(targetHost, next);
        setDetail(next);
        name = next.name;
      }
      if (quotaDirty && quotaDraft) {
        // An empty 标签 is saved as the window name (7d) or "Q" (lib/quota.ts withQuotaLabel).
        const displayLabels = features.has(QUOTA_DISPLAY_LABEL_FEATURE);
        const next = await api.putQuotaConfig(name, { preset: quotaDraft.preset, primary: withQuotaLabel(quotaDraft.primary, displayLabels), extras: quotaDraft.extras.map((r) => withQuotaLabel(r, displayLabels)) });
        setQuota(next);
        setQuotaDraft(next);
        void loadQuota(name, true);
      } else if ("providerBaseUrl" in body && kind === "apiKey") {
        // cutex re-resolves the automatic quota reader for the new host right away: show its answer
        // (`presetError` when the host has none) and fresh gauges, not the old endpoint's.
        const next = await api.quotaConfig(name).catch(() => null);
        if (next) (setQuota(next), setQuotaDraft(next), updateCachedProfile(name, { quota: next }, targetHost));
        void loadQuota(name, true);
      }
      if (picture !== undefined) setProfileAvatar(host, detail.id, picture);
      setPicture(undefined);
      if (avatarTheme !== undefined && !features.has("profile-avatar-style")) setProfileAvatarStyle(targetHost, detail.id, avatarTheme);
      setAvatarTheme(undefined);
      if (intro.portrait !== undefined || intro.greeting !== undefined) {
        // The opening is keyed by the edited host (targetHost), like the timeline outlet reads it.
        // A refused write (store full / quota) keeps the draft and shows the failure; the daemon
        // parts of this save above are already in — clear their drafts and let a rename propagate.
        const saved = setIntroAppearance(targetHost, detail.id, {
          ...(intro.portrait !== undefined ? { portrait: intro.portrait } : {}),
          ...(intro.greeting !== undefined ? { greeting: intro.greeting } : {}),
        });
        if (!saved) {
          setIntroError("full");
          setStatus(null);
          setPatch({});
          if (name !== profile) onChanged(name);
          setSaving(false);
          return;
        }
      }
      if (syncLooks) await linkedAppearance.saved(changedLooks, syncAppearance);
      setIntroState({ portrait: undefined, greeting: undefined });
      setPatch({});
      setStatus(t("agent-config.profile.savedNext"));
      if (name === profile) api.profileModels(profile).then(setModels, () => {});
      onChanged(name !== profile ? name : undefined);
    } catch (e) {
      setError(e instanceof ProfileAppearanceSyncError ? t(`settings.profile.link.appearance.${e.kind}`) : errorText(e));
      // PATCH is all-or-nothing: the account was not saved either; say so next to the select.
      if ("claudeAccount" in body) setAccountError(errorText(e));
    } finally {
      finishAppearanceEdit();
      setSaving(false);
    }
  };
  const revert = () => {
    setAccountError(null);
    setPatch({});
    setPicture(undefined);
    setAvatarTheme(undefined);
    setIntroState({ portrait: undefined, greeting: undefined });
    setIntroError(null);
    setQuotaDraft(quota);
  };
  // Base URL: official or custom by the URL's host (lib/profilePresets), never by the provider's name —
  // a provider called "GLM" on a third-party relay is custom. Always editable (cutex: `providerOptions`).
  const draftUrl = patch.providerBaseUrl !== undefined ? (patch.providerBaseUrl ?? "") : (storedUrl ?? "");
  const url = baseUrlState(draftUrl, presets, { stored: storedUrl, family: detail.providerFamily });
  const urlEditable = fieldEditable(detail, "providerOptions") && fieldEditable(detail, "providerBaseUrl");
  const urlPreset = url.preset ? [url.preset.label, urlRegion(draftUrl) && t(`agent-config.profile.region.${urlRegion(draftUrl)!}`)].filter(Boolean).join(" · ") : "";
  const urlHint = url.official
    ? url.restore
      ? t("agent-config.profile.baseUrlOfficialOther", { preset: url.preset!.label, url: url.restore })
      : t("agent-config.profile.baseUrlOfficial", { preset: urlPreset })
    : url.preset && url.restore
      ? draftUrl.trim()
        ? t("agent-config.profile.baseUrlCustomWas", { preset: url.preset.label, url: url.restore })
        : t("agent-config.profile.baseUrlOfficialOther", { preset: url.preset.label, url: url.restore })
      : t("agent-config.profile.baseUrlCustom");
  const livePlan = kind === "chatgpt" && account?.account.loggedIn ? (account.account.planType ?? null) : null;
  // A stored plan label (API key: e.g. "GLM Pro"; ChatGPT: overrides the account's plan with
  // profile-plan-label-override, older cutex: used only while signed out; Claude: the label only, with
  // profile-plan-label-claude — older cutex refuses it there).
  const planLabelRow =
    !isAcpKind(kind) && features.has(PROFILE_FEATURES.planLabel) && (kind !== "claude" || features.has(PROFILE_FEATURES.planLabelClaude));
  const privateAuth = privateChatgptProfile(detail, patch, presets);
  const privateAuthRow = !isAcpKind(kind) && kind !== "claude" && features.has(PROFILE_GENERIC_SWITCHES_FEATURE) && fieldOffered(detail, "privateChatgptAuthFile") && privateAuth.visible;
  const schemaCompatRow = !isAcpKind(kind) && kind !== "claude" && features.has(PROFILE_TOOL_SCHEMA_COMPAT_FEATURE) && fieldOffered(detail, "toolSchemaCompat");
  const storedSchemaCompat = detail.toolSchemaCompat === "strict" ? "strict" : null;
  const imageTrimRow = !isAcpKind(kind) && kind !== "claude" && features.has(IMAGE_HISTORY_TRIM_FEATURE) && fieldOffered(detail, "imageHistoryTrim");
  const storedLabel = detail.detail?.planLabelManual ?? null;
  // 恢复默认 drops the manual label: ChatGPT then shows the account's plan (manual > live plan > legacy), API key none.
  const planDefault =
    kind === "chatgpt"
      ? livePlan
        ? t("agent-config.profile.planLabelDefault", { plan: livePlan })
        : t("agent-config.profile.planLabelDefaultAccount")
      : t("agent-config.profile.planLabelDefaultNone");
  const resetPlanLabel = () => setOrDrop("planLabel", planLabelReset(storedLabel), undefined);

  return (
    <div className="pb-2">
      <input
        ref={pictureFile}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) setCropFile(f);
        }}
      />
      {cropFile && <ProfilePictureCrop file={cropFile} onCancel={() => setCropFile(null)} onConfirm={(p) => { setStatus(null); setPicture(p); setCropFile(null); }} />}
      {/* The opening portrait: no cropper — the longest edge is scaled to ≤ 1024 px (lib/introAppearance). */}
      <input
        ref={introFile}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const problem = introPortraitProblem(f);
          if (problem) {
            setIntroError(problem);
            return;
          }
          setIntroError(null);
          prepareIntroPortrait(f).then(
            (url) => setIntro({ portrait: url }),
            (e: unknown) => setIntroError(e instanceof Error && e.message === INTRO_PORTRAIT_TOO_LARGE ? "tooLarge" : "bad"),
          );
        }}
      />
      {kind === "claude" && <ComponentNotice name={CLAUDE_RUNTIME_COMPONENT} hostId={targetHost} className="mb-3" />}
      {isAcpKind(kind) && features.has(ACP_RUNTIME_INFO[kind].capability) && <AcpRuntimeCard runtime={kind} hostId={targetHost} />}
      <Overview
        detail={detail}
        livePlan={livePlan}
        patch={patch}
        set={set}
        picture={picture}
        onPicture={() => pictureFile.current?.click()}
        isDefault={isDefault}
        refusal={refusal}
        onChanged={() => onChanged()}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />
      {/* profile-runtime-variants (docs/design/042): the one credential and the runtime variants; older hosts: the rows below. */}
      {variants && (
        <>
          <ProfileCredentialSection detail={detail} onChanged={afterVariantChange} />
          <ProfileVariantsSection detail={detail} onChanged={afterVariantChange} />
        </>
      )}

      <div id="profile-account">
      {kind === "apiKey" && <Section   title={t("settings.provider.picker" as MessageKey)}>
        <ProfileProviderSummary detail={detail} presets={presets} disabled={saving} onCreateProvider={onCreateProvider} />
      </Section>}

        <Section   title={t("agent-config.profile.account")} hint={<>{t("settings.profileIa.hostProfile" as MessageKey, { name: detail.name })}{kind === "chatgpt" && <span className="block">{t("account.hint")}</span>}</>}>
          {kind === "dsh" && !variants && <SettingRow source="host" agents="next" readOnly label={detail.options?.dsh?.apiKeyEnv ?? "DEEPSEEK_API_KEY"} hint={t("dsh.credentials", { env: detail.options?.dsh?.apiKeyEnv ?? "DEEPSEEK_API_KEY" })}><span className="text-xs text-subtle">{t("dsh.hostEnvironment")}</span></SettingRow>}
          {kind === "chatgpt" && (
            <AccountRows
              profile={profile}
              initial={account}
              onChanged={() => {
                // AccountRows has put its fresh view in the snapshot cache: the header's plan follows it.
                setAccount(cachedProfile(profile, targetHost)?.account);
                void reloadDetail().then(() => onChanged());
              }}
            />
          )}
          {/* claude-accounts: the account replaces "the CLI's own login" (each account has its own; older cutex: as before). */}
          {claudeAccountRowShown(features, kind) ? (
            <ClaudeAccountRow detail={detail} patch={patch} onChoose={chooseClaudeAccount} saveError={accountError} />
          ) : (
            kind === "claude" && (
              <SettingRow agents="none" source="host" readOnly label={t("agent-config.profile.login")}>
                <span className="text-xs text-subtle">{t("agent-config.profile.claudeLogin")}</span>
              </SettingRow>
            )
          )}
          {kind === "apiKey" && (
            <>
              <SettingRow source="host" agents="none" readOnly label={t("settings.provider.auth" as MessageKey)} hint={t("settings.provider.authHint" as MessageKey)}>
                <span className="text-xs text-muted">{t("settings.provider.authKey" as MessageKey)}</span>
              </SettingRow>
              {/* With variants the key is set / replaced in 服务与凭证 (write-only, at once). */}
              {!variants && <SettingRow source="host" agents="next" label="API key" hint={detail.detail?.apiKeyPresent ? t("agent-config.profile.keySetHint") : t("agent-config.profile.keyMissing")}>
                <TextInput mono width="w-64" type="password" value={patch.apiKey ?? ""} placeholder={detail.detail?.apiKeyPresent ? "••••••••" : "sk-…"} onChange={(v) => set({ apiKey: v })} />
              </SettingRow>}
              <SettingRow source="host"
                agents="next" label="Base URL"
                hint={
                  <>
                    {urlHint}
                    {url.restore && urlEditable && (
                      <HintAction title={url.restore} onClick={() => setOrDrop("providerBaseUrl", url.restore, storedUrl)}>
                        {t("agent-config.profile.restoreOfficial")}
                      </HintAction>
                    )}
                  </>
                }
              >
                <TextInput
                  mono
                  width="w-80"
                  value={draftUrl}
                  disabled={!urlEditable}
                  placeholder={url.preset?.baseUrl ?? "https://example.com/v1"}
                  onChange={(v) => setOrDrop("providerBaseUrl", v, storedUrl ?? "")}
                />
              </SettingRow>
            </>
          )}
          {/* profile-generic-switches: Codex profiles only, when cutex offers the field. */}
          {privateAuthRow && (
            <SettingRow source="host" agents="next" label={t("agent-config.profile.privateChatgptAuthFile")} hint={privateAuth.warn ? t("settings.provider.privateAuthUnneeded" as MessageKey) : t("agent-config.profile.privateChatgptAuthFileHint")}>
              <Toggle checked={patch.privateChatgptAuthFile ?? detail.privateChatgptAuthFile ?? false} onChange={(v) => setOrDrop("privateChatgptAuthFile", v, detail.privateChatgptAuthFile ?? false)} />
            </SettingRow>
          )}
          {planLabelRow && (
            <SettingRow source="host"
              agents="none" readOnly={!fieldEditable(detail, "planLabel")} label={t("agent-config.profile.planLabel")}
              hint={
                kind === "chatgpt"
                  ? features.has(PROFILE_FEATURES.planLabelOverride)
                    ? livePlan
                      ? t("agent-config.profile.planLabelOverrideLive", { plan: livePlan })
                      : t("agent-config.profile.planLabelOverrideHint")
                    : livePlan
                      ? t("agent-config.profile.planLabelChatgptLive", { plan: livePlan })
                      : t("agent-config.profile.planLabelChatgptHint")
                  : kind === "claude"
                    ? t("agent-config.profile.planLabelClaudeHint")
                    : t("agent-config.profile.planLabelHint")
              }
            >
              {planLabelResettable(patch.planLabel, storedLabel) && (
                <Button title={t("agent-config.profile.planLabelResetTitle")} disabled={!fieldEditable(detail, "planLabel")} onClick={resetPlanLabel}>
                  {t("agent-config.profile.planLabelReset")}
                </Button>
              )}
              <TextInput
                width="w-48"
                maxLength={MAX_PLAN_LABEL_CHARS}
                value={patch.planLabel !== undefined ? (patch.planLabel ?? "") : (storedLabel ?? "")}
                placeholder={planDefault}
                disabled={!fieldEditable(detail, "planLabel")}
                onChange={(v) => set({ planLabel: v })}
              />
            </SettingRow>
          )}
        </Section>
      </div>

      <Section id="profile-models"   title={t("settings.profileIa.modelsContext" as MessageKey)} hint={t("settings.profileIa.hostProfile" as MessageKey, { name: detail.name })}>
        <h4 className="mt-2 text-xs font-medium text-muted">{t("settings.profileIa.profileDefaults" as MessageKey)}</h4>
        {/* A Kimi-kind Profile's default model / effort are its kimi variant's (运行时变体 above). */}
        {kind === "dsh" ? <DshModelFields detail={detail} patch={patch} set={set} /> : kind === "kimi" ? <p className="py-2 text-xs text-subtle">{t("variants.kimiDefaultsAbove")}</p> : <ProfileModelFields detail={detail} models={models} cfg={cfg} set={set} />}
        <ClaudeCompactionRow
          detail={detail}
          draft={patch.claudeCompaction}
          change={(v) => {
            const stored = detail.claudeCompaction ?? null;
            setOrDrop("claudeCompaction", v === undefined || JSON.stringify(v) === JSON.stringify(stored) ? stored : v, stored);
          }}
        />
        {!isAcpKind(kind) && models && (
          <ModelList
            profile={profile}
            view={models}
            setView={setModels}
            compaction={
              kind === "claude" && features.has(CLAUDE_COMPACTION_MODELS_FEATURE) && detail.claudeCompactionModels !== undefined
                ? {
                    table: detail.claudeCompactionModels ?? null,
                    draft: patch.claudeCompactionModels,
                    profile: patch.claudeCompaction !== undefined ? patch.claudeCompaction : (detail.claudeCompaction ?? null),
                    error: detail.detail?.claudeCompactionModelsError,
                    disabled: !fieldEditable(detail, "claudeCompactionModels"),
                    change: (v) => {
                      const stored = detail.claudeCompactionModels ?? null;
                      setOrDrop("claudeCompactionModels", v === undefined ? stored : v, stored);
                    },
                  }
                : undefined
            }
          />
        )}
      </Section>

      {imageTrimRow && (
        <Section id="profile-images"   title={t("settings.profileIa.inputImages" as MessageKey)} hint={t("settings.profileIa.hostProfile" as MessageKey, { name: detail.name })}>
          <ImageHistoryTrimRow
            detail={detail}
            draft={patch.imageHistoryTrim}
            change={(v) => {
              const stored = detail.imageHistoryTrim ?? null;
              setOrDrop("imageHistoryTrim", v === undefined || sameImageHistoryTrim(v, stored) ? stored : v, stored);
            }}
          />
          <p className="mt-2 text-xs text-subtle">{t("settings.profileIa.inputImagesHint" as MessageKey)}</p>
          <Button onClick={() => useApp.getState().openSettings("conversation", { anchor: "display" })}>{t("settings.profileIa.imageDisplayLink" as MessageKey)}</Button>
        </Section>
      )}

      {!isAcpKind(kind) && <div id="profile-quota">
        {kind === "apiKey" ? <QuotaConfigSection profile={profile} name={detail.name} draft={quotaDraft} setDraft={setQuotaDraft} /> : <OfficialQuotaSection profile={profile} name={detail.name} claude={kind === "claude"} />}
      </div>}

      <Section id="profile-tools"   title={t("settings.profileIa.toolsPermissions" as MessageKey)} hint={t("settings.profileIa.hostProfileDraft" as MessageKey, { name: detail.name })}>
        {!isAcpKind(kind) && <ProfileToolFields detail={detail} cfg={cfg} set={set} part="native" />}
        {/* profile-tool-schema-compat: Codex profiles only, when cutex offers the field. */}
        {schemaCompatRow && (
          <SettingRow source="host" agents="next" label={<>{t("agent-config.profile.toolSchemaCompat")}<InfoTip>{t("settings.profileCompat.strict" as MessageKey)}</InfoTip></>} hint={t("agent-config.profile.toolSchemaCompatHint")}>
            <Toggle checked={(patch.toolSchemaCompat !== undefined ? patch.toolSchemaCompat : storedSchemaCompat) === "strict"} onChange={(v) => setOrDrop("toolSchemaCompat", v ? "strict" : null, storedSchemaCompat)} />
          </SettingRow>
        )}

        <AgentBehaviourRows detail={detail} kind={kind} patch={patch} set={set} timing="next" />
        {kind === "claude" && <ClaudeCodeSourceRows detail={detail} patch={patch} set={set} />}
        {kind === "claude" && <ClaudeSkillsImportRow />}

        {/* Room for a future "可切换到" target list under this toggle. */}
        <ProfileSessionSwitch detail={detail} kind={kind} patch={patch} set={set} />
        <AgentBehaviourRows detail={detail} kind={kind} patch={patch} set={set} timing="now" />

        {!isAcpKind(kind) && <ProfileToolFields detail={detail} cfg={cfg} set={set} searchTool={patch.searchTool} part="search" />}
          <BrowserProfileTools key={profile} profile={profile} name={detail.name} />

      </Section>
      <BrowserProfileClaimMode key={`claim:${profile}`} profile={profile} name={detail.name} />
      <ProfileProxy key={`proxy:${profile}`} profile={profile} detail={detail} onSaved={setDetail} />

      {/* Looks last (review UI-04): account and connection come first, a new profile is signed in before it is styled. */}
      <div id="profile-appearance">
        <ProfileAppearance detail={detail} patch={patch} set={set} host={targetHost} picture={picture} setPicture={(p) => (setStatus(null), setPicture(p))} onPicture={() => pictureFile.current?.click()} intro={intro} setIntro={setIntro} onIntroPortrait={() => introFile.current?.click()} introError={introError} theme={avatarTheme} setTheme={(v) => (setStatus(null), setAvatarTheme(v))} linked={{ state: linkedAppearance, checked: syncAppearance, onChecked: setSyncAppearance }} />
      </div>

      {kind === "apiKey" && (
        <Section id="profile-advanced"   title={t("agent-config.profile.advanced")}>
          <SettingRow agents="none" source="host" readOnly label={<>{t("agent-config.profile.wireApi")}<InfoTip>{t("settings.profileCompat.wireApi" as MessageKey)}</InfoTip></>}>
            <span className="font-mono text-xs text-muted">{cfg.providerWireApi ?? "responses"}</span>
          </SettingRow>
          <SettingRow agents="next" source="host" label={<>{t("agent-config.profile.requestRetries")}<InfoTip>{t("settings.profileCompat.requestRetries" as MessageKey)}</InfoTip></>} hint={t("agent-config.profile.requestRetriesHint")}>
            <NumberField value={cfg.requestMaxRetries ?? null} placeholder={t("agent-config.profile.nativeDefault")} range={[0, 100]} unit="" onCommit={(v) => set({ requestMaxRetries: v })} />
          </SettingRow>
          <SettingRow agents="next" source="host" label={<>{t("agent-config.profile.streamRetries")}<InfoTip>{t("settings.profileCompat.streamRetries" as MessageKey)}</InfoTip></>} hint={t("agent-config.profile.streamRetriesHint")}>
            <NumberField value={cfg.streamMaxRetries ?? null} placeholder={t("agent-config.profile.nativeDefault")} range={[0, 100]} unit="" onCommit={(v) => set({ streamMaxRetries: v })} />
          </SettingRow>
          <SettingRow agents="next" source="host" label={<>{t("agent-config.profile.streamIdle")}<InfoTip>{t("settings.profileCompat.streamIdle" as MessageKey)}</InfoTip></>} hint={t("agent-config.profile.streamIdleHint")}>
            <NumberField value={cfg.streamIdleTimeoutMs ?? null} placeholder={t("agent-config.profile.nativeDefault")} range={[0, 3_600_000]} unit="ms" onCommit={(v) => set({ streamIdleTimeoutMs: v })} />
          </SettingRow>
          <SettingRow agents="next" source="host" label={<>WebSockets<InfoTip>{t("settings.profileCompat.websockets" as MessageKey)}</InfoTip></>} hint={t("agent-config.profile.websocketsHint")}>
            <Toggle checked={cfg.supportsWebsockets ?? false} onChange={(v) => set({ supportsWebsockets: v })} />
          </SettingRow>
        </Section>
      )}

      {(dirty || error || status) && (
        <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 shadow-lg">
          {dirty ? (
            <>
              <span className="text-sm">{t("agent-config.profile.unsaved")}</span>
            </>
          ) : (
            <span className="text-xs text-subtle">{status}</span>
          )}
          {error && <span className="truncate text-xs text-danger" title={error}>{error}</span>}
          <span className="ml-auto flex gap-2">
            {dirty && <Button onClick={revert}>{t("agent-config.profile.revert")}</Button>}
            {dirty && <Button primary disabled={saving} onClick={() => void save()}>{t("settings.save")}</Button>}
          </span>
        </div>
      )}
    </div>
  );
}
