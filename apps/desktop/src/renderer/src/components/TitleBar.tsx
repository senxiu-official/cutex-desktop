// App top bar (DESIGN §4.13): replaces the native title bar and the old conversation header, as in
// ZCode / Claude / ChatGPT — one row. Left: sidebar toggle + host switcher (components/HostSwitcher.tsx).
// Middle: current agent (title menu), note, git chip. Right: the right side's launcher bar — pinned
// side-component launchers, ＋, the side toggle (components/side/TitleBarLaunchers) — + window controls.
// Windows keeps native caption buttons (titleBarOverlay, recolored to the theme); macOS keeps the
// traffic lights; Linux gets drawn buttons.
import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, BellRing, Check, ChevronDown, Globe, PanelLeft, PanelLeftClose, Power, Star, X } from "lucide-react";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { GitStatus, NotificationLevel } from "../../../shared/ipc";
import { api, bridge } from "../bridge";
import { useI18n } from "../i18n";
import { openMenuFrom, runAction } from "../lib/contextMenu";
import { useArmed } from "../lib/armedConfirm";
import { ArmedHint } from "./ArmedHint";
import { agentMenu, runtimeItem } from "../lib/menus";
import { openService } from "../lib/services";
import { isQuickChat } from "../lib/sidebar";
import { projectIcon } from "../lib/projectIcons";
import { getUiPrefs, hostListKeys, setUiPref, toggleStarred, useUiPrefs } from "../lib/prefs";
import { hostKey } from "../lib/hostKeys";
import { services } from "../modules/app";
import { hostPageParam } from "../lib/targetHost";
import { toggleProjectMuted, useProjectMuted, useProjectMuteSupported } from "../lib/notificationLevelsStore";
import { INDEPENDENT_PROJECT } from "../../../shared/notificationLevels";
import { notifyHidden, notifyLook, notifyMenu, notifyTooltip, type NotifyState } from "../lib/notifyControl";
import { sidebarMark } from "../lib/hostScope";
import { openChanges } from "../lib/sideOpen";
import { shortenHome } from "../lib/workspace";
import { diffTotals } from "../lib/workspaceView";
import { useOpenPage } from "../modules/react";
import { agentHost, selectedSidebar, sessionApi, useApp } from "../store";
import { PageTitle } from "./PageTitle";
import { ProjectBadge } from "./ProjectBadge";
import { CaptionSpace, LinuxControls } from "./WindowControls";
import { TitleBarLaunchers } from "./side/TitleBarLaunchers";
import { Avatar } from "./Avatar";
import cutexLogo from "../assets/cutex-logo-64.png";
import { ScriptText } from "./ScriptText";
import { HostSwitcher } from "./HostSwitcher";
import { RestoreChip } from "./RestoreBanner";
import { HostDot } from "./HostMark";
import { useHostScope } from "../lib/useHostScope";
import { openSettingsFromNav } from "../lib/openSettings";
import { realAgentName, realNameTip } from "../lib/agentAlias";

const win = bridge.window;
const NO_DRAG = "[app-region:no-drag]";
const ICON_BTN = `${NO_DRAG} rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-foreground`;

/** Keep the native Windows caption buttons in the app's colors (theme can change at runtime). */
function useChromeColors() {
  useEffect(() => {
    if (!win || win.nativeControls !== "right") return;
    const sync = () => {
      const css = getComputedStyle(document.documentElement);
      const color = css.getPropertyValue("--win").trim();
      const symbolColor = css.getPropertyValue("--fg").trim();
      if (color && symbolColor) void win.setChrome({ color, symbolColor });
    };
    sync();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", sync);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      media.removeEventListener("change", sync);
      observer.disconnect();
    };
  }, []);
}

/**
 * One notification control for the open agent (lib/notifyControl.ts): the icon reflects the agent's
 * alert level and its group's host mute together; the click menu sets either, with labels.
 */
/**
 * Quiet pass: a title control in its default state (not starred, notifications as usual) shows on
 * hover / keyboard focus of the title; a non-default state (★, muted, important) always shows.
 */
const ON_DEMAND = "opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-within/title:opacity-100 focus-visible:opacity-100";

function NotifyControl({ session }: { session: SessionResource }) {
  const { t } = useI18n();
  const threadId = session.native.threadId ?? null;
  const [agent, setAgent] = useState<NotificationLevel | null>(null);
  // The open agent's host (multi-host: it may not be the focus host). Project mutes: focus host only.
  const daemon = sessionApi(session.cutexSessionId);
  const own = useApp((s) => agentHost(s) === (s.hosts?.active ?? "local"));
  const sidebar = useApp(selectedSidebar);
  const host = sidebar?.hostRows[session.cutexSessionId];
  const projectId = host?.projectId ?? null;
  const groupId = projectId ?? INDEPENDENT_PROJECT;
  const project = projectId ? sidebar?.projects?.projects.find((p) => p.project_id === projectId) : undefined;
  const muteSupported = useProjectMuteSupported() && own;
  const muted = useProjectMuted(groupId);
  useEffect(() => {
    let live = true;
    setAgent(null);
    if (threadId) daemon.notificationLevel(threadId).then((l) => live && setAgent(l), () => live && setAgent(null));
    return () => {
      live = false;
    };
  }, [threadId, daemon]);
  const state: NotifyState = {
    agent: threadId ? agent : null,
    projectMuted: muteSupported ? muted : null,
    groupName: projectId ? project?.presentation.display_name || host?.projectName || projectId : null,
  };
  if (notifyHidden(state)) return null;
  const look = notifyLook(state);
  const Icon = look === "off" ? BellOff : look === "important" ? BellRing : Bell;
  const tip = notifyTooltip(state, t);
  return (
    <button
      onClick={(e) =>
        openMenuFrom(
          e.currentTarget,
          notifyMenu(state, t, {
            setAgent: (level) => threadId && void daemon.setNotificationLevel(threadId, level).then(setAgent, () => {}),
            toggleProject: () => toggleProjectMuted(groupId),
            check: <Check size={14} />,
            muteIcon: <BellOff size={14} />,
            unmuteIcon: <Bell size={14} />,
          }),
        )
      }
      title={tip}
      aria-label={tip}
      aria-haspopup="menu"
      className={`${NO_DRAG} shrink-0 rounded-md p-1 hover:bg-surface-2 ${look === "important" ? "text-warn" : look === "on" ? `text-muted hover:text-foreground ${ON_DEMAND}` : "text-subtle hover:text-foreground"}`}
    >
      <Icon size={14} />
    </button>
  );
}

/** Web services this agent registered: a quiet chip, click lists them, picking one opens it. */
function AgentServices({ cutexSessionId }: { cutexSessionId: string }) {
  const { t } = useI18n();
  // The open agent's host's services registry.
  const hostId = useApp(agentHost);
  const all = useApp((s) => (agentHost(s) === (s.hosts?.active ?? "local") ? s.services : (s.byHost[agentHost(s)]?.services ?? null)));
  const mine = (all ?? []).filter((s) => s.ownerCutexSessionId === cutexSessionId);
  if (mine.length === 0) return null;
  const up = mine.filter((s) => s.health === "reachable").length;
  return (
    <button
      onClick={(e) =>
        openMenuFrom(
          e.currentTarget,
          mine.map((s) => ({ label: `${s.health === "reachable" ? "●" : "○"} ${s.displayName || s.slug}  :${s.port}`, onSelect: () => void openService(s, hostId).catch(() => undefined) })),
        )
      }
      title={t("services.ofAgent", { n: mine.length })}
      className={`${NO_DRAG} flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted hover:bg-surface-2`}
    >
      <Globe size={13} className={up ? "text-ok" : "text-subtle"} />
      {mine.length}
    </button>
  );
}

/** 启动 / 停止运行时 beside the name: the agent menu's runtime item as one icon; 停止 is click-twice (lib/armedConfirm). */
function RuntimeButton({ session }: { session: SessionResource }) {
  const { t } = useI18n();
  const { runtimeButton } = useUiPrefs();
  const host = useApp((s) => selectedSidebar(s)?.hostRows[session.cutexSessionId]);
  const ref = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useArmed(`${session.cutexSessionId}:${session.runtime.status}`);
  if (runtimeButton === "off" || (runtimeButton === "independent" && (host?.projectId || isQuickChat(session, host)))) return null;
  const item = runtimeItem(session, t);
  if (!item) return null;
  const online = session.runtime.status === "online";
  const tip = t(online ? "titlebar.runtimeOnline" : "titlebar.runtimeOffline");
  const click = () => {
    if (item.armed && !armed) return setArmed(true);
    setArmed(false);
    void runAction(item);
  };
  return (
    <>
      <button
        ref={ref}
        onClick={click}
        title={armed ? undefined : tip}
        aria-label={armed && item.armed ? item.armed : tip}
        className={`${NO_DRAG} shrink-0 rounded-md p-1 ${armed ? "bg-danger text-white" : `hover:bg-surface-2 ${online ? "text-ok hover:text-danger" : "text-subtle hover:text-accent"}`}`}
      >
        <Power size={14} />
      </button>
      {armed && item.armed && <ArmedHint anchor={ref} text={item.armed} />}
    </>
  );
}

/**
 * The open agent's host, same rule as the sidebar (lib/hostScope sidebarMark): only when hosts are
 * marked, and the local host only with 「本机也显示主机标记」. Sits after the name / in the subtitle.
 */
function TitleHostMark({ className = "", sep = false }: { className?: string; sep?: boolean }) {
  const { t } = useI18n();
  const scope = useHostScope();
  const { hostMarkLocal } = useUiPrefs();
  const host = useApp(agentHost);
  const look = sidebarMark({ marks: scope.showHostMarks, localMarks: hostMarkLocal, look: (id) => scope.host(id ?? scope.focus) }, host);
  if (!look) return null;
  return (
    <span className={`inline-flex min-w-0 shrink items-center gap-1 ${className}`} title={t("titlebar.hostTip", { host: look.label })}>
      <HostDot color={look.color} status={look.indicator.status} size={6} />
      <span className="truncate">{look.label}</span>
      {sep && <span className="font-normal text-subtle">·</span>}
    </span>
  );
}

function AgentTitle({ git }: { git: GitStatus | null }) {
  const { t } = useI18n();
  const selectedId = useApp((s) => s.selectedId);
  const sidebar = useApp(selectedSidebar);
  const connection = useApp((s) => (s.selectedId ? s.sessions[s.selectedId] : undefined));
  const { titleTwoLines } = useUiPrefs();
  const session = [...(sidebar?.active ?? []), ...(sidebar?.retired ?? [])].find((s) => s.cutexSessionId === selectedId);
  if (!selectedId || !session) return null;
  const d = git?.isRepo ? diffTotals(git) : null;
  if (titleTwoLines) return <AgentTitleTwoLines session={session} git={git} />;
  return (
    <div className="group/title flex min-w-0 items-center gap-2">
      <button
        onClick={(e) => openMenuFrom(e.currentTarget, agentMenu(session, t, agentHost(useApp.getState())))}
        className={`${NO_DRAG} flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-surface-2`}
        title={realNameTip(session) ? `${t("info.realNameTip", { name: realAgentName(session) })}\n${t("menu.more")}` : t("menu.more")}
      >
        <Avatar name={session.displayName} avatar={session.avatar} seed={session.cutexSessionId} size={20} />
        <span className="truncate text-sm font-semibold"><ScriptText text={session.displayName} /></span>
        {realNameTip(session) && <span className="hidden max-w-40 shrink truncate text-xs font-normal text-subtle lg:inline">{realAgentName(session)}</span>}
        <ChevronDown size={13} className="shrink-0 text-subtle" />
      </button>
      <TitleHostMark className="max-w-28 rounded bg-surface-2/60 px-1.5 py-px text-[11px] text-subtle" />
      <RuntimeButton session={session} />
      <NotifyControl session={session} />
      <AgentServices cutexSessionId={session.cutexSessionId} />
      <span className="hidden min-w-0 truncate text-xs text-subtle md:inline" title={session.cwd ?? undefined}>
        {session.note || session.cwd || ""}
      </span>
      {git?.isRepo && (
        <button onClick={() => void openChanges()} title={t("pane.changes")} className={`${NO_DRAG} flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs text-muted hover:bg-surface-2`}>
          <span>⎇ {git.branch ?? "HEAD"}</span>
          {d?.files ? (
            <span className="hidden items-center gap-1.5 group-hover/title:flex group-focus-within/title:flex">
              <span className="text-ok-text">+{d.added}</span>
              <span className="text-danger">−{d.deleted}</span>
            </span>
          ) : null}
        </button>
      )}
      {connection && connection.connection !== "live" && !connection.loading && connection.historySource !== "archived" && <span className="shrink-0 text-xs text-warn">{connection.connection}</span>}
    </div>
  );
}

/** Project chip on the title bar: badge + name, star toggle (the project mute is in NotifyControl). */
function ProjectChip({ session }: { session: SessionResource }) {
  const { t } = useI18n();
  const sidebar = useApp(selectedSidebar);
  // The open agent's host: its project page and star (per-host prefs).
  const hostId = useApp(agentHost);
  const prefs = useUiPrefs();
  const host = sidebar?.hostRows[session.cutexSessionId];
  if (isQuickChat(session, host) && !host?.projectId) return null;
  const projectId = host?.projectId ?? null;
  const project = projectId ? sidebar?.projects?.projects.find((p) => p.project_id === projectId) : undefined;
  const groupId = projectId ?? INDEPENDENT_PROJECT;
  const name = project?.presentation.display_name || host?.projectName || projectId || t("titlebar.independent");
  const starred = hostListKeys("starredProjects", [hostId]).includes(hostKey(hostId, groupId));
  return (
    <span className="flex min-w-0 shrink-[3] items-center gap-0.5 text-xs text-muted">
      {projectId ? (
        <button
          onClick={() => services.ui.openPage("projects.page", { project: projectId, ...hostPageParam(hostId) })}
          title={t("titlebar.openProject", { name })}
          className={`${NO_DRAG} flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-2 hover:text-foreground`}
        >
        {project && <ProjectBadge icon={projectIcon(prefs.projectIcons, hostId, projectId)} badge={project.presentation.badge_label || name.slice(0, 1)} color={project.presentation.color} />}
        <span className="truncate"><ScriptText text={name} /></span>
        </button>
      ) : (
        // Independent agents: a quiet badge, not a link (no project page).
        <span title={t("titlebar.independentTip")} className={`${NO_DRAG} mx-0.5 shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-subtle`}>
          {name}
        </span>
      )}
      <button onClick={() => toggleStarred(groupId, hostId)} title={t(projectId ? (starred ? "titlebar.unstar" : "titlebar.star") : starred ? "titlebar.unstarIndependent" : "titlebar.starIndependent")} aria-pressed={starred} className={`${NO_DRAG} shrink-0 rounded p-0.5 hover:bg-surface-2 ${starred ? "text-warn" : `text-subtle hover:text-foreground ${ON_DEMAND}`}`}>
        <Star size={13} className={starred ? "fill-warn" : ""} />
      </button>
    </span>
  );
}

/**
 * Two-line agent title (Settings 「顶栏两行」): line 1 = avatar, full name, Director pill, project
 * chip (star), runtime / notifications / services; line 2 = host (remote only) · cwd (keeps its
 * tail) · branch · +/−.
 */
function AgentTitleTwoLines({ session, git }: { session: SessionResource; git: GitStatus | null }) {
  const { t } = useI18n();
  const connection = useApp((s) => s.sessions[session.cutexSessionId]);
  const director = useApp((s) => !!selectedSidebar(s)?.projects?.projects.some((p) => p.director_cutex_session_id === session.cutexSessionId));
  const d = git?.isRepo ? diffTotals(git) : null;
  const cwd = session.cwd ?? "";
  return (
    <div className="group/title flex min-w-0 flex-1 items-center gap-2">
      <button onClick={(e) => openMenuFrom(e.currentTarget, agentMenu(session, t, agentHost(useApp.getState())))} className={`${NO_DRAG} shrink-0 rounded-full`} title={t("menu.more")}>
        <Avatar name={session.displayName} avatar={session.avatar} seed={session.cutexSessionId} size={26} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            onClick={(e) => openMenuFrom(e.currentTarget, agentMenu(session, t, agentHost(useApp.getState())))}
            className={`${NO_DRAG} flex min-w-0 shrink items-center gap-1 rounded px-0.5 hover:bg-surface-2`}
            title={realNameTip(session) ? `${session.displayName}\n${t("info.realNameTip", { name: realAgentName(session) })}` : session.displayName}
          >
            <span className="truncate text-sm font-semibold"><ScriptText text={session.displayName} /></span>
            {realNameTip(session) && <span className="max-w-48 shrink truncate text-[11px] font-normal text-subtle">{realAgentName(session)}</span>}
            <ChevronDown size={12} className="shrink-0 text-subtle" />
          </button>
          {director && <span className="shrink-0 rounded bg-surface-2 px-1 text-[9px] font-semibold text-muted">{t("sidebar.director")}</span>}
          <ProjectChip session={session} />
          <RuntimeButton session={session} />
          <NotifyControl session={session} />
          <AgentServices cutexSessionId={session.cutexSessionId} />
          {connection && connection.connection !== "live" && !connection.loading && connection.historySource !== "archived" && <span className="shrink-0 text-xs text-warn">{connection.connection}</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 px-0.5 text-[10.5px] text-subtle">
          <TitleHostMark className="max-w-32 shrink-0 font-medium text-muted" sep={!!cwd} />
          {cwd && (
            // Long paths keep their tail (rtl ellipsis), like the sidebar's project directory.
            <span className="min-w-0 truncate font-mono" style={{ direction: "rtl", textAlign: "left" }} title={session.note ? `${cwd}\n${session.note}` : cwd}>
              <bdi>{shortenHome(cwd)}</bdi>
            </span>
          )}
          {git?.isRepo && (
            <button onClick={() => void openChanges()} title={t("pane.changes")} className={`${NO_DRAG} flex shrink-0 items-center gap-1.5 rounded px-1 hover:bg-surface-2 hover:text-foreground`}>
              {cwd && <span className="-ml-1 pr-0.5">·</span>}
              <span>⎇ {git.branch ?? "HEAD"}</span>
              {d?.files ? (
                // Metadata on demand (quiet pass): +/− on hover / keyboard focus of the title.
                <span className="hidden items-center gap-1.5 group-hover/title:flex group-focus-within/title:flex">
                  <span className="text-ok-text">+{d.added}</span>
                  <span className="text-danger">−{d.deleted}</span>
                </span>
              ) : null}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TitleBar({ git }: { git: GitStatus | null }) {
  const { t } = useI18n();
  const { sidebarOpen } = useUiPrefs();
  const inConversation = useApp((s) => s.view.kind === "conversation");
  // A full-window page (设置) brings its own nav (Aside): no sidebar toggle / host row; a close button.
  const fullWindow = !!useOpenPage()?.entry?.item.Aside;
  const closePage = useApp((s) => s.closePage);
  useChromeColors();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setUiPref("sidebarOpen", !getUiPrefs().sidebarOpen);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === ",") {
        // Settings (also the identity menu's first item and the sidebar footer ⚙).
        e.preventDefault();
        openSettingsFromNav();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      className="flex h-10 shrink-0 items-stretch bg-transparent select-none [app-region:drag]"
      onDoubleClick={(e) => win?.nativeControls === null && e.target === e.currentTarget && void win.control("toggleMaximize")}
    >
      {!fullWindow && (
        <div className={`flex min-w-0 shrink-0 items-center gap-1 px-2 ${sidebarOpen ? "w-[var(--sidebar-w,16rem)] max-w-[calc(100%-360px)] min-w-[180px]" : ""} ${win?.nativeControls === "left" ? "pl-[76px]" : ""}`}>
          {/* The logo is the sidebar toggle; hover / keyboard focus shows the panel icon instead. */}
          <button
            onClick={() => setUiPref("sidebarOpen", !sidebarOpen)}
            title={`${t(sidebarOpen ? "titlebar.hideSidebar" : "titlebar.showSidebar")} (Ctrl+B)`}
            aria-label={t(sidebarOpen ? "titlebar.hideSidebar" : "titlebar.showSidebar")}
            aria-expanded={sidebarOpen}
            className={`${ICON_BTN} group/logo relative shrink-0`}
          >
            <img src={cutexLogo} alt="" draggable={false} className="h-4 w-4 group-hover/logo:invisible group-focus-visible/logo:invisible" />
            <span className="invisible absolute inset-0 flex items-center justify-center group-hover/logo:visible group-focus-visible/logo:visible">
              {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
            </span>
          </button>
          <HostSwitcher />
          {/* The sidebar's restore notice, as a chip while the sidebar is collapsed (UI review #11). */}
          {!sidebarOpen && <RestoreChip />}
        </div>
      )}
      <div data-titlebar-title className="flex min-w-0 flex-1 items-center gap-2 px-3">
        {inConversation ? <AgentTitle git={git} /> : <PageTitle />}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 pr-2">
        {!fullWindow && <TitleBarLaunchers />}
        {fullWindow && (
          <button onClick={closePage} title={t("settings.close")} className={ICON_BTN}>
            <X size={16} />
          </button>
        )}
        <LinuxControls />
      </div>
      {/* Space under the native Windows caption buttons (3 × 46px). */}
      <CaptionSpace />
    </header>
  );
}
