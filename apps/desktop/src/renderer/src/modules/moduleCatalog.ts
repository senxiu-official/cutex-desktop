// Settings → 模块 (owner 2026-11-26) and the generated module catalog (docs/module-catalog.*.md): where a module shows
// up (from its `contributes`, never written by hand), its group (shared/moduleGroups), its default, and the 精简 / 推荐 /
// 全部 presets. Pure: the list renders in shell/ModulesPage.tsx; test/moduleCatalog.test.ts writes and checks the docs.
import { LEAN_MODULES, MODULE_GROUPS, isKeptOn, moduleGroup, moduleOrder, type ModuleGroup } from "../../../shared/moduleGroups";
import { moduleMetadata } from "../../../shared/moduleMetadata";

/** Places a contributed slot shows up in, in the order a row lists them. Slots that only add to another place
 *  (reference menus, overlays, the status surface, internal panels) are not listed on their own. */
export const MODULE_PLACES = ["nav", "page", "shelf", "status", "toolbar", "composer", "timeline", "codeBlock", "projectTab", "desktop", "tray", "settingsPage", "settingsSection", "quickSwitch", "notifyMethod", "profileField", "identityMenu"] as const;
export type ModulePlace = (typeof MODULE_PLACES)[number];

const PLACE_OF_SLOT: Readonly<Record<string, ModulePlace>> = {
  "nav.primary": "nav",
  "main.page": "page",
  "side.component": "shelf",
  "pane.kind": "shelf",
  "conversation.status": "status",
  "conversation.gutter": "toolbar",
  "composer.action": "composer",
  "timeline.tool": "timeline",
  "timeline.received": "timeline",
  "timeline.turnAttachment": "timeline",
  "timeline.intro": "timeline",
  "timeline.codeBlockAction": "codeBlock",
  "project.tab": "projectTab",
  "desktop.widget": "desktop",
  "pane.desktop": "desktop",
  "tray.entry": "tray",
  "settings.page": "settingsPage",
  "settings.section": "settingsSection",
  "window.search": "quickSwitch",
  "notify.method": "notifyMethod",
  "profile.fieldAction": "profileField",
  "identity.menu": "identityMenu",
};

/** Slots that add to another place and are never a place of their own (the test checks every slot is one or the other). */
export const UNLISTED_SLOTS: ReadonlySet<string> = new Set(["customize.region", "conversation.statusSurface", "conversation.overlay", "ref.action", "ref.target"]);
export const PLACE_SLOTS: ReadonlySet<string> = new Set(Object.keys(PLACE_OF_SLOT));

/** Where a module's contributions show up (each place once, in MODULE_PLACES order). */
export function modulePlaces(contributes: Readonly<Record<string, readonly unknown[] | undefined>> | undefined): ModulePlace[] {
  const found = new Set<ModulePlace>();
  for (const [slot, items] of Object.entries(contributes ?? {})) {
    const place = PLACE_OF_SLOT[slot];
    if (place && items && items.length > 0) found.add(place);
  }
  return MODULE_PLACES.filter((p) => found.has(p));
}

// ── child modules (owner 2026-11-26) ─────────────────────────────────────────────────────────────

/** Slots drawn inside one module (its id): the desktop's widgets live on 桌面 (home's pane.desktop). */
export const SLOT_HOST: Readonly<Record<string, string>> = { "desktop.widget": "home" };

type ChildShape = { requires?: { modules?: readonly string[] }; contributes?: unknown };

/**
 * The module this one only adds to, or null. A child needs exactly one module (`requires.modules`) and everything it
 * contributes goes into slots drawn inside that module (SLOT_HOST): 世界时钟 and 正在运行的 Maid only add 桌面 widgets.
 * Listed indented under its parent; the parent's 被…依赖 line leaves it out.
 */
export function moduleParent(def: ChildShape): string | null {
  const req = def.requires?.modules ?? [];
  if (req.length !== 1) return null;
  const slots = Object.entries((def.contributes ?? {}) as Record<string, readonly unknown[] | undefined>).filter(([, items]) => !!items && items.length > 0).map(([slot]) => slot);
  return slots.length > 0 && slots.every((slot) => SLOT_HOST[slot] === req[0]) ? req[0]! : null;
}

/** Children right after their parent when the parent is in `items` (`child: true`); the rest keep their order. */
export function nestChildren<T extends { id: string }>(items: readonly T[], parentOf: (item: T) => string | null): { item: T; child: boolean }[] {
  const ids = new Set(items.map((i) => i.id));
  const nested = (i: T) => { const p = parentOf(i); return p !== null && p !== i.id && ids.has(p); };
  const out: { item: T; child: boolean }[] = [];
  for (const item of items) {
    if (nested(item)) continue;
    out.push({ item, child: false });
    for (const c of items) if (nested(c) && parentOf(c) === item.id) out.push({ item: c, child: true });
  }
  return out;
}

// ── presets ────────────────────────────────────────────────────────────────────────────────────

export const MODULE_PRESETS = ["lean", "recommended", "all"] as const;
export type ModulePreset = (typeof MODULE_PRESETS)[number];

export interface PresetModule {
  id: string;
  required: boolean;
  /** The module's own default (`defaultEnabled !== false`). */
  defaultOn: boolean;
  /** Modules it needs on (`requires.modules`). */
  requires?: readonly string[];
}

/** id → the modules that need it on (from `requires.modules`; 「被 X 依赖」), in the given order. */
export function moduleDependents(modules: readonly { id: string; requires?: readonly string[] }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of modules) for (const dep of m.requires ?? []) out.set(dep, [...(out.get(dep) ?? []), m.id]);
  return out;
}

/** What turning one module on or off takes (module-dependencies-20261126): on = it and what it needs, directly or not,
 *  that is off; off = it and the modules on that need it, directly or not. Required modules are never in `off`. */
export function switchPlan(id: string, on: boolean, modules: readonly PresetModule[], isOn: (id: string) => boolean): string[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const dependents = moduleDependents(modules);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (x: string) => {
    if (seen.has(x)) return;
    seen.add(x);
    const m = byId.get(x);
    if (!m) return;
    if (x !== id && (on ? isOn(x) || m.required : !isOn(x) || m.required)) return;
    out.push(x);
    for (const next of on ? (m.requires ?? []) : (dependents.get(x) ?? [])) visit(next);
  };
  visit(id);
  return out;
}

/** Whether a preset leaves this module alone: required (always on), optional (the owner's own choice). */
export const presetSkips = (m: PresetModule): boolean => m.required || !!moduleMetadata(m.id)?.optional;

/** The switch a preset wants for a module by itself (before what other modules need). */
export function presetTarget(preset: ModulePreset, m: PresetModule): boolean {
  if (preset === "lean") return LEAN_MODULES.has(m.id);
  if (preset === "recommended") return m.defaultOn;
  return true;
}

/**
 * What applying a preset would change: the ids to turn on and off (modules it skips never appear). A module that a
 * module staying on needs (`requires.modules`) stays on too, so a preset never leaves a module without what it needs.
 */
export function presetChanges(preset: ModulePreset, modules: readonly PresetModule[], isOn: (id: string) => boolean): { on: string[]; off: string[] } {
  const want = new Map<string, boolean>();
  for (const m of modules) want.set(m.id, presetSkips(m) ? isOn(m.id) || m.required : presetTarget(preset, m));
  const byId = new Map(modules.map((m) => [m.id, m]));
  const pending = modules.filter((m) => want.get(m.id)).map((m) => m.id);
  while (pending.length) {
    for (const dep of byId.get(pending.pop()!)?.requires ?? []) {
      if (byId.has(dep) && !want.get(dep)) { want.set(dep, true); pending.push(dep); }
    }
  }
  const on: string[] = [], off: string[] = [];
  for (const m of modules) {
    if (presetSkips(m)) continue;
    const w = want.get(m.id)!;
    if (w !== isOn(m.id)) (w ? on : off).push(m.id);
  }
  return { on, off };
}

/** The preset the current switches match exactly (null: a mix of the owner's own). */
export function currentPreset(modules: readonly PresetModule[], isOn: (id: string) => boolean): ModulePreset | null {
  return MODULE_PRESETS.find((p) => { const c = presetChanges(p, modules, isOn); return c.on.length + c.off.length === 0; }) ?? null;
}

// ── list groups ────────────────────────────────────────────────────────────────────────────────

/** The list's group order: what you added first (local / unknown packs), the groups by use, core last. */
export const LIST_GROUPS: readonly ModuleGroup[] = ["added", ...MODULE_GROUPS, "core"];

/** Items in list group order, each group in the given order; empty groups left out. */
export function groupModules<T extends { id: string }>(items: readonly T[], groupOf: (item: T) => ModuleGroup): { group: ModuleGroup; items: T[] }[] {
  return LIST_GROUPS.map((group) => ({ group, items: items.filter((i) => groupOf(i) === group) })).filter((g) => g.items.length > 0);
}

export { isKeptOn, moduleGroup, moduleOrder };

// ── the generated catalog (docs/module-catalog.*.md) ───────────────────────────────────────────

export interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  group: ModuleGroup;
  places: readonly ModulePlace[];
  required: boolean;
  defaultOn: boolean;
  optional: boolean;
  /** Only a signed pack (not shipped with the app). */
  packOnly: boolean;
  lean: boolean;
  /** Required but listed with its use (必需). */
  keptOn: boolean;
  /** Why it is required (必需), if it is. */
  keptReason?: string;
  /** Titles of the modules that need it on (its own children left out). */
  dependents: readonly string[];
  /** The module it only adds to (moduleParent): listed under that module's entry. */
  parent?: string;
  /** The parent's title. */
  parentTitle?: string;
}

export interface CatalogWords {
  heading: string;
  intro: string[];
  group(g: ModuleGroup): string;
  place(p: ModulePlace): string;
  what: string;
  where: string;
  nowhere: string;
  default: string;
  on: string;
  off: string;
  core: string;
  keptOn: string;
  /** Before a 必需 module's reason. */
  because: string;
  dependents: string;
  /** Before a child's parent (e.g. 「属于：」). */
  partOf: string;
  /** Around a child's places after its parent: （ ）. */
  open: string;
  close: string;
  optional: string;
  optionalPack: string;
  lean: string;
  leanYes: string;
  leanNo: string;
  sep: string;
}

/** The catalog as markdown: groups in list order, modules in the given order within each (pass them in moduleOrder). */
export function catalogMarkdown(entries: readonly CatalogEntry[], w: CatalogWords): string {
  const out: string[] = [`# ${w.heading}`, "", ...w.intro, ""];
  for (const { group, items } of groupModules(entries, (e) => e.group)) {
    out.push(`## ${w.group(group)}`, "");
    for (const { item: e, child } of nestChildren(items, (x) => x.parent ?? null)) {
      const def = e.keptOn ? `${w.keptOn}${e.keptReason ? `${w.because}${e.keptReason}` : ""}` : e.required ? w.core : e.packOnly ? w.optionalPack : e.optional ? w.optional : e.defaultOn ? w.on : w.off;
      out.push(`${child ? "####" : "###"} ${e.title} (\`${e.id}\`)`, "");
      out.push(`- ${w.what}${e.description || "—"}`);
      // A child: what it adds to and how (属于：桌面（桌面小组件）), instead of where it shows up.
      if (child) out.push(`- ${w.partOf}${e.parentTitle ?? e.parent}${e.places.length ? `${w.open}${e.places.map(w.place).join(w.sep)}${w.close}` : ""}`);
      else out.push(`- ${w.where}${e.places.length ? e.places.map(w.place).join(w.sep) : w.nowhere}`);
      out.push(`- ${w.default}${def}`);
      if (e.dependents.length) out.push(`- ${w.dependents}${e.dependents.join(w.sep)}`);
      if (!e.required && !e.optional && !e.packOnly) out.push(`- ${w.lean}${e.lean ? w.leanYes : w.leanNo}`);
      out.push("");
    }
  }
  return out.join("\n").replace(/\n+$/, "\n");
}
