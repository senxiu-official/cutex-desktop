// Settings → 模块's groups / order / presets (shared/moduleGroups.ts, modules/moduleCatalog.ts) against the registry,
// and the generated module catalog docs/module-catalog.{zh-CN,en}.md against the code. To rewrite the catalog after a
// module change: `node apps/desktop/scripts/module-catalog.mjs` (runs this file with MODULE_CATALOG_WRITE=1).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

const { MODULES } = await import("../src/renderer/src/modules/registry");
const { GUIDE_ACTIONS } = await import("../src/renderer/src/lib/guideActions");
const { GUIDES } = await import("../src/renderer/src/lib/guides");
const { SLOT_SPECS } = await import("../src/renderer/src/modules/slots");
const { zhCN } = await import("../src/renderer/src/i18n/zh-CN");
const { en } = await import("../src/renderer/src/i18n/en");
const { applyTerms, DEFAULT_TERMS } = await import("../src/renderer/src/lib/terms");
const { moduleMetadata } = await import("../src/shared/moduleMetadata");
const { GROUPED_MODULE_IDS, LEAN_MODULES, MODULE_GROUPS, isKeptOn, moduleGroup, moduleOrder } = await import("../src/shared/moduleGroups");
const catalog = await import("../src/renderer/src/modules/moduleCatalog");
const { catalogMarkdown, moduleParent, nestChildren, modulePlaces, presetChanges, currentPreset, moduleDependents, switchPlan, PLACE_SLOTS, UNLISTED_SLOTS } = catalog;

const MODULES_DIR = join(__dirname, "../src/renderer/src/modules");
const DOCS = join(__dirname, "../../../docs");
/** Ids the list already places although their module is still being built (none now). */
const COMING = new Set<string>();

/** Modules shipped only as a signed pack (a pack.json with packOnly): not in the registry. */
const packOnly = await Promise.all(
  readdirSync(MODULES_DIR)
    .filter((d) => existsSync(join(MODULES_DIR, d, "pack.json")) && JSON.parse(readFileSync(join(MODULES_DIR, d, "pack.json"), "utf8")).packOnly)
    .map(async (d) => ({
      def: (await import(`../src/renderer/src/modules/${d}/index.ts`)).default as (typeof MODULES)[number],
      zh: (await import(`../src/renderer/src/modules/${d}/i18n.ts`)).zhCN as Record<string, string>,
      en: (await import(`../src/renderer/src/modules/${d}/i18n.en.ts`)).en as Record<string, string>,
    })),
);
const contributes = (def: { contributes?: unknown }) => def.contributes as Readonly<Record<string, readonly unknown[] | undefined>> | undefined;

it("every settings action names a page some module registers (Settings can show it)", () => {
  const settingsPages = new Set(MODULES.flatMap((module) => (module.contributes?.["settings.page"] ?? []).map(({ page }) => page)));
  const settings = [
    ...Object.entries(GUIDE_ACTIONS).flatMap(([id, action]) => action.kind === "settings" ? [{ id, tab: action.tab }] : []),
    ...GUIDES.flatMap((guide) => guide.settings ? [{ id: `${guide.id} → settings`, tab: guide.settings }] : []),
  ];
  expect(settings.length).toBeGreaterThan(10);
  for (const { id, tab } of settings) expect(settingsPages.has(tab), `${id} → ${tab}`).toBe(true);
});

describe("module groups and order", () => {
  it("places every module with a switch in a group, and only modules that exist", () => {
    const known = new Set([...MODULES.map((m) => m.id), ...packOnly.map((p) => p.def.id)]);
    const ungrouped = [...MODULES.filter((m) => !m.required), ...packOnly.map((p) => p.def)].filter((m) => moduleGroup(m.id) === "added").map((m) => m.id);
    expect(ungrouped).toEqual([]);
    expect(GROUPED_MODULE_IDS.filter((id) => !known.has(id) && !COMING.has(id))).toEqual([]);
    // Owner 2026-11-28: a required module is listed only under 核心, never also in a group by use; the 必需 ones (with a
    // stated reason, module-dependencies-20261126) lead 核心.
    expect(MODULES.filter((m) => m.required && GROUPED_MODULE_IDS.includes(m.id)).map((m) => m.id)).toEqual([]);
    for (const m of MODULES.filter((x) => x.required)) expect(moduleGroup(m.id, true), m.id).toBe("core");
    for (const id of ["approvals", "archive", "projects", "storage"]) expect(isKeptOn(id, true)).toBe(true);
    expect(moduleOrder(["about", "storage", "projects"].map((id) => ({ id })), (x) => ({ id: x.id, required: true, optionalOrPack: false })).map((x) => x.id)).toEqual(["projects", "storage", "about"]);
    expect(new Set(GROUPED_MODULE_IDS).size).toBe(GROUPED_MODULE_IDS.length);
  });

  it("orders groups by importance, core last, optional modules at a group's end, never by name", () => {
    expect(MODULE_GROUPS).toEqual(["work", "browse", "comms", "input", "hosts", "personal", "dev"]);
    const items = [
      { id: "whatsapp", required: false, optionalOrPack: true },
      { id: "about", required: true, optionalOrPack: false },
      { id: "side-chat", required: false, optionalOrPack: false },
      { id: "agent-bus", required: false, optionalOrPack: false },
      { id: "diff", required: false, optionalOrPack: false },
      { id: "someone-elses-pack", required: false, optionalOrPack: true },
      { id: "delegations", required: false, optionalOrPack: false },
    ];
    expect(moduleOrder(items, (i) => i).map((i) => i.id)).toEqual(["someone-elses-pack", "delegations", "diff", "agent-bus", "side-chat", "whatsapp", "about"]);
  });

  it("decides for every slot whether it is a place a row lists", () => {
    const slots = Object.keys(SLOT_SPECS);
    expect(slots.filter((s) => !PLACE_SLOTS.has(s) && !UNLISTED_SLOTS.has(s))).toEqual([]);
    expect([...PLACE_SLOTS, ...UNLISTED_SLOTS].filter((s) => !slots.includes(s))).toEqual([]);
    expect(modulePlaces({ "settings.page": [{}], "nav.primary": [{}], "ref.action": [{}], "main.page": [] })).toEqual(["nav", "settingsPage"]);
  });
});

describe("child modules", () => {
  it("lists a module that only adds widgets to 桌面 under 桌面, and nothing else", () => {
    const defs = [...MODULES, ...packOnly.map((p) => p.def)];
    expect(defs.filter((d) => moduleParent(d)).map((d) => [d.id, moduleParent(d)]).sort()).toEqual([["running-agents", "home"], ["world-clock", "home"]]);
    // Needs the browser but has pages of its own: a dependent, not a child.
    expect(moduleParent(defs.find((d) => d.id === "whatsapp")!)).toBeNull();
    // Widgets plus a place of its own, or no requirement: not a child.
    expect(moduleParent({ requires: { modules: ["home"] }, contributes: { "desktop.widget": [{}], "nav.primary": [{}] } })).toBeNull();
    expect(moduleParent({ contributes: { "desktop.widget": [{}] } })).toBeNull();
  });

  it("puts children right after their parent, and leaves an orphan where it was", () => {
    const parent = (i: { id: string }) => (i.id.startsWith("w") ? "home" : null);
    expect(nestChildren([{ id: "w1" }, { id: "a" }, { id: "home" }, { id: "w2" }, { id: "b" }], parent).map((x) => `${x.item.id}${x.child ? "*" : ""}`)).toEqual(["a", "home", "w1*", "w2*", "b"]);
    expect(nestChildren([{ id: "w1" }, { id: "a" }], parent).map((x) => x.child)).toEqual([false, false]);
  });
});

describe("presets", () => {
  const mods = [
    { id: "delegations", required: false, defaultOn: true },
    { id: "jobs", required: false, defaultOn: true },
    { id: "bookmarks", required: false, defaultOn: false },
    { id: "whatsapp", required: false, defaultOn: false },
    { id: "conversation", required: true, defaultOn: true },
  ];

  it("精简 keeps day-to-day modules (项目 / 存储 / 归档 / 审批 are required, out of any preset's reach)", () => {
    for (const id of ["projects", "storage", "archive", "approvals"]) expect(MODULES.find((m) => m.id === id)?.required).toBe(true);
    expect([...LEAN_MODULES].filter((id) => moduleMetadata(id)?.optional || !GROUPED_MODULE_IDS.includes(id))).toEqual([]);
    const on = new Set(["delegations", "jobs", "whatsapp"]);
    expect(presetChanges("lean", mods, (id) => on.has(id))).toEqual({ on: [], off: ["jobs"] });
  });

  it("never touches core or optional modules; 推荐 = defaults, 全部 = every one", () => {
    const off = () => false;
    expect(presetChanges("recommended", mods, off)).toEqual({ on: ["delegations", "jobs"], off: [] });
    expect(presetChanges("all", mods, off)).toEqual({ on: ["delegations", "jobs", "bookmarks"], off: [] });
    const on = new Set(["delegations", "jobs", "whatsapp"]);
    expect(currentPreset(mods, (id) => on.has(id))).toBe("recommended");
  });

  it("keeps on what a module staying on needs, an optional one the owner turned on included", () => {
    const withDeps = [...mods, { id: "notes", required: false, defaultOn: true, requires: ["bookmarks"] }];
    expect(presetChanges("recommended", withDeps, () => false).on).toEqual(["delegations", "jobs", "bookmarks", "notes"]);
    expect(moduleDependents(withDeps).get("bookmarks")).toEqual(["notes"]);
    // WhatsApp (optional, on) needs the browser: 精简 does not turn the browser off.
    const wa = [{ id: "browser", required: false, defaultOn: true }, { id: "whatsapp", required: false, defaultOn: false, requires: ["browser"] }];
    expect(presetChanges("lean", wa, () => true)).toEqual({ on: [], off: [] });
    expect(presetChanges("lean", wa, (id) => id === "browser")).toEqual({ on: [], off: ["browser"] });
  });

  it("plans one switch with what it takes: on = what it needs, off = the modules on that need it", () => {
    const chain = [
      { id: "home", required: false, defaultOn: true },
      { id: "world-clock", required: false, defaultOn: true, requires: ["home"] },
      { id: "running-agents", required: false, defaultOn: true, requires: ["home"] },
      { id: "x", required: false, defaultOn: true, requires: ["world-clock"] },
    ];
    const on = new Set(["home", "world-clock", "x"]);
    expect(switchPlan("home", false, chain, (id) => on.has(id))).toEqual(["home", "world-clock", "x"]);
    expect(switchPlan("running-agents", false, chain, (id) => on.has(id))).toEqual(["running-agents"]);
    expect(switchPlan("x", true, chain, () => false)).toEqual(["x", "world-clock", "home"]);
    expect(switchPlan("running-agents", true, chain, (id) => on.has(id))).toEqual(["running-agents"]);
  });

  it("declares the hard dependencies the study found", () => {
    const req = (id: string) => [...MODULES, ...packOnly.map((p) => p.def)].find((m) => m.id === id)?.requires?.modules ?? [];
    expect(req("claude-science")).toEqual(["browser"]);
    expect(req("whatsapp")).toEqual(["browser"]);
    expect(req("nci")).toEqual(["jobs"]);
    expect(req("world-clock")).toEqual(["home"]);
    expect(req("running-agents")).toEqual(["home"]);
  });
});

// ── the catalog ────────────────────────────────────────────────────────────────────────────────

type Lang = "zh-CN" | "en";
const DICT: Record<Lang, Record<string, string>> = {
  "zh-CN": { ...(zhCN as Record<string, string>), ...Object.assign({}, ...packOnly.map((p) => p.zh)) },
  en: { ...(en as Record<string, string>), ...Object.assign({}, ...packOnly.map((p) => p.en)) },
};
// Descriptions name a command's keys ({key}): the catalog says "its shortcut" (keys differ by platform and setting).
const KEY: Record<Lang, string> = { "zh-CN": "快捷键", en: "its shortcut" };
const text = (lang: Lang, key: string | undefined) => (key ? applyTerms(DICT[lang][key] ?? key, DEFAULT_TERMS[lang], lang).replaceAll("{key}", KEY[lang]) : "");

const WORDS: Record<Lang, Omit<Parameters<typeof catalogMarkdown>[1], "group" | "place">> = {
  "zh-CN": {
    heading: "模块目录",
    intro: [
      "<!-- 自动生成，勿手改：node apps/desktop/scripts/module-catalog.mjs。apps/desktop/test/moduleCatalog.test.ts 检查它和代码一致。 -->",
      "",
      "设置 → 模块里每个模块：做什么、出现在哪里、默认开不开、「精简」留不留。分组和顺序与设置页相同（shared/moduleGroups.ts），出现位置由模块登记的界面位置自动得出。回答「某个模块该不该开」时读这份。",
      "",
      "一键设置：「精简」只留日常工作要用的；「推荐」是每个模块自己的默认；「全部」打开所有已安装的模块。三者都不动核心模块和可选模块。",
    ],
    what: "做什么：",
    where: "出现在：",
    nowhere: "不单独出现（给其他功能提供数据）",
    default: "默认：",
    on: "开",
    off: "关",
    core: "核心，一直开着",
    keptOn: "必需，一直开着",
    because: "：",
    dependents: "被这些模块依赖：",
    partOf: "属于：",
    open: "（",
    close: "）",
    optional: "可选，随应用提供、默认关",
    optionalPack: "可选，未下载、不开启",
    lean: "「精简」：",
    leanYes: "留着",
    leanNo: "关掉",
    sep: "、",
  },
  en: {
    heading: "Module catalog",
    intro: [
      "<!-- Generated, do not edit: node apps/desktop/scripts/module-catalog.mjs. apps/desktop/test/moduleCatalog.test.ts checks it matches the code. -->",
      "",
      "Every module in Settings → Modules: what it does, where it shows up, whether it starts on, and whether Lean keeps it. Groups and order are the settings page's (shared/moduleGroups.ts); where a module shows up comes from the places it registers. Read this to answer \"should module X be on\".",
      "",
      "Quick setup: Lean keeps only what day-to-day work needs; Recommended is each module's own default; Everything turns on every installed module. None of them changes core or optional modules.",
    ],
    what: "What it does: ",
    where: "Shows up in: ",
    nowhere: "nothing of its own (serves other features)",
    default: "Default: ",
    on: "on",
    off: "off",
    core: "core, always on",
    keptOn: "required, always on",
    because: ": ",
    dependents: "Needed by: ",
    partOf: "Part of: ",
    open: " (",
    close: ")",
    optional: "optional, included with the app, off",
    optionalPack: "optional, not downloaded, off",
    lean: "Lean: ",
    leanYes: "kept",
    leanNo: "turned off",
    sep: ", ",
  },
};

function catalogFor(lang: Lang): string {
  const defs = [...MODULES, ...packOnly.map((p) => p.def)];
  const pack = new Set(packOnly.map((p) => p.def.id));
  const title = (id: string) => { const d = defs.find((m) => m.id === id); return d ? text(lang, d.titleKey) : id; };
  const dependents = moduleDependents(defs.map((d) => ({ id: d.id, requires: d.requires?.modules ?? [] })));
  const entries = moduleOrder(defs, (d) => ({ id: d.id, required: !!d.required, optionalOrPack: !!moduleMetadata(d.id)?.optional || pack.has(d.id) })).map((d) => {
    const optional = !d.required && !!moduleMetadata(d.id)?.optional;
    const parent = moduleParent(d);
    return {
      ...(parent ? { parent, parentTitle: title(parent) } : {}),
      id: d.id,
      title: text(lang, d.titleKey),
      description: text(lang, d.descriptionKey),
      // A child is listed under its parent, in the parent's group.
      group: parent ? moduleGroup(parent) : moduleGroup(d.id, !!d.required),
      places: modulePlaces(contributes(d)),
      required: !!d.required,
      defaultOn: !!d.required || (!optional && d.defaultEnabled !== false),
      optional,
      packOnly: pack.has(d.id),
      lean: LEAN_MODULES.has(d.id),
      keptOn: isKeptOn(d.id, !!d.required),
      keptReason: isKeptOn(d.id, !!d.required) ? text(lang, `modules.list.keptOn.${d.id}`) : undefined,
      dependents: (dependents.get(d.id) ?? []).filter((x) => moduleParent(defs.find((m) => m.id === x)!) !== d.id).map(title),
    };
  });
  const words = { ...WORDS[lang], group: (g: string) => text(lang, `modules.list.group.${g}`), place: (p: string) => text(lang, `modules.list.place.${p}`) };
  return catalogMarkdown(entries, words);
}

describe("module catalog (docs/module-catalog.*.md)", () => {
  for (const lang of ["zh-CN", "en"] as const) {
    it(`matches the code (${lang})`, () => {
      const file = join(DOCS, `module-catalog.${lang}.md`);
      const want = catalogFor(lang);
      if (process.env.MODULE_CATALOG_WRITE === "1") writeFileSync(file, want);
      expect(existsSync(file), `${file} is missing: run node apps/desktop/scripts/module-catalog.mjs`).toBe(true);
      expect(readFileSync(file, "utf8").replace(/\r\n/g, "\n"), "the module catalog is out of date: run node apps/desktop/scripts/module-catalog.mjs").toBe(want);
    });
  }
});
