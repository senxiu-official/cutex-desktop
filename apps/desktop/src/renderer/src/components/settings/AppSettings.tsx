import { agentFeaturesOf, lacks } from "../../lib/agentFeatures";
// Settings pages for this machine (group 「应用」): 通用 (+ 更新与诊断 from the updater module), 对话,
// 左侧栏 (+ 会话两侧), 状态显示 — plus 归档 (数据) and 键盘快捷键, 关于 (系统: versions, licenses, the dragon). Desktop-local prefs live in localStorage
// (lib/prefs, lib/appearance) or the main process (close behaviour, update interval).
import { useEffect, useState } from "react";
import type { CapabilitiesView, CloseBehavior, ShellState, UpdateStatus } from "../../../../shared/ipc";
import { api, bridge } from "../../bridge";
import { useI18n, type Locale, type MessageKey } from "../../i18n";
import { LANGUAGES, isTraditionalLocale, traditionalRegionOf, traditionalLocale, traditionalLanguageLocale } from "../../lib/languages";
import { ASKS_FEATURE } from "../../lib/delegations";
import { hasLocalHost } from "../../lib/hosts";
import { useGlobalSettings } from "../../lib/globalSettings";
import { ADMISSION_ORDER_FEATURE, readOwnerMayPassAsks } from "../../lib/legacyDelivery/admissionOrder";
import { IMAGE_INPUT_STEERING_FEATURE, imageBusyPatch, readImageBusyBehavior } from "../../lib/imageSteer";
import type { ImageBusyBehavior } from "../../../../shared/ipc";
import { setOwnerMayPassAsks } from "../../lib/admissionOrderView";
import { FOLD_LINE_OPTIONS, migrateFoldLines } from "../../lib/messageFold";
import { deleteAgentNow, SESSION_FEATURES } from "../../lib/menus";
import { archivedProjectOf, projectOfArchived } from "../../lib/archivedAgent";
import { restoreWithDirector } from "../../lib/projectArchive";
import type { AgentRow } from "../../lib/sidebar";
import { PERF_MODES, setUiPref, useUiPrefs, type PerfMode } from "../../lib/prefs";
import { setMultiWindow, useMultiWindow } from "../../lib/multiWindowPref";
import { displayKey, shortcutsFor } from "../../lib/shortcuts";
import { KeybindingsSection } from "./KeybindingsSection";
import { GestureGuide } from "./GestureGuide";
import { useSidebarModel } from "../../lib/sidebarView";
import { useTargetFeatures, useTargetHostId, useTargetSelect, useTargetSidebar } from "../../lib/targetHost";
import { packageLabel } from "../../lib/runtimePackages";
import { refreshRuntimePackages } from "../../lib/runtimePackageStore";
import { useHostRuntimePackages, useOutdatedAgentCount } from "../../lib/runtimePackagesView";
import { buildLabel, cutexBuildText, settingsAnchorId } from "../../lib/settingsNav";
import { channelLabel, unsupportedHintKey, updateButtonVisible, updateSummary, useUpdateStatus } from "../../lib/update";
import { formatAbsolute, formatWhen } from "../../lib/time";
import { BACKEND_UPGRADE_FEATURE } from "../../../../shared/backendUpgrade";
import { useApp } from "../../store";
import { confirmDialog } from "../../lib/contextMenu";
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { requestSettingsReveal } from "../../lib/settingsSearchView";
import { useSettingsRisk } from "../../lib/useSettingsRisk";
import { formatBytes } from "../../../../shared/releases";
import { effectiveUpdateCheckMinutes, updateCheckChoices } from "../../../../shared/binaryUpdate";
import { Avatar } from "../Avatar";
import { UpdateButton } from "../UpdateButton";
import { AboutDragon } from "./AboutDragon";
import { SidebarSettingsCards } from "./regions/SidebarSettings";
import { OwnerNotifySection } from "./OwnerNotifySettings";
import { ArmedRemove, Button, useCompactSettings, EmptyState, ErrorNote, HintAction, LinkRow, ListRow, Section, Segmented, Select, SettingRow, TextLink, Toggle, SettingsGroup } from "./Form";
import { StatusPlaceTable } from "./StatusPlaceTable";
import { TermsSection } from "./TermsSettings";
import { SettingsSections } from "../../modules/Outlet";
import { services } from "../../modules/app";
import { useModuleEnabled, useModulePref } from "../../modules/react";
import { Tag } from "../../components/Tag";

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
      <Section id={settingsAnchorId("language")} title={t("shell.general.language")}>
        <SettingRow agents="none" source="local" label={t("shell.language")}>
          <Select<Locale>
            value={isTraditionalLocale(locale) ? "zh-Hant-CN" : locale}
            options={[...LANGUAGES]}
            onChange={(value) => setLocale(value === "zh-Hant-CN" ? traditionalLanguageLocale() : value)}
          />
        </SettingRow>
        {isTraditionalLocale(locale) && (
          <SettingRow agents="none" source="local" label={t("shell.language.traditional.region" as MessageKey)}>
            <Select
              value={traditionalRegionOf(locale) ?? "CN"}
              options={(["CN", "HK", "MO", "TW"] as const).map((region) => ({ value: region, label: t(`shell.language.traditional.${region}` as MessageKey) }))}
              onChange={(region) => setLocale(traditionalLocale(region))}
            />
          </SettingRow>
        )}
        <p className="py-2 text-xs text-subtle">{t("settings.ia.formatNote")}</p>
      </Section>
      <TermsSection />
      <WindowSection />
      <PerfSection />
      {/* 更新与诊断 (module updater). */}
      <SettingsSections page="general" />
    </>
  );
}

/**
 * 性能 (owner 2026-10-23, lib/perfMode): 节省资源 (default) / 流畅优先; the hint says what the chosen one does. In front
 * the window looks the same either way.
 */
function PerfSection() {
  const { t } = useI18n();
  const mode = useUiPrefs().perfMode;
  const labels: Record<PerfMode, MessageKey> = { save: "shell.perf.save", smooth: "shell.perf.smooth" };
  return (
    <Section id={settingsAnchorId("performance")} title={t("shell.perf.title")}>
      <SettingRow agents="none" source="local" label={t("shell.perf.mode")} hint={t(mode === "smooth" ? "shell.perf.smoothHint" : "shell.perf.saveHint")}>
        <Segmented<PerfMode> label={t("shell.perf.mode")} value={mode} options={PERF_MODES.map((m) => ({ value: m, label: t(labels[m]) }))} onChange={(v) => setUiPref("perfMode", v)} />
      </SettingRow>
    </Section>
  );
}

/** 窗口: 关闭窗口时 (stored by the main process), 多窗口 (this device's UI prefs); the section is left out without the shell bridge. */
function WindowSection() {
  const { t } = useI18n();
  const [state] = useShellState();
  if (!bridge.shell || !state) return null;
  return (
    <Section id={settingsAnchorId("window")} title={t("shell.general.window")}>
      <CloseBehaviorRow />
      <AllowRemoteCloseRow />
      <MultiWindowRow />
    </Section>
  );
}

/** 关闭窗口时 (stored by the main process; hidden in the browser preview). */
function CloseBehaviorRow() {
  const { t } = useI18n();
  const shell = bridge.shell;
  const [state, setState] = useShellState();
  if (!shell || !state) return null;
  return (
    <SettingRow agents="none" source="local" label={t("shell.closeWindow")} hint={!state.trayAvailable ? t("shell.closeWindow.noTray") : state.trayHostMissing && state.prefs.closeBehavior === "quit" ? t("shell.closeWindow.noTrayHost") : undefined}>
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

/**
 * 允许远程关闭这个桌面 (cutex `client-remote-close`; stored by main, default on): sent with this desktop's
 * presence to every host; switching it re-sends at once (and off cancels a running countdown).
 */
function AllowRemoteCloseRow() {
  const { t } = useI18n();
  const shell = bridge.shell;
  const [state, setState] = useShellState();
  if (!shell?.setAllowRemoteClose || !state) return null;
  const allowed = state.prefs.allowRemoteClose !== false;
  return (
    <SettingRow agents="none" source="local" label={t("remoteClose.allow")} hint={t("remoteClose.allowHint")}>
      <Toggle
        checked={allowed}
        label={t("remoteClose.allow")}
        onChange={(next) => {
          setState({ ...state, prefs: { ...state.prefs, allowRemoteClose: next } });
          shell.setAllowRemoteClose!(next).then(setState, () => {});
        }}
      />
    </SettingRow>
  );
}

/**
 * 多窗口 (multi-window P6; main-owned since 2026-10-27, mirrored by lib/multiWindowPref; default off): 移到新窗口 / 在 桌子 N 打开 / 在新窗口打开 and the remembered
 * desks coming back at start. Only where this app can open desk windows (the Electron app; the preview with ?desks).
 */
export function MultiWindowRow() {
  const { t } = useI18n();
  const on = useMultiWindow();
  if (!bridge.window?.desk) return null;
  return (
    <SettingRow agents="none" source="local" label={<span className="inline-flex items-center gap-2">{t("desk.setting")}<Tag>{t("creation.experimental")}</Tag></span>} hint={t("desk.settingHint")}>
      <Toggle checked={on} label={t("desk.setting")} onChange={(v) => void setMultiWindow(bridge.shell, v).catch(() => {})} />
    </SettingRow>
  );
}

/** A 检查更新 choice in words: 从不 / 每 10 分钟 / 每小时 / 每 6 小时 / 每天. */
function updateIntervalLabel(t: (key: MessageKey, vars?: Record<string, string | number>) => string, minutes: number): string {
  if (minutes <= 0) return t("updater.updateCheck.off");
  if (minutes === 60) return t("updater.updateCheck.hourly");
  if (minutes === 1440) return t("updater.updateCheck.daily");
  if (minutes % 60 === 0) return t("updater.updateCheck.hours", { n: minutes / 60 });
  return t("updater.updateCheck.minutes", { n: minutes });
}

/**
 * 更新通道: 开发版 (main) / 正式版 (release) when this install can switch (writes `<base>/channel` and
 * checks again); a fixed channel is shown read-only alongside the build information (UpdateDetails).
 */
function UpdateChannelRow({ status }: { status: UpdateStatus }) {
  const { t } = useI18n();
  const update = bridge.update;
  const [pending, setPending] = useState(false);
  const channel = status.channel ?? "main";
  const busy = pending || status.state === "updating" || status.state === "ready";
  if (!status.canSwitchChannel || !update?.setChannel) return null;
  const options = [
    { value: "main", label: t("updater.channel.main") },
    { value: "release", label: t("updater.channel.release") },
    ...(channel === "main" || channel === "release" ? [] : [{ value: channel, label: channel }]),
  ];
  return (
    <SettingRow agents="none" source="local" label={t("updater.channel")} hint={t("updater.channelSwitchHint")}>
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
  );
}

/** One plain sentence for where this install stands (更新与诊断 and 关于 share it). */
function useUpdateStatusLine(status: UpdateStatus | null): string | null {
  const { t, locale } = useI18n();
  if (!status) return null;
  switch (status.state) {
    case "unsupported":
      return t(unsupportedHintKey(status.code));
    case "checking":
      return t("updater.status.checking");
    case "available":
      return status.latest ? updateSummary(t, status.latest, status.channel) : t("updater.status.checking");
    case "updating":
      return t(`update.step.${status.step ?? "pull"}` as MessageKey);
    case "ready":
      return t("update.restarting");
    case "error":
      return t("updater.status.error");
    default: {
      if (status.latest) return updateSummary(t, status.latest, status.channel);
      const at = status.checkedAt ? Date.parse(status.checkedAt) : NaN;
      return Number.isFinite(at) ? t("updater.status.upToDateAt", { time: formatWhen(Math.floor(at / 1000), Date.now(), locale) }) : t("updater.status.upToDate");
    }
  }
}

/** The running version in words: the package version (binary installs), else the short commit. */
function desktopVersionText(status: UpdateStatus | null): string | null {
  return status?.current?.version ?? (status?.current?.commit ? status.current.commit.slice(0, 7) : null);
}

/** Always-visible information for 更新与诊断: the exact build, a fixed channel, the update source, the last check, the Releases page. */
function UpdateDetails({ status }: { status: UpdateStatus }) {
  const { t } = useI18n();
  const channel = status.channel ?? null;
  const checked = status.checkedAt ? Date.parse(status.checkedAt) : NaN;
  return (
    <>
      <SettingRow readOnly agents="none" source="local" label={t("updater.details.build")}>
        <span className="font-mono text-xs text-muted tabular-nums select-text">{buildLabel(status.current) ?? "—"}</span>
      </SettingRow>
      {channel && !(status.canSwitchChannel && bridge.update?.setChannel) && (
        <SettingRow readOnly agents="none" source="local" label={t("updater.channel")} hint={t("updater.channelHint")}>
          <span className="text-xs text-muted">{channelLabel(t, channel)}</span>
        </SettingRow>
      )}
      {status.source && (
        <SettingRow readOnly agents="none" source="local" label={t("updater.source")} hint={t(status.binary ? "updater.sourceHint.binary" : "updater.sourceHint")}>
          <span className="flex min-w-0 font-mono text-xs text-muted select-text" title={`${status.source} · ${channel ?? ""}`}>
            <span className="min-w-0 truncate">{status.source}</span>
            {channel && <span className="shrink-0 whitespace-pre"> · {channel}</span>}
          </span>
        </SettingRow>
      )}
      {Number.isFinite(checked) && (
        <SettingRow readOnly agents="none" source="local" label={t("updater.lastCheck")}>
          <span className="text-xs text-muted tabular-nums">{formatAbsolute(Math.floor(checked / 1000))}</span>
        </SettingRow>
      )}
      {status.state === "unsupported" && status.reason && (
        <SettingRow readOnly agents="none" source="local" label={t("updater.reason")}>
          <span className="max-w-80 truncate font-mono text-xs text-subtle select-text" title={status.reason}>
            {status.reason}
          </span>
        </SettingRow>
      )}
      {status.releasePage && status.code !== "releasePackage" && (
        <SettingRow navigation agents="none" source="local" label={t("updater.releasePage")} info={t("updater.releasePageHint")}>
          <Button onClick={() => void api.openExternal(status.releasePage!)} title={status.releasePage}>
            {t("updater.releasePage.open")}
          </Button>
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
  const [deleting, setDeleting] = useState(false);
  const old = status.oldReleases!;
  const busy = deleting || status.state === "updating" || status.state === "ready";
  return (
    <SettingRow agents="none" source="local" label={t("updater.oldReleases")} hint={t("updater.oldReleasesHint")}>
      <span className="flex items-center gap-3">
        <span className="text-xs text-muted tabular-nums" title={old.dir}>
          {t("updater.oldReleases.summary", { n: old.count, size: formatBytes(old.bytes), days: old.autoDeleteDays })}
        </span>
        {update?.deleteOldReleases && (
          <Button
            disabled={busy}
            onClick={() =>
              void confirmDialog(t("updater.oldReleases.confirmDialog", { n: old.count, size: formatBytes(old.bytes) }), true, { ok: t("updater.oldReleases.confirmOk", { n: old.count }), cancel: t("settings.cancel") }).then((yes) => {
                if (!yes) return;
                setDeleting(true);
                update.deleteOldReleases!().then(
                  () => setDeleting(false),
                  () => setDeleting(false),
                );
              })
            }
          >
            {t(deleting ? "updater.oldReleases.deleting" : "updater.oldReleases.delete")}
          </Button>
        )}
      </span>
    </SettingRow>
  );
}

/**
 * Settings → 更新与诊断, its own page in 系统 next to 关于 (owner 2026-10-10; was a section of 通用):
 * 更新 leads with the running version, where it stands and the one action that fits (更新 / 立即检查 /
 * 重试 / 打开 Releases 页面), then the choices (interval, channel, old versions) and 详细信息 (exact
 * build, source, last check); 诊断 (error log folder). The project links live on 关于.
 */
export function UpdatesPage() {
  const { t } = useI18n();
  const shell = bridge.shell;
  const update = bridge.update;
  const status = useUpdateStatus();
  const line = useUpdateStatusLine(status);
  const openSettings = useApp((s) => s.openSettings);
  const [state, setState] = useShellState();
  if (!shell) return null;
  const supported = !!update && !!state && !!status && status.state !== "unsupported";
  const minutes = state?.prefs.updateCheckMinutes ?? 10;
  return (
    <>
      <Section id={settingsAnchorId("updates")} title={t("updater.section.updates")}>
        {status && (
          <SettingRow readOnly={!updateButtonVisible(status)} agents="none" source="local"
            label={t("updater.updateCheck.current")}
            hint={
              <>
                <span className={status.state === "error" ? "text-danger" : updateButtonVisible(status) ? "text-foreground" : undefined} title={status.state === "unsupported" ? (status.reason ?? undefined) : status.state === "error" ? (status.error ?? undefined) : undefined}>
                  {line}
                </span>
                <HintAction onClick={() => openSettings("about", { anchor: "about.changelog" })}>{t("updater.whatsNew")}</HintAction>
              </>
            }
          >
            <span className="font-mono text-sm tabular-nums select-text">{desktopVersionText(status) ?? "—"}</span>
            {updateButtonVisible(status) ? (
              <UpdateButton />
            ) : status.state === "unsupported" ? (
              <>
                {status.retryable && update && <Button onClick={() => void update.check()}>{t("updater.updateCheck.retry")}</Button>}
                {status.code === "releasePackage" && status.releasePage && (
                  <Button primary onClick={() => void api.openExternal(status.releasePage!)} title={status.releasePage}>
                    {t("updater.releasePage.open")}
                  </Button>
                )}
              </>
            ) : (
              update && (
                <Button onClick={() => void update.check()} disabled={status.state === "checking" || status.state === "updating"}>
                  {t("updater.updateCheck.now")}
                </Button>
              )
            )}
          </SettingRow>
        )}
        {supported && (
          <SettingRow agents="none" source="local" label={t("updater.updateCheck")} hint={t("updater.updateCheckHint")}>
            <Select
              // Binary installs check at most hourly (GitHub's unauthenticated API limit, main/updater.ts):
              // only offer what really happens, and show a stored shorter value as the hour it runs at.
              value={String(effectiveUpdateCheckMinutes(minutes, !!status.binary))}
              options={updateCheckChoices(minutes, !!status.binary).map((n) => ({ value: String(n), label: updateIntervalLabel(t, n) }))}
              onChange={(v) => shell.setUpdateCheckMinutes(Number(v)).then(setState, () => {})}
            />
          </SettingRow>
        )}
        {status?.channel && <UpdateChannelRow status={status} />}
        {status?.oldReleases && status.oldReleases.count > 0 && <OldReleasesRow status={status} />}
        {status ? <UpdateDetails status={status} /> : <EmptyState>{t("updater.status.none")}</EmptyState>}
      </Section>
      <Section id={settingsAnchorId("diagnostics")} title={t("updater.section.diagnostics")}>
        <SettingRow navigation agents="none" source="local" label={t("updater.errorLog")} hint={t("updater.errorLogHint")}>
          <Button onClick={() => void shell.openLogs()}>{t("updater.errorLog.open")}</Button>
        </SettingRow>
      </Section>
      {/* Modules' diagnostics (design 006 v1 Q7: 性能记录 from 关于). */}
      <SettingsSections page="updates" />
    </>
  );
}

// ---- 对话 ----

const CONVERSATION_INPUT_SECTIONS = ["shell.composer"] as const;
const CONVERSATION_LAYOUT_SECTIONS = ["shell.convWidth", "shell.gutter", "shell.shelfOnly"] as const;
const CONVERSATION_SIDE_SECTIONS = ["side-chat.settings", "side-chat.summarySettings"] as const;
const CONVERSATION_PLACED_SECTIONS = [...CONVERSATION_INPUT_SECTIONS, ...CONVERSATION_LAYOUT_SECTIONS, ...CONVERSATION_SIDE_SECTIONS];

export function ConversationPage() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  // 在时间线里显示批注 is the notes module's pref, shown in 消息显示 while that module is on (owner 2026-10-19).
  const notesOn = useModuleEnabled("notes");
  const sideChatOn = useModuleEnabled("side-chat");
  const [showNotes, setShowNotes] = useModulePref<boolean>("notes", "showTimeline", true);
  // 折叠长消息: one three-way choice over the foldLong / foldOlderReplies prefs (no pref of its own).
  const fold = !ui.foldLong ? "off" : ui.foldOlderReplies ? "all" : "mine";
  const setFold = (v: "off" | "mine" | "all") => {
    setUiPref("foldLong", v !== "off");
    if (v !== "off") setUiPref("foldOlderReplies", v === "all");
  };
  return (
    <>
      <nav aria-label={t("settings.ia.conversationNav")} className="mb-4 flex flex-wrap gap-3">
        {([ ["conv-messages", "settings.ia.messages"], ["conv-input", "settings.ia.input"], ["conv-layout", "settings.ia.layout"], ...(sideChatOn ? [["conv-side-chat", "settings.ia.sideChat"]] : []) ] as const).map(([anchor, label]) => <TextLink key={anchor} onClick={() => requestSettingsReveal(anchor)}>{t(label as MessageKey)}</TextLink>)}
      </nav>
      <div id={settingsAnchorId("conv-messages")}>
      <h2 className="mb-3 text-title">{t("settings.ia.messages")}</h2>
      {/* 对话顶部 (moved from 侧栏与顶栏, owner 2026-10-18: settings grouped by screen region). */}
      <Section id={settingsAnchorId("titleBar")} title={t("shell.sidebar.titleBar")}>
        <SettingRow agents="none" source="local" label={t("appearance.titleTwoLines")} info={t("appearance.titleTwoLinesHint")}>
          <Toggle checked={ui.titleTwoLines} onChange={(v) => setUiPref("titleTwoLines", v)} />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("appearance.runtimeButton")} info={t("appearance.runtimeButtonHint")}>
          <Segmented
            value={ui.runtimeButton}
            options={(["all", "independent", "off"] as const).map((v) => ({ value: v, label: t(`appearance.runtimeButton.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("runtimeButton", v)}
          />
        </SettingRow>
      </Section>
      {/* 消息显示 (owner 2026-10-19): by message kind, then the toggles. */}
      <Section id={settingsAnchorId("display")} title={t("conversation.display")}>
        <SettingRow agents="none" source="local" label={t("conversation.reasoningView")} info={t("conversation.reasoningView.hint")}>
          <Segmented
            value={ui.reasoningView}
            options={(["expanded", "collapsed", "hidden"] as const).map((v) => ({ value: v, label: t(`conversation.reasoningView.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("reasoningView", v)}
          />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("conversation.agentMessages")} info={t("conversation.agentMessages.hint")}>
          <Segmented
            value={ui.agentMessages}
            options={[
              { value: "compact" as const, label: t("conversation.agentMessages.compact") },
              { value: "full" as const, label: t("conversation.agentMessages.full") },
            ]}
            onChange={(v) => setUiPref("agentMessages", v)}
          />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("appearance.messageImages")} info={t("appearance.messageImagesHint")}>
          <Segmented
            value={ui.messageImages}
            options={(["thumbnail", "link"] as const).map((v) => ({ value: v, label: t(`appearance.messageImages.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("messageImages", v)}
          />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("conversation.turnSummary")} info={t("conversation.turnSummary.hint")}>
          <Segmented
            value={ui.turnSummary}
            options={(["collapsed", "latestExpanded", "off"] as const).map((v) => ({ value: v, label: t(`conversation.turnSummary.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("turnSummary", v)}
          />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("conversation.interactions")} hint={t("conversation.interactionsHint")}>
          <Toggle checked={ui.timelineInteractions} onChange={(v) => setUiPref("timelineInteractions", v)} />
        </SettingRow>
        {notesOn && (
          <SettingRow agents="none" source="local" label={t("notes.showTimeline")} hint={t("notes.showTimelineHint")}>
            <Toggle
              checked={showNotes}
              onChange={(next) => {
                try {
                  setShowNotes(next);
                } catch (e) {
                  services.ui.notice(String(e), "error");
                }
              }}
            />
          </SettingRow>
        )}
        <SettingRow agents="none" source="local" label={t("conversation.timelineIntro")} hint={t("conversation.timelineIntroHint")}>
          <Toggle checked={ui.timelineIntro} onChange={(v) => setUiPref("timelineIntro", v)} />
        </SettingRow>
      </Section>

      {/* 长对话和长消息 (owner 2026-10-18): how much of a long conversation loads, and folding long messages. */}
      <Section id={settingsAnchorId("fold")} title={t("conversation.longSection")}>
        <SettingRow agents="none" source="local" label={t("conversation.timelineTurns")} info={t("conversation.timelineTurnsHint")}>
          <Select
            value={String(ui.timelineTurns)}
            options={[20, 30, 50, 100, 0].map((n) => ({ value: String(n), label: n === 0 ? t("conversation.timelineTurns.all") : t("conversation.timelineTurns.n", { n }) }))}
            onChange={(v) => setUiPref("timelineTurns", Number(v))}
          />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("appearance.foldLong")} info={t("appearance.foldLongHint")}>
          <Segmented
            value={fold}
            options={(["off", "mine", "all"] as const).map((v) => ({ value: v, label: t(`appearance.foldLong.${v}` as MessageKey) }))}
            onChange={setFold}
          />
        </SettingRow>
        <SettingRow agents="none" source="local" label={t("appearance.foldLines")} info={t("appearance.foldLinesHint")}>
          <Segmented
            value={String(ui.foldLines)}
            disabled={!ui.foldLong}
            options={FOLD_LINE_OPTIONS.map((n) => ({ value: String(n), label: t("appearance.foldLines.n", { n }) }))}
            onChange={(v) => setUiPref("foldLines", migrateFoldLines(Number(v)))}
          />
        </SettingRow>
      </Section>

      {/* Unknown module contributions stay with messages instead of disappearing when grouped. */}
      <SettingsSections page="conversation" except={CONVERSATION_PLACED_SECTIONS} />
      </div>
      <div id={settingsAnchorId("conv-input")}>
        <h2 className="mb-3 text-title">{t("settings.ia.input")}</h2>
        <SettingsSections page="conversation" only={CONVERSATION_INPUT_SECTIONS} />
      </div>
      <div id={settingsAnchorId("conv-layout")}>
        <h2 className="mb-3 text-title">{t("settings.ia.layout")}</h2>
        <SettingsSections page="conversation" only={CONVERSATION_LAYOUT_SECTIONS} />
      </div>
      {sideChatOn && <div id={settingsAnchorId("conv-side-chat")}>
        <h2 className="mb-3 text-title">{t("settings.ia.sideChat")}</h2>
        <SettingsSections page="conversation" only={CONVERSATION_SIDE_SECTIONS} />
      </div>}
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
  // The queue panel (the focus host's) reads the same value (lib/admissionOrderView); keep it current
  // when this card is on the focus host (its picker may show another).
  const onFocus = useTargetHostId() === useApp((s) => s.hosts?.active ?? "local");
  useEffect(() => {
    if (value !== undefined && onFocus) setOwnerMayPassAsks(value);
  }, [value, onFocus]);
  return (
    <SettingRow agents="now" source="host" label={t("queue.ownerMayPassAsks")} hint={error ?? t("queue.ownerMayPassAsksHint")}>
      <Toggle disabled={value === undefined} checked={value ?? true} onChange={(v) => void patch({ queue: { ownerMayPassAsks: v } })} />
    </SettingRow>
  );
}

/** 协作 → 排队顺序 (owner 2026-10-19; was a host card on 输入区): next to 消息投递. */
export function QueueOrderSection() {
  const { t } = useI18n();
  const supported = useTargetFeatures().has(ADMISSION_ORDER_FEATURE);
  if (!supported) return null;
  return (
    <Section id={settingsAnchorId("queueOrder")} title={t("queue.orderSection")} hint={t("queue.orderSectionHint")}>
      <OwnerMayPassAsksRow />
    </Section>
  );
}

/**
 * cutex `imageInput.busyBehavior` (image-input-steering, r264; the connected host's cutex): what an ordinary
 * send with images does while the agent works — queue (default: the original image goes out when the turn
 * ends) or insert into the turn. Explicit 插话 / 排队 never read it.
 */
export function ImageBusyRow({ value, error, onChange }: { value: ImageBusyBehavior | undefined; error?: string | null; onChange(v: ImageBusyBehavior): void }) {
  const { t } = useI18n();
  return (
    <SettingRow agents="now" source="host" label={t("queue.imageBusy")} hint={error ?? t(value === "steer" ? "queue.imageBusy.steerHint" : "queue.imageBusy.queueHint")}>
      <Segmented
        value={value ?? "queue"}
        disabled={value === undefined}
        options={(["queue", "steer"] as const).map((v) => ({ value: v, label: t(`queue.imageBusy.${v}` as MessageKey) }))}
        onChange={onChange}
      />
    </SettingRow>
  );
}

/** 协作 → 运行中的图片消息 (r264): next to 排队顺序; only on a host with image-input-steering. */
export function ImageBusySection() {
  const { t } = useI18n();
  const supported = useTargetFeatures().has(IMAGE_INPUT_STEERING_FEATURE);
  if (!supported) return null;
  return (
    <Section id={settingsAnchorId("imageBusy")} title={t("queue.imageBusy.section")} hint={t("queue.imageBusy.sectionHint")}>
      <HostImageBusyRow />
    </Section>
  );
}

/** The row on the target host's `/v2/settings` (read once, PATCH `{imageInput: {busyBehavior}}`). */
function HostImageBusyRow() {
  const { settings, error, patch } = useGlobalSettings();
  return <ImageBusyRow value={readImageBusyBehavior(settings)} error={error} onChange={(v) => void patch(imageBusyPatch(v))} />;
}

// ---- 输入区 ----

/**
 * 输入区 (owner 2026-10-18: settings by screen region): sending (from 对话 → 输入框), the 「接下来」 panel,
 * what sits right above the input (「需要你」 strip, status row) and the 底栏 below it. Where status items
 * show and the capsule moved to their own page, 状态 (StatusPage; owner 2026-10-18: neither is the input).
 */
/** 输入区: the 会话 page's input-area cards (design 006 v1: was its own page `composer`, now a section of 会话). */
export function ComposerPage() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  // Also the 调整输入区 panel, which holds local settings only (lead 2026-10-18): no host row there.
  const panel = useCompactSettings();
  const asks = useApp((s) => s.features.has(ASKS_FEATURE));
  const admissionOrder = useApp((s) => s.features.has(ADMISSION_ORDER_FEATURE));
  const imageSteer = useApp((s) => s.features.has(IMAGE_INPUT_STEERING_FEATURE));
  const openSettings = useApp((s) => s.openSettings);
  return (
    <>
      <Section id={settingsAnchorId("send")} title={t("shell.composer.send")}>
        {/* Only what Enter does while the agent works (owner 2026-10-18); every key is on 键盘快捷键. One line either way, so nothing below moves. */}
        <SettingRow agents="none" source="local"
          label={t("settings.sendKeys")}
          hint={
            <>
              {t(ui.sendKeys === "cli" ? "conversation.sendKeys.cliHint" : "conversation.sendKeys.queueFirstHint")}
              <HintAction onClick={() => openSettings("shortcuts")}>{t("conversation.sendKeys.shortcutsLink")}</HintAction>
            </>
          }
        >
          <Segmented
            value={ui.sendKeys}
            options={[
              // 插话优先 · 排队优先 (owner 2026-10-18; "cli" is the stored value of 插话优先).
              { value: "cli" as const, label: t("settings.sendKeys.cli") },
              { value: "queueFirst" as const, label: t("settings.sendKeys.queueFirst") },
            ]}
            onChange={(v) => setUiPref("sendKeys", v)}
          />
        </SettingRow>
        {asks && (
          <SettingRow agents="none" source="local" label={t("conversation.delegationSteerKeys")} hint={t("conversation.delegationSteerKeysHint")}>
            <Toggle checked={ui.delegationSteerKeys} onChange={(v) => setUiPref("delegationSteerKeys", v)} />
          </SettingRow>
        )}
        {/* 运行中的图片消息 is the host's (r264): on 协作 next to 排队顺序; here only a way there. */}
        {imageSteer && !panel && <LinkRow agents="none" source="local" label={t("queue.imageBusy")} link={t("queue.imageBusy.link")} onClick={() => openSettings("collab", { anchor: "imageBusy" })} />}
      </Section>
      <Section id={settingsAnchorId("queuePanel")} title={t("queue.panelFold")}>
        <SettingRow agents="none" source="local" label={t("shell.composer.panelOpen")} hint={t(ui.queuePanelFold === "auto" ? "queue.panelFold.autoHint" : "queue.panelFold.openHint")}>
          <Segmented
            value={ui.queuePanelFold}
            options={(["open", "auto"] as const).map((v) => ({ value: v, label: t(`queue.panelFold.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("queuePanelFold", v)}
          />
        </SettingRow>
        {admissionOrder && (
          <SettingRow agents="none" source="local" label={t("queue.sectionStrip")} hint={t("queue.sectionStripHint")}>
            <Toggle checked={ui.queueSectionStrip} onChange={(v) => setUiPref("queueSectionStrip", v)} />
          </SettingRow>
        )}
        {/* 排队顺序 is the host's (owner 2026-10-19: on 协作, next to 消息投递); here only a way there. */}
        {admissionOrder && !panel && <LinkRow agents="none" source="local" label={t("queue.ownerMayPassAsks")} link={t("queue.orderLink")} onClick={() => openSettings("collab", { anchor: "queueOrder" })} />}
      </Section>
      {/* Names (owner 2026-10-18, N3): 状态行 right above the input, 底栏 below it; each section says where. */}
      <Section id={settingsAnchorId("aboveInput")} title={t("shell.status.aboveInput")} hint={t("shell.status.aboveInputHint")}>
        <SettingRow agents="none" source="local" label={t("appearance.needsYouStrip")} hint={t("appearance.needsYouStripHint")}>
          <Toggle checked={ui.needsYouStrip} onChange={(v) => setUiPref("needsYouStrip", v)} />
        </SettingRow>
        <LinkRow agents="none" source="local" label={t("shell.composer.barItems")} hint={t("shell.composer.barItemsHint")} link={t("shell.composer.barItemsLink")} onClick={() => openSettings("status")} />
      </Section>
      <Section id={settingsAnchorId("inputBar")} title={t("shell.composer.inputBar")} hint={t("shell.composer.inputBarHint")}>
        <SettingRow agents="none" source="local" label={t("composer.profileAvatar")} info={t("composer.profileAvatarHint")}>
          <Toggle checked={ui.composerProfileAvatar} onChange={(v) => setUiPref("composerProfileAvatar", v)} />
        </SettingRow>
      </Section>
    </>
  );
}

// ---- 状态 ----

/**
 * 状态 (owner 2026-10-18: split out of 输入区 again): where status items show — the shell's generic
 * placement table, reachable with the capsule module off (it then says why capsule choices do not show)
 * — and the sections modules add for their status surfaces (the capsule's, module status-capsule).
 */
export function StatusPage() {
  const { t } = useI18n();
  return (
    <>
      <Section id={settingsAnchorId("places")} title={t("shell.capsule.places")} hint={t("shell.statusPlace.hint")}>
        <StatusPlaceTable />
      </Section>
      <SettingsSections page="status" />
    </>
  );
}

// ---- 侧栏与顶栏 ----

export function SidebarPage() {
  // The cards are shared with the 调整左侧栏 panel (regions/SidebarSettings).
  return <SidebarSettingsCards />;
}

// ---- 键盘快捷键 ----

/** The rebindable window / pane keys (KeybindingsSection), then the fixed ones; the send-key scheme itself is set on 对话 → 输入框. */
export function ShortcutsPage() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  const openSettings = useApp((s) => s.openSettings);
  const mac = bridge.platform === "darwin";
  return (
    <>
      <Section>
        <LinkRow agents="none" source="local"
          label={t("settings.sendKeys")}
          hint={t("shortcuts.readOnly")}
          link={t("shell.shortcuts.sendKeysLink", { scheme: t(ui.sendKeys === "cli" ? "settings.sendKeys.cli" : "settings.sendKeys.queueFirst") })}
          onClick={() => openSettings("conversation", { anchor: "send" })}
        />
      </Section>
      <KeybindingsSection />
      <Section id={settingsAnchorId("gestures")} title={t("gestures.title")}>
        <GestureGuide />
      </Section>
      {shortcutsFor(ui.sendKeys).map((group) => (
        <Section key={group.id} id={settingsAnchorId(`shortcuts-${group.id}`)} title={t(group.title)}>
          {group.items.map((s, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border py-2 last:border-b-0">
              <span className="flex w-44 shrink-0 flex-wrap gap-1">
                {s.keys.map((k) => (
                  <kbd key={k} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-caption/[inherit] text-foreground">
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
    <SettingsGroup agents="now" source="host"><ListRow
      leading={<Avatar name={row.name} color={row.color} avatar={session.avatar} seed={session.cutexSessionId} size={20} />}
      title={row.name}
      detail={detail || undefined}
      actions={
        <>
          <Button disabled={busy} onClick={() => void select(row.id)}>{t("archive.row.view")}</Button>
          <Button disabled={busy} onClick={() => void act(() => restoreWithDirector(session, t, hostId))} title={archivedProject ? t("archive.banner.projectArchived", { project: archivedProject.name }) : undefined}>
            {t("archive.row.restore")}
          </Button>
          {canDelete && !lacks(agentFeaturesOf(session), "threadDelete") && <ArmedRemove title={t("archive.row.delete")} armedLabel={t("archive.row.deleteArmed")} disabled={busy} onRemove={() => void act(() => deleteAgentNow(session, t, undefined, hostId))} />}
        </>
      }
      below={error ? <p className="mt-1 text-xs text-danger">{error}</p> : undefined}
    /></SettingsGroup>
  );
}

/** `archiveDeleteEmpty` (cutex session-delete-empty-on-archive; default on). */
export function ArchiveBehaviour() {
  const { t } = useI18n();
  const supported = useTargetFeatures().has(SESSION_FEATURES.deleteEmpty);
  const { settings, error, patch } = useGlobalSettings();
  const hostId = useTargetHostId();
  const host = useApp((s) => s.hosts?.hosts.find((h) => h.id === hostId)?.label) ?? hostId;
  const enabled = settings?.archiveDeleteEmpty ?? true;
  const [armed, setArmed] = useArmed(`${hostId}:${enabled}`);
  const risk = useSettingsRisk([supported, enabled]);
  const [pending, setPending] = useState<{ valid(): boolean } | null>(null);
  if (!supported) return null;
  return (
    <Section>
      {error && <ErrorNote>{error}</ErrorNote>}
      <SettingRow agents="now" source="host" label={t("archive.deleteEmpty")} hint={t("archive.deleteEmptyHint")}>
        <Toggle disabled={!settings} checked={enabled} onChange={(v) => { if (v) { setPending({ valid: risk.capture() }); setArmed(true); } else { setArmed(false); setPending(null); void patch({ archiveDeleteEmpty: false }); } }} />
      </SettingRow>
      {armed && !enabled && pending?.valid() && <div className="flex flex-wrap items-center gap-2 py-2">
        <p className="w-full text-xs text-danger">{t("settings.ia.emptyConfirm", { host })}</p>
        <SettingsGroup agents="now" source="host"><button type="button" className={ARMED_FORM_BUTTON} disabled={!settings} onClick={() => { if (!pending.valid()) return; setArmed(false); setPending(null); void patch({ archiveDeleteEmpty: true }); }}>{t("settings.ia.emptyEnable")}</button></SettingsGroup>
        <Button onClick={() => { setArmed(false); setPending(null); }}>{t("settings.ia.emptyCancel")}</Button>
      </div>}
    </Section>
  );
}

// ---- 关于 ----

/**
 * Settings → 关于: the version card on top — this desktop (version, where it stands, 更新 when one is
 * ready, → 更新与诊断), the connected host's cutex (→ 主机后端更新) and its runtime (→ 运行时), with the
 * exact builds under 详细信息 — then the about module's cards (已知问题, 更新记录, 项目) and the dragon.
 */
export function AboutPage() {
  const { t } = useI18n();
  const caps = useCapabilities();
  const status = useUpdateStatus();
  const line = useUpdateStatusLine(status);
  const runtime = useHostRuntimePackages();
  const outdated = useOutdatedAgentCount();
  const localHost = useApp((s) => hasLocalHost(s.hosts));
  const hostLabel = useApp((s) => s.hosts?.hosts.find((h) => h.id === s.hosts?.active)?.label ?? null);
  const connected = useApp((s) => s.daemon.kind === "connected");
  const backendPage = useApp((s) => s.features.has(BACKEND_UPGRADE_FEATURE));
  const openSettings = useApp((s) => s.openSettings);
  // Opening 关于 refreshes the runtime package list (no-op without the capability).
  useEffect(() => void refreshRuntimePackages(), []);
  const desktop = desktopVersionText(status) ?? (status?.state === "unsupported" ? t("shell.about.devBuild") : "—");
  const selected = runtime?.view?.selected ?? null;
  const cutexText = { dev: t("cutexBuild.dev"), legacy: t("cutexBuild.legacy") };
  const cutexShort = caps ? (caps.cutexBuild?.release ?? cutexBuildText(caps.cutexBuild, cutexText)) : null;
  return (
    <>
      <Section>
        <SettingRow readOnly={!updateButtonVisible(status)} agents="none" source="local"
          label={t("shell.about.desktop")}
          hint={
            <>
              {localHost && <span>{t("settings.source.local")} · </span>}
              <span className={status?.state === "error" ? "text-danger" : status && updateButtonVisible(status) ? "text-foreground" : undefined}>{line ?? t("shell.about.desktopHint")}</span>
            </>
          }
        >
          <span className="font-mono text-sm tabular-nums select-text">{desktop}</span>
          {updateButtonVisible(status) && <UpdateButton />}
          {bridge.shell && <TextLink onClick={() => openSettings("updates")}>{t("shell.about.updatesLink")}</TextLink>}
        </SettingRow>
        <SettingRow readOnly agents="none" source="host" label="cutex" hint={!connected ? t("shell.about.noHost") : hostLabel ? t("shell.about.cutexHintHost", { host: hostLabel }) : t("shell.about.cutexHint")}>
          <span className="font-mono text-sm tabular-nums select-text">{cutexShort ?? "—"}</span>
          {backendPage && connected && <TextLink onClick={() => openSettings("backend")}>{t("shell.about.backendLink")}</TextLink>}
        </SettingRow>
        {/* Versions and the agent upgrade live on Settings → 运行时; this row links there. */}
        <SettingRow readOnly agents="none" source="host"
          label={t("shell.about.native")}
          hint={outdated > 0 ? <span className="text-warn">{t("runtimePackages.dotHint", { n: outdated })}</span> : runtime ? t("shell.about.nativeSelected") : t("settings.pendingCutex", { api: "GET /v2/runtime-packages" })}
        >
          <span className="font-mono text-xs text-muted" title={selected?.nativeVersion ?? undefined}>
            {packageLabel(selected) ?? "—"}
          </span>
          <TextLink onClick={() => services.ui.openSettings("runtime")}>{t("shell.about.runtimeLinkText")}</TextLink>
        </SettingRow>
        <>
          <SettingRow readOnly agents="none" source="local" label={t("shell.about.desktopBuild")} info={t("shell.about.desktopBuildHint")}>
            <span className="font-mono text-xs text-muted tabular-nums select-text">{buildLabel(status?.current) ?? "—"}</span>
          </SettingRow>
          <SettingRow readOnly agents="none" source="host" label={t("shell.about.cutexBuild")}>
            <span className="font-mono text-xs text-muted select-text">{caps ? cutexBuildText(caps.cutexBuild, cutexText) : "—"}</span>
          </SettingRow>
          {selected?.nativeVersion && (
            <SettingRow readOnly agents="none" source="host" label={t("shell.about.nativeVersion")}>
              <span className="font-mono text-xs text-muted select-text">{selected.nativeVersion}</span>
            </SettingRow>
          )}
        </>
      </Section>
      {/* The about module: known issues, changelog, project (repositories, license, notices). */}
      <SettingsSections page="about" />
      <AboutDragon />
    </>
  );
}
