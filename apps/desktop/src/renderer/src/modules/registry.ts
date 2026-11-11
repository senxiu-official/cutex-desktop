// Built-in modules, in registry order (slot ties follow it). Static and ordered; only main.tsx
// and tests import this file (docs/desktop-modules.md §8).
import about from "./about";
import agentBus from "./agent-bus";
import browser from "./browser";
import alarms from "./alarms";
import approvals from "./approvals";
import agentConfig from "./agent-config";
import archive from "./archive";
import artifacts from "./artifacts";
import notes from "./notes";
import remoteCopies from "./remote-copies";
import baiduPan from "./baidu-pan";
import onboarding from "./onboarding";
import bookmarks from "./bookmarks";
import sideChat from "./side-chat";
import backgroundTerminals from "./background-terminals";
import claudeAccounts from "./claude-accounts";
import kimiAccounts from "./kimi-accounts";
import profileImport from "./profile-import";
import claudeScience from "./claude-science";
import codexConfig from "./codex-config";
import connection from "./connection";
import conversation from "./conversation";
import delegations from "./delegations";
import diff from "./diff";
import goal from "./goal";
import home from "./home";
import intro from "./intro";
import jobs from "./jobs";
import nci from "./nci";
import notifications from "./notifications";
import ownerNotify from "./owner-notify";
import plan from "./plan";
import projects from "./projects";
import projectView from "./project-view";
import quickChats from "./quick-chats";
import remoteAccess from "./remote-access";
import proxy from "./proxy";
import quickSwitch from "./quick-switch";
import peers from "./peers";
import perfLog from "./perf-log";
import users from "./users";
import worldClock from "./world-clock";
import runningAgents from "./running-agents";
import runtimePackages from "./runtime-packages";
import runtimes from "./runtimes";
import safetyGrants from "./safety-grants";
import services from "./services";
import shell from "./shell";
import statusCapsule from "./status-capsule";
import type { AppModule } from "./slots";
import subagents from "./subagents";
import taskService from "./task-service";
import terminal from "./terminal";
import threadSearch from "./thread-search";
import updater from "./updater";
import backendUpgrade from "./backend-upgrade";
import usage from "./usage";
import storage from "./storage";
import workflows from "./workflows";
import workspace from "./workspace";

export const MODULES: readonly AppModule[] = [
  shell,
  conversation,
  connection,
  agentConfig,
  // Contract 1.3: the host's notification tables, executed on this device (locked, `notify.method`).
  notifications,
  // v1.2: the capsule status surface (can be turned off; the status row is the shell's).
  statusCapsule,
  // v1.13: the conversation opening above the first turn (timeline.intro).
  intro,
  // Ctrl/⌘+K quick switcher (canvas principles §3: the entry that never depends on a pane; locked on).
  quickSwitch,
  // 性能记录 (#27): stalls over 100 ms, on this device (Settings → 关于).
  perfLog,
  // Contract 1.4: right-side cards (the old side pane: 文件 / 改动 / 预览, and the diff viewer).
  workspace,
  diff,
  // Contract 1.4: cutex PTYs as right-side cards (replaces the bottom terminal panel).
  terminal,
  // I2: the owner in-app browser as right-side cards (default off; main enforces attach / network policy).
  browser,
  // Contract 1.7: the project's versioned results (成果: cards, the publish card, `cutex:artifact/…` links).
  artifacts,
  notes,
  remoteCopies,
  baiduPan,
  bookmarks,
  // Contract 1.18: 桌面 — the desktop layer behind the panes, the 个人页 pane, 固定到主页 (cutex user-home).
  home,
  // Contract 1.22: the 世界时钟 desktop widget (design 032; the authoring guide's worked example).
  worldClock,
  // Contract 1.22: the 正在运行的智能体 desktop widget (agents with a turn in progress).
  runningAgents,
  // Project 视图: a pane kind with a project's agents, delegations, background work and recent activity.
  projectView,
  // Conversation search (native thread/searchOccurrences; cutex thread-search-occurrences).
  threadSearch,
  sideChat,
  // Status categories (step 2); their order in the capsule / status row is the items' `order`.
  goal,
  plan,
  backgroundTerminals,
  subagents,
  delegations,
  jobs,
  // NCI 远程作业 (default off): its settings guide; gates the 作业 page's NCI bits.
  nci,
  alarms,
  // cutex workflows (W1, default off): run list, run detail, the plan approval card.
  workflows,
  // Pages + sidebar entries (step 3); the sidebar order is the items' `order`.
  quickChats,
  projects,
  services,
  // Claude Science (default off): several Claude Science accounts as cutex managed services.
  claudeScience,
  approvals,
  taskService,
  codexConfig,
  agentBus,
  usage,
  storage,
  archive,
  ownerNotify,
  // claude-safety-grants: the owner's decision on a declined tool row (the 需要你 card is core).
  safetyGrants,
  remoteAccess,
  // Settings → 网络代理: this desktop's update proxy + the host's cutex proxy (proxy-modes).
  proxy,
  peers,
  // P1 users and grants: Settings → 用户 (owner only).
  users,
  updater,
  // Settings → 关于: license, links and the known issues list (sections on the shell's page).
  about,
  // The one-time introduction and per-version 新功能 (its card on Settings → 关于).
  onboarding,
  // Settings → 后端更新 (cutex backend-upgrade, owner only): each host's cutex upgrades.
  backendUpgrade,
  runtimePackages,
  runtimes,
  claudeAccounts,
  // Kimi 账户 (cutex kimi-accounts, r266): a section of Settings → Profile after Claude 账户.
  kimiAccounts,
  // 从 CC Switch 导入 (cutex profile-import-cc-switch): a section of Settings → Profile after Claude 账户.
  profileImport,
];
