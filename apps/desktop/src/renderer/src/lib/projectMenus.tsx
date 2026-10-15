// The sidebar project menu (project header, collapsed project row; DESIGN §4.12). Every item acts
// on the project's own host (multi-host P1) through paths the app already has: the 项目 page tabs,
// the new-agent page, the agent list's runtime mutation, turn marks (lib/turnUnread), sidebar prefs.
import {
  ArrowRightLeft,
  Bell,
  BellOff,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCopy,
  Copy,
  Crown,
  FolderKanban,
  Hash,
  MailCheck,
  Pencil,
  Plus,
  Power,
  Square,
  SquareCheck,
  Star,
  StarOff,
  StickyNote,
  Type,
  Users,
  UserX,
  UserPlus,
} from "lucide-react";
import type { MessageKey } from "../i18n";
import { featuresOf, hostApi, sidebarOf, useApp } from "../store";
import { promptDialog, type MenuEntry } from "./contextMenu";
import { getUiPrefs, hostListKeys, setProjectRemark, toggleIdleUnfolded, toggleStarred } from "./prefs";
import { REMARK_MAX } from "./projectRemarks";
import { hostKey } from "./hostKeys";
import { projectMuted, projectMuteSupported, toggleProjectMuted } from "./notificationLevelsStore";
import type { AgentRow, SidebarGroup } from "./sidebar";
import { openAgentList } from "./agentListDialog";
import { moveToSectionEntry } from "./sectionMenus";
import { markSeenOn, turnMarksOn } from "./turnUnread";
import { runLimited, START_CONCURRENCY } from "./agentList";
import { captureHostAction } from "./hostSwitch";
import { OWNER_ROTATION_FEATURE } from "../../../shared/directorRotation";
import { OPTIONAL_DIRECTOR_FEATURE } from "./projectCreate";
import { rotationRunningOn } from "./rotationProbe";
import { projectTabsNow } from "./projectTabsView";
import { isOwnerFeatures } from "../../../shared/users";

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
const ICON = 14;

const copyText = (text: string) => void navigator.clipboard.writeText(text);

/** Online agents with nothing running (not the Director): what 停止空闲 stops. */
export function idleStoppable(group: Pick<SidebarGroup, "online">): AgentRow[] {
  return group.online.filter((r) => r.status === "idle" && !r.isDirector && !r.session.runtime.activeTurnId && r.session.runtime.status === "online");
}

/** The group's agents that carry a done / failed turn mark on `host` (全部标为已读). */
export function markedRows(group: Pick<SidebarGroup, "online" | "offline">, host: string): AgentRow[] {
  const marks = turnMarksOn(host);
  return [...group.online, ...group.offline].filter((r) => r.id in marks);
}

/** Opens the 项目 page of `projectId` on `host` (the focus host needs no param). */
function openProjectPage(projectId: string, host: string, params: Record<string, string> = {}): void {
  const app = useApp.getState();
  const focus = app.hosts?.active ?? "local";
  app.openPage("projects.page", { project: projectId, ...params, ...(host === focus ? {} : { host }) });
}

async function stopIdle(rows: AgentRow[], name: string, host: string, t: T): Promise<void> {
  const current = captureHostAction(host === (useApp.getState().hosts?.active ?? "local") ? undefined : host);
  const app = useApp.getState();
  const failed: string[] = [];
  await runLimited(rows, START_CONCURRENCY, async (row) => {
    if (!current()) return;
    try {
      // Same mutation as the agent menu's 停止运行时 / the agent list's bulk 停止.
      await app.sessionAction(row.id, "cutex/runtime/offline", { expectedRuntimeGeneration: row.session.runtime.runtimeGeneration }, host);
    } catch (e) {
      failed.push(`${row.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  if (current() && failed.length) app.notify(t("menu.stopIdleFailed", { project: name, count: failed.length, error: failed.join("; ") }));
}

async function renameProject(projectId: string, host: string, t: T): Promise<void> {
  const current = captureHostAction(host === (useApp.getState().hosts?.active ?? "local") ? undefined : host);
  const app = useApp.getState();
  const summary = sidebarOf(app, host)?.projects?.projects.find((p) => p.project_id === projectId);
  if (!summary) return;
  const next = (await promptDialog(t("menu.renameProject"), summary.presentation.display_name))?.trim();
  if (!next || next === summary.presentation.display_name || !current()) return;
  // The 项目 page's 基本信息 save (same expected revision, badge and colour kept).
  await hostApi(host).projectPresentation(
    projectId,
    { authorityEpoch: summary.authority_epoch, presentationRevision: summary.presentation.revision ?? 0 },
    { display_name: next, badge_label: summary.presentation.badge_label, color: summary.presentation.color },
  );
  if (current()) await app.refreshHostSidebar(host);
}

/** 本机备注…: edit the device-local note of `projectId` on `host` (prefilled; empty clears it). */
export async function editProjectRemark(projectId: string, host: string, name: string, t: T): Promise<void> {
  const initial = getUiPrefs().projectRemarks[hostKey(host, projectId)] ?? "";
  const next = await promptDialog(t("remark.dialogTitle", { name }), initial, { placeholder: t("remark.placeholder"), maxLength: REMARK_MAX, hint: t("remark.hint", { max: REMARK_MAX }) });
  if (next !== null) setProjectRemark(host, projectId, next);
}

/** 清除主管: the 项目 page's clear_director, against the project's host with its current revision. */
export async function clearProjectDirector(projectId: string, host: string, t: T): Promise<void> {
  const current = captureHostAction(host === (useApp.getState().hosts?.active ?? "local") ? undefined : host);
  const app = useApp.getState();
  const summary = sidebarOf(app, host)?.projects?.projects.find((p) => p.project_id === projectId);
  if (!summary?.director_cutex_session_id) return;
  try {
    await hostApi(host).projectMutation(projectId, { authorityEpoch: summary.authority_epoch, projectRevision: summary.project_revision ?? 0 }, { kind: "clear_director" });
  } catch (e) {
    if (current()) app.notify(t("projects.clearDirectorFailed", { error: e instanceof Error ? e.message : String(e) }));
    return;
  }
  if (current()) await app.refreshHostSidebar(host);
}

function report(error: unknown): void {
  useApp.getState().notify(error instanceof Error ? error.message : String(error));
}

/**
 * The project menu. `group`: the sidebar group (a project or 独立智能体), on its own host; `collapsed`
 * / `toggle`: the header's fold (null on a collapsed one-row project). Grouped: open · create ·
 * bulk · display (device-local prefs) · copy · Director.
 */
export function projectMenu(group: SidebarGroup, workspaceRoot: string | null, collapsed: boolean, toggle: (() => void) | null, t: T): MenuEntry[] {
  const app = useApp.getState();
  const focus = app.hosts?.active ?? "local";
  const host = group.hostId ?? focus;
  const project = group.kind === "project";
  const name = project ? group.name : t("sidebar.independent");
  const starred = hostListKeys("starredProjects", [host]).includes(hostKey(host, group.id));
  const unfolded = hostListKeys("idleUnfolded", [host]).includes(hostKey(host, group.id));
  const muted = projectMuted(group.id);
  const sidebar = sidebarOf(app, host);
  const summary = project ? sidebar?.projects?.projects.find((p) => p.project_id === group.id) : undefined;
  const directorId = summary?.director_cutex_session_id ?? null;
  const director = directorId ? sidebar?.active.find((s) => s.cutexSessionId === directorId && s.lifecycle !== "retired") : undefined;
  const marked = markedRows(group, host);
  const idle = idleStoppable(group);
  const features = featuresOf(app, host);
  // The rotation store follows the focus host only.
  const rotating = !!director && host === focus && rotationRunningOn(host, group.id);
  // users: a non-owner connection may only look (no new agents, bulk stop, rename, Director changes).
  const owner = isOwnerFeatures(features);
  return [
    // ── open ──
    project && {
      label: t("menu.openProjectPage"),
      icon: <FolderKanban size={ICON} />,
      onSelect: () => {},
      submenu: projectTabsNow(host).map(({ tab, titleKey }) => ({ label: t(titleKey), onSelect: () => openProjectPage(group.id, host, { tab }) })),
    },
    director && { label: t("menu.openDirector", { name: director.displayName }), icon: <Crown size={ICON} />, onSelect: () => void app.select(director.cutexSessionId, host) },
    { label: t("menu.allAgents"), icon: <Users size={ICON} />, onSelect: () => openAgentList(group.id, "online", host) },
    owner && {
      label: t(project ? "menu.newAgentHere" : "menu.newIndependentAgent"),
      icon: <Plus size={ICON} />,
      onSelect: () => app.openPage("agent-config.newAgent", project ? { project: group.id, host } : { host }),
    },
    "separator",
    // ── bulk ──
    marked.length > 0 && { label: t("menu.markProjectRead", { count: marked.length }), icon: <MailCheck size={ICON} />, onSelect: () => marked.forEach((r) => markSeenOn(host, r.id)) },
    owner && idle.length > 0 && {
      label: t("menu.stopIdle", { count: idle.length }),
      icon: <Power size={ICON} />,
      confirm: t("menu.stopIdleConfirm", { project: name, count: idle.length }),
      onSelect: () => void stopIdle(idle, name, host, t).catch(report),
    },
    "separator",
    // ── display (this device) ──
    toggle && { label: collapsed ? t("menu.expand") : t("menu.collapse"), icon: collapsed ? <ChevronsUpDown size={ICON} /> : <ChevronsDownUp size={ICON} />, onSelect: toggle },
    { label: starred ? t("menu.unstar") : t("menu.star"), icon: starred ? <StarOff size={ICON} /> : <Star size={ICON} />, onSelect: () => toggleStarred(group.id, host) },
    // Only meaningful while 收起在线空闲 is on (Settings → 外观 → 侧栏).
    getUiPrefs().foldIdleAgents && { label: t("menu.idleUnfolded"), icon: unfolded ? <SquareCheck size={ICON} /> : <Square size={ICON} />, title: t("menu.idleUnfoldedHint"), onSelect: () => toggleIdleUnfolded(group.id, host) },
    // Sidebar sections (pure UI): keyed by host + project, so each host's entry moves on its own.
    project && moveToSectionEntry(hostKey(host, group.id), t),
    // The notification mute is the focus host's setting only (notificationLevelsStore).
    host === focus && projectMuteSupported() && { label: muted ? t("menu.unmuteProject") : t("menu.muteProject"), icon: muted ? <Bell size={ICON} /> : <BellOff size={ICON} />, onSelect: () => toggleProjectMuted(group.id) },
    "separator",
    // ── copy ──
    project && {
      label: t("menu.copy"),
      icon: <Copy size={ICON} />,
      onSelect: () => {},
      submenu: [
        { label: t("menu.copyName"), icon: <Type size={ICON} />, onSelect: () => copyText(name) },
        workspaceRoot && { label: t("menu.copyRoot"), icon: <ClipboardCopy size={ICON} />, onSelect: () => copyText(workspaceRoot) },
        { label: t("menu.copyId"), icon: <Hash size={ICON} />, onSelect: () => copyText(group.id) },
      ],
    },
    !project && workspaceRoot && { label: t("menu.copyRoot"), icon: <ClipboardCopy size={ICON} />, onSelect: () => copyText(workspaceRoot) },
    // ── edit ── (membership and the Director: the project page's agent tab; workspace root: 项目设置)
    owner && summary && { label: t("menu.renameProject"), icon: <Pencil size={ICON} />, onSelect: () => void renameProject(group.id, host, t).catch(report) },
    // Device-local (prefs `projectRemarks`): needs no project summary from the daemon.
    project && { label: t("remark.menu"), icon: <StickyNote size={ICON} />, title: t("remark.tooltip"), onSelect: () => void editProjectRemark(group.id, host, name, t) },
    // 添加成员… / 指定·更换主管…: the project page's agent tab with its picker open (param pick).
    owner && summary && { label: `${t("projects.addMember")}…`, icon: <UserPlus size={ICON} />, onSelect: () => openProjectPage(group.id, host, { tab: "agents", pick: "add" }) },
    owner && summary && (director ? features.has(OWNER_ROTATION_FEATURE) : !directorId && features.has(OPTIONAL_DIRECTOR_FEATURE)) && {
      label: t(director ? "projects.changeDirector" : "projects.pickDirector"),
      icon: <Crown size={ICON} />,
      disabled: rotating,
      title: rotating ? t("projects.directorRotating") : undefined,
      onSelect: () => openProjectPage(group.id, host, { tab: "agents", pick: "director" }),
    },
    // 轮换主管… (owner-rotation): the dialog lives on the project page, whose rotation store follows the focus host only.
    // A running rotation stays openable here (the dialog then shows its progress).
    owner && director && host === focus && features.has(OWNER_ROTATION_FEATURE) && {
      label: t("projects.rotation.menu"),
      icon: <ArrowRightLeft size={ICON} />,
      onSelect: () => openProjectPage(group.id, host, { tab: "agents", rotate: "1" }),
    },
    // 清除主管 (project-optional-director): confirms in place (click twice); the agent stays a member.
    owner && director && features.has(OPTIONAL_DIRECTOR_FEATURE) && {
      label: t("projects.clearDirector"),
      icon: <UserX size={ICON} />,
      danger: true,
      disabled: rotating,
      title: rotating ? t("projects.clearDirectorRotating") : undefined,
      armed: t("projects.clearDirectorArmed", { name: director.displayName }),
      onSelect: () => void clearProjectDirector(group.id, host, t),
    },
  ];
}
