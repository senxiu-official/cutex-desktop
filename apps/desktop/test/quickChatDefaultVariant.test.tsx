// @vitest-environment jsdom
// QA 2026-10-27 P2: a quick chat sends no variantId, so cutex starts it on the Profile's DEFAULT variant. A
// cute-codex Profile whose default variant is DSH must get DSH controls / defaults in the draft (no Codex permission
// chip, the DSH variant's model list and default) and the create request must carry no Codex sandbox / model.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileItem } from "../src/shared/ipc";
import type { ProfileRuntimeVariant } from "../src/shared/profileVariants";

const fx = vi.hoisted(() => ({ list: null as unknown, createHumanSession: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({
  bridge: { on: () => () => {} },
  api: {
    createHumanSession: fx.createHumanSession,
    listProfiles: async () => fx.list,
    getSettings: async () => ({}),
    // The Profile's own (cute-codex) catalog: never what a DSH-default quick chat offers.
    profileModels: async () => ({ profile: { id: "omega", name: "omega" }, catalogSupported: true, catalogPresent: true, selectedModel: "gpt-codex-x", models: [{ id: "gpt-codex-x", displayName: "GPT Codex X", inputModalities: ["text", "image"], supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium", isDefault: true }] }),
    codexRequest: async () => ({ data: [] }),
  },
}));
vi.mock("../src/renderer/src/i18n", async (original) => ({ ...(await original<object>()), useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/modules/react", async (original) => ({ ...(await original<object>()), useModuleEnabled: () => false }));
vi.mock("../src/renderer/src/lib/profileSnapshot", async (original) => ({ ...(await original<object>()), cachedProfileList: () => fx.list, loadProfileList: async () => fx.list, cachedProfile: () => null }));

const { useApp } = await import("../src/renderer/src/store");
const { emptyPendingChat } = await import("../src/renderer/src/lib/pendingChat");
const { draftRuntime, variantModelRows, variantDefaultModel } = await import("../src/renderer/src/lib/draftRuntime");
const { PendingChat } = await import("../src/renderer/src/modules/quick-chats/PendingChat");

const codexVariant: ProfileRuntimeVariant = { id: "codex", runtime: "codex", primary: true, defaults: { model: "gpt-codex-x", reasoningEffort: null }, inUse: 0 };
// A non-fallback DSH catalog from cutex: the draft must list exactly these (plus nothing hardcoded).
const dshVariant: ProfileRuntimeVariant = {
  id: "dsh", runtime: "dsh", primary: false, defaults: { model: "deepseek-v9-lab", reasoningEffort: "max" }, inUse: 0,
  models: [
    { id: "deepseek-v9-lab", displayName: "DeepSeek V9 Lab", inputModalities: ["text"], supportedReasoningEfforts: ["off", "high", "max"], defaultReasoningEffort: "high" },
    { id: "deepseek-v9-vision", displayName: "DeepSeek V9 Vision", inputModalities: ["text", "image"], supportedReasoningEfforts: ["off", "high"], isDefault: true },
  ],
};
const omega = (defaultVariant: string): ProfileItem => ({ id: "omega", name: "omega", cliKind: "codex", authKind: "apiKey", model: "gpt-codex-x", runtimeVariants: [codexVariant, dshVariant], defaultVariant } as unknown as ProfileItem);
const FEATURES = ["profile-runtime-variants", "dsh-runtime", "launch-approvals-reviewer"];

describe("draftRuntime (pure)", () => {
  it("follows the default variant on a variants host; the Profile kind on an older host", () => {
    const on = new Set(FEATURES);
    expect(draftRuntime(omega("dsh"), on)).toMatchObject({ runtime: "dsh", dsh: true, claude: false, variant: { id: "dsh" } });
    expect(draftRuntime(omega("codex"), on)).toMatchObject({ runtime: "codex", dsh: false, variant: null });
    expect(draftRuntime(omega("dsh"), new Set())).toMatchObject({ runtime: null, dsh: false, variant: null });
    expect(draftRuntime({ id: "d", name: "d", cliKind: "dsh" } as ProfileItem, new Set())).toMatchObject({ dsh: true });
  });
  it("a DSH variant's rows are cutex's catalog; without one, DSH's own names plus the variant default", () => {
    expect(variantModelRows(dshVariant).map((r) => r.id)).toEqual(["deepseek-v9-lab", "deepseek-v9-vision"]);
    expect(variantDefaultModel(dshVariant, variantModelRows(dshVariant))).toBe("deepseek-v9-lab");
    const bare = { ...dshVariant, models: null, defaults: { model: "deepseek-old", reasoningEffort: null } };
    expect(variantModelRows(bare).map((r) => r.id)).toEqual(["deepseek-flash", "deepseek-v4-pro", "deepseek-old"]);
    expect(variantModelRows(bare).every((r) => r.supportedReasoningEfforts.join() === "off,low,high,max" && r.inputModalities.length === 0)).toBe(true);
  });
});

// r266: the same rule for every ACP runtime (lib/acpRuntimes) — a Kimi/Moonshot API-key Profile defaulting to kimi.
const kimiVariant: ProfileRuntimeVariant = { id: "kimi", runtime: "kimi", primary: false, defaults: { model: "kimi-for-coding", reasoningEffort: null }, inUse: 0, models: null };
const kappa = (defaultVariant: string): ProfileItem => ({ id: "kappa", name: "kappa", cliKind: "codex", authKind: "apiKey", model: "kimi-for-coding", runtimeVariants: [{ ...codexVariant, defaults: { model: "kimi-for-coding", reasoningEffort: null } }, kimiVariant], defaultVariant } as unknown as ProfileItem);

describe("draftRuntime for Kimi (ACP runtimes in general)", () => {
  it("a kimi default variant is an ACP launch; an older host reads the Kimi Profile kind", () => {
    expect(draftRuntime(kappa("kimi"), new Set(FEATURES))).toMatchObject({ runtime: "kimi", dsh: true, claude: false, variant: { id: "kimi" } });
    expect(draftRuntime({ id: "k", name: "k", cliKind: "kimi" } as unknown as ProfileItem, new Set())).toMatchObject({ dsh: true });
  });
  it("a kimi variant without a catalog keeps its own model, with Kimi's efforts (no DSH names)", () => {
    const rows = variantModelRows(kimiVariant);
    expect(rows.map((r) => r.id)).toEqual(["kimi-for-coding"]);
    expect(rows[0]?.supportedReasoningEfforts).toEqual(["off", "low", "medium", "high", "max"]);
    expect(variantModelRows({ ...kimiVariant, defaults: { model: null, reasoningEffort: null } })).toEqual([]);
  });
});

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
  useApp.setState({ pendingChat: null });
});
const flush = async () => { for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); }); };

describe("quick chat on a cute-codex Profile whose default variant is DSH", () => {
  it("shows DSH controls and defaults, and creates without Codex sandbox / model overrides", async () => {
    fx.list = { defaultProfile: "omega", profiles: [omega("dsh")] };
    // A Codex mode kept from an earlier pick (keptMode) is in the draft's launch.
    useApp.setState({ features: new Set(FEATURES), creatingChat: false, pendingChat: { ...emptyPendingChat("omega", null), launch: { sandbox: "read-only", approvalPolicy: "on-request" } } });
    act(() => root.render(h(PendingChat)));
    await flush();
    const pending = useApp.getState().pendingChat!;
    expect(pending.dsh).toBe(true);
    expect(pending.claude).toBe(false);
    // No Codex permission chip; the model chip shows the DSH variant's default, not the Codex catalog's.
    expect(host.textContent).not.toContain("composer.mode.");
    expect(host.textContent).toContain("DeepSeek V9 Lab");
    expect(host.textContent).not.toContain("GPT Codex X");

    fx.createHumanSession.mockResolvedValue({ cutexSessionId: "new-dsh" });
    useApp.setState({ pendingChat: { ...pending, drafts: [{ text: "hi", images: [], skills: [] }] }, select: vi.fn(async () => {}), submit: vi.fn(async () => null), refreshHostSidebar: vi.fn(async () => {}), setCollabMode: vi.fn(), setGoal: vi.fn() } as never);
    useApp.getState().retryPendingChat();
    await flush();
    expect(fx.createHumanSession).toHaveBeenCalledExactlyOnceWith({ start: true, profile: "omega" });
  });

  it("a Kimi default variant gets the ACP draft, and send waits for the kimi-runtime capability", async () => {
    fx.list = { defaultProfile: "kappa", profiles: [kappa("kimi")] };
    useApp.setState({ features: new Set([...FEATURES, "kimi-runtime-profiles"]), creatingChat: false, pendingChat: { ...emptyPendingChat("kappa", null), drafts: [{ text: "hi", images: [], skills: [] }] } as never });
    act(() => root.render(h(PendingChat)));
    await flush();
    expect(useApp.getState().pendingChat!.dsh).toBe(true);
    expect(host.textContent).not.toContain("composer.mode.");
    const send = () => host.querySelector<HTMLButtonElement>('button[aria-label="composer.send"], button[title="composer.send"]');
    const textarea = host.querySelector("textarea")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "hello kimi");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    // The host knows Kimi but its component is not installed: nothing to send to.
    expect(send()?.disabled).toBe(true);
    act(() => useApp.setState({ features: new Set([...FEATURES, "kimi-runtime-profiles", "kimi-runtime"]) }));
    await flush();
    expect(useApp.getState().pendingChat!.dsh).toBe(true);
    expect(send()?.disabled).toBe(false);
  });

  it("a Codex default variant keeps the Codex controls and catalog", async () => {
    fx.list = { defaultProfile: "omega", profiles: [omega("codex")] };
    useApp.setState({ features: new Set(FEATURES), creatingChat: false, pendingChat: emptyPendingChat("omega", null) });
    act(() => root.render(h(PendingChat)));
    await flush();
    expect(useApp.getState().pendingChat!.dsh).toBe(false);
    expect(host.textContent).toContain("composer.mode.");
    expect(host.textContent).toContain("GPT Codex X");
  });
});
