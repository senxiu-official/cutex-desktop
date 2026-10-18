// Settings pages for this machine (group 「应用」): 通用 (+ 更新与诊断 from the updater module), 对话,
// 左侧栏 (+ 会话两侧), 状态显示 — plus 归档 (数据) and 键盘快捷键, 关于 (系统: versions, licenses, the dragon). Desktop-local prefs live in localStorage
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
import { setUiPref, useUiPrefs } from "../../lib/prefs";
import { displayKey, shortcutsFor } from "../../lib/shortcuts";
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
import { ARMED_FORM_BUTTON, useArmed } from "../../lib/armedConfirm";
import { formatBytes } from "../../../../shared/releases";
import { effectiveUpdateCheckMinutes, updateCheckChoices } from "../../../../shared/binaryUpdate";
import { Avatar } from "../Avatar";
import { UpdateButton } from "../UpdateButton";
import { AboutDragon } from "./AboutDragon";
import { SidebarSettingsCards } from "./regions/SidebarSettings";
import { OwnerNotifySection } from "./OwnerNotifySettings";
import { ArmedRemove, Button, Details, useCompactSettings, EmptyState, ErrorNote, HintAction, LinkRow, ListRow, Section, Segmented, Select, SettingRow, TextLink, Toggle } from "./Form";
import { StatusPlaceTable } from "./StatusPlaceTable";
import { SettingsHostSection } from "../SettingsHostFrame";
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
      <Section id={settingsAnchorId("language")} title={t("shell.general.language")}>
        <SettingRow label={t("shell.language")}>
          <Select
            value={locale}
            options={[...LANGUAGES]}
            onChange={setLocale}
          />
        </SettingRow>
        <PlannedSelectRow label={t("shell.dateFormat")} hint={t("shell.dateFormatHint")} options={[t("shell.format.followLanguage", { sample: "2026-10-18" }), "18/10/2026", "10/18/2026"]} />
        <PlannedSelectRow label={t("shell.numberFormat")} hint={t("shell.numberFormatHint")} options={[t("shell.format.followLanguage", { sample: "1,234.5" }), "1.234,5", "1 234,5"]} />
      </Section>
      <TermsSection />
      <WindowSection />
      {/* 更新与诊断 (module updater). */}
      <SettingsSections page="general" />
    </>
  );
}

/**
 * A planned setting shown before it works (owner 2026-10-18: 日期 / 数字格式 as placeholders so the
 * feature has a place and options to build to): a disabled Select with a 「待实现」 tag, not stored.
 */
function PlannedSelectRow({ label, hint, options }: { label: string; hint: string; options: readonly string[] }) {
  const { t } = useI18n();
  return (
    <SettingRow
      label={
        <span className="inline-flex items-center gap-2">
          {label}
          <span className="inline-flex h-5 items-center rounded bg-surface-2 px-1.5 text-[11px] font-normal text-subtle">{t("shell.planned")}</span>
        </span>
      }
      hint={hint}
    >
      <Select<string> disabled label={label} value="0" options={options.map((o, i) => ({ value: String(i), label: o }))} onChange={() => {}} />
    </SettingRow>
  );
}

/** 窗口: 关闭窗口时 (stored by the main process; the section is left out in the browser preview). */
function WindowSection() {
  const { t } = useI18n();
  const [state] = useShellState();
  if (!bridge.shell || !state) return null;
  return (
    <Section id={settingsAnchorId("window")} title={t("shell.general.window")}>
      <CloseBehaviorRow />
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
    <SettingRow label={t("shell.closeWindow")} hint={!state.trayAvailable ? t("shell.closeWindow.noTray") : state.trayHostMissing && state.prefs.closeBehavior === "quit" ? t("shell.closeWindow.noTrayHost") : undefined}>
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
 * checks again); a fixed channel is shown read-only under 详细信息 instead (UpdateDetails).
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

/** 详细信息 of 更新与诊断: the exact build, a fixed channel, the update source, the last check, the Releases page. */
function UpdateDetails({ status }: { status: UpdateStatus }) {
  const { t } = useI18n();
  const channel = status.channel ?? null;
  const checked = status.checkedAt ? Date.parse(status.checkedAt) : NaN;
  return (
    <Details>
      <SettingRow label={t("updater.details.build")}>
        <span className="font-mono text-xs text-muted tabular-nums select-text">{buildLabel(status.current) ?? "—"}</span>
      </SettingRow>
      {channel && !(status.canSwitchChannel && bridge.update?.setChannel) && (
        <SettingRow label={t("updater.channel")} hint={t("updater.channelHint")}>
          <span className="text-xs text-muted">{channelLabel(t, channel)}</span>
        </SettingRow>
      )}
      {status.source && (
        <SettingRow label={t("updater.source")} hint={t(status.binary ? "updater.sourceHint.binary" : "updater.sourceHint")}>
          <span className="flex min-w-0 font-mono text-xs text-muted select-text" title={`${status.source} · ${channel ?? ""}`}>
            <span className="min-w-0 truncate">{status.source}</span>
            {channel && <span className="shrink-0 whitespace-pre"> · {channel}</span>}
          </span>
        </SettingRow>
      )}
      {Number.isFinite(checked) && (
        <SettingRow label={t("updater.lastCheck")}>
          <span className="text-xs text-muted tabular-nums">{formatAbsolute(Math.floor(checked / 1000))}</span>
        </SettingRow>
      )}
      {status.state === "unsupported" && status.reason && (
        <SettingRow label={t("updater.reason")}>
          <span className="max-w-80 truncate font-mono text-xs text-subtle select-text" title={status.reason}>
            {status.reason}
          </span>
        </SettingRow>
      )}
      {status.releasePage && status.code !== "releasePackage" && (
        <SettingRow label={t("updater.releasePage")} hint={t("updater.releasePageHint")}>
          <Button onClick={() => void api.openExternal(status.releasePage!)} title={status.releasePage}>
            {t("updater.releasePage.open")}
          </Button>
        </SettingRow>
      )}
    </Details>
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
          <SettingRow
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
          <SettingRow label={t("updater.updateCheck")} hint={t("updater.updateCheckHint")}>
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
  return (
    <>
      {/* 对话顶部 (moved from 侧栏与顶栏, owner 2026-10-18: settings grouped by screen region). */}
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

      {/* 长对话和长消息 (owner 2026-10-18): how much of a long conversation loads, and folding long messages. */}
      <Section id={settingsAnchorId("fold")} title={t("conversation.longSection")}>
        <SettingRow label={t("conversation.timelineTurns")} hint={t("conversation.timelineTurnsHint")}>
          <Select
            value={String(ui.timelineTurns)}
            options={[20, 30, 50, 100, 0].map((n) => ({ value: String(n), label: n === 0 ? t("conversation.timelineTurns.all") : t("conversation.timelineTurns.n", { n }) }))}
            onChange={(v) => setUiPref("timelineTurns", Number(v))}
          />
        </SettingRow>
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

      {/* Module sections on this page (批注, 侧边对话). 输入框 moved to 输入区; 书签条 and 成果 to 右侧栏与留白 (owner 2026-10-18). */}
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
  // The queue panel (the focus host's) reads the same value (lib/admissionOrderView); keep it current
  // when this card is on the focus host (its picker may show another).
  const onFocus = useTargetHostId() === useApp((s) => s.hosts?.active ?? "local");
  useEffect(() => {
    if (value !== undefined && onFocus) setOwnerMayPassAsks(value);
  }, [value, onFocus]);
  return (
    <SettingRow label={t("queue.ownerMayPassAsks")} hint={error ?? t("queue.ownerMayPassAsksHint")}>
      <Toggle disabled={value === undefined} checked={value ?? true} onChange={(v) => void patch({ queue: { ownerMayPassAsks: v } })} />
    </SettingRow>
  );
}

// ---- 输入区 ----

/**
 * 输入区 (owner 2026-10-18: settings by screen region): sending (from 对话 → 输入框), the 「接下来」 panel,
 * what sits right above the input (「需要你」 strip, status row) and the 底栏 below it. Where status items
 * show and the capsule moved to their own page, 状态 (StatusPage; owner 2026-10-18: neither is the input).
 */
export function ComposerPage() {
  const { t } = useI18n();
  const ui = useUiPrefs();
  // Also the 调整输入区 panel, which holds local settings only (lead 2026-10-18): no host row there.
  const panel = useCompactSettings();
  const asks = useApp((s) => s.features.has(ASKS_FEATURE));
  const admissionOrder = useApp((s) => s.features.has(ADMISSION_ORDER_FEATURE));
  const openSettings = useApp((s) => s.openSettings);
  return (
    <>
      <Section id={settingsAnchorId("send")} title={t("shell.composer.send")}>
        {/* Only what Enter does while the agent works (owner 2026-10-18); every key is on 键盘快捷键. One line either way, so nothing below moves. */}
        <SettingRow
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
          <SettingRow label={t("conversation.delegationSteerKeys")} hint={t("conversation.delegationSteerKeysHint")}>
            <Toggle checked={ui.delegationSteerKeys} onChange={(v) => setUiPref("delegationSteerKeys", v)} />
          </SettingRow>
        )}
      </Section>
      {/* A host setting on this local page (owner 2026-10-18): its own card with the host chip; not in the
          panel, which holds local settings only. */}
      {!panel && (
        <SettingsHostSection id={settingsAnchorId("queueOrder")} title={t("queue.orderSection")} requires={[ADMISSION_ORDER_FEATURE]}>
          <OwnerMayPassAsksRow />
        </SettingsHostSection>
      )}
      <Section id={settingsAnchorId("queuePanel")} title={t("queue.panelFold")}>
        <SettingRow label={t("shell.composer.panelOpen")} hint={t(ui.queuePanelFold === "auto" ? "queue.panelFold.autoHint" : "queue.panelFold.openHint")}>
          <Segmented
            value={ui.queuePanelFold}
            options={(["open", "auto"] as const).map((v) => ({ value: v, label: t(`queue.panelFold.${v}` as MessageKey) }))}
            onChange={(v) => setUiPref("queuePanelFold", v)}
          />
        </SettingRow>
        {admissionOrder && (
          <SettingRow label={t("queue.sectionStrip")} hint={t("queue.sectionStripHint")}>
            <Toggle checked={ui.queueSectionStrip} onChange={(v) => setUiPref("queueSectionStrip", v)} />
          </SettingRow>
        )}
      </Section>
      {/* Names (owner 2026-10-18, N3): 状态行 right above the input, 底栏 below it; each section says where. */}
      <Section id={settingsAnchorId("aboveInput")} title={t("shell.status.aboveInput")} hint={t("shell.status.aboveInputHint")}>
        <SettingRow label={t("appearance.needsYouStrip")} hint={t("appearance.needsYouStripHint")}>
          <Toggle checked={ui.needsYouStrip} onChange={(v) => setUiPref("needsYouStrip", v)} />
        </SettingRow>
        <LinkRow label={t("shell.composer.barItems")} hint={t("shell.composer.barItemsHint")} link={t("shell.composer.barItemsLink")} onClick={() => openSettings("status")} />
      </Section>
      <Section id={settingsAnchorId("inputBar")} title={t("shell.composer.inputBar")} hint={t("shell.composer.inputBarHint")}>
        <SettingRow label={t("shell.composer.quotaReset")}>
          <Toggle checked={ui.quotaShowReset} onChange={(v) => setUiPref("quotaShowReset", v)} />
        </SettingRow>
        <SettingRow label={t("composer.profileAvatar")} hint={t("composer.profileAvatarHint")}>
          <Toggle checked={ui.composerProfileAvatar} onChange={(v) => setUiPref("composerProfileAvatar", v)} />
        </SettingRow>
      </Section>
      <SettingsSections page="composer" />
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
          onClick={() => openSettings("composer")}
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
      leading={<Avatar name={row.name} color={row.color} avatar={session.avatar} seed={session.cutexSessionId} size={22} minor />}
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
        <SettingRow
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
        <SettingRow label="cutex" hint={!connected ? t("shell.about.noHost") : hostLabel ? t("shell.about.cutexHintHost", { host: hostLabel }) : t("shell.about.cutexHint")}>
          <span className="font-mono text-sm tabular-nums select-text">{cutexShort ?? "—"}</span>
          {backendPage && connected && <TextLink onClick={() => openSettings("backend")}>{t("shell.about.backendLink")}</TextLink>}
        </SettingRow>
        {/* Versions and the agent upgrade live on Settings → 运行时; this row links there. */}
        <SettingRow
          label={t("shell.about.native")}
          hint={outdated > 0 ? <span className="text-warn">{t("runtimePackages.dotHint", { n: outdated })}</span> : runtime ? t("shell.about.nativeSelected") : t("settings.pendingCutex", { api: "GET /v2/runtime-packages" })}
        >
          <span className="font-mono text-xs text-muted" title={selected?.nativeVersion ?? undefined}>
            {packageLabel(selected) ?? "—"}
          </span>
          <TextLink onClick={() => services.ui.openSettings("runtime")}>{t("shell.about.runtimeLinkText")}</TextLink>
        </SettingRow>
        <Details>
          <SettingRow label={t("shell.about.desktopBuild")} hint={t("shell.about.desktopBuildHint")}>
            <span className="font-mono text-xs text-muted tabular-nums select-text">{buildLabel(status?.current) ?? "—"}</span>
          </SettingRow>
          <SettingRow label={t("shell.about.cutexBuild")}>
            <span className="font-mono text-xs text-muted select-text">{caps ? cutexBuildText(caps.cutexBuild, cutexText) : "—"}</span>
          </SettingRow>
          {selected?.nativeVersion && (
            <SettingRow label={t("shell.about.nativeVersion")}>
              <span className="font-mono text-xs text-muted select-text">{selected.nativeVersion}</span>
            </SettingRow>
          )}
        </Details>
      </Section>
      {/* The about module: known issues, changelog, project (repositories, license, notices). */}
      <SettingsSections page="about" />
      <AboutDragon />
    </>
  );
}
