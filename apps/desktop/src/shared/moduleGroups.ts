// Settings → 模块's groups by use and their order (owner 2026-11-26; module-distribution report 2026-11-26), and the 精简
// preset. App-owned first-party metadata next to shared/moduleMetadata.ts (optional): the module list and the generated
// module catalog (docs/module-catalog.*.md, test/moduleCatalog.test.ts) both read it, so they always show one order.
// Every registered non-core module has a group (test/moduleCatalog.test.ts); a module this list does not know (a local
// or third-party pack) is 自装模块, listed first. Every required module is listed only under 核心 (owner 2026-11-28: 「核心模块
// 只出现在核心模块」); the ones with a stated reason (必需: projects, approvals, archive, storage — module-dependencies-20261126)
// lead it, locked on with that reason.
//
// Order (owner 2026-11-26 「模组排序得想清楚」): groups by importance — 工作 → 浏览与资料 → 沟通与通知 → 输入 → 主机与运行时
// → 个人 → 开发者工具, then 核心 (collapsed) last. Within a group: the most used first, as written below — never by
// name. Optional modules (shared/moduleMetadata) and pack-only ones go to the end of their group whatever their place
// here (moduleOrder); developer / experimental modules are the 开发者工具 group, after every other group.

export const MODULE_GROUPS = ["work", "browse", "comms", "input", "hosts", "personal", "dev"] as const;
export type ModuleGroupId = (typeof MODULE_GROUPS)[number];
/** `added`: a module this app does not know (a local / third-party pack); `core`: the shell's required modules. */
export type ModuleGroup = ModuleGroupId | "added" | "core";

/** Each group's modules, most used first. */
const GROUP_MODULES: Readonly<Record<ModuleGroupId, readonly string[]>> = {
  work: [
    "delegations", "subagents", "goal", "plan", "background-terminals", "alarms", "quick-chats",
    "project-view", "jobs", "workflows", "services", "personal-assistants", "safety-grants", "claude-science",
  ],
  browse: [
    "workspace", "diff", "terminal", "artifacts", "browser", "session-search", "thread-search", "notes", "bookmarks",
    "remote-copies", "baidu-pan",
  ],
  comms: ["agent-bus", "owner-notify", "side-chat", "service-notify", "whatsapp"],
  input: ["feature-profiles", "input-refinement"],
  hosts: [
    "runtimes", "runtime-packages", "backend-upgrade", "updater", "usage", "claude-accounts", "kimi-accounts", "peers", "remote-access", "proxy", "users", "profile-import", "nci", "codex-config",
  ],
  personal: ["home", "running-agents", "world-clock", "intro", "desk-pet"],
  dev: ["task-service", "status-capsule"],
};

const PLACE = new Map<string, { group: ModuleGroupId; rank: number }>(
  MODULE_GROUPS.flatMap((group) => GROUP_MODULES[group].map((id, rank) => [id, { group, rank }] as const)),
);

/** Required modules with a reason of their own (必需, modules.list.keptOn.<id>), first in 核心 in this order. */
const KEPT_ON: readonly string[] = ["projects", "approvals", "archive", "storage"];

/** The group a module is listed under: a required module is 核心, wherever its use would place it. */
export function moduleGroup(id: string, required = false): ModuleGroup {
  if (required) return "core";
  return PLACE.get(id)?.group ?? "added";
}

/** Required with a stated reason (必需): locked on, with that reason, at the top of 核心. */
export const isKeptOn = (id: string, required: boolean): boolean => required && KEPT_ON.includes(id);

/** A module's place within its group (lower first); unknown modules after the known ones. */
export function moduleRank(id: string): number {
  const kept = KEPT_ON.indexOf(id);
  return kept >= 0 ? kept : PLACE.get(id)?.rank ?? Number.MAX_SAFE_INTEGER;
}

/**
 * The list / catalog order of modules: by group, then within a group the ones in use before optional / pack-only
 * ones, then each one's rank. `items` keep their given order where these tie (core modules, 自装模块).
 */
export function moduleOrder<T>(items: readonly T[], key: (item: T) => { id: string; required: boolean; optionalOrPack: boolean }): T[] {
  const groupIndex = (g: ModuleGroup) => (g === "added" ? -1 : g === "core" ? MODULE_GROUPS.length : MODULE_GROUPS.indexOf(g));
  return items
    .map((item, i) => ({ item, i, k: key(item) }))
    .sort((a, b) =>
      groupIndex(moduleGroup(a.k.id, a.k.required)) - groupIndex(moduleGroup(b.k.id, b.k.required))
      || Number(a.k.optionalOrPack) - Number(b.k.optionalOrPack)
      || moduleRank(a.k.id) - moduleRank(b.k.id)
      || a.i - b.i)
    .map((x) => x.item);
}

/** Ids this list places in a group (the test checks they match the registry and the known packs). */
export const GROUPED_MODULE_IDS: readonly string[] = [...PLACE.keys()];

/**
 * 精简 (owner 2026-11-26: the list in the preview): what day-to-day work needs; every other non-core module off.
 * Presets never change optional modules (shared/moduleMetadata): those stay as the owner set them.
 * 项目 / 存储 / 归档 / 审批 are required since module-dependencies-20261126 (owner 2026-11-26): no preset touches them.
 */
export const LEAN_MODULES: ReadonlySet<string> = new Set([
  "delegations", "subagents", "goal", "plan", "background-terminals", "alarms",
  "workspace", "diff", "terminal", "artifacts", "agent-bus", "owner-notify",
  "runtimes", "runtime-packages", "backend-upgrade", "updater", "usage", "claude-accounts",
]);
