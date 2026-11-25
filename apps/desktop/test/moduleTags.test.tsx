// @vitest-environment jsdom
// Settings → 模块 → 全部模块 (owner 2026-11-24): one tag order (origin chip → version text → trust / risk / state chips),
// versions from the module or the app, each tag the settings ScopeChip (a click floats its explanation), core rows a
// locked switch, and the list's search / filter / sort.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import type { PackRow } from "../src/renderer/src/modules/packs";
import type { InstalledPackView } from "../src/shared/modulePacks";
import { matchesModule, moduleFacts, noteInstalled, sortModules, type ModuleFacts, type ModuleListItem } from "../src/renderer/src/modules/moduleTags";
import { ModuleTags } from "../src/renderer/src/modules/shell/ModulePacks";
import { I18nProvider } from "../src/renderer/src/i18n";
import { zhCN, en, zhHant } from "../src/renderer/src/modules/moduleTagsMessages";
import { devBuildsRunning } from "../src/renderer/src/modules/devRunning";

const installed = (version: string, extra: Partial<InstalledPackView> = {}): InstalledPackView => ({ id: "pilot", version, moduleApi: "^1.16", compat: "ok", entry: "x", styles: [], host: {}, ...extra });
const row = (r: Partial<PackRow>): PackRow => ({ id: "pilot", bundled: false, bundledVersion: null, installed: null, activeVersion: null, decision: null, broken: null, offer: null, others: [], operation: null, error: null, available: [], ...r });
const avail = (version: string) => ({ id: "pilot", version, moduleApi: "^1.16", compat: "ok" as const, size: 1 });

describe("moduleFacts", () => {
  it("core and bundled modules carry the app's version; no version while it is unknown", () => {
    expect(moduleFacts({ required: true, pack: null, appVersion: "0.2.4" })).toEqual({ origin: "core", version: "0.2.4", versionOf: "app", tags: [] });
    expect(moduleFacts({ required: false, pack: null, appVersion: "0.2.4" })).toEqual({ origin: "bundled", version: "0.2.4", versionOf: "app", tags: [] });
    expect(moduleFacts({ required: false, pack: row({ bundled: true }), appVersion: "c20812e" })).toMatchObject({ origin: "bundled", version: "c20812e", versionOf: "app" });
    expect(moduleFacts({ required: true, pack: null, appVersion: null })).toEqual({ origin: "core", version: null, versionOf: null, tags: [] });
  });

  it("a bundled module with its own pack version (Claude Science) shows that version; a newer download in use is 已下载", () => {
    expect(moduleFacts({ required: false, pack: row({ bundled: true, bundledVersion: "1.0.0" }), appVersion: "0.2.4" })).toEqual({ origin: "bundled", version: "1.0.0", versionOf: "module", tags: [] });
    const p = row({ bundled: true, bundledVersion: "1.0.0", installed: installed("1.1.0"), activeVersion: "1.1.0", decision: { use: true, version: "1.1.0" } });
    expect(moduleFacts({ required: false, pack: p, appVersion: "0.2.4" })).toEqual({ origin: "downloaded", version: "1.1.0", versionOf: "module", tags: [] });
  });

  it("a local module: 本地安装 + its version + 未验证, 内部接口 when it reads app internals, 实验接口 for the experimental entry", () => {
    const local = installed("1.2.0", { local: true, host: { "@cutex-desktop/app/lib/agentLook": ["useAgentLook"], "@cutex-desktop/module-api/experimental": ["x"] } });
    const f = moduleFacts({ required: false, pack: row({ installed: local, activeVersion: "1.2.0", decision: { use: true, version: "1.2.0" } }), appVersion: "0.2.4" });
    expect(f).toMatchObject({ origin: "local", version: "1.2.0", versionOf: "module" });
    expect(f.tags.map((t) => [t.kind, t.tone])).toEqual([["unverified", "warn"], ["internal", "warn"], ["experimental", "warn"]]);
    const pub = moduleFacts({ required: false, pack: row({ installed: installed("1.2.0", { local: true, host: { "@cutex-desktop/module-api": ["x"] } }), activeVersion: "1.2.0" }), appVersion: null });
    expect(pub.tags.map((t) => t.kind)).toEqual(["unverified"]);
  });

  it("an installed copy not in use keeps the version it is about in a state tag", () => {
    const bundled = { bundled: true, bundledVersion: "1.0.0" };
    const tagsOf = (reason: "notNewer" | "needsNewerApp" | "needsNewerModule" | "failed") =>
      moduleFacts({ required: false, pack: row({ ...bundled, installed: installed("0.9.0"), decision: { use: false, reason, detail: "boom", version: "0.9.0" } }), appVersion: "0.2.4" });
    expect(tagsOf("notNewer")).toMatchObject({ origin: "bundled", version: "1.0.0", tags: [{ kind: "notNewer", tone: "plain", version: "0.9.0" }] });
    expect(tagsOf("needsNewerApp").tags).toEqual([{ kind: "needsNewerApp", tone: "warn", version: "0.9.0" }]);
    expect(tagsOf("needsNewerModule").tags).toEqual([{ kind: "needsNewerModule", tone: "warn", version: "0.9.0" }]);
    expect(tagsOf("failed").tags).toEqual([{ kind: "failed", tone: "danger", version: "0.9.0", error: "boom" }]);
    // A local file on a bundled module is never used (notPackable): no state tag beyond its trust.
    const np = moduleFacts({ required: false, pack: row({ ...bundled, installed: installed("2.0.0", { local: true }), decision: { use: false, reason: "notPackable", version: "2.0.0" } }), appVersion: "0.2.4" });
    expect(np.tags.map((t) => t.kind)).toEqual(["unverified"]);
  });

  it("a developer-folder build: 本地安装 with its own version, 未验证, and its interface risks", () => {
    const f = moduleFacts({ required: false, pack: row({ bundled: true }), appVersion: "0.2.4", dev: { version: "1.2.3", host: { "@app/store": ["useApp"], "@cutex-desktop/module-api/experimental": ["x"] } } });
    expect(f).toEqual({ origin: "local", version: "1.2.3", versionOf: "module", tags: [{ kind: "unverified", tone: "warn" }, { kind: "internal", tone: "warn" }, { kind: "experimental", tone: "warn" }] });
    expect(moduleFacts({ required: true, pack: null, appVersion: "0.2.4", dev: { version: "1", host: {} } }).origin).toBe("core");
  });

  it("pack-only: 可下载 with the newest offered version; a damaged copy is 已安装 · 未验证 · 已损坏, never 已下载", () => {
    expect(moduleFacts({ required: false, pack: row({ available: [avail("0.3.0"), avail("0.2.0")] }), appVersion: "0.2.4" })).toEqual({ origin: "available", version: "0.3.0", versionOf: "module", tags: [] });
    expect(moduleFacts({ required: false, pack: row({}), appVersion: "0.2.4" })).toEqual({ origin: "available", version: null, versionOf: null, tags: [] });
    expect(moduleFacts({ required: false, pack: row({ broken: { version: "1.0.1", error: "hash" } }), appVersion: "0.2.4" })).toEqual({
      origin: "installed", version: "1.0.1", versionOf: "module", tags: [{ kind: "unverified", tone: "warn" }, { kind: "broken", tone: "danger", version: "1.0.1", error: "hash" }],
    });
  });
});

describe("devBuildsRunning", () => {
  const dev = (rev: number, over: Record<string, unknown> = {}) => ({ folder: "D:/w/x", id: "x", version: `${rev}.0.0`, moduleApi: "^1.31", rev, entry: `e${rev}`, styles: [], host: {}, error: null, ...over });
  const view = (...modules: ReturnType<typeof dev>[]) => ({ enabled: true, internal: true, skipped: false, modules });
  it("with a loader: only its record, whatever main's view names", () => {
    const run = { folder: "D:/w/x", rev: 1, version: "1.0.0", host: {} };
    expect([...devBuildsRunning(view(dev(2)), { started: true, byId: new Map([["x", run]]) })]).toEqual([["x", run]]);
    expect(devBuildsRunning(view(dev(2)), { started: true, byId: new Map() }).size).toBe(0);
  });
  it("a record counts only while the host's definition under its id is the build's own", () => {
    const mine = { id: "x" };
    const run = { folder: "D:/w/x", rev: 1, version: "1.0.0", host: {}, module: mine };
    const snap = { started: true, byId: new Map([["x", run]]) };
    expect(devBuildsRunning(null, snap, [mine]).get("x")).toBe(run);
    expect(devBuildsRunning(null, snap, [{ id: "x" }]).size).toBe(0);
    expect(devBuildsRunning(null, snap, []).size).toBe(0);
  });
  it("without one: the last build main reported clean; an erroring build on first sight runs nothing", () => {
    const none = { started: false, byId: new Map() };
    expect(devBuildsRunning(view(dev(1, { folder: "D:/w/y", error: "id taken" })), none).size).toBe(0);
    expect(devBuildsRunning(view(dev(1)), none).get("x")).toMatchObject({ rev: 1, version: "1.0.0" });
    expect(devBuildsRunning(view(dev(2, { error: "activate threw" })), none).get("x")).toMatchObject({ rev: 1, version: "1.0.0" });
    expect(devBuildsRunning(view(dev(2, { id: "other", error: "boom" })), none).size).toBe(0);
  });
});

describe("list toolbar", () => {
  const facts = (origin: ModuleFacts["origin"], tags: ModuleFacts["tags"] = []): ModuleFacts => ({ origin, version: "1", versionOf: "app", tags });
  const items: ModuleListItem[] = [
    { id: "shell", title: "应用外壳", detail: "管理通用设置", facts: facts("core"), enabled: true, hasUpdate: false, installedAt: null },
    { id: "browser", title: "Browser", facts: facts("bundled"), enabled: false, hasUpdate: false, installedAt: null },
    { id: "desk-pet", title: "Desk pet", facts: facts("local", [{ kind: "unverified", tone: "warn" }]), enabled: true, hasUpdate: true, installedAt: 200 },
    { id: "claude-science", title: "Claude Science", facts: facts("downloaded"), enabled: false, hasUpdate: false, installedAt: 100 },
  ];
  const ids = (filter: Parameters<typeof matchesModule>[2], q = "") => items.filter((i) => matchesModule(i, q, filter)).map((i) => i.id);

  it("filters by state, origin, update and trust; searches name, description and id", () => {
    expect(ids("all")).toHaveLength(4);
    expect(ids("enabled")).toEqual(["shell", "desk-pet"]);
    expect(ids("disabled")).toEqual(["browser", "claude-science"]);
    expect(ids("core")).toEqual(["shell"]);
    expect(ids("bundled")).toEqual(["browser"]);
    expect(ids("installed")).toEqual(["desk-pet", "claude-science"]);
    expect(ids("update")).toEqual(["desk-pet"]);
    expect(ids("unverified")).toEqual(["desk-pet"]);
    expect(ids("all", " 通用 ")).toEqual(["shell"]);
    expect(ids("all", "SCIENCE")).toEqual(["claude-science"]);
    expect(ids("all", "desk-")).toEqual(["desk-pet"]);
    expect(ids("core", "browser")).toEqual([]);
  });

  it("sorts stably: default keeps the order, name by title, recent newest install first", () => {
    expect(sortModules(items, "default", "en").map((i) => i.id)).toEqual(["shell", "browser", "desk-pet", "claude-science"]);
    expect(sortModules(items, "name", "en").map((i) => i.id)).toEqual(["browser", "claude-science", "desk-pet", "shell"]);
    expect(sortModules(items, "recent", "en").map((i) => i.id)).toEqual(["desk-pet", "claude-science", "shell", "browser"]);
  });

  it("remembers when this desktop first saw each installed version", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(noteInstalled([{ id: "a", version: "1.0.0" }], 10, storage)).toEqual({ a: 10 });
    expect(noteInstalled([{ id: "a", version: "1.0.0" }, { id: "b", version: "2.0.0" }], 20, storage)).toEqual({ a: 10, b: 20 });
    expect(noteInstalled([{ id: "a", version: "1.1.0" }], 30, storage)).toEqual({ a: 30 });
    expect(JSON.parse(data.get("cutex.modules.seen")!)).toEqual({ a: { version: "1.1.0", at: 30 } });
    data.set("cutex.modules.seen", "{not json");
    expect(noteInstalled([{ id: "a", version: "1.1.0" }], 40, storage)).toEqual({ a: 40 });
    expect(noteInstalled([{ id: "a", version: "1.0.0" }], 50, null)).toEqual({ a: 50 });
    // Not loaded yet (null): read only, nothing pruned or stamped.
    data.set("cutex.modules.seen", JSON.stringify({ a: { version: "1.1.0", at: 30 } }));
    expect(noteInstalled(null, 60, storage)).toEqual({ a: 30 });
    expect(JSON.parse(data.get("cutex.modules.seen")!)).toEqual({ a: { version: "1.1.0", at: 30 } });
  });
});

describe("ModuleTags", () => {
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    document.body.innerHTML = "";
  });
  const render = (facts: ModuleFacts, packable = false) => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(h(I18nProvider, null, h(ModuleTags, { facts, packable }))));
    return host;
  };

  it("origin chip, then the version as its own muted text, then the other tags; each chip opens its explanation", () => {
    const el = render({ origin: "local", version: "1.2.0", versionOf: "module", tags: [{ kind: "unverified", tone: "warn" }, { kind: "internal", tone: "warn" }] });
    const order = [...el.querySelectorAll("[data-module-tag], [data-module-version]")].map((e) => (e as HTMLElement).dataset.moduleTag ?? `v:${(e as HTMLElement).dataset.moduleVersion}`);
    expect(order).toEqual(["local", "v:module", "unverified", "internal"]);
    const version = el.querySelector("[data-module-version]")!;
    expect(version.textContent).toBe("v1.2.0");
    expect(version.closest("button")).toBeNull();
    expect(el.querySelector("[data-module-tag=local] button")!.textContent).not.toContain("1.2.0");
    act(() => (el.querySelector("[data-module-tag=internal] button") as HTMLButtonElement).click());
    const pop = document.querySelector("[data-popover]")!;
    expect(pop).not.toBeNull();
    expect([zhCN["modules.tag.internal.title"], en["modules.tag.internal.title"]].some((x) => pop.textContent!.includes(x))).toBe(true);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector("[data-popover]")).toBeNull();
  });

  it("an app commit (source build) is shown without the v; no version → no version text", () => {
    expect(render({ origin: "core", version: "c20812e", versionOf: "app", tags: [] }).querySelector("[data-module-version]")!.textContent).toBe("c20812e");
    act(() => root?.unmount());
    expect(render({ origin: "core", version: "89c3643", versionOf: "app", tags: [] }).querySelector("[data-module-version]")!.textContent).toBe("89c3643");
    act(() => root?.unmount());
    expect(render({ origin: "core", version: null, versionOf: null, tags: [] }).querySelector("[data-module-version]")).toBeNull();
  });

  it("a bundled module with its own version explains that it can be updated on its own", () => {
    const el = render({ origin: "bundled", version: "1.0.0", versionOf: "module", tags: [] }, true);
    act(() => (el.querySelector("[data-module-tag=bundled] button") as HTMLButtonElement).click());
    const text = document.querySelector("[data-popover]")!.textContent!;
    expect([zhCN["modules.tag.bundledPack.body"], en["modules.tag.bundledPack.body"]].some((x) => text.includes(x))).toBe(true);
  });
});

describe("modules page wiring", () => {
  const SRC = join(__dirname, "../src/renderer/src");
  const page = readFileSync(join(SRC, "modules/shell/ModulesPage.tsx"), "utf8");
  it("core rows show only a lock (no disabled switch); the toolbar sits in the list-filter style", () => {
    expect(page).toMatch(/data-module-locked[^>]*>\s*<Lock[^>]*\/>\s*<\/span>/);
    expect(page).not.toMatch(/<Toggle[^>]*checked disabled/);
    expect(page).toContain('data-settings-list-filter=""');
    expect(page).toContain("<ModuleTags facts={item.facts}");
  });
  it("ships every message in zh-CN, en and zh-Hant", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
    expect(Object.keys(zhHant).sort()).toEqual(Object.keys(zhCN).sort());
  });
});
