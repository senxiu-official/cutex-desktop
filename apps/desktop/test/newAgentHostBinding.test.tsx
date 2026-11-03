// @vitest-environment jsdom
import { act, createElement as h, isValidElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ focus: "host-a", calls: [] as string[], created: false, release: null as null | (() => void), profiles: null as any, catalog: null as any, catalogState: "ready", validateModel: false, submit: null as null | (() => void) }));
const snapshot = () => ({
  active: fx.created ? [{ cutexSessionId: "new-agent", displayName: "New", revision: 3, avatar: null, avatarMode: null, runtime: { status: "offline", runtimeGeneration: 7 } }] : [],
  retired: [], hostRows: {},
  projects: { projects: [{ project_id: "proj", lifecycle: "active", authority_epoch: 2, project_revision: 4, workspace_root: "/work", presentation: { display_name: "Project", badge_label: "P" } }] },
});
function hostApi(id: string) {
  return {
    listProfiles: async () => fx.profiles ?? ({ profiles: [], defaultProfile: null }),
    profileModels: async () => { if (fx.catalogState === "pending") return new Promise(() => {}); if (fx.catalogState === "failed") throw new Error("offline"); return fx.catalog; },
    sidebar: async () => { fx.calls.push(`${id}:sidebar`); return snapshot(); },
    createAgent: async (request: { start: boolean }) => {
      fx.calls.push(`${id}:create:${request.start}`);
      await new Promise<void>((resolve) => { fx.release = resolve; });
      fx.created = true;
      return { cutexSessionId: "new-agent" };
    },
    sessionAction: async (_id: string, method: string) => { fx.calls.push(`${id}:${method}`); },
    projectMutation: async () => { fx.calls.push(`${id}:director`); },
    submit: async (_id: string, _text: string, _strategy: string, startIfOffline: boolean) => { fx.calls.push(`${id}:submit:${startIfOffline}`); },
  };
}
const focusApi = new Proxy({}, { get: (_target, key) => Reflect.get(hostApi(fx.focus), key) });
vi.mock("../src/renderer/src/bridge", () => ({
  api: focusApi, apiFor: (id: string) => hostApi(id),
  bridge: { platform: "linux", on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (message: string) => message,
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }), translate: (key: string) => key }));
vi.mock("../src/renderer/src/lib/targetHost", async (original) => ({
  ...await original<object>(), useFocusHostId: () => fx.focus, useTargetApi: () => focusApi,
  useTargetFeatures: () => new Set(["project-optional-director", ...(fx.validateModel ? ["human-create-session"] : [])]), useTargetSidebar: () => snapshot(),
}));
const target = { hostId: "host-a", look: { label: "A", indicator: { status: "online" } }, mode: "all", setHostId: () => {} };
vi.mock("../src/renderer/src/lib/useCreateHost", () => ({ useCreateHost: () => target, rememberCreateHost: () => {} }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostScope: () => ({ focus: fx.focus, hosts: [{ connected: true }, { connected: true }] }) }));
vi.mock("../src/renderer/src/lib/profileSnapshot", async (original) => ({ ...await original<object>(), cachedProfileList: () => fx.profiles ?? ({ profiles: [], defaultProfile: null }), loadProfileList: async () => fx.profiles ?? ({ profiles: [], defaultProfile: null }) }));
vi.mock("../src/renderer/src/lib/avatarStyleAssign", () => ({ newAgentStyleAvatar: () => null }));
vi.mock("../src/renderer/src/lib/componentView", () => ({ useComponentState: () => ({ state: { kind: "body" } }) }));
vi.mock("../src/renderer/src/lib/newAgentReturn", () => ({
  draftFits: () => true, dropNewAgentDraft: () => {}, keepNewAgentDraft: () => {},
  keptNewAgentDraft: () => ({ hostId: "host-a", params: {}, form: {
    name: "New", task: "first task", profile: "", project: "proj", cwd: "/work", cwdTouched: true,
    avatar: { kind: "emoji", value: "🌱" }, picture: null, asDirector: true, start: true,
    ...(fx.validateModel ? { launch: { model: "unlisted-model", reasoningEffort: "" }, launchTouched: true } : {}),
  } }),
}));
vi.mock("../src/renderer/src/components/LaunchPage", () => {
  const empty = () => null;
  function submitProps(node: ReactNode): { onSubmit(): void; disabled?: boolean } | null {
    if (Array.isArray(node)) return node.map(submitProps).find(Boolean) ?? null;
    if (!isValidElement(node)) return null;
    const props = node.props as { onSubmit?: () => void; disabled?: boolean; children?: ReactNode };
    return props.onSubmit ? props as { onSubmit(): void; disabled?: boolean } : submitProps(props.children);
  }
  return {
    LaunchPage: ({ children }: { children: ReactNode }) => {
      const props = submitProps(children);
      fx.submit = props?.onSubmit ?? null;
      return h("button", { "data-create": "", onClick: props?.onSubmit, disabled: props?.disabled }, "Create");
    },
    LaunchComposer: empty, LaunchAttachments: empty, LaunchDock: empty, LaunchFieldsBox: empty, LaunchIntro: empty,
  };
});

const { useApp } = await import("../src/renderer/src/store");
const { NewAgentPage } = await import("../src/renderer/src/modules/agent-config/NewAgentPage");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps create, metadata, Director CAS, start and first task on the original host after focus changes", async () => {
  const initial = useApp.getState();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const start = vi.fn(async (_id: string, _method: string, _params: unknown, hostId: string) => { fx.calls.push(`${hostId}:online`); });
  useApp.setState({ sidebar: snapshot() as never, byHost: {}, openAgent: vi.fn(async () => {}), sessionAction: start,
    refreshHostSidebar: vi.fn(async (hostId: string) => { fx.calls.push(`${hostId}:refresh`); }),
  });
  try {
    await act(async () => { root.render(h(NewAgentPage, { params: { host: "host-a", project: "proj", director: "1" } })); });
    const button = host.querySelector<HTMLButtonElement>("[data-create]")!;
    expect(button.disabled).toBe(false);
    fx.calls.length = 0;
    await act(async () => { button.click(); });
    expect(fx.calls).toEqual(["host-a:create:false"]);
    fx.focus = "host-b";
    await act(async () => { fx.release!(); });
    expect(fx.calls).toContain("host-a:cutex/session/metadata/update");
    expect(fx.calls).toContain("host-a:director");
    expect(fx.calls).toContain("host-a:online");
    expect(fx.calls).toContain("host-a:submit:false");
    expect(fx.calls.some((call) => call.startsWith("host-b:"))).toBe(false);
    expect(start).toHaveBeenCalledExactlyOnceWith("new-agent", "cutex/runtime/online", { openVisibleTerminal: false }, "host-a");
  } finally {
    act(() => root.unmount());
    host.remove();
    useApp.setState(initial, true);
  }
});


it.each(["ready", "empty", "failed", "pending", "stale"])("creation checks an unlisted model only against a current nonempty catalog: %s", async state => {
  fx.validateModel = true; fx.catalogState = state;
  fx.profiles = { defaultProfile: "p", profiles: [{ id: "p", name: "P", cliKind: "codex", authKind: "chatgpt", model: "gpt-6.1-sol" }] };
  fx.catalog = { models: state === "empty" ? [] : [{ id: "gpt-6.1-sol", inputModalities: ["text"], supportedReasoningEfforts: [] }], selectedModel: "gpt-6.1-sol", modelsUnavailableReason: state === "stale" ? "unavailable" : null };
  const initial = useApp.getState(); const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  useApp.setState({ sidebar: snapshot() as never, byHost: {} });
  try {
    await act(async () => root.render(h(NewAgentPage, { params: { host: "host-a", project: "proj" } })));
    expect(host.querySelector<HTMLButtonElement>("[data-create]")!.disabled).toBe(state === "ready");
    if (state === "ready") { fx.calls.length = 0; await act(async () => fx.submit?.()); expect(fx.calls.some(c => c.includes(":create:"))).toBe(false); }
  } finally { act(() => root.unmount()); host.remove(); useApp.setState(initial, true); fx.validateModel = false; fx.profiles = null; fx.catalog = null; }
});
