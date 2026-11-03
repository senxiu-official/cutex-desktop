import { usesInputLedger } from "../lib/deliveryMode";
import { deliveryBusy } from "../lib/inputLedger/nextUp";
import { ConversationModelControls } from "./ConversationModelControls";
import { ProfileSwitch } from "./ProfileSwitch";
import { cachedProfileList, loadProfileList } from "../lib/profileSnapshot";
export { ConversationModelControls, EffortPicker, type FastModeControl } from "./ConversationModelControls";
export { ProfileSwitch } from "./ProfileSwitch";
import { isImeComposing } from "../lib/ime";
// Composer in the Claude desktop style: a clean input box (queued items, image thumbnails, text,
// stop + send) and a thin settings row beneath it.
//   left:  `+` (ComposerTools) · permission mode · plan chip · background-terminal count
//   right: quota rings (cutex per-profile gauges + codex rate limits) · "profile / model" chip (one
//          menu: profile switch on top, models below) · reasoning effort · context-window ring
// Quota and context are deliberately separate (unlike Claude, which merges them).
// `/` opens the command palette (lib/slashCommands), `@` the workspace file search (DESIGN §4.3).
import { AgentPausedSection, AgentPausedSendHint } from "./AgentPauseParts";
import { useAgentPause } from "../lib/agentPause";
import { mentionText, parseDraggedPaths, WORKSPACE_PATHS_MIME } from "../lib/workspaceDrag";
import { DROP_TINT, dropTint } from "../lib/dropTint";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useId, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Clock, Eye, EyeOff, Square, X } from "lucide-react";
import type { AdmissionNextStep, QueueItem } from "@cutex-desktop/protocol";
import type { SkillMetadata, SkillsListResponse } from "@cutex-desktop/protocol/codex/v2";
import type { ExtraInput, ModelOption, ProfileItem } from "../../../shared/ipc";
import { fastModePatch, isFastTier, SESSION_FAST_MODE_FEATURE } from "../../../shared/fastMode";
import { draftMessageImage, imageInputItems } from "../../../shared/input";
import { api, bridge } from "../bridge";
import { useEnglishCatalog, useI18n, type MessageKey } from "../i18n";
import { zhCN } from "../i18n/zh-CN";
import { imageFileToDataUrl } from "../lib/images";
import { useP2Access } from "../lib/p2Access";
import { senderLabel } from "../lib/systemSenders";
import { useComposerDraft } from "../lib/composerDrafts";
import { candidateIndex, composerCandidateKey, mentionPathsFor, startMentionSearch, type MentionResults } from "../lib/composerMentions";
import { agentMentionCandidates, agentMentionInsert } from "../lib/composerAgentMentions";
import { agentMentionTokens } from "../lib/agentMentions";
import { Avatar } from "./Avatar";
import { AgentMentionInput, type AgentMentionInputHandle } from "./AgentMentionInput";
import { createComposerEnterTrace, type EnterDecision } from "../lib/composerEnterTrace";
import { archiveAgent, renameAgent } from "../lib/menus";
import { PERMISSION_MODES, effectivePermissionLines, effectivePermissions, liveExtrasApply, permissionModeOf, permissionPatch } from "../lib/permissionModes";
import { claudeModeOf, claudeModePatch, claudeModesOf, claudeToolSwitches, type ClaudeMode } from "../lib/claudePermissionModes";
import { RulesChip } from "./ClaudeRulesChip";
import { useSizeFlags, widthBelow } from "../lib/sizeFlags";
import { ComposerToolbarRow } from "./ComposerToolbarRow";
import { ClaudeSkillsImportDialog } from "./ClaudeSkillsImportDialog";
import { CLAUDE_SKILLS_IMPORT_FEATURE } from "../lib/claudeSkillsImport";
import { CLAUDE_PERMISSION_RULES_FEATURE } from "../../../shared/ipc";
import { SESSION_SANDBOX_EXTRAS_FEATURE } from "../../../shared/ipc";
import { LiveSandboxExtras } from "./LiveSandboxExtras";
import { PermissionDetail } from "./PermissionDetail";
import { ClaudeCodeSourcesNote } from "./ClaudeCodeSourcesNote";
import { useImagePickBlocked } from "../lib/remoteMode";
import { composerGauges, formatBalance, gaugeChoiceName, gaugeName, gaugesFromRateLimits, latestObservedAt, mergeGauges, observedClock, resetsIn, resetsInCompact, quotaFill, quotaPercent, quotaTextKey, wantsNativeQuotaFallback, windowName, type ComposerGauge, type GaugeChoice, type QuotaGauge, type RateLimitsLike } from "../lib/quota";
import { appendToken } from "../lib/composerTools";
import { useModelName } from "../lib/modelDisplay";
import { setUiPref, useUiPrefs } from "../lib/prefs";
import { agentFeaturesOf, changesSettingsLive, CLAUDE_SESSION_SKILLS_CAPABILITY, claudeFastMode, isAcpAgent, lacks, maxImageBytes, skillSource, steerAction, type AgentFeatures } from "../lib/agentFeatures";
import { useObservedModel } from "../lib/observedModelView";
import { shortModelId } from "../lib/observedModel";
import { structuralErrorText } from "../lib/structuralGateView";
import { boundSkills, insertMention, mentionAt, paletteQuery, parseSlash, rankEntries, runSlash, SLASH_COMMANDS, slashSpec, slashUnavailable, type PaletteEntry, type SlashContext } from "../lib/slashCommands";
import { anyOverlayOpen } from "../lib/openOverlays";
import { sideLayersActive } from "../lib/sideLayoutStore";
import { openChanges, openSide } from "../lib/sideOpen";
import { SIDE_CHAT_COMPONENT } from "../lib/sideKinds";
import { useConversationEsc } from "../lib/useConversationEsc";
import { pausedSection } from "../lib/queuePause";
import { composerKeyAction, strategyFor } from "../lib/sendKeys";
import { draftSteerPlan, hasImageInput, IMAGE_INPUT_STEERING_FEATURE, imageSteerMode } from "../lib/imageSteer";
import { queueActionNotice } from "../lib/queueSteer";
import { orderedEntries, type TimelineState } from "../lib/timeline";
import { hasUnlandedTurn, outboxAt, visiblePendingSteers, visibleQueue } from "../lib/legacyDelivery/outbox";
import { insertFeedbackOf, useQueueInsertFeedback } from "../lib/queueInsertFeedback";
import { useHeldBusy } from "../lib/legacyDelivery/busyHold";
import { lastAssistantText, timelineToMarkdown } from "../lib/transcript";
import { agentState, featuresOf, hostApi, interruptWithFeedback, queueItemText, sidebarOf, useApp, viewOf, type AgentAddress } from "../store";
import { useConvFeatures, useConvHost, useConvScope } from "../lib/conversationScope";
import { formatAutoRetryWait } from "../lib/modelOverloadRetry";
import { useModelOverloadRetry } from "../lib/modelOverloadRetryView";
import { meantHere } from "../lib/uiSignal";
import { offlineRuntime } from "../lib/runtimeStart";
import { hostPageParam, useComposerHost, useHostLoadQuota, useHostQuotas } from "../lib/targetHost";
import { services } from "../modules/app";
import { setSettingsHost } from "../lib/settingsHost";
import { ExperimentalPanel, MemoriesPanel, ProjectMemoryPanel, StatusPanel, type StatusRow } from "./ComposerPanels";
import { ComposerTools } from "./ComposerTools";
import { GaugeBar } from "./GaugeBar";
import { ProfileAvatar, type AvatarProfile } from "./ProfileAvatar";
import { Segmented } from "./settings/Form";
import { Ring } from "./Ring";
import { Menu, Popover } from "./Menu";
import { WindowsSandboxMenuNote } from "./WindowsSandboxNotice";
import { useSessionWindowsSandbox } from "../lib/windowsSandboxView";
import { useHostPlatform } from "../lib/codeBlockActions";
import { WINDOWS_SANDBOX_FEATURE, windowsSandboxWarns } from "../../../shared/windowsSandbox";
import { QueuePanel } from "./QueuePanel";
import { ImageThumb } from "./ImageThumbs";
import { PendingMessagesSection } from "./PendingMessagesSection";
import { usePendingMessages } from "../lib/agentMessageStore";
import { lastFinishedTurnStart } from "../lib/legacyDelivery/agentMessages";
import { AsksPausedSection, DelegationQueueSection, PauseAsksButton } from "./DelegationQueue";
import { stopHeld } from "../lib/stopHold";
import { APPROVAL_AUTO_RULES_FEATURE } from "../lib/approvals";
import { approvalIdentityRole, declaredAgentCreate, declaredCutexTools } from "../lib/approvalRuleKinds";
import { isQuickChat } from "../lib/sidebar";
import { ADMISSION_ORDER_FEATURE, OWNER_YIELD_FEATURE, admittedAskIds, currentTurnOf, pendingSectionMessages, turnGroups } from "../lib/legacyDelivery/admissionOrder";
import { useUnreadNextStep } from "../lib/legacyDelivery/readInRideAlongs";
import { reloadOwnerMayPassAsks, useOwnerMayPassAsks } from "../lib/admissionOrderView";
import { useHostRecords } from "../lib/delegationStore";
import { useDelegationTurn, usePendingDelegations } from "../lib/delegationsView";
import { delegationJoinIntent, OWNER_JOIN_FEATURE, delegationKeyAction, delegationSendChoices, queueSendNowMode, sendHowFor } from "../lib/delegationTurn";
import { confirmDialog, contextMenu } from "../lib/contextMenu";
import { fileActions } from "../lib/fileActions";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { noteSent } from "../lib/jump";
import { followAfterSend } from "../lib/stickToBottom";
import { ComposerTriggers } from "./gutter/ComposerTriggers";
import { ASKS_PAUSE_FEATURE } from "../lib/asksPause";
import { QUOTA_CONTINUE_FEATURE } from "../../../shared/quotaContinue";
import { RESET_CREDITS_FEATURE } from "../../../shared/resetCredits";
import { quotaExhausted, ResetCreditsLine, ResetOfferSection } from "./ResetCredits";
import { useResetOffer } from "../lib/resetCredits";
import { useQuotaContinue } from "../lib/quotaContinue";
import { pinInSession, repinApplies, useClaudeRuntimePreload } from "../lib/claudeRepin";
import { runtimeOf } from "../lib/agentList";
import { chatModelAndEffort } from "../lib/dshModels";
import { QuotaContinueSection } from "./QuotaContinueSection";
import { queueAutoCompact, useShortWindow } from "../lib/queueChips";
import { DelegationSendMenu, DelegationTurnHint, DelegationTurnOverlay } from "./DelegationComposer";
import { SlashPalette, type PaletteRow } from "./SlashPalette";
import { unlistedModel, composerEfforts } from "../lib/models";
import { claudePickerItems, claudeShortName } from "../lib/claudeModels";
import { sharedResizeObserver } from "../lib/resizeHub";
import { NoSteerSendHint } from "./NoSteerSendHint";
import { busyPlaceholderKey, noSteerHintShown } from "../lib/noSteerHint";
import { useOwnerWindow } from "../lib/ownerContext";


const Bar = GaugeBar;

const QUOTA_REFRESH_MS = 60_000;

/**
 * 「接下来」 and the input box (owner 2026-10-26, replacing design 040 step 9's one wrapping card): 「接下来」
 * (QueuePanel `data-queue-tray`) is a block of its own right above the input box — the same width and edges, its
 * bottom corners square and its bottom edge the input box's top border, so the two read as one piece — but it never
 * wraps the input box. The input box has the same position and size with or without it (no inset that comes and
 * goes): opening, folding or a row coming and going changes only the history's height. CSS only (`:has()`): the
 * DOM, the drop target and the keys are the same either way.
 */
const INPUT_IN_CARD = "group-has-[[data-queue-tray]]/inputcard:rounded-t-none";
/** The input box's drop tint under 框线+底色 (lib/dropTint): over its own --surface, so it stays opaque. */
const INPUT_DROP_TINT = dropTint("var(--accent)", 13, "var(--surface)");

/** Profile chip: the profile name with its quota rings; the popover has the profile switch list
 *  and the quota details. `sessionId` null = new-chat draft: no native fallback, and `switcher` (the
 *  draft's own profile picker) replaces the session switch section. */
export function ProfileQuota({ profile, rateLimits, rateLimitsAt, sessionId, busy, openSignal, switcher }: { profile: string | null; rateLimits: TimelineState["rateLimits"]; rateLimitsAt: number | null; sessionId: string | null; busy: boolean; openSignal?: number; switcher?: (close: () => void) => ReactNode }) {
  const { t } = useI18n();
  // The composer's host: the open agent's, or the quick-chat draft's (TargetHostContext).
  const quotaHost = useComposerHost();
  const quotas = useHostQuotas(quotaHost);
  const cutexGauges = profile ? quotas[profile] : undefined;
  const loadQuota = useHostLoadQuota(quotaHost);
  const features = useApp((s) => featuresOf(s, quotaHost));
  const resetsOn = features.has(RESET_CREDITS_FEATURE);
  const convHost = useConvHost();
  const online = useApp((s) => sidebarOf(s, convHost)?.active.find((x) => x.cutexSessionId === sessionId)?.runtime.status === "online");
  const prefs = useUiPrefs();
  useEffect(() => {
    if (!profile) return;
    void loadQuota(profile);
    const timer = setInterval(() => void loadQuota(profile), QUOTA_REFRESH_MS);
    return () => clearInterval(timer);
  }, [profile, loadQuota]);
  // Warm the profile list so the popover's switch section is there in its first paint; the chip's
  // picture comes from it too.
  // The list of THE COMPOSER'S host (quotaHost), not the focus host's: an agent of another host (host02's Ceobe seen from
  // remote) names a Profile the focus host does not have, and the chip then lost its avatar.
  const [items, setItems] = useState<ProfileItem[] | null>(() => cachedProfileList(quotaHost)?.profiles ?? null);
  useEffect(() => {
    const cached = cachedProfileList(quotaHost);
    setItems(cached?.profiles ?? null);
    if (!cached) void loadProfileList(quotaHost).then((r) => setItems(r?.profiles ?? null), () => {});
  }, [quotaHost]);
  // Known by name but not (yet) in the list: still a face — the initial on the name's colour, never nothing.
  const item: AvatarProfile | undefined = profile ? (items?.find((p) => p.name === profile) ?? { id: profile, name: profile, authKind: "none", cliKind: "", baseUrl: null, appearance: { color: null, effectiveColor: null, providerCategory: null } }) : undefined;
  // cutex has no gauges for this profile (older cutex, or a Claude profile: r202 reads ChatGPT
  // only): ask the agent's own runtime.
  const fallback = !!sessionId && wantsNativeQuotaFallback(cutexGauges, online);
  const [nativeQuota, setNativeQuota] = useState<{ limits: RateLimitsLike; at: number } | null>(null);
  useEffect(() => {
    setNativeQuota(null);
    if (!fallback || !sessionId) return;
    let alive = true;
    const read = () =>
      void hostApi(quotaHost).readRateLimits(sessionId).then((limits) => {
        if (alive && limits) setNativeQuota({ limits: limits as RateLimitsLike, at: Math.round(Date.now() / 1000) });
      });
    read();
    const timer = setInterval(read, QUOTA_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [fallback, sessionId]);
  const base = mergeGauges(cutexGauges ?? [], nativeQuota ? gaugesFromRateLimits(nativeQuota.limits, nativeQuota.at) : []);
  const gauges = mergeGauges(base, gaugesFromRateLimits(rateLimits, rateLimitsAt));
  const observed = latestObservedAt(gauges);
  const title = (g: QuotaGauge) => (g.windowLabel && g.windowLabel !== g.label ? `${gaugeName(g)} · ${windowName(g.windowLabel)}` : gaugeName(g));
  // With no gauge yet, a dim ring keeps the chip's size, so nothing shifts when quota lands.
  const view = prefs.quotaView;
  const visible = gauges.some((g) => g.kind === "balance" || quotaFill(g, view) !== null);
  // The row's rings after the per-gauge choices and same-reset merging (lib/quota composerGauges).
  const rings = composerGauges(gauges, prefs.quotaGauges, prefs.quotaResetDefault, prefs.quotaMerge);
  const choiceOf = (g: QuotaGauge) => prefs.quotaGauges[gaugeChoiceName(g)];
  const setChoice = (g: QuotaGauge, patch: GaugeChoice) => setUiPref("quotaGauges", { ...prefs.quotaGauges, [gaugeChoiceName(g)]: { ...choiceOf(g), ...patch } });
  const toggleChoice = (g: QuotaGauge, field: "ring" | "reset") =>
    setChoice(g, { [field]: !(field === "ring" ? choiceOf(g)?.ring !== false : choiceOf(g)?.reset ?? prefs.quotaResetDefault) });
  const percentOf = (g: QuotaGauge) => {
    const percent = quotaPercent(g, view);
    return percent === null ? "" : t(quotaTextKey(view), { percent });
  };
  // A merged ring's hover names every window it stands for and their shared reset.
  const ringTitle = (r: ComposerGauge) => {
    if (r.members.length === 1) {
      const g = r.members[0]!;
      return g.resetAt ? `${title(g)} · ${t("composer.quota.resets", { in: resetsIn(g.resetAt) })}` : title(g);
    }
    const members = r.members.map((m) => [title(m), percentOf(m)].filter(Boolean).join(" · "));
    return [...members, r.resetAt !== null ? t("composer.quota.mergedResets", { in: resetsIn(r.resetAt) }) : ""].filter(Boolean).join("\n");
  };
  return (
    <Popover
      triggerTitle={profile ? `${profile} · ${t("composer.quota.title")}` : t("composer.quota.title")}
      // Widens to its rows so gauge names (「Claude · Fable 7d」) stay whole, up to 28rem / the window.
      width="w-max min-w-72 max-w-[min(28rem,calc(100vw-2rem))]"
      align="right"
      openSignal={openSignal}
      trigger={
        <span className="flex min-w-0 items-center gap-2">
          {item && prefs.composerProfileAvatar && <ProfileAvatar profile={item} size={18} host={quotaHost} />}
          <span className="trim-cap max-w-28 truncate" data-quota-name="" title={profile ?? undefined}>{profile ?? t("composer.quota.noProfile")}</span>
          {!visible && (
            <span className="opacity-40">
              <Ring ratio={0} />
            </span>
          )}
          {rings.map((r) => {
            const g = r.draw;
            const fill = quotaFill(g, view);
            const segments = r.members.flatMap((member) => {
              const ratio = quotaFill(member, view);
              return ratio === null ? [] : [{ id: member.id, ratio, label: [title(member), percentOf(member)].filter(Boolean).join(" · "), stale: member.stale }];
            });
            return r.balance ? (
              <span key={g.id} className={`trim-cap text-subtle tabular-nums ${g.stale ? "opacity-60" : ""}`} title={g.balance ?? undefined}>{formatBalance(g.balance, true)}</span>
            ) : fill === null ? null : (
              // The ring's hover names the reset too: a narrow composer row hides the countdown text (lib/toolbarFit).
              <span key={g.id} data-quota-ring={g.id} data-merged={r.members.length > 1 ? "" : undefined} className={`flex shrink-0 items-center gap-1 ${g.stale && segments.length < 2 ? "opacity-50" : ""}`} title={ringTitle(r)}>
                <Ring ratio={fill} view={view} segments={segments} />
                {r.showReset && r.resetAt !== null && <span className="trim-cap text-subtle tabular-nums" data-quota-reset="">{resetsInCompact(r.resetAt)}</span>}
              </span>
            );
          })}
        </span>
      }
    >
      {(close) => (
        <div className="space-y-3 p-2.5">
          {switcher ? switcher(close) : sessionId && <ProfileSwitch profile={profile} sessionId={sessionId} busy={busy} />}
          <div className="flex items-center justify-between text-xs text-subtle">
            <span>{t("composer.quota.title")}</span>
            <span className="flex items-center gap-2">
              {profile}
              {profile && (
                <button title={t("composer.quota.refresh")} onClick={() => void loadQuota(profile, true)} className="hover:text-foreground">
                  ↻
                </button>
              )}
            </span>
          </div>
          {gauges.length === 0 && <p className="text-xs text-subtle">{t("composer.quota.none")}</p>}
          {observed !== null && <p className="-mt-2 text-caption/[inherit] text-subtle">{t("composer.quota.observedAt", { at: observedClock(observed) })}</p>}
          {/* One grid for every row (subgrid): label | reset | value line up across rows; bars span all three. */}
          {gauges.length > 0 && (
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-3 gap-y-3">
              {gauges.map((g) => {
                const fill = quotaFill(g, view);
                const percent = quotaPercent(g, view);
                return (
                  <div key={g.id} className={`col-span-4 grid grid-cols-subgrid items-baseline gap-y-1.5 ${g.stale ? "opacity-60" : ""}`} title={g.observedAt ? t("composer.quota.observedAt", { at: observedClock(g.observedAt) }) : undefined}>
                    {/* The row's two choices (owner 2026-10-28): this gauge's ring and its countdown. A hidden row stays listed, dimmed. */}
                    {g.kind === "balance" ? (
                      <span aria-hidden />
                    ) : (
                      <span className="flex items-center gap-0.5 self-center">
                        <button
                          type="button"
                          data-quota-ring-toggle={g.id}
                          aria-pressed={choiceOf(g)?.ring !== false}
                          title={t("composer.quota.ring")}
                          onClick={() => toggleChoice(g, "ring")}
                          className={`rounded p-0.5 hover:bg-surface-2 ${choiceOf(g)?.ring === false ? "text-subtle opacity-60" : "text-muted"}`}
                        >
                          {choiceOf(g)?.ring === false ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button
                          type="button"
                          data-quota-reset-toggle={g.id}
                          aria-pressed={choiceOf(g)?.reset ?? prefs.quotaResetDefault}
                          title={t("composer.quota.reset")}
                          onClick={() => toggleChoice(g, "reset")}
                          className={`rounded p-0.5 hover:bg-surface-2 ${(choiceOf(g)?.reset ?? prefs.quotaResetDefault) ? "text-muted" : "text-subtle opacity-60"}`}
                        >
                          <Clock size={13} />
                        </button>
                      </span>
                    )}
                    {/* The whole name; past the popover's max width it wraps (two lines at most, the title has the rest). */}
                    <span data-quota-label={g.id} title={title(g)} className={`line-clamp-2 min-w-0 text-sm break-words ${choiceOf(g)?.ring === false && g.kind !== "balance" ? "opacity-55" : ""}`}>
                      {title(g)}
                      {g.stale && <span className="ml-1 text-xs text-warn" title={t("composer.quota.stale")}>~</span>}
                    </span>
                    <span className="text-right text-xs whitespace-nowrap text-subtle tabular-nums">{g.resetAt ? t("composer.quota.resets", { in: resetsIn(g.resetAt) }) : ""}</span>
                    {g.kind === "balance" ? (
                      <span className="text-right text-xs font-medium whitespace-nowrap tabular-nums" title={g.balance ?? undefined}>{formatBalance(g.balance)}</span>
                    ) : (
                      <span className="text-right text-xs font-medium whitespace-nowrap tabular-nums">{percent === null ? "—" : t(quotaTextKey(view), { percent })}</span>
                    )}
                    {fill !== null && (
                      <div className="col-span-4">
                        <Bar ratio={fill} view={view} />
                      </div>
                    )}
                    {g.error && <p className="col-span-4 text-xs text-danger">{g.error}</p>}
                  </div>
                );
              })}
            </div>
          )}
          {profile && resetsOn && <ResetCreditsLine hostId={quotaHost} profile={profile} afterReset={() => void loadQuota(profile, true)} />}
          <div className="space-y-2 border-t border-border pt-2 text-xs text-muted">
            <label className="flex cursor-pointer items-center justify-between">
              {t("composer.quota.merge")}
              <input type="checkbox" checked={prefs.quotaMerge} onChange={(e) => setUiPref("quotaMerge", e.target.checked)} />
            </label>
            <div className="flex items-center justify-between gap-2">
              <span>{t("composer.quota.view")}</span>
              <Segmented
                label={t("composer.quota.view")}
                value={view}
                options={[
                  { value: "remaining" as const, label: t("composer.quota.view.remaining") },
                  { value: "used" as const, label: t("composer.quota.view.used") },
                ]}
                onChange={(v) => setUiPref("quotaView", v)}
              />
            </div>
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Divider between the profile chip (name + quota) and the model group (model · reasoning · context). */
export function ChipDivider() {
  return <span aria-hidden className="mx-1 h-3.5 w-px shrink-0 bg-border" />;
}

function ContextMeter({ usage, onCompact, billingUnavailable = false, canCompact = true }: { usage: TimelineState["contextUsage"]; onCompact(): void; billingUnavailable?: boolean; canCompact?: boolean }) {
  const { t } = useI18n();
  // Before the first token report (fresh agent, or reopened: thread/read carries none) the ring is
  // dim but still opens the popover, so 压缩会话 stays reachable.
  const window = usage?.window ?? null;
  const ratio = usage && window ? usage.used / window : null;
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  // Same size as the quota rings, so the row's rings share their top and bottom edges too.
  const trigger =
    ratio === null ? (
      <span className="opacity-40">
        <Ring ratio={0} />
      </span>
    ) : (
      <Ring ratio={ratio} />
    );
  return (
    <Popover align="right" width="w-72" triggerTitle={t("composer.context.title")} trigger={trigger}>
      {(close) => (
        <div className="space-y-2.5 p-2.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-subtle">{t("composer.context.title")}</span>
            <span>
              {usage && window ? `${k(usage.used)} / ${k(window)} (${Math.round((ratio ?? 0) * 100)}%)` : usage ? `${k(usage.used)} / —` : "—"}
            </span>
          </div>
          {ratio !== null ? <Bar ratio={ratio} /> : <p className="text-xs text-subtle">{usage ? t("composer.context.noWindow") : t("composer.context.none")}</p>}
          {billingUnavailable && <p className="text-xs text-subtle">{t("dsh.billingUnavailable")}</p>}
          {usage?.dsh && <p className="text-xs text-subtle" title={usage.dsh.observedAt}>{t("dsh.contextObserved", { at: new Date(usage.dsh.observedAt).toLocaleString() })}</p>}
          <div className="flex items-center justify-between">
            <span className="text-xs text-subtle">{ratio !== null && ratio > 0.85 ? t("composer.context.soon") : ""}</span>
            {canCompact && <button
              onClick={() => {
                onCompact();
                close();
              }}
              className="rounded-md bg-surface-2 px-2 py-1 text-xs hover:text-foreground"
            >
              {t("composer.context.compact")}
            </button>}
          </div>
        </div>
      )}
    </Popover>
  );
}

type PaletteItem = PaletteEntry & { skill?: SkillMetadata };
type PanelKind = "status" | "memories" | "experimental" | "projectMemory";
type PopoverKind = "model" | "permissions" | "quota";

const PANELS = new Set<string>(["status", "memories", "experimental"]);
const POPOVERS = new Set<string>(["model", "permissions", "quota"]);
/** The settings row below the input: narrow = the Claude rules chip shows its icon only (lib/sizeFlags). */
const TOOLBAR_SIZES = { narrow: widthBelow(34) } as const;

/** Command entries with both locales' descriptions as search keywords (zh and en both match; en once loaded). */
function commandEntries(t: (k: MessageKey, v?: Record<string, string | number>) => string, features: ReadonlySet<string>, agent: AgentFeatures, busy: boolean, en: Readonly<Partial<Record<MessageKey, string>>> | undefined): PaletteItem[] {
  return SLASH_COMMANDS.map((c) => {
    const key = `slash.cmd.${c.id}` as MessageKey;
    const unavailable = slashUnavailable(c, features, agent, busy);
    return {
      key: `cmd:${c.id}`,
      kind: "command",
      name: c.id,
      description: t(key),
      keywords: [zhCN[key], ...(en?.[key] ? [en[key]] : []), ...(c.aliases ?? [])],
      disabledReason: unavailable ? t(`slash.unavailable.${unavailable}` as MessageKey) : undefined,
    };
  });
}

let imageSeq = 0;
const NO_NEXT_STEP: AdmissionNextStep[] = [];

export function Composer({
  name,
  busy: legacyBusy,
  queue,
  timeline,
  timelineRev,
  sessionId,
  profile,
}: {
  name: string;
  busy: boolean;
  queue: QueueItem[];
  timeline: TimelineState | null;
  /** Moves when what the composer reads from `timeline` (updated in place) changed (lib/timelineShape); lets a memo'd composer skip streamed text. */
  timelineRev?: number;
  sessionId: string;
  profile: string | null;
}) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const modelName = useModelName();
  // The conversation's host (lib/conversationScope): per-agent state and actions are keyed by host + id.
  const hostId = useConvHost();
  const overloadRetry = useModelOverloadRetry(sessionId, hostId);
  const submit = useApp((s) => s.submit);
  const queueRemove = useApp((s) => s.queueRemove);
  const queueTakeForEdit = useApp((s) => s.queueTakeForEdit);
  const queueSendNow = useApp((s) => s.queueSendNow);
  const pendingDelegations = usePendingDelegations(sessionId);
  const models = useApp((s) => agentState(s.models, hostId, sessionId));
  const modelsReady = useApp((s) => agentState(s.modelsReady ?? {}, hostId, sessionId));
  const loadModels = useApp((s) => s.loadModels);
  const collabModes = useApp((s) => agentState(s.collabModes, hostId, sessionId));
  const loadCollabModes = useApp((s) => s.loadCollabModes);
  const setCollabMode = useApp((s) => s.setCollabMode);
  const updateSettings = useApp((s) => s.updateSettings);
  const compact = useApp((s) => s.compact);
  // The conversation's host and its capabilities (lib/conversationScope).
  const features = useConvFeatures();
  const ledgerMode = usesInputLedger([...features]);
  const ledger = useApp(s => agentState(s.inputs, hostId, sessionId));
  const busy = ledgerMode ? deliveryBusy(ledger?.delivery) : legacyBusy;
  const approvalRulesFeature = features.has(APPROVAL_AUTO_RULES_FEATURE);
  const runtimeGeneration = useApp((s) => viewOf(s, hostId, sessionId)?.runtimeGeneration ?? 0);
  const uiSignal = useApp((s) => s.uiSignal);
  const notice = useApp((s) => s.notice);
  const shortWindow = useShortWindow();
  // Notices and open requests about this conversation go to its own composer (panes step 2: two
  // conversations side by side each have one); see `shownHere`.
  const scope = useConvScope();
  const here = useMemo<AgentAddress>(() => ({ hostId, sessionId }), [hostId, sessionId]);
  const notifyHere = (text: string, tone?: "info" | "error") => useApp.getState().notify(text, tone, here);
  const signalHere = (target: string, arg?: string) => useApp.getState().signal(target, arg, here);
  const { text, setText, images, setImages, pickedSkills, setPickedSkills, clearDraft, captureDraft } = useComposerDraft(hostId, sessionId);
  const { sendKeys, delegationSteerKeys, queueSectionStrip, queuePanelFold } = useUiPrefs();
  // The running turn handles a delegation (agent-asks): hint, guarded shortcuts, send menu.
  const runningDelegation = useDelegationTurn(timeline);
  const delegation = busy && (!ledgerMode || (ledger?.delivery?.turn?.kind === "ask" && ledger.delivery.turn.askId === runningDelegation?.askId)) ? runningDelegation : null;
  const guardKeys = { delegation: !!delegation, allowSteerKeys: delegationSteerKeys };
  const joinIntent = delegationJoinIntent(delegation, timeline?.activeTurnId, runtimeGeneration, features);
  const canJoin = features.has(OWNER_JOIN_FEATURE) && !!joinIntent;
  const pendingSteers = useApp((s) => agentState(s.pendingSteers, hostId, sessionId));
  const queuePause = useApp((s) => viewOf(s, hostId, sessionId)?.queuePause ?? null);
  const asksPaused = useApp((s) => featuresOf(s, hostId).has(ASKS_PAUSE_FEATURE) && !!viewOf(s, hostId, sessionId)?.asksPaused);
  // stop-holds-ridealongs: the owner's stop holds everything until 继续发送 (lib/stopHold).
  const stopHold = useApp((s) => stopHeld(viewOf(s, hostId, sessionId)?.asksPaused));
  const queueHandoff = useApp((s) => !!agentState(s.queueHandoff, hostId, sessionId));
  // Optimistic sends and queue rows being removed (lib/outbox): the tray shows what will be.
  const outbox = useApp((s) => agentState(s.outbox, hostId, sessionId));
  const queueHidden = useApp((s) => agentState(s.queueHidden, hostId, sessionId));
  // The timeline's size stands in for its (mutated in place) entries: a flushed message landing hides its queue row.
  const entryCount = timeline?.entries.size ?? 0;
  // Preserve an idle send's timeline placement when a background input starts
  // a turn before its steered acceptance. Store still owns the pending lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownSteers = useMemo(() => ledgerMode ? [] : visiblePendingSteers(outbox, pendingSteers, timeline), [ledgerMode, outbox, pendingSteers, timeline, timelineRev, entryCount]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownQueue = useMemo(() => ledgerMode ? queue : visibleQueue(queue, queueHidden, outbox, timeline), [ledgerMode, queue, queueHidden, outbox, timeline, entryCount]);
  // A send that is starting a turn counts as busy: the next Enter queues behind it.
  const insertPending = useQueueInsertFeedback((s) => insertFeedbackOf(hostId, sessionId)(s).some((f) => f.state === "requesting"));
  const sendBusy = ledgerMode ? busy : busy || hasUnlandedTurn(outbox) || insertPending;
  const paused = useMemo(() => pausedSection(shownSteers, shownQueue, queuePause, queueHandoff), [shownSteers, shownQueue, queuePause, queueHandoff]);
  // admission-order: one list in the order cutex admits owner messages, delegations and deliveries.
  const admission = useApp((s) => (featuresOf(s, hostId).has(ADMISSION_ORDER_FEATURE) ? (viewOf(s, hostId, sessionId)?.admission ?? null) : null));
  // The open agent's host's records (a peers delegation has one per host).
  const askById = useHostRecords(hostId);
  const mayPass = useOwnerMayPassAsks(!!admission);
  const groups = useMemo(() => (!ledgerMode && admission ? turnGroups(admission, shownQueue, askById) : null), [ledgerMode, admission, shownQueue, askById]);
  // Ride-alongs already in the timeline leave at once, before cutex's receipt (a Claude turn's comes at its end; lib/readInRideAlongs).
  const nextStep = useUnreadNextStep(groups?.nextStep ?? NO_NEXT_STEP, ledgerMode ? null : timeline, timelineRev ?? entryCount);
  const admittedAsks = useMemo(() => admittedAskIds(admission), [admission]);
  // Pending delegations the admission list does not have (e.g. awaiting the owner's review) keep their section.
  const otherDelegations = useMemo(() => (admission ? pendingDelegations.filter((d) => !admittedAsks.has(d.askId)) : pendingDelegations), [admission, pendingDelegations, admittedAsks]);
  const orderedAsks = !!groups?.turns.some((r) => r.kind === "ask");
  const activeTurnStart = busy ? (timeline?.turns.find((x) => x.id === timeline.activeTurnId)?.startedAt ?? null) : null;
  // 待读留言 (agent-messages-v2): a message whose item is in the timeline is read in already.
  // A Claude agent's notes read in by a later turn leave too (lib/agentMessages pendingMessagesFor).
  const claudeRecipient = useApp((s) => {
    const row = [...(sidebarOf(s, hostId)?.active ?? []), ...(sidebarOf(s, hostId)?.retired ?? [])].find((r) => r.cutexSessionId === sessionId);
    return !!row && runtimeOf(row) === "claude";
  });
  const pendingMessages = usePendingMessages(sessionId, (id) => !!timeline?.entries.has(id), timeline?.entries.size ?? 0, timeline?.turns, claudeRecipient);
  // The 待读留言 section's rows: with admission-order those the turn frame (nextStep) does not list (notes).
  const sectionMessages = useMemo(() => pendingSectionMessages(features, pendingMessages, admission?.nextStep), [features, pendingMessages, admission]);
  // A stop's hold (origin ownerStop) only matters while something waits behind it: with nothing held the
  // 「委托已随停止暂停」 strip stays out of the way (the owner's own 暂停委托 always shows).
  const pauseOrigin = useApp((s) => viewOf(s, hostId, sessionId)?.asksPaused?.origin ?? null);
  const stopHoldsSomething = !!admission?.items.some((i) => i.kind !== "owner") || nextStep.length > 0 || otherDelegations.length > 0 || pendingMessages.length > 0;
  const showAsksPaused = asksPaused && (pauseOrigin !== "ownerStop" || stopHoldsSomething);
  // Something will start the next turn as soon as this one ends (a queued message cutex flushes, an
  // admitted delegation, a send in flight) — not after the owner's stop. The stop button and the busy
  // placeholder then stay through the gap between turn/completed and the next turn/started (lib/busyHold).
  const lastTurn = timeline?.turns[timeline.turns.length - 1];
  const followUp = lastTurn?.status !== "interrupted" && (hasUnlandedTurn(outbox) || shownQueue.length > paused.items.length || (!asksPaused && !!groups?.turns.some((r) => r.kind === "ask")));
  const legacyBusyLook = useHeldBusy(ledgerMode ? false : busy, ledgerMode ? false : followUp);
  const busyLook = ledgerMode ? deliveryBusy(ledger?.delivery) : legacyBusyLook;
  const [caret, setCaret] = useState(0);
  const [sending, setSending] = useState(false);
  const [traceEnter] = useState(() => createComposerEnterTrace(sessionId,
    (record) => bridge.shell?.logError({ kind: "reported", message: JSON.stringify(record) })));
  // All skills (enabled + disabled) for the agent's cwd; the palette lists the enabled ones.
  const [allSkills, setAllSkills] = useState<SkillMetadata[] | null>(null);
  /** 从 ~/.claude/skills 导入… open (Claude agents, cutex claude-skills-import). */
  const [importingSkills, setImportingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  // Esc hides the palette for exactly this draft; typing on reopens it.
  const [paletteDismissed, setPaletteDismissed] = useState<string | null>(null);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  const [mentionResults, setMentionResults] = useState<MentionResults | null>(null);
  const mentionListId = useId();
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [popoverSignal, setPopoverSignal] = useState<{ kind: PopoverKind; nonce: number } | null>(null);
  const [shownNotice, setShownNotice] = useState<typeof notice>(null);
  const [dragOver, setDragOver] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | AgentMentionInputHandle>(null);
  const [richInput, setRichInput] = useState(false);
  const hasAgentMentions = useMemo(() => agentMentionTokens(text).length > 0, [text]);
  const useRichInput = richInput || hasAgentMentions;
  useEffect(() => { if (hasAgentMentions) setRichInput(true); }, [hasAgentMentions]);
  useEffect(() => setRichInput(false), [sessionId, hostId]);
  // The input grows with its wrapped text (not only its line breaks) up to max-h-60, then scrolls:
  // counting "\n" alone left long wrapped paragraphs scrolling inside a short box (owner 2026-10-18).
  // In a short pane the cap is lower (`--composer-input-max`, set by Conversation; lib/shortPane composerInputMax).
  useLayoutEffect(() => {
    const control = textarea.current;
    const el = control && "element" in control ? control.element : control;
    if (!control || !el) return;
    // Typing at the end of a draft taller than the cap keeps the caret line in view, also when the cap itself changes
    // (the pane resized, 「接下来」 folded): no input event then for the browser to scroll to the caret.
    const followCaret = () => {
      if (el.ownerDocument.activeElement === el && control.selectionEnd >= control.value.length) el.scrollTop = el.scrollHeight;
    };
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
      followCaret();
    };
    fit();
    let width = el.clientWidth;
    let height = el.clientHeight;
    const ro = sharedResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        fit();
      } else if (el.clientHeight !== height) followCaret();
      height = el.clientHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, useRichInput]);

  const online = !!timeline?.threadId;
  // The runtime itself (a thread id also comes from the offline history reader): models are asked
  // again when it comes up, and an offline agent's chips say "start it first" instead of loading.
  const runtimeStatus = useApp((s) => sidebarOf(s, hostId)?.active.find((r) => r.cutexSessionId === sessionId)?.runtime.status ?? null);
  const runtimeDown = offlineRuntime(runtimeStatus);
  useEffect(() => {
    if (!online || runtimeDown) return;
    void loadModels(false, sessionId, hostId);
    void loadCollabModes(sessionId, hostId);
  }, [hostId, sessionId, runtimeGeneration, online, runtimeDown, loadModels, loadCollabModes]);

  // Notices from commands / store actions: visible for a few seconds — those about this agent, and
  // those about none in particular while this conversation has the focus (lib/uiSignal meantHere).
  const focused = scope?.focused ?? true;
  useEffect(() => {
    if (!notice || Date.now() - notice.nonce > 5000) return; // nonce is a timestamp; skip stale ones on remount
    if (!meantHere(notice.agent, here, focused)) return;
    setShownNotice(notice);
    const timer = setTimeout(() => setShownNotice((n) => (n?.nonce === notice.nonce ? null : n)), notice.tone === "error" ? 8000 : 3500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a focus change alone must not re-show an old notice
  }, [notice]);

  // Open requests from elsewhere (signal) for the composer's own popovers / panels (this agent's, or
  // the focused conversation's).
  const lastSignal = useRef(uiSignal?.nonce ?? 0);
  useEffect(() => {
    if (!uiSignal || uiSignal.nonce === lastSignal.current) return;
    lastSignal.current = uiSignal.nonce;
    if (!meantHere(uiSignal.agent, here, focused)) return;
    if (POPOVERS.has(uiSignal.target)) setPopoverSignal({ kind: uiSignal.target as PopoverKind, nonce: uiSignal.nonce });
    else if (PANELS.has(uiSignal.target)) setPanel(uiSignal.target as PanelKind);
  }, [uiSignal]);

  const settings = timeline?.settings ?? null;
  const mode = permissionModeOf(settings);
  const effective = effectivePermissions(settings);
  const collabMode = settings?.collaborationMode?.mode ?? "default";
  const session = useApp((s) => [...(sidebarOf(s, hostId)?.active ?? []), ...(sidebarOf(s, hostId)?.retired ?? [])].find((r) => r.cutexSessionId === sessionId));
  // The chat's live model (threadSettings). DSH: else the session's model default (cutex model_defaults, where a
  // change on the chat lands too) — never the creation value of its launch binding.
  const { model: currentModel, effort: currentEffort } = chatModelAndEffort(settings, session ? runtimeOf(session) : null, session?.runtimeDefaults);
  const modelUnavailable = !runtimeDown && unlistedModel(models, currentModel, modelsReady === runtimeGeneration);
  const modelInfo = models?.find((m) => m.model === currentModel || m.id === currentModel);
  // Claude (docs/design/024-model-list.md): one row per real model, aliases folded in.
  const claudeList = !!session && runtimeOf(session) === "claude";
  const claudeName = claudeList && models ? claudeShortName(models.map((m) => ({ id: m.model, displayName: m.displayName })), currentModel, t) : null;
  // The profile's entry name, else the catalog name (lib/modelDisplay); "" = no model yet.
  const modelShown = modelName(currentModel, claudeName ?? modelInfo?.displayName, profile);
  const { efforts, empty: effortsEmpty } = composerEfforts(models, currentModel);
  const fastFeature = useApp((s) => featuresOf(s, hostId).has(SESSION_FAST_MODE_FEATURE));
  const modelItems: (Pick<ModelOption, "model" | "displayName" | "description"> & { primary?: boolean })[] =
    models ? (claudeList ? claudePickerItems(models, currentModel, t) : models) : [];
  // Claude agents (claude-runtime-features): hide what the adapter reports as unsupported.
  const agent = useMemo(() => agentFeaturesOf(session), [session]);
  const claudeAgent = !!session && runtimeOf(session) === "claude";
  // Fast mode where the model offers a Fast tier and the choice survives restarts: Codex through cutex
  // `session-fast-mode`, Claude through its adapter (`fastMode`: Claude Code fast mode, kept per thread).
  const fastTier = (claudeAgent ? claudeFastMode(agent) : fastFeature) ? (modelInfo?.fastTier ?? null) : null;
  // The model that actually answered (Claude adapters with modelObservation), when it differs from the selection.
  const observedModel = useObservedModel(sessionId, agent, online, timeline, currentModel);
  // A Claude alias shown by its model already says which model answered (Sonnet 5.5 = claude-sonnet-5-5).
  const observedIsShown = !!(claudeName && observedModel && models && claudeShortName(models.map((m) => ({ id: m.model, displayName: m.displayName })), observedModel, t) === claudeName);
  // 额度用完 · HH:MM 自动继续 · 取消 (claude-quota-auto-continue, lib/quotaContinue).
  const quotaApplies = useApp((s) => featuresOf(s, hostId).has(QUOTA_CONTINUE_FEATURE)) && !!session && runtimeOf(session) === "claude";
  const quotaView = useQuotaContinue(hostId, sessionId, quotaApplies);
  // 额度用完 · 有 N 张重置券 · 用一张 (profile-reset-credits): read only once a window is used up.
  const composerQuotas = useHostQuotas(hostId);
  const loadComposerQuota = useHostLoadQuota(hostId);
  const resetsFeature = useApp((s) => featuresOf(s, hostId).has(RESET_CREDITS_FEATURE));
  const showResetOffer = useResetOffer(hostId, profile, resetsFeature && !!profile && (quotaExhausted(profile ? composerQuotas[profile] : undefined) || !!quotaView?.pending));
  // 升级运行时 (claude-runtime-repin, lib/claudeRepin): keep the open Claude agent's runtime view cached for the agent menu.
  // Not needed when the agent list carries the pin (cutex session-claude-runtime).
  const repinOn = useApp((s) => repinApplies(featuresOf(s, hostId), session) && !pinInSession(session, sidebarOf(s, hostId)?.claudeRuntime));
  useClaudeRuntimePreload(() => hostApi(hostId), hostId, sessionId, repinOn, session?.runtime.status);
  // Windows sandbox readiness (windows-sandbox-readiness): asked when the permission menu opens.
  const hostPlatform = useHostPlatform(hostId);
  const winSandboxApplies = useApp((s) => featuresOf(s, hostId).has(WINDOWS_SANDBOX_FEATURE)) && hostPlatform === "windows" && !!session && runtimeOf(session) === "codex" && online;
  const winSandbox = useSessionWindowsSandbox(sessionId, winSandboxApplies, timeline?.windowsSandboxSetup);
  // Network / extra writable directories of this running agent (session-sandbox-extras).
  const liveExtrasFeature = useApp((s) => featuresOf(s, hostId).has(SESSION_SANDBOX_EXTRAS_FEATURE));
  const liveExtras = !isAcpAgent(agent) && liveExtrasApply({ feature: liveExtrasFeature, claude: !!session && runtimeOf(session) === "claude", online, settings });
  const noSteer = lacks(agent, "turnSteer");
  const cannotInsert = noSteer || (!!delegation && !canJoin);
  // image-input-steering (lib/imageSteer): what an explicit 插话 with images does on this agent.
  const imageSteerFeature = features.has(IMAGE_INPUT_STEERING_FEATURE);
  const imageSteering = imageSteerMode(features, session);
  // Claude agents whose adapter offers Claude Code's own modes (lib/claudePermissionModes).
  const claudeModes = useMemo(() => claudeModesOf(agent), [agent]);
  const claudeMode = claudeModes ? claudeModeOf(settings) : null;
  const claudeRulesFeature = useApp((s) => featuresOf(s, hostId).has(CLAUDE_PERMISSION_RULES_FEATURE)) && agent.map?.permissionRules === true;
  const [toolbarRef, toolbarFlags] = useSizeFlags(TOOLBAR_SIZES);
  // Skill picker source: Codex catalog, the Claude agent's own managed catalog (cutex claude-session-skills), or none.
  const sessionSkillsCap = useApp((s) => featuresOf(s, hostId).has(CLAUDE_SESSION_SKILLS_CAPABILITY));
  const skillsFrom = skillSource(agent, { has: (f) => f === CLAUDE_SESSION_SKILLS_CAPABILITY && sessionSkillsCap });
  const noSkills = skillsFrom === null;
  const skillsImport = useApp((s) => featuresOf(s, hostId).has(CLAUDE_SKILLS_IMPORT_FEATURE)) && skillsFrom === "claude";
  const unsupportedHint = t("composer.tools.agentUnsupported");
  // A model missing from the list (stale catalog, list not loaded) is unknown, not text-only:
  // allow images and let the native refuse them.
  const canImages = (modelInfo ? !!modelInfo.inputModalities?.includes("image") : true) && !lacks(agent, "imageInput");
  // The images go to the composer's host (the open agent's), not the focus host.
  const imagePickBlocked = useImagePickBlocked(hostId);
  // users-p2-access: a non-owner attaches images only with send (main uploads them, cutex refuses any
  // other image input of a non-owner); an older host refuses them all.
  const imagesAllowed = useP2Access(hostId).attachments;
  const hostRow = useApp((s) => sidebarOf(s, hostId)?.hostRows[sessionId]);
  const projectSummary = useApp((s) => (hostRow?.projectId ? sidebarOf(s, hostId)?.projects?.projects.find((p) => p.project_id === hostRow.projectId) : undefined));
  // Older snapshots omit the canonical Operator projection; then the identity
  // stays unknown rather than being inferred from a broader capability.
  const projectOperatorIds = useApp((s) => hostRow?.projectId ? sidebarOf(s, hostId)?.projectOperators?.[hostRow.projectId] : undefined);
  const project = hostRow?.projectId ? { id: hostRow.projectId, name: projectSummary?.presentation.display_name ?? hostRow.projectId } : null;
  const isDirector = projectSummary ? projectSummary.director_cutex_session_id === sessionId : hostRow?.projectId ? null : false;
  const identityRole = approvalIdentityRole(isDirector, projectOperatorIds, sessionId);
  const ruleCapabilityFacts = useMemo(() => ({
    formalAgent: session ? !isQuickChat(session, hostRow) : null,
    hostFeatures: features,
    isDirector,
    declaredTools: declaredCutexTools(session?.native.schema),
    agentCreate: declaredAgentCreate(session?.native.schema),
  }), [session, hostRow, features, isDirector]);
  const cutexRulesProps = useMemo(() => approvalRulesFeature ? {
    hostId,
    api: hostApi(hostId),
    sessionId,
    displayName: name,
    profile,
    projectId: project?.id ?? null,
    runtimeGeneration,
    turnId: timeline?.activeTurnId ?? null,
    capabilityFacts: ruleCapabilityFacts,
    identityRole,
    onOpenProject: project ? () => services.ui.openPage("projects.page", { project: project.id, ...hostPageParam(hostId) }) : undefined,
  } : undefined, [approvalRulesFeature, hostId, sessionId, name, profile, project?.id, runtimeGeneration, timeline?.activeTurnId, ruleCapabilityFacts, identityRole]);

  // ---------- palette / mention state ----------
  const query = paletteDismissed === text ? null : paletteQuery(text);
  const paletteOpen = query !== null;
  const loadSkills = () => {
    const cwd = session?.cwd;
    const request = skillsFrom === "claude" ? hostApi(hostId).sessionSkills(sessionId) : hostApi(hostId).codexRequest("skills/list", cwd ? { cwds: [cwd] } : {});
    request.then(
      (r) => {
        setSkillsError(null);
        setAllSkills((r as SkillsListResponse).data.flatMap((e) => e.skills));
      },
      (e: unknown) => {
        setSkillsError(e instanceof Error ? e.message : String(e));
        setAllSkills((prev) => prev ?? []);
      },
    );
  };
  useEffect(() => {
    if (!paletteOpen || allSkills) return;
    loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, allSkills, session?.cwd]);
  const skills = useMemo(() => allSkills?.filter((s) => s.enabled) ?? null, [allSkills]);
  // English keywords: the en catalog loads when the palette first opens (i18n); the list ranks again when it arrives.
  const enCatalog = useEnglishCatalog(paletteOpen);
  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (query === null) return [];
    const skillItems: PaletteItem[] = noSkills ? [] : (skills ?? []).map((s) => ({ key: `skill:${s.path}`, kind: "skill", name: s.name, description: s.interface?.shortDescription ?? s.shortDescription ?? s.description, skill: s }));
    return rankEntries(query, [...commandEntries(t, features, agent, busy, enCatalog), ...skillItems]);
  }, [query, skills, t, features, agent, busy, noSkills, enCatalog]);

  const mention = mentionAt(text, caret);
  const mentionOpen = !!mention && !paletteOpen && mentionDismissed !== mention.start;
  const mentionSidebar = useApp(s => s.sidebar);
  const mentionByHost = useApp(s => s.byHost);
  const mentionHosts = useApp(s => s.hosts);
  const mentionDaemon = useApp(s => s.daemon);
  const mentionAgents = useMemo(() => {
    if (!mentionOpen) return [];
    const focus = mentionHosts?.active ?? "local";
    const ids = new Set([focus, ...(mentionHosts?.hosts?.map(host => host.id) ?? Object.keys(mentionByHost ?? {}))]);
    return agentMentionCandidates([...ids].map(id => ({ id, label: mentionHosts?.hosts.find(host => host.id === id)?.label ?? id,
      connected: (id === focus ? mentionDaemon : mentionByHost?.[id]?.daemon)?.kind === "connected",
      sidebar: id === focus ? mentionSidebar : mentionByHost?.[id]?.sidebar ?? null,
    })), hostId, sessionId, mention?.query ?? "");
  }, [mentionOpen, mention?.query, mentionSidebar, mentionByHost, mentionHosts, mentionDaemon, hostId, sessionId]);
  useEffect(() => {
    setMentionResults(null);
    if (!mentionOpen || !mention?.query || !features.has("workspace-fs")) return;
    return startMentionSearch(mention.query,
      (q) => hostApi(hostId).fsSearch({ kind: "session", id: sessionId }, q, 20).then((r) => r.results.map((x) => x.path)),
      setMentionResults);
  }, [mentionOpen, mention?.query, sessionId, hostId, features]);
  const mentionPaths = mentionPathsFor(mentionResults, mentionOpen ? mention?.query ?? null : null);
  const popupCount = paletteOpen ? paletteItems.length : mentionOpen ? mentionAgents.length + mentionPaths.length : 0;
  const selectedCandidate = candidateIndex(selected, popupCount) ?? 0;
  // Reset on a changed list, not on an unrelated sidebar refresh returning equivalent entries.
  const candidateListKey = JSON.stringify(paletteOpen ? paletteItems.map((item) => item.key) : [...mentionAgents.map(agent => agent.id), ...mentionPaths]);
  useEffect(() => setSelected(0), [query, mention?.query, candidateListKey]);

  // ---------- slash dispatch ----------
  const ctx: SlashContext = {
    online,
    hasGoal: !!timeline?.goal,
    planActive: collabMode === "plan",
    features,
    agent,
    busy,
    open(target) {
      if (POPOVERS.has(target)) setPopoverSignal({ kind: target as PopoverKind, nonce: Date.now() });
      else if (PANELS.has(target)) setPanel(target as PanelKind);
      else signalHere(target);
    },
    insert: (value) => {
      setText(value);
      win.requestAnimationFrame(() => textarea.current?.focus());
    },
    notify: (key, vars) => notifyHere(t(key, vars)),
    submitText: async (value) => void (await submit(value, busy ? "queue" : "auto", [], { sessionId, hostId })),
    compact: () => compact(sessionId, hostId),
    // Like the TUI: a new objective over an unfinished goal asks first (in the goal card); over a
    // finished one it just starts fresh.
    setGoal: async (objective) => {
      const goal = timeline?.goal;
      if (goal && goal.status !== "complete") signalHere("goal", `replace:${objective}`);
      else await useApp.getState().replaceGoal(objective, sessionId, hostId);
    },
    goalVerb: async (verb) => {
      if (verb === "edit") return signalHere("goal", "edit");
      if (verb === "clear") return useApp.getState().clearGoal(sessionId, hostId);
      return useApp.getState().setGoal({ status: verb === "pause" ? "paused" : "active" }, sessionId, hostId);
    },
    review: (instructions) => useApp.getState().startReview(instructions, sessionId, hostId),
    setPlan: (on) => setCollabMode(on ? "plan" : "default", sessionId, hostId),
    rename: async (value) => void (session && (await renameAgent(session, t, value))),
    archive: async () => void (session && (await archiveAgent(session, t))),
    fork: () => useApp.getState().forkSession(sessionId, null, hostId),
    side: (text) => void openSide(SIDE_CHAT_COMPONENT, { text }, { focus: true }),
    newAgent: () => services.ui.openPage("agent-config.newAgent", hostRow?.projectId ? { project: hostRow.projectId, host: hostId } : { host: hostId }),
    openDiff: () => void openChanges(),
    stopBackground: () => useApp.getState().stopBackgroundTerminals(sessionId, hostId),
    copyLast: async () => {
      const last = timeline ? lastAssistantText(orderedEntries(timeline)) : null;
      if (!last) return false;
      await navigator.clipboard.writeText(last);
      return true;
    },
    exportMarkdown: async () => {
      if (!timeline) return;
      const names = new Map([...(sidebarOf(useApp.getState(), hostId)?.active ?? []), ...(sidebarOf(useApp.getState(), hostId)?.retired ?? [])].map((s) => [s.cutexSessionId, s.displayName]));
      // History pages: export the whole thread, not just the turns loaded so far.
      const full = (await useApp.getState().completeTimeline(sessionId, hostId)) ?? timeline;
      const md = timelineToMarkdown(name, orderedEntries(full), {
        user: t("export.user"),
        assistant: name,
        from: (n, sender) => t("export.from", { name: senderLabel(t, sender?.id, sender?.sourceKind, n) }),
        to: (n) => t("export.to", { name: n }),
        review: t("export.review"),
        reviewTarget: t("export.reviewTarget"),
        plan: t("export.plan"),
      }, (id) => names.get(id) ?? id);
      const path = await api.saveMarkdown(`${name}.md`, md);
      if (path) notifyHere(t("slash.notice.exported", { path }));
    },
    openSettings: (tab) => {
      // Host pages open on the agent's host (the settings host picker; reset when Settings closes).
      if (hostId !== (useApp.getState().hosts?.active ?? "local")) setSettingsHost(hostId);
      if (tab === "logout") useApp.getState().openSettings("profiles", { profile: profile ?? undefined, anchor: "account" });
      else useApp.getState().openSettings(tab);
    },
  };

  const run = async (id: Parameters<typeof runSlash>[0], args: string) => {
    try {
      await runSlash(id, args, ctx);
    } catch (e) {
      // A busy Claude agent's refusal of /fork (lib/structuralGate) is information, not a failure.
      const { text, refused } = structuralErrorText(e);
      notifyHere(text, refused ? "info" : "error");
    }
  };

  const focusEnd = () =>
    win.requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      setCaret(el.value.length);
    });

  /** Put `$name` in the draft and bind it as a skill input (palette: replaces the `/query`; "+": appends). */
  const pickSkill = (skill: SkillMetadata, mode: "replace" | "append") => {
    const token = `$${skill.name} `;
    setPickedSkills((prev) => [...prev, { name: skill.name, path: skill.path }]);
    if (mode === "replace") return setText(token);
    setText((prev) => appendToken(prev, token));
    focusEnd();
  };

  const pickPalette = (index: number, viaTab = false) => {
    const item = paletteItems[index];
    if (!item) return;
    if (item.kind === "skill" && item.skill) return pickSkill(item.skill, "replace");
    const spec = slashSpec(item.name)!;
    if (viaTab || spec.pick === "insert") {
      setText(`/${spec.id} `);
      return;
    }
    setText("");
    void run(spec.id, "");
  };

  const pickMention = (index: number) => {
    if (!mention) return;
    const agent = mentionAgents[index];
    const path = mentionPaths[index - mentionAgents.length];
    if (!agent && !path) return;
    const next = agent ? (() => {
      const inserted = agentMentionInsert(agent, hostId);
      const after = text.slice(mention.end);
      const separator = after.startsWith(" ") ? "" : " ";
      return { text: text.slice(0, mention.start) + inserted + separator + after, caret: mention.start + inserted.length + separator.length };
    })() : insertMention(text, mention, path!);
    setText(next.text);
    setCaret(next.caret);
    win.requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  // ---------- images ----------
  const addImageFiles = async (files: File[]) => {
    const target = captureDraft();
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return false;
    if (!imagesAllowed) {
      notifyHere(t("users.access.noImages"), "error");
      return true;
    }
    if (!canImages) {
      notifyHere(t("composer.image.unsupported"), "error");
      return true;
    }
    for (const file of imgs) {
      const url = await imageFileToDataUrl(file, maxImageBytes(agent));
      if (!url) {
        notifyHere(t("composer.image.tooLarge", { name: file.name || "image" }), "error");
        continue;
      }
      target.setImages((prev) => [...prev, { id: `img-${++imageSeq}`, name: file.name || "image", preview: url, source: { kind: "data", url } }]);
    }
    return true;
  };
  const pickImages = async () => {
    const target = captureDraft();
    try {
      // Picked on the agent's host's connection (a remote host uploads only the files it handed out).
      for (const p of await hostApi(hostId).pickImages(maxImageBytes(agent))) {
        if (p.error) notifyHere(t(p.error === "tooLarge" ? "composer.image.tooLarge" : "composer.image.unreadable", { name: p.name }), "error");
        else target.setImages((prev) => [...prev, { id: `img-${++imageSeq}`, name: p.name, preview: p.preview, pickedLocally: true, source: { kind: "path", path: p.path } }]);
      }
    } catch (e) {
      notifyHere(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void addImageFiles(files);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragOver(false);
    // Rows of the 文件 explorer: their paths as mentions (lib/workspaceDrag).
    if (e.dataTransfer.types.includes(WORKSPACE_PATHS_MIME)) {
      e.preventDefault();
      const paths = parseDraggedPaths(e.dataTransfer.getData(WORKSPACE_PATHS_MIME));
      if (paths.length) useApp.getState().insertIntoComposer(sessionId, mentionText(paths), "append", undefined, hostId);
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length === 0) return;
    e.preventDefault();
    void addImageFiles(files);
  };

  // ---------- send ----------
  // Idle → "auto" (start), busy → "queue" (after current turn). cutex with queue-idle-start would
  // also start an idle "queue" submit (unless the queue is paused); older cutex would leave it
  // queued. "auto" while busy = steer into the running turn; "interrupt" stops the turn and sends
  // this instead (Ctrl+Shift+Enter).
  const interruptAndSendSteers = async () => {
    try {
      await useApp.getState().interruptAndSendSteers(sessionId, hostId);
    } catch (e) {
      notifyHere(queueActionNotice(e, t), "error");
    }
  };

  // Esc elsewhere in the conversation (not in the textarea, whose onKeyDown below handles it):
  // same actions; a delegation turn wants a second Esc (lib/escInterrupt.ts).
  useConversationEsc(
    {
      preset: sendKeys,
      turnId: busy ? (timeline?.activeTurnId ?? null) : null,
      pendingSteers: pendingSteers?.length ?? 0,
      delegation: !!delegation,
      blocked: !!panel || popupCount > 0 || (timeline?.pending.size ?? 0) > 0,
      focused,
    },
    {
      arm: () => notifyHere(t("composer.escAgainDelegation")),
      act: (action) => void (action === "interrupt" ? interruptWithFeedback(t, sessionId, hostId) : interruptAndSendSteers()),
    },
  );

  // The tray's per-item 插入 during a delegation turn (setting off): 加入此委托 (with the warning) or
  // keep it queued — the same guard as the steer shortcuts.
  const sendQueuedNow = async (item: QueueItem) => {
    // This agent, as of the click: the confirm below may stay open while the owner switches agents.
    const agentId = sessionId;
    const joinDelegation = delegation ? joinIntent : undefined;
    if (delegation && !canJoin) throw new Error(t("queue.steer.joinChanged"));
    if (queueSendNowMode(guardKeys) === "confirm") {
      const join = await confirmDialog(t("delegationTurn.joinQueuedConfirm", { text: queueItemText(item).slice(0, 80) }), false, {
        ok: t("delegationTurn.choice.join"),
        cancel: t("delegationTurn.keepQueued"),
      });
      if (!join) return;
    }
    await queueSendNow(item, agentId, hostId, joinDelegation);
  };

  // 「全部合并插入」: the same delegation-turn guard as 插入, then one merged insert.
  const mergeQueuedNow = async (list: QueueItem[]) => {
    const agentId = sessionId;
    const joinDelegation = delegation ? joinIntent : undefined;
    if (delegation && !canJoin) throw new Error(t("queue.steer.joinChanged"));
    if (queueSendNowMode(guardKeys) === "confirm") {
      const join = await confirmDialog(t("delegationTurn.joinQueuedConfirm", { text: list.map(queueItemText).join(" / ").slice(0, 80) }), false, {
        ok: t("delegationTurn.choice.join"),
        cancel: t("delegationTurn.keepQueued"),
      });
      if (!join) return;
    }
    await useApp.getState().queueMergeInsert(list, agentId, hostId, joinDelegation);
  };

  const pausedAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (e) {
      notifyHere(queueActionNotice(e, t), "error");
    }
  };

  /** `explicit`: an explicit 插话 (Ctrl+Enter), not the 插话优先 preset's plain Enter (lib/imageSteer draftSteerPlan). */
  const send = async (how: "send" | "steer" | "join" | "queue" | "interruptSend", enterDecision?: (decision: EnterDecision) => void, explicit = false) => {
    const trimmed = text.trim();
    if (!trimmed && images.length === 0) { enterDecision?.("no-content"); return; }
    if (sending) { enterDecision?.("interrupt-busy"); return; }
    const command = images.length === 0 ? parseSlash(trimmed) : null;
    if (command) {
      enterDecision?.("command");
      setText("");
      await run(command.id, command.args);
      return;
    }
    const draft = text;
    // A message sent after a jump: 回到 goes away (§19.7).
    noteSent(sessionId);
    // The timeline goes to the bottom and follows the new bubble / queue entry (lib/stickToBottom).
    followAfterSend(sessionId);
    const extra: ExtraInput[] = [...imageInputItems(images), ...(noSkills ? [] : boundSkills(text, pickedSkills)).map((s) => ({ type: "skill" as const, name: s.name, path: s.path }))];
    // No same-turn steering (Claude): a steer waits in the queue instead (cutex would queue it too).
    const wantsJoin = how === "join" || (how === "steer" && !!delegation);
    const joinDelegation = wantsJoin && canJoin && !noSteer ? joinIntent : undefined;
    const strategy = wantsJoin
      ? (joinDelegation && !noSteer ? "auto" : "queue")
      : strategyFor(steerAction(how, agent), sendBusy);
    if (wantsJoin && !joinDelegation) notifyHere(t(noSteer ? "queue.steer.runtimeNoSteer" : "queue.steer.joinChanged"), "error");
    // Images while a turn runs (image-input-steering): cutex queues an ordinary send by default; an explicit
    // 插话 steers the queued item at once, or — the runtime cannot insert images — stays queued and says so.
    const imagePlan = how === "steer" && explicit && !wantsJoin && strategy === "auto"
      ? draftSteerPlan({ feature: imageSteerFeature, busy: sendBusy, images: hasImageInput(extra), mode: imageSteering })
      : "plain";
    if (imagePlan === "refuse") notifyHere(t("queue.steer.imageUnsupported"));
    // Optimistic (lib/outbox): the draft leaves the composer at once and shows up where it will land
    // (queue tray / steers / timeline) as 发送中…; a failure stays there with retry / edit / discard.
    clearDraft();
    // Ctrl+Shift+Enter with steers waiting: they and this text go out as one message (no pause).
    if (strategy === "interrupt" && features.has("queue-pause") && pendingSteers?.some((p) => (p.state ?? "waiting") === "waiting")) {
      setSending(true);
      try {
        enterDecision?.("dispatched");
        await useApp.getState().interruptAndSend(draft, extra, sessionId, hostId);
      } catch (e) {
        // Not stopped: the store put the text back into the composer.
        notifyHere(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setSending(false);
      }
      return;
    }
    enterDecision?.("dispatched");
    void submit(draft, imagePlan === "refuse" ? "queue" : strategy, extra, { sessionId, hostId, joinDelegation, ...(imagePlan === "queueThenSteer" ? { steerImages: true } : {}) }).catch(() => {});
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const eventLagMs = e.key === "Enter" ? performance.now() - e.timeStamp : 0;
    const report = (decision: EnterDecision) => {
      if (e.key === "Enter") traceEnter({ decision, composing: isImeComposing(e),
        ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey,
        hasContent: !!text.trim() || images.length > 0, eventLagMs });
    };
    const candidate = composerCandidateKey({ key: e.key, shift: e.shiftKey, isComposing: isImeComposing(e) }, popupCount, selected);
    if (candidate === "composing") { report("ime-confirm"); return; }
    if (popupCount > 0 || paletteOpen || mentionOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (popupCount > 0) setSelected((i) => ((candidateIndex(i, popupCount) ?? 0) + (e.key === "ArrowDown" ? 1 : popupCount - 1)) % popupCount);
        return;
      }
      if (candidate) {
        e.preventDefault();
        report(paletteOpen ? "palette-pick" : "mention-pick");
        if (paletteOpen) pickPalette(candidate.index, e.key === "Tab");
        else pickMention(candidate.index);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (paletteOpen) setPaletteDismissed(text);
        else if (mention) setMentionDismissed(mention.start);
        return;
      }
    }
    // A right-side layer in front (maximised / full screen / narrow drawer) takes this Esc first (App).
    if (e.key === "Escape" && (panel || anyOverlayOpen() || sideLayersActive())) return;
    const el = textarea.current;
    if (!el) return;
    const keyAction = composerKeyAction(
      sendKeys,
      { key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey },
      { busy, hasContent: !!text.trim() || images.length > 0, pendingSteers: pendingSteers?.length ?? 0, collapsedSelection: el.selectionStart === el.selectionEnd },
    );
    if (!keyAction) { report(e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey ? "newline" : "unhandled"); return; }
    const action = delegationKeyAction(keyAction, guardKeys);
    e.preventDefault();
    if (action === "interrupt") { report("dispatched"); void interruptWithFeedback(t, sessionId, hostId); }
    else if (action === "interruptSendSteers") { report("dispatched"); void interruptAndSendSteers(); }
    else void send(action, report, action === "steer" && (e.ctrlKey || e.metaKey));
  };

  const paletteRows: PaletteRow[] = paletteItems.map((item) => ({
    key: item.key,
    label: `${item.kind === "skill" ? "$" : "/"}${item.name}`,
    description: item.disabledReason ? `${item.description} · ${item.disabledReason}` : item.description,
    disabled: !!item.disabledReason,
    tag: item.kind === "skill" ? t("slash.skillTag") : undefined,
  }));
  const mentionRows: PaletteRow[] = [...mentionAgents.map(agent => ({
    key: `agent:${agent.id}`, label: agent.label, group: t("mention.agents"),
    description: `${agent.sameProject ? t("mention.sameProject") + " · " : ""}${t(`mention.${agent.presence}`)}`,
    ariaLabel: t("mention.agentMention", { name: agent.label }) + ` · ${t(`mention.${agent.presence}`)}`,
    icon: <Avatar name={agent.name} seed={agent.id} avatar={agent.session.avatar} size={20} status={{presence:agent.presence}} />,
  })), ...mentionPaths.map((p) => {
    const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return { key: `file:${p}`, group: t("mention.title"), label: slash >= 0 ? p.slice(slash + 1) : p, description: slash >= 0 ? p.slice(0, slash) : undefined };
  })];

  const statusRows = (): StatusRow[] => {
    const usage = timeline?.contextUsage;
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    return [
      { label: t("slash.status.model"), value: modelShown ? (currentModel && modelShown !== currentModel ? `${modelShown} (${currentModel})` : modelShown) : "—" },
      { label: t("slash.status.effort"), value: currentEffort ? t(`composer.effort.${currentEffort}` as MessageKey) : "—" },
      { label: t("slash.status.permissions"), value: mode ? t(`composer.mode.${mode}` as MessageKey) : "—", tone: mode === "full" ? "warn" : undefined },
      { label: t("slash.status.collab"), value: t(collabMode === "plan" ? "composer.collab.plan" : "composer.collab.default"), tone: collabMode === "plan" ? "accent" : undefined },
      { label: t("slash.status.profile"), value: profile ?? t("composer.quota.noProfile") },
      { label: t("slash.status.cwd"), value: settings?.cwd ?? session?.cwd ?? "—" },
      { label: t("slash.status.context"), value: usage?.window ? `${k(usage.used)} / ${k(usage.window)} (${Math.round((usage.used / usage.window) * 100)}%)` : "—" },
      { label: t("slash.status.goal"), value: timeline?.goal ? `${timeline.goal.objective} · ${t(`goal.status.${timeline.goal.status}` as MessageKey)}` : "—" },
      { label: t("slash.status.runtime"), value: session ? `${session.runtime.status}${busy ? ` · ${t("slash.status.busy")}` : ""}` : "—" },
      { label: t("slash.status.thread"), value: timeline?.threadId ?? "—" },
    ];
  };

  const planAvailable = !!collabModes?.some((m) => m.mode === "plan");
  const setPlan = async (on: boolean) => {
    try {
      // null = stale (selection / host changed meanwhile): nothing to report.
      if ((await setCollabMode(on ? "plan" : "default", sessionId, hostId)) === false) notifyHere(t("slash.notice.planUnavailable"), "error");
    } catch (e) {
      notifyHere(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const sig = (kind: PopoverKind) => (popoverSignal?.kind === kind ? popoverSignal.nonce : 0);
  const hasContent = !!text.trim() || images.length > 0;
  // 暂停智能体 (agent-pause): a send queues; 继续并发送 resumes first.
  const agentPause = useAgentPause(hostId, sessionId);
  return (
    <div className="side-col side-col-composer flex min-h-0 w-full flex-col px-4 pb-3">
      {importingSkills && <ClaudeSkillsImportDialog hostId={hostId} onClose={() => setImportingSkills(false)} onImported={loadSkills} />}
      {/* 在主界面调整: the input card is the 输入区 region (its panel opens above it, components/CustomizeHost). */}
      <div className="group/inputcard relative flex min-h-0 flex-col rounded-inner" data-customize-region="composer">
        {paletteOpen && (
          <SlashPalette
            title={t("slash.title")}
            rows={paletteRows}
            selected={selectedCandidate}
            empty={t("slash.empty")}
            footer={t("slash.footer")}
            onHover={setSelected}
            onPick={(i) => pickPalette(i)}
          />
        )}
        {mentionOpen && (
          <SlashPalette
            title={t("mention.menuTitle")}
            listId={mentionListId}
            rows={mentionRows}
            selected={selectedCandidate}
            empty={mention?.query && features.has("workspace-fs") && mentionResults?.query !== mention.query ? t("common.loading") : t("mention.empty")}
            footer={t("mention.footer")}
            onHover={setSelected}
            onPick={pickMention}
          />
        )}
        {panel === "status" && <StatusPanel rows={statusRows()} onClose={() => setPanel(null)} />}
        {panel === "memories" && timeline?.threadId && <MemoriesPanel sessionId={sessionId} threadId={timeline.threadId} onClose={() => setPanel(null)} />}
        {panel === "projectMemory" && project && <ProjectMemoryPanel projectId={project.id} projectName={project.name} onClose={() => setPanel(null)} />}
        {panel === "experimental" &&<ExperimentalPanel sessionId={sessionId} threadId={timeline?.threadId ?? null} onClose={() => setPanel(null)} />}
        {/* Queue tray: a card stacked on the input box (the box overlaps its bottom edge), outside the input. */}
        <QueuePanel
          sessionId={sessionId}
          hostId={hostId}
          runtime={claudeRecipient ? "claude" : "codex"}
          imageSteering={imageSteering}
          steers={shownSteers}
          sendingSteers={outboxAt(outbox, "steer")}
          sendingQueue={outboxAt(outbox, "queue")}
          timelineSends={outboxAt(outbox, "turn")}
          outbox={{
            onRetry: (id) => useApp.getState().retrySend(sessionId, id, hostId),
            onEdit: (id) => useApp.getState().editSend(sessionId, id, hostId),
            onDiscard: (id) => useApp.getState().discardSend(sessionId, id, hostId),
          }}
          onInterruptSendSteers={() => void interruptAndSendSteers()}
          onDismissSteer={(id) => useApp.getState().dismissSteer(id, sessionId, hostId)}
          onRecheckSteer={(id) => void useApp.getState().recheckSteer(id, sessionId, hostId)}
          paused={paused}
          pausedHint={hasContent ? t(busy && sendKeys !== "cli" && paused.items.length > 0 ? "paused.composerHintQueue" : "paused.composerHint", { n: paused.count }) : null}
          onResumePaused={() => void pausedAction(() => useApp.getState().resumePaused(sessionId, hostId))}
          onRestorePaused={() => void pausedAction(() => useApp.getState().restorePaused(sessionId, hostId))}
          onClearPaused={() => void pausedAction(() => useApp.getState().discardPaused(sessionId, hostId))}
          items={shownQueue}
          canEdit={!text.trim()}
          onSendNow={cannotInsert && sendBusy ? undefined : (item) => void sendQueuedNow(item).catch((e: unknown) => notifyHere(queueActionNotice(e, t), "error"))}
          onMergeInsert={ledgerMode && !(cannotInsert && sendBusy) ? (list) => mergeQueuedNow(list).catch((e: unknown) => notifyHere(queueActionNotice(e, t), "error")) : undefined}
          sendNowStartsTurn={!sendBusy}
          onDelete={(item) => void queueRemove(item, sessionId, hostId).catch((e: unknown) => notifyHere(queueActionNotice(e, t), "error"))}
          onEdit={(item) => void queueTakeForEdit(item, sessionId, hostId)}
          stripEnabled={queueSectionStrip}
          autoCompact={queueAutoCompact(queuePanelFold, shortWindow)}
          stopHold={stopHold}
          running={busy}
          ordered={
            groups && admission
              ? {
                  turns: groups.turns,
                  nextStep,
                  ridealongsHeld: admission.ridealongsHeld,
                  ownerYielded: admission.ownerYielded,
                  onYield: features.has(OWNER_YIELD_FEATURE) ? () => void useApp.getState().queueYield(sessionId, hostId).catch((e: unknown) => notifyHere(queueActionNotice(e, t), "error")) : undefined,
                  running: busy,
                  runningSince: activeTurnStart === null ? null : activeTurnStart * 1000,
                  currentTurn: currentTurnOf(busy, admission.currentTurn, delegation?.askId ?? null),
                  sessionId,
                  // Dropping onto 「下个工具边界」 = 插入 (the same path as the row's button).
                  onInsert: cannotInsert && sendBusy ? undefined : (item: QueueItem) => void sendQueuedNow(item).catch((e: unknown) => notifyHere(queueActionNotice(e, t), "error")),
                  onMergeInsert: cannotInsert && sendBusy ? undefined : (list: QueueItem[]) => void mergeQueuedNow(list).catch((e: unknown) => notifyHere(queueActionNotice(e, t), "error")),
                  mayPass,
                  onMove: (item, before) =>
                    void useApp
                      .getState()
                      .queueMove(item, before, sessionId, hostId)
                      .catch((e: unknown) => {
                        if ((e as { moveRefusal?: string } | null)?.moveRefusal === "passingNotAllowed") reloadOwnerMayPassAsks();
                        notifyHere(queueActionNotice(e, t), "error");
                      }),
                  actions: orderedAsks ? <PauseAsksButton sessionId={sessionId} /> : null,
                }
              : undefined
          }
          sections={[
            // Slot 0: 待读留言 (agent messages v2). With admission-order the turn-starting ones are the turn
            // frame's ride-along items (admission.nextStep); passive notes (never there) stay here.
            !ledgerMode && sectionMessages.length > 0 ? { node: <PendingMessagesSection sessionId={sessionId} messages={sectionMessages} busy={busy} runtime={agent.runtime} readSince={lastFinishedTurnStart(timeline?.turns)} />, chip: { kind: "messages", n: sectionMessages.length } } : null,
            // Slot 1: 待处理委托 (delegations; with admission-order only those the merged list does not have).
            !ledgerMode && otherDelegations.length > 0 ? { node: <DelegationQueueSection rows={otherDelegations} sessionId={sessionId} pauseButton={!orderedAsks} railed={!!groups} />, chip: { kind: "delegations", n: otherDelegations.length } } : null,
            // 智能体已暂停 · 继续 (agent-pause): before everything else that waits, since it holds all of it.
            agentPause ? { node: <AgentPausedSection hostId={hostId} sessionId={sessionId} railed={!!groups} />, chip: { kind: "agentPaused", warn: true } } : null,
            // Slot 2: 委托已暂停 · 继续 (asks-pause-v2).
            !ledgerMode && showAsksPaused ? { node: <AsksPausedSection sessionId={sessionId} railed={!!groups} />, chip: { kind: "asksPaused", warn: true } } : null,
            // Slot 3: 额度用完 · HH:MM 自动继续 · 取消 (claude-quota-auto-continue).
            quotaView?.pending ? { node: <QuotaContinueSection hostId={hostId} sessionId={sessionId} view={quotaView} />, chip: { kind: "quota", warn: true } } : null,
            // Slot 4: 额度用完 · 有 N 张重置券 · 用一张 (profile-reset-credits; confirm dialog first).
            showResetOffer && profile ? { node: <ResetOfferSection hostId={hostId} profile={profile} afterReset={() => void loadComposerQuota(profile, true)} />, chip: { kind: "quota", warn: true } } : null,
          ]}
        />
        <div
          // A file / workspace path over it: the accent border; 框线+底色 also tints it (lib/dropTint).
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes(WORKSPACE_PATHS_MIME)) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          data-gutter-anchor="composer"
          className={`relative rounded-inner border bg-surface px-3 py-2 focus-within:border-accent/60 ${INPUT_IN_CARD} ${dragOver ? `border-accent ${DROP_TINT}` : "border-border"}`}
          style={dragOver ? INPUT_DROP_TINT : undefined}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1 pb-1.5">
              {images.map((img) => (
                <div key={img.id} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-border bg-surface-2" title={img.name}
                  onContextMenuCapture={img.source.kind === "path" ? contextMenu(() => fileActions({ hostId: img.pickedLocally ? LOCAL_HOST_ID : hostId, path: img.source.kind === "path" ? img.source.path : "", knownLocal: img.pickedLocally }, t)) : undefined}>
                  {/* Click → full size, as for a sent image; a restored host path is read through cutex. */}
                  <ImageThumb
                    image={draftMessageImage(img)}
                    hostId={hostId}
                    title={img.name}
                    className="block h-full w-full"
                    imgClassName="h-full w-full object-cover"
                    fallback={<span className="flex h-full items-center justify-center text-caption/[inherit] text-subtle">{img.name}</span>}
                  />
                  <button
                    onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                    title={t("composer.image.remove")}
                    className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {delegation && <DelegationTurnHint turn={delegation} draft={hasContent} />}
          {overloadRetry?.phase === "pending" && <div role="status" className="pb-1.5 text-caption text-muted group-has-[[data-auto-retry-explained]]/inputcard:hidden" data-testid="composer-auto-retry-owner-order">
            {formatAutoRetryWait(t, overloadRetry, "queue.autoRetryOwnerOrder")}
          </div>}
          {agentPause && hasContent && <AgentPausedSendHint hostId={hostId} sessionId={sessionId} send={() => send("send")} />}
          {noSteerHintShown({ busy: busyLook, noSteer, hasContent, delegation: !!delegation, paused: !!agentPause }) && <NoSteerSendHint />}
          <div className="relative flex items-end gap-2">
            {delegation && !hasContent && <DelegationTurnOverlay turn={delegation} />}
            {useRichInput ? <AgentMentionInput
              data-composer-input
              ref={textarea as React.Ref<AgentMentionInputHandle>}
              value={text}
              onChange={(value, nextCaret) => { setText(value); setCaret(nextCaret); }}
              onSelect={setCaret}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              aria-label={t("mention.inputLabel")}
              role={mentionOpen ? "combobox" : "textbox"}
              aria-autocomplete={mentionOpen ? "list" : undefined}
              aria-expanded={mentionOpen ? true : undefined}
              aria-controls={mentionOpen ? mentionListId : undefined}
              aria-activedescendant={mentionOpen && popupCount > 0 ? `${mentionListId}-${selectedCandidate}` : undefined}
              placeholder={delegation ? "" : busyLook ? t(busyPlaceholderKey(noSteer)) : t("composer.placeholder", { name })}
              // Two lines + padding: exactly the textarea's rows={2} box, so the swap on the first @ does not jump (owner 2026-10-25).
              className="max-h-[min(15rem,var(--composer-input-max,15rem))] min-h-[calc(2lh+0.5rem)] min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words bg-transparent py-1 pr-2.5 outline-none"
            /> : <textarea
              data-composer-input
              aria-label={t("mention.inputLabel")}
              role={mentionOpen ? "combobox" : undefined}
              aria-autocomplete={mentionOpen ? "list" : undefined}
              aria-expanded={mentionOpen ? true : undefined}
              aria-controls={mentionOpen ? mentionListId : undefined}
              aria-activedescendant={mentionOpen && popupCount > 0 ? `${mentionListId}-${selectedCandidate}` : undefined}
              ref={textarea as React.Ref<HTMLTextAreaElement>}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={2}
              placeholder={delegation ? "" : busyLook ? t(busyPlaceholderKey(noSteer)) : t("composer.placeholder", { name })}
              className="max-h-[min(15rem,var(--composer-input-max,15rem))] flex-1 resize-none bg-transparent py-1 pr-2.5 outline-none placeholder:text-subtle"
            />}
            {/* Stop: a fixed round slot, empty while idle, so a turn starting or ending never changes the input's
                width (the 「■ 停止」 pill used to appear beside it and rewrap the draft; flicker recorder 2026-10-26). */}
            <span className="mb-0.5 flex size-7 shrink-0" data-stop-slot="">
              {busyLook && (
                <button
                  onClick={() => void interruptWithFeedback(t, sessionId, hostId)}
                  // Held through a turn boundary (no turn to stop for a moment): inert, looks the same.
                  disabled={!busy}
                  title={t("composer.stopHint")}
                  aria-label={t("composer.stop")}
                  className="flex size-7 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                >
                  <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden />
                </button>
              )}
            </span>
            {/* The send menu's slot (its 26 px chevron) stays for the whole delegation turn: the first keystroke and a send
                never change the input's width (flicker recorder 2026-10-26: ±34 px per draft). */}
            {delegation && (
              <span className="flex w-6.5 shrink-0 justify-center" data-delegation-menu-slot="">
                {hasContent && <DelegationSendMenu choices={delegationSendChoices(!noSteer && canJoin)} disabled={sending} onPick={(c) => void send(sendHowFor(c))} />}
              </span>
            )}
            {/* Send: a filled button (disabled while empty); Enter sends in both key presets (lib/sendKeys), the tooltip names it.
                Always there, also while a turn runs: the first keystroke / a send never shifts the input's width. */}
            <button
              onClick={() => void send(busy && sendKeys === "cli" ? (delegation && !delegationSteerKeys ? "queue" : "steer") : "send")}
              disabled={!hasContent || sending}
              title={`${delegation ? t("delegationTurn.choice.queue") : busy ? (sendKeys === "cli" && !noSteer ? t("composer.steerSend") : t("composer.queueSend")) : t("composer.send")} · Enter`}
              aria-label={delegation ? t("delegationTurn.choice.queue") : busy ? (sendKeys === "cli" && !noSteer ? t("composer.steerSend") : t("composer.queueSend")) : t("composer.send")}
              className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:bg-surface-2 disabled:text-subtle"
            >
              <ArrowUp size={15} strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </div>

      <ComposerToolbarRow sizeRef={toolbarRef} left={<>
        {/* Gutter items when the gutters are too narrow for them (§19.2). */}
        <ComposerTriggers hostId={hostId} sessionId={sessionId} side="left" />
        <ComposerTools
          canImages={canImages}
          imagePickBlocked={!imagesAllowed ? t("users.access.noImages") : imagePickBlocked ? t("remote.noAttachments") : null}
          canFiles={features.has("workspace-fs")}
          onPickImages={() => void pickImages()}
          onMention={() => {
            setText((prev) => appendToken(prev, "@"));
            focusEnd();
          }}
          skills={allSkills}
          skillsError={skillsError}
          onLoadSkills={loadSkills}
          skillRefDisabledReason={noSkills ? unsupportedHint : null}
          skillsManaged={skillsFrom === "claude"}
          onImportSkills={skillsImport ? () => setImportingSkills(true) : undefined}
          onInsertSkill={(s) => pickSkill(s, "append")}
          plan={{ available: planAvailable, on: collabMode === "plan", disabledReason: online ? null : t("composer.tools.needsOnline"), set: (on) => void setPlan(on) }}
          goal={{
            label: timeline?.goal ? t(`goal.status.${timeline.goal.status}` as MessageKey) : t("composer.tools.goal.unset"),
            disabledReason: lacks(agent, "goals") ? unsupportedHint : online ? null : t("composer.tools.needsOnline"),
            onClick: () => {
              if (timeline?.goal) return signalHere("goal");
              // Like `/goal` alone: put the command in the composer; an existing draft becomes the objective.
              setText((prev) => `/goal ${prev.trimStart()}`);
              focusEnd();
            },
          }}
          memory={{
            project,
            agentDisabledReason: lacks(agent, "memoryMode") ? unsupportedHint : online ? null : t("composer.tools.needsOnline"),
            onProject: () => setPanel("projectMemory"),
            onAgent: () => setPanel("memories"),
            onManage: () => {
              // The open agent's project: on its host.
              if (project) services.ui.openPage("projects.page", { project: project.id, tab: "memory", ...hostPageParam(hostId) });
              else if (online) setPanel("memories");
              else services.ui.openPage("projects.page", { tab: "memory" });
            },
          }}
          onManage={(tab) => useApp.getState().openSettings(tab)}
        />
        {isAcpAgent(agent) ? null : claudeModes ? (
          <Menu<ClaudeMode>
            title={t("composer.permissionTitle")}
            openSignal={sig("permissions")}
            trigger={<span data-guide-target="composer-mode" className={`trim-cap whitespace-nowrap ${claudeMode === "bypassPermissions" ? "text-warn" : ""}`}>{claudeMode ? t(`composer.claudeMode.${claudeMode}` as MessageKey) : runtimeDown ? "—" : "…"}</span>}
            items={claudeModes.map((m) => ({ value: m, label: t(`composer.claudeMode.${m}` as MessageKey), description: t(`composer.claudeModeHint.${m}` as MessageKey) }))}
            selected={claudeMode}
            onSelect={(m) => m !== claudeMode && void updateSettings(claudeModePatch(m, settings), sessionId, hostId)}
          />
        ) : (
        <Menu
          title={t("composer.permissionTitle")}
          openSignal={sig("permissions")}
          // nowrap: the chip never gives up width to a crowded toolbar by breaking 完全访问 mid-word; the model
          // name (truncate) and the right-hand group give way first.
          trigger={<span data-guide-target="composer-mode" className={`trim-cap whitespace-nowrap ${mode === "full" ? "text-warn" : ""}`}>{mode ? t(`composer.mode.${mode}` as MessageKey) : runtimeDown ? "—" : "…"}</span>}
          // What the mode name does not say: reviewer, network, extra directories (lib/permissionModes).
          triggerTitle={effective ? [t("composer.permissionTitle"), ...effectivePermissionLines(effective).map((line) => t(line.key, line.params)), ...effective.writableRoots].join("\n") : undefined}
          items={PERMISSION_MODES.map((m) => ({ value: m, label: t(`composer.mode.${m}` as MessageKey), description: t(`composer.modeHint.${m}` as MessageKey) }))}
          selected={mode}
          onSelect={(m) => m !== "custom" && void updateSettings(permissionPatch(m, settings), sessionId, hostId)}
          onOpen={winSandbox.load}
          footer={
            <>
              {effective && (
                <div className="mt-1 border-t border-border px-2.5 pt-1.5 pb-1">
                  <PermissionDetail effective={effective} editable={liveExtras} />
                </div>
              )}
              <ClaudeCodeSourcesNote hostId={hostId} sessionId={sessionId} />
              {liveExtras && effective && (
                <LiveSandboxExtras hostId={hostId} sessionId={sessionId} network={effective.network ?? false} roots={effective.writableRoots} />
              )}
              {winSandboxApplies && winSandbox.readiness && windowsSandboxWarns(hostPlatform, winSandbox.readiness, mode) && (
                <WindowsSandboxMenuNote readiness={winSandbox.readiness} phase={winSandbox.phase} onSetup={() => void winSandbox.setup()} />
              )}
            </>
          }
        />
        )}
        {/* One rules entry: Claude permissions beside Cutex rules, or Cutex alone for Codex. */}
        {(claudeAgent || approvalRulesFeature) && (
          <RulesChip
            hostId={hostId}
            sessionId={sessionId}
            claude={claudeAgent}
            {...(claudeAgent ? claudeToolSwitches(session?.runtimeDefaults as Record<string, unknown> | null | undefined) : { write: null, exec: null })}
            rulesFeature={claudeRulesFeature}
            cutex={cutexRulesProps}
            iconOnly={toolbarFlags.narrow}
          />
        )}
        {!isAcpAgent(agent) && collabMode === "plan" && (
          <button
            onClick={() => void setPlan(false)}
            title={t("composer.tools.planOff")}
            className="ml-0.5 flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs text-accent hover:bg-accent/25"
          >
            {t("composer.collab.plan")}
            <X size={11} />
          </button>
        )}
      </>} right={<>
          <ProfileQuota profile={profile} rateLimits={timeline?.rateLimits ?? null} rateLimitsAt={timeline?.rateLimitsObservedAt ?? null} sessionId={sessionId} busy={busy} openSignal={sig("quota")} />
          <ChipDivider />
          <ConversationModelControls runtime={agent.runtime} live={changesSettingsLive(agent)}
            model={{
              profile, models: modelItems, current: currentModel, unavailable: modelUnavailable,
              label: modelShown || (runtimeDown ? "—" : "…"),
              trigger: <span className="flex min-w-0 items-center gap-1">
                <span className="trim-cap max-w-40 truncate">{modelShown || (runtimeDown ? "—" : "…")}</span>
                {observedModel && observedModel !== currentModel && !observedIsShown && <span className="trim-cap max-w-28 truncate text-caption/[inherit] text-subtle" data-testid="observed-model">{shortModelId(observedModel)}</span>}
              </span>,
              triggerTitle: [runtimeDown ? `${t("composer.modelTitle")} · ${t("composer.model.offline")}` : currentModel && modelShown !== currentModel ? `${t("composer.modelTitle")} · ${currentModel}` : t("composer.modelTitle"), observedModel ? t("composer.model.observed", { model: observedModel }) : null].filter(Boolean).join("\n"),
              note: runtimeDown ? t("composer.model.offline") : observedModel ? t("composer.model.observed", { model: observedModel }) : undefined,
              onOpen: () => void loadModels(true, sessionId, hostId),
              onSelect: model => void updateSettings({ model }, sessionId, hostId),
              openSignal: sig("model"),
            }}
            effort={{
              effort: currentEffort, efforts,
              onChange: effort => void updateSettings({ effort }, sessionId, hostId),
              offline: runtimeDown ? t("composer.model.offline") : undefined,
              empty: effortsEmpty === "none" ? t("composer.effort.noneOffered") : effortsEmpty === "unlisted" ? t("composer.effort.unlisted") : undefined,
              onOpen: effortsEmpty === "unlisted" && !runtimeDown ? () => void loadModels(true, sessionId, hostId) : undefined,
              fast: fastTier && session ? { on: isFastTier(settings?.serviceTier, fastTier), onToggle: on => void updateSettings(fastModePatch(on, fastTier), sessionId, hostId) } : undefined,
            }} />
          <ContextMeter usage={timeline?.contextUsage ?? null} billingUnavailable={lacks(agent, "billingUsage")} canCompact={!lacks(agent, "compact")} onCompact={() => void compact(sessionId, hostId)} />
      </>} tail={<ComposerTriggers hostId={hostId} sessionId={sessionId} side="right" />} />
      {/* A reserved status line outside the input and toolbar. Notices neither cover other
          conversation controls nor change the input's geometry when they appear or disappear. */}
      <div className="flex h-5 min-w-0 items-center justify-end" data-testid="composer-notice-slot">
        {shownNotice && meantHere(shownNotice.agent, here, focused) && (
          <div role="status" title={shownNotice.text}
            className={`flex max-w-full min-w-0 items-center rounded border border-border bg-surface px-2 text-xs ${shownNotice.tone === "error" ? "text-danger" : "text-muted"}`}
            data-testid="composer-notice">
            <span className="min-w-0 truncate">{shownNotice.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}
