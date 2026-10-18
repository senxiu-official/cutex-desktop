import { useEffect, useMemo } from "react";
import { Conversation } from "./components/Conversation";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Sidebar } from "./components/Sidebar";
import { Overlays } from "./components/Overlays";
import { SshPromptDialog } from "./components/SshPromptDialog";
import { AgentListDialog } from "./components/AgentListDialog";
import { CustomizeHost } from "./components/CustomizeHost";
import { JobOutputDialog } from "./components/JobParts";
import { TitleBar } from "./components/TitleBar";
import { HostAccessBanner } from "./components/AccessNotices";
import { SideWorkArea } from "./components/side/SideArea";
import { SideInstanceLayer } from "./components/side/SideInstanceLayer";
import { SideDndLayer } from "./components/side/SideDndLayer";
import { LOCAL_HOST_ID } from "../../shared/hosts";
import { api, bridge } from "./bridge";
import { activeHost, hasLocalHost, hasNoHost, hostIndicator, isRemote } from "./lib/hosts";
import { useUiPrefs } from "./lib/prefs";
import { useTurnMarkUpkeep } from "./lib/attentionView";
import { useDesktopShell } from "./lib/shell";
import { useTermsSync } from "./lib/termsSync";
import { startSideStore } from "./lib/sideLayoutStore";
import { useSideShortcuts } from "./lib/useSideShortcuts";
import { useStaleFocusGuard } from "./lib/staleFocus";
import { useSelectedHost, useSelectedScope, useWorkspace, WorkspaceContext } from "./lib/workspaceView";
import { useI18n, type MessageKey } from "./i18n";
import { appModules } from "./modules/app";
import { MainOutlet, PageAsideOutlet } from "./modules/Outlet";
import { useOpenPage } from "./modules/react";
import { hostApi, useApp } from "./store";

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
  const selectedId = useApp((s) => s.selectedId);
  const { sidebarOpen } = useUiPrefs();
  const { locale } = useI18n();
  useDesktopShell(locale);
  useTermsSync();
  useTurnMarkUpkeep();
  // One workspace watch for the selected agent, shared by the title bar git chip and the right side.
  const scope = useSelectedScope();
  const workspaceHost = useSelectedHost();
  const workspace = useWorkspace(scope, workspaceHost);
  const focusHost = useApp((s) => s.hosts?.active);
  const selected = useMemo(() => ({ hostId: workspaceHost, api: hostApi(workspaceHost), scope, ...workspace }), [workspaceHost, focusHost, scope, workspace]); // eslint-disable-line react-hooks/exhaustive-deps -- hostApi follows the focus
  useEffect(() => init(), [init]);
  // The right side (components/side): its layout store follows the host / agent / modules.
  useEffect(() => startSideStore((listener) => appModules().subscribe(listener)), []);
  useSideShortcuts(!fullWindow);
  useStaleFocusGuard();
  // First commit: tells main a just-installed update renders (otherwise it rolls back).
  useEffect(() => void bridge.shell?.rendererReady().catch(() => {}), []);
  return (
    <WorkspaceContext.Provider value={selected}>
      <div className="flex h-full">
        {/* A full-window page (设置): its Aside (← 返回 on top) runs the full height in place of the app
            sidebar and the title bar's sidebar / host row. Same tree shape either way, so the title
            bar, banner and overlays are not remounted when such a page opens. */}
        <PageAsideOutlet />
        <div className="flex min-w-0 flex-1 flex-col">
          <TitleBar git={workspace.git} />
          <DaemonBanner />
          {/* The restore notice lives at the top of the sidebar; with it collapsed, a title-bar chip
              (components/RestoreBanner). Never a full-width bar here. */}
          <HostAccessBanner />
          <AgentListDialog />
          <JobOutputDialog />
          <Overlays />
          <SshPromptDialog />
          {/* The window background holds the cards: the main card (conversation / page) and the right
              side (page buttons + cards) in the work area, 8 px apart. */}
          <div className={`relative flex min-h-0 flex-1 pr-2 pb-2 ${sidebarOpen && !fullWindow ? "" : "pl-2"}`}>
            {sidebarOpen && !fullWindow && <Sidebar />}
            <SideWorkArea side={!fullWindow}>
              {/* A page that fails to render shows a notice here; the sidebar stays usable to move on. */}
              <ErrorBoundary resetKey={`${open?.page ?? "conversation"}:${selectedId ?? ""}`}>
                <MainOutlet>
                  <Conversation scope={scope} />
                </MainOutlet>
              </ErrorBoundary>
            </SideWorkArea>
            {/* 在主界面调整: the region panel, placed in this row (not on a full-window page). */}
            {!fullWindow && <CustomizeHost />}
          </div>
        </div>
        <SideInstanceLayer />
        <SideDndLayer />
      </div>
    </WorkspaceContext.Provider>
  );
}
