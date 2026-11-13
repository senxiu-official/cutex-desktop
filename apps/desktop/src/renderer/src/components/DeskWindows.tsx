import { DebugWindow, DebugErrors, DebugSaved } from "./DebugMode";
// The desk windows' content (multi-window P1 + P3, lib/deskStore): each desk is drawn here, in this window's React
// tree, through a portal into the desk document (lib/deskWindows). React listens for events on a portal's container
// itself, so clicks and keys inside the desk reach the handlers as usual.
//
// P3 (owner 2026-10-27): a desk is the app's own shell for its window — the same sidebar (its own collapse, width,
// scroll, filter), the work row with up to two conversation columns, each with its Shelf + Shelf Rail + tabs, the
// tray, Settings / Home opening here when asked here. Everything below reads the desk's own layout and selection
// (lib/windowScope: the window stores and useApp pick the window from DeskContext). Agent HTML pages stay in the
// main window (lib/deskContext notices; P4); the in-app browser is drawn here too, embedded by the desk (P5).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useDesks, type DeskRecord } from "../lib/deskStore";
import { DeskContext } from "../lib/deskContext";
import { OwnerDocumentContext, useOwnerWindow } from "../lib/ownerContext";
import { matchesCommand } from "../lib/keybindings";
import { toggleSidebarRail } from "../lib/prefs";
import { toggleSettingsFromNav } from "../lib/openSettings";
import { useSelectedHost, useSelectedScope, useWorkspace, WorkspaceContext } from "../lib/workspaceView";
import { hostApi, useApp } from "../store";
import { useOpenPage } from "../modules/react";
import { PageAsideOutlet } from "../modules/Outlet";
import { useI18n } from "../i18n";
import { bridge } from "../bridge";
import { PaneHost } from "./PaneHost";
import { DesktopBackground, TrayFrame } from "./ChipTray";
import { SideInstanceLayer } from "./side/SideInstanceLayer";
import { SettingsShelf } from "./SettingsShelf";
import { useSettingsShelf } from "../lib/settingsShelf";
import { useSettingsShelfMaximized } from "../lib/portrait";
import { useDeskSidebarWidth } from "../lib/windowSidebar";
import { CaptionSpace, LinuxControls } from "./WindowControls";
import { FullscreenHint } from "./PanelFullscreen";
import { ColumnPickLayer } from "./ColumnPickLayer";
import { ShelfToast } from "./side/ShelfToast";
import { DeskPerformanceNotice } from "./DeskPerformanceNotice";

export function DeskWindows() {
  const desks = useDesks((s) => s.desks);
  return <><DeskPerformanceNotice count={desks.length} />{desks.map((desk, i) => createPortal(<DeskFrame desk={desk} n={i + 2} />, desk.handle.root, desk.deskId))}</>;
}

function DeskFrame({ desk, n }: { desk: DeskRecord; n: number }) {
  return (
    <DeskContext.Provider value={desk.deskId}>
      <OwnerDocumentContext.Provider value={desk.handle.root.ownerDocument}><DebugWindow /><DebugErrors /><DebugSaved />{desk.content.kind === "probe" ? <DeskProbe desk={desk} /> : <DeskShell desk={desk} n={n} />}</OwnerDocumentContext.Provider>
    </DeskContext.Provider>
  );
}

/** The desk's title bar: a drag region with the window's name and its controls (Linux / macOS spaces). */
function DeskBar({ desk, n }: { desk: DeskRecord; n: number }) {
  const { t } = useI18n();
  // The window shortcuts the main window's title bar listens for (components/TitleBar), in this window: Ctrl/⌘+B folds
  // this desk's sidebar (lib/windowSidebar), Ctrl/⌘+, opens Settings here.
  const win = useOwnerWindow();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesCommand("sidebar", e)) {
        e.preventDefault();
        toggleSidebarRail();
      } else if (matchesCommand("settings", e)) {
        e.preventDefault();
        toggleSettingsFromNav();
      }
    };
    win.addEventListener("keydown", onKey);
    return () => win.removeEventListener("keydown", onKey);
  }, [win]);
  return (
    <div data-desk-bar="" className="flex h-10 shrink-0 items-stretch bg-transparent select-none [app-region:drag]">
      {bridge.window?.nativeControls === "left" && <div className="w-[76px] shrink-0" />}
      <div className="flex min-w-0 flex-1 items-center px-3 text-sm text-muted">{t("desk.title", { n })}</div>
      <LinuxControls deskId={desk.deskId} />
      <CaptionSpace />
    </div>
  );
}

/** The app's shell in a desk window (P3): as App draws it for the main window, with this window's own state. */
function DeskShell({ desk, n }: { desk: DeskRecord; n: number }) {
  const open = useOpenPage();
  const fullWindow = !!open?.entry?.item.Aside;
  // Settings opened here (lib/settingsShelf `win`): maximised, it covers this window's row.
  const settingsMax = useSettingsShelfMaximized();
  const covered = useSettingsShelf((s) => s.open && s.win === desk.deskId) && settingsMax;
  // Its own sidebar width (lib/windowSidebar; none set: the main window's).
  const sidebarWidth = useDeskSidebarWidth();
  // This window's selected agent's workspace (file links, git), as App does for the main window.
  const scope = useSelectedScope();
  const workspaceHost = useSelectedHost();
  const workspace = useWorkspace(scope, workspaceHost);
  const focusHost = useApp((s) => s.hosts?.active);
  const selected = useMemo(() => ({ hostId: workspaceHost, api: hostApi(workspaceHost), scope, ...workspace }), [workspaceHost, focusHost, scope, workspace]); // eslint-disable-line react-hooks/exhaustive-deps -- hostApi follows the focus
  return (
    <WorkspaceContext.Provider value={selected}>
      <div data-desk={desk.deskId} className="relative isolate flex h-full" style={sidebarWidth ? ({ "--sidebar-w": `${sidebarWidth}px` } as CSSProperties) : undefined}>
        <DesktopBackground />
        <PageAsideOutlet />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <DeskBar desk={desk} n={n} />
          {/* P3.5: this window's own full-screen hint (lib/panelFull is per window). */}
          <FullscreenHint />
          <TrayFrame hidden={covered}>
            <div className="relative flex min-h-0 min-w-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={covered || undefined} aria-hidden={covered || undefined}>
                <PaneHost fullWindow={fullWindow} scope={scope} />
              </div>
              <SettingsShelf />
            </div>
          </TrayFrame>
        </div>
        <SideInstanceLayer />
        {/* P3.5: what was started in this window draws here (its own columns; the toast of its Shelves). The drag
            layers, foretell and the width tip follow the drag's / control's document instead (App mounts them once). */}
        <ColumnPickLayer />
        <ShelfToast />
      </div>
    </WorkspaceContext.Provider>
  );
}

/** P0: what a desk must do — the app's styles, the theme, timers / frames while the main window is hidden, typing. */
function DeskProbe({ desk }: { desk: DeskRecord }) {
  const [text, setText] = useState("");
  const counts = useRef({ mainRaf: 0, deskRaf: 0, timer: 0 });
  const [, tick] = useState(0);
  useEffect(() => {
    let stop = false;
    const loop = (raf: (cb: FrameRequestCallback) => number, key: "mainRaf" | "deskRaf") => {
      const step = () => {
        if (stop) return;
        counts.current[key]++;
        raf(step);
      };
      raf(step);
    };
    loop((cb) => window.requestAnimationFrame(cb), "mainRaf");
    loop((cb) => desk.handle.win.requestAnimationFrame(cb), "deskRaf");
    const timer = window.setInterval(() => {
      counts.current.timer++;
      tick((n) => n + 1);
    }, 100);
    (window as unknown as { __deskProbe?: unknown }).__deskProbe = counts.current;
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [desk]);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div data-probe-card="" className="shell-card rounded-lg border border-border p-4">
        <div className="text-lg font-semibold">Desk probe {desk.deskId}</div>
        <div data-probe-counts="" className="font-mono text-xs text-muted">
          mainRaf {counts.current.mainRaf} · deskRaf {counts.current.deskRaf} · timer {counts.current.timer}
        </div>
      </div>
      <input data-probe-input="" value={text} onChange={(e) => setText(e.target.value)} className="rounded border border-border bg-transparent px-2 py-1" placeholder="type here" />
      <div data-probe-echo="">{text}</div>
    </div>
  );
}
