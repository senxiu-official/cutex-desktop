// @vitest-environment jsdom
// Managed component contracts: a source-only base can still install a verified index offer.
// Exercise explicit versions, observed Node requirements and external-root diagnostics.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ae from "./fixtures/component-external-ui-v1.ae9cced9.json";
import { COMPONENT_INDEX_FEATURE, COMPONENTS_FEATURE, EXTERNAL_RUNTIME_ROOT_FEATURE, readComponentExternal, readComponentsList, sourceOnlyOffer, type ComponentIndexState, type ComponentStatus } from "../src/shared/components";
import { componentBlocks, componentCardState, isBanner, sourceOnlyVersion, type ComponentCardState } from "../src/renderer/src/lib/componentCard";
import { formatNodeRange, nodeRequirement } from "../src/renderer/src/lib/componentExternal";
import { zhCN } from "../src/renderer/src/i18n/zh-CN";
import { en } from "../src/renderer/src/i18n/en";

const env = vi.hoisted(() => ({ request: vi.fn(async () => {}), load: vi.fn(async () => {}) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: { openExternal: vi.fn() }, apiFor: () => ({}), bridge: { on: () => () => {} } }));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ locale: "en", t: (key: string, vars?: Record<string, unknown>) => key + (vars ? JSON.stringify(vars) : "") }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetFeatures: () => new Set([COMPONENTS_FEATURE, EXTERNAL_RUNTIME_ROOT_FEATURE, COMPONENT_INDEX_FEATURE]), useTargetHostId: () => "h1" }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({
  useHostLook: () => ({ id: "h1", label: "workstation", platform: "linux" }),
  useHostData: () => ({ features: new Set(), daemon: { kind: "connected" }, featuresKnown: true }),
}));
vi.mock("../src/renderer/src/lib/componentStore", () => ({ requestComponent: env.request, configureComponent: vi.fn(), checkComponentIndex: vi.fn(), loadComponents: env.load, bypassUpdateCard: vi.fn() }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { openSettings: vi.fn() } } }));
vi.mock("../src/renderer/src/lib/settingsHost", () => ({ setSettingsHost: vi.fn() }));
const { ComponentCard } = await import("../src/renderer/src/components/ComponentCard");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const ALL = new Set([COMPONENTS_FEATURE, EXTERNAL_RUNTIME_ROOT_FEATURE, COMPONENT_INDEX_FEATURE]);
/** The private kit offer of the smoke (dsh-r3 verified, compatible). */
const kitIndex = (over: Partial<ComponentIndexState> = {}): ComponentIndexState => ({
  source: "privateKit", channel: "public-stable", sequence: 1, publishedAt: null, fetchedAt: null, stale: false, staleReason: null, recommended: "dsh-r3", selectedYanked: false,
  releases: [{ version: "dsh-r3", yanked: false, yankReason: null, compatible: true, incompatibleReason: null, requirements: {}, externalRuntime: null, externalRuntimeSha256: null }],
  ...over,
});
const dsh = (over: Partial<ComponentStatus> = {}): ComponentStatus => ({ name: "dsh-runtime", supported: true, state: "missing", selected: null, available: null, origin: null, versions: [], error: null, steps: [], index: kitIndex(), ...over });
const state = (c: ComponentStatus, features: ReadonlySet<string> = ALL, pending = false): ComponentCardState =>
  componentCardState({ name: c.name, connected: true, featuresKnown: true, features, platform: "linux", moduleCapabilities: [], list: { managed: ae.final.managed, installFrom: ae.final.installFrom as "source-only", components: [c], operation: null }, listError: null, pending });
function render(s: ComponentCardState, props: { offerAbove?: boolean; variant?: "page" | "compact" } = {}) {
  if (s.kind === "body" || s.kind === "waiting") throw new Error(s.kind);
  act(() => root.render(h(ComponentCard, { name: "dsh-runtime", hostId: "h1", state: s, refusal: null, variant: props.variant ?? "page", offerAbove: props.offerAbove })));
}
const buttons = (prefix: string) => [...host.querySelectorAll("button")].filter((b) => b.textContent?.startsWith(prefix));

describe("(a) source-only kit base: explicit index version stays installable", () => {
  it("the smoke's base is managed + source-only; the 409 names the same version the card offers", () => {
    expect(ae.final).toEqual({ managed: true, installFrom: "source-only", backendInstallRecord: false });
    expect(ae.emptyInstallRefusal.httpStatus).toBe(409);
    expect(sourceOnlyOffer(ae.emptyInstallRefusal.errorCode, ae.emptyInstallRefusal.details)).toBe("dsh-r3");
    expect(state(dsh())).toEqual({ kind: "sourceOnly", command: "cutex component install dsh-runtime --from-source <dir>", version: "dsh-r3" });
  });

  it("only a verified, compatible, non-withdrawn recommendation; no index gate / no offer: the CLI only", () => {
    expect(sourceOnlyVersion(ALL, dsh())).toBe("dsh-r3");
    expect(sourceOnlyVersion(new Set([COMPONENTS_FEATURE]), dsh())).toBeNull();
    expect(sourceOnlyVersion(ALL, dsh({ index: undefined }))).toBeNull();
    expect(sourceOnlyVersion(ALL, dsh({ index: kitIndex({ recommended: null }) }))).toBeNull();
    expect(sourceOnlyVersion(ALL, dsh({ index: kitIndex({ releases: [{ ...kitIndex().releases[0]!, yanked: true }] }) }))).toBeNull();
    expect(sourceOnlyVersion(ALL, dsh({ index: kitIndex({ releases: [{ ...kitIndex().releases[0]!, compatible: false, incompatibleReason: "platform" }] }) }))).toBeNull();
    // A recommendation cutex does not list is unknown data: never offered.
    expect(sourceOnlyVersion(ALL, dsh({ index: kitIndex({ recommended: "dsh-r9" }) }))).toBeNull();
    // Already the default: nothing to install.
    expect(sourceOnlyVersion(ALL, dsh({ selected: "dsh-r3", state: "degraded" }))).toBeNull();
    expect(state(dsh(), new Set([COMPONENTS_FEATURE]))).toEqual({ kind: "sourceOnly", command: "cutex component install dsh-runtime --from-source <dir>", version: null });
  });

  it("the card: friendly line + 安装 {version} (explicit body), the CLI command stays; never an empty install", async () => {
    render(state(dsh()));
    const card = host.querySelector('[data-component-card="sourceOnly"]')!;
    expect(card.textContent).toContain('modules.component.sourceOnlyOffer{"component":"modules.component.dsh-runtime.name","version":"dsh-r3"}');
    expect(card.querySelector("code")!.textContent).toBe("cutex component install dsh-runtime --from-source <dir>");
    const install = buttons("modules.component.installVersion");
    expect(install).toHaveLength(1);
    await act(async () => install[0]!.click());
    expect(env.request).toHaveBeenCalledTimes(1);
    expect(env.request).toHaveBeenCalledWith("h1", "dsh-runtime", "install", { version: "dsh-r3" });
    expect(buttons("modules.component.install{")).toHaveLength(0);
  });

  it("no verified offer: the legacy CLI-only card, no install button at all", () => {
    render(state(dsh({ index: undefined })));
    expect(host.textContent).toContain("modules.component.sourceOnly{");
    expect(host.querySelectorAll("button")).toHaveLength(1); // copy
    expect(buttons("modules.component.copy")).toHaveLength(1);
  });

  it("Settings (offer shown by the index panel above): no second button for the same version", () => {
    render(state(dsh()), { offerAbove: true, variant: "compact" });
    expect(buttons("modules.component.installVersion")).toHaveLength(0);
    expect(host.textContent).toContain("modules.component.sourceOnlyOffer");
  });

  it("our own explicit request shows progress; still blocking until installed", () => {
    expect(state(dsh(), ALL, true)).toEqual({ kind: "installing", step: null });
    expect(componentBlocks(state(dsh()))).toBe(true);
  });

  it("a failed update with a working version: the banner (not the blocking CLI card); retry is explicit or absent", async () => {
    const withOffer = state(dsh({ state: "degraded", selected: "dsh-r2", error: "boom" }));
    expect(withOffer).toEqual({ kind: "degraded", error: "boom", working: true, retryVersion: "dsh-r3" });
    expect(isBanner(withOffer)).toBe(true);
    render(withOffer);
    expect(buttons("modules.retry")).toHaveLength(0);
    await act(async () => buttons("modules.component.installVersion")[0]!.click());
    expect(env.request).toHaveBeenCalledWith("h1", "dsh-runtime", "install", { version: "dsh-r3" });
    const noOffer = state(dsh({ state: "degraded", selected: "dsh-r2", error: "boom", index: undefined }));
    expect(noOffer).toEqual({ kind: "degraded", error: "boom", working: true, retryVersion: null });
    render(noOffer);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    // Nothing working: the source-only card (with the offer).
    expect(state(dsh({ state: "degraded", error: "boom" }))).toMatchObject({ kind: "sourceOnly", version: "dsh-r3" });
  });

  it("release hosts are unchanged: 安装 / 重试 send the plain install", () => {
    const release = (c: ComponentStatus) => componentCardState({ name: c.name, connected: true, featuresKnown: true, features: ALL, platform: "linux", moduleCapabilities: [], list: { managed: true, installFrom: "release", components: [c], operation: null }, listError: null, pending: false });
    expect(release(dsh({ available: "dsh-r3" }))).toEqual({ kind: "missing", version: "dsh-r3" });
    expect(release(dsh({ state: "degraded", selected: "dsh-r2", error: "x" }))).toEqual({ kind: "degraded", error: "x", working: true });
  });

  it("copy: zh-CN + en", () => {
    for (const cat of [zhCN, en] as Record<string, string>[]) {
      expect(cat["modules.component.sourceOnlyOffer"]).toMatch(/\{version\}.*\{component\}/s);
      expect(cat["runtimes.nodeRange"]).toContain("{range}");
      expect(cat["runtimes.nodeVersionUnknown"]).toBeTruthy();
    }
  });
});

describe("(b)(c) Node: plain minimum, full range, observed version", () => {
  it("readers: legacy node.range (dropped by cutex-client) and external.nodeVersion", () => {
    const [c] = readComponentsList({ managed: true, installFrom: "source-only", components: [{ name: "dsh-runtime", supported: true, state: "ready", selected: "dsh-r3", available: null, origin: "signed", versions: [], error: null, dsh: { version: "0.2.1-rc.3", node: ae.dshNode }, external: ae.dshExternal }] }).components;
    expect(c!.dsh!.node).toEqual({ minimum: "24.9.0", version: "v24.21.0", ready: true });
    expect(c!.nodeRange).toBe(">=24.9.0 <25");
    expect(c!.external!.nodeVersion).toBe("v24.21.0");
    // Not observed (r269 / old cache): absent, not the recommendation.
    const { nodeVersion: _v, ...old } = ae.dshExternal;
    expect(readComponentExternal(old)!.nodeVersion).toBeUndefined();
    expect(readComponentExternal({ ...old, nodeVersion: null })!.nodeVersion).toBeUndefined();
  });

  it("nodeRequirement: range first (legacy, then external, then an aa1d3463 range-as-minimum); version never recommended", () => {
    const ext = readComponentExternal(ae.dshExternal)!;
    expect(nodeRequirement(dsh({ nodeRange: ">=24.9.0 <25" }), { minimum: "24.9.0", version: "v24.21.0" })).toEqual({ range: ">=24.9.0 <25", minimum: null, version: "v24.21.0" });
    expect(nodeRequirement(dsh({ external: ext }), { minimum: "24.9.0", version: null })).toEqual({ range: ">=24.9.0 <25", minimum: null, version: "v24.21.0" });
    const { nodeVersion: _v, ...unobserved } = ext;
    expect(nodeRequirement(dsh({ external: unobserved }), { minimum: "24.9.0", version: null })!.version).toBeNull();
    expect(nodeRequirement(dsh(), { minimum: ">=24.9.0 <25", version: null })).toEqual({ range: ">=24.9.0 <25", minimum: null, version: null });
    expect(nodeRequirement(dsh(), { minimum: "24.9.0", version: null })).toEqual({ range: null, minimum: "24.9.0", version: null });
    expect(nodeRequirement(dsh({ external: unobserved }), undefined)).toEqual({ range: ">=24.9.0 <25", minimum: null, version: null });
    expect(nodeRequirement(dsh(), undefined)).toBeNull();
  });

  it("formatNodeRange: comparators read as ≥ / <; anything else as cutex wrote it (no double prefix)", () => {
    expect(formatNodeRange(">=24.9.0 <25")).toBe("≥ 24.9.0, < 25");
    expect(formatNodeRange(">= 24.9.0 < 25")).toBe("≥ 24.9.0, < 25");
    expect(formatNodeRange(">=24.9.0")).toBe("≥ 24.9.0");
    expect(formatNodeRange("24.9.0")).toBe("24.9.0");
    expect(formatNodeRange("^24.9.0 || >=25")).toBe("^24.9.0 || >=25");
  });
});

describe("(d) issues: missing package.json is external_root_invalid; compact actual as sent", () => {
  it("the smoke's missing-metadata check renders the friendly root text with cutex's path, expected and steps", () => {
    const external = readComponentExternal(ae.missingSdkMetadata)!;
    const issue = external.issues[0]!;
    expect(issue.code).toBe("external_root_invalid");
    render(state(dsh({ state: "needsUser", selected: "dsh-r3", external })));
    const item = host.querySelector('[data-external-issue="external_root_invalid"]')!;
    expect(item.textContent).toContain("modules.component.external.external_root_invalid.title");
    expect(item.textContent).toContain(issue.path!);
    expect(item.textContent).toContain(issue.expected!);
    expect(item.textContent).toContain(issue.actual!);
    expect(item.textContent).toContain(issue.steps[0]!);
    expect(item.textContent).not.toContain("upstream_version_mismatch");
    // The copy covers broken / missing metadata, not only a missing entry file.
    expect(zhCN["modules.component.external.external_root_invalid.what"]).toContain("package.json");
    expect(en["modules.component.external.external_root_invalid.what"]).toContain("package.json");
  });

  it("display-form actual (cutex shortens embedded paths now) is shown unchanged; verbatim forms are not rewritten either", () => {
    const base = ae.missingSdkMetadata;
    for (const actual of ["MODULE_NOT_FOUND: Cannot find module 'C:\\a folder\\entry.js'", "MODULE_NOT_FOUND: \\\\server\\share\\entry.js", "MODULE_NOT_FOUND: Cannot find module '\\\\?\\C:\\a folder\\entry.js'"]) {
      const e = readComponentExternal({ ...base, issues: [{ ...base.issues[0], code: "external_root_invalid", actual, diagnostics: "stack\n" + actual }] })!;
      expect(e.issues[0]!.actual).toBe(actual);
    }
    // Paths: the drive verbatim form is shortened, an already-display path stays (idempotent).
    const p = (path: string) => readComponentExternal({ ...base, issues: [{ ...base.issues[0], path }] })!.issues[0]!.path;
    expect(p("C:\\ext\\dsh\\package.json")).toBe("C:\\ext\\dsh\\package.json");
    expect(p("\\\\?\\C:\\ext\\dsh\\package.json")).toBe("C:\\ext\\dsh\\package.json");
  });

  it("an unknown code falls back to cutex's text (code, actual, steps)", () => {
    const external = readComponentExternal({ ...ae.missingSdkMetadata, issues: [{ code: "sdk_metadata_corrupt", expected: null, actual: "bad json", path: "/x/package.json", steps: ["cutex says fix it"] }] })!;
    render(state(dsh({ state: "needsUser", selected: "dsh-r3", external })));
    const item = host.querySelector('[data-external-issue="sdk_metadata_corrupt"]')!;
    expect(item.textContent).toContain('modules.component.external.unknown{"code":"sdk_metadata_corrupt"}');
    for (const part of ["bad json", "/x/package.json", "cutex says fix it"]) expect(item.textContent).toContain(part);
  });
});
