// Composer in the Claude desktop style: a clean input box (queued items, image thumbnails, text,
// stop + send) and a thin settings row beneath it.
//   left:  `+` (ComposerTools) · permission mode · plan chip · background-terminal count
//   right: quota rings (cutex per-profile gauges + codex rate limits) · "profile / model" chip (one
//          menu: profile switch on top, models below) · reasoning effort · context-window ring
// Quota and context are deliberately separate (unlike Claude, which merges them).
// `/` opens the command palette (lib/slashCommands), `@` the workspace file search (DESIGN §4.3).
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, X, Zap } from "lucide-react";
import type { QueueItem } from "@cutex-desktop/protocol";
import type { SkillMetadata, SkillsListResponse } from "@cutex-desktop/protocol/codex/v2";
import type { ExtraInput, ModelOption, ProfileItem } from "../../../shared/ipc";
import { fastModePatch, isFastTier, SESSION_FAST_MODE_FEATURE } from "../../../shared/fastMode";
import { imageInputItems } from "../../../shared/input";
import { api, bridge } from "../bridge";
import { useI18n, type MessageKey } from "../i18n";
import { en } from "../i18n/en";
import { zhCN } from "../i18n/zh-CN";
import { imageFileToDataUrl } from "../lib/images";
import { useP2Access } from "../lib/p2Access";
import { senderLabel } from "../lib/systemSenders";
import { useComposerDraft } from "../lib/composerDrafts";
import { candidateIndex, composerCandidateKey, mentionPathsFor, startMentionSearch, type MentionResults } from "../lib/composerMentions";
import { createComposerEnterTrace, type EnterDecision } from "../lib/composerEnterTrace";
import { archiveAgent, renameAgent } from "../lib/menus";
import { PERMISSION_MODES, permissionModeOf, permissionPatch } from "../lib/permissionModes";
import { cachedProfileList, loadProfileList } from "../lib/profileSnapshot";
import { useOrderedProfiles } from "../lib/profileOrder";
import { useImagePickBlocked } from "../lib/remoteMode";
import { PROFILE_FAMILY_FEATURE, switchTargets } from "../lib/profileCreate";
import { formatBalance, gaugeName, gaugesFromRateLimits, latestObservedAt, mergeGauges, observedClock, resetsIn, resetsInCompact, quotaFill, quotaPercent, quotaTextKey, wantsNativeQuotaFallback, type QuotaGauge, type RateLimitsLike } from "../lib/quota";
import { appendToken } from "../lib/composerTools";
import { useModelName } from "../lib/modelDisplay";
import { setUiPref, useUiPrefs } from "../lib/prefs";
import { agentFeaturesOf, lacks, maxImageBytes, steerAction, type AgentFeatures } from "../lib/agentFeatures";
import { structuralErrorText } from "../lib/structuralGateView";
import { boundSkills, insertMention, mentionAt, paletteQuery, parseSlash, rankEntries, runSlash, SLASH_COMMANDS, slashSpec, slashUnavailable, type PaletteEntry, type SlashContext } from "../lib/slashCommands";
import { anyOverlayOpen } from "../lib/openOverlays";
import { sideLayersActive } from "../lib/sideLayoutStore";
import { openChanges, openSide } from "../lib/sideOpen";
import { SIDE_CHAT_COMPONENT } from "../lib/sideKinds";
import { useConversationEsc } from "../lib/useConversationEsc";
import { pausedSection } from "../lib/queuePause";
import { composerKeyAction, strategyFor } from "../lib/sendKeys";
import { orderedEntries, type TimelineState } from "../lib/timeline";
import { hasUnlandedTurn, outboxAt, visibleQueue } from "../lib/outbox";
import { useHeldBusy } from "../lib/busyHold";
import { lastAssistantText, timelineToMarkdown } from "../lib/transcript";
import { agentHost, featuresOf, interruptWithFeedback, queueItemText, selectedFeatures, selectedSidebar, sessionApi, useApp } from "../store";
import { hostPageParam, useComposerHost, useHostLoadQuota, useHostQuotas } from "../lib/targetHost";
import { services } from "../modules/app";
import { setSettingsHost } from "../lib/settingsHost";
import { ExperimentalPanel, MemoriesPanel, ProjectMemoryPanel, StatusPanel, type StatusRow } from "./ComposerPanels";
import { ComposerTools } from "./ComposerTools";
import { GaugeBar } from "./GaugeBar";
import { ProfileAvatar } from "./ProfileAvatar";
import { Segmented, Toggle } from "./settings/Form";
import { Ring } from "./Ring";
import { Menu, Popover } from "./Menu";
import { ModelPicker } from "./ModelPicker";
import { QueuePanel } from "./QueuePanel";
import { PendingMessagesSection } from "./PendingMessagesSection";
import { usePendingMessages } from "../lib/agentMessageStore";
import { AsksPausedSection, DelegationQueueSection, PauseAsksButton } from "./DelegationQueue";
import { stopHeld } from "../lib/stopHold";
import { ADMISSION_ORDER_FEATURE, OWNER_YIELD_FEATURE, admittedAskIds, currentTurnOf, pendingMessagesSectionShown, turnGroups } from "../lib/admissionOrder";
import { reloadOwnerMayPassAsks, useOwnerMayPassAsks } from "../lib/admissionOrderView";
import { useHostRecords } from "../lib/delegationStore";
import { useDelegationTurn, usePendingDelegations } from "../lib/delegationsView";
import { delegationKeyAction, delegationSendChoices, queueSendNowMode, sendHowFor } from "../lib/delegationTurn";
import { confirmDialog } from "../lib/contextMenu";
import { noteSent } from "../lib/jump";
import { followAfterSend } from "../lib/stickToBottom";
import { ComposerTriggers } from "./gutter/ComposerTriggers";
import { ASKS_PAUSE_FEATURE } from "../lib/asksPause";
import { QUOTA_CONTINUE_FEATURE } from "../../../shared/quotaContinue";
import { useQuotaContinue } from "../lib/quotaContinue";
import { runtimeOf } from "../lib/agentList";
import { QuotaContinueSection } from "./QuotaContinueSection";
import { useShortWindow } from "../lib/queueChips";
import { DelegationSendMenu, DelegationTurnHint } from "./DelegationComposer";
import { SlashPalette, type PaletteRow } from "./SlashPalette";

const DEFAULT_EFFORTS = ["low", "medium", "high", "xhigh"];

const Bar = GaugeBar;

const QUOTA_REFRESH_MS = 60_000;

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
  const online = useApp((s) => selectedSidebar(s)?.active.find((x) => x.cutexSessionId === sessionId)?.runtime.status === "online");
  const prefs = useUiPrefs();
  useEffect(() => {
    if (!profile) return;
    void loadQuota(profile);
    const timer = setInterval(() => void loadQuota(profile), QUOTA_REFRESH_MS);
    return () => clearInterval(timer);
  }, [profile, loadQuota]);
  // Warm the profile list so the popover's switch section is there in its first paint; the chip's
  // picture comes from it too.
  const [items, setItems] = useState<ProfileItem[] | null>(() => cachedProfileList()?.profiles ?? null);
  useEffect(() => {
    if (!cachedProfileList()) void loadProfileList().then((r) => setItems(r?.profiles ?? null), () => {});
  }, []);
  const item = profile ? items?.find((p) => p.name === profile) : undefined;
  // cutex has no gauges for this profile (older cutex, or a Claude profile: r202 reads ChatGPT
  // only): ask the agent's own runtime.
  const fallback = !!sessionId && wantsNativeQuotaFallback(cutexGauges, online);
  const [nativeQuota, setNativeQuota] = useState<{ limits: RateLimitsLike; at: number } | null>(null);
  useEffect(() => {
    setNativeQuota(null);
    if (!fallback || !sessionId) return;
    let alive = true;
    const read = () =>
      void sessionApi(sessionId).readRateLimits(sessionId).then((limits) => {
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
  const title = (g: QuotaGauge) => (g.windowLabel && g.windowLabel !== g.label ? `${gaugeName(g)} · ${g.windowLabel}` : gaugeName(g));
  // With no gauge yet, a dim ring keeps the chip's size, so nothing shifts when quota lands.
  const view = prefs.quotaView;
  const visible = gauges.some((g) => g.kind === "balance" || quotaFill(g, view) !== null);
  return (
    <Popover
      triggerTitle={profile ? `${profile} · ${t("composer.quota.title")}` : t("composer.quota.title")}
      width="w-72"
      align="right"
      openSignal={openSignal}
      trigger={
        <span className="flex min-w-0 items-center gap-2">
          {item && prefs.composerProfileAvatar && <ProfileAvatar profile={item} size={18} />}
          <span className="trim-cap max-w-28 truncate">{profile ?? t("composer.quota.noProfile")}</span>
          {!visible && (
            <span className="opacity-40">
              <Ring ratio={0} />
            </span>
          )}
          {gauges.map((g) => {
            const fill = quotaFill(g, view);
            return g.kind === "balance" ? (
              <span key={g.id} className={`trim-cap text-subtle tabular-nums ${g.stale ? "opacity-60" : ""}`} title={g.balance ?? undefined}>{formatBalance(g.balance, true)}</span>
            ) : fill === null ? null : (
              <span key={g.id} className={`flex items-center gap-1 ${g.stale ? "opacity-50" : ""}`}>
                <Ring ratio={fill} view={view} />
                {prefs.quotaShowReset && g.resetAt && <span className="trim-cap text-subtle tabular-nums">{resetsInCompact(g.resetAt)}</span>}
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
          {observed !== null && <p className="-mt-2 text-[11px] text-subtle">{t("composer.quota.observedAt", { at: observedClock(observed) })}</p>}
          {/* One grid for every row (subgrid): label | reset | value line up across rows; bars span all three. */}
          {gauges.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 gap-y-3">
              {gauges.map((g) => {
                const fill = quotaFill(g, view);
                const percent = quotaPercent(g, view);
                return (
                  <div key={g.id} className={`col-span-3 grid grid-cols-subgrid items-baseline gap-y-1.5 ${g.stale ? "opacity-60" : ""}`} title={g.observedAt ? t("composer.quota.observedAt", { at: observedClock(g.observedAt) }) : undefined}>
                    <span className="min-w-0 truncate text-sm">
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
                      <div className="col-span-3">
                        <Bar ratio={fill} view={view} />
                      </div>
                    )}
                    {g.error && <p className="col-span-3 text-xs text-danger">{g.error}</p>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="space-y-2 border-t border-border pt-2 text-xs text-muted">
            <label className="flex cursor-pointer items-center justify-between">
              {t("composer.quota.showReset")}
              <input type="checkbox" checked={prefs.quotaShowReset} onChange={(e) => setUiPref("quotaShowReset", e.target.checked)} />
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

/** "Switch profile" list (DESIGN §4.8) at the top of the profile chip's popover. Gated per profile by
 *  cutex; when the current profile can't switch (or has nothing to switch to) the section is not
 *  shown at all. */
function ProfileSwitch({ profile, sessionId, busy }: { profile: string | null; sessionId: string; busy: boolean }) {
  const { t } = useI18n();
  const modelName = useModelName();
  const sidebar = useApp(selectedSidebar);
  const familyAware = useApp((s) => selectedFeatures(s).has(PROFILE_FAMILY_FEATURE));
  // From the cached list (warmed by ProfileQuota), so the section is there in the first paint;
  // refreshed in the background on each open.
  const [listed, setProfiles] = useState<ProfileItem[] | null>(() => cachedProfileList()?.profiles ?? null);
  /** Switch targets in the owner's manual profile order (lib/profileOrder). */
  const profiles = useOrderedProfiles(listed);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    loadProfileList().then((r) => setProfiles(r?.profiles ?? null), () => {});
  }, []);
  if (!profiles) return null;
  const current = profiles.find((p) => p.name === profile);
  if (!current?.allowSessionSwitch) return null;
  const revision = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === sessionId)?.revision;
  const targets = switchTargets(profile, profiles, familyAware);
  if (targets.length === 0) return null;
  const familyLabel = familyAware ? (current?.providerFamilyLabel ?? current?.providerFamily ?? null) : null;
  const sw = async (target: string) => {
    if (revision === undefined) return;
    setStatus(t("composer.switch.working"));
    try {
      const r = await sessionApi(sessionId).switchProfile(sessionId, target, busy ? "afterTurn" : "now", revision);
      setStatus(r.status === "scheduled" ? t("composer.switch.scheduled", { to: target }) : t("composer.switch.done", { to: target }));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="border-b border-border pb-2">
      <div className="mb-1 flex items-baseline gap-2 text-xs text-subtle">
        <span>{busy ? t("composer.switch.titleAfterTurn") : t("composer.switch.title")}</span>
        {familyLabel && <span className="ml-auto truncate" title={t("settings.profile.familyHint")}>{t("composer.switch.sameFamily", { label: familyLabel })}</span>}
      </div>
      {targets.map((p) => (
          <button
            key={p.id}
            disabled={!p.allowSessionSwitch}
            title={p.allowSessionSwitch ? undefined : t("composer.switch.targetLocked")}
            onClick={() => void sw(p.name)}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-surface-2 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <ProfileAvatar profile={p} size={18} />
            <span className="truncate">{p.name}</span>
            <span className="ml-auto truncate text-xs text-subtle">{modelName(p.model, null, p.id)}</span>
          </button>
        ))}
      {status && <p className="mt-1 text-xs text-muted">{status}</p>}
    </div>
  );
}

/** Divider between the profile chip (name + quota) and the model group (model · reasoning · context). */
export function ChipDivider() {
  return <span aria-hidden className="mx-1 h-3.5 w-px shrink-0 bg-border" />;
}

function ContextMeter({ usage, onCompact }: { usage: TimelineState["contextUsage"]; onCompact(): void }) {
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
          <div className="flex items-center justify-between">
            <span className="text-xs text-subtle">{ratio !== null && ratio > 0.85 ? t("composer.context.soon") : ""}</span>
            <button
              onClick={() => {
                onCompact();
                close();
              }}
              className="rounded-md bg-surface-2 px-2 py-1 text-xs hover:text-foreground"
            >
              {t("composer.context.compact")}
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Click or drag along the track; the filled part runs up to the thumb. Commits on release. */
function EffortTrack({ efforts, index, label, onCommit }: { efforts: string[]; index: number; label(e: string): string; onCommit(i: number): void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const n = efforts.length;
  const shown = drag ?? index;
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  const center = (i: number) => `${((i + 0.5) / n) * 100}%`;
  return (
    <div
      role="slider"
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={shown}
      aria-valuetext={efforts[shown] ? label(efforts[shown]!) : undefined}
      className="relative h-7 cursor-pointer touch-none rounded-lg bg-surface-2 select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e));
      }}
      onPointerMove={(e) => drag !== null && setDrag(at(e))}
      onPointerUp={(e) => {
        const i = at(e);
        setDrag(null);
        onCommit(i);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="absolute inset-y-0 left-0 rounded-lg bg-accent/25 transition-[width] duration-100" style={{ width: `calc(${center(shown)} + 8px)` }} />
      {efforts.map((e, i) => (
        <span key={e} title={label(e)} className={`absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full ${i < shown ? "bg-accent" : "bg-subtle"}`} style={{ left: center(i) }} />
      ))}
      <span className="absolute top-1/2 h-5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-md bg-accent shadow transition-[left] duration-100" style={{ left: center(shown) }} />
    </div>
  );
}

/** Fast mode in the effort popover (cutex session-fast-mode); absent = the model / host has none. */
export interface FastModeControl {
  on: boolean;
  onToggle(on: boolean): void;
}

export function EffortPicker({ effort, efforts, onChange, fast }: { effort: string | null; efforts: string[]; onChange(e: string): void; fast?: FastModeControl }) {
  const { t } = useI18n();
  // Localized name when we have one, else the model's raw value (models add new levels, e.g. "ultra").
  const label = (e: string) => {
    const key = `composer.effort.${e}`;
    const text = t(key as MessageKey);
    return text === key ? e : text;
  };
  const index = Math.max(0, efforts.indexOf(effort ?? ""));
  const step = (delta: number) => {
    const next = efforts[Math.min(efforts.length - 1, Math.max(0, index + delta))];
    if (next && next !== effort) onChange(next);
  };
  return (
    <Popover
      align="right"
      width="w-80"
      trigger={
        <span className="trim-cap inline-flex items-center gap-0.5" title={fast?.on ? t("composer.fast.on") : undefined}>
          {fast?.on && <Zap size={12} className="shrink-0 fill-current text-warn" aria-label={t("composer.fast.on")} />}
          {effort ? label(effort) : "…"}
        </span>
      }
      onKey={(e) => {
        if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "ArrowRight") step(1);
        else return false;
        return true;
      }}
    >
      {() => (
        <div className="space-y-3 p-3">
          <div className="text-sm">
            <span className="text-subtle">{t("composer.effortTitle")}</span> <span className="font-medium">{effort ? label(effort) : ""}</span>
            {effort && label(effort) !== effort && <span className="ml-1.5 font-mono text-xs text-subtle">{effort}</span>}
          </div>
          <div className="flex justify-between text-xs text-subtle">
            <span>{t("composer.effort.faster")}</span>
            <span>{t("composer.effort.smarter")}</span>
          </div>
          <EffortTrack efforts={efforts} index={index} label={label} onCommit={(i) => efforts[i] && efforts[i] !== effort && onChange(efforts[i]!)} />
          <div className="flex text-[11px] text-subtle">
            {efforts.map((e) => (
              <span key={e} className={`flex-1 text-center font-mono ${e === effort ? "text-foreground" : ""}`}>
                {e}
              </span>
            ))}
          </div>
          {fast && (
            <label className="flex cursor-pointer items-center gap-2 border-t border-border pt-3 text-sm">
              <Zap size={14} className={`shrink-0 ${fast.on ? "fill-current text-warn" : "text-subtle"}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("composer.fast.title")}</span>
                <span className="block text-xs text-subtle">{t("composer.fast.hint")}</span>
              </span>
              <Toggle checked={fast.on} onChange={(v) => fast.onToggle(v)} label={t("composer.fast.title")} />
            </label>
          )}
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

/** Command entries with both locales' descriptions as search keywords (zh and en both match). */
function commandEntries(t: (k: MessageKey, v?: Record<string, string | number>) => string, features: ReadonlySet<string>, agent: AgentFeatures, busy: boolean): PaletteItem[] {
  return SLASH_COMMANDS.map((c) => {
    const key = `slash.cmd.${c.id}` as MessageKey;
    const unavailable = slashUnavailable(c, features, agent, busy);
    return {
      key: `cmd:${c.id}`,
      kind: "command",
      name: c.id,
      description: t(key),
      keywords: [zhCN[key], en[key], ...(c.aliases ?? [])],
      disabledReason: unavailable ? t(`slash.unavailable.${unavailable}` as MessageKey) : undefined,
    };
  });
}

let imageSeq = 0;

export function Composer({
  name,
  busy,
  queue,
  timeline,
  sessionId,
  profile,
}: {
  name: string;
  busy: boolean;
  queue: QueueItem[];
  timeline: TimelineState | null;
  sessionId: string;
  profile: string | null;
}) {
  const { t } = useI18n();
  const modelName = useModelName();
  const submit = useApp((s) => s.submit);
  const queueRemove = useApp((s) => s.queueRemove);
  const queueTakeForEdit = useApp((s) => s.queueTakeForEdit);
  const queueSendNow = useApp((s) => s.queueSendNow);
  const pendingDelegations = usePendingDelegations(sessionId);
  const models = useApp((s) => s.models[sessionId]);
  const loadModels = useApp((s) => s.loadModels);
  const collabModes = useApp((s) => s.collabModes[sessionId]);
  const loadCollabModes = useApp((s) => s.loadCollabModes);
  const setCollabMode = useApp((s) => s.setCollabMode);
  const updateSettings = useApp((s) => s.updateSettings);
  const compact = useApp((s) => s.compact);
  const features = useApp(selectedFeatures);
  const uiSignal = useApp((s) => s.uiSignal);
  const notice = useApp((s) => s.notice);
  const shortWindow = useShortWindow();
  const hostId = useApp(agentHost);
  const { text, setText, images, setImages, pickedSkills, setPickedSkills, clearDraft, captureDraft } = useComposerDraft(hostId, sessionId);
  const { sendKeys, delegationSteerKeys, queueSectionStrip } = useUiPrefs();
  // The running turn handles a delegation (agent-asks): hint, guarded shortcuts, send menu.
  const runningDelegation = useDelegationTurn(timeline);
  const delegation = busy ? runningDelegation : null;
  const guardKeys = { delegation: !!delegation, allowSteerKeys: delegationSteerKeys };
  const pendingSteers = useApp((s) => s.pendingSteers[sessionId]);
  const queuePause = useApp((s) => s.sessions[sessionId]?.queuePause ?? null);
  const asksPaused = useApp((s) => selectedFeatures(s).has(ASKS_PAUSE_FEATURE) && !!s.sessions[sessionId]?.asksPaused);
  // stop-holds-ridealongs: the owner's stop holds everything until 继续发送 (lib/stopHold).
  const stopHold = useApp((s) => stopHeld(s.sessions[sessionId]?.asksPaused));
  const queueHandoff = useApp((s) => !!s.queueHandoff[sessionId]);
  // Optimistic sends and queue rows being removed (lib/outbox): the tray shows what will be.
  const outbox = useApp((s) => s.outbox[sessionId]);
  const queueHidden = useApp((s) => s.queueHidden[sessionId]);
  // The timeline's size stands in for its (mutated in place) entries: a flushed message landing hides its queue row.
  const entryCount = timeline?.entries.size ?? 0;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownQueue = useMemo(() => visibleQueue(queue, queueHidden, outbox, timeline), [queue, queueHidden, outbox, timeline, entryCount]);
  // A send that is starting a turn counts as busy: the next Enter queues behind it.
  const sendBusy = busy || hasUnlandedTurn(outbox);
  const paused = useMemo(() => pausedSection(pendingSteers ?? [], shownQueue, queuePause, queueHandoff), [pendingSteers, shownQueue, queuePause, queueHandoff]);
  // admission-order: one list in the order cutex admits owner messages, delegations and deliveries.
  const admission = useApp((s) => (selectedFeatures(s).has(ADMISSION_ORDER_FEATURE) ? (s.sessions[sessionId]?.admission ?? null) : null));
  // The open agent's host's records (a peers delegation has one per host).
  const askById = useHostRecords(hostId);
  const mayPass = useOwnerMayPassAsks(!!admission);
  const groups = useMemo(() => (admission ? turnGroups(admission, shownQueue, askById) : null), [admission, shownQueue, askById]);
  const admittedAsks = useMemo(() => admittedAskIds(admission), [admission]);
  // Pending delegations the admission list does not have (e.g. awaiting the owner's review) keep their section.
  const otherDelegations = useMemo(() => (admission ? pendingDelegations.filter((d) => !admittedAsks.has(d.askId)) : pendingDelegations), [admission, pendingDelegations, admittedAsks]);
  const orderedAsks = !!groups?.turns.some((r) => r.kind === "ask");
  const activeTurnStart = busy ? (timeline?.turns.find((x) => x.id === timeline.activeTurnId)?.startedAt ?? null) : null;
  // 待读留言 (agent-messages-v2): a message whose item is in the timeline is read in already.
  const pendingMessages = usePendingMessages(sessionId, (id) => !!timeline?.entries.has(id), timeline?.entries.size ?? 0);
  // A stop's hold (origin ownerStop) only matters while something waits behind it: with nothing held the
  // 「委托已随停止暂停」 strip stays out of the way (the owner's own 暂停委托 always shows).
  const pauseOrigin = useApp((s) => s.sessions[sessionId]?.asksPaused?.origin ?? null);
  const stopHoldsSomething = !!admission?.items.some((i) => i.kind !== "owner") || (admission?.nextStep?.length ?? 0) > 0 || otherDelegations.length > 0 || pendingMessages.length > 0;
  const showAsksPaused = asksPaused && (pauseOrigin !== "ownerStop" || stopHoldsSomething);
  // Something will start the next turn as soon as this one ends (a queued message cutex flushes, an
  // admitted delegation, a send in flight) — not after the owner's stop. The stop button and the busy
  // placeholder then stay through the gap between turn/completed and the next turn/started (lib/busyHold).
  const lastTurn = timeline?.turns[timeline.turns.length - 1];
  const followUp = lastTurn?.status !== "interrupted" && (hasUnlandedTurn(outbox) || shownQueue.length > paused.items.length || (!asksPaused && !!groups?.turns.some((r) => r.kind === "ask")));
  const busyLook = useHeldBusy(busy, followUp);
  const [caret, setCaret] = useState(0);
  const [sending, setSending] = useState(false);
  const [traceEnter] = useState(() => createComposerEnterTrace(sessionId,
    (record) => bridge.shell?.logError({ kind: "reported", message: JSON.stringify(record) })));
  // All skills (enabled + disabled) for the agent's cwd; the palette lists the enabled ones.
  const [allSkills, setAllSkills] = useState<SkillMetadata[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  // Esc hides the palette for exactly this draft; typing on reopens it.
  const [paletteDismissed, setPaletteDismissed] = useState<string | null>(null);
  const [mentionDismissed, setMentionDismissed] = useState<number | null>(null);
  const [mentionResults, setMentionResults] = useState<MentionResults | null>(null);
  const [panel, setPanel] = useState<PanelKind | null>(null);
  const [popoverSignal, setPopoverSignal] = useState<{ kind: PopoverKind; nonce: number } | null>(null);
  const [shownNotice, setShownNotice] = useState<typeof notice>(null);
  const [dragOver, setDragOver] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const online = !!timeline?.threadId;
  useEffect(() => {
    if (!online) return;
    void loadModels();
    void loadCollabModes();
  }, [sessionId, online, loadModels, loadCollabModes]);

  // Notices from commands / store actions: visible for a few seconds.
  useEffect(() => {
    if (!notice || Date.now() - notice.nonce > 5000) return; // nonce is a timestamp; skip stale ones on remount
    setShownNotice(notice);
    const timer = setTimeout(() => setShownNotice((n) => (n?.nonce === notice.nonce ? null : n)), notice.tone === "error" ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  // Open requests from elsewhere (signal) for the composer's own popovers / panels.
  const lastSignal = useRef(uiSignal?.nonce ?? 0);
  useEffect(() => {
    if (!uiSignal || uiSignal.nonce === lastSignal.current) return;
    lastSignal.current = uiSignal.nonce;
    if (POPOVERS.has(uiSignal.target)) setPopoverSignal({ kind: uiSignal.target as PopoverKind, nonce: uiSignal.nonce });
    else if (PANELS.has(uiSignal.target)) setPanel(uiSignal.target as PanelKind);
  }, [uiSignal]);

  const settings = timeline?.settings ?? null;
  const mode = permissionModeOf(settings);
  const collabMode = settings?.collaborationMode?.mode ?? "default";
  const currentModel = settings?.model ?? null;
  const modelInfo = models?.find((m) => m.model === currentModel || m.id === currentModel);
  // The profile's entry name, else the catalog name (lib/modelDisplay); "" = no model yet.
  const modelShown = modelName(currentModel, modelInfo?.displayName, profile);
  const efforts = modelInfo?.efforts.length ? modelInfo.efforts : DEFAULT_EFFORTS;
  // Fast mode: only where cutex keeps the tier across restarts and the model offers a Fast tier.
  const fastFeature = useApp((s) => featuresOf(s, hostId).has(SESSION_FAST_MODE_FEATURE));
  const fastTier = fastFeature ? (modelInfo?.fastTier ?? null) : null;
  const modelItems: Pick<ModelOption, "model" | "displayName" | "description">[] =
    models ?? (currentModel ? [{ model: currentModel, displayName: currentModel, description: "" }] : []);
  const session = useApp((s) => [...(selectedSidebar(s)?.active ?? []), ...(selectedSidebar(s)?.retired ?? [])].find((r) => r.cutexSessionId === sessionId));
  // Claude agents (claude-runtime-features): hide what the adapter reports as unsupported.
  const agent = useMemo(() => agentFeaturesOf(session), [session]);
  // 额度用完 · HH:MM 自动继续 · 取消 (claude-quota-auto-continue, lib/quotaContinue).
  const quotaApplies = useApp((s) => featuresOf(s, hostId).has(QUOTA_CONTINUE_FEATURE)) && !!session && runtimeOf(session) === "claude";
  const quotaView = useQuotaContinue(hostId, sessionId, quotaApplies);
  const noSteer = lacks(agent, "turnSteer");
  const noSkills = lacks(agent, "skillInput");
  const unsupportedHint = t("composer.tools.agentUnsupported");
  // A model missing from the list (stale catalog, list not loaded) is unknown, not text-only:
  // allow images and let the native refuse them.
  const canImages = (modelInfo ? !!modelInfo.inputModalities?.includes("image") : true) && !lacks(agent, "imageInput");
  // The images go to the composer's host (the open agent's), not the focus host.
  const imagePickBlocked = useImagePickBlocked(hostId);
  // users-p2-access: a non-owner attaches images only with send (main uploads them, cutex refuses any
  // other image input of a non-owner); an older host refuses them all.
  const imagesAllowed = useP2Access(hostId).attachments;
  const hostRow = useApp((s) => selectedSidebar(s)?.hostRows[sessionId]);
  const projectSummary = useApp((s) => (hostRow?.projectId ? selectedSidebar(s)?.projects?.projects.find((p) => p.project_id === hostRow.projectId) : undefined));
  const project = hostRow?.projectId ? { id: hostRow.projectId, name: projectSummary?.presentation.display_name ?? hostRow.projectId } : null;

  // ---------- palette / mention state ----------
  const query = paletteDismissed === text ? null : paletteQuery(text);
  const paletteOpen = query !== null;
  const loadSkills = () => {
    const cwd = session?.cwd;
    sessionApi(sessionId).codexRequest("skills/list", cwd ? { cwds: [cwd] } : {}).then(
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
  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (query === null) return [];
    const skillItems: PaletteItem[] = noSkills ? [] : (skills ?? []).map((s) => ({ key: `skill:${s.path}`, kind: "skill", name: s.name, description: s.interface?.shortDescription ?? s.shortDescription ?? s.description, skill: s }));
    return rankEntries(query, [...commandEntries(t, features, agent, busy), ...skillItems]);
  }, [query, skills, t, features, agent, busy, noSkills]);

  const mention = features.has("workspace-fs") ? mentionAt(text, caret) : null;
  const mentionOpen = !!mention && !paletteOpen && mentionDismissed !== mention.start;
  useEffect(() => {
    setMentionResults(null);
    if (!mentionOpen || !mention?.query) return;
    return startMentionSearch(mention.query,
      (q) => sessionApi(sessionId).fsSearch({ kind: "session", id: sessionId }, q, 20).then((r) => r.results.map((x) => x.path)),
      setMentionResults);
  }, [mentionOpen, mention?.query, sessionId]);
  const mentionPaths = mentionPathsFor(mentionResults, mentionOpen ? mention?.query ?? null : null);
  const popupCount = paletteOpen ? paletteItems.length : mentionOpen ? mentionPaths.length : 0;
  const selectedCandidate = candidateIndex(selected, popupCount) ?? 0;
  // Reset on a changed list, not on an unrelated sidebar refresh returning equivalent entries.
  const candidateListKey = JSON.stringify(paletteOpen ? paletteItems.map((item) => item.key) : mentionPaths);
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
      else useApp.getState().signal(target);
    },
    insert: (value) => {
      setText(value);
      requestAnimationFrame(() => textarea.current?.focus());
    },
    notify: (key, vars) => useApp.getState().notify(t(key, vars)),
    submitText: async (value) => void (await submit(value, busy ? "queue" : "auto")),
    compact,
    // Like the TUI: a new objective over an unfinished goal asks first (in the goal card); over a
    // finished one it just starts fresh.
    setGoal: async (objective) => {
      const goal = timeline?.goal;
      if (goal && goal.status !== "complete") useApp.getState().signal("goal", `replace:${objective}`);
      else await useApp.getState().replaceGoal(objective);
    },
    goalVerb: async (verb) => {
      if (verb === "edit") return useApp.getState().signal("goal", "edit");
      if (verb === "clear") return useApp.getState().clearGoal();
      return useApp.getState().setGoal({ status: verb === "pause" ? "paused" : "active" });
    },
    review: (instructions) => useApp.getState().startReview(instructions),
    setPlan: (on) => setCollabMode(on ? "plan" : "default"),
    rename: async (value) => void (session && (await renameAgent(session, t, value))),
    archive: async () => void (session && (await archiveAgent(session, t))),
    fork: () => useApp.getState().forkSession(sessionId, null),
    side: (text) => void openSide(SIDE_CHAT_COMPONENT, { text }, { focus: true }),
    newAgent: () => services.ui.openPage("agent-config.newAgent", hostRow?.projectId ? { project: hostRow.projectId, host: hostId } : { host: hostId }),
    openDiff: () => void openChanges(),
    stopBackground: () => useApp.getState().stopBackgroundTerminals(),
    copyLast: async () => {
      const last = timeline ? lastAssistantText(orderedEntries(timeline)) : null;
      if (!last) return false;
      await navigator.clipboard.writeText(last);
      return true;
    },
    exportMarkdown: async () => {
      if (!timeline) return;
      const names = new Map([...(selectedSidebar(useApp.getState())?.active ?? []), ...(selectedSidebar(useApp.getState())?.retired ?? [])].map((s) => [s.cutexSessionId, s.displayName]));
      // History pages: export the whole thread, not just the turns loaded so far.
      const full = (await useApp.getState().completeTimeline(sessionId)) ?? timeline;
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
      if (path) useApp.getState().notify(t("slash.notice.exported", { path }));
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
      useApp.getState().notify(text, refused ? "info" : "error");
    }
  };

  const focusEnd = () =>
    requestAnimationFrame(() => {
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
    const path = mentionPaths[index];
    if (!path || !mention) return;
    const next = insertMention(text, mention, path);
    setText(next.text);
    setCaret(next.caret);
    requestAnimationFrame(() => {
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
      useApp.getState().notify(t("users.access.noImages"), "error");
      return true;
    }
    if (!canImages) {
      useApp.getState().notify(t("composer.image.unsupported"), "error");
      return true;
    }
    for (const file of imgs) {
      const url = await imageFileToDataUrl(file, maxImageBytes(agent));
      if (!url) {
        useApp.getState().notify(t("composer.image.tooLarge", { name: file.name || "image" }), "error");
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
      for (const p of await sessionApi(sessionId).pickImages(maxImageBytes(agent))) {
        if (p.error) useApp.getState().notify(t(p.error === "tooLarge" ? "composer.image.tooLarge" : "composer.image.unreadable", { name: p.name }), "error");
        else target.setImages((prev) => [...prev, { id: `img-${++imageSeq}`, name: p.name, preview: p.preview, source: { kind: "path", path: p.path } }]);
      }
    } catch (e) {
      useApp.getState().notify(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      void addImageFiles(files);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragOver(false);
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
      await useApp.getState().interruptAndSendSteers();
    } catch (e) {
      useApp.getState().notify(e instanceof Error ? e.message : String(e), "error");
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
    },
    {
      arm: () => useApp.getState().notify(t("composer.escAgainDelegation")),
      act: (action) => void (action === "interrupt" ? interruptWithFeedback(t) : interruptAndSendSteers()),
    },
  );

  // The tray's per-item 插入 during a delegation turn (setting off): 加入此委托 (with the warning) or
  // keep it queued — the same guard as the steer shortcuts.
  const sendQueuedNow = async (item: QueueItem) => {
    // This agent, as of the click: the confirm below may stay open while the owner switches agents.
    const agentId = sessionId;
    if (queueSendNowMode(guardKeys) === "confirm") {
      const join = await confirmDialog(t("delegationTurn.joinQueuedConfirm", { text: queueItemText(item).slice(0, 80) }), false, {
        ok: t("delegationTurn.choice.join"),
        cancel: t("delegationTurn.keepQueued"),
      });
      if (!join) return;
    }
    await queueSendNow(item, agentId);
  };

  const pausedAction = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (e) {
      useApp.getState().notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const send = async (how: "send" | "steer" | "queue" | "interruptSend", enterDecision?: (decision: EnterDecision) => void) => {
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
    const strategy = strategyFor(steerAction(how, agent), sendBusy);
    // Optimistic (lib/outbox): the draft leaves the composer at once and shows up where it will land
    // (queue tray / steers / timeline) as 发送中…; a failure stays there with retry / edit / discard.
    clearDraft();
    // Ctrl+Shift+Enter with steers waiting: they and this text go out as one message (no pause).
    if (strategy === "interrupt" && features.has("queue-pause") && pendingSteers?.some((p) => (p.state ?? "waiting") === "waiting")) {
      setSending(true);
      try {
        enterDecision?.("dispatched");
        await useApp.getState().interruptAndSend(draft, extra);
      } catch (e) {
        // Not stopped: the store put the text back into the composer.
        useApp.getState().notify(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setSending(false);
      }
      return;
    }
    enterDecision?.("dispatched");
    void submit(draft, strategy, extra).catch(() => {});
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const eventLagMs = e.key === "Enter" ? performance.now() - e.timeStamp : 0;
    const report = (decision: EnterDecision) => {
      if (e.key === "Enter") traceEnter({ decision, composing: e.nativeEvent.isComposing,
        ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey,
        hasContent: !!text.trim() || images.length > 0, eventLagMs });
    };
    const candidate = composerCandidateKey({ key: e.key, shift: e.shiftKey, isComposing: e.nativeEvent.isComposing }, popupCount, selected);
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
    const el = e.currentTarget;
    const keyAction = composerKeyAction(
      sendKeys,
      { key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey },
      { busy, hasContent: !!text.trim() || images.length > 0, pendingSteers: pendingSteers?.length ?? 0, collapsedSelection: el.selectionStart === el.selectionEnd },
    );
    if (!keyAction) { report(e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey ? "newline" : "unhandled"); return; }
    const action = delegationKeyAction(keyAction, guardKeys);
    e.preventDefault();
    if (action === "interrupt") { report("dispatched"); void interruptWithFeedback(t); }
    else if (action === "interruptSendSteers") { report("dispatched"); void interruptAndSendSteers(); }
    else void send(action, report);
  };

  const paletteRows: PaletteRow[] = paletteItems.map((item) => ({
    key: item.key,
    label: `${item.kind === "skill" ? "$" : "/"}${item.name}`,
    description: item.disabledReason ? `${item.description} · ${item.disabledReason}` : item.description,
    disabled: !!item.disabledReason,
    tag: item.kind === "skill" ? t("slash.skillTag") : undefined,
  }));
  const mentionRows: PaletteRow[] = mentionPaths.map((p) => {
    const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
    return { key: p, label: slash >= 0 ? p.slice(slash + 1) : p, description: slash >= 0 ? p.slice(0, slash) : undefined };
  });

  const statusRows = (): StatusRow[] => {
    const usage = timeline?.contextUsage;
    const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
    return [
      { label: t("slash.status.model"), value: modelShown ? (currentModel && modelShown !== currentModel ? `${modelShown} (${currentModel})` : modelShown) : "—" },
      { label: t("slash.status.effort"), value: settings?.effort ? t(`composer.effort.${settings.effort}` as MessageKey) : "—" },
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
      if ((await setCollabMode(on ? "plan" : "default")) === false) useApp.getState().notify(t("slash.notice.planUnavailable"), "error");
    } catch (e) {
      useApp.getState().notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const sig = (kind: PopoverKind) => (popoverSignal?.kind === kind ? popoverSignal.nonce : 0);
  const hasContent = !!text.trim() || images.length > 0;
  return (
    <div className="side-col side-col-composer w-full px-4 pb-3">
      <div className="relative">
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
            title={t("mention.title")}
            rows={mentionRows}
            selected={selectedCandidate}
            empty={mention?.query ? (mentionResults?.query === mention.query ? t("mention.none") : t("common.loading")) : t("mention.hint")}
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
          steers={pendingSteers ?? []}
          sendingSteers={outboxAt(outbox, "steer")}
          sendingQueue={outboxAt(outbox, "queue")}
          outbox={{
            onRetry: (id) => useApp.getState().retrySend(sessionId, id),
            onEdit: (id) => useApp.getState().editSend(sessionId, id),
            onDiscard: (id) => useApp.getState().discardSend(sessionId, id),
          }}
          onInterruptSendSteers={() => void interruptAndSendSteers()}
          onDismissSteer={(id) => useApp.getState().dismissSteer(id)}
          paused={paused}
          pausedHint={hasContent ? t(busy && sendKeys !== "cli" && paused.items.length > 0 ? "paused.composerHintQueue" : "paused.composerHint", { n: paused.count }) : null}
          onResumePaused={() => void pausedAction(() => useApp.getState().resumePaused())}
          onRestorePaused={() => void pausedAction(() => useApp.getState().restorePaused())}
          onClearPaused={() => void pausedAction(() => useApp.getState().discardPaused())}
          items={shownQueue}
          canEdit={!text.trim()}
          onSendNow={noSteer && sendBusy ? undefined : (item) => void sendQueuedNow(item).catch((e: unknown) => useApp.getState().notify(e instanceof Error ? e.message : String(e), "error"))}
          sendNowStartsTurn={!sendBusy}
          onDelete={(item) => void queueRemove(item, sessionId).catch((e: unknown) => useApp.getState().notify(e instanceof Error ? e.message : String(e), "error"))}
          onEdit={(item) => {
            const target = captureDraft();
            void queueTakeForEdit(item, sessionId).then(target.setText);
          }}
          stripEnabled={queueSectionStrip}
          autoCompact={{ short: shortWindow }}
          stopHold={stopHold}
          running={busy}
          ordered={
            groups && admission
              ? {
                  turns: groups.turns,
                  nextStep: groups.nextStep,
                  ridealongsHeld: admission.ridealongsHeld,
                  ownerYielded: admission.ownerYielded,
                  onYield: features.has(OWNER_YIELD_FEATURE) ? () => void useApp.getState().queueYield().catch((e: unknown) => useApp.getState().notify(e instanceof Error ? e.message : String(e), "error")) : undefined,
                  running: busy,
                  runningSince: activeTurnStart === null ? null : activeTurnStart * 1000,
                  currentTurn: currentTurnOf(busy, admission.currentTurn, delegation?.askId ?? null),
                  sessionId,
                  // Dropping onto 「下个工具边界」 = 插入 (the same path as the row's button).
                  onInsert: noSteer && sendBusy ? undefined : (item: QueueItem) => void sendQueuedNow(item).catch((e: unknown) => useApp.getState().notify(e instanceof Error ? e.message : String(e), "error")),
                  mayPass,
                  onMove: (item, before) =>
                    void useApp
                      .getState()
                      .queueMove(item, before)
                      .catch((e: unknown) => {
                        if ((e as { moveRefusal?: string } | null)?.moveRefusal === "passingNotAllowed") reloadOwnerMayPassAsks();
                        useApp.getState().notify(e instanceof Error ? e.message : String(e), "error");
                      }),
                  actions: orderedAsks ? <PauseAsksButton sessionId={sessionId} /> : null,
                }
              : undefined
          }
          sections={[
            // Slot 0: 待读留言 (agent messages v2). With admission-order these are the turn frame's
            // ride-along items (admission.nextStep): the old section is only the fallback.
            pendingMessagesSectionShown(features, pendingMessages.length) ? { node: <PendingMessagesSection sessionId={sessionId} messages={pendingMessages} busy={busy} runtime={agent.runtime} />, chip: { kind: "messages", n: pendingMessages.length } } : null,
            // Slot 1: 待处理委托 (delegations; with admission-order only those the merged list does not have).
            otherDelegations.length > 0 ? { node: <DelegationQueueSection rows={otherDelegations} sessionId={sessionId} pauseButton={!orderedAsks} railed={!!groups} />, chip: { kind: "delegations", n: otherDelegations.length } } : null,
            // Slot 2: 委托已暂停 · 继续 (asks-pause-v2).
            showAsksPaused ? { node: <AsksPausedSection sessionId={sessionId} railed={!!groups} />, chip: { kind: "asksPaused", warn: true } } : null,
            // Slot 3: 额度用完 · HH:MM 自动继续 · 取消 (claude-quota-auto-continue).
            quotaView?.pending ? { node: <QuotaContinueSection hostId={hostId} sessionId={sessionId} view={quotaView} />, chip: { kind: "quota", warn: true } } : null,
          ]}
        />
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          data-gutter-anchor="composer"
          className={`relative rounded-2xl border bg-surface px-3 py-2 focus-within:border-accent/60 ${dragOver ? "border-accent" : "border-border"}`}
        >
          {/* Transient feedback (已中断, 已复制, …) floats inside the input box's top-right corner (not over the
              queue card above it), so it never moves the layout; long text ends in … within the pill, the
              whole text as its tooltip. */}
          {shownNotice && (
            <div
              role="status"
              title={shownNotice.text}
              className={`absolute top-1.5 right-2.5 z-10 flex max-w-[min(70%,28rem)] min-w-0 items-center rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs shadow-sm ${shownNotice.tone === "error" ? "text-danger" : "text-muted"}`}
              data-testid="composer-notice"
            >
              <span className="min-w-0 truncate">{shownNotice.text}</span>
            </div>
          )}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1 pb-1.5">
              {images.map((img) => (
                <div key={img.id} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-border bg-surface-2" title={img.name}>
                  {img.preview ? <img src={img.preview} alt={img.name} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[10px] text-subtle">{img.name}</span>}
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
          <div className="flex items-end gap-2">
            <textarea
              data-composer-input
              ref={textarea}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setCaret(e.target.selectionStart);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              rows={Math.min(8, Math.max(2, text.split("\n").length))}
              placeholder={delegation ? "" : busyLook ? t("composer.placeholderBusy") : t("composer.placeholder", { name })}
              className="max-h-60 flex-1 resize-none bg-transparent py-1 outline-none placeholder:text-subtle"
            />
            {busyLook && (
              <button
                onClick={() => void interruptWithFeedback(t)}
                // Held through a turn boundary (no turn to stop for a moment): inert, looks the same.
                disabled={!busy}
                title={t("composer.stopHint")}
                className="mb-0.5 flex h-7 shrink-0 items-center gap-1 rounded-full border border-danger/50 px-2 text-xs text-danger hover:bg-danger/10"
              >
                <span className="text-[9px]">■</span>
                {t("composer.stop")}
              </button>
            )}
            {delegation && hasContent && <DelegationSendMenu choices={delegationSendChoices(!noSteer)} disabled={sending} onPick={(c) => void send(sendHowFor(c))} />}
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

      <div className="mt-1 flex min-w-0 items-center gap-0.5 px-0.5">
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
          onInsertSkill={(s) => pickSkill(s, "append")}
          plan={{ available: planAvailable, on: collabMode === "plan", disabledReason: online ? null : t("composer.tools.needsOnline"), set: (on) => void setPlan(on) }}
          goal={{
            label: timeline?.goal ? t(`goal.status.${timeline.goal.status}` as MessageKey) : t("composer.tools.goal.unset"),
            disabledReason: lacks(agent, "goals") ? unsupportedHint : online ? null : t("composer.tools.needsOnline"),
            onClick: () => {
              if (timeline?.goal) return useApp.getState().signal("goal");
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
              if (project) services.ui.openPage("projects.page", { project: project.id, tab: "memory", ...hostPageParam(agentHost(useApp.getState())) });
              else if (online) setPanel("memories");
              else services.ui.openPage("projects.page", { tab: "memory" });
            },
          }}
          onManage={(tab) => useApp.getState().openSettings(tab)}
        />
        <Menu
          title={t("composer.permissionTitle")}
          openSignal={sig("permissions")}
          // nowrap: the chip never gives up width to a crowded toolbar by breaking 完全访问 mid-word; the model
          // name (truncate) and the right-hand group give way first.
          trigger={<span className={`trim-cap whitespace-nowrap ${mode === "full" ? "text-warn" : ""}`}>{mode ? t(`composer.mode.${mode}` as MessageKey) : "…"}</span>}
          items={PERMISSION_MODES.map((m) => ({ value: m, label: t(`composer.mode.${m}` as MessageKey), description: t(`composer.modeHint.${m}` as MessageKey) }))}
          selected={mode}
          onSelect={(m) => m !== "custom" && void updateSettings(permissionPatch(m))}
        />
        {collabMode === "plan" && (
          <button
            onClick={() => void setPlan(false)}
            title={t("composer.tools.planOff")}
            className="ml-0.5 flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs text-accent hover:bg-accent/25"
          >
            {t("composer.collab.plan")}
            <X size={11} />
          </button>
        )}
        {/* One rhythm: chips are 4px-padded with no gap, so every token sits 8px apart. */}
        <div className="ml-auto flex min-w-0 items-center [&>div>button]:px-1 [&>span:not([aria-hidden])]:px-1">
          <ProfileQuota profile={profile} rateLimits={timeline?.rateLimits ?? null} rateLimitsAt={timeline?.rateLimitsObservedAt ?? null} sessionId={sessionId} busy={busy} openSignal={sig("quota")} />
          <ChipDivider />
          <ModelPicker
            profile={profile}
            models={modelItems}
            current={currentModel}
            label={modelShown || "…"}
            trigger={<span className="trim-cap max-w-40 truncate">{modelShown || "…"}</span>}
            triggerTitle={currentModel && modelShown !== currentModel ? `${t("composer.modelTitle")} · ${currentModel}` : t("composer.modelTitle")}
            onOpen={() => void loadModels(true)}
            onSelect={(model) => void updateSettings({ model })}
            openSignal={sig("model")}
          />
          <EffortPicker
            effort={settings?.effort ?? null}
            efforts={efforts}
            onChange={(effort) => void updateSettings({ effort })}
            fast={fastTier && session && runtimeOf(session) !== "claude" ? { on: isFastTier(settings?.serviceTier, fastTier), onToggle: (on) => void updateSettings(fastModePatch(on, fastTier)) } : undefined}
          />
          <ContextMeter usage={timeline?.contextUsage ?? null} onCompact={() => void compact()} />
        </div>
        <ComposerTriggers hostId={hostId} sessionId={sessionId} side="right" />
      </div>
    </div>
  );
}
