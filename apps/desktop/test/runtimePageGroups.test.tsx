// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adaptRuntimes } from "../src/shared/runtimes";
const fx = vi.hoisted(() => ({ features: new Set<string>(), components: {} as Record<string, any>, open: vi.fn(), host: vi.fn(), locale: "zh-CN", view: null as any, data: null as any, ensureArchived: vi.fn() }));
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/runtimes/i18n");
  const { en } = await import("../src/renderer/src/modules/runtimes/i18n.en");
  const catalog: Record<string,string> = { ...zhCN, "dsh.ready": "已就绪", "dsh.notReady": "未就绪" };
  return { useI18n: () => ({ locale: fx.locale, t: (key: string, vars: Record<string,unknown> = {}) => ((fx.locale === "en" ? en[key as keyof typeof en] : catalog[key]) ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) }) };
});
vi.mock("../src/renderer/src/components/settings/Form", () => ({ Section: ({title, children}: any) => h("section",null,h("h2",null,title),children), Loading: () => h("p",null,"loading"), ErrorNote: ({children}: any) => h("p",null,children) }));
vi.mock("../src/renderer/src/components/Tag", () => ({ Tag: ({children}: any) => h("span", null, children) }));
vi.mock("../src/renderer/src/components/ComponentCard", () => ({ ComponentCard: ({hostId,name,state}: any) => h("div", {"data-install-host":hostId}, `${name}:${state.kind}:安装`) }));
vi.mock("../src/renderer/src/lib/componentView", () => ({ useComponentState: (_host: string, name: string) => ({ state: { kind: fx.components[name]?.state === "missing" ? "missing" : "body" }, entry: { list: { components: Object.values(fx.components) } } }), useHostComponents: () => ({ list: { components: Object.values(fx.components) } }) }));
vi.mock("../src/renderer/src/lib/runtimesStore", () => ({ useHostRuntimes: () => ({ view: fx.view, error: null }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "remote-host", useTargetFeatures: () => fx.features }));
// These presentation/legacy fixtures have no connected host snapshot or runtime-prune-v1.
// Keep cleanup unavailable without turning the narrow getState-only app stub into a live store.
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostData: () => fx.data }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: (s: unknown) => unknown) => select({ sidebar: fx.data?.sidebar }), { getState: () => ({ openSettings: fx.open, ensureArchived: fx.ensureArchived }) }) }));
vi.mock("../src/renderer/src/lib/settingsHost", () => ({ setSettingsHost: fx.host }));
import { RuntimeGroup } from "../src/renderer/src/components/RuntimeVersions";
import { RuntimesSection } from "../src/renderer/src/modules/runtimes/RuntimesSection";
import { DshRuntimeCard, DshRuntimeSettings } from "../src/renderer/src/components/DshRuntimeCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
beforeEach(() => { node=document.createElement("div");document.body.append(node);root=createRoot(node);fx.locale="zh-CN";fx.data=null;fx.ensureArchived.mockReset();fx.open.mockReset();fx.host.mockReset();fx.components={"dsh-runtime":{name:"dsh-runtime",state:"ready",selected:"0.2.1-rc.3",versions:[{version:"0.2.1-rc.3",pinnedBy:3}],dsh:{version:"0.2.1-rc.3",node:{minimum:"24.9.0",version:"24.21.0",ready:true}}},"claude-runtime":{name:"claude-runtime",state:"ready",claudeCli:{selected:"bundled",bundled:{version:"2.1.7"},system:{version:"2.1.9"}}}};fx.view=adaptRuntimes({native:[{release:"r260",version:"0.160.0-r52.4",selected:true,agentCount:0},{release:"r238",missing:true,agentCount:1},{release:"r35",agentCount:0}],claude:[{release:"claude-r29",selected:true,agentCount:2}]}); });
afterEach(async () => {await act(async()=>root.unmount());node.remove();});
it("keeps current and pinned/missing releases visible and folds only unused old versions", async () => {
  await act(async()=>root.render(h(RuntimeGroup,{kind:"native",title:"cute-codex",list:fx.view.native})));
  const details=node.querySelector("details")!;expect(details.open).toBe(false);expect(details.textContent).toContain("1 个旧版本未使用，可清理");expect(details.textContent).toContain("未知版本");expect(details.textContent).not.toContain("r260");expect(details.textContent).not.toContain("文件已删除");
  expect(node.querySelector("[data-runtime-cleanup]")).toBeNull();
  expect(node.textContent).toContain("0.160.0-r52.4");expect(node.querySelector("strong")!.className).not.toContain("truncate");
  await act(async()=>{details.open=true;});expect(details.open).toBe(true);
});
it("shows pinned names on demand and preserves long full version labels", async () => {
  const list=adaptRuntimes({native:[{release:"r52",version:"0.160.0-r52.4-long-release-label",selected:true,agents:[{cutexSessionId:"a",name:"Rei"}]}]})!.native;
  await act(async()=>root.render(h(RuntimeGroup,{kind:"native",title:"cute-codex",list})));
  const button=node.querySelector("button")!;expect(button.textContent).toContain("0.160.0-r52.4-long-release-label");expect(node.textContent).not.toContain("Rei");await act(async()=>button.click());expect(node.textContent).toContain("Rei");expect(button.getAttribute("aria-expanded")).toBe("true");
});
it("renders matching native/Claude groups with selected versions, Python and the actual CLI source", async () => {
  await act(async()=>root.render(h(RuntimesSection)));
  expect([...node.querySelectorAll("[data-runtime-group]")].map(e=>e.getAttribute("data-runtime-group"))).toEqual(["cute-codex","Claude"]);
  expect(node.textContent).toContain("内置 Python");expect(node.textContent).toContain("Claude CLI：内置 · 2.1.7");
  fx.components["claude-runtime"].claudeCli.selected="system";await act(async()=>root.render(h(RuntimesSection)));expect(node.textContent).toContain("Claude CLI：系统 · 2.1.9");
});
it("DSH reports readiness once, Node requirements and version usage, and links to the same host's new Profile", async () => {
  fx.features = new Set(["dsh-runtime"]);
  await act(async()=>root.render(h(DshRuntimeCard,{hostId:"remote-host"})));
  expect(node.querySelector('[data-runtime-group="DSH"]')).not.toBeNull();expect(node.textContent!.match(/已就绪/g)).toHaveLength(1);expect(node.textContent).toContain("Node ≥ 24.9.0 · 当前 24.21.0");expect(node.textContent).toContain("3 个");expect(node.textContent).toContain("DSH Profile（DeepSeek）");
  await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent?.includes("类型选 DSH"))!.click());expect(fx.open).toHaveBeenCalledWith("profiles",{create:true});expect(fx.host).toHaveBeenCalledWith("remote-host");
});
it("DSH stays in its group when absent and shows installation guidance", async () => {
  fx.components["dsh-runtime"]={name:"dsh-runtime",state:"missing",selected:null,versions:[]};await act(async()=>root.render(h(DshRuntimeCard,{hostId:"remote-host"})));
  expect(node.querySelector('[data-runtime-group="DSH"]')).not.toBeNull();expect(node.textContent).toContain("未安装");expect(node.querySelector('[data-install-host="remote-host"]')?.textContent).toContain("安装");expect(node.textContent).not.toContain("已就绪");
});
it("a missing Node is shown once as not ready without losing version usage", async () => {
  fx.components["dsh-runtime"].dsh.node={minimum:"24.9.0",version:null,ready:false};await act(async()=>root.render(h(DshRuntimeCard,{hostId:"remote-host"})));expect(node.textContent!.match(/未就绪/g)).toHaveLength(1);expect(node.textContent).not.toContain("已就绪");expect(node.textContent).toContain("当前 未知");
});
it("keeps the daemon-selected DSH default when version usage metadata is unavailable", async () => {
  fx.components["dsh-runtime"].versions=[];await act(async()=>root.render(h(DshRuntimeCard,{hostId:"remote-host"})));expect(node.querySelector("strong")?.textContent).toBe("0.2.1-rc.3");expect(node.textContent).not.toContain("0 个");
});
it("hides the entire DSH group without the capability, but shows installation guidance when supported", async () => {
  fx.features = new Set();
  await act(async()=>root.render(h(DshRuntimeSettings)));expect(node.textContent).toBe("");
  fx.features.add("dsh-runtime");fx.components["dsh-runtime"]={name:"dsh-runtime",state:"missing",selected:null,versions:[]};
  await act(async()=>root.render(h(DshRuntimeSettings)));expect(node.querySelector('[data-runtime-group="DSH"]')).not.toBeNull();expect(node.textContent).toContain("未安装");expect(node.querySelector('[data-install-host="remote-host"]')).not.toBeNull();
});

it.each(["zh-CN", "en"])("labels unregistered native SHAs in current and installed rows (%s), preserving Claude releases", async (locale) => {
  fx.locale = locale;
  fx.view = adaptRuntimes({native: [
    {release: "r52", version: null, sha256Prefix: "abc123def456", selected: true},
    {release: "missing-sha", sha256Prefix: "def456abc123", missing: true, agentCount: 1},
    {release: "unused-sha", sha256Prefix: "fed987cba654"},
  ], claude: [{release: "claude-r29", selected: true, sha256Prefix: "aaa111bbb222"}]});
  await act(async () => root.render(h(RuntimesSection)));
  const native = node.querySelector('[data-runtime-group="cute-codex"]')!;
  const unknown = locale === "en" ? "Unknown version" : "未知版本";
  expect(native.querySelector("strong")?.textContent).toBe(`${unknown} · abc123def456`);
  expect(native.querySelector("li")?.textContent).toContain(`${unknown} · abc123def456`);
  expect(native.textContent).toContain(`${unknown} · def456abc123`);
  expect(native.querySelector("details")?.textContent).toContain(`${unknown} · fed987cba654`);
  expect(native.textContent).not.toContain("r52");
  const claude = node.querySelector('[data-runtime-group="Claude"]')!;
  expect(claude.querySelector("strong")?.textContent).toBe("claude-r29");
  expect(claude.textContent).not.toContain(unknown);
  expect(claude.textContent).not.toContain("aaa111bbb222");
});
it("keeps known native versions with SHA metadata and handles old entries without it", async () => {
  fx.view = adaptRuntimes({native: [
    {release: "r52", version: "0.160.0-r52.4", selected: true, sha256Prefix: "abc123def456"},
    {release: "r51", missing: true, agentCount: 1},
  ]});
  await act(async () => root.render(h(RuntimesSection)));
  expect(node.querySelector("strong")?.textContent).toBe("0.160.0-r52.4");
  expect(node.textContent).not.toContain("abc123def456");
  expect(node.querySelectorAll("li")[1]?.textContent).toContain("未知版本");
  expect(node.textContent).not.toContain("undefined");
});
it("does not select a registry entry when the host reports no selected runtime", async () => {
  fx.view = adaptRuntimes({native: [{release: "r52", version: "0.160.0-r52.4"}]});
  await act(async () => root.render(h(RuntimesSection)));
  expect(node.querySelector('[data-runtime-group="cute-codex"] strong')).toBeNull();
  expect(node.textContent).toContain("未安装或未设置默认版本");
});

it("keeps expanded agent lists attached to the SHA when equal-release rows reorder", async () => {
  const entries = [
    {release: "r58", sha256Prefix: "aaa111bbb222", agentCount: 1, agents: [{cutexSessionId: "a", name: "Amy"}]},
    {release: "r58", sha256Prefix: "ccc333ddd444", agentCount: 1, agents: [{cutexSessionId: "b", name: "Bea"}]},
  ];
  const render = async (native: typeof entries) => {
    const list = adaptRuntimes({native})!.native;
    await act(async () => root.render(h(RuntimeGroup, {kind: "native", title: "cute-codex", list})));
  };
  await render(entries);
  await act(async () => node.querySelector("button")!.click());
  expect(node.querySelectorAll("li")[0]?.textContent).toContain("Amy");
  await render([...entries].reverse());
  const rows = node.querySelectorAll("li");
  expect(rows[0]?.textContent).toContain("ccc333ddd444");
  expect(rows[0]?.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
  expect(rows[1]?.textContent).toContain("aaa111bbb222");
  expect(rows[1]?.textContent).toContain("Amy");
  expect(rows[1]?.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
});

it("r270 fresh host: component-index-v1 + the dsh-runtime row show the DSH group (install guidance), without the Profile link", async () => {
  fx.features = new Set(["components", "component-index-v1"]);
  fx.components["dsh-runtime"] = { name: "dsh-runtime", state: "missing", selected: null, versions: [] };
  await act(async () => root.render(h(DshRuntimeSettings)));
  expect(node.querySelector('[data-runtime-group="DSH"]')).not.toBeNull();
  expect(node.querySelector('[data-install-host="remote-host"]')?.textContent).toContain("dsh-runtime:missing");
  expect(node.textContent).not.toContain("类型选 DSH");
  // Without the index gate (an r269-style host lacking dsh-runtime): nothing, as before.
  fx.features = new Set(["components"]);
  await act(async () => root.render(h(DshRuntimeSettings)));
  expect(node.textContent).toBe("");
  // No row for it: nothing either.
  fx.features = new Set(["components", "component-index-v1"]);
  delete fx.components["dsh-runtime"];
  await act(async () => root.render(h(DshRuntimeSettings)));
  expect(node.textContent).toBe("");
});

it("a Node range reported as the minimum is not shown as ≥ >=… (live r270: >=24.9.0 <25)", async () => {
  fx.features = new Set(["dsh-runtime"]);
  fx.components["dsh-runtime"].dsh.node = { minimum: ">=24.9.0 <25", version: null, ready: true };
  await act(async () => root.render(h(DshRuntimeCard, { hostId: "remote-host" })));
  expect(node.textContent).toContain("Node ≥ 24.9.0, < 25 · 当前 未知");
  expect(node.textContent).not.toContain(">=");
});

// r270 ae9cced9 (Wren's real HTTP bodies, test/fixtures/component-external-ui-v1.ae9cced9.json): minimum is a plain version
// again, the full range comes from node.range / external.nodeRange, the version only as cutex observed it.
it("ae9cced9: the full range from node.range and the observed version (one ≥, never the recommendation)", async () => {
  const { readComponentsList } = await import("../src/shared/components");
  const ae = (await import("./fixtures/component-external-ui-v1.ae9cced9.json")).default;
  fx.features = new Set(["dsh-runtime"]);
  const [dsh] = readComponentsList({ managed: true, installFrom: "source-only", components: [{ name: "dsh-runtime", supported: true, state: "ready", selected: "dsh-r3", available: null, origin: "signed", versions: [{ version: "dsh-r3", pinnedBy: 0 }], error: null, dsh: { version: "0.2.1-rc.3", node: ae.dshNode }, external: ae.dshExternal }] }).components;
  expect(dsh!.nodeRange).toBe(">=24.9.0 <25");
  expect(dsh!.external!.nodeVersion).toBe("v24.21.0");
  fx.components["dsh-runtime"] = dsh;
  await act(async () => root.render(h(DshRuntimeCard, { hostId: "remote-host" })));
  expect(node.querySelector("[data-runtime-node]")!.textContent).toBe("Node ≥ 24.9.0, < 25 · 当前 v24.21.0");
  fx.locale = "en";
  await act(async () => root.render(h(DshRuntimeCard, { hostId: "remote-host" })));
  expect(node.querySelector("[data-runtime-node]")!.textContent).toBe("Node ≥ 24.9.0, < 25 · current v24.21.0");
});

it("ae9cced9: external.nodeRange / nodeVersion when the legacy detail has none; unknown version is 未知, not nodeRecommended", async () => {
  const ae = (await import("./fixtures/component-external-ui-v1.ae9cced9.json")).default;
  fx.features = new Set(["dsh-runtime"]);
  fx.components["dsh-runtime"].dsh.node = { minimum: "24.9.0", version: null, ready: true };
  fx.components["dsh-runtime"].external = ae.dshExternal;
  await act(async () => root.render(h(DshRuntimeCard, { hostId: "remote-host" })));
  expect(node.querySelector("[data-runtime-node]")!.textContent).toBe("Node ≥ 24.9.0, < 25 · 当前 v24.21.0");
  const { nodeVersion: _v, ...unobserved } = ae.dshExternal;
  fx.components["dsh-runtime"].external = unobserved;
  await act(async () => root.render(h(DshRuntimeCard, { hostId: "remote-host" })));
  expect(node.querySelector("[data-runtime-node]")!.textContent).toBe("Node ≥ 24.9.0, < 25 · 当前 未知");
  expect(node.textContent).not.toContain("24.21.0");
  // No range anywhere: the plain minimum, once.
  delete fx.components["dsh-runtime"].external;
  await act(async () => root.render(h(DshRuntimeCard, { hostId: "remote-host" })));
  expect(node.querySelector("[data-runtime-node]")!.textContent).toBe("Node ≥ 24.9.0 · 当前 未知");
});

it("Kimi: the same Node line (range from external, observed version)", async () => {
  const ae = (await import("./fixtures/component-external-ui-v1.ae9cced9.json")).default;
  fx.features = new Set(["kimi-runtime"]);
  fx.components["kimi-runtime"] = { name: "kimi-runtime", state: "ready", selected: "kimi-r3", versions: [], kimi: { version: "kimi-r3", node: { minimum: "24.9.0", version: null, ready: true } }, external: { ...ae.dshExternal, version: "kimi-r3", nodeVersion: "v24.10.0" } };
  const { AcpRuntimeCard } = await import("../src/renderer/src/components/DshRuntimeCard");
  await act(async () => root.render(h(AcpRuntimeCard, { runtime: "kimi", hostId: "remote-host" })));
  expect(node.querySelector("[data-runtime-node]")!.textContent).toBe("Node ≥ 24.9.0, < 25 · 当前 v24.10.0");
});

describe("version rows: active and archived agents apart", () => {
  const session = (id: string, lifecycle = "active") => ({ cutexSessionId: id, displayName: id, lifecycle });
  const lists = (over: Record<string, unknown> = {}) => ({ active: [session("amy"), session("bea")], retired: [session("old-1", "retired"), session("old-2", "retired")], ...over });
  const pin = (...ids: string[]) => ({ agents: ids.map(id => ({ cutexSessionId: id, name: id.toUpperCase() })) });
  const draw = async (claude: unknown[], sidebar: unknown) => {
    fx.data = { daemon: { kind: "disconnected" }, features: new Set(), sidebar };
    const list = adaptRuntimes({ claude } as never)!.claude;
    await act(async () => root.render(h(RuntimeGroup, { kind: "claude", title: "Claude", list })));
  };
  const row = () => node.querySelector("li")!;
  const headline = () => row().querySelector("button")!.textContent!;
  it("a version held only by archived agents says so instead of counting them as agents on it", async () => {
    await draw([{ release: "claude-r29", ...pin("old-1", "old-2") }], lists());
    expect(headline()).toContain("2 个已归档");
    expect(row().querySelector("[data-tip]")?.getAttribute("data-tip")).toContain("不代表没升级");
    await act(async () => row().querySelector("button")!.click());
    const part = row().querySelector<HTMLDetailsElement>("[data-archived-agents]")!;
    expect(part.open).toBe(false);
    expect(part.querySelector("summary")!.textContent).toContain("已归档的");
    expect(part.querySelector("summary")!.textContent).toContain("（2）");
    expect(part.textContent).toContain("OLD-1");
    expect(row().querySelector("p:not([data-archived-agents] p)")).toBeNull();
  });
  it("a mixed version counts them apart: active names in the row, archived names only in the collapsed part", async () => {
    await draw([{ release: "claude-r35", ...pin("amy", "old-1", "bea") }], lists());
    expect(headline()).toContain("2 个");
    expect(headline()).toContain("1 个已归档");
    expect(headline()).not.toContain("3 个");
    await act(async () => row().querySelector("button")!.click());
    const names = row().querySelector("p")!;
    expect(names.textContent).toContain("AMY");
    expect(names.textContent).toContain("BEA");
    expect(names.textContent).not.toContain("OLD-1");
    expect(row().querySelector("[data-archived-agents]")!.textContent).toContain("OLD-1");
  });
  it("active-only versions read as before, with no archived part or hint", async () => {
    await draw([{ release: "claude-r42", ...pin("amy", "bea") }], lists());
    expect(headline()).not.toContain("已归档");
    expect(row().querySelector("[data-tip]")).toBeNull();
    await act(async () => row().querySelector("button")!.click());
    expect(row().querySelector("[data-archived-agents]")).toBeNull();
    expect(row().querySelector("p")!.textContent).toContain("AMY");
  });
  it("while archived agents are unread nobody is called archived, and showing the list asks for them", async () => {
    const pending = lists({ retired: [], partial: true, archivedPending: { count: 2 } });
    await draw([{ release: "claude-r29", ...pin("old-1", "old-2") }], pending);
    expect(headline()).toContain("2 个");
    expect(headline()).not.toContain("已归档");
    expect(fx.ensureArchived).toHaveBeenCalledWith("remote-host");
    await draw([{ release: "claude-r29", ...pin("old-1", "old-2") }], lists());
    expect(headline()).toContain("2 个已归档");
  });
  it("an agent the lists don't have (hidden) and pins sent only as a count are not called archived", async () => {
    await draw([{ release: "claude-r35", agentCount: 4, ...pin("ghost", "old-1") }], lists());
    expect(headline()).toContain("3 个");
    expect(headline()).toContain("1 个已归档");
    await act(async () => row().querySelector("button")!.click());
    expect(row().querySelector("p")!.textContent).toContain("GHOST");
    expect(row().querySelector("p")!.textContent).toContain("还有 2 个");
  });
  it("in English too", async () => {
    fx.locale = "en";
    await draw([{ release: "claude-r29", ...pin("old-1") }], lists());
    expect(headline()).toMatch(/Archived .*: 1$/);
    await draw([{ release: "claude-r35", ...pin("amy", "old-1") }], lists());
    expect(headline()).toMatch(/: 1 · archived: 1$/);
  });
});
