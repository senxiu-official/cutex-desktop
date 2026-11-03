import { useEffect, useMemo } from "react";
import { PaneHost } from "./components/PaneHost";
import { DesktopBackground, TrayFrame } from "./components/ChipTray";
import { ForetellLayer } from "./components/ForetellLayer";
import { startTrayOpen } from "./lib/trayOpen";
import { startWorkspaceSets } from "./lib/workspaceSets";
import { startConvStrips } from "./lib/convStrips";
import { startBackKey } from "./lib/workspaceEffects";
import { Overlays } from "./components/Overlays";
import { SshPromptDialog } from "./components/SshPromptDialog";
import { RemoteCloseDialog } from "./components/RemoteCloseDialog";
import { FirstUseTips } from "./components/FirstUseTips";
import { PanelGuideHost } from "./components/PanelGuideHost";
import { OnboardingHost } from "./components/OnboardingDialog";
import { AgentListDialog } from "./components/AgentListDialog";
import { JobOutputDialog } from "./components/JobParts";
import { TitleBar } from "./components/TitleBar";
import { HostAccessBanner } from "./components/AccessNotices";
import { SideInstanceLayer } from "./components/side/SideInstanceLayer";
import { SideDndLayer } from "./components/side/SideDndLayer";
import { WorkspaceDndLayer } from "./components/WorkspaceDndLayer";
import { ColumnPickLayer } from "./components/ColumnPickLayer";
import { ShelfToast } from "./components/side/ShelfToast";
import { HostBusyActions } from "./components/HostBusyActions";
import { SettingsShelf } from "./components/SettingsShelf";
import { WidthTip } from "./components/WidthTip";
import { useSettingsShelf } from "./lib/settingsShelf";
import { useSettingsShelfMaximized } from "./lib/portrait";
import { useFullscreen } from "./lib/panelFull";
import { FullscreenHint, WindowBarFrame } from "./components/PanelFullscreen";
import { LOCAL_HOST_ID } from "../../shared/hosts";
import { api, bridge } from "./bridge";
import { activeHost, hasLocalHost, hasNoHost, hostIndicator, isRemote } from "./lib/hosts";
import { useTurnMarkUpkeep } from "./lib/attentionView";
import { useDesktopShell } from "./lib/shell";
import { useTermsSync } from "./lib/termsSync";
import { startSideStore } from "./lib/sideLayoutStore";
import { startDragTrace } from "./lib/dragTrace";
import { startPaneSync } from "./lib/paneStore";
import { startPaneActions } from "./lib/paneActions";
import { useSideShortcuts } from "./lib/useSideShortcuts";
import { useStaleFocusGuard } from "./lib/staleFocus";
import { useSelectedHost, useSelectedScope, useWorkspace, WorkspaceContext } from "./lib/workspaceView";
import { useI18n, type MessageKey } from "./i18n";
import { appModules } from "./modules/app";
import { PageAsideOutlet } from "./modules/Outlet";
import { useOpenPage } from "./modules/react";
import { hostApi, useApp } from "./store";
import { DeskWindows } from "./components/DeskWindows";
import { followDesksSetting } from "./lib/deskSync";
import { startMultiWindowPref } from "./lib/multiWindowPref";
import { legacyMultiWindow } from "./lib/prefs";
import { MAIN_WINDOW } from "./lib/windowScope";

const BANNER_BUTTON = "shrink-0 rounded px-1.5 py-0.5 hover:bg-warn/15 hover:text-foreground";

/** Shown while the active host is not online; SSH hosts get the ssh problem and quick actions. */
function DaemonBanner() {
  const { t } = useI18n();
  const daemon = useApp((s) => s.daemon);
  const hosts = useApp((s) => s.hosts);
  const switchHost = useApp((s) => s.switchHost);
  const openSettings = useApp((s) => s.openSettings);
  const indicator = hostIndicator(hosts, daemon);
  // No host at all: the main area guides to adding one (components/FirstRun); nothing to reconnect.
  if (indicator.status === "online" || hasNoHost(hosts)) return null;
  if (!isRemote(hosts)) {
    const text =
      daemon.kind === "connecting"
        ? t("daemon.connecting")
        : daemon.kind === "unreachable" && daemon.setup
          ? t(daemon.setup === "notInstalled" ? "daemon.notInstalled" : "daemon.notRunning")
          : daemon.kind === "unreachable"
          ? `${t("daemon.unreachable")} — ${t("daemon.unreachableHint", { url: daemon.baseUrl })}`
          : `${t("daemon.error")}: ${daemon.kind === "error" ? daemon.message : ""}`;
    return <div className="border-b border-border bg-warn/10 px-4 py-1.5 text-xs text-warn">{text}</div>;
  }
  const host = activeHost(hosts)?.label ?? "";
  const problem = indicator.problem ? t(`host.problem.${indicator.problem}` as MessageKey) : null;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-warn/10 px-4 py-1 text-xs text-warn">
      <span className="min-w-0 flex-1 truncate" title={indicator.detail ?? undefined}>
        {t(`host.banner.${indicator.status}` as MessageKey, { host })}
        {problem && ` — ${problem}`}
      </span>
      {indicator.status !== "connecting" && (
        <button className={BANNER_BUTTON} onClick={() => void api.reconnectHost()}>
          {t("host.reconnect")}
        </button>
      )}
      {hasLocalHost(hosts) && (
        <button className={BANNER_BUTTON} onClick={() => void switchHost(LOCAL_HOST_ID)}>
          {t("host.backToLocal")}
        </button>
      )}
      <button className={BANNER_BUTTON} onClick={() => openSettings("hosts")}>
        {t("titlebar.connectionSettings")}
      </button>
    </div>
  );
}

export function App() {
  const init = useApp((s) => s.init);
  // A page with an Aside (设置) is a full-window page: the Aside replaces the app sidebar.
  const open = useOpenPage();
  const fullWindow = !!open?.entry?.item.Aside;
  // A panel in full screen (§24.16, lib/panelFull): only it stays — the Settings Shelf leaves, the window bar
  // is revealed at the top edge (components/PanelFullscreen), the sidebar and the tray step back by themselves.
  const full = useFullscreen();
  // Maximised — or this window portrait (lib/portrait: it opens maximised there).
  const settingsMax = useSettingsShelfMaximized();
  const covered = useSettingsShelf((s) => s.open && s.win === MAIN_WINDOW) && settingsMax && !full;
  const { locale } = useI18n();
  useDesktopShell(locale);
  useTermsSync();
  useTurnMarkUpkeep();
  // One workspace watch for the selected agent, shared by its conversation header's git chip and the right side.
  const scope = useSelectedScope();
  const workspaceHost = useSelectedHost();
  const workspace = useWorkspace(scope, workspaceHost);
  const focusHost = useApp((s) => s.hosts?.active);
  const selected = useMemo(() => ({ hostId: workspaceHost, api: hostApi(workspaceHost), scope, ...workspace }), [workspaceHost, focusHost, scope, workspace]); // eslint-disable-line react-hooks/exhaustive-deps -- hostApi follows the focus
  useEffect(() => init(), [init]);
  // The right side (components/side): its layout store follows the host / agent / modules.
  useEffect(() => startSideStore((listener) => appModules().subscribe(listener)), []);
  // The conversation panes (lib/paneStore): the layout follows the selection, persisted per device.
  useEffect(() => startPaneSync(), []);
  // Step 4: the tray (≤ 8 chips), the focused pane across both areas.
  useEffect(() => startPaneActions(), []);
  // The tray's open items, 返回上一个 (Alt+←) and the strips of folded conversations (docs/design/001, 002).
  useEffect(() => startTrayOpen(), []);
  useEffect(() => startWorkspaceSets(), []);
  useEffect(() => startConvStrips(), []);
  useEffect(() => startBackKey(), []);
  // Desk windows (multi-window, lib/deskSync): only with the 多窗口 setting on (also when switched on later).
  useEffect(() => followDesksSetting((listener) => appModules().subscribe(listener)), []);
  // 多窗口 is main's (desktop-prefs.json): follow it; the renderer's old value goes to main once (lib/multiWindowPref).
  useEffect(() => void startMultiWindowPref(bridge.shell, legacyMultiWindow()), []);
  // The width-drag trace (lib/dragTrace): only with its localStorage flag on.
  useEffect(() => startDragTrace(), []);
  useSideShortcuts(!fullWindow);
  useStaleFocusGuard();
  // First commit: tells main a just-installed update renders (otherwise it rolls back).
  useEffect(() => void bridge.shell?.rendererReady().catch(() => {}), []);
  return (
    <WorkspaceContext.Provider value={selected}>
      {/* isolate: the desktop background (z −1) sits behind every card yet above the body's window colour. */}
      <div className="relative isolate flex h-full">
        {/* The desktop background under the whole window (components/ChipTray; owner 2026-10-21): the gaps
            between the cards and the margins around them show it. */}
        <DesktopBackground />
        {/* A full-window page (设置): its Aside (← 返回 on top) runs the full height in place of the app
            sidebar and the title bar's sidebar / host row. Same tree shape either way, so the title
            bar, banner and overlays are not remounted when such a page opens. */}
        <PageAsideOutlet />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <WindowBarFrame>
            <TitleBar />
          </WindowBarFrame>
          <FullscreenHint />
          <DaemonBanner />
          {/* The restore notice lives at the top of the sidebar; with it collapsed, a title-bar chip
              (components/RestoreBanner). Never a full-width bar here. */}
          <HostAccessBanner />
          <AgentListDialog />
          <JobOutputDialog />
          <Overlays />
          <SshPromptDialog />
          <RemoteCloseDialog />
          <DeskWindows />
          <OnboardingHost />
          <FirstUseTips />
          <PanelGuideHost />
          {/* The work row as panes (components/PaneHost): the agent list, the conversation pane(s) / page
              and the right side; each conversation pane has its own ConversationScope. Beside it the
              global Settings Shelf (components/SettingsShelf, owner 2026-10-21): right by default, or
              left (CSS order), or maximised over the row — the row then stays mounted under it, inert. */}
          {/* The tray (components/ChipTray TrayFrame, owner 2026-10-21): a panel in its own band at an edge of
              this work area (bottom by default; top, left, right), outside the sidebar card and the Shelves. */}
          <TrayFrame hidden={covered}>
            <div className="relative flex min-h-0 min-w-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={covered || undefined} aria-hidden={covered || undefined}>
                <PaneHost fullWindow={fullWindow} scope={scope} />
              </div>
              <div className="contents" hidden={full || undefined}>
                <SettingsShelf />
              </div>
            </div>
          </TrayFrame>
        </div>
        <SideInstanceLayer />
        <SideDndLayer />
        <WidthTip />
        <WorkspaceDndLayer />
        <ColumnPickLayer />
        <ForetellLayer />
        <ShelfToast />
        <HostBusyActions />
      </div>
    </WorkspaceContext.Provider>
  );
}
