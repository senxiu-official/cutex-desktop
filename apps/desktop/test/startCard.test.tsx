// @vitest-environment jsdom
// 开始使用 (onboarding v3, owner 2026-11-26): the three steps on screen (modules/start/StartCard) for each way in —
// this computer (not installed), SSH remote, a token — a host without a Profile, several Profiles, and someone
// already set up going straight to sending; then 接下来可以试试 (modules/start/TryNext) on the agent it wrote to.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => {
  const state = {
    daemon: { kind: "connected", baseUrl: "http://127.0.0.1:1" } as { kind: string; baseUrl: string; setup?: string },
    hosts: { active: "local", hosts: [{ id: "local", label: "This computer", kind: "local" }] } as unknown,
    features: new Set<string>(),
    sidebar: { active: [] as { cutexSessionId: string; displayName: string }[] },
    openSettings: vi.fn(),
    openPage: vi.fn(),
    openAgent: vi.fn(async () => {}),
    refreshHostSidebar: vi.fn(async () => {}),
    sessionAction: vi.fn(async () => {}),
  };
  return {
    state,
    profiles: null as null | { defaultProfile: string | null; profiles: unknown[] },
    /** What the host returns on the next read (null: the cached list). */
    remote: null as null | { defaultProfile: string | null; profiles: unknown[] },
    api: { createAgent: vi.fn(async () => ({ cutexSessionId: "new-1" })), submit: vi.fn(async () => {}), openExternal: vi.fn(), reconnectHost: vi.fn() },
    listeners: new Set<() => void>(),
  };
});

vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: typeof fx.state) => unknown) => select(fx.state), { getState: () => fx.state }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: fx.api, bridge: {} }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, v?: Record<string, unknown>) => (v?.name ? `${key}:${v.name}` : key), locale: "zh-CN" }) }));
// The cached list and its listeners, as lib/profileSnapshot (a read stores what the host returned and tells them).
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({
  cachedProfileList: () => fx.profiles,
  loadProfileList: vi.fn(async () => {
    if (fx.remote) {
      fx.profiles = fx.remote;
      fx.listeners.forEach((l) => l());
    }
    return fx.profiles;
  }),
  onProfileListChange: (l: () => void) => {
    fx.listeners.add(l);
    return () => void fx.listeners.delete(l);
  },
}));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ setViewScope: vi.fn() }));
vi.mock("../src/renderer/src/lib/hosts", () => ({
  hasNoHost: (hosts: { hosts: unknown[] } | null) => !hosts || hosts.hosts.length === 0,
  hasLocalHost: (hosts: { hosts: { kind: string }[] } | null) => !!hosts?.hosts.some((x) => x.kind === "local"),
}));
vi.mock("../src/renderer/src/lib/composerDrafts", () => ({ insertComposerDraft: vi.fn() }));
vi.mock("../src/renderer/src/lib/guides", () => ({ replayGuide: vi.fn() }));
vi.mock("../src/renderer/src/lib/conversationScope", () => ({ useConvHost: () => "local" }));
vi.mock("../src/renderer/src/components/settings/ConnectionSettings", () => ({ AddHostForm: () => h("div", { "data-add-host-form": "" }) }));
vi.mock("../src/renderer/src/components/settings/HostTokenImport", () => ({ TokenImportForm: () => h("div", { "data-token-form": "" }) }));
vi.mock("../src/renderer/src/modules/start/CustomizePanel", () => ({ CustomizePanel: () => h("div", { "data-customize-panel": "" }) }));
vi.mock("../src/renderer/src/components/OnboardingClaudeRuntime", () => ({ OnboardingClaudeRuntime: () => h("div", { "data-claude-runtime": "" }) }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({
  Button: ({ children, onClick, disabled, primary: _p, ...rest }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean; primary?: boolean }) => h("button", { type: "button", onClick, disabled, ...rest }, children),
  TextInput: ({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) => h("input", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }),
  TextArea: ({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) => h("textarea", { "aria-label": label, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { StartCard } = await import("../src/renderer/src/modules/start/StartCard");
const { TryNextCard } = await import("../src/renderer/src/modules/start/TryNext");
const { getStartState, noteFirstAgent, reloadStartState } = await import("../src/renderer/src/modules/start/state");
const { closeSettingsShelf, openSettingsShelf } = await import("../src/renderer/src/lib/settingsShelf");
const profilesChanged = (list: { defaultProfile: string | null; profiles: unknown[] }) => act(() => {
  fx.profiles = list;
  fx.listeners.forEach((l) => l());
});

const profile = (name: string, over: object = {}) => ({ id: name, name, isDefault: false, cliKind: "codex", authKind: "apiKey", authPresent: true, ...over });
let root: Root;
let div: HTMLDivElement;
const q = <T extends Element = HTMLElement>(sel: string) => div.querySelector<T>(sel);
const button = (label: string) => [...div.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

async function mount(el: React.ReactElement) {
  act(() => root.render(el));
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  reloadStartState();
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
  fx.state.daemon = { kind: "connected", baseUrl: "http://127.0.0.1:1" };
  fx.state.hosts = { active: "local", hosts: [{ id: "local", label: "This computer", kind: "local" }] };
  fx.state.features = new Set();
  fx.profiles = { defaultProfile: null, profiles: [profile("work")] };
  fx.remote = null;
  vi.clearAllMocks();
  closeSettingsShelf();
});
afterEach(() => {
  act(() => root.unmount());
  div.remove();
});

describe("开始使用: step 1 (connect a host)", () => {
  it("this computer without cutex: the install steps with retry and the guide", async () => {
    fx.state.daemon = { kind: "unreachable", baseUrl: "http://127.0.0.1:1", setup: "notInstalled" };
    await mount(h(StartCard));
    expect(q("[data-start-card]")?.dataset.startAt).toBe("host");
    expect(q("[data-start-host-panel]")?.dataset.startHostPanel).toBe("local");
    expect(div.textContent).toContain("firstRun.notInstalled.step1");
    act(() => button("firstRun.retry")!.click());
    expect(fx.api.reconnectHost).toHaveBeenCalled();
  });

  it("SSH remote and a token each open their real form; without a local host SSH is preselected", async () => {
    fx.state.hosts = { active: "local", hosts: [] };
    await mount(h(StartCard));
    expect(q<HTMLButtonElement>("[data-start-host=local]")?.disabled).toBe(true);
    expect(q("[data-add-host-form]")).toBeTruthy();
    act(() => q("[data-start-host=token]")!.click());
    expect(q("[data-token-form]")).toBeTruthy();
    expect(q("[data-add-host-form]")).toBeNull();
  });
});

describe("开始使用: step 2 (a Profile)", () => {
  it("no Profile: the three kinds and 继续 opens Settings → Profile's new form on the picked kind", async () => {
    fx.profiles = { defaultProfile: null, profiles: [] };
    await mount(h(StartCard));
    expect(q("[data-start-card]")?.dataset.startAt).toBe("profile");
    expect([...div.querySelectorAll("[data-start-profile-kind]")].map((b) => b.getAttribute("data-start-profile-kind"))).toEqual(["chatgpt", "claude", "apiKey"]);
    // Claude setup is shown (and read) only once Claude is picked.
    expect(q("[data-claude-runtime]")).toBeNull();
    act(() => q("[data-start-profile-kind=claude]")!.click());
    expect(q("[data-claude-runtime]")).toBeTruthy();
    act(() => q("[data-start-profile-kind=apiKey]")!.click());
    expect(q("[data-claude-runtime]")).toBeNull();
    act(() => q("[data-start-profile-kind=claude]")!.click());
    act(() => button("start.profile.continue")!.click());
    // The pick opens the 添加 form on it.
    expect(fx.state.openSettings).toHaveBeenCalledWith("profiles", { create: true, createKind: "claude" });
  });

  it("several that run: pick one, 用 it, then the message step; one without its key says what it needs", async () => {
    fx.profiles = { defaultProfile: "a", profiles: [profile("a"), profile("b"), profile("k", { authPresent: false })] };
    await mount(h(StartCard));
    expect(q("[data-start-card]")?.dataset.startAt).toBe("profile");
    expect(q("[data-start-profile-needs=key]")).toBeTruthy();
    act(() => q("[data-start-profile=b]")!.click());
    act(() => button("start.profile.use:b")!.click());
    expect(q("[data-start-card]")?.dataset.startAt).toBe("message");
    expect(q("[data-start-step='2']")?.textContent).toContain("start.profile.done:b");
  });
});

describe("开始使用 follows the host's Profile list (moved from the old first-run card, ab2c4db88)", () => {
  it("a Profile made in Settings moves the card on to sending", async () => {
    fx.profiles = { defaultProfile: null, profiles: [] };
    await mount(h(StartCard));
    expect(q("[data-start-card]")?.dataset.startAt).toBe("profile");
    profilesChanged({ defaultProfile: null, profiles: [profile("Audit")] });
    expect(q("[data-start-card]")?.dataset.startAt).toBe("message");
    expect(q("[data-start-step='2']")?.textContent).toContain("start.profile.done:Audit");
  });

  it("only a signed-out one: 去登录 opens it in Settings; signing in there and closing Settings reads the list again", async () => {
    fx.profiles = { defaultProfile: null, profiles: [profile("Chat", { authKind: "chatgpt", authPresent: false })] };
    await mount(h(StartCard));
    expect(q("[data-start-profile-needs=login]")).toBeTruthy();
    act(() => button("start.profile.login")!.click());
    expect(fx.state.openSettings).toHaveBeenCalledWith("profiles", { profile: "Chat", anchor: "account" });
    act(() => openSettingsShelf({ tab: "profiles" }));
    await flush();
    fx.remote = { defaultProfile: null, profiles: [profile("Chat", { authKind: "chatgpt", authPresent: true })] };
    act(() => closeSettingsShelf());
    await flush();
    expect(q("[data-start-card]")?.dataset.startAt).toBe("message");
  });

  it("更多选项 opens the new-agent page with the Profile preselected", async () => {
    await mount(h(StartCard));
    act(() => button("start.message.more")!.click());
    expect(fx.state.openPage).toHaveBeenCalledWith("agent-config.newAgent", { host: "local", profile: "work" });
  });
});

describe("开始使用: step 3 (the first message)", () => {
  it("already connected with one Profile: straight to sending the editable sample; it creates the agent on that Profile and sends it", async () => {
    fx.state.features = new Set(["human-agent-scratch-cwd"]);
    await mount(h(StartCard));
    expect(q("[data-start-card]")?.dataset.startAt).toBe("message");
    expect(div.textContent).toContain("start.card.leadReady");
    const text = q<HTMLTextAreaElement>("textarea")!;
    expect(text.value).toBe("start.message.example");
    await act(async () => button("start.message.send")!.click());
    await flush();
    expect(fx.api.createAgent).toHaveBeenCalledWith({ name: "work", cwd: undefined, profile: "work", start: false });
    expect(fx.state.sessionAction).toHaveBeenCalledWith("new-1", "cutex/runtime/online", { openVisibleTerminal: false }, "local");
    expect(fx.api.submit).toHaveBeenCalledWith("new-1", "start.message.example", "auto", false, expect.objectContaining({ extra: [] }));
    expect(getStartState().agent).toEqual({ hostId: "local", sessionId: "new-1" });
    expect(fx.state.openAgent).toHaveBeenCalledWith("new-1", "local");
  });

  it("a host without a scratch workspace needs a folder first", async () => {
    await mount(h(StartCard));
    await act(async () => button("start.message.send")!.click());
    expect(q("[role=alert]")?.textContent).toBe("start.message.needsFolder");
    expect(fx.api.createAgent).not.toHaveBeenCalled();
  });
});

describe("自定义桌面 in the guide (owner 2026-11-26: not a Settings page)", () => {
  it("is the card's optional step 4, folded until asked for, at any step", async () => {
    fx.state.daemon = { kind: "unreachable", baseUrl: "http://127.0.0.1:1", setup: "notInstalled" };
    await mount(h(StartCard));
    expect(q("[data-start-step='4']")?.dataset.state).toBe("todo");
    expect(q("[data-customize-panel]")).toBeNull();
    await act(async () => q("[data-start-customize-toggle]")!.click());
    await flush();
    expect(q("[data-start-step='4']")?.dataset.state).toBe("open");
    expect(q("[data-customize-panel]")).toBeTruthy();
  });

  it("帮助 → 自定义桌面 opens the card with it unfolded", async () => {
    await mount(h(StartCard, { customize: true }));
    expect(q("[data-customize-panel]")).toBeTruthy();
  });

  it("is an item of 接下来可以试试, ticked with 好了", async () => {
    noteFirstAgent({ hostId: "local", sessionId: "new-1" });
    await mount(h(TryNextCard, { hostId: "local", sessionId: "new-1", name: "work" }));
    await act(async () => q("[data-try-next-item=customize]")!.click());
    await flush();
    expect(q("[data-try-next-steps=customize] [data-customize-panel]")).toBeTruthy();
    act(() => button("start.customize.done")!.click());
    expect(getStartState().done).toEqual(["customize"]);
  });
});

describe("接下来可以试试", () => {
  it("collapses to a chip; 交给另一个智能体 walks its steps and is ticked; the panel guide counts as done", async () => {
    noteFirstAgent({ hostId: "local", sessionId: "new-1" });
    await mount(h(TryNextCard, { hostId: "local", sessionId: "new-1", name: "work" }));
    expect([...div.querySelectorAll("[data-try-next-item]")].map((b) => b.getAttribute("data-try-next-item"))).toEqual(["side", "delegate", "device", "assistant", "customize"]);
    expect(q<HTMLButtonElement>("[data-try-next-item=assistant]")?.disabled).toBe(true); // host without personal assistants
    act(() => q("[data-try-next-item=delegate]")!.click());
    expect(q("[data-try-next-steps=delegate]")).toBeTruthy();
    act(() => button("start.delegate.result.done")!.click());
    expect(getStartState().done).toEqual(["delegate"]);
    act(() => q("[data-try-next-item=side]")!.click());
    expect(getStartState().done).toEqual(["delegate", "side"]);
    act(() => q<HTMLButtonElement>("button[title='start.next.collapse']")!.click());
    expect(q("[data-try-next=chip]")).toBeTruthy();
    act(() => q("[data-try-next=chip]")!.click());
    expect(q("[data-try-next=card]")).toBeTruthy();
  });

  it("在手机 / iPad 上继续 is ticked by hand after pairing", async () => {
    noteFirstAgent({ hostId: "local", sessionId: "new-1" });
    await mount(h(TryNextCard, { hostId: "local", sessionId: "new-1", name: "work" }));
    act(() => q("[data-try-next-item=device]")!.click());
    act(() => button("start.device.pair.action")!.click());
    expect(fx.state.openSettings).toHaveBeenCalledWith("access");
    act(() => button("start.device.open.done")!.click());
    expect(getStartState().done).toEqual(["device"]);
  });
});
