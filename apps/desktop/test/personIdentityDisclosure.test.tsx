// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (value: string) => value }));
vi.mock("../src/renderer/src/lib/personIdentity", () => ({ usePersonIdentity: () => ({ loaded: true, fingerprint: "116d12345678", publicKey: "public", error: null }) }));
vi.mock("../src/renderer/src/lib/targetHost", async original => ({ ...(await original<object>()), useTargetHostId: () => "local" }));
vi.mock("../src/renderer/src/store", () => {
  const state = { hosts: { active: "local", hosts: [{ id: "local", label: "Local" }] }, daemon: { kind: "disconnected" } };
  return { useApp: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) };
});
import { PersonIdentityRows } from "../src/renderer/src/components/settings/PersonIdentityRows";
import { SettingsPage, Section, SettingRow } from "../src/renderer/src/components/settings/Form";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("keeps fingerprint identity visible and folds only cross-device key actions", () => {
  act(() => root.render(h(SettingsPage, { children: h(Section, { title: "You", children: [
    h(SettingRow, { key: "name", label: "Name", agents: "none", source: "local" }),
    h(PersonIdentityRows, { key: "identity" }),
  ] }) })));
  const fingerprint = host.querySelector('[data-testid="identity-fingerprint"]')!;
  expect(fingerprint).not.toBeNull();
  expect(fingerprint.closest("[hidden]")).toBeNull();
  const identity = fingerprint.closest("[data-setting-row]")!;
  expect(identity.textContent).toContain("identity.person.title");
  expect(identity.querySelector("[data-settings-agents]")).toBeNull();
  const disclosure = host.querySelector("[data-settings-disclosure]")!;
  const toggle = disclosure.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(panel.hidden).toBe(true);
  expect(panel.textContent).toContain("identity.person.keyHint");
  expect(panel.textContent).toContain("identity.person.copyKey");
  expect(panel.textContent).toContain("identity.person.pasteKey");
  expect(panel.textContent).toContain("identity.person.legacyFile");
  expect(panel.querySelector('[data-testid="identity-fingerprint"]')).toBeNull();
  const marker = disclosure.querySelector("[data-settings-agents]")!;
  expect(marker.getAttribute("data-settings-agents")).toBe("access");
  expect(marker.closest("[data-effect-markers]")!.parentElement).toBe(disclosure.querySelector("[data-disclosure-title]")!.parentElement);
  act(() => toggle.click()); expect(panel.hidden).toBe(false);
  act(() => toggle.click()); expect(panel.hidden).toBe(true);
  expect(host.querySelector('[data-testid="identity-fingerprint"]')).toBe(fingerprint);
});
