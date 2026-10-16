// Desktop-local UI preferences (localStorage), shared between components via useSyncExternalStore.
import { migrateNavPins } from "./navPins";
import { useSyncExternalStore } from "react";
import type { SendKeyPreset } from "./sendKeys";
import type { CreateHostDefault } from "./hostPick";
import { DEFAULT_CAPSULE_CORNER, DEFAULT_CAPSULE_EDGE, migrateCapsuleAnchor, type CapsuleCorner, type CapsuleEdge } from "./capsuleLayout";
import { DEFAULT_OFFLINE_LIMIT, migrateOfflineLimit, type OfflineLimit } from "./offlineAgents";
import { DEFAULT_FOLD_LINES, migrateFoldLines, type FoldLines } from "./messageFold";
import { DEFAULT_REASONING_VIEW, migrateReasoningView, REASONING_VIEW_REV, type ReasoningView } from "./reasoningView";
import type { TurnSummaryMode } from "./turnSummary";
import { DEFAULT_QUOTA_VIEW, migrateQuotaView, type QuotaView } from "./quota";
import { migrateSections, type SectionCollapsedShows, type SidebarSection } from "./sidebarSections";
import { migrateRemarks, withRemark } from "./projectRemarks";
import { migrateIcons, withIcon, type ProjectIconChoice } from "./projectIcons";
import { clampDockPref, DOCK_WIDTH_DEFAULT } from "./gutterDock";
import { DEFAULT_FLYOUT_DELAY, migrateFlyoutDelay, type FlyoutDelay } from "./projectFlyout";
import { DEFAULT_PROJECT_SEPARATION, migrateProjectSeparation, PROJECT_SEPARATION_REV, type ProjectSeparation } from "./projectSeparation";
import { DEFAULT_STATUS_CHIPS, migrateStatusChips, type StatusChips } from "./statusChips";
import { claimList, dropLegacy, hostKey, keyFocus, onKeyFocus, parseHostKey, projectList, registerHostKeyed, writeList } from "./hostKeys";
import type { CurrentPageClick } from "./sideLaneClick";
import { migrateLauncherPins } from "./sideLaunchers";
import { DEFAULT_SIDE_PREVIEW, migrateSidePreview, SIDE_PREVIEW_REV, type SidePreview } from "./sidePreviewPref";
import { DEFAULT_QUEUE_PANEL_FOLD, migrateQueuePanelFold, type QueuePanelFold } from "./queueChips";
import { DEFAULT_RUNNING_AGENTS, migrateRunningAgents, RUNNING_AGENTS_REV, type RunningAgents } from "./runningAgentsPref";

export type ProjectIconStyle = "tint" | "line";
export type AgentAvatarDefault = "emoji" | "letter";

export interface UiPrefs {
  /** Show the reset countdown next to quota rings in the composer row. */
  quotaShowReset: boolean;
  /** The profile chip in the composer starts with the profile picture (lib/profileAvatar). */
  composerProfileAvatar: boolean;
  /** Quota gauges in the composer chip + popover show what is left (default) or what is used.
   *  The context ring always shows used. */
  quotaView: QuotaView;
  /** Left sidebar visible (Ctrl+B / title bar toggle). */
  sidebarOpen: boolean;
  /** Agent-bus messages: one-line collapsible (compact) or always the full bubble. */
  agentMessages: "compact" | "full";
  /** Folded table groups, "<table>:<group key>" (DataTable foldPrefix, e.g. "services:<projectId>"; "" = no project). */
  foldedGroups: string[];
  /** Pinned models per host id, then profile name (composer model picker; lib/models); absent =
   *  first few of the catalog. Two hosts with a same-named profile keep their own pins. */
  modelPins: Record<string, Record<string, string[]>>;
  /** Last working directory used for a new independent agent (prefill). */
  lastAgentCwd: string;
  /** Same, per SSH host id (a path on that host; the local one never prefills a remote form). */
  remoteAgentCwd: Record<string, string>;
  /** Composer send shortcuts preset (lib/sendKeys). */
  sendKeys: SendKeyPreset;
  /** 委托进行中允许插话快捷键: during a delegation turn the steer / interrupt-and-send shortcuts work
   *  as usual (off: they queue; the send menu still offers 加入此委托 / 打断委托; lib/delegationTurn). */
  delegationSteerKeys: boolean;
  /** 悬停时显示分区名: hovering the queue frame's rail shows the section name as a strip (lib/railStrip). */
  queueSectionStrip: boolean;
  /** 「接下来」面板: "open" (★ 始终展开, owner 2026-10-16) = never collapses by itself, only the chevron
   *  folds it (remembered per agent); "auto" = starts as its chip line when several kinds wait or the
   *  window is short (lib/queueChips autoCompact). */
  queuePanelFold: QueuePanelFold;
  /** Capsule corner (lib/capsuleLayout); collapsed and open share it. */
  capsuleCorner: CapsuleCorner;
  /** Against the window edge, or the text column edge. */
  capsuleEdge: CapsuleEdge;
  /** Reasoning steps in the timeline: open, folded to their row, or left out (lib/reasoningView). */
  reasoningView: ReasoningView;
  /** Which default `reasoningView` was saved under (lib/reasoningView migration). */
  reasoningViewRev: number;
  /** Capsule panel expanded. Only the pill toggles it (no auto-collapse); remembered across agents. */
  capsuleOpen: boolean;
  /** Sections folded inside the open capsule (header only): `conversation.status` item ids,
   *  remembered across agents. (Where each status item shows is a module-host placement override,
   *  lib/statusItems.) */
  capsuleFoldedItems: string[];
  /** Show the status capsule even when nothing is running (an empty one-line capsule). */
  capsuleAlways: boolean;
  /** Turns a conversation renders before 显示更早 (0 = all). */
  timelineTurns: number;
  /** 会话开场: the `timeline.intro` opening above a conversation's first turn (§19.3). */
  timelineIntro: boolean;
  /** Handled interactions (questions answered, approvals decided) stay as one timeline row
   *  (lib/interactionLog; this run only — cutex keeps no handled requests yet). */
  timelineInteractions: boolean;
  /** Sidebar project order set by dragging (project ids); empty = automatic (live agents first). */
  projectOrder: string[];
  /** Profile order set on Settings → Profiles (lib/profileOrder; profile ids, per host); empty = cutex's
   *  order. Listed profiles come first everywhere profiles are picked, the rest keep cutex's order. */
  profileOrder: string[];
  /** Offline agents listed under a sidebar group (most recent first); the rest via 全部 agent. */
  offlineAgents: OfflineLimit;
  /** Sidebar groups (project id / "__independent__") whose offline list is expanded; the others
   *  show only the 离线 N header (plus the open agent). Collapsed by default. */
  offlineOpen: string[];
  /** Title bar 启动 / 停止运行时 button: every conversation, independent agents only, or none. */
  runtimeButton: "all" | "independent" | "off";
  /** Long-message folding (lib/messageFold): the user's own messages taller than `foldLines`
   *  visual lines show clipped with 展开全部. */
  foldLong: boolean;
  foldLines: FoldLines;
  /** Older agent replies fold the same way (the latest reply never does). */
  foldOlderReplies: boolean;
  /** Sidebar v2 (lib/sidebarLayout): 全部分组 (projects without online agents fold to one row) or
   *  星标展开 (starred projects in full, every other one row under 其他项目). */
  projectGrouping: ProjectGrouping;
  /** 全部分组: projects with no online agent fold to one row with a hover flyout, or stay expanded. */
  noOnlineProjects: NoOnlineProjects;
  /** Running agents that need nothing: compact rows (★), full rows, or one 运行中 row of avatars (lib/runningAgentsPref). */
  runningAgents: RunningAgents;
  /** Which `runningAgents` default was saved under (lib/runningAgentsPref migration). */
  runningAgentsRev: number;
  /** Online idle agents fold into 「N 个空闲」. */
  foldIdleAgents: boolean;
  /** Sidebar groups whose 在线空闲 fold is expanded. */
  idleOpen: string[];
  /** Projects (sidebar group ids) set to 「在线空闲不收起」: their idle agents are listed one by one
   *  even with `foldIdleAgents` on (project right-click menu). */
  idleUnfolded: string[];
  /** Sidebar groups the owner folded by their header (project ids, "__independent__", "__other__", "__chats__"). */
  foldedProjects: string[];
  /** Starred projects (sidebar group ids, incl. "__independent__"): on top, never collapsed. */
  starredProjects: string[];
  /** Sidebar project sections (lib/sidebarSections): named, ordered, foldable; members are project
   *  host keys. Global across view scopes (not a HOST_LISTS entry: members are always host keys). */
  sidebarSections: SidebarSection[];
  /** 本机备注 per project (lib/projectRemarks): hostKey(hostId, projectId) → one-line note. Always host
   *  keys, global across view scopes (not a HOST_LISTS entry). */
  projectRemarks: Record<string, string>;
  /** 归档项目 + 主管: hostKey(hostId, projectId) → the Director session id archived with it, so a
   *  later restore can offer 「同时恢复主管」 when cutex no longer names it (lib/projectArchive). */
  projectDirectors: Record<string, string>;
  /** 项目图标 per project (lib/projectIcons): hostKey(hostId, projectId) → emoji / lucide choice;
   *  absent = the daemon's letter badge. Device-local until cutex gains a presentation icon field.
   *  Always host keys, global across view scopes (not a HOST_LISTS entry). */
  projectIcons: Record<string, ProjectIconChoice>;
  /** A folded section lists nothing but its header summary, or still the projects that need you. */
  sectionCollapsedShows: SectionCollapsedShows;
  /** Hovering any collapsed project row (folded by the user or auto-collapsed) previews its agents in
   *  a flyout (lib/projectFlyout); off: an auto-collapsed row opens it on click only. */
  projectHoverPreview: boolean;
  /** Pointer rest time before that preview opens (ms). */
  projectHoverDelay: FlyoutDelay;
  /** 项目分隔: each project section as a block tinted with its colour, a left colour rail, or nothing (lib/projectSeparation). */
  projectSeparation: ProjectSeparation;
  /** Migration marker for the projectSeparation default change (lib/projectSeparation PROJECT_SEPARATION_REV). */
  projectSeparationRev: number;
  /** 项目标题着色: header bands (标题行, the 背景色 header) tinted with the group colour; off: same layout, no tint. */
  projectHeaderTint: boolean;
  /** 项目图标样式 (Settings → 外观): a soft tint tile, or the glyph / letters alone in the same box (components/ProjectBadge). */
  projectIconStyle: ProjectIconStyle;
  /** 状态标签: agent rows' status chips as text, icon only, or automatic by row width (lib/statusChips). */
  statusChips: StatusChips;
  /** 「需要你」 chips above the composer (done / needs-you / error agents of every project). */
  needsYouStrip: boolean;
  /** Title bar: agent line + a second line with cwd · branch · diff. */
  titleTwoLines: boolean;
  /** Latest message as a second line under the agent name: never, Director rows only, every row. */
  rowPreview: RowPreview;
  /** 默认头像 of agents without their own avatar: a bundled emoji picked from the id (lib/agentEmoji) or the initial. */
  agentAvatarDefault: AgentAvatarDefault;
  /** Image file links in messages: an inline thumbnail (read through cutex fs/file) or the link only. */
  messageImages: "thumbnail" | "link";
  /** 轮尾摘要 under a finished turn's last reply (lib/turnSummary): collapsed, the latest one expanded, or off. */
  turnSummary: TurnSummaryMode;
  // ── 会话两侧 (Settings → 侧栏, docs/desktop-modules.md §18.12) ──
  /** 右栏与对话: side by side with the text re-centred (push), the text keeps its place (yield), or over the conversation (float). */
  sideMode: SideMode;
  /**
   * 右栏布局 with ≥ 2 pages (owner 2026-10-14): "lane" (★) = the vertical page-button lane stays beside the
   * open column (pages left, each card's own tab row on the right); "tabs" = the pages as a tab row at the
   * column's top, the lane only while the column is closed.
   */
  sidePageBar: "lane" | "tabs";
  /** Page buttons in the vertical lane (open column with 竖条 + 标签页, and the closed side). */
  sidePillAnchor: "top" | "center" | "bottom";
  /** Right column closed with ≥ 2 pages: keep the page buttons (launcher) or hide everything. */
  sideLaneWhenHidden: "keep" | "hide";
  /** 点击当前页图标 (the page in view's button / Ctrl+Shift+n again): nothing (★; the lane has its own collapse button) or close the column. */
  sideCurrentPageClick: CurrentPageClick;
  /** Window too narrow for both: the side as a drawer over the conversation, or closed automatically. */
  sideNarrow: "overlay" | "auto-collapse";
  /** Opening a file: replace the unpinned preview tab (★, lead 2026-10-12; Ctrl/⌘ / middle click keeps it), new tabs for
   *  conversation links only, or always a new tab. The old default "links-new-tab" migrates once (sidePreviewRev). */
  sidePreview: SidePreview;
  /** Which `sidePreview` default was saved under (lib/sidePreviewPref migration). */
  sidePreviewRev: number;
  /** Restore the right side's layout on start. */
  sideRestore: boolean;
  /** keepAlive "hidden" instances kept mounted off screen (LRU, 1–12, ★4; lib/sideKeep, §18.13). */
  sideKeepHidden: number;
  /** Instances components may hold mounted at once (keepMounted, 1–8, ★4; apart from the LRU, §18.13). */
  sideKeepMounted: number;
  /** Title-bar launchers the owner pinned (true) / unpinned (false), by component id (§18.3); absent = the component's `launcher.pin`. */
  sideLauncherPins: Record<string, boolean>;
  /** Sidebar top entries in the first screen, in pin order (lib/navPins); null = the defaults. Per device, not per host. */
  navPins: string[] | null;
  /** Where a reference card opens (two sides, §19; host pending): left when it fits, always right, always left. */
  peekTarget: "auto" | "right" | "left";
  /** Gutter items shown docked when the gutter is wide enough (two sides, §19; host pending). */
  gutterDocked: string[];
  /** 会话两侧 → 组件默认位置: the owner's default page group per component kind (absent = the declared `placement.home`). */
  sideHomes: Record<string, string>;
  /** Width of the docked gutter lists (px, 200–480, ★260; lib/gutterDock, dragged on the list's inner edge). */
  gutterDockWidth: number;
  /** Host marks (dot / chip, multi-host RFC §8.2) also in a one-host scope (★ Q7 off; lib/hostScope showHostMarks). */
  hostMarksSingle: boolean;
  /** Host marks also on this machine (local host) entries in the sidebar; off: only other hosts are marked. */
  hostMarkLocal: boolean;
  /** Host of the last agent / project created from a form (★ RFC Q10, after the selected agent's host); "" = none. */
  lastCreateHost: string;
  /** Default host of create forms in a multi-host scope: "local" = this machine first (★, owner 2026-10-14), "context" = the selected agent's / last creation's host first. */
  createHostDefault: CreateHostDefault;
}

export type SideMode = "push" | "yield" | "float";

export type RowPreview = "off" | "director" | "all";

export type ProjectGrouping = "all" | "starred";
export type NoOnlineProjects = "collapse" | "expand";
export type { RunningAgents };

const KEY = "cutex-desktop.ui";
const DEFAULTS: UiPrefs = { quotaShowReset: true, composerProfileAvatar: true, quotaView: DEFAULT_QUOTA_VIEW, sidebarOpen: true, agentMessages: "compact", foldedGroups: [], modelPins: {}, lastAgentCwd: "", remoteAgentCwd: {}, sendKeys: "queueFirst", delegationSteerKeys: false, capsuleCorner: DEFAULT_CAPSULE_CORNER, capsuleEdge: DEFAULT_CAPSULE_EDGE, reasoningView: DEFAULT_REASONING_VIEW, reasoningViewRev: REASONING_VIEW_REV, capsuleOpen: false, capsuleFoldedItems: [], timelineTurns: 30, timelineInteractions: true, timelineIntro: true, capsuleAlways: false, projectOrder: [], profileOrder: [], offlineAgents: DEFAULT_OFFLINE_LIMIT, offlineOpen: [],runtimeButton: "all", foldLong: true, foldLines: DEFAULT_FOLD_LINES, foldOlderReplies: false, projectGrouping: "all", noOnlineProjects: "collapse", runningAgents: DEFAULT_RUNNING_AGENTS, runningAgentsRev: RUNNING_AGENTS_REV, foldIdleAgents: true, idleOpen: [], idleUnfolded: [], foldedProjects: [], starredProjects: [], sidebarSections: [], projectRemarks: {}, projectDirectors: {}, projectIcons: {}, sectionCollapsedShows: "summary", projectHoverPreview: true, projectHoverDelay: DEFAULT_FLYOUT_DELAY, projectSeparation: DEFAULT_PROJECT_SEPARATION, projectSeparationRev: PROJECT_SEPARATION_REV, projectHeaderTint: true, projectIconStyle: "tint", statusChips: DEFAULT_STATUS_CHIPS, needsYouStrip: true, titleTwoLines: true, rowPreview: "director", agentAvatarDefault: "emoji", messageImages: "thumbnail", turnSummary: "collapsed", sideMode: "push", sidePageBar: "lane", sidePillAnchor: "top", sideLaneWhenHidden: "keep", sideCurrentPageClick: "stay", sideNarrow: "overlay", sidePreview: DEFAULT_SIDE_PREVIEW, sidePreviewRev: SIDE_PREVIEW_REV, sideRestore: true, sideKeepHidden: 4, sideKeepMounted: 4, sideLauncherPins: {}, navPins: null, peekTarget: "auto", gutterDocked: [], sideHomes: {}, gutterDockWidth: DOCK_WIDTH_DEFAULT, hostMarksSingle: false, hostMarkLocal: false, queueSectionStrip: true, queuePanelFold: DEFAULT_QUEUE_PANEL_FOLD, lastCreateHost: "", createHostDefault: "local" };
const listeners = new Set<() => void>();
/**
 * Lists of agent / project / group ids: stored under host keys (lib/hostKeys), shown as the focus
 * host's bare ids. `foldedGroups` entries are `<table>:<group>` (claimed by any id segment).
 */
const HOST_LISTS = ["projectOrder", "profileOrder", "offlineOpen", "idleOpen", "idleUnfolded", "foldedProjects", "starredProjects", "foldedGroups"] as const;
export type HostList = (typeof HOST_LISTS)[number];
const isHostList = (key: keyof UiPrefs): key is HostList => (HOST_LISTS as readonly string[]).includes(key);
/** What is persisted (host keys); `current` is its projection onto the focus host. */
let stored: UiPrefs = load();
let current: UiPrefs = project(stored);

function project(prefs: UiPrefs): UiPrefs {
  const out = { ...prefs };
  for (const key of HOST_LISTS) out[key] = projectList(prefs[key]);
  return out;
}

function persist(next: UiPrefs): void {
  stored = next;
  current = project(stored);
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // not persisted
  }
  for (const l of listeners) l();
}

function rewriteLists(update: (list: readonly string[], key: HostList) => readonly string[]): void {
  let next: UiPrefs | null = null;
  for (const key of HOST_LISTS) {
    const list = stored[key];
    const value = update(list, key);
    if (value !== list) next = { ...(next ?? stored), [key]: [...value] };
  }
  if (next) persist(next);
}

registerHostKeyed({
  claim: (hostId, ids) => rewriteLists((list, key) => claimList(list, hostId, key === "foldedGroups" ? (entry) => entry.split(":").some((part) => ids.has(part)) : (entry) => ids.has(entry))),
  dropLegacy: () => rewriteLists((list) => dropLegacy(list)),
});
onKeyFocus(() => {
  current = project(stored);
  for (const l of listeners) l();
});

function migrateSideHomes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => k && k.length <= 128 && typeof v === "string" && v && v.length <= 64));
}

function load(): UiPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<UiPrefs> & { capsuleAnchor?: unknown };
    const { capsuleAnchor, ...rest } = stored;
    const anchor = stored.capsuleCorner ? null : migrateCapsuleAnchor(capsuleAnchor);
    return {
      ...DEFAULTS,
      ...rest,
      ...(anchor && { capsuleCorner: anchor.corner, capsuleEdge: anchor.edge }),
      quotaView: migrateQuotaView(stored.quotaView),
      offlineAgents: migrateOfflineLimit(stored.offlineAgents),
      foldLines: migrateFoldLines(stored.foldLines),
      reasoningView: migrateReasoningView(stored.reasoningView, stored.reasoningViewRev),
      reasoningViewRev: REASONING_VIEW_REV,
      sidebarSections: migrateSections(stored.sidebarSections),
      projectRemarks: migrateRemarks(stored.projectRemarks),
      projectDirectors: migrateProjectDirectors(stored.projectDirectors),
      projectIcons: migrateIcons(stored.projectIcons),
      sectionCollapsedShows: stored.sectionCollapsedShows === "attention" ? "attention" : "summary",
      timelineIntro: stored.timelineIntro !== false,
      timelineInteractions: stored.timelineInteractions !== false,
      projectHoverPreview: stored.projectHoverPreview !== false,
      projectHoverDelay: migrateFlyoutDelay(stored.projectHoverDelay),
      gutterDockWidth: clampDockPref(stored.gutterDockWidth),
      projectSeparation: migrateProjectSeparation(stored.projectSeparation, stored.projectSeparationRev),
      projectSeparationRev: PROJECT_SEPARATION_REV,
      projectHeaderTint: stored.projectHeaderTint !== false,
      projectIconStyle: stored.projectIconStyle === "line" ? "line" : "tint",
      statusChips: migrateStatusChips(stored.statusChips),
      sideLauncherPins: migrateLauncherPins(stored.sideLauncherPins),
      sideHomes: migrateSideHomes(stored.sideHomes),
      navPins: migrateNavPins(stored.navPins),
      sidePreview: migrateSidePreview(stored.sidePreview, stored.sidePreviewRev),
      sidePreviewRev: SIDE_PREVIEW_REV,
      runningAgents: migrateRunningAgents(stored.runningAgents, stored.runningAgentsRev),
      runningAgentsRev: RUNNING_AGENTS_REV,
      agentAvatarDefault: stored.agentAvatarDefault === "letter" ? "letter" : "emoji",
      queuePanelFold: migrateQueuePanelFold(stored.queuePanelFold),
    };
  } catch {
    return DEFAULTS;
  }
}

export function setUiPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void {
  // Host-scoped id lists: the value is the focus host's list (what getUiPrefs shows).
  persist({ ...stored, [key]: isHostList(key) ? writeList(stored[key], value as string[], keyFocus()) : value });
}

export function getUiPrefs(): UiPrefs {
  return current;
}

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    // The same cached snapshot serves server-rendered tests (renderToStaticMarkup).
    () => current,
  );
}

export function toggleFolded(key: string): void {
  const folded = getUiPrefs().foldedGroups;
  setUiPref("foldedGroups", folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key]);
}

/** Adds / removes `id` in a string-list pref of `hostId` (default: the focus host). */
function toggleIn(key: "idleOpen" | "idleUnfolded" | "foldedProjects" | "starredProjects" | "offlineOpen", id: string, hostId = keyFocus()): void {
  const list = projectList(stored[key], hostId);
  persist({ ...stored, [key]: writeList(stored[key], list.includes(id) ? list.filter((k) => k !== id) : [...list, id], hostId) });
}

/**
 * A host-keyed list pref as host keys over several hosts (multi-host sidebar), in stored order; a
 * legacy bare id (not claimed yet) stands for that id on each of them.
 */
export function hostListKeys(key: HostList, hostIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of stored[key]) {
    const parsed = parseHostKey(entry);
    if (parsed) {
      if (hostIds.includes(parsed[0])) out.push(entry);
    } else for (const hostId of hostIds) out.push(hostKey(hostId, entry));
  }
  return [...new Set(out)];
}

/** Replace the entries of `hostIds` in a host-keyed list pref with `keys` (host keys, in order); other hosts' stay. */
export function setHostListKeys(key: HostList, hostIds: readonly string[], keys: readonly string[]): void {
  const others = stored[key].filter((entry) => {
    const parsed = parseHostKey(entry);
    return parsed ? !hostIds.includes(parsed[0]) : !keys.some((k) => parseHostKey(k)?.[1] === entry);
  });
  persist({ ...stored, [key]: [...others, ...keys] });
}

/** Folds / unfolds a sidebar group by its header (`foldedProjects`); `hostId`: the group's host. */
export function toggleProjectFolded(groupId: string, hostId?: string): void {
  toggleIn("foldedProjects", groupId, hostId);
}

/** Expands / collapses a sidebar group's offline list (`offlineOpen`); `hostId`: the group's host. */
export function toggleOfflineOpen(groupId: string, hostId?: string): void {
  toggleIn("offlineOpen", groupId, hostId);
}

/** Expands / collapses a sidebar group's 在线空闲 fold (`idleOpen`); `hostId`: the group's host. */
export function toggleIdleOpen(groupId: string, hostId?: string): void {
  toggleIn("idleOpen", groupId, hostId);
}

/** 「在线空闲不收起」 on / off for a project (sidebar group id); `hostId`: the project's host. */
export function toggleIdleUnfolded(groupId: string, hostId?: string): void {
  toggleIn("idleUnfolded", groupId, hostId);
}

/** Stars / unstars a project (sidebar group id); `hostId`: the project's host. */
export function toggleStarred(groupId: string, hostId?: string): void {
  toggleIn("starredProjects", groupId, hostId);
}

/** Rewrites the sidebar sections (lib/sidebarSections helpers take the current list, return the next). */
export function updateSections(update: (sections: readonly SidebarSection[]) => SidebarSection[]): void {
  persist({ ...stored, sidebarSections: update(stored.sidebarSections) });
}

/** Host keys with a non-empty session id only. */
function migrateProjectDirectors(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => !!parseHostKey(e[0]) && typeof e[1] === "string" && !!e[1]));
}

/** Remembers (id) / forgets (null) the Director archived with `projectId` on `hostId`. */
export function setProjectDirector(hostId: string, projectId: string, sessionId: string | null): void {
  const key = hostKey(hostId, projectId);
  if ((stored.projectDirectors[key] ?? null) === sessionId) return;
  const next = { ...stored.projectDirectors };
  if (sessionId) next[key] = sessionId;
  else delete next[key];
  persist({ ...stored, projectDirectors: next });
}

/** Sets / clears (empty) the 本机备注 of `projectId` on `hostId` (lib/projectRemarks sanitises it). */
export function setProjectRemark(hostId: string, projectId: string, text: string): void {
  const next = withRemark(stored.projectRemarks, hostId, projectId, text);
  if (next !== stored.projectRemarks) persist({ ...stored, projectRemarks: next });
}

/** Sets / clears (null) the 项目图标 of `projectId` on `hostId` (lib/projectIcons sanitises it). */
export function setProjectIcon(hostId: string, projectId: string, icon: ProjectIconChoice | null): void {
  const next = withIcon(stored.projectIcons, hostId, projectId, icon);
  if (next !== stored.projectIcons) persist({ ...stored, projectIcons: next });
}
