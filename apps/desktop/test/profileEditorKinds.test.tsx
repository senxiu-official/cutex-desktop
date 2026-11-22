// @vitest-environment jsdom
// Exercise the complete editor inside its real error boundary: smaller field tests do not
// catch assumptions about Codex configuration on a Claude or legacy profile.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileDetail, ProfileItem } from "../src/shared/ipc";

const env = vi.hoisted(() => ({ snapshot: null as unknown, features: new Set<string>(), api: {} as Record<string, unknown>, logError: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: env.api, apiFor: () => env.api, cleanIpcMessage: (s: string) => s,
  bridge: { on: () => () => {}, shell: { logError: env.logError } }, onEvent: () => () => {},
}));
vi.mock("../src/renderer/src/i18n", async original => ({
  ...await original<object>(), useI18n: () => ({ locale: "en", t: (key: string) => key }),
}));
vi.mock("../src/renderer/src/lib/targetHost", async original => ({
  ...await original<object>(), useTargetApi: () => env.api, useTargetFeatures: () => env.features,
  useTargetHostId: () => "local", useTargetLoadQuota: () => vi.fn(), useTargetQuotas: () => ({}),
  useTargetSidebar: () => ({ active: [], retired: [], projects: null }), useTargetSelect: () => vi.fn(),
}));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({
  cachedProfile: () => env.snapshot, loadProfileSnapshot: async () => env.snapshot,
  updateCachedProfile: vi.fn(), loadProfileList: async () => null,
}));
vi.mock("../src/renderer/src/lib/useProfilePresets", async () => {
  const { FALLBACK_PRESETS } = await import("../src/renderer/src/lib/profilePresets");
  return { useProfilePresets: () => FALLBACK_PRESETS };
});
vi.mock("../src/renderer/src/lib/useClaudeAccountList", () => ({
  useClaudeAccountList: () => ({ list: [
    { id: "default", label: null, kind: "subscription", isDefault: true, status: null, api: null },
    { id: "api", label: "Claude API", kind: "api", isDefault: false, status: null, api: { apiKeyPresent: true } },
  ], loadError: null, load: async () => {} }),
}));
vi.mock("../src/renderer/src/modules/react", () => ({ useSlot: () => [] }));
import { ProfileEditor } from "../src/renderer/src/components/settings/ProfileEditor";
import { CardBoundary } from "../src/renderer/src/components/settings/Form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  env.features = new Set(["claude-accounts", "claude-profile-default-model", "claude-compaction", "claude-compaction-models"]);
  env.logError.mockReset().mockResolvedValue(undefined);
  Object.assign(env.api, { getProfile: async () => (env.snapshot as { detail: ProfileDetail }).detail, profileAccount: async () => null, profileModels: async () => null,
    components: async () => ({ components: [] }), listComponents: async () => ({ components: [] }), listClaudeAccounts: async () => ({ accounts: [] }) });
  HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function fixture(name: string, cliKind: "codex" | "claude", authKind: string, providerFamily: string, nested: unknown): ProfileDetail {
  return { id: name, name, cliKind, authKind, providerFamily, providerFamilyLabel: null, authPresent: true,
    baseUrl: cliKind === "codex" ? "https://relay.example/v1" : null, planLabel: null,
    model: cliKind === "claude" ? "sonnet" : "gpt-5", modelReasoningEffort: null,
    appearance: { color: null, effectiveColor: null, providerCategory: null },
    claudeAccount: cliKind === "claude" ? (name.includes("api") ? "api" : "default") : null,
    claudeCompaction: cliKind === "claude" ? null : undefined,
    allowSessionSwitch: false, quotaEnabled: false, detail: nested,
  } as unknown as ProfileDetail;
}
const config = { model: "gpt-5", modelProvider: "relay", providerBaseUrl: "https://relay.example/v1" };
const nested = () => ({ config: { ...config }, editable: { model: true, modelReasoningEffort: true, modelContextWindow: true, modelAutoCompactTokenLimit: true }, apiKeyPresent: true });
const cases = [
  ["Codex API key", () => fixture("omega", "codex", "apiKey", "deepseek", nested()), true, false],
  ["ChatGPT login", () => fixture("gamma", "codex", "chatgpt", "openai-chatgpt", nested()), false, false],
  ["Claude subscription with null detail", () => fixture("claude", "claude", "none", "anthropic", null), false, true],
  ["Claude API with null config", () => fixture("claude-api", "claude", "none", "anthropic", { config: null, editable: {}, claudeAccount: "api" }), false, true],
  ["GLM custom provider", () => fixture("GLM", "codex", "apiKey", "zai", nested()), true, false],
  ["Legacy Codex without detail", () => fixture("legacy", "codex", "apiKey", "relay", null), true, false],
  ["Codex with null config", () => fixture("null-config", "codex", "apiKey", "relay", { config: null, editable: {} }), true, false],
  ["Legacy response with omitted detail", () => fixture("omitted", "codex", "apiKey", "relay", undefined), true, false],
  ["Claude with a complete detail", () => fixture("claude-full", "claude", "none", "anthropic", nested()), false, true],
] as const;

it.each(cases)("renders %s without a boundary fallback and with the correct account/provider controls", async (_label, make, provider, claude) => {
  const detail = make();
  env.snapshot = { detail, models: null, quota: null, account: null };
  await act(async () => root.render(h(CardBoundary, { children: h(ProfileEditor, {
    profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null,
    onChanged: vi.fn(), onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn(),
  }) })));
  expect(container.querySelector("[data-card-error]")).toBeNull();
  expect(env.logError).not.toHaveBeenCalled();
  expect(container.querySelector("#profile-account")).not.toBeNull();
  expect(container.querySelector("#profile-models")).not.toBeNull();
  expect(container.textContent?.includes("settings.provider.picker")).toBe(provider);
  expect(container.textContent?.includes("agent-config.profile.claudeAccount")).toBe(claude);
  expect(container.textContent).toContain("settings.modelContext.groupContext");
  expect(container.textContent).toContain("settings.modelContext.window");
  if (provider) expect(container.textContent).toContain("https://relay.example/v1");
  if (claude) expect(container.textContent).not.toContain("settings.provider.changeCreate");
  if (claude) {
    // One skeleton (owner 2026-11-18): 自动压缩 is there; 推理摘要 stays, greyed with Claude Code's reason.
    expect(container.textContent).toContain("settings.modelContext.compact");
    expect(container.textContent).toContain("settings.modelContext.summaryNoClaude");
    const account = [...container.querySelectorAll("select")].find(select => [...select.options].some(option => option.value === "api"));
    expect(account?.value).toBe(detail.claudeAccount);
  }
  const sections = [...container.querySelectorAll("section")];
  const appearance = sections.find(section => section.querySelector("h3")?.textContent?.startsWith("settings.profile.look"));
  expect(appearance).toBeDefined();
  expect(appearance!.querySelectorAll('[data-timing-presentation="header"][aria-label="settings.scope.agents.none"]')).toHaveLength(0);
  expect(appearance!.querySelectorAll('[data-timing-presentation="row"]')).toHaveLength(0);
  const quota = sections.find(section => section.querySelector("h3")?.textContent?.startsWith("agent-config.quota.title"));
  if (quota) {
    const observation = quota.querySelector("[data-setting-row]");
    expect(observation).not.toBeNull();
    expect(observation!.querySelector("[data-effect-markers], [data-timing-presentation], [data-effect-scope-marker]")).toBeNull();
  }
});

it.each([false, undefined])("keeps the API-key credential separate from providerEnvKey (editable=%s)", async editable => {
  const detail = fixture("api-key-account", "codex", "apiKey", "relay", {
    config: { ...config, providerEnvKey: "R270_VIRTUAL_ENV" },
    editable: editable === undefined ? {} : { providerEnvKey: editable },
    apiKeyPresent: true,
  });
  env.snapshot = { detail, models: null, quota: null, account: null };
  const patchProfile = vi.fn().mockResolvedValue(detail);
  env.api.patchProfile = patchProfile;
  await act(async () => root.render(h(ProfileEditor, {
    profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null,
    onChanged: vi.fn(), onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn(),
  })));
  const account = container.querySelector("#profile-account")!;
  expect(account.textContent).not.toContain("providerEnvKey");
  expect(account.textContent).not.toContain("R270_VIRTUAL_ENV");
  expect([...container.querySelectorAll("input")].some(input => input.value === "R270_VIRTUAL_ENV")).toBe(false);
  const key = account.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(key).not.toBeNull();
  expect(key.value).toBe("");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(key, "virtual-r270-key");
    key.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const save = [...container.querySelectorAll("button")].find(button => button.textContent === "settings.save");
  expect(save).toBeDefined();
  await act(async () => save!.click());
  expect(patchProfile).toHaveBeenCalledExactlyOnceWith(detail.name, { apiKey: "virtual-r270-key" });
  expect(key.value).toBe("");
});

it.each([
  [{ providerOptions: false }, true],
  [{ providerBaseUrl: false }, true],
  [{ providerOptions: true, providerBaseUrl: true }, false],
  [{}, false],
] as const)("honors the daemon endpoint editability map %j, including older hosts", async (editable, disabled) => {
  const detail = fixture("endpoint-account", "codex", "apiKey", "relay", {
    config: { ...config, providerEnvKey: "R270_VIRTUAL_ENV" }, editable, apiKeyPresent: true,
  });
  env.snapshot = { detail, models: null, quota: null, account: null };
  await act(async () => root.render(h(ProfileEditor, {
    profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null,
    onChanged: vi.fn(), onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn(),
  })));
  const endpoint = [...container.querySelectorAll("#profile-account input")]
    .find(input => (input as HTMLInputElement).value === config.providerBaseUrl) as HTMLInputElement | undefined;
  expect(endpoint).toBeDefined();
  expect(endpoint!.disabled).toBe(disabled);
});

// Cross-review of the window-bar fix (Director 2026-11-18): a window-bar entry closes a covering (maximised) Settings,
// which unmounts the editor; an unsaved Profile draft was dropped silently (repro: edit the API key, 「未保存」, click
// an entry, reopen: the field is empty). With a draft, the entry now asks in place next to the clicked button:
// 「设置里有未保存的修改」 [保存并前往] [放弃并前往] [取消]; without one it goes as before. Real ProfileEditor, real Shelf.
describe("a window-bar entry over maximised Settings with an unsaved Profile draft", async () => {
  const { useSettingsShelf, openSettingsShelf, setSettingsShelfMaximized, resetSettingsShelfForTest } = await import("../src/renderer/src/lib/settingsShelf");
  const { runBarEntry } = await import("../src/renderer/src/lib/navEntries");
  const { useOverlayState, runAction, closeMenu } = await import("../src/renderer/src/lib/contextMenu");
  // The confirm is opened outside React: its rows use the real translate (the useI18n mock above returns keys).
  const { translate } = await import("../src/renderer/src/i18n");
  type Menu = ReturnType<typeof useOverlayState>["menu"];
  let menu: Menu = null;
  let button: HTMLButtonElement;
  const detail = fixture("review-draft", "codex", "apiKey", "relay", nested());
  const target = vi.fn();
  const entry = { id: "review", target: { run: target } } as never;
  function Probe() {
    menu = useOverlayState().menu;
    return null;
  }
  function ShelfContent() {
    const open = useSettingsShelf((s) => s.open);
    return h("div", null, h(Probe), open ? h(ProfileEditor, { profile: detail.name, item: detail as ProfileItem, isDefault: false, refusal: null, onChanged: vi.fn(), onDuplicate: vi.fn(), onDelete: async () => {}, onCreateProvider: vi.fn() }) : null);
  }
  const keyInput = () => container.querySelector<HTMLInputElement>('input[type="password"]');
  const typeKey = (value: string) => act(() => {
    const key = keyInput()!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(key, value);
    key.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const row = (label: string) => {
    const r = menu!.items.find((i) => i !== "separator" && i.label === translate(label as never));
    if (!r || r === "separator") throw new Error(`no row ${label}`);
    return r;
  };
  async function setup() {
    env.snapshot = { detail, models: null, quota: null, account: null };
    target.mockReset();
    resetSettingsShelfForTest();
    openSettingsShelf({ tab: "profiles" });
    setSettingsShelfMaximized(true);
    button = document.createElement("button");
    button.dataset.titlebarEntry = "review";
    document.body.append(button);
    await act(async () => root.render(h(ShelfContent)));
    expect(keyInput()).not.toBeNull();
  }
  afterEach(() => {
    act(() => {
      closeMenu();
      resetSettingsShelfForTest();
    });
    button.remove();
  });

  it("no draft: Settings closes and the entry runs, no question", async () => {
    await setup();
    await act(async () => runBarEntry(entry, undefined, button));
    expect(menu).toBeNull();
    expect(target).toHaveBeenCalledTimes(1);
    expect(useSettingsShelf.getState().open).toBe(false);
  });

  it("a draft: Settings stays, the confirm shows next to the clicked button; 取消 keeps the draft", async () => {
    await setup();
    typeKey("review-unsaved-credential");
    expect(container.textContent).toContain("agent-config.profile.unsaved");
    await act(async () => runBarEntry(entry, undefined, button));
    expect(target).not.toHaveBeenCalled();
    expect(useSettingsShelf.getState().open).toBe(true);
    expect(menu!.trigger).toBe(button);
    expect(menu!.items.map((i) => (i === "separator" ? "-" : i.label))).toEqual(["settings.drafts.title", "settings.drafts.saveGo", "settings.drafts.discardGo", "settings.drafts.cancel"].map((k) => translate(k as never)));
    expect(menu!.items[0] !== "separator" && menu!.items[0]!.note).toBe(true);
    await act(async () => runAction(row("settings.drafts.cancel")));
    expect(menu).toBeNull();
    expect(target).not.toHaveBeenCalled();
    expect(useSettingsShelf.getState().open).toBe(true);
    expect(keyInput()!.value).toBe("review-unsaved-credential");
  });

  it("放弃并前往: the draft is dropped (as chosen), Settings closes, the entry runs", async () => {
    await setup();
    typeKey("review-unsaved-credential");
    await act(async () => runBarEntry(entry, undefined, button));
    await act(async () => runAction(row("settings.drafts.discardGo")));
    expect(target).toHaveBeenCalledTimes(1);
    expect(useSettingsShelf.getState().open).toBe(false);
    await act(async () => openSettingsShelf({ tab: "profiles" }));
    expect(keyInput()!.value).toBe("");
  });

  it("保存并前往: the key is saved with the editor's own save, then Settings closes and the entry runs", async () => {
    await setup();
    const patchProfile = vi.fn(async () => detail);
    env.api.patchProfile = patchProfile;
    typeKey("review-unsaved-credential");
    await act(async () => runBarEntry(entry, undefined, button));
    await act(async () => runAction(row("settings.drafts.saveGo")));
    expect(patchProfile).toHaveBeenCalledWith("review-draft", expect.objectContaining({ apiKey: "review-unsaved-credential" }));
    expect(target).toHaveBeenCalledTimes(1);
    expect(useSettingsShelf.getState().open).toBe(false);
  });

  it("保存并前往 refused: Settings stays with the draft and the refusal; the entry does not run", async () => {
    await setup();
    env.api.patchProfile = vi.fn(async () => { throw new Error("relay said no"); });
    typeKey("review-unsaved-credential");
    await act(async () => runBarEntry(entry, undefined, button));
    await act(async () => runAction(row("settings.drafts.saveGo")));
    expect(target).not.toHaveBeenCalled();
    expect(useSettingsShelf.getState().open).toBe(true);
    expect(keyInput()!.value).toBe("review-unsaved-credential");
    expect(container.textContent).toContain("relay said no");
  });

  // Final review 2026-11-18 (night-review): only typing counted as a newer edit while 保存并前往 saved; a switch flipped
  // meanwhile was lost when the older request succeeded. Any control's change keeps Settings now (lib/settingsDrafts).
  it("a draft switch flipped while 保存并前往 saves: Settings stays with the newer edit", async () => {
    env.features.add("profile-tool-schema-compat");
    const editable = (detail.detail as { editable: Record<string, boolean> }).editable;
    editable.toolSchemaCompat = true;
    try {
      await setup();
      let finish!: (value: ProfileDetail) => void;
      env.api.patchProfile = vi.fn(() => new Promise<ProfileDetail>((resolve) => (finish = resolve)));
      typeKey("review-first-key");
      await act(async () => runBarEntry(entry, undefined, button));
      let action!: Promise<void>;
      await act(async () => {
        action = runAction(row("settings.drafts.saveGo"));
        await Promise.resolve();
      });
      const toggle = [...container.querySelectorAll<HTMLElement>("[data-setting-row]")].find((e) => e.textContent?.includes("agent-config.profile.toolSchemaCompat"))!.querySelector<HTMLButtonElement>('button[role="switch"]')!;
      expect(toggle.disabled).toBe(false);
      act(() => toggle.click());
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      await act(async () => {
        finish(detail);
        await action;
      });
      expect(env.api.patchProfile).toHaveBeenCalledExactlyOnceWith("review-draft", expect.objectContaining({ apiKey: "review-first-key" }));
      expect(target).not.toHaveBeenCalled();
      expect(useSettingsShelf.getState().open).toBe(true);
    } finally {
      delete editable.toolSchemaCompat;
    }
  });

  it("a partial save (the greeting not written) keeps Settings open with the greeting", async () => {
    await setup();
    const intro = await import("../src/renderer/src/lib/introAppearance");
    const write = vi.spyOn(intro, "setIntroAppearance").mockReturnValue(false);
    env.api.patchProfile = vi.fn(async () => detail);
    try {
      typeKey("review-partial-key");
      const greeting = container.querySelector<HTMLTextAreaElement>('textarea[placeholder="settings.profile.introGreeting.placeholder"]')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(greeting, "review-pending-greeting");
        greeting.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => runBarEntry(entry, undefined, button));
      await act(async () => runAction(row("settings.drafts.saveGo")));
      expect(write).toHaveBeenCalledTimes(1);
      expect(target).not.toHaveBeenCalled();
      expect(useSettingsShelf.getState().open).toBe(true);
      expect(greeting.value).toBe("review-pending-greeting");
    } finally {
      write.mockRestore();
    }
  });

  it.each(["Escape", "outside click"])("the real confirm dismissed by %s keeps the draft", async (mode) => {
    const { Overlays } = await import("../src/renderer/src/components/Overlays");
    await setup();
    const layer = document.createElement("div");
    document.body.append(layer);
    const overlay = createRoot(layer);
    try {
      act(() => overlay.render(h(Overlays)));
      typeKey("review-kept-draft");
      await act(async () => runBarEntry(entry, undefined, button));
      expect(menu).not.toBeNull();
      act(() => {
        if (mode === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
      expect(menu).toBeNull();
      expect(target).not.toHaveBeenCalled();
      expect(useSettingsShelf.getState().open).toBe(true);
      expect(keyInput()!.value).toBe("review-kept-draft");
    } finally {
      act(() => overlay.unmount());
      layer.remove();
    }
  }, 15000);
});
