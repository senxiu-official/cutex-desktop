// @vitest-environment jsdom
// r269 UI (contract frozen, shared/componentIndex.ts): the needsUser card with external-install guidance (copy, per-platform
// commands, path form, 重新检测; checkedAt null = unverified), and the panel: signed-index offers (update / needs cutex / not for
// this host / yank incl. selectedYanked / pins / source / stale / 检查更新 with indexOperation), a staged adapter candidate while
// the bundled version stays selected, and the terminal outcome (done never means selected); gates off → nothing new.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPONENT_INDEX_FEATURE, COMPONENTS_FEATURE, EXTERNAL_ISSUE_CODES, EXTERNAL_RUNTIME_ROOT_FEATURE, type ComponentExternal, type ComponentStatus } from "../src/shared/components";
import { componentCardState, type ComponentCardState } from "../src/renderer/src/lib/componentCard";
import type { HostComponents } from "../src/renderer/src/lib/componentStore";
import type { HostPlatform } from "../src/shared/hosts";

const env = vi.hoisted(() => ({
  platform: "linux" as HostPlatform | null,
  features: new Set<string>(),
  components: [] as unknown[],
  request: vi.fn(async () => {}),
  configure: vi.fn(async () => {}),
  checkIndex: vi.fn(async () => {}),
  load: vi.fn(async () => {}),
  openSettings: vi.fn(),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: vi.fn() }, apiFor: () => ({}), bridge: { on: () => () => {} } }));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => key + (vars ? JSON.stringify(vars) : "") }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetFeatures: () => env.features, useTargetHostId: () => "h1" }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({
  useHostLook: () => ({ id: "h1", label: "workstation", platform: env.platform }),
  useHostData: () => ({ features: env.features, daemon: { kind: "connected" }, featuresKnown: true }),
}));
vi.mock("../src/renderer/src/lib/componentStore", () => ({ requestComponent: env.request, configureComponent: env.configure, checkComponentIndex: env.checkIndex, loadComponents: env.load, bypassUpdateCard: vi.fn() }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { openSettings: env.openSettings } } }));
vi.mock("../src/renderer/src/lib/settingsHost", () => ({ setSettingsHost: vi.fn() }));
const { ComponentCard } = await import("../src/renderer/src/components/ComponentCard");
const { ComponentIndexPanel } = await import("../src/renderer/src/components/ComponentIndexPanel");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  env.platform = "linux";
  env.features = new Set([COMPONENTS_FEATURE, EXTERNAL_RUNTIME_ROOT_FEATURE, COMPONENT_INDEX_FEATURE]);
  env.components = [];
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const buttons = (prefix: string) => [...host.querySelectorAll("button")].filter((b) => b.textContent?.startsWith(prefix));
const remount = () => {
  act(() => root.unmount());
  root = createRoot(host);
};

const external = (codes: readonly string[], extra: Partial<ComponentExternal> = {}): ComponentExternal => ({
  version: "kimi-r3", root: null, node: null, rg: null, packages: ["@moonshot-ai/kimi-code@2.3.3", "ws@8.22.0"], nodeRange: ">=24.9.0 <25", nodeRecommended: "24.21.0", checkedAt: "2026-10-29T08:00:00Z",
  issues: codes.map((code) => ({ code, expected: "E-" + code, actual: "A-" + code, path: "/p/" + code, steps: ["cutex step for " + code] })),
  ...extra,
});
const status = (more: Partial<ComponentStatus>): ComponentStatus => ({ name: "kimi-runtime", supported: true, state: "needsUser", selected: "kimi-r3", available: "kimi-r3", origin: "signed", versions: [], error: null, steps: ["plain step"], ...more });
const cardState = (c: ComponentStatus): ComponentCardState =>
  componentCardState({ name: c.name, connected: true, featuresKnown: true, features: env.features, platform: env.platform, moduleCapabilities: [], list: { managed: true, installFrom: "release", components: [c], operation: null }, listError: null, pending: false });
function card(c: ComponentStatus) {
  const state = cardState(c);
  if (state.kind === "body" || state.kind === "waiting") throw new Error(state.kind);
  act(() => root.render(h(ComponentCard, { name: c.name, hostId: "h1", state, refusal: null, variant: "compact" })));
}

describe("needsUser with external-install checks", () => {
  for (const code of EXTERNAL_ISSUE_CODES)
    it(`${code}: copy, expected / actual / path, the host's commands, cutex's steps, 重新检测`, async () => {
      card(status({ external: external([code]) }));
      const item = host.querySelector(`[data-external-issue="${code}"]`)!;
      expect(item.textContent).toContain(`modules.component.external.${code}.title`);
      expect(item.textContent).toContain(`modules.component.external.${code}.what`);
      for (const part of ["E-", "A-", "/p/"]) expect(item.textContent).toContain(part + code);
      expect([...item.querySelectorAll("[data-external-commands]")].map((e) => e.getAttribute("data-external-commands"))).toEqual(["linux"]);
      expect(item.querySelector("pre")!.textContent!.length).toBeGreaterThan(10);
      expect(item.textContent).toContain(`cutex step for ${code}`);
      expect(host.textContent).toContain("modules.component.external.needsUser");
      expect(host.textContent).not.toContain("plain step");
      expect(host.querySelector("[data-external-unverified]")).toBeNull();
      await act(async () => buttons("modules.component.external.recheck")[0]!.click());
      expect(env.request).toHaveBeenCalledWith("h1", "kimi-runtime", "check");
    });

  it("no issues but checkedAt null: unverified (never ready), note, 重新检测", async () => {
    card(status({ external: external([], { checkedAt: null }) }));
    expect(host.textContent).toContain("modules.component.external.needsUserUnverified");
    expect(host.querySelector("[data-external-unverified]")!.textContent).toContain('"version":"kimi-r3"');
    await act(async () => buttons("modules.component.external.recheck")[0]!.click());
    expect(env.request).toHaveBeenCalledWith("h1", "kimi-runtime", "check");
  });

  it("Windows host: PowerShell commands; unknown platform: both", () => {
    env.platform = "windows";
    card(status({ external: external(["kimi_rg_missing"]) }));
    expect(host.querySelector("[data-external-commands]")!.getAttribute("data-external-commands")).toBe("windows");
    expect(host.querySelector("pre")!.textContent).toContain("winget install -e --id BurntSushi.ripgrep.MSVC");
    remount();
    env.platform = null;
    card(status({ external: external(["kimi_rg_missing"]) }));
    expect([...host.querySelectorAll("[data-external-commands]")].map((e) => e.getAttribute("data-external-commands"))).toEqual(["linux", "windows"]);
  });

  it("copy puts the whole block on the clipboard", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    card(status({ external: external(["external_root_missing"]) }));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-external-commands] button")!.click());
    expect(writeText).toHaveBeenCalledWith(host.querySelector("pre")!.textContent);
    expect(writeText.mock.calls[0]![0]).toContain("npm install --prefix \"$kimi\" @moonshot-ai/kimi-code@2.3.3 ws@8.22.0");
  });

  it("the path form sends configure (absolute paths; empty = cutex's default) and refuses relative ones", async () => {
    card(status({ external: external(["kimi_rg_missing", "node_missing"], { root: "/opt/kimi/2.3.3" }) }));
    const inputs = [...host.querySelectorAll<HTMLInputElement>("[data-component-configure] input")];
    expect(inputs.map((i) => i.value)).toEqual(["/opt/kimi/2.3.3", "", ""]);
    const type = (input: HTMLInputElement, value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = () => buttons("modules.component.external.save")[0]!;
    expect(save().disabled).toBe(true);
    type(inputs[1]!, "node");
    expect(save().disabled).toBe(true);
    expect(host.textContent).toContain("modules.component.external.absolute");
    type(inputs[1]!, "/usr/local/bin/node");
    type(inputs[2]!, "/usr/bin/rg");
    await act(async () => save().click());
    expect(env.configure).toHaveBeenCalledWith("h1", "kimi-runtime", { externalRoot: "/opt/kimi/2.3.3", node: "/usr/local/bin/node", rg: "/usr/bin/rg" });
  });

  it("恢复默认 clears only the stored paths (null) and shows the matching --clear-* command; nothing stored: neither", async () => {
    card(status({ external: external(["kimi_rg_missing"], { root: "/opt/kimi/2.3.3", rg: "/usr/bin/rg" }) }));
    expect(host.querySelector("[data-external-reset-cli] pre")!.textContent).toBe("cutex component configure kimi-runtime --clear-external-root --clear-rg");
    await act(async () => buttons("modules.component.external.reset")[0]!.click());
    expect(env.configure).toHaveBeenCalledWith("h1", "kimi-runtime", { externalRoot: null, rg: null });
    remount();
    card(status({ external: external(["node_missing"]) }));
    expect(buttons("modules.component.external.reset")).toHaveLength(0);
    expect(host.querySelector("[data-external-reset-cli]")).toBeNull();
    // cutex reports the rg it found on PATH: rg alone is not a stored path to reset.
    remount();
    card(status({ external: external(["node_missing"], { rg: "/usr/bin/rg" }) }));
    expect(buttons("modules.component.external.reset")).toHaveLength(0);
  });
  it("gate off: the old needsUser card (cutex's steps, the old recheck), no guide", () => {
    env.features = new Set([COMPONENTS_FEATURE]);
    card(status({ external: external(["node_missing"]) }));
    expect(host.querySelector("[data-component-external]")).toBeNull();
    expect(host.textContent).toContain("plain step");
    expect(buttons("modules.component.recheck")).toHaveLength(1);
  });
});

const rel = (version: string, more: Record<string, unknown> = {}) => ({ version, yanked: false, yankReason: null, compatible: true, incompatibleReason: null, requirements: {}, externalRuntime: null, externalRuntimeSha256: null, ...more });
const indexed = (index: Record<string, unknown>): ComponentStatus => ({
  name: "dsh-runtime", supported: true, state: "ready", selected: "dsh-r2", available: "dsh-r2", origin: "signed", error: null, steps: [],
  versions: [{ version: "dsh-r2", pinnedBy: 4, sizeBytes: 1 }, { version: "dsh-r1", pinnedBy: 2, sizeBytes: 1 }],
  index: { source: "componentIndex", channel: "public-stable", sequence: 9, publishedAt: "2026-10-28T00:00:00Z", fetchedAt: "2026-10-29T07:00:00Z", stale: false, staleReason: null, recommended: null, selectedYanked: false, releases: [], ...index } as ComponentStatus["index"],
});
const entryOf = (more: Partial<HostComponents> = {}): HostComponents => ({ list: { managed: true, installFrom: "release", components: env.components as ComponentStatus[], operation: null }, error: null, pending: null, refusal: null, bypass: [], results: {}, ...more });
const panel = (c: ComponentStatus, entry: Partial<HostComponents> = {}) => {
  env.components = [c];
  act(() => root.render(h(ComponentIndexPanel, { name: c.name, hostId: "h1", component: c, entry: entryOf(entry), title: "DSH" })));
};

describe("signed component index panel", () => {
  it("adapter update: requirements, 用于新 agent, pins of existing agents; 更新 installs that version", async () => {
    panel(indexed({ recommended: "dsh-r3", releases: [rel("dsh-r3", { requirements: { upstream: "@deepseek-ai/dsh@0.2.1-rc.3" } }), rel("dsh-r2")] }));
    const p = host.querySelector("[data-component-index]")!;
    expect(p.getAttribute("data-index-offer")).toBe("adapterUpdate");
    expect(p.textContent).toContain('modules.component.index.adapterUpdate{"version":"dsh-r3","current":"dsh-r2"}');
    expect(p.textContent).toContain("upstream @deepseek-ai/dsh@0.2.1-rc.3");
    expect(p.textContent).toContain("modules.component.index.forNewAgents");
    expect(p.querySelector("[data-index-pins]")!.textContent).toBe('modules.component.index.pinned{"n":2,"version":"dsh-r1"}');
    expect(p.textContent).toContain('"source":"modules.component.index.source.componentIndex","sequence":9');
    await act(async () => buttons("modules.component.index.update")[0]!.click());
    expect(env.request).toHaveBeenCalledWith("h1", "dsh-runtime", "install", { version: "dsh-r3" });
  });

  it("needs cutex first: names the missing capability, opens 主机后端更新", () => {
    panel(indexed({ recommended: "dsh-r3", releases: [rel("dsh-r3", { compatible: false, incompatibleReason: "capability:external-runtime-root-v2" })] }));
    expect(host.querySelector("[data-index-offer]")!.getAttribute("data-index-offer")).toBe("needsCutex");
    expect(host.textContent).toContain('modules.component.index.needsCapability{"capability":"external-runtime-root-v2"}');
    act(() => buttons("modules.component.openBackend")[0]!.click());
    expect(env.openSettings).toHaveBeenCalledWith("backend");
    expect(buttons("modules.component.index.update")).toHaveLength(0);
  });

  it("not for this host (platform): no update, no backend link", () => {
    panel(indexed({ recommended: "dsh-r3", releases: [rel("dsh-r3", { compatible: false, incompatibleReason: "platform" })] }));
    expect(host.querySelector("[data-index-offer]")!.getAttribute("data-index-offer")).toBe("incompatible");
    expect(host.textContent).toContain("modules.component.index.platform");
    expect(buttons("modules.component.index.update")).toHaveLength(0);
    expect(buttons("modules.component.openBackend")).toHaveLength(0);
  });

  it("a recommendation cutex does not list: unknown data (not 此主机不可用), no install, 检查更新 stays", () => {
    panel(indexed({ recommended: "dsh-r9", releases: [rel("dsh-r3")] }));
    expect(host.querySelector("[data-index-offer]")!.getAttribute("data-index-offer")).toBe("unknown");
    expect(host.querySelector("[data-index-unknown]")!.getAttribute("data-index-unknown")).toBe("dsh-r9");
    expect(host.textContent).toContain("modules.component.index.unknownTag");
    expect(host.textContent).not.toContain("modules.component.index.incompatibleTag");
    expect(buttons("modules.component.index.update")).toHaveLength(0);
    expect(buttons("modules.component.index.check")).toHaveLength(1);
  });
  it("yanked default: reason + switch new agents back to the safe version; none yet: wait, no button", async () => {
    panel(indexed({ recommended: "dsh-r1", selectedYanked: true, releases: [rel("dsh-r2", { yanked: true, yankReason: "bad resume" }), rel("dsh-r1")] }));
    expect(host.querySelector("[data-index-yanked]")!.getAttribute("data-index-yanked")).toBe("dsh-r2");
    expect(host.textContent).toContain("bad resume");
    await act(async () => buttons("modules.component.index.useSafe")[0]!.click());
    expect(env.request).toHaveBeenCalledWith("h1", "dsh-runtime", "install", { version: "dsh-r1" });
    remount();
    panel(indexed({ recommended: null, selectedYanked: true, releases: [rel("dsh-r2", { yanked: true })] }));
    expect(host.textContent).toContain("modules.component.index.yankedNoSafe");
    expect(buttons("modules.component.index.useSafe")).toHaveLength(0);
  });

  it("selectedYanked with the withdrawn version gone from the document still warns", () => {
    panel(indexed({ recommended: "dsh-r1", selectedYanked: true, releases: [rel("dsh-r1")] }));
    expect(host.querySelector("[data-index-yanked]")!.getAttribute("data-index-yanked")).toBe("dsh-r2");
    expect(buttons("modules.component.index.useSafe")).toHaveLength(1);
  });

  it("stale cache note with cutex's reason; current version line", () => {
    panel(indexed({ recommended: "dsh-r2", stale: true, staleReason: "offline", releases: [rel("dsh-r2")] }));
    expect(host.textContent).toContain('modules.component.index.current{"version":"dsh-r2"}');
    expect(host.querySelector("[data-index-stale]")!.textContent).toContain('"reason":"offline"');
  });

  it("manifest fallback (null channel / sequence): not a signed index; no cache after a failed refresh", () => {
    panel(indexed({ source: "releaseManifest", channel: null, sequence: null, publishedAt: null, fetchedAt: null, stale: true, staleReason: "offline", recommended: "dsh-r2", releases: [rel("dsh-r2")] }));
    expect(host.querySelector("[data-index-source]")!.textContent).toContain('modules.component.index.fromUnsigned{"source":"modules.component.index.source.releaseManifest"}');
    expect(host.querySelector("[data-index-stale]")!.textContent).toContain('modules.component.index.staleNoCache{"reason":"offline"}');
  });

  it("检查更新 asks cutex to refresh; disabled while indexOperation runs; a failed refresh says so", async () => {
    const c = indexed({ recommended: "dsh-r2", releases: [rel("dsh-r2")] });
    panel(c);
    await act(async () => buttons("modules.component.index.check")[0]!.click());
    expect(env.checkIndex).toHaveBeenCalledWith("h1", "dsh-runtime");
    remount();
    const running = { id: "i", name: null, action: "indexCheck", state: "running", step: null, error: null };
    panel(c, { list: { managed: true, installFrom: "release", components: [c], operation: null, indexOperation: running } });
    expect(buttons("modules.component.index.checking")[0]!.disabled).toBe(true);
    remount();
    panel(c, { list: { managed: true, installFrom: "release", components: [c], operation: null, indexOperation: { ...running, state: "failed", error: "download: offline" } } });
    expect(host.querySelector("[data-index-check-failed]")!.textContent).toContain("download: offline");
    // Live r269: the stale note already carries that same error, so the failed line is not repeated.
    remount();
    const stale = indexed({ recommended: "dsh-r2", releases: [rel("dsh-r2")], stale: true, staleReason: "download: offline", fetchedAt: "2026-10-29T00:00:00Z" });
    panel(stale, { list: { managed: true, installFrom: "release", components: [stale], operation: null, indexOperation: { ...running, state: "failed", error: "download: offline" } } });
    expect(host.querySelector("[data-index-stale]")!.textContent).toContain("download: offline");
    expect(host.querySelector("[data-index-check-failed]")).toBeNull();
  });
  it("a configured channel never checked yet (no sequence, no fetch, not stale): says so instead of empty fields", () => {
    panel(indexed({ recommended: null, releases: [], channel: "private-r269", sequence: null, publishedAt: null, fetchedAt: null }));
    expect(host.querySelector("[data-index-source]")!.textContent).toContain('modules.component.index.notChecked{"source":"modules.component.index.source.componentIndex","channel":"private-r269"}');
  });

  it("gate off or no index: nothing", () => {
    env.features = new Set([COMPONENTS_FEATURE]);
    panel(indexed({ recommended: "dsh-r3", releases: [rel("dsh-r3")] }));
    expect(host.innerHTML).toBe("");
    env.features = new Set([COMPONENTS_FEATURE, COMPONENT_INDEX_FEATURE]);
    const plain = indexed({});
    delete plain.index;
    panel(plain);
    expect(host.innerHTML).toBe("");
  });
});

const candidate = (more: Partial<ComponentExternal> = {}): ComponentStatus => ({
  ...indexed({ recommended: "dsh-r3", releases: [rel("dsh-r3"), rel("dsh-r2")] }),
  external: { ...external(["external_root_missing"]), version: "dsh-r3", packages: ["@deepseek-ai/dsh@0.2.1-rc.3", "ws@8.22.0"], ...more },
});

describe("adapter candidate and operation outcome", () => {
  it("live r269: nothing selected and cutex says needsUser for the candidate: the guide once (on the card), not again in the panel; no 当前 —", () => {
    const c = { ...candidate(), selected: null, state: "needsUser" as const, versions: [] };
    panel(c);
    expect(host.querySelector("[data-component-adapter]")).toBeNull();
    expect(host.querySelector("[data-component-external]")).toBeNull();
    expect(host.textContent).toContain('modules.component.index.adapterInstall{"version":"dsh-r3"}');
    expect(host.textContent).not.toContain("modules.component.index.adapterUpdate");
  });
  it("unverified candidate with no default yet (state missing): no 继续用 line", () => {
    panel({ ...candidate({ issues: [], checkedAt: null }), selected: null, state: "missing", versions: [] });
    expect(host.querySelector("[data-component-adapter]")!.textContent).toContain('modules.component.external.candidate.unverified{"version":"dsh-r3"}');
    expect(host.textContent).not.toContain("candidate.keepCurrent");
  });
  it("r3 staged with failed checks while r2 stays selected: the guide in the panel, no 用于新 agent", () => {
    panel(candidate());
    const part = host.querySelector("[data-component-adapter]")!;
    expect(part.getAttribute("data-component-adapter")).toBe("dsh-r3");
    expect(part.getAttribute("data-adapter-readiness")).toBe("needsUser");
    expect(part.textContent).toContain('modules.component.external.candidate.needsUser{"version":"dsh-r3","n":1}');
    expect(part.textContent).toContain('modules.component.external.candidate.keepCurrent{"current":"dsh-r2"}');
    expect(part.querySelector("[data-external-issue=external_root_missing] pre")!.textContent).toContain('npm install --prefix "$dsh" @deepseek-ai/dsh@0.2.1-rc.3 ws@8.22.0');
    expect(buttons("modules.component.external.candidate.use")).toHaveLength(0);
  });

  it("unverified candidate (checkedAt null, no issues) is never ready", () => {
    panel(candidate({ checkedAt: null, issues: [] }));
    const part = host.querySelector("[data-component-adapter]")!;
    expect(part.getAttribute("data-adapter-readiness")).toBe("unverified");
    expect(part.textContent).toContain("modules.component.external.candidate.unverified");
    expect(part.querySelector("[data-external-unverified]")).not.toBeNull();
    expect(buttons("modules.component.external.candidate.use")).toHaveLength(0);
    expect(buttons("modules.component.external.recheck")).toHaveLength(1);
  });

  it("ready candidate: 用于新 agent installs that version (only when cutex offers it and the update line does not)", async () => {
    const ready = candidate({ issues: [] });
    const notRecommended = { ...ready, index: { ...ready.index!, recommended: "dsh-r2" } };
    panel(notRecommended);
    expect(host.querySelector("[data-component-adapter]")!.getAttribute("data-adapter-readiness")).toBe("ready");
    expect(host.querySelector("[data-component-external]")).toBeNull();
    await act(async () => buttons("modules.component.external.candidate.use")[0]!.click());
    expect(env.request).toHaveBeenCalledWith("h1", "dsh-runtime", "install", { version: "dsh-r3" });
    // The update offer for the same version already has 更新: one button only.
    remount();
    panel(ready);
    expect(buttons("modules.component.external.candidate.use")).toHaveLength(0);
    expect(buttons("modules.component.index.update")).toHaveLength(1);
    // Withdrawn by cutex: no button.
    remount();
    panel({ ...notRecommended, index: { ...notRecommended.index!, releases: [rel("dsh-r3", { yanked: true }), rel("dsh-r2")] } });
    expect(buttons("modules.component.external.candidate.use")).toHaveLength(0);
  });

  it("the selected adapter's checks stay on the needsUser card, not in the panel", () => {
    panel({ ...candidate(), selected: "dsh-r3", state: "needsUser" });
    expect(host.querySelector("[data-component-adapter]")).toBeNull();
  });

  it("external gate off: no adapter part", () => {
    env.features = new Set([COMPONENTS_FEATURE, COMPONENT_INDEX_FEATURE]);
    panel(candidate());
    expect(host.querySelector("[data-component-adapter]")).toBeNull();
    expect(host.querySelector("[data-component-index]")).not.toBeNull();
  });

  it("done + needsUser + selected:false says the old version stays; selected:true says the new default", () => {
    const c = indexed({ recommended: "dsh-r3", releases: [rel("dsh-r3"), rel("dsh-r2")] });
    panel(c, { results: { "dsh-runtime": { action: "install", result: { outcome: "needsUser", version: "dsh-r3", selected: false } } } });
    const line = host.querySelector("[data-component-result]")!;
    expect(line.getAttribute("data-result-selected")).toBe("false");
    expect(line.textContent).toContain('modules.component.result.needsUser{"version":"dsh-r3"}');
    remount();
    panel(c, { results: { "dsh-runtime": { action: "check", result: { outcome: "ready", version: "dsh-r3", selected: false } } } });
    expect(host.querySelector("[data-component-result]")!.textContent).toContain("modules.component.result.ready");
    remount();
    panel(c, { results: { "dsh-runtime": { action: "install", result: { outcome: "selected", version: "dsh-r3", selected: true } } } });
    expect(host.querySelector("[data-component-result]")!.textContent).toContain('modules.component.result.selected{"version":"dsh-r3"}');
  });
});

// r270 (cutex component-external-ui-v1): stored vs resolved in the form, 恢复默认 only for stored fields, changed-only saves,
// compact actual + collapsed diagnostics, and the component_source_only refusal with cutex's explicit version.
describe("r270 path form, diagnostics and source-only refusal", () => {
  const stored = (sc: Partial<NonNullable<ComponentExternal["storedConfig"]>>, resolved: Partial<NonNullable<ComponentExternal["resolved"]>> = {}) => ({
    storedConfig: { externalRoot: null, node: null, rg: null, ...sc },
    resolved: { externalRoot: "/opt/kimi/2.3.3", node: "/usr/bin/node", rg: "/usr/bin/rg", ...resolved },
    root: "/opt/kimi/2.3.3", node: "/usr/bin/node", rg: "/usr/bin/rg",
  });
  const type = (input: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const inputs = () => [...host.querySelectorAll<HTMLInputElement>("[data-component-configure] input")];

  it("inputs show the stored override exactly; the resolved path is a separate line (found by cutex when nothing is stored)", () => {
    card(status({ external: external(["kimi_pty_unavailable"], stored({ externalRoot: "/opt/kimi/../kimi/2.3.3" })) }));
    expect(inputs().map((i) => i.value)).toEqual(["/opt/kimi/../kimi/2.3.3", "", ""]);
    const resolved = Object.fromEntries([...host.querySelectorAll("[data-external-resolved]")].map((e) => [e.getAttribute("data-external-resolved"), e.textContent]));
    expect(resolved.externalRoot).toBe("modules.component.external.resolvedUsed /opt/kimi/2.3.3");
    expect(resolved.node).toBe("modules.component.external.resolvedFound /usr/bin/node");
    expect(resolved.rg).toBe("modules.component.external.resolvedFound /usr/bin/rg");
  });

  it("save sends only the changed fields (absent keeps the stored override; emptied → null)", async () => {
    card(status({ external: external(["node_missing"], stored({ externalRoot: "/opt/kimi/2.3.3", node: "/opt/node/bin/node" })) }));
    type(inputs()[1]!, "/usr/local/bin/node");
    await act(async () => buttons("modules.component.external.save")[0]!.click());
    expect(env.configure).toHaveBeenLastCalledWith("h1", "kimi-runtime", { node: "/usr/local/bin/node" });
    type(inputs()[0]!, "");
    await act(async () => buttons("modules.component.external.save")[0]!.click());
    expect(env.configure).toHaveBeenLastCalledWith("h1", "kimi-runtime", { externalRoot: null, node: "/usr/local/bin/node" });
  });

  it("恢复默认 only when something is stored, clearing exactly those fields (rg included); discovered paths alone: none", async () => {
    card(status({ external: external(["node_missing"], stored({ rg: "/opt/rg/rg" })) }));
    expect(host.querySelector("[data-external-reset-cli] pre")!.textContent).toBe("cutex component configure kimi-runtime --clear-rg");
    await act(async () => buttons("modules.component.external.reset")[0]!.click());
    expect(env.configure).toHaveBeenCalledWith("h1", "kimi-runtime", { rg: null });
    remount();
    card(status({ external: external(["node_missing"], stored({})) }));
    expect(buttons("modules.component.external.reset")).toHaveLength(0);
    expect(host.querySelector("[data-external-reset-cli]")).toBeNull();
  });

  it("r269 row (no storedConfig / resolved): effective paths in the inputs, all fields saved, no resolved lines", async () => {
    card(status({ external: external(["node_missing"], { root: "/opt/kimi/2.3.3" }) }));
    expect(inputs().map((i) => i.value)).toEqual(["/opt/kimi/2.3.3", "", ""]);
    expect(host.querySelector("[data-external-resolved]")).toBeNull();
    type(inputs()[1]!, "/usr/bin/node");
    await act(async () => buttons("modules.component.external.save")[0]!.click());
    expect(env.configure).toHaveBeenCalledWith("h1", "kimi-runtime", { externalRoot: "/opt/kimi/2.3.3", node: "/usr/bin/node", rg: null });
  });

  it("compact actual in the row, diagnostics collapsed below; r269 multi-line actual keeps the 4-line clamp", () => {
    const diag = "MODULE_NOT_FOUND: Cannot find module '/opt/kimi/node_modules/ws/index.js'\nRequire stack:\n- /opt/kimi/probe.cjs";
    card(status({ external: external(["external_root_invalid"], { issues: [{ code: "external_root_invalid", expected: "Node-resolvable entry for ws", actual: "MODULE_NOT_FOUND: Cannot find module '/opt/kimi/node_modules/ws/index.js'", path: "/opt/kimi", steps: [], diagnostics: diag }] }) }));
    const actual = host.querySelector("[data-external-actual]")!;
    expect(actual.textContent).not.toContain("Require stack");
    expect(actual.className).not.toContain("line-clamp");
    const details = host.querySelector<HTMLDetailsElement>('[data-external-diagnostics="external_root_invalid"]')!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe("modules.component.external.diagnostics");
    expect(details.querySelector("pre")!.textContent).toBe(diag);
    remount();
    card(status({ external: external(["node_missing"], { issues: [{ code: "node_missing", expected: null, actual: "line 1\nline 2", path: null, steps: [] }] }) }));
    expect(host.querySelector("[data-external-diagnostics]")).toBeNull();
    expect(host.querySelector('[data-external-issue="node_missing"] dd')!.className).toContain("line-clamp-4");
  });

  const refusalCard = (refusal: { code: string; message: string; status: number; offeredVersion?: string }) =>
    act(() => root.render(h(ComponentCard, { name: "dsh-runtime", hostId: "h1", state: { kind: "missing", version: null }, refusal, variant: "compact" })));

  it("component_source_only with cutex's version: friendly line + an explicit install {version} (never an empty retry)", async () => {
    refusalCard({ code: "component_source_only", message: "no release manifest", status: 409, offeredVersion: "dsh-r3" });
    const line = host.querySelector('[data-component-refusal="component_source_only"]')!;
    expect(line.textContent).toContain('modules.component.refusal.component_source_only_offer{"component":');
    expect(line.textContent).toContain('"version":"dsh-r3"');
    await act(async () => buttons("modules.component.installVersion")[0]!.click());
    expect(env.request).toHaveBeenCalledWith("h1", "dsh-runtime", "install", { version: "dsh-r3" });
    expect(env.request).toHaveBeenCalledTimes(1);
  });

  it("component_source_only without a version: friendly legacy guidance, no version button; unknown codes: cutex's text", () => {
    refusalCard({ code: "component_source_only", message: "no release manifest", status: 409 });
    expect(host.querySelector('[data-component-refusal="component_source_only"]')!.textContent).toContain("modules.component.refusal.component_source_only{");
    expect(buttons("modules.component.installVersion")).toHaveLength(0);
    refusalCard({ code: "component_brand_new", message: "something new", status: 409 });
    expect(host.querySelector('[data-component-refusal="component_brand_new"]')!.textContent).toContain('modules.component.refused{"message":"something new"');
  });
});

// Once cutex reports the adapter ready (checked, no failed checks) the path form stays reachable as a collapsed 「路径设置」
// (closed by default) with the same inputs / resolved lines / Save / 恢复默认 / --clear-* as the guide; not ready: the open guide.
describe("ready adapter: collapsed path settings", () => {
  const sc = (storedConfig: Partial<NonNullable<ComponentExternal["storedConfig"]>>) => ({
    storedConfig: { externalRoot: null, node: null, rg: null, ...storedConfig },
    resolved: { externalRoot: "/opt/dsh/0.2.1-rc.3", node: "/usr/bin/node", rg: null },
    root: "/opt/dsh/0.2.1-rc.3", node: "/usr/bin/node",
  });
  const paths = () => host.querySelector<HTMLDetailsElement>("[data-component-paths]");
  const open = () => act(() => {
    paths()!.open = true;
  });
  const selectedReady = (more: Partial<ComponentExternal> = {}): ComponentStatus => ({ ...candidate({ issues: [], ...more }), selected: "dsh-r3", available: "dsh-r3", state: "ready" });

  it("ready candidate: the disclosure is present and closed; opening it shows the form with stored values and resolved lines", () => {
    panel(candidate({ issues: [], ...sc({ externalRoot: "/opt/dsh/../dsh/0.2.1-rc.3" }) }));
    const d = paths()!;
    expect(d.tagName).toBe("DETAILS");
    expect(d.open).toBe(false);
    expect(d.querySelector("summary")!.textContent).toBe("modules.component.external.pathSettings");
    expect(host.querySelector("[data-component-external]")).toBeNull();
    open();
    expect([...d.querySelectorAll<HTMLInputElement>("[data-component-configure] input")].map((i) => i.value)).toEqual(["/opt/dsh/../dsh/0.2.1-rc.3", ""]);
    expect(d.querySelector("[data-external-resolved=externalRoot]")!.textContent).toBe("modules.component.external.resolvedUsed /opt/dsh/0.2.1-rc.3");
    expect(d.querySelector("[data-external-resolved=node]")!.textContent).toBe("modules.component.external.resolvedFound /usr/bin/node");
    expect(buttons("modules.component.external.save")).toHaveLength(1);
  });

  it("恢复默认 + --clear-* only with a stored value; reset / save re-probe through configure", async () => {
    panel(selectedReady(sc({ externalRoot: "/opt/dsh/0.2.1-rc.3" })));
    const part = host.querySelector("[data-component-adapter]")!;
    expect(part.getAttribute("data-adapter-readiness")).toBe("ready");
    // The selected adapter has no candidate line and no warning: just the disclosure.
    expect(part.textContent).not.toContain("selectedUnverified");
    expect(paths()!.open).toBe(false);
    open();
    expect(host.querySelector("[data-external-reset-cli] pre")!.textContent).toBe("cutex component configure dsh-runtime --clear-external-root");
    await act(async () => buttons("modules.component.external.reset")[0]!.click());
    expect(env.configure).toHaveBeenCalledWith("h1", "dsh-runtime", { externalRoot: null });
    remount();
    panel(selectedReady(sc({})));
    open();
    expect(buttons("modules.component.external.reset")).toHaveLength(0);
    expect(host.querySelector("[data-external-reset-cli]")).toBeNull();
    const node = host.querySelectorAll<HTMLInputElement>("[data-component-configure] input")[1]!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, "/opt/node/bin/node");
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttons("modules.component.external.save")[0]!.click());
    expect(env.configure).toHaveBeenLastCalledWith("h1", "dsh-runtime", { node: "/opt/node/bin/node" });
  });

  it("not ready: the open guide as before (no disclosure); a re-probe that reports failed checks swaps the disclosure for the guide", () => {
    panel(candidate());
    expect(paths()).toBeNull();
    expect(host.querySelector("[data-component-external] [data-component-configure]")).not.toBeNull();
    remount();
    panel(candidate({ issues: [], checkedAt: null }));
    expect(paths()).toBeNull();
    remount();
    panel(candidate({ issues: [] }));
    expect(paths()).not.toBeNull();
    panel(candidate());
    expect(paths()).toBeNull();
    expect(host.querySelector("[data-component-external]")).not.toBeNull();
  });

  it("r269 row (no storedConfig): today's r269 form inside the disclosure (effective paths, all fields saved, heuristic 恢复默认)", async () => {
    panel(selectedReady({ root: "/opt/dsh/0.2.1-rc.3", node: "/usr/bin/node" }));
    expect(paths()!.open).toBe(false);
    open();
    expect([...host.querySelectorAll<HTMLInputElement>("[data-component-configure] input")].map((i) => i.value)).toEqual(["/opt/dsh/0.2.1-rc.3", "/usr/bin/node"]);
    expect(host.querySelector("[data-external-resolved]")).toBeNull();
    await act(async () => buttons("modules.component.external.reset")[0]!.click());
    expect(env.configure).toHaveBeenCalledWith("h1", "dsh-runtime", { externalRoot: null, node: null });
    remount();
    panel(selectedReady());
    open();
    expect(buttons("modules.component.external.reset")).toHaveLength(0);
  });

  it("the selected adapter's needsUser stays on the card (no panel copy, no disclosure)", () => {
    panel({ ...candidate(), selected: "dsh-r3", state: "needsUser" });
    expect(paths()).toBeNull();
    expect(host.querySelector("[data-component-adapter]")).toBeNull();
  });
});
