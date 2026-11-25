// @vitest-environment jsdom
// The start line of an old agent whose saved model / effort cannot be used right now (components/PinnedModelNote, Z5):
// 更换模型 / 更换强度 open the model and effort pickers on the agent's own Profile catalog (a Profile-less Claude agent:
// a Claude Profile's on the same host; a failed read can be retried); 保存 sends only `cutex/session/defaults/update`,
// bound to the revision reviewed (nothing starts, nothing is sent); 启动运行时 is a separate, explicit click. An invalid
// pair and a revision conflict keep the choice (after a conflict the settings read again are shown before another
// save); an older Claude adapter gets the hint, 升级运行时 and a model-only change, and the effort back once upgraded.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import type { PinnedModelBlock } from "../src/shared/pinnedModel";

const fx = vi.hoisted(() => ({
  action: vi.fn(),
  refresh: vi.fn(async () => {}),
  profileModels: vi.fn(),
  listProfiles: vi.fn(),
  profile: "omega" as string | null,
  runtime: "codex" as string,
  upgrade: null as null | { label: string; onSelect: (after?: (r: string) => void) => void },
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign(() => null, { getState: () => ({ sessionAction: fx.action, refreshHostSidebar: fx.refresh }) }),
  hostApi: () => ({ profileModels: fx.profileModels, listProfiles: fx.listProfiles }),
}));
vi.mock("../src/renderer/src/lib/menus", () => ({
  upgradeRuntimeAction: (_s: unknown, _t: unknown, _h: unknown, after?: (r: string) => void) => (fx.upgrade ? { label: fx.upgrade.label, onSelect: () => fx.upgrade!.onSelect(after) } : null),
}));
vi.mock("../src/renderer/src/lib/modelDisplay", () => ({ useModelName: () => (m: string) => m }));
vi.mock("../src/renderer/src/lib/effortDisplay", () => ({ effortName: (_t: unknown, e: string) => e }));
vi.mock("../src/renderer/src/lib/agentList", () => ({ profileOf: () => fx.profile, runtimeOf: () => fx.runtime }));
vi.mock("../src/renderer/src/components/ModelPicker", () => ({
  ModelPicker: ({ models, onOpen, onSelect, note }: { models: { model: string }[]; onOpen(): void; onSelect(m: string): void; note?: string }) =>
    h("span", { "data-test-model-picker": "" }, h("button", { "data-test-open-models": "", onClick: onOpen }, "open"), note ? h("i", { "data-test-note": "" }, note) : null, models.map((m) => h("button", { key: m.model, "data-test-model": m.model, onClick: () => onSelect(m.model) }, m.model))),
}));
vi.mock("../src/renderer/src/components/ConversationModelControls", () => ({
  EffortPicker: ({ effort, efforts, onChange }: { effort: string | null; efforts: string[]; onChange(e: string): void }) =>
    h("span", { "data-test-effort": effort ?? "" }, efforts.map((e) => h("button", { key: e, "data-test-effort-option": e, onClick: () => onChange(e) }, e))),
}));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick(): void; disabled?: boolean }) => h("button", { onClick, disabled }, children),
  TextLink: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => h("button", { "data-link": "", onClick }, children),
}));
const { PinnedModelNote } = await import("../src/renderer/src/components/PinnedModelNote");
const { pinnedModelWire } = await import("../src/shared/pinnedModel");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const resource = (revision: number, defaults: Record<string, unknown> | null = null) => ({ cutexSessionId: "old", revision, runtimeDefaults: defaults, effectiveNextLaunch: { profile: null, source: "x" } }) as unknown as SessionResource;
const session = resource(4);
const catalog = { models: [
  { id: "gpt-6.2", displayName: "GPT 6.2", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" },
  { id: "gpt-6.2-mini", displayName: "GPT 6.2 mini", supportedReasoningEfforts: ["low"], defaultReasoningEffort: "low" },
] };
const modelGone: PinnedModelBlock = { kind: "unavailable", model: "gpt-5.1-codex-max", effort: "high", reason: "modelUnavailable", offeredEfforts: [] };
const effortGone: PinnedModelBlock = { kind: "unavailable", model: "gpt-6.2", effort: "minimal", reason: "effortUnavailable", offeredEfforts: ["low", "medium", "high"] };
const ipc = (wire: string) => new Error(`Error invoking remote method 'cutex-desktop:invoke': Error: ${wire}`);
const upgradeWire = () => pinnedModelWire({ code: "pinned_model_selection_upgrade_required", details: { requiredCapability: "offlineLaunchSelection" } })!;

let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fx.action.mockReset().mockResolvedValue({}); fx.refresh.mockClear();
  fx.profileModels.mockReset().mockResolvedValue(catalog); fx.listProfiles.mockReset();
  fx.upgrade = null; fx.profile = "omega"; fx.runtime = "codex";
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const mount = async (block: PinnedModelBlock, s: SessionResource = session) => { await act(async () => root.render(h(PinnedModelNote, { sessionId: "old", hostId: "local", session: s, block }))); };
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text) ?? null;
const methods = () => fx.action.mock.calls.map((c) => c[1]);

describe("PinnedModelNote", () => {
  it("says the model can't be used, saves a new model only on 保存 against the revision reviewed, and starts only on its own click", async () => {
    await mount(modelGone);
    expect(host.querySelector('[data-pinned-model="modelUnavailable"]')?.textContent).toContain("pinnedModel.modelGone");
    expect(host.textContent).toContain("pinnedModel.kept");
    await click(button("pinnedModel.change"));
    expect(fx.profileModels).toHaveBeenCalledWith("omega");
    expect(button("pinnedModel.save")?.disabled).toBe(true); // no model chosen yet
    await click(host.querySelector('[data-test-model="gpt-6.2"]'));
    expect(fx.action).not.toHaveBeenCalled();
    await click(button("pinnedModel.save"));
    // "high" is offered by gpt-6.2: the saved effort stays (not sent).
    expect(fx.action).toHaveBeenCalledExactlyOnceWith("old", "cutex/session/defaults/update", { patch: { model: "gpt-6.2" }, expectedRevision: 4 }, "local");
    expect(host.querySelector("[data-pinned-model-saved]")?.textContent).toContain("pinnedModel.saved");
    await click(button("pinnedModel.start"));
    expect(methods()).toEqual(["cutex/session/defaults/update", "cutex/runtime/online"]);
  });

  it("picks the new model's default effort when it does not offer the saved one, and can clear the effort", async () => {
    await mount(modelGone);
    await click(button("pinnedModel.change"));
    await click(host.querySelector('[data-test-model="gpt-6.2-mini"]'));
    expect(host.querySelector("[data-test-effort]")?.getAttribute("data-test-effort")).toBe("low");
    await click(button("pinnedModel.clearEffort"));
    await click(button("pinnedModel.save"));
    expect(fx.action).toHaveBeenCalledWith("old", "cutex/session/defaults/update", { patch: { model: "gpt-6.2-mini", reasoningEffort: null }, expectedRevision: 4 }, "local");
  });

  it("changes only the effort when the effort is gone, from cutex's offered list", async () => {
    await mount(effortGone);
    await click(button("pinnedModel.changeEffort"));
    expect(host.querySelector("[data-test-model-picker]")).toBeNull();
    expect([...host.querySelectorAll("[data-test-effort-option]")].map((b) => b.textContent)).toEqual(["low", "medium", "high"]);
    expect(button("pinnedModel.save")?.disabled).toBe(true);
    await click(host.querySelector('[data-test-effort-option="medium"]'));
    await click(button("pinnedModel.save"));
    expect(fx.action).toHaveBeenCalledExactlyOnceWith("old", "cutex/session/defaults/update", { patch: { reasoningEffort: "medium" }, expectedRevision: 4 }, "local");
  });

  it("keeps the choice when cutex rejects the pair, and never starts", async () => {
    await mount(modelGone);
    await click(button("pinnedModel.change"));
    await click(host.querySelector('[data-test-model="gpt-6.2"]'));
    fx.action.mockRejectedValueOnce(ipc(pinnedModelWire({ code: "pinned_model_selection_unavailable", details: { model: "gpt-6.2", reasoningEffort: "high", reason: "modelUnavailable" } })!));
    await click(button("pinnedModel.save"));
    expect(host.querySelector("[data-pinned-model-problem]")?.textContent).toBe("pinnedModel.rejected");
    expect(host.querySelector("[data-pinned-model-panel]")).not.toBeNull();
    await click(button("pinnedModel.save"));
    expect(fx.action.mock.calls.map((c) => c[2])).toEqual([{ patch: { model: "gpt-6.2" }, expectedRevision: 4 }, { patch: { model: "gpt-6.2" }, expectedRevision: 4 }]);
    expect(methods()).not.toContain("cutex/runtime/online");
  });

  it("after a conflict keeps the unsaved choice, shows the settings read again, and only then saves against that revision", async () => {
    await mount(effortGone);
    await click(button("pinnedModel.changeEffort"));
    await click(host.querySelector('[data-test-effort-option="medium"]'));
    fx.action.mockRejectedValueOnce(ipc("revision_conflict: expected revision 4, found 5"));
    await click(button("pinnedModel.save"));
    expect(host.querySelector("[data-pinned-model-problem]")?.textContent).toBe("pinnedModel.conflict");
    // Not read again yet: no second save against an unseen state.
    expect(host.querySelector("[data-pinned-model-current]")?.textContent).toBe("pinnedModel.refreshing");
    expect(button("pinnedModel.save")?.disabled).toBe(true);
    // Another device moved the agent to another model meanwhile: shown, then the choice can be saved against it.
    await mount(effortGone, resource(5, { model: "gpt-6.2-mini", reasoningEffort: "low" }));
    expect(host.querySelector("[data-pinned-model-current]")?.textContent).toContain("gpt-6.2-mini · low");
    expect(host.querySelector("[data-test-effort]")?.getAttribute("data-test-effort")).toBe("medium"); // the unsaved choice
    expect(button("pinnedModel.save")?.disabled).toBe(false);
    await click(button("pinnedModel.save"));
    expect(fx.action.mock.calls.map((c) => c[2])).toEqual([{ patch: { reasoningEffort: "medium" }, expectedRevision: 4 }, { patch: { reasoningEffort: "medium" }, expectedRevision: 5 }]);
    expect(methods()).not.toContain("cutex/runtime/online");
  });

  it("a Claude agent without a Profile lists a Claude Profile's models on the same host", async () => {
    fx.profile = null; fx.runtime = "claude";
    fx.listProfiles.mockResolvedValue({ defaultProfile: "codex-a", profiles: [{ id: "p1", name: "codex-a", cliKind: "codex" }, { id: "p2", name: "claude-b", cliKind: "claude" }] });
    await mount(modelGone);
    await click(button("pinnedModel.change"));
    expect(fx.profileModels).toHaveBeenCalledExactlyOnceWith("claude-b");
    expect(host.querySelector("[data-pinned-model-via]")?.textContent).toContain("claude-b");
    await click(host.querySelector('[data-test-model="gpt-6.2"]'));
    expect(button("pinnedModel.save")?.disabled).toBe(false);
    // No Claude Profile at all: said so, not loading forever.
    act(() => root.unmount()); root = createRoot(host);
    fx.listProfiles.mockResolvedValue({ defaultProfile: null, profiles: [{ id: "p1", name: "codex-a", cliKind: "codex" }] });
    await mount(modelGone);
    await click(button("pinnedModel.change"));
    expect(host.querySelector("[data-test-note]")?.textContent).toBe("pinnedModel.noClaudeProfile");
  });

  it("reads the list again after a failed read instead of keeping the failure", async () => {
    fx.profileModels.mockRejectedValueOnce(new Error("host busy"));
    await mount(modelGone);
    await click(button("pinnedModel.change"));
    expect(host.querySelector("[data-test-note]")?.textContent).toContain("pinnedModel.catalogFailed");
    await click(button("pinnedModel.retry"));
    expect(fx.profileModels).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-test-model="gpt-6.2"]')).not.toBeNull();
  });

  it("an older Claude adapter: the hint, 升级运行时 where offered, and a model-only change", async () => {
    const onSelect = vi.fn();
    fx.upgrade = { label: "menu.upgradeRuntime", onSelect };
    await mount({ kind: "upgradeRequired" });
    expect(host.querySelector('[data-pinned-model="upgrade"]')?.textContent).toContain("pinnedModel.upgrade");
    await click(button("menu.upgradeRuntime"));
    expect(onSelect).toHaveBeenCalled();
    await click(button("pinnedModel.change"));
    expect(host.querySelector("[data-pinned-model-effort]")).toBeNull();
    expect(host.textContent).toContain("pinnedModel.effortKept");
    await click(host.querySelector('[data-test-model="gpt-6.2"]'));
    await click(button("pinnedModel.save"));
    expect(fx.action).toHaveBeenCalledExactlyOnceWith("old", "cutex/session/defaults/update", { patch: { model: "gpt-6.2" }, expectedRevision: 4 }, "local");
  });

  it("once the runtime upgrade is applied, the effort picker comes back and the pin is read again; nothing starts", async () => {
    fx.upgrade = { label: "menu.upgradeRuntime", onSelect: (after) => after?.("applied") };
    await mount({ kind: "upgradeRequired" }, resource(4, { model: "claude-old", reasoningEffort: "max" }));
    await click(button("menu.upgradeRuntime"));
    expect(fx.refresh).toHaveBeenCalledWith("local");
    expect(host.querySelector('[data-pinned-model="upgraded"]')?.textContent).toContain("pinnedModel.upgraded");
    expect(button("menu.upgradeRuntime")).toBeNull();
    await click(button("pinnedModel.change"));
    expect(host.querySelector("[data-pinned-model-effort]")).not.toBeNull();
    // An effort alone can now be saved.
    await click(host.querySelector('[data-test-model="gpt-6.2"]'));
    await click(host.querySelector('[data-test-effort-option="low"]'));
    await click(button("pinnedModel.save"));
    expect(fx.action).toHaveBeenCalledExactlyOnceWith("old", "cutex/session/defaults/update", { patch: { model: "gpt-6.2", reasoningEffort: "low" }, expectedRevision: 4 }, "local");
    expect(methods()).not.toContain("cutex/runtime/online");
  });

  it("a save refused for the old adapter turns the line into the upgrade hint, and an applied upgrade brings the effort back", async () => {
    let finish: ((r: string) => void) | undefined;
    fx.upgrade = { label: "menu.upgradeRuntime", onSelect: (after) => { finish = after; } };
    await mount(effortGone);
    await click(button("pinnedModel.changeEffort"));
    await click(host.querySelector('[data-test-effort-option="low"]'));
    fx.action.mockRejectedValueOnce(ipc(upgradeWire()));
    await click(button("pinnedModel.save"));
    expect(host.querySelector("[data-pinned-model]")?.getAttribute("data-pinned-model")).toBe("upgrade");
    expect(host.querySelector("[data-pinned-model-problem]")?.textContent).toBe("pinnedModel.upgrade");
    expect(host.querySelector("[data-pinned-model-effort]")).toBeNull();
    // Cancelled upgrade: nothing changes.
    await click(button("pinnedModel.cancel"));
    await click(button("menu.upgradeRuntime"));
    await act(async () => finish?.("cancelled"));
    expect(host.querySelector("[data-pinned-model]")?.getAttribute("data-pinned-model")).toBe("upgrade");
    await act(async () => finish?.("applied"));
    expect(host.querySelector("[data-pinned-model]")?.getAttribute("data-pinned-model")).toBe("effortUnavailable");
    await click(button("pinnedModel.changeEffort"));
    expect([...host.querySelectorAll("[data-test-effort-option]")].map((b) => b.textContent)).toEqual(["low", "medium", "high"]);
  });

  it("cancel closes the panel without a call", async () => {
    await mount(modelGone);
    await click(button("pinnedModel.change"));
    await click(host.querySelector('[data-test-model="gpt-6.2"]'));
    await click(button("pinnedModel.cancel"));
    expect(host.querySelector("[data-pinned-model-panel]")).toBeNull();
    expect(fx.action).not.toHaveBeenCalled();
  });
});
