// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ patch: vi.fn(), refresh: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, string>) => vars ? `${key} ${vars.source} ${vars.version}` : key }) }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ useTargetApi: () => ({ patchSettings: mocks.patch }) }));
vi.mock("../src/renderer/src/lib/componentStore", () => ({ loadComponents: mocks.refresh }));
import { OnboardingClaudeCli, type OnboardingCliChoice } from "../src/renderer/src/components/OnboardingClaudeCli";
let container: HTMLDivElement, root: Root;
const choice: OnboardingCliChoice = { selected: "bundled", bundledVersion: "2.1.301", systemVersion: "2.1.299", systemDetected: true };
beforeEach(() => {
  vi.clearAllMocks(); mocks.patch.mockResolvedValue({ claudeCli: "system" }); mocks.refresh.mockResolvedValue(undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(value = choice, disabled = false) { await act(async () => root.render(h(OnboardingClaudeCli, { choice: value, hostId: "remote-host", disabled }))); }
const buttons = () => [...container.querySelectorAll("button")];

it("shows the selected version and does not write a bundled default while rendering", async () => {
  await render();
  expect(container.textContent).toContain("2.1.301");
  expect(buttons()[0]!.getAttribute("aria-pressed")).toBe("true");
  expect(mocks.patch).not.toHaveBeenCalled();
  await act(async () => buttons()[0]!.click()); expect(mocks.patch).not.toHaveBeenCalled();
});
it("shows source/version but hides the choice when no system CLI was detected", async () => {
  await render({ ...choice, systemDetected: false, systemVersion: null });
  expect(buttons()).toHaveLength(0); expect(container.textContent).toContain("2.1.301");
});
it("sends only the host CLI preference and waits for authoritative component refresh", async () => {
  await render(); await act(async () => buttons()[1]!.click());
  expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({ claudeCli: "system" });
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith("remote-host");
  expect(container.getAttribute("data-onboarding-cli-source")).toBeNull();
  expect(container.querySelector('[data-onboarding-cli-source="bundled"]')).not.toBeNull();
  await render({ ...choice, selected: "system" });
  expect(container.textContent).toContain("2.1.299");
});
it("disables both choices during a pending request and does not send a second patch", async () => {
  let finish!: (value: unknown) => void;
  mocks.patch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); await act(async () => buttons()[1]!.click());
  expect(buttons().every(button => button.disabled)).toBe(true);
  await act(async () => buttons()[1]!.click()); expect(mocks.patch).toHaveBeenCalledTimes(1);
  await act(async () => finish({ claudeCli: "system" }));
});
it("reports an unconfirmed switch without changing the selection or exposing diagnostics", async () => {
  mocks.patch.mockRejectedValue(new Error("private host diagnostic"));
  await render(); await act(async () => buttons()[1]!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("onboarding.claudeRuntime.saveFailed");
  expect(container.textContent).not.toContain("private host diagnostic");
  expect(buttons()[0]!.getAttribute("aria-pressed")).toBe("true");
});
it("does not allow an offline or restricted host to change source", async () => {
  await render(choice, true); await act(async () => buttons()[1]!.click()); expect(mocks.patch).not.toHaveBeenCalled();
});
