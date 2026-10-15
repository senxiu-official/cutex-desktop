// Settings pages for this machine (group 「应用」): 通用 (+ 更新与诊断 from the updater module), 对话,
// 侧栏与顶栏 (+ 会话两侧), 状态显示 — plus 归档 (数据) and 键盘快捷键, 关于 (系统: versions, licenses, the dragon). Desktop-local prefs live in localStorage
// (lib/prefs, lib/appearance) or the main process (close behaviour, update interval).
import { useEffect, useState } from "react";
import type { CapabilitiesView, CloseBehavior, ShellState, UpdateStatus } from "../../../../shared/ipc";
import { api, bridge } from "../../bridge";
import { useI18n, type MessageKey } from "../../i18n";
import { LANGUAGES } from "../../lib/languages";
import { ASKS_FEATURE } from "../../lib/delegations";
import { hasLocalHost } from "../../lib/hosts";
import { useGlobalSettings } from "../../lib/globalSettings";
import { ADMISSION_ORDER_FEATURE, readOwnerMayPassAsks } from "../../lib/admissionOrder";
import { setOwnerMayPassAsks } from "../../lib/admissionOrderView";
import { FOLD_LINE_OPTIONS, migrateFoldLines } from "../../lib/messageFold";
import { deleteAgentNow, SESSION_FEATURES } from "../../lib/menus";
import { archivedProjectOf, projectOfArchived } from "../../lib/archivedAgent";
import { restoreWithDirector } from "../../lib/projectArchive";
import type { AgentRow } from "../../lib/sidebar";
import { migrateOfflineLimit, OFFLINE_LIMITS } from "../../lib/offlineAgents";
import { PROJECT_SEPARATIONS } from "../../lib/projectSeparation";
import { STATUS_CHIPS } from "../../lib/statusChips";
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { RUNNING_AGENTS } from "../../lib/runningAgentsPref";
import { FLYOUT_DELAYS, migrateFlyoutDelay } from "../../lib/projectFlyout";
import { displayKey, shortcutsFor } from "../../lib/shortcuts";
import { useSidebarModel } from "../../lib/sidebarView";
import { useTargetFeatures, useTargetHostId, useTargetSelect, useTargetSidebar } from "../../lib/targetHost";
import { packageLabel } from "../../lib/runtimePackages";
import { refreshRuntimePackages } from "../../lib/runtimePackageStore";
import { useHostRuntimePackages, useOutdatedAgentCount } from "../../lib/runtimePackagesView";
import { buildLabel, cutexBuildText, settingsAnchorId } from "../../lib/settingsNav";
import { channelLabel, PROJECT_REPO_URL, RELATED_REPO_URLS, unsupportedHintKey, updateButtonVisible, updateSummary, useUpdateStatus } from "../../lib/update";
import { useApp } from "../../store";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { formatBytes } from "../../../../shared/releases";
import { Avatar } from "../Avatar";
import { UpdateButton } from "../UpdateButton";
import { AboutDragon } from "./AboutDragon";
import { AppearanceNumberRow } from "./AppearanceRows";
import { OwnerNotifySection } from "./OwnerNotifySettings";
import { ArmedRemove, Button, EmptyState, ErrorNote, LinkRow, ListRow, Section, Segmented, Select, SettingRow, SourceTag, Toggle } from "./Form";
import { StatusPlaceTable } from "./StatusPlaceTable";
import { TermsSection } from "./TermsSettings";
import { SettingsSections } from "../../modules/Outlet";
import { services } from "../../modules/app";

function useCapabilities(): CapabilitiesView | null | undefined {
  const daemon = useApp((s) => s.daemon);
  const [caps, setCaps] = useState<CapabilitiesView | null | undefined>(undefined);
  useEffect(() => {
    if (daemon.kind !== "connected") return;
    api.capabilities().then(setCaps, () => setCaps(null));
  }, [daemon.kind]);
  return caps;
}

/** Main-process prefs (close behaviour, update interval); null in the browser preview. */
function useShellState(): [ShellState | null, (s: ShellState) => void] {
  const shell = bridge.shell;
  const [state, setState] = useState<ShellState | null>(null);
  useEffect(() => {
    shell?.state().then(setState, () => {});
  }, [shell]);
  return [state, setState];
}

// ---- 通用 ----

export function GeneralPage() {
  const { t, locale, setLocale } = useI18n();
  return (
    <>
      <Section id={settingsAnchorId("startup")} title={t("shell.general.startup")}>
        <SettingRow label={t("shell.language")}>
          <Select
            value={locale}
            options={[...LANGUAGES]}
            onChange={setLocale}
          />
        </SettingRow>
        <CloseBehaviorRow />
      </Section>
      <TermsSection />
      {/* 更新与诊断 (module updater). */}
      <SettingsSections page="general" />
    </>
  );
}

/** 关闭窗口时 (stored by the main process; hidden in the browser preview). */
function CloseBehaviorRow() {
  const { t } = useI18n();
  const shell = bridge.shell;
  const [state, setState] = useShellState();
  if (!shell || !state) return null;
  return (
    <SettingRow label={t("shell.closeWindow")} hint={!state.trayAvailable ? t("shell.closeWindow.noTray") : state.trayHostMissing && state.prefs.closeBehavior === "quit" ? t("shell.closeWindow.noTrayHost") : t("shell.closeWindow.hint")}>
      <Segmented<CloseBehavior>
        value={state.prefs.closeBehavior}
        options={[
          { value: "tray", label: t("shell.closeWindow.tray") },
          { value: "quit", label: t("shell.closeWindow.quit") },
        ]}
        onChange={(v) => {
          setState({ ...state, prefs: { ...state.prefs, closeBehavior: v } });
          shell.setCloseBehavior(v).then(setState, () => {});
        }}
      />
    </SettingRow>
  );
}

const UPDATE_INTERVALS = [0, 5, 10, 30, 60];

/** The branch this install follows (read-only: set per install, `<base>/channel`). */
/**
 * 更新通道: 开发版 (main) / 正式版 (release) when this install can switch (writes `<base>/channel` and
 * checks again), otherwise the branch read-only; plus where updates come from (remote · branch).
 */
function UpdateChannelRows({ status }: { status: UpdateStatus }) {
  const { t } = useI18n();
  const update = bridge.update;
  const [pending, setPending] = useState(false);
  const channel = status.channel ?? "main";
  const busy = pending || status.state === "updating" || status.state === "ready";
  const options = [
    { value: "main", label: t("updater.channel.main") },
    { value: "release", label: t("updater.channel.release") },
    ...(channel === "main" || channel === "release" ? [] : [{ value: channel, label: channel }]),
  ];
  return (
    <>
      {status.canSwitchChannel && update?.setChannel ? (
        <SettingRow label={t("updater.channel")} hint={t("updater.channelSwitchHint")}>
          <Segmented
            label={t("updater.channel")}
            value={channel}
            disabled={busy}
            options={options}
            onChange={(v) => {
              if (v === channel || (v !== "main" && v !== "release")) return;
              setPending(true);
              update.setChannel!(v).then(
                () => setPending(false),
                () => setPending(false),
              );
            }}
          />
        </SettingRow>
      ) : (
        <SettingRow label={t("updater.channel")} hint={t("updater.channelHint")}>
          <span className="text-xs text-muted">{channelLabel(t, channel)}</span>
        </SettingRow>
      )}
      {status.source && (
        <SettingRow label={t("updater.source")} hint={t(status.binary ? "updater.sourceHint.binary" : "updater.sourceHint")}>
          <span className="flex min-w-0 font-mono text-xs text-muted" title={`${status.source} · ${channel}`}>
            <span className="min-w-0 truncate">{status.source}</span>
            <span className="shrink-0 whitespace-pre"> · {channel}</span>
          </span>
        </SettingRow>
      )}
    </>
  );
}

/**
 * 旧版本: releases moved to `<base>/old-releases` after updates (never deleted silently except 30 days
 * after the move); 删除旧版本 deletes them now, after a second click.
 */
function OldReleasesRow({ status }: { status: UpdateStatus }) {
  const { t } = useI18n();
  const update = bridge.update;
  const [armed, setArmed] = useArmed();
  const [deleting, setDeleting] = useState(false);
  const old = status.oldReleases!;
  const busy = deleting || status.state === "updating" || status.state === "ready";
  return (
    <SettingRow label={t("updater.oldReleases")} hint={t("updater.oldReleasesHint")}>
      <span className="flex items-center gap-3">
        <span className="text-xs text-muted tabular-nums" title={old.dir}>
          {t("updater.oldReleases.summary", { n: old.count, size: formatBytes(old.bytes), days: old.autoDeleteDays })}
        </span>
        {update?.deleteOldReleases &&
          (armed && !busy ? (
            <button
              className={`${ARMED_FORM_BUTTON} shrink-0 whitespace-nowrap`}
              onClick={() => {
                setArmed(false);
                setDeleting(true);
                update.deleteOldReleases!().then(
                  () => setDeleting(false),
                  () => setDeleting(false),
                );
              }}
            >
              {t("updater.oldReleases.confirm")}
            </button>
          ) : (
            <Button onClick={() => setArmed(true)} disabled={busy}>
              {t(deleting ? "updater.oldReleases.deleting" : "updater.oldReleases.delete")}
            </Button>
          ))}
      </span>
    </SettingRow>
  );
}

/**
 * Settings → 更新与诊断, its own page in 系统 next to 关于 (owner 2026-10-10; was a section of 通用):
 * 更新 (interval, running version + check now, the ready update), 诊断 (error log folder).
 */
export function UpdatesPage() {
  const { t } = useI18n();
  const shell = bridge.shell;
  const update = bridge.update;
  const status = useUpdateStatus();
  const [state, setState] = useShellState();
  if (!shell) return null;
  const supported = !!update && !!state && !!status && status.state !== "unsupported";
  const minutes = state?.prefs.updateCheckMinutes ?? 10;
  return (
    <>
      <Section id={settingsAnchorId("updates")} title={t("updater.section.updates")}>
        {status?.state === "unsupported" && (
          <>
            {/* Quiet, never an error: a package copied to another machine simply cannot update itself. */}
            <SettingRow label={t("updater.updateCheck")} hint={t(unsupportedHintKey(status.code))}>
              <span className="flex items-center gap-3">
                <span className="text-xs text-subtle" title={status.reason ?? undefined}>
                  {t(status.code === "channelMissing" ? "updater.channel.missing" : "updater.updateCheck.unsupported")}
                </span>
                {status.retryable && update && <Button onClick={() => void update.check()}>{t("updater.updateCheck.retry")}</Button>}
                {status.code === "releasePackage" && status.releasePage && (
                  <Button onClick={() => void api.openExternal(status.releasePage!)} title={status.releasePage}>{t("updater.releasePage.open")}</Button>
                )}
              </span>
            </SettingRow>
            {status.current && (
              <SettingRow label={t("updater.updateCheck.current")}>
                <span className="font-mono text-xs text-muted tabular-nums">{buildLabel(status.current) ?? "—"}</span>
              </SettingRow>
            )}
            {status.channel && <UpdateChannelRows status={status} />}
          </>
        )}
        {supported && (
          <>
            <SettingRow label={t("updater.updateCheck")} hint={t("updater.updateCheckHint")}>
              <Select
                value={String(UPDATE_INTERVALS.includes(minutes) ? minutes : 10)}
                options={UPDATE_INTERVALS.map((n) => ({ value: String(n), label: n === 0 ? t("updater.updateCheck.off") : n === 60 ? t("updater.updateCheck.hourly") : t("updater.updateCheck.minutes", { n }) }))}
                onChange={(v) => shell.setUpdateCheckMinutes(Number(v)).then(setState, () => {})}
              />
            </SettingRow>
            <SettingRow label={t("updater.updateCheck.current")}>
              <span className="font-mono text-xs text-muted tabular-nums">{buildLabel(status.current) ?? "—"}</span>
              <Button onClick={() => void update.check()} disabled={status.state === "checking" || status.state === "updating"}>
                {t("updater.updateCheck.now")}
              </Button>
              {/* Binary installs: the Releases page stays one click away (release notes, manual download). */}
              {status.releasePage && (
                <Button onClick={() => void api.openExternal(status.releasePage!)} title={status.releasePage}>{t("updater.releasePage.open")}</Button>
              )}
            </SettingRow>
            {status.channel && <UpdateChannelRows status={status} />}
            {updateButtonVisible(status) && status.latest && (
              <SettingRow label={t("updater.updateCheck.latest")} hint={updateSummary(t, status.latest, status.channel)}>
                <span className="flex items-center text-xs">
                  <UpdateButton />
                </span>
              </SettingRow>
            )}
          </>
        )}
        {status?.oldReleases && status.oldReleases.count > 0 && <OldReleasesRow status={status} />}
        {/* Every install state (dev run, release package, self-updating): a plain link, never a prompt. */}
        <SettingRow label={t("updater.project")} hint={t("updater.projectHint")}>
          <span className="flex items-center gap-3">
            {RELATED_REPO_URLS.map((r) => (
              <button key={r.name} type="button" className="text-xs text-muted hover:text-foreground hover:underline" title={r.url} onClick={() => void api.openExternal(r.url)}>
                {r.name}
              </button>
            ))}
            <Button onClick={() => void api.openExternal(PROJECT_REPO_URL)} title={PROJECT_REPO_URL}>{t("updater.project.open")}</Button>
          </span>
        </SettingRow>
      </Section>
      <Section id={settingsAnchorId("diagnostics")} title={t("updater.section.diagnostics")}>
        <SettingRow label={t("updater.errorLog")} hint={t("updater.errorLogHint")}>
          <Button onClick={() => void shell.openLogs()}>{t("updater.errorLog.open")}</Button>
        </SettingRow>
      </Section>
    </>
  );
}

// ---- 对话 ----

export function ConversationPage() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  const asks = useApp((s) => s.features.has(ASKS_FEATURE));
  const admissionOrder = useApp((s) => s.features.has(ADMISSION_ORDER_FEATURE));
  return (
    <>
      <Section id={settingsAnchorId("display")} title={t("conversation.display")}>
        <SettingRow label={t("conversation.reasoningView")} hint={t("conversation.reasoningView.hint")}>
          <Segmented
            value={ui.reasoningView}
            options={(["expanded", "collapsed", "hidden"] as const).map((v) => ({ value: v, label: t(`conversation.reasoningView.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("reasoningView", v)}
          />
        </SettingRow>
        <SettingRow label={t("conversation.interactions")} hint={t("conversation.interactionsHint")}>
          <Toggle checked={ui.timelineInteractions} onChange={(v) => setUiPref("timelineInteractions", v)} />
        </SettingRow>
        <SettingRow label={t("conversation.agentMessages")} hint={t("conversation.agentMessages.hint")}>
          <Segmented
            value={ui.agentMessages}
            options={[
              { value: "compact" as const, label: t("conversation.agentMessages.compact") },
              { value: "full" as const, label: t("conversation.agentMessages.full") },
            ]}
            onChange={(v) => setUiPref("agentMessages", v)}
          />
        </SettingRow>
        <SettingRow label={t("conversation.timelineTurns")} hint={t("conversation.timelineTurnsHint")}>
          <Select
            value={String(ui.timelineTurns)}
            options={[20, 30, 50, 100, 0].map((n) => ({ value: String(n), label: n === 0 ? t("conversation.timelineTurns.all") : t("conversation.timelineTurns.n", { n }) }))}
            onChange={(v) => setUiPref("timelineTurns", Number(v))}
          />
        </SettingRow>
        <SettingRow label={t("conversation.timelineIntro")} hint={t("conversation.timelineIntroHint")}>
          <Toggle checked={ui.timelineIntro} onChange={(v) => setUiPref("timelineIntro", v)} />
        </SettingRow>
        <SettingRow label={t("conversation.turnSummary")} hint={t("conversation.turnSummary.hint")}>
          <Segmented
            value={ui.turnSummary}
            options={(["collapsed", "latestExpanded", "off"] as const).map((v) => ({ value: v, label: t(`conversation.turnSummary.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("turnSummary", v)}
          />
        </SettingRow>
        <SettingRow label={t("appearance.messageImages")} hint={t("appearance.messageImagesHint")}>
          <Segmented
            value={ui.messageImages}
            options={(["thumbnail", "link"] as const).map((v) => ({ value: v, label: t(`appearance.messageImages.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("messageImages", v)}
          />
        </SettingRow>
      </Section>

      <Section id={settingsAnchorId("fold")} title={t("appearance.fold")}>
        <SettingRow label={t("appearance.foldLong")} hint={t("appearance.foldLongHint")}>
          <Toggle checked={ui.foldLong} onChange={(v) => setUiPref("foldLong", v)} />
        </SettingRow>
        <SettingRow label={t("appearance.foldLines")} hint={t("appearance.foldLinesHint")}>
          <Segmented
            value={String(ui.foldLines)}
            disabled={!ui.foldLong}
            options={FOLD_LINE_OPTIONS.map((n) => ({ value: String(n), label: t("appearance.foldLines.n", { n }) }))}
            onChange={(v) => setUiPref("foldLines", migrateFoldLines(Number(v)))}
          />
        </SettingRow>
        <SettingRow label={t("appearance.foldOlderReplies")} hint={t("appearance.foldOlderRepliesHint")}>
          <Toggle checked={ui.foldOlderReplies} disabled={!ui.foldLong} onChange={(v) => setUiPref("foldOlderReplies", v)} />
        </SettingRow>
      </Section>

      <Section id={settingsAnchorId("composer")} title={t("conversation.composer")}>
        <SettingRow label={t("settings.sendKeys")} hint={t(ui.sendKeys === "cli" ? "conversation.sendKeys.cliHint" : "conversation.sendKeys.queueFirstHint")}>
          <Segmented
            value={ui.sendKeys}
            options={[
              { value: "queueFirst" as const, label: t("settings.sendKeys.queueFirst") },
              { value: "cli" as const, label: t("settings.sendKeys.cli") },
            ]}
            onChange={(v) => setUiPref("sendKeys", v)}
          />
        </SettingRow>
        {asks && (
          <SettingRow label={t("conversation.delegationSteerKeys")} hint={t("conversation.delegationSteerKeysHint")}>
            <Toggle checked={ui.delegationSteerKeys} onChange={(v) => setUiPref("delegationSteerKeys", v)} />
          </SettingRow>
        )}
        {admissionOrder && <OwnerMayPassAsksRow />}
        {admissionOrder && (
          <SettingRow label={t("queue.sectionStrip")} hint={t("queue.sectionStripHint")}>
            <Toggle checked={ui.queueSectionStrip} onChange={(v) => setUiPref("queueSectionStrip", v)} />
          </SettingRow>
        )}
        <SettingRow label={t("composer.quota.showReset")}>
          <Toggle checked={ui.quotaShowReset} onChange={(v) => setUiPref("quotaShowReset", v)} />
        </SettingRow>
        <SettingRow label={t("composer.profileAvatar")} hint={t("composer.profileAvatarHint")}>
          <Toggle checked={ui.composerProfileAvatar} onChange={(v) => setUiPref("composerProfileAvatar", v)} />
        </SettingRow>
      </Section>
      {/* Module sections on this page (browser, notes, side chat, artifacts …). */}
      <SettingsSections page="conversation" />
    </>
  );
}

/**
 * cutex `queue.ownerMayPassAsks` (admission-order; the connected host's cutex, not this machine):
 * whether the queue panel may move the owner's queued messages ahead of delegations / deliveries.
 */
function OwnerMayPassAsksRow() {
  const { t } = useI18n();
  const { settings, error, patch } = useGlobalSettings();
  const value = readOwnerMayPassAsks(settings);
  // The queue panel reads the same value (lib/admissionOrderView); keep it current.
  useEffect(() => {
    if (value !== undefined) setOwnerMayPassAsks(value);
  }, [value]);
  return (
    <SettingRow
      label={
        // A host setting on a local page: the row carries the host tag (settings audit 2026-10-15 #14).
        <span className="flex min-w-0 items-center gap-2">
          {t("queue.ownerMayPassAsks")}
          <SourceTag source="host" />
        </span>
      }
      hint={error ?? t("queue.ownerMayPassAsksHint")}
    >
      <Toggle disabled={value === undefined} checked={value ?? true} onChange={(v) => void patch({ queue: { ownerMayPassAsks: v } })} />
    </SettingRow>
  );
}

// ---- 状态显示 ----

// v1.2: the generic placement table is the shell's and stays reachable with the capsule module off
// (it then says why capsule choices do not show); the capsule's own settings are its module's section.
export function StatusPage() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  return (
    <>
      <Section id={settingsAnchorId("places")} title={t("shell.capsule.places")} hint={t("shell.statusPlace.hint")}>
        <StatusPlaceTable />
      </Section>
      <Section id={settingsAnchorId("aboveInput")} title={t("shell.status.aboveInput")}>
        <SettingRow label={t("appearance.needsYouStrip")} hint={t("appearance.needsYouStripHint")}>
          <Toggle checked={ui.needsYouStrip} onChange={(v) => setUiPref("needsYouStrip", v)} />
        </SettingRow>
      </Section>
      {/* 胶囊外观 (module status-capsule). */}
      <SettingsSections page="status" />
    </>
  );
}

// ---- 侧栏与顶栏 ----

export function SidebarPage() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  return (
    <>
      <Section id={settingsAnchorId("sidebar")} title={t("appearance.sidebar")} hint={t("appearance.sidebarHint")}>
        <SettingRow label={t("appearance.projectGrouping")} hint={t("appearance.projectGroupingHint")}>
          <Segmented
            value={ui.projectGrouping}
            options={(["all", "starred"] as const).map((v) => ({ value: v, label: t(`appearance.projectGrouping.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("projectGrouping", v)}
          />
        </SettingRow>
        <SettingRow label={t("appearance.noOnlineProjects")} hint={t(ui.projectGrouping === "all" ? "appearance.noOnlineProjectsHint" : "appearance.noOnlineProjectsOff")}>
          <Segmented
            value={ui.noOnlineProjects}
            disabled={ui.projectGrouping !== "all"}
            options={(["collapse", "expand"] as const).map((v) => ({ value: v, label: t(`appearance.noOnlineProjects.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("noOnlineProjects", v)}
          />
        </SettingRow>
        <SettingRow label={t("appearance.projectHoverPreview")} hint={t("appearance.projectHoverPreviewHint")}>
          <Toggle checked={ui.projectHoverPreview} onChange={(v) => setUiPref("projectHoverPreview", v)} />
        </SettingRow>
        <SettingRow label={t("appearance.projectHoverDelay")} hint={t("appearance.projectHoverDelayHint")}>
          <Segmented
            value={String(ui.projectHoverDelay)}
            disabled={!ui.projectHoverPreview}
            options={FLYOUT_DELAYS.map((v) => ({ value: String(v), label: t(`appearance.projectHoverDelay.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("projectHoverDelay", migrateFlyoutDelay(Number(v)))}
          />
        </SettingRow>
        <SettingRow label={t("appearance.runningAgents")} hint={t("appearance.runningAgentsHint")}>
          <Segmented
            value={ui.runningAgents}
            options={RUNNING_AGENTS.map((v) => ({ value: v, label: t(`appearance.runningAgents.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("runningAgents", v)}
          />
        </SettingRow>
        <SettingRow label={t("appearance.statusChips")} hint={t("appearance.statusChipsHint")}>
          <Segmented
            value={ui.statusChips}
            options={STATUS_CHIPS.map((v) => ({ value: v, label: t(`appearance.statusChips.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("statusChips", v)}
          />
        </SettingRow>
        <SettingRow label={t("appearance.rowPreview")} hint={t("appearance.rowPreviewHint")}>
          <Segmented
            value={ui.rowPreview}
            options={(["off", "director", "all"] as const).map((v) => ({ value: v, label: t(`appearance.rowPreview.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("rowPreview", v)}
          />
        </SettingRow>
        <SettingRow label={t("appearance.foldIdleAgents")} hint={t("appearance.foldIdleAgentsHint")}>
          <Toggle checked={ui.foldIdleAgents} onChange={(v) => setUiPref("foldIdleAgents", v)} />
        </SettingRow>
        <SettingRow label={t("appearance.offlineAgents")} hint={t("appearance.offlineAgentsHint")}>
          <Segmented
            value={String(ui.offlineAgents)}
            options={OFFLINE_LIMITS.map((v) => ({ value: String(v), label: t(`appearance.offlineAgents.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("offlineAgents", migrateOfflineLimit(v === "all" ? v : Number(v)))}
          />
        </SettingRow>
        <SettingRow label={t("appearance.sectionCollapsed")} hint={t("appearance.sectionCollapsedHint")}>
          <Segmented
            value={ui.sectionCollapsedShows}
            options={(["summary", "attention"] as const).map((v) => ({ value: v, label: t(`appearance.sectionCollapsed.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("sectionCollapsedShows", v)}
          />
        </SettingRow>
        <SettingRow label={t("appearance.projectSeparation")} hint={t("appearance.projectSeparationHint")}>
          <Select
            value={ui.projectSeparation}
            options={PROJECT_SEPARATIONS.map((v) => ({ value: v, label: t(`appearance.projectSeparation.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("projectSeparation", v)}
          />
        </SettingRow>
        <SettingRow label={t("appearance.projectHeaderTint")} hint={t("appearance.projectHeaderTintHint")}>
          <Toggle
            checked={ui.projectHeaderTint}
            disabled={ui.projectSeparation !== "header" && ui.projectSeparation !== "tint"}
            onChange={(v) => setUiPref("projectHeaderTint", v)}
          />
        </SettingRow>
        <AppearanceNumberRow field="sidebarWidth" label="appearance.sidebarWidth" hint="appearance.sidebarWidthHint" unit="px" step={4} />
        <SettingRow label={t("appearance.projectOrder")} hint={t("appearance.projectOrderHint")}>
          <Button disabled={ui.projectOrder.length === 0} onClick={() => setUiPref("projectOrder", [])}>
            {t("appearance.projectOrderReset")}
          </Button>
        </SettingRow>
      </Section>

      <Section id={settingsAnchorId("titleBar")} title={t("shell.sidebar.titleBar")}>
        <SettingRow label={t("appearance.titleTwoLines")} hint={t("appearance.titleTwoLinesHint")}>
          <Toggle checked={ui.titleTwoLines} onChange={(v) => setUiPref("titleTwoLines", v)} />
        </SettingRow>
        <SettingRow label={t("appearance.runtimeButton")} hint={t("appearance.runtimeButtonHint")}>
          <Segmented
            value={ui.runtimeButton}
            options={(["all", "independent", "off"] as const).map((v) => ({ value: v, label: t(`appearance.runtimeButton.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("runtimeButton", v)}
          />
        </SettingRow>
      </Section>
    </>
  );
}

// ---- 键盘快捷键 ----

/** Read-only key reference; the send-key scheme itself is set on 对话 → 输入框. */
export function ShortcutsPage() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  const openSettings = useApp((s) => s.openSettings);
  const mac = bridge.platform === "darwin";
  return (
    <>
      <Section>
        <LinkRow
          label={t("settings.sendKeys")}
          hint={t("shortcuts.readOnly")}
          link={t("shell.shortcuts.sendKeysLink", { scheme: t(ui.sendKeys === "cli" ? "settings.sendKeys.cli" : "settings.sendKeys.queueFirst") })}
          onClick={() => openSettings("conversation")}
        />
      </Section>
      {shortcutsFor(ui.sendKeys).map((group) => (
        <Section key={group.id} id={settingsAnchorId(`shortcuts-${group.id}`)} title={t(group.title)}>
          {group.items.map((s, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border py-2 last:border-b-0">
              <span className="flex w-44 shrink-0 flex-wrap gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {displayKey(k, mac)}
                  </kbd>
                ))}
              </span>
              <span className="min-w-0 flex-1 text-sm text-muted">{t(s.desc)}</span>
            </div>
          ))}
        </Section>
      ))}
    </>
  );
}

// ---- 通知 (page: core module notifications) ----

/** 主人通知 (module owner-notify, gated on cutex owner-messages): hidden on a cutex without the settings field. */
export function OwnerNotifyBlock() {
  const { settings, error, replace } = useGlobalSettings();
  if (error || (settings && !settings.ownerNotify)) return null;
  return <OwnerNotifySection settings={settings} onSettings={replace} />;
}

// ---- 归档 ----

export function ArchivePage() {
  const { t } = useI18n();
  // The settings host's archived agents (the page header's host picker; lib/targetHost).
  const { archived } = useSidebarModel();
  const canDelete = useTargetFeatures().has(SESSION_FEATURES.delete);
  return (
    <>
      <ArchiveBehaviour />
      <Section id={settingsAnchorId("list")} title={t("archive.list")} hint={archived.length ? t(canDelete ? "archive.archiveHintDelete" : "archive.archiveHint") : undefined}>
        {archived.length === 0 ? (
          <EmptyState>{t("archive.archiveEmpty")}</EmptyState>
        ) : (
          <div>
            {archived.map((row) => (
              <ArchivedRow key={row.id} row={row} canDelete={canDelete} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

/** One archived agent: view its history (leaves Settings), restore, delete with a second click. */
function ArchivedRow({ row, canDelete }: { row: AgentRow; canDelete: boolean }) {
  const { t, locale } = useI18n();
  const select = useTargetSelect();
  const hostId = useTargetHostId();
  const projects = useTargetSidebar()?.projects;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = row.session;
  const own = projectOfArchived(session);
  const archivedProject = archivedProjectOf(session, projects);
  const retiredAt = session.retiredAt ? new Date(session.retiredAt) : null;
  const detail = [
    own ? (archivedProject ? t("archive.row.projectArchived", { project: archivedProject.name }) : (own.name ?? own.id)) : null,
    retiredAt && !Number.isNaN(retiredAt.getTime()) ? t("archive.row.archivedAt", { when: retiredAt.toLocaleDateString(locale) }) : null,
  ].filter(Boolean).join(" · ");
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ListRow
      leading={<Avatar name={row.name} color={row.color} avatar={session.avatar} seed={session.cutexSessionId} size={22} />}
      title={row.name}
      detail={detail || undefined}
      actions={
        <>
          <Button disabled={busy} onClick={() => void select(row.id)}>{t("archive.row.view")}</Button>
          <Button disabled={busy} onClick={() => void act(() => restoreWithDirector(session, t, hostId))} title={archivedProject ? t("archive.banner.projectArchived", { project: archivedProject.name }) : undefined}>
            {t("archive.row.restore")}
          </Button>
          {canDelete && <ArmedRemove title={t("archive.row.delete")} armedLabel={t("archive.row.deleteArmed")} disabled={busy} onRemove={() => void act(() => deleteAgentNow(session, t, undefined, hostId))} />}
        </>
      }
      below={error ? <p className="mt-1 text-xs text-danger">{error}</p> : undefined}
    />
  );
}

/** `archiveDeleteEmpty` (cutex session-delete-empty-on-archive; default on). */
function ArchiveBehaviour() {
  const { t } = useI18n();
  const supported = useTargetFeatures().has(SESSION_FEATURES.deleteEmpty);
  const { settings, error, patch } = useGlobalSettings();
  if (!supported) return null;
  return (
    <Section>
      {error && <ErrorNote>{error}</ErrorNote>}
      <SettingRow label={t("archive.deleteEmpty")} hint={t("archive.deleteEmptyHint")}>
        <Toggle disabled={!settings} checked={settings?.archiveDeleteEmpty ?? true} onChange={(v) => void patch({ archiveDeleteEmpty: v })} />
      </SettingRow>
    </Section>
  );
}

// ---- 关于 ----

export function AboutPage() {
  const { t } = useI18n();
  const caps = useCapabilities();
  const status = useUpdateStatus();
  const runtime = useHostRuntimePackages();
  const outdated = useOutdatedAgentCount();
  const localHost = useApp((s) => hasLocalHost(s.hosts));
  // Opening 关于 refreshes the runtime package list (no-op without the capability).
  useEffect(() => void refreshRuntimePackages(), []);
  const desktop = buildLabel(status?.current) ?? (status?.state === "unsupported" ? t("shell.about.devBuild") : "—");
  const selected = runtime?.view?.selected ?? null;
  return (
    <>
      <Section>
        <SettingRow label="cutex-desktop" hint={localHost ? t("settings.source.local") : undefined}>
          <span className="font-mono text-xs text-muted">{desktop}</span>
        </SettingRow>
        <SettingRow label="cutex" hint={t("shell.about.cutexHint")}>
          <span className="font-mono text-xs text-muted">{caps ? cutexBuildText(caps.cutexBuild, { dev: t("cutexBuild.dev"), legacy: t("cutexBuild.legacy") }) : "—"}</span>
        </SettingRow>
        {/* Versions and the agent upgrade live on Settings → 运行时; this row links there. */}
        <SettingRow
          label={t("shell.about.native")}
          hint={outdated > 0 ? <span className="text-warn">{t("runtimePackages.dotHint", { n: outdated })}</span> : runtime ? t("shell.about.nativeSelected") : t("settings.pendingCutex", { api: "GET /v2/runtime-packages" })}
        >
          <span className="flex items-center gap-3">
            <span className="font-mono text-xs text-muted" title={selected?.nativeVersion ?? undefined}>
              {packageLabel(selected) ?? "—"}
            </span>
            <button onClick={() => services.ui.openSettings("runtime")} className="rounded text-xs text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
              {t("shell.about.runtimeLink")}
            </button>
          </span>
        </SettingRow>
        <SettingRow label={t("shell.about.licenses")} hint={t("shell.about.licensesHint")}>
          <span className="font-mono text-xs text-subtle">NOTICE</span>
        </SettingRow>
      </Section>
      <AboutDragon />
    </>
  );
}
