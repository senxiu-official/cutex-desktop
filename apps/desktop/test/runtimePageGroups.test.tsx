// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adaptRuntimes } from "../src/shared/runtimes";
const fx = vi.hoisted(() => ({ features: new Set<string>(), components: {} as Record<string, any>, open: vi.fn(), host: vi.fn(), view: null as any }));
vi.mock("../src/renderer/src/i18n", async () => {
  const { zhCN } = await import("../src/renderer/src/modules/runtimes/i18n");
  const catalog: Record<string,string> = { ...zhCN, "dsh.ready": "已就绪", "dsh.notReady": "未就绪" };
  return { useI18n: () => ({ locale: "zh-CN", t: (key: string, vars: Record<string,unknown> = {}) => (catalog[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) }) };
});
vi.mock("../src/renderer/src/components/settings/Form", () => ({ Section: ({title, children}: any) => h("section",null,h("h2",null,title),children), Loading: () => h("p",null,"loading"), ErrorNote: ({children}: any) => h("p",null,children) }));
vi.mock("../src/renderer/src/components/Tag", () => ({ Tag: ({children}: any) => h("span", null, children) }));
vi.mock("../src/renderer/src/components/ComponentCard", () => ({ ComponentCard: ({hostId,name,state}: any) => h("div", {"data-install-host":hostId}, `${name}:${state.kind}:安装`) }));
vi.mock("../src/renderer/src/lib/componentView", () => ({ useComponentState: (_host: string, name: string) => ({ state: { kind: fx.components[name]?.state === "missing" ? "missing" : "body" }, entry: { list: { components: Object.values(fx.components) } } }) }));
vi.mock("../src/renderer/src/lib/runtimesStore", () => ({ useHostRuntimes: () => ({ view: fx.view, error: null }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetHostId: () => "remote-host", useTargetFeatures: () => fx.features }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ openSettings: fx.open }) } }));
vi.mock("../src/renderer/src/lib/settingsHost", () => ({ setSettingsHost: fx.host }));
import { RuntimeGroup } from "../src/renderer/src/components/RuntimeVersions";
import { RuntimesSection } from "../src/renderer/src/modules/runtimes/RuntimesSection";
import { DshRuntimeCard, DshRuntimeSettings } from "../src/renderer/src/components/DshRuntimeCard";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement, root: Root;
beforeEach(() => { node=document.createElement("div");document.body.append(node);root=createRoot(node);fx.open.mockReset();fx.host.mockReset();fx.components={"dsh-runtime":{name:"dsh-runtime",state:"ready",selected:"0.2.1-rc.3",versions:[{version:"0.2.1-rc.3",pinnedBy:3}],dsh:{version:"0.2.1-rc.3",node:{minimum:"24.9.0",version:"24.21.0",ready:true}}},"claude-runtime":{name:"claude-runtime",state:"ready",claudeCli:{selected:"bundled",bundled:{version:"2.1.7"},system:{version:"2.1.9"}}}};fx.view=adaptRuntimes({native:[{release:"r260",version:"0.160.0-r52.4",selected:true,agentCount:0},{release:"r238",missing:true,agentCount:1},{release:"r35",agentCount:0}],claude:[{release:"claude-r29",selected:true,agentCount:2}]}); });
afterEach(async () => {await act(async()=>root.unmount());node.remove();});
it("keeps current and pinned/missing releases visible and folds only unused old versions", async () => {
  await act(async()=>root.render(h(RuntimeGroup,{title:"cute-codex",list:fx.view.native})));
  const details=node.querySelector("details")!;expect(details.open).toBe(false);expect(details.textContent).toContain("1 个旧版本未使用，可清理");expect(details.textContent).toContain("r35");expect(details.textContent).not.toContain("r260");expect(details.textContent).not.toContain("r238");
  expect(node.textContent).toContain("0.160.0-r52.4");expect(node.querySelector("strong")!.className).not.toContain("truncate");
  await act(async()=>{details.open=true;});expect(details.open).toBe(true);
});
it("shows pinned names on demand and preserves long full version labels", async () => {
  const list=adaptRuntimes({native:[{release:"r52",version:"0.160.0-r52.4-long-release-label",selected:true,agents:[{cutexSessionId:"a",name:"Rei"}]}]})!.native;
  await act(async()=>root.render(h(RuntimeGroup,{title:"cute-codex",list})));
  const button=node.querySelector("button")!;expect(button.textContent).toContain("0.160.0-r52.4-long-release-label");expect(node.textContent).not.toContain("Rei");await act(async()=>button.click());expect(node.textContent).toContain("Rei");expect(button.getAttribute("aria-expanded")).toBe("true");
});
it("renders matching native/Claude groups with selected versions, Python and the actual CLI source", async () => {
  await act(async()=>root.render(h(RuntimesSection)));
  expect([...node.querySelectorAll("[data-runtime-group]")].map(e=>e.getAttribute("data-runtime-group"))).toEqual(["cute-codex","Claude"]);
  expect(node.textContent).toContain("内置 Python");expect(node.textContent).toContain("Claude CLI：内置 · 2.1.7");
  fx.components["claude-runtime"].claudeCli.selected="system";await act(async()=>root.render(h(RuntimesSection)));expect(node.textContent).toContain("Claude CLI：系统 · 2.1.9");
});
it("DSH reports readiness once, Node requirements and version usage, and links to the same host's new Profile", async () => {
  await act(async()=>root.render(h(DshRuntimeCard,{hostId:"remote-host"})));
  expect(node.querySelector('[data-runtime-group="DSH"]')).not.toBeNull();expect(node.textContent!.match(/已就绪/g)).toHaveLength(1);expect(node.textContent).toContain("Node ≥ 24.9.0 · 当前 24.21.0");expect(node.textContent).toContain("3 个");expect(node.textContent).toContain("DSH Profile（DeepSeek）");
  await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent?.includes("类型选 DSH"))!.click());expect(fx.open).toHaveBeenCalledWith("profiles",{create:true});expect(fx.host).toHaveBeenCalledWith("remote-host");
});
it("DSH stays in its group when absent and shows installation guidance", async () => {
  fx.components["dsh-runtime"]={name:"dsh-runtime",state:"missing",selected:null,versions:[]};await act(async()=>root.render(h(DshRuntimeCard,{hostId:"remote-host"})));
  expect(node.querySelector('[data-runtime-group="DSH"]')).not.toBeNull();expect(node.textContent).toContain("未安装");expect(node.querySelector('[data-install-host="remote-host"]')?.textContent).toContain("安装");expect(node.textContent).not.toContain("已就绪");
});
it("a missing Node is shown once as not ready without losing version usage", async () => {
  fx.components["dsh-runtime"].dsh.node={minimum:"24.9.0",version:null,ready:false};await act(async()=>root.render(h(DshRuntimeCard,{hostId:"remote-host"})));expect(node.textContent!.match(/未就绪/g)).toHaveLength(1);expect(node.textContent).not.toContain("已就绪");expect(node.textContent).toContain("当前 —");
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
