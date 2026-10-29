// @vitest-environment jsdom
// Claude API key typed in the desktop (owner 2026-10-27, docs/design/042): write-only, sent once through the
// target api (preload → main → cutex), the field cleared right after the send whatever the outcome, never in
// a notice or error text; the terminal command stays as the alternative.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ClaudeAccount } from "../src/shared/claudeAccounts";

const env = vi.hoisted(() => ({ setKey: vi.fn(), create: vi.fn(), check: vi.fn(), notice: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/targetHost", async (importOriginal) => ({ ...(await importOriginal<object>()), useTargetHostId: () => "remote", useTargetHostLabel: () => "remote-host", useTargetApi: () => ({ setClaudeAccountKey: env.setKey, createClaudeAccount: env.create, checkClaudeAccount: env.check }) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: { notice: env.notice } } }));
const { AccountGuide, AddForm } = await import("../src/renderer/src/modules/claude-accounts/AccountFlow");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const KEY = "sk-ant-test-only-0000";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

function apiAccount(present: boolean): ClaudeAccount {
  return { id: "ca-kimi8n3r2t", label: "Kimi", kind: "api", isDefault: false, home: "/home/o/.cutex/claude-accounts/ca-kimi8n3r2t", createdAt: null, api: { baseUrl: null, keyEnv: "ANTHROPIC_API_KEY", env: {}, apiKeyPresent: present }, status: null, loginCommand: null, profiles: [], sessions: { active: 0, online: 0, retired: 0 }, removable: true };
}
const type = (input: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;

it("the key guide takes the key in a password field, sends it once and clears it; the terminal command stays", async () => {
  const onChecked = vi.fn(); const onClose = vi.fn();
  env.setKey.mockResolvedValue({ ok: true, account: apiAccount(true) });
  act(() => root.render(h(AccountGuide, { account: apiAccount(false), onChecked, onClose })));
  const input = host.querySelector<HTMLInputElement>("[data-claude-key-entry] input")!;
  expect(input.type).toBe("password");
  expect(input.autocomplete).toBe("off");
  expect(host.textContent).toContain("claude-accounts.key.orTerminal");
  expect(host.querySelector("code")?.textContent).toContain("--api-key-stdin");
  type(input, KEY);
  await act(async () => button("claude-accounts.key.save").click());
  expect(env.setKey).toHaveBeenCalledWith("ca-kimi8n3r2t", KEY);
  expect(input.value).toBe("");
  expect(onChecked).toHaveBeenCalledWith(apiAccount(true));
  expect(onClose).toHaveBeenCalled();
  expect(JSON.stringify(env.notice.mock.calls)).not.toContain(KEY);
});

it("a refused key empties the field and shows cutex's reason, never the key", async () => {
  env.setKey.mockResolvedValue({ ok: false, error: { code: "invalid_request", message: "apiKey: API key must be 1-4096 non-whitespace characters" } });
  act(() => root.render(h(AccountGuide, { account: apiAccount(true), onChecked: vi.fn(), onClose: vi.fn() })));
  const input = host.querySelector<HTMLInputElement>("[data-claude-key-entry] input")!;
  type(input, KEY);
  await act(async () => button("claude-accounts.key.replace").click());
  expect(input.value).toBe("");
  expect(host.textContent).toContain("apiKey: API key must be");
  expect(host.innerHTML).not.toContain(KEY);
});

it("the API add form sends the optional key with the create and clears it", async () => {
  env.create.mockResolvedValue({ ok: false, error: { code: "claude_account_label_taken", message: "taken" } });
  act(() => root.render(h(AddForm, { kind: "api", onCancel: vi.fn(), onCreated: vi.fn() })));
  const inputs = [...host.querySelectorAll<HTMLInputElement>("input")];
  const key = inputs.find((i) => i.type === "password")!;
  type(inputs[0]!, "Kimi");
  type(key, KEY);
  await act(async () => button("claude-accounts.form.create").click());
  expect(env.create).toHaveBeenCalledWith(expect.objectContaining({ label: "Kimi", kind: "api", apiKey: KEY }));
  expect(key.value).toBe("");
  expect(host.innerHTML).not.toContain(KEY);
});

it("a subscription add form has no key field", () => {
  act(() => root.render(h(AddForm, { kind: "subscription", onCancel: vi.fn(), onCreated: vi.fn() })));
  expect(host.querySelector('input[type="password"]')).toBeNull();
});
