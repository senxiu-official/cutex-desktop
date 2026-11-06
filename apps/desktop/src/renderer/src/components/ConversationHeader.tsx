import { usesInputLedger } from "../lib/deliveryMode";
import { agentState, featuresOf } from "../store";
import { TurnErrorBanner } from "./TurnErrorSurface";
import { SessionDeliveryStatus } from "./PendingSends";
import { setAppearance, useAppearance } from "../lib/appearance";
import { usePortraitOn } from "../lib/portrait";
// Each conversation keeps its own host/agent header. Line 1 has name, role, online and notifications
// on the left; the right is reserved for pane controls. Line 2 has project · host · cwd · branch,
// then the agent's services at the far right. Services become Globe/count at medium widths and a
// functional overflow menu at narrow widths or with the one-line preference. lib/convHeader.ts
// observes only these layout stages; service/notification data is subscribed once in AgentActions.
import { AgentPauseTag } from "./AgentPauseParts";
import { agentPauseSupported } from "../lib/agentPause";
import { agentPauseItem } from "../lib/menus";
import { Fragment, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppWindow, ArrowLeftToLine, ArrowRightToLine, Bell, BellOff, BellRing, Check, ChevronDown, ChevronLeft, ChevronRight, Columns2, Expand, GitBranch, Loader2, Maximize2, Minimize2, Minus, MoreHorizontal, PanelRight, PanelRightClose, PanelRightOpen, Plus, Shrink, Star, X } from "lucide-react";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { GitStatus, NotificationLevel, WorkspaceScope } from "../../../shared/ipc";
import { INDEPENDENT_PROJECT } from "../../../shared/notificationLevels";
import { useI18n } from "../i18n";
import { openMenuAt, openMenuFrom, runAction, type MenuEntry } from "../lib/contextMenu";
import { useDeskId } from "../lib/deskContext";
import { desksEnabled } from "../lib/deskWindows";
import { moveToDesk, moveToMain } from "../lib/deskActions";
import { replaceColumnEntry } from "../lib/replaceColumn";
import { ARMED_COUNTDOWN, useArmed } from "../lib/armedConfirm";
import { useRuntimeStartSince } from "../lib/runtimeStart";
import { agentMenu, runtimeItem } from "../lib/menus";
import { isQuickChat } from "../lib/sidebar";
import { projectIcon } from "../lib/projectIcons";
import { hostListKeys, toggleStarred, useUiPrefs } from "../lib/prefs";
import { hostKey } from "../lib/hostKeys";
import { services as appServices } from "../modules/app";
import { hostPageParam } from "../lib/targetHost";
import { toggleProjectMuted, useProjectMuted, useProjectMuteSupported } from "../lib/notificationLevelsStore";
import { notifyHidden, notifyLook, notifyMenu, notifyTooltip, type NotifyState } from "../lib/notifyControl";
import { openChanges } from "../lib/sideOpen";
import { scopeFor, scopeKey, shortenHome } from "../lib/workspace";
import { diffTotals, WorkspaceContext } from "../lib/workspaceView";
import { convHeaderInfo, useHeaderLayout, type ConvHeaderFold, type ConvHeaderInfo } from "../lib/convHeader";
import { toggleExclusive, toggleFullscreenPanel, toggleMaximize } from "../lib/paneActions";
import { useGrow } from "../lib/panelGrow";
import { usePanelFull } from "../lib/panelFull";
import { useLongPress } from "../lib/longPress";
import { closePaneWithHint, liveShelfState, movePane, moveTarget, otherShelfState, shelfLauncherMenu, toggleConvShelf, type ConvShelfState } from "../lib/convPaneControls";
import { useSideView } from "../lib/sideComponents";
import { useSide } from "../lib/sideLayoutStore";
import { focusConversationPane, usePanes } from "../lib/paneStore";
import { conversationPanes } from "../lib/paneLayout";
import { canStrip, stripPanes, useStrips } from "../lib/convStrips";
import { useForetell, withHandlers } from "../lib/foretell";
import { closeEffect, maximizeForetell, minimizeEffect, shelfOnlyEffect, stripEffect, type Effect } from "../lib/workspaceEffects";
import { exclusiveForetell, fullscreenForetell, moveForetell } from "../lib/menuForetells";
import { useConvRailPages } from "../lib/workspaceRowView";
import { usePeerSource, usePeerViewContext } from "../lib/shelfSource";
import { convKey } from "../lib/convShelves";
import { sideDragHandle } from "../lib/sideDnd";
import { useHostScope } from "../lib/useHostScope";
import { realAgentName, realNameTip } from "../lib/agentAlias";
import { agentHost, hostApi, sidebarOf, useApp, viewOf } from "../store";
import { Avatar } from "./Avatar";
import type { AvatarPresence } from "../lib/avatarStatus";
import { formatAutoRetryWait } from "../lib/modelOverloadRetry";
import { useModelOverloadRetry } from "../lib/modelOverloadRetryView";
import { HostDot } from "./HostMark";
import { ProjectBadge } from "./ProjectBadge";
import { ScriptText } from "./ScriptText";
import { ArmedHint } from "./ArmedHint";
import { AgentServicesView } from "./ServiceLinks";
import { panelSettingsItem } from "../lib/panelSettings";
import { panelGuideItem, panelGuideTail } from "../lib/panelGuideMenu";
import { useAgentServiceList } from "../lib/serviceLinkView";
import { Tag } from "./Tag";
import { RuntimeTag } from "./RuntimeTag";
import { bindingLabel, keyVar } from "../lib/keybindings";
import { InfoMark } from "./InfoMark";
import { isElement } from "../lib/ownerWindow";

/** Quiet pass: a control in its default state shows on hover / keyboard focus of the header. */
/** Status items that show on hover / focus of the header only (在线 when idle, the bell when plain on). */
const HOVER_ONLY = "opacity-0 transition-opacity group-hover/phead:opacity-100 group-focus-within/phead:opacity-100 focus-visible:opacity-100";
// Owner 2026-10-25: the pane's window controls always show (no hover-only), quieter until the header is hovered / focused.
const ON_DEMAND = "opacity-60 transition-opacity group-hover/phead:opacity-100 group-focus-within/phead:opacity-100 hover:opacity-100 focus-visible:opacity-100";
/** The same for a control that is greyed out (放大 with no gap to grow into). */
const ON_DEMAND_DIM = "opacity-25 transition-opacity group-hover/phead:opacity-40 group-focus-within/phead:opacity-40 focus-visible:opacity-40";

/**
 * Git status of the pane's agent: the shared workspace watch for the selected agent (App), else one read
 * for this agent (a column beside the focused one; it refreshes when the column gets the focus).
 */
function usePaneGit(hostId: string, sessionId: string | null): GitStatus | null {
  const shared = useContext(WorkspaceContext);
  const selectedHere = useApp((s) => !!sessionId && s.selectedId === sessionId && agentHost(s) === hostId);
  const key = useApp((s) => {
    const scope = scopeFor(sidebarOf(s, hostId), sessionId);
    return scope ? scopeKey(scope) : null;
  });
  const [own, setOwn] = useState<GitStatus | null>(null);
  useEffect(() => {
    setOwn(null);
    if (selectedHere || !key) return;
    const at = key.indexOf(":");
    const scope = { kind: key.slice(0, at), id: key.slice(at + 1) } as WorkspaceScope;
    let live = true;
    hostApi(hostId)
      .gitStatus(scope)
      .then(
        (g) => live && setOwn(g),
        () => live && setOwn(null),
      );
    return () => {
      live = false;
    };
  }, [selectedHere, key, hostId]);
  return selectedHere ? shared.git : own;
}

/** The agent's alert level + its group's host mute (lib/notifyControl.ts), for the bell and the ⋯ menu. */
function useNotify(session: SessionResource | null, hostId: string, info: ConvHeaderInfo | null) {
  const { t } = useI18n();
  const threadId = session?.native.threadId ?? null;
  const [agent, setAgent] = useState<NotificationLevel | null>(null);
  // Project mutes: focus host only.
  const own = useApp((s) => hostId === (s.hosts?.active ?? "local"));
  const projectId = info?.project?.id ?? null;
  const groupId = projectId ?? INDEPENDENT_PROJECT;
  const muteSupported = useProjectMuteSupported() && own;
  const muted = useProjectMuted(groupId);
  useEffect(() => {
    let live = true;
    setAgent(null);
    if (threadId)
      hostApi(hostId)
        .notificationLevel(threadId)
        .then(
          (l) => live && setAgent(l),
          () => live && setAgent(null),
        );
    return () => {
      live = false;
    };
  }, [threadId, hostId]);
  const state: NotifyState = { agent: threadId ? agent : null, projectMuted: muteSupported ? muted : null, groupName: projectId ? (info?.project?.name ?? projectId) : null };
  const menu = (): MenuEntry[] =>
    notifyMenu(state, t, {
      setAgent: (level) => threadId && void hostApi(hostId).setNotificationLevel(threadId, level).then(setAgent, () => {}),
      toggleProject: () => toggleProjectMuted(groupId),
      check: <Check size={14} />,
      muteIcon: <BellOff size={14} />,
      unmuteIcon: <Bell size={14} />,
    });
  return { state, menu, hidden: notifyHidden(state) };
}

/** Online / offline; the click starts / stops the runtime (停止 is click-twice, lib/armedConfirm). */
function OnlineState({ session, hostId, info, compact = false }: { session: SessionResource; hostId: string; info: ConvHeaderInfo; compact?: boolean }) {
  const { t } = useI18n();
  const { runtimeButton } = useUiPrefs();
  const ref = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useArmed(`${hostId}:${session.cutexSessionId}:${session.runtime.status}`);
  const starting = useRuntimeStartSince(hostId, session.cutexSessionId) !== null;
  const online = session.runtime.status === "online";
  const label = t(online ? "convHeader.online" : "convHeader.offline");
  const dot = <span className={`size-[7px] shrink-0 rounded-full ${online ? "bg-ok" : "bg-subtle/50"}`} />;
  const row = useApp((s) => sidebarOf(s, hostId)?.hostRows[session.cutexSessionId]);
  const offered = runtimeButton === "all" || (runtimeButton === "independent" && !info.project?.id && !isQuickChat(session, row));
  const item = offered ? runtimeItem(session, t, hostId) : null;
  // Design 040 step 7: online / offline is the avatar's (green dot / grey); only the start / stop button is here.
  if (!item) return null;
  const tip = starting && !online ? t("menu.starting") : t(online ? "titlebar.runtimeOnline" : "titlebar.runtimeOffline");
  const click = () => {
    if (item.armed && !armed) return setArmed(true);
    setArmed(false);
    void runAction(item);
  };
  return (
    <>
      <button
        ref={ref}
        data-side-nodrag
        data-conv-item="online"
        data-online-compact={compact || undefined}
        onClick={click}
        data-tip={armed ? undefined : tip}
        aria-label={armed && item.armed ? item.armed : tip}
        disabled={item.disabled}
        // Online and idle: shows on hover / focus of the header (the avatar's dot says 在线); offline, starting or armed: always.
        className={`flex h-6 shrink-0 items-center gap-1 rounded-ctl ${compact ? "px-0.5" : "px-1.5"} text-meta ${armed ? `${ARMED_COUNTDOWN} bg-danger-solid text-white` : `text-subtle hover:bg-hover ${online ? `hover:text-danger ${starting ? "" : HOVER_ONLY}` : "hover:text-accent"}`}`}
      >
        {starting && !online ? <Loader2 size={11} className="animate-spin text-accent" /> : dot}
        {!compact && label}
      </button>
      {armed && item.armed && <ArmedHint anchor={ref} text={item.armed} />}
    </>
  );
}

/** The project chip (badge + name, a link to the project page) and its star. */
function ProjectChip({ project, hostId }: { project: NonNullable<ConvHeaderInfo["project"]>; hostId: string }) {
  const { t } = useI18n();
  const prefs = useUiPrefs();
  const sidebar = useApp((s) => sidebarOf(s, hostId));
  const projectId = project.id;
  const groupId = projectId ?? INDEPENDENT_PROJECT;
  const name = project.name ?? t("titlebar.independent");
  const presentation = projectId ? sidebar?.projects?.projects.find((p) => p.project_id === projectId)?.presentation : undefined;
  const starred = hostListKeys("starredProjects", [hostId]).includes(hostKey(hostId, groupId));
  return (
    <span data-conv-item="project" className="flex min-w-0 max-w-full shrink-0 items-center gap-0.5 text-meta text-muted">
      {projectId ? (
        // Design 040 step 7: plain secondary text (no outlined chip); the project's badge stays as a small tile.
        <button
          data-side-nodrag
          onClick={() => appServices.ui.openPage("projects.page", { project: projectId, ...hostPageParam(hostId) })}
          data-tip={t("titlebar.openProject", { name })}
          className="flex min-w-0 items-center gap-1 rounded-chip px-0.5 hover:bg-hover hover:text-foreground"
        >
          {presentation && <ProjectBadge icon={projectIcon(prefs.projectIcons, hostId, projectId)} badge={presentation.badge_label || name.slice(0, 1)} color={presentation.color} />}
          <span className="truncate">
            <ScriptText text={name} />
          </span>
        </button>
      ) : (
        // Independent agents: a quiet badge, not a link (no project page).
        <Tag data-tip={t("titlebar.independentTip")} className="mx-0.5">
          {name}
        </Tag>
      )}
      <button
        data-side-nodrag
        data-conv-item="star"
        onClick={() => toggleStarred(groupId, hostId)}
        data-tip={t(projectId ? (starred ? "titlebar.unstar" : "titlebar.star") : starred ? "titlebar.unstarIndependent" : "titlebar.starIndependent")} aria-label={t(projectId ? (starred ? "titlebar.unstar" : "titlebar.star") : starred ? "titlebar.unstarIndependent" : "titlebar.starIndependent")}
        aria-pressed={starred}
        // Unstarred: takes no room until the header is hovered / focused (like the branch's +/−), so line 2 has no gap.
        className={`shrink-0 rounded-chip p-0.5 hover:bg-hover ${starred ? "text-warn" : "hidden text-subtle hover:text-foreground group-hover/phead:inline-flex group-focus-within/phead:inline-flex"}`}
      >
        <Star size={13} className={starred ? "fill-warn" : ""} />
      </button>
    </span>
  );
}

/** The 「·」 between line 2's parts. */
const Sep = () => (
  <span aria-hidden className="shrink-0 text-subtle/70">
    ·
  </span>
);

/**
 * Line 2 (design 040 step 7): one line of secondary text joined by 「·」 — project (+ star) · host · cwd (keeps its
 * tail) · branch (+/− on hover).
 */
function LocationLine({ hostId, sessionId, cwd, note, project, services }: { hostId: string; sessionId: string; cwd: string; note: string | null; project: ReactNode; services?: ReactNode }) {
  const { t } = useI18n();
  const hosts = useHostScope();
  const host = hosts.host(hostId);
  const git = usePaneGit(hostId, sessionId);
  const d = git?.isRepo ? diffTotals(git) : null;
  const parts: ReactNode[] = [];
  if (project) parts.push(project);
  if (host)
    parts.push(
      <span key="host" data-conv-item="host" className="flex max-w-32 shrink-0 items-center gap-1" data-tip={t("titlebar.hostTip", { host: host.label })}>
        <HostDot color={host.color} status={host.indicator.status} size={6} />
        <span className="truncate">{host.label}</span>
      </span>,
    );
  if (cwd)
    parts.push(
      // Long paths keep their tail (rtl ellipsis), like the sidebar's project directory.
      <span key="cwd" data-conv-item="cwd" className="min-w-0 shrink-[10] truncate font-mono" style={{ direction: "rtl", textAlign: "left" }} data-tip={note ? `${cwd}\n${note}` : cwd}>
        <bdi>{shortenHome(cwd)}</bdi>
      </span>,
    );
  if (git?.isRepo)
    parts.push(
      <button key="branch" data-side-nodrag data-conv-item="branch" onClick={() => void openChanges()} data-tip={t("pane.changes")} className="flex min-w-0 shrink-[8] items-center gap-1.5 rounded-chip px-0.5 hover:bg-hover hover:text-foreground">
        <span className="flex min-w-0 items-center gap-0.5">
          <GitBranch size={11} className="shrink-0" />
          <span className="truncate">{git.branch ?? "HEAD"}</span>
        </span>
        {d?.files ? (
          <span className="hidden items-center gap-1.5 group-hover/phead:flex group-focus-within/phead:flex">
            <span className="text-ok-text">+{d.added}</span>
            <span className="text-danger">−{d.deleted}</span>
          </span>
        ) : null}
      </button>,
    );
  return (
    <div data-conv-line="2" className="flex h-4 min-w-0 items-center gap-1.5 px-0.5 text-meta text-subtle">
      <div data-conv-location="" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <Sep />}
          {p}
        </Fragment>
      ))}
      </div>
      {services && <span data-conv-services="" className="ml-auto flex shrink-0 items-center">{services}</span>}
    </div>
  );
}

/**
 * Observes the agent's status and services once, then places them in the shared two-line layout.
 * Folded items retain their existing actions in the pane's overflow menu.
 */
type HeaderActions = { status: ReactNode; services: ReactNode; rows: FoldedRow[] };
function AgentActions({ paneId, session, hostId, info, folded, compactServices, render }: { paneId: string; session: SessionResource | null; hostId: string; info: ConvHeaderInfo | null; folded: readonly ConvHeaderFold[]; compactServices: boolean; render(parts: HeaderActions): ReactNode }) {
  const { t } = useI18n();
  const notify = useNotify(session, hostId, info);
  const svc = useAgentServiceList(paneId, hostId, session?.cutexSessionId ?? "");
  const look = notifyLook(notify.state);
  const BellIcon = look === "off" ? BellOff : look === "important" ? BellRing : Bell;
  const bellTip = notifyTooltip(notify.state, t);
  const projectName = info?.project ? (info?.project.name ?? t("titlebar.independent")) : "";
  useUiPrefs(); // the star follows the prefs
  const starred = info?.project ? hostListKeys("starredProjects", [hostId]).includes(hostKey(hostId, info?.project.id ?? INDEPENDENT_PROJECT)) : false;
  // The ⋯ menu: one row per folded item that has something to show, in fold order.
  const rows: FoldedRow[] = [];
  for (const item of folded) {
    if (item === "network" && svc.mine.length) rows.push({ item, label: t("convHeader.item.network", { n: svc.mine.length }), entries: svc.menu() });
    if (session && item === "mute" && !notify.hidden) rows.push({ item, label: t("convHeader.item.mute"), entries: notify.menu() });
    if (item === "project" && info?.project) {
      const projectId = info?.project.id;
      const groupId = projectId ?? INDEPENDENT_PROJECT;
      rows.push({
        item,
        label: t("convHeader.item.project", { name: projectName }),
        entries: [
          projectId && { label: t("titlebar.openProject", { name: projectName }), onSelect: () => appServices.ui.openPage("projects.page", { project: projectId, ...hostPageParam(hostId) }) },
          {
            label: t(projectId ? (starred ? "titlebar.unstar" : "titlebar.star") : starred ? "titlebar.unstarIndependent" : "titlebar.starIndependent"),
            icon: <Star size={14} className={starred ? "fill-warn text-warn" : ""} />,
            onSelect: () => toggleStarred(groupId, hostId),
          },
        ],
      });
    }
  }
  return render({ rows, status: (
    <>
      {session && info && <LedgerOnlineState session={session} hostId={hostId} info={info} compact={folded.includes("network")} />}
      {session && !folded.includes("mute") && !notify.hidden && (
        <button
          data-side-nodrag
          data-conv-item="mute"
          onClick={(e) => openMenuFrom(e.currentTarget, notify.menu())}
          data-tip={bellTip}
          aria-label={bellTip}
          aria-haspopup="menu"
          className={`${ctrlBtn(look === "important" ? "text-warn" : "text-muted")} ${look === "on" ? HOVER_ONLY : ""}`}
        >
          <BellIcon size={14} />
        </button>
      )}
    </>
  ), services: session && !folded.includes("network") && svc.mine.length > 0 ? <AgentServicesView paneId={paneId} hostId={hostId} sessionId={session?.cutexSessionId ?? ""} agentName={session.displayName} compact={compactServices} services={svc} /> : null });
}

/** A folded header item for the ⋯ menu. */
type FoldedRow = { item: ConvHeaderFold; label: string; entries: MenuEntry[] };

/** One square button of line 1's right side (the bell, the pane's controls): the 24 px ghost icon button (design 040 §2). */
const CTRL_BASE = "relative inline-flex size-6 shrink-0 items-center justify-center rounded-ctl transition-colors hover:bg-hover hover:text-foreground active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40 disabled:hover:bg-transparent";
/** `tone`: the text colour (one class, so it never fights the default). */
const ctrlBtn = (tone = "text-muted") => `${CTRL_BASE} ${tone}`;
const CTRL_BTN = ctrlBtn();

/** This conversation's Shelf as the header's Shelf button sees it (the live one, or another workspace's rail pages). */
function useConvShelfState(focused: boolean, hostId: string, sessionId: string): ConvShelfState {
  const layout = useSide((s) => s.layout);
  const ctx = useSideView();
  const pages = useConvRailPages(hostId, focused ? null : sessionId);
  // The other workspace's Shelf is live too (§24.13): its own state, expanded or folded, as it shows.
  const peer = usePeerSource(focused ? null : convKey(hostId, sessionId));
  const peerCtx = usePeerViewContext(ctx, peer);
  if (focused) return liveShelfState(layout, ctx);
  return peer && peerCtx ? liveShelfState(peer.layout, peerCtx) : otherShelfState(pages.length);
}

/** 关闭 (lib/workspaceEffects closeEffect); a pane whose binding is not known yet still closes as before. */
const closeOf = (paneId: string): Effect => {
  const e = closeEffect(paneId);
  return e.foretell ? e : { foretell: null, run: () => closePaneWithHint(paneId) };
};

/**
 * A control whose hover / keyboard focus foretells what its click does (docs/design/008): both from the SAME
 * effect (lib/workspaceEffects), computed when shown and again on the click.
 */
function EffectButton({ effect, children, extra = "", ...rest }: { effect: () => Effect; children: ReactNode; extra?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children">) {
  const fh = useForetell(() => effect().foretell);
  return (
    <button data-side-nodrag {...rest} {...fh} onClick={() => effect().run()} className={`${CTRL_BTN} ${extra}`}>
      {children}
    </button>
  );
}

/**
 * 「‹ / ›」 收成窄条; right-click = a small menu at the pointer (window audit 2026-10-23: no immediate action) — 只看 Shelf
 * (002 补充 10-22: the conversation folds, its Shelf stays and takes the width), 只看会话 (the Shelf folds to its rail),
 * 恢复 (the other conversation, folded to a strip, comes back); long-press = 只看 Shelf. Each row from its own effect.
 */
function StripButton({ paneId, leftSide, title, hostId, sessionId, shelf, othersStripped }: { paneId: string; leftSide: boolean; title: string; hostId: string; sessionId: string; shelf: ConvShelfState; othersStripped: boolean }) {
  const { t } = useI18n();
  const fh = useForetell(() => stripEffect(paneId).foretell);
  const only = () => shelfOnlyEffect(paneId);
  const hold = useLongPress(() => only().run());
  const menu = (x: number, y: number) => {
    const eff = only();
    const exclusive = exclusiveForetell(paneId, true);
    openMenuAt(x, y, [
      { label: t("shelfOnly.action"), icon: <PanelRightOpen size={14} />, title: t(eff.foretell ? "shelfOnly.hint" : "shelfOnly.noShelf"), disabled: !eff.foretell, foretell: () => eff.foretell, onSelect: () => eff.run() },
      { label: t("shelfOnly.convOnly"), icon: <PanelRight size={14} />, title: t(shelf === "expanded" ? "shelfOnly.convOnlyHint" : "shelfOnly.noShelf"), disabled: shelf !== "expanded", onSelect: () => toggleConvShelf(paneId, hostId, sessionId) },
      { label: t("shelfOnly.restore"), icon: <Columns2 size={14} />, title: t(othersStripped ? "shelfOnly.restoreHint" : "shelfOnly.nothingFolded"), disabled: !othersStripped, foretell: () => (othersStripped ? exclusive : null), onSelect: () => toggleExclusive({ area: "work", id: paneId }) },
    ]);
  };
  return (
    <button
      data-side-nodrag
      data-pane-strip={leftSide ? "left" : "right"}
      data-tip={title}
      aria-label={title}
      {...withHandlers(hold, fh)}
      onClick={() => stripEffect(paneId).run()}
      onContextMenu={(e) => {
        e.preventDefault();
        menu(e.clientX, e.clientY);
      }}
      className={CTRL_BTN}
    >
      {leftSide ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
    </button>
  );
}

/**
 * The pane's controls (owner 2026-10-21, right side variant A): one row on line 1 after the status items —
 * 「Shelf」 「放大」 「关闭」 「⋯」, evenly spaced and the same size (replaced the 2×2 block).
 */
function PaneControls({ paneId, hostId, sessionId, focused, maxed, rows, session }: { paneId: string; hostId: string; sessionId: string; focused: boolean; maxed: boolean; rows: FoldedRow[]; session: SessionResource | null }) {
  const { t } = useI18n();
  const deskId = useDeskId();
  // 收起一个会话 (docs/design/002): 「‹ / ›」 收成窄条 (two workspaces; the chevron points outward), 「—」 最小化
  // (any pane with an agent; the last one = into the tray, back to the desktop), 独占 in ⋯. They never fold into ⋯:
  // two workspaces are usually narrow enough to fold everything, and 「‹」 is 002's main entry (the name truncates).
  const layout = usePanes((s) => s.layout);
  const strips = useStrips((s) => s.strips);
  const panes = conversationPanes(layout);
  const stripOk = canStrip(layout, paneId, strips);
  // 独占 is on (two workspaces): the others are strips.
  const othersStripped = stripPanes(layout, strips).some((id) => id !== paneId);
  const leftSide = panes.indexOf(paneId) === 0;
  const last = panes.length < 2;
  const stripTip = t("strip.collapse");
  const minTip = t(last ? "strip.minimizeLast" : "strip.minimize");
  const maxFh = useForetell(() => full || maxed ? maximizeForetell(paneId, maxed) : null);
  const shelf = useConvShelfState(focused, hostId, sessionId);
  const shelfTip = t(shelf === "empty" ? "convHeader.shelfOpen" : shelf === "expanded" ? "convHeader.shelfHide" : "convHeader.shelfShow");
  // 放大 = 最大化 (rule 2, docs/design/003: every gap of the row; greyed when there is none); held = full screen; in
  // full screen / 独占 = back. 独占 (the former 放大, §24.16) is in ⋯.
  const full = usePanelFull((s) => s.target?.area === "work" && s.target.id === paneId);
  const grown = useGrow((s) => s.target?.kind === "conv" && s.target.paneId === paneId);
  const room = useGrow((s) => s.room.conv[paneId] ?? 0);
  // Portrait (lib/portrait): 最大化保持 is landscape's (the stack fills the window) — ⤢ is not offered there for it; as
  // the way back from a maximised / full-screen column it stays (最大化 there fills the stack: lib/paneActions).
  const portrait = usePortraitOn();
  const fill = useAppearance().fillMode && !portrait;
  const maxShown = !portrait || maxed || full;
  const noGap = !full && !maxed && !grown && room <= 0;
  const maxTip = full ? t("panel.exitFullscreen", { key: "Esc" }) : maxed ? t("panel.exclusiveOff") : noGap ? t("panel.maxNoGap") : grown ? t("pane.restoreMax", keyVar("paneMaximise")) : t("side.maximise");
  // The long-press and right-click gestures of these buttons (design 040 §2.1: how-to text is not in the tips).
  const howTo = [maxShown && !full && !maxed && !noGap ? t("panel.maxLongPress", { tip: t("pane.maximize", keyVar("paneMaximise")), ...keyVar("panelFullscreen") }) : null, stripOk ? `${stripTip}: ${t("shelfOnly.altHint")}` : null].filter(Boolean).join("\n");
  const hold = useLongPress(() => toggleFullscreenPanel({ area: "work", id: paneId }));
  const closeTip = t("convHeader.close");
  const moreTip = rows.length ? t("convHeader.overflow", { items: rows.map((r) => r.label).join(" · ") }) : t("convHeader.more");
  const pressShelf = (anchor: HTMLElement) => {
    if (shelf !== "empty") return toggleConvShelf(paneId, hostId, sessionId);
    // An empty Shelf: 「＋ 打开 Shelf」 = the launchers; the pick opens in this conversation's Shelf.
    openMenuFrom(anchor, shelfLauncherMenu(focused ? null : () => focusConversationPane(paneId)));
  };
  const more = (anchor: HTMLElement) => {
    const to = moveTarget(paneId);
    const entries: MenuEntry[] = [];
    // §24.16 全屏: only this column (sidebar → rail, tray hidden, window bar on hover); F11 / Ctrl+Shift+F; Esc back.
    entries.push({ label: t(full ? "panel.exitFullscreenShort" : "panel.fullscreen"), icon: full ? <Shrink size={14} /> : <Expand size={14} />, hint: bindingLabel("panelFullscreen"), foretell: () => fullscreenForetell(paneId, full), onSelect: () => void toggleFullscreenPanel({ area: "work", id: paneId }) });
    // 独占 (the former 放大): two workspaces = the other folds to its strip (002, lib/paneActions toggleExclusive →
    // lib/convStrips); one = the whole row, the other panels drawn as their rails.
    entries.push({ label: t(maxed || othersStripped ? "panel.exclusiveOff" : "panel.exclusive"), icon: <Columns2 size={14} />, title: t("panel.exclusiveHint"), foretell: () => exclusiveForetell(paneId, maxed), onSelect: () => toggleExclusive({ area: "work", id: paneId }) });
    // 只看 Shelf (002 补充): the menu row's preview and its action share one measured plan.
    const only = shelfOnlyEffect(paneId);
    entries.push({ label: t("shelfOnly.action"), icon: <PanelRightOpen size={14} />, title: t(only.foretell ? "shelfOnly.hint" : "shelfOnly.noShelf"), disabled: !only.foretell, foretell: () => only.foretell, onSelect: () => only.run() });
    entries.push("separator");
    // A column is replaced on purpose only (design 039): a drop on it, or this row.
    entries.push(replaceColumnEntry(paneId, hostId, t));
    if (to) entries.push({ label: t(to === "left" ? "convHeader.moveLeft" : "convHeader.moveRight"), icon: to === "left" ? <ArrowLeftToLine size={14} /> : <ArrowRightToLine size={14} />, foretell: () => moveForetell(paneId, to), onSelect: () => movePane(paneId, to) });
    // Multi-window (P1; only with the 多窗口 setting on, P6): this conversation in a desk window of its own (lib/deskActions).
    if (desksEnabled()) entries.push({ label: t("desk.moveToWindow"), icon: <AppWindow size={14} />, title: t("desk.moveToWindowHint"), onSelect: () => void moveToDesk(paneId) });
    // In a desk (P3): this conversation back to the main window (the desk stays).
    if (deskId && sessionId) entries.push({ label: t("desk.backToMain"), icon: <ArrowLeftToLine size={14} />, onSelect: () => moveToMain(hostId, sessionId) });
    if (rows.length) {
      // What a narrow column folded, under a note (prototype `#a-two-menu`).
      if (to) entries.push("separator");
      entries.push({ label: t("convHeader.foldedNote"), note: true, disabled: true, onSelect: () => {} });
      for (const r of rows) entries.push({ label: r.label, submenu: r.entries, onSelect: () => {} });
    }
    if (session) {
      if (entries.length) entries.push("separator");
      // 暂停智能体 / 继续智能体 (agent-pause) right in ⋯, not only in the agent's submenu.
      if (session.lifecycle !== "retired" && agentPauseSupported(useApp.getState(), hostId)) entries.push(agentPauseItem(hostId, session.cutexSessionId, t));
      entries.push({ label: session.displayName, submenu: agentMenu(session, t, hostId), onSelect: () => {} });
    }
    // Design 006 v1: the last row opens Settings → 会话 (its foretell outlines this conversation).
    if (entries.length) entries.push("separator");
    entries.push(panelSettingsItem("conversation", { panel: `[data-conv-pane="${CSS.escape(paneId)}"], [data-focus-region="main"]` }));
    entries.push("separator", panelGuideItem({ panel: "conversation", paneId, hostId, sessionId: session?.cutexSessionId ?? null }));
    openMenuFrom(anchor, entries);
  };
  return (
    <span data-pane-controls="row" className="flex h-6 shrink-0 items-center gap-0.5">
      {howTo && <InfoMark text={howTo} className="hover-info px-0.5" />}
      {/* Design 040 step 7: 放大 and 关闭 show on hover / keyboard focus of the header (放大 stays while it is on). */}
      {maxShown && <button data-side-nodrag data-pane-max="" data-pane-full={full ? "" : undefined} data-tip={full || maxed ? maxTip : t(fill ? "fillMode.off" : "fillMode.title")} aria-label={full || maxed ? maxTip : t(fill ? "fillMode.off" : "fillMode.title")} aria-pressed={maxed || full || grown || fill} data-pane-grown={grown ? "" : undefined} {...withHandlers(hold, maxFh)} onClick={() => (maxed ? toggleExclusive({ area: "work", id: paneId }) : full ? toggleFullscreenPanel({ area: "work", id: paneId }) : setAppearance({ fillMode: !fill }))} className={`${CTRL_BTN} ${maxed || full || grown || fill ? "" : noGap ? ON_DEMAND_DIM : ON_DEMAND}`}>
        {maxed || full || grown || fill ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>}
      {/* 关闭 (owner 2026-10-21, §24.13): the pane closes, the agent keeps running in cutex; its workspace is remembered. */}
      <EffectButton effect={() => closeOf(paneId)} data-pane-collapse="" data-pane-close-keep="" data-tip={closeTip} aria-label={closeTip} extra={ON_DEMAND}>
        <X size={14} />
      </EffectButton>
      <button
        data-side-nodrag
        data-pane-shelf={shelf}
        data-tip={shelfTip}
        aria-label={shelfTip}
        aria-pressed={shelf === "expanded"}
        aria-haspopup={shelf === "empty" ? "menu" : undefined}
        onClick={(e) => pressShelf(e.currentTarget)}
        className={ctrlBtn(shelf === "expanded" ? "text-foreground" : "text-muted")}
      >
        {/* The Shelf's own toggle icon (a panel; never a page's icon): close it / open it / 打开 Shelf ＋. */}
        {shelf === "expanded" ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
        {shelf === "empty" && (
          <span aria-hidden className="absolute right-0.5 bottom-0.5 flex size-2.5 items-center justify-center rounded-full bg-background text-accent">
            <Plus size={8} strokeWidth={3} />
          </span>
        )}
      </button>
      {stripOk && (
        <StripButton paneId={paneId} leftSide={leftSide} title={stripTip} hostId={hostId} sessionId={sessionId} shelf={shelf} othersStripped={othersStripped} />
      )}
      <EffectButton effect={() => minimizeEffect(paneId)} data-pane-minimize="" data-tip={minTip} aria-label={minTip}>
        <Minus size={14} />
      </EffectButton>
      <button data-side-nodrag data-pane-more="" data-conv-overflow={rows.length ? rows.map((r) => r.item).join(" ") : undefined} data-tip={moreTip} aria-label={moreTip} aria-haspopup="menu" onClick={(e) => more(e.currentTarget)} className={CTRL_BTN}>
        <MoreHorizontal size={14} />
        {/* Something is folded into ⋯ (a narrow column). */}
        {rows.length > 0 && <span aria-hidden data-conv-folded-dot="" className="absolute top-[3px] right-[3px] size-[5px] rounded-full bg-accent" />}
      </button>
    </span>
  );
}

export interface ConversationHeaderProps {
  paneId: string;
  hostId: string;
  sessionId: string | null;
  focused: boolean;
  /** × closes the column (not on the last conversation column). */
  closable: boolean;
  maxed: boolean;
  /** Next to other panes: ⤢ maximise is offered (alone, there is nothing to maximise over). */
  /** Several panes share the column (no longer drawn: the accent under the focused header was dropped 2026-11-01). */
  framed: boolean;
}

/**
 * The two-line header of one conversation column (alone or beside another pane). Memo: the row re-renders the
 * columns on every layout change (a window resize step, a Shelf's width); a header whose props did not change
 * keeps what it drew (perf re-run 2026-10-21 §7.3 N1 / N2). A page over the column has its own header
 * (components/PageHeader, 2026-10-21): no page breadcrumb here.
 */
export const ConversationHeader = memo(ConversationHeaderImpl);

function LedgerOnlineState(props: React.ComponentProps<typeof OnlineState>) {
  const enabled = useApp(s => usesInputLedger([...featuresOf(s, props.hostId)]));
  const delivery = useApp(s => enabled ? agentState(s.inputs, props.hostId, props.session.cutexSessionId)?.delivery ?? null : null);
  return enabled ? <SessionDeliveryStatus delivery={delivery} sessionId={props.session.cutexSessionId} hostId={props.hostId} /> : <OnlineState {...props} />;
}

function ConversationHeaderImpl({ paneId, hostId, sessionId, focused, closable, maxed }: ConversationHeaderProps) {
  const { t } = useI18n();
  const retry = useModelOverloadRetry(sessionId, hostId);
  const ledgerEnabled = useApp(s => usesInputLedger([...featuresOf(s, hostId)]));
  const ledgerDelivery = useApp(s => ledgerEnabled && sessionId ? agentState(s.inputs, hostId, sessionId)?.delivery ?? null : null);
  const { titleTwoLines } = useUiPrefs();
  const info = useApp((s) => convHeaderInfoMemo(sidebarOf(s, hostId), sessionId));
  // Only the connection word it shows (perf §9): the whole view changes on every streamed delta, and the header
  // with its actions and controls re-rendered each time.
  const connectionShown = useApp((s) => {
    const view = sessionId ? viewOf(s, hostId, sessionId) : undefined;
    return view && view.connection !== "live" && !view.loading && view.historySource !== "archived" ? view.connection : null;
  });
  const ref = useRef<HTMLDivElement>(null);
  const headerLayout = useHeaderLayout(ref);
  const folded = useMemo(() => !titleTwoLines && !headerLayout.folded.includes("network") ? ["network" as const, ...headerLayout.folded] : headerLayout.folded, [headerLayout.folded, titleTwoLines]);
  const session = info?.session;
  const name = session?.displayName ?? sessionId ?? t("conversation.empty");
  const menu = (e: { currentTarget: HTMLElement }) => session && openMenuFrom(e.currentTarget, agentMenu(session, t, hostId));
  // The pane's controls after the agent's items (`rows`: what a narrow header folded, for its ⋯). A desk window's
  // columns have the same ones (multi-window P3; 放回主窗口 is in ⋯).
  const controls = (rows: FoldedRow[]) => (!sessionId ? null : <PaneControls paneId={paneId} hostId={hostId} sessionId={sessionId} focused={focused} maxed={maxed} rows={rows} session={session ?? null} />);
  // Design 040 step 7: the project leads line 2 (on line 1 when the header has one line); a narrow column folds it into ⋯.
  const project = info?.project && !folded.includes("project") ? <ProjectChip key="project" project={info.project} hostId={hostId} /> : null;
  const twoLines = !!session && titleTwoLines;
  // Online / offline / running are the avatar's (design 040 §3.1): green dot, grey, the ring.
  const runtime = session?.runtime;
  const presence: AvatarPresence | null = runtime?.status === "online" ? "online" : runtime?.status === "offline" ? "offline" : null;
  const avatarStatus = ledgerEnabled ? { presence: ledgerDelivery?.state === "offline" || ledgerDelivery?.state === "disconnected" ? "offline" as const : ledgerDelivery?.runtimeConnected ? "online" as const : null, running: ledgerDelivery?.state === "turn" } : runtime ? { presence, running: presence === "online" && !!runtime.activeTurnId } : null;
  const renderHeader = ({ status = null, services = null, rows = [] }: Partial<HeaderActions> = {}) => (
    <div
      ref={ref}
      data-pane-header=""
      data-conv-header={paneId}
      {...(sessionId ? sideDragHandle(() => ({ type: "conversation", paneId })) : {})}
      onDoubleClick={(e) => {
        if (isElement(e.target) && e.target.closest("button")) return;
        if (sessionId) toggleMaximize({ area: "work", id: paneId });
      }}
      // Right-click on the header's own space: 「替换这一栏…」 (design 039); its buttons keep their own menus.
      onContextMenu={(e) => {
        if (!sessionId || (isElement(e.target) && e.target.closest("button, a, input, textarea, [data-side-nodrag]"))) return;
        e.preventDefault();
        openMenuAt(e.clientX, e.clientY, [replaceColumnEntry(paneId, hostId, t), ...panelGuideTail({ panel: "conversation", paneId, hostId, sessionId })]);
      }}
      className={`group/phead flex shrink-0 items-center gap-2.5 border-b py-2 pr-2 pl-3 select-none ${sessionId ? "cursor-grab active:cursor-grabbing" : ""} border-border ${focused ? "text-foreground" : "text-muted"}`}
    >
      {session && (
        // 会话头 (design 040 §3.1): 40 px, the biggest avatar in the conversation, with two lines; 28 px with one line so the
        // header stays compact (owner 2026-10-23, 「会话顶栏显示两行」 off).
        <button data-side-nodrag data-conv-avatar="" onClick={menu} className="shrink-0 rounded-full" data-tip={t("menu.more")} aria-label={t("menu.more")}>
          <Avatar name={session.displayName} avatar={session.avatar} seed={session.cutexSessionId} size={twoLines ? 40 : 28} status={avatarStatus} />
        </button>
      )}
      {/* An agent its host's sidebar does not list yet (just created; the store re-reads it, see load): the same slot with
          its seed's default face until the session arrives, so the header never shows no avatar. */}
      {!session && sessionId && (
        <span data-conv-avatar="pending" className="shrink-0 rounded-full">
          <Avatar name={name} seed={sessionId} size={28} />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <div data-conv-line="1" className="flex h-6 min-w-0 items-center gap-1.5">
          <span data-conv-left="" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {session ? (
            <button
              data-side-nodrag
              data-conv-item="name"
              onClick={menu}
              className="flex min-w-0 shrink items-center gap-1 rounded-ctl px-0.5 hover:bg-hover"
              data-tip={realNameTip(session) ? `${session.displayName}\n${t("info.realNameTip", { name: realAgentName(session) })}` : session.displayName}
            >
              <span className="truncate text-title">
                <ScriptText text={session.displayName} />
              </span>
              {realNameTip(session) && !folded.includes("network") && <span className="max-w-48 shrink truncate text-meta text-subtle">{realAgentName(session)}</span>}
              {!folded.includes("network") && <ChevronDown size={14} className="shrink-0 text-subtle" />}
            </button>
          ) : (
            <span className="min-w-0 truncate text-ui">
              <ScriptText text={name} />
            </span>
          )}
          {info?.director && (
            <Tag data-conv-item="role">{t("sidebar.director")}</Tag>
          )}
          {session && <AgentPauseTag hostId={hostId} sessionId={session.cutexSessionId} />}
          {session && <RuntimeTag session={session} />}
          {status}
          {retry && <span className="shrink-0 text-meta text-muted" role="status" data-testid="header-auto-retry-wait">{formatAutoRetryWait(t, retry)}</span>}
          {!twoLines && project}
          {connectionShown && <span className="shrink-0 text-meta text-warn">{connectionShown}</span>}
          </span>
          {/* Only pane controls remain on the right; agent controls are beside the role. */}
          <span data-conv-right="" className="flex h-6 shrink-0 items-center gap-0.5">
            {controls(rows)}
          </span>
        </div>
        {session && twoLines && <LocationLine hostId={hostId} sessionId={session.cutexSessionId} cwd={info!.cwd} note={session.note ?? null} project={project} services={services} />}
      </div>
    </div>
  );
  return (
    <>
      <AgentActions paneId={paneId} session={session ?? null} hostId={hostId} info={info} folded={folded} compactServices={headerLayout.compactServices} render={renderHeader} />
      {/* Turn-error surface (cutex turn-error-surface): the last turn failed — what, 查看, 重新登录 when it repeats. */}
      {session && <TurnErrorBanner session={session} hostId={hostId} />}
    </>
  );
}

// convHeaderInfo builds a new object per call; a store selector must return the same one while its inputs
// are the same (else every store change re-renders the header, and React warns about an unstable snapshot).
let lastInfo: { sidebar: unknown; sessionId: string | null; info: ConvHeaderInfo | null }[] = [];
function convHeaderInfoMemo(sidebar: Parameters<typeof convHeaderInfo>[0], sessionId: string | null): ConvHeaderInfo | null {
  const hit = lastInfo.find((e) => e.sidebar === sidebar && e.sessionId === sessionId);
  if (hit) return hit.info;
  const info = convHeaderInfo(sidebar, sessionId);
  lastInfo = [{ sidebar, sessionId, info }, ...lastInfo].slice(0, 8);
  return info;
}
