// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ load: vi.fn(), reveals: {} as Record<string, () => void>, error: null as string | null }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string, vars?: { n?: number }) => vars?.n !== undefined ? `${key} ${vars.n}` : key }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({ ...(await importOriginal<object>()), useTargetHostId: () => "remote", useTargetApi: () => ({}) }));
vi.mock("../src/renderer/src/lib/settingsSearchView", () => ({ useOnSettingsReveal: (anchor: string, reveal: () => void) => { env.reveals[anchor] = reveal; } }));
vi.mock("../src/renderer/src/modules/claude-accounts/useClaudeAccounts", () => ({ useClaudeAccounts: () => ({ list: [], loading: false, unsupported: false, error: env.error, quotas: {}, load: env.load }) }));
vi.mock("../src/renderer/src/modules/claude-accounts/hooks", () => ({ useAccountTitle: () => () => "Shared default", useRefusalText: () => () => "", errorText: String }));
vi.mock("../src/renderer/src/modules/claude-accounts/AccountFlow", () => ({ AddForm: ({ kind }: { kind: string }) => h("input", { "data-add-draft": "", "data-account-kind": kind, defaultValue: "" }), AccountGuide: () => null }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: {} }));
vi.mock("../src/renderer/src/components/ComponentCard", () => ({ ComponentNotice: () => null }));
vi.mock("../src/renderer/src/components/settings/Form", () => ({useSettingsRowDecoration: () => undefined, SettingsGroup: ({ children }: any) => children, SettingsEffectCard: ({ children }: any) => children,
  Section: ({ actions, children }: { actions: React.ReactNode; children: React.ReactNode }) => h("section", null, actions, children),
  AddButton: ({ children, disabled, onClick }: { children: React.ReactNode; disabled?: boolean; onClick(): void }) => h("button", { disabled, onClick }, children),
  RefreshButton: () => null,
  ErrorNote: ({ children }: { children: React.ReactNode }) => h("p", { role: "alert" }, children),
  ArmedRemove: () => null, Button: () => null, IconButton: () => null, Loading: () => null, Notice: () => null, TextInput: () => null,
}));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ SettingsSections: () => null }));
import { ClaudeAccountsSection } from "../src/renderer/src/modules/claude-accounts/ClaudeAccountsSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  localStorage.clear(); env.load.mockClear(); env.reveals = {}; env.error = null;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("keeps the shared disclosure visible when open and preserves the account form draft across toggles", () => {
  act(() => root.render(h(ClaudeAccountsSection)));
  const toggle = host.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector("[data-disclosure-title]")!.textContent).toBe("claude-accounts.collapsedCount 0");
  const add = [...host.querySelectorAll("button")].find((b) => b.textContent === "claude-accounts.addApi")!;
  act(() => add.click());
  const draft = host.querySelector<HTMLInputElement>("[data-add-draft]")!; draft.value = "unsaved account";
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  act(() => toggle.click()); expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(localStorage.getItem("cutex-desktop.claude-accounts.open")).toBe("0");
  act(() => toggle.click());
  expect(host.querySelector("[data-add-draft]")).toBe(draft); expect(draft.value).toBe("unsaved account");
  expect(localStorage.getItem("cutex-desktop.claude-accounts.open")).toBe("1");
  expect(env.load).not.toHaveBeenCalled();
});

it("shows a warning at the same status position and search reveal does not overwrite the saved open choice", () => {
  env.error = "offline";
  act(() => root.render(h(ClaudeAccountsSection)));
  const status = host.querySelector("[data-disclosure-status]")!;
  expect(status.textContent).toBe("offline"); expect(status.classList.contains("text-warn")).toBe(true);
  act(() => env.reveals["claude-accounts.accounts"]?.());
  expect(host.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("true");
  expect(localStorage.getItem("cutex-desktop.claude-accounts.open")).toBeNull();
});

it("reveals the existing API add form for the Anthropic route without changing the saved disclosure choice", () => {
  act(() => root.render(h(ClaudeAccountsSection)));
  act(() => env.reveals["claude-accounts.add-api"]?.());
  expect(host.querySelector('button[aria-expanded]')!.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector('[data-add-draft]')!.getAttribute("data-account-kind")).toBe("api");
  expect(host.querySelector('#settings-claude-accounts\\.add-api')).not.toBeNull();
  expect(localStorage.getItem("cutex-desktop.claude-accounts.open")).toBeNull();
});
