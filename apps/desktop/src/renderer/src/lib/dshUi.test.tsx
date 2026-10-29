// @vitest-environment jsdom
// Import the focused controls up front: loading the full Composer/ProfileEditor
// inside a test spends its 5s budget traversing unrelated panels and settings.
import { ConversationModelControls } from "../components/ConversationModelControls";
import { ProfileSwitch } from "../components/ProfileSwitch";
import { ProfileSessionSwitch } from "../components/settings/ProfileSessionSwitch";
import { agentMenu, SESSION_FEATURES } from "./menus";
import { normalizeEntries, type MenuAction, type MenuEntry } from "./contextMenu";

function staticSubmenu(entries: MenuAction["submenu"]): MenuEntry[] {
  expect(Array.isArray(entries)).toBe(true);
  if (!Array.isArray(entries)) throw new Error("Expected a static submenu fixture");
  return entries;
}
import { useApp } from "../store";
import { emptyPendingChat } from "./pendingChat";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readComponentsList } from "@cutex-desktop/cutex-client";
const fx = vi.hoisted(() => ({ features: new Set<string>(), createProfile: vi.fn(), profileModels: undefined as undefined | ((profile: string) => Promise<unknown>), createHumanSession: vi.fn(), state: { kind: "body" }, profileList: null as unknown, list: null as unknown }));
vi.mock("../bridge", () => ({ bridge: { on: () => () => {} }, api: { createHumanSession: fx.createHumanSession, listProfiles: async () => fx.profileList } }));
vi.mock("../i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => key + (vars ? JSON.stringify(vars) : ""), locale: "en" }) }));
vi.mock("./targetHost", async original => ({ ...await original<object>(), useTargetApi: () => ({ createProfile: fx.createProfile, profileModels: fx.profileModels }), useTargetHostId: () => "dsh-host", useTargetFeatures: () => fx.features }));
vi.mock("./profileSnapshot", async original => ({ ...await original<object>(), cachedProfileList: () => fx.profileList, loadProfileList: async () => fx.profileList }));
vi.mock("./useProfilePresets", async () => { const { FALLBACK_PRESETS } = await import("./profilePresets"); return { useProfilePresets: () => FALLBACK_PRESETS }; });
vi.mock("./componentView", () => ({ useComponentState: () => ({ state: fx.state, entry: { list: fx.list, refusal: null } }) }));
vi.mock("../components/ComponentCard", () => ({ ComponentNotice: ({ name }: { name: string }) => h("div", { "data-component": name }), ComponentCard: ({ name, state }: { name: string; state: { kind: string } }) => h("div", { "data-component": name }, state.kind) }));
vi.mock("../components/settings/ProfileClaudeAccount", () => ({ NewClaudeAccountRow: () => null }));
const { NewProfileForm } = await import("../components/settings/NewProfileForm");
const { DshRuntimeSettings } = await import("../components/DshRuntimeCard");
const { DshModelFields } = await import("../components/settings/DshModelFields");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { fx.features = new Set(); fx.profileModels = undefined; fx.profileList = null; fx.list = null; fx.state = { kind: "body" }; vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const button = (label: string) => [...host.querySelectorAll("button")].find(b => b.textContent === label)!;

it("hides DSH on legacy hosts and creates a DSH profile (DeepSeek → 高级 → host variable) without a key input", async () => {
  act(() => root.render(h(NewProfileForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
  act(() => host.querySelector<HTMLButtonElement>('[data-provider-card="deepseek"]')!.click());
  expect(button("newProfile.advanced")).toBeUndefined();
  expect(host.querySelector("[data-dsh-not-recommended]")).toBeNull();
  act(() => root.unmount());
  root = createRoot(host);
  fx.features = new Set(["dsh-runtime"]);
  act(() => root.render(h(NewProfileForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
  act(() => host.querySelector<HTMLButtonElement>('[data-provider-card="deepseek"]')!.click());
  act(() => button("newProfile.advanced").click());
  act(() => host.querySelector<HTMLInputElement>('[data-auth-option="dshEnv"] input')!.click());
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(host.textContent).toContain("dsh.credentials");
  expect(host.querySelector("[data-dsh-not-recommended]")?.textContent).toBe("dsh.notRecommended");
  expect(host.querySelector('[data-component="dsh-runtime"]')).not.toBeNull();
  const name = host.querySelector<HTMLInputElement>('input[aria-label="newProfile.name.label"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "dsh-team"); name.dispatchEvent(new Event("input", { bubbles: true })); });
  fx.createProfile.mockResolvedValue({ name: "dsh-team" });
  await act(async () => button("newProfile.create").click());
  expect(fx.createProfile).toHaveBeenCalledWith({ name: "dsh-team", kind: "dsh", options: { dsh: { model: "deepseek-v4-flash", apiKeyEnv: "DEEPSEEK_API_KEY" } } });
});

it("shows only daemon-observed Node metadata, and hides the card on legacy hosts", () => {
  act(() => root.render(h(DshRuntimeSettings)));
  expect(host.textContent).toBe("");
  fx.features.add("dsh-runtime");
  act(() => root.render(h(DshRuntimeSettings)));
  expect(host.textContent).not.toContain("dsh.node");
  fx.list = readComponentsList({ components: [{ name: "dsh-runtime", state: "ready", dsh: { version: "0.2.1-rc.3", node: { minimum: "24.9.0", version: "24.10.0", ready: true } } }] });
  act(() => root.render(h(DshRuntimeSettings)));
  expect(host.textContent).toContain("DSH 0.2.1-rc.3");
  expect(host.querySelector("[data-dsh-not-recommended]")?.textContent).toBe("dsh.notRecommended");
  expect(host.textContent).toContain("24.10.0");
  expect(host.textContent).toContain("24.9.0");
  fx.state = { kind: "missing" };
  act(() => root.render(h(DshRuntimeSettings)));
  expect(host.querySelector('[data-component="dsh-runtime"]')?.textContent).toBe("missing");
  fx.features = new Set();
  act(() => root.render(h(DshRuntimeSettings)));
  expect(host.textContent).toBe("");
});

it("preserves an unavailable DSH draft until another kind is explicitly chosen", async () => {
  fx.features = new Set(["dsh-runtime"]);
  act(() => root.render(h(NewProfileForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
  act(() => host.querySelector<HTMLButtonElement>('[data-provider-card="deepseek"]')!.click());
  act(() => button("newProfile.advanced").click());
  act(() => host.querySelector<HTMLInputElement>('[data-auth-option="dshEnv"] input')!.click());
  const name = host.querySelector<HTMLInputElement>('input[aria-label="newProfile.name.label"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "dsh-draft"); name.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.querySelector('[data-component="dsh-runtime"]')).not.toBeNull();
  fx.features = new Set();
  act(() => root.render(h(NewProfileForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
  expect(host.querySelector('[data-auth-option="dshEnv"]')).toBeNull();
  expect(host.querySelector('[data-component="dsh-runtime"]')).toBeNull();
  expect(host.textContent).not.toContain("dsh.credentials");
  expect(name.value).toBe("dsh-draft");
  expect(button("newProfile.create").disabled).toBe(true);
  act(() => button("newProfile.create").click());
  expect(fx.createProfile).not.toHaveBeenCalled();

  // Reinstalling exposes the same DSH draft, without silently changing its kind.
  fx.features = new Set(["dsh-runtime"]);
  act(() => root.render(h(NewProfileForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
  expect(host.querySelector('[data-component="dsh-runtime"]')).not.toBeNull();
  expect(name.value).toBe("dsh-draft");
  expect(button("newProfile.create").disabled).toBe(false);

  fx.features = new Set();
  act(() => root.render(h(NewProfileForm, { existing: [], onCreated: vi.fn(), onCancel: vi.fn() })));
  act(() => button("newProfile.changeProvider").click());
  act(() => host.querySelector<HTMLButtonElement>('[data-provider-card="openai"]')!.click());
  expect(name.value).toBe("dsh-draft");
  expect(button("newProfile.create").disabled).toBe(false);
  fx.createProfile.mockResolvedValue({ name: "dsh-draft" });
  await act(async () => button("newProfile.create").click());
  expect(fx.createProfile).toHaveBeenCalledExactlyOnceWith({ name: "dsh-draft", kind: "chatgpt" });
});

it("writes DSH reasoning through options.dsh, with no API key field", () => {
  const set = vi.fn();
  act(() => root.render(h(DshModelFields, { detail: {} as never, patch: {}, set })));
  const [model, select] = [...host.querySelectorAll("select")];
  // No catalog read: DSH's own names (lib/dshModels), not a desktop guess.
  expect([...model!.options].map(o => o.value)).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
  expect([...select!.options].map(o => o.value)).toEqual(["", "off", "low", "high", "max"]);
  act(() => { select!.value = "max"; select!.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(set).toHaveBeenCalledWith({ options: { dsh: { model: "deepseek-flash", apiKeyEnv: "DEEPSEEK_API_KEY", reasoningEffort: "max" } } });
  expect(host.querySelector("input")).toBeNull();
});

it("offers the DSH Profile's model list from cutex and writes the choice through options.dsh", async () => {
  const set = vi.fn();
  fx.profileModels = vi.fn(async () => ({ models: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }, { id: "deepseek-next" }] }));
  const stored = { model: "deepseek-v4-flash", apiKeyEnv: "DEEPSEEK_API_KEY" };
  await act(async () => root.render(h(DshModelFields, { detail: { id: "dsh-p", options: { dsh: stored } } as never, patch: {}, set })));
  expect(fx.profileModels).toHaveBeenCalledWith("dsh-p");
  const model = host.querySelector("select")!;
  // The stored (older) name stays selectable; cutex's list comes first.
  expect([...model.options].map(o => o.value)).toEqual(["deepseek-flash", "deepseek-v4-pro", "deepseek-next", "deepseek-v4-flash"]);
  expect(model.value).toBe("deepseek-v4-flash");
  act(() => { model.value = "deepseek-v4-pro"; model.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(set).toHaveBeenCalledWith({ options: { dsh: { ...stored, model: "deepseek-v4-pro" } } });
});

it("keeps cutex archive while hiding DSH native delete and fork", async () => {
  const session = { cutexSessionId: "dsh-agent", displayName: "DSH Agent", lifecycle: "active", native: { schema: { protocol: "dsh-acp-subset", capabilities: { features: { threadFork: false, threadDelete: false } } } }, runtime: { backend: "dsh", activeTurnId: null } };
  useApp.setState({ features: new Set([SESSION_FEATURES.delete, SESSION_FEATURES.fork]), sidebar: { active: [session], retired: [], hostRows: {} } as never });
  const menu = normalizeEntries(agentMenu(session as never, ((key: string) => key) as never, "local"));
  const labels = menu.flatMap(entry => entry === "separator" ? [] : [entry.label]);
  expect(labels).toContain("menu.archive");
  expect(labels).not.toContain("menu.forkAgent");
  expect(labels).not.toContain("menu.more");
  expect(labels).not.toContain("menu.delete");
});

it("offers native delete and fork for a DSH agent whose runtime declares them (r265)", async () => {
  const session = { cutexSessionId: "dsh-agent", displayName: "DSH Agent", lifecycle: "active", native: { schema: { protocol: "dsh-acp-subset", capabilities: { features: { threadFork: true, threadRevert: true, threadDelete: true } } } }, runtime: { backend: "dsh", activeTurnId: null } };
  useApp.setState({ features: new Set([SESSION_FEATURES.delete, SESSION_FEATURES.fork]), sidebar: { active: [session], retired: [], hostRows: {} } as never });
  const menu = normalizeEntries(agentMenu(session as never, ((key: string) => key) as never, "local"));
  const labels = menu.flatMap(entry => entry === "separator" ? [] : [entry.label, ...staticSubmenu(entry.submenu ?? []).flatMap(sub => sub && sub !== "separator" && typeof sub === "object" ? [sub.label] : [])]);
  expect(labels).toContain("menu.archive");
  expect(labels).toContain("menu.forkAgent");
  expect(labels).toContain("menu.delete");
});

it("preserves imported model and custom environment reference when changing or clearing effort", () => {
  const set = vi.fn();
  const imported = { model: "deepseek-imported", apiKeyEnv: "TEAM_DEEPSEEK_KEY", reasoningEffort: "low" as const };
  act(() => root.render(h(DshModelFields, { detail: { options: { dsh: imported } } as never, patch: {}, set })));
  expect(host.textContent).toContain("deepseek-imported");
  const select = host.querySelectorAll("select")[1]!;
  act(() => { select.value = "max"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(set).toHaveBeenLastCalledWith({ options: { dsh: { ...imported, reasoningEffort: "max" } } });
  // A draft overrides the stored options; clearing effort must retain that draft's model/env too.
  const draft = { model: "deepseek-draft", apiKeyEnv: "DRAFT_DEEPSEEK_KEY", reasoningEffort: "high" as const };
  act(() => root.render(h(DshModelFields, { detail: { options: { dsh: imported } } as never, patch: { options: { dsh: draft } }, set })));
  act(() => { select.value = ""; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(JSON.parse(JSON.stringify(set.mock.calls.at(-1)![0]))).toEqual({ options: { dsh: { model: "deepseek-draft", apiKeyEnv: "DRAFT_DEEPSEEK_KEY" } } });
});

it("creates a DSH quick chat without saved Codex permissions or post-create reviewer/plan/goal writes", async () => {
  fx.createHumanSession.mockResolvedValue({ cutexSessionId: "new-dsh" });
  const reviewer = vi.fn(), setCollabMode = vi.fn(), setGoal = vi.fn();
  useApp.setState({
    features: new Set(["launch-approvals-reviewer"]), creatingChat: false,
    pendingChat: { ...emptyPendingChat("dsh-profile", "local"), dsh: true, permissionMode: "auto", plan: true, goal: "stale Codex goal", launch: { model: "deepseek-v4-flash", reasoningEffort: "high", sandbox: "danger-full-access", approvalPolicy: "never", networkAccess: true, writableRoots: ["/outside"], approvalsReviewer: "auto_review", claudePermissionMode: "bypassPermissions" }, drafts: [{ text: "hello", images: [], skills: [] }] },
    select: vi.fn(async () => {}), submit: vi.fn(async () => null), refreshHostSidebar: vi.fn(async () => {}), expectApprovalsReviewer: reviewer, setCollabMode, setGoal,
  });
  useApp.getState().retryPendingChat();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(fx.createHumanSession).toHaveBeenCalledExactlyOnceWith({ start: true, profile: "dsh-profile", launch: { model: "deepseek-v4-flash", reasoningEffort: "high" } });
  expect(reviewer).not.toHaveBeenCalled();
  expect(setCollabMode).not.toHaveBeenCalled();
  expect(setGoal).not.toHaveBeenCalled();
});

it("hides DSH Profile switching even when an older host reports editable/allowed", async () => {
  const set = vi.fn();
  const detail = { cliKind: "dsh", allowSessionSwitch: true, detail: { allowSessionSwitchDefault: true, editable: { allowSessionSwitch: true } } };
  act(() => root.render(h(ProfileSessionSwitch, { detail: detail as never, kind: "dsh", patch: {}, set })));
  expect(host.querySelector('[role="switch"]')).toBeNull();
  expect(host.textContent).not.toContain("agent-config.profile.allowSwitch");
  expect(set).not.toHaveBeenCalled();
  act(() => root.render(h(ProfileSessionSwitch, { detail: { ...detail, cliKind: "codex" } as never, kind: "apiKey", patch: {}, set })));
  act(() => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
  expect(set).toHaveBeenCalledWith({ allowSessionSwitch: false });
});

it.each(["codex", "claude", "dsh"] as const)("keeps %s controls editable (live) while an older DSH runtime's model/effort are frozen", async runtime => {
  const onSelect = vi.fn(), onChange = vi.fn(), onOpen = vi.fn(), onFast = vi.fn();
  const model = { profile: "dsh-profile", models: [{ model: "first", displayName: "First model", description: "" }, { model: "next", displayName: "Next model", description: "" }], current: "first", label: "First model", onSelect, onOpen, openSignal: 7 };
  const effort = { effort: "high", efforts: ["low", "high"], onChange, fast: { on: false, onToggle: onFast } };
  act(() => root.render(h(ConversationModelControls, { runtime: "dsh", live: false, model, effort })));
  expect(host.querySelector('[data-session-model-readonly]')?.textContent).toBe("First model");
  expect(host.querySelector('[data-session-effort-readonly]')?.textContent).toBe("high");
  expect(host.querySelector('button, input, select, [role="slider"]')).toBeNull();
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(onOpen).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
  expect(onFast).not.toHaveBeenCalled();
  await act(async () => root.render(h(ConversationModelControls, { runtime, model, effort })));
  expect(host.querySelector('[data-session-model-readonly]')).toBeNull();
  expect(onOpen).toHaveBeenCalled();
  const next = [...document.querySelectorAll<HTMLButtonElement>("[data-popover] button")].find(button => button.textContent?.includes("Next model"))!;
  act(() => next.click());
  expect(onSelect).toHaveBeenCalledWith("next");
});

it.each([true, false])("hides profile switch for an existing DSH session with stale allowed metadata (DSH profile: %s)", async dshProfile => {
  const current = { id: "current", name: "Current", cliKind: dshProfile ? "dsh" : "codex", allowSessionSwitch: true, model: "deepseek-v4-flash", providerFamily: "dsh" };
  fx.profileList = { defaultProfile: "Current", profiles: [current, { ...current, id: "other", name: "Other" }] };
  const session = { cutexSessionId: "existing-dsh", revision: 1, runtime: { backend: "dsh" }, native: { schema: { protocol: "dsh-acp-subset" } } };
  useApp.setState({ features: new Set(), sidebar: { active: [session], retired: [], hostRows: {} } as never });
  await act(async () => root.render(h(ProfileSwitch, { profile: "Current", sessionId: "existing-dsh", busy: false })));
  expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).toBe("");
});
