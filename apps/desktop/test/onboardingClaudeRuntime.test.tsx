// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ComponentCardState } from "../src/renderer/src/lib/componentCard";
const env = vi.hoisted(() => ({ state: { kind: "missing", version: "claude-r25" } as ComponentCardState,
  host: "remote", status: null as null | { loggedIn: boolean; checkedAt: string; error?: string },
  install: vi.fn(), recheck: vi.fn(), accountRead: vi.fn(), load: vi.fn(), checkAccount: vi.fn(), connected: true,
  cliChoice: null as unknown,
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/i18n", async original => ({ ...await original<object>(), useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/componentView", () => ({ useComponentState: () => ({ state: env.state, entry: { refusal: null, list: { components: [{ name: "claude-runtime", ...(env.cliChoice ? { claudeCli: env.cliChoice } : {}) }] } } }) }));
vi.mock("../src/renderer/src/lib/componentStore", () => ({ requestComponent: env.install, loadComponents: env.recheck, bypassUpdateCard: vi.fn() }));
vi.mock("../src/renderer/src/lib/targetHost", async original => ({ ...await original<object>(), useTargetHostId: () => env.host, useTargetApi: () => ({ checkClaudeAccount: env.checkAccount }), useTargetFeatures: () => new Set(["claude-accounts"]) }));
vi.mock("../src/renderer/src/lib/useHostScope", async original => ({ ...await original<object>(), useHostData: () => ({ daemon: { kind: env.connected ? "connected" : "disconnected" } }) }));
vi.mock("../src/renderer/src/lib/useClaudeAccountList", () => ({ useClaudeAccountList: (enabled: boolean) => {
  env.accountRead(enabled); return { list: [{ id: "default", status: env.status }], loadError: null, load: env.load };
} }));
import { ProfileStep } from "../src/renderer/src/components/OnboardingSteps";
import { OnboardingClaudeRuntime } from "../src/renderer/src/components/OnboardingClaudeRuntime";
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks(); env.state = { kind: "missing", version: "claude-r25" }; env.status = null; env.host = "remote"; env.connected = true;
  env.recheck.mockResolvedValue(undefined); env.checkAccount.mockResolvedValue({ ok: true });
  env.cliChoice = null;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function show() { await act(async () => root.render(h(OnboardingClaudeRuntime))); }
function button(key: string) { return [...container.querySelectorAll("button")].find(b => b.textContent === key)!; }

it("does not show or read Claude setup for either Codex choice, and releases it when switching back", async () => {
  await act(async () => root.render(h(ProfileStep)));
  expect(container.querySelector("[data-onboarding-claude]")).toBeNull(); expect(env.accountRead).not.toHaveBeenCalled();
  await act(async () => (container.querySelector('[data-onboarding-profile-kind="chatgpt"]') as HTMLButtonElement).click());
  expect(env.accountRead).not.toHaveBeenCalled();
  await act(async () => (container.querySelector('[data-onboarding-profile-kind="claude"]') as HTMLButtonElement).click());
  expect(container.querySelector('[data-component-card="missing"]')).not.toBeNull();
  await act(async () => (container.querySelector('[data-onboarding-profile-kind="apiKey"]') as HTMLButtonElement).click());
  expect(container.querySelector("[data-onboarding-claude]")).toBeNull();
});
it("uses the shared install action for the selected host and keeps unknown CLI/sign-in honest", async () => {
  await show(); await act(async () => button("modules.component.install").click());
  expect(env.install).toHaveBeenCalledExactlyOnceWith("remote", "claude-runtime", "install");
  expect(container.textContent).toContain("onboarding.claudeRuntime.unknown");
  expect(container.textContent).not.toContain("onboarding.claudeRuntime.signedIn");
});
it("shows existing install progress without an extra install button", async () => {
  env.state = { kind: "installing", step: "download" }; await show();
  expect(container.querySelector('[data-component-card="installing"]')).not.toBeNull();
  expect(button("modules.component.install")).toBeUndefined();
});
it("preserves daemon needsUser instructions and the shared recheck action", async () => {
  env.state = { kind: "needsUser", steps: ["Install claude CLI", "Run claude to log in"] };
  env.status = { loggedIn: false, checkedAt: "2026-10-25T00:00:00Z" }; await show();
  expect([...container.querySelectorAll("li")].map(li => li.textContent)).toEqual(env.state.steps);
  expect(container.textContent).toContain("onboarding.claudeRuntime.signedOut");
  await act(async () => button("modules.component.recheck").click());
  expect(env.recheck).toHaveBeenCalledExactlyOnceWith("remote");
  expect(env.checkAccount).toHaveBeenCalledExactlyOnceWith("default");
});
it("collapses verified ready state to one quiet line with no actions", async () => {
  env.state = { kind: "body" }; env.status = { loggedIn: true, checkedAt: "2026-10-25T00:00:00Z" }; await show();
  expect(container.textContent).toBe("onboarding.claudeRuntime.ready"); expect(container.querySelector("button,dl,[data-component-card]")).toBeNull();
});
it("shows future source metadata and choice even when setup is already ready", async () => {
  env.state = { kind: "body" }; env.status = { loggedIn: true, checkedAt: "2026-10-25T00:00:00Z" };
  env.cliChoice = { selected: "bundled", bundled: { version: "2.1.301" }, system: { version: "2.1.299" } };
  await show();
  expect(container.querySelector('[data-onboarding-cli-source="bundled"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="onboarding.claudeRuntime.choose"]')).not.toBeNull();
});
it("does not equate an installed runtime with a successful login", async () => {
  env.state = { kind: "body" }; env.status = { loggedIn: false, checkedAt: "2026-10-25T00:00:00Z" }; await show();
  expect(container.textContent).toContain("onboarding.claudeRuntime.runtimeReady");
  expect(container.textContent).toContain("onboarding.claudeRuntime.signedOut");
  await act(async () => button("modules.component.recheck").click());
  expect(env.recheck).toHaveBeenCalledWith("remote"); expect(env.load).toHaveBeenCalledOnce();
});
it("does not call a failed CLI check or a disconnected cached login ready", async () => {
  env.state = { kind: "body" }; env.status = { loggedIn: true, checkedAt: "2026-10-25T00:00:00Z", error: "private diagnostic" }; await show();
  expect(container.textContent).toContain("onboarding.claudeRuntime.checkFailed"); expect(container.textContent).not.toContain("private diagnostic");
  env.status.error = undefined; env.connected = false; await show();
  expect(container.querySelector('[data-onboarding-claude="ready"]')).toBeNull();
});
