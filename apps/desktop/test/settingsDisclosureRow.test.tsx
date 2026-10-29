// @vitest-environment jsdom
import { act, createElement as h, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsGroup, SettingsPage, Section, SettingRow } from "../src/renderer/src/components/settings/Form";
import { SettingsDisclosureRow } from "../src/renderer/src/components/settings/SettingsDisclosureRow";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (value: string) => value }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/lib/targetHost", async original => ({ ...(await original<object>()), useTargetHostId: () => "local" }));
vi.mock("../src/renderer/src/store", () => {
  const state = { hosts: { active: "local", hosts: [{ id: "local", label: "Local" }] }, daemon: { kind: "disconnected" } };
  return { useApp: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

it("uses one accessible chevron row, consistent text roles and a right-aligned warning status", () => {
  const change = vi.fn();
  act(() => root.render(h(SettingsDisclosureRow, { title: "5 accounts", summary: "Shared default", status: "2 need attention", attention: true, open: false, onOpenChange: change, children: "Accounts" })));
  const button = host.querySelector("button")!;
  expect(button.type).toBe("button"); expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.parentElement!.classList.contains("py-2.5")).toBe(true);
  const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
  expect(panel.hidden).toBe(true); expect(panel.textContent).toBe("Accounts");
  expect(button.parentElement!.querySelectorAll("svg")).toHaveLength(1);
  expect(button.parentElement!.querySelector("svg")!.getAttribute("width")).toBe("14");
  expect(button.parentElement!.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  expect(button.parentElement!.querySelector("[data-disclosure-title]")!.classList.contains("font-normal")).toBe(true);
  expect(button.parentElement!.querySelector("[data-disclosure-title]")!.classList.contains("text-foreground")).toBe(true);
  expect(button.parentElement!.querySelector("[data-disclosure-summary]")!.classList.contains("text-muted")).toBe(true);
  const status = button.parentElement!.querySelector("[data-disclosure-status]")!;
  expect(status.classList.contains("ml-auto")).toBe(true); expect(status.classList.contains("text-warn")).toBe(true);
  act(() => button.click()); expect(change).toHaveBeenCalledWith(true);
});

it("keeps the panel mounted and preserves input state when closed and reopened", () => {
  const mounted = vi.fn();
  function Draft() { useEffect(mounted, []); return h("input", { defaultValue: "initial" }); }
  function Example() {
    const [open, setOpen] = useState(false);
    return h(SettingsDisclosureRow, { title: "Import", open, onOpenChange: setOpen, children: h(Draft) });
  }
  act(() => root.render(h(Example)));
  const button = host.querySelector("button")!; const input = host.querySelector("input")!;
  const panelId = button.getAttribute("aria-controls")!;
  act(() => button.click()); input.value = "unsaved selection";
  act(() => button.click()); expect(document.getElementById(panelId)!.hidden).toBe(true);
  act(() => button.click());
  expect(host.querySelector("input")).toBe(input); expect(input.value).toBe("unsaved selection");
  expect(document.getElementById(panelId)!.hidden).toBe(false);
  expect(button.parentElement!.querySelector("svg")!.classList.contains("rotate-90")).toBe(true);
  expect(mounted).toHaveBeenCalledTimes(1);
});

it("moves inherited custom-group markers beside the disclosure title without nesting buttons", () => {
  act(() => root.render(h(SettingsPage, { children: h(Section, { title: "Mixed", children: [
    h(SettingsGroup, { key: "import", agents: "newAgents", source: "host", children: h("div", { children: h(SettingsDisclosureRow, { title: "Import", open: false, onOpenChange: () => {}, children: "Draft" }) }) }),
    h(SettingRow, { key: "other", agents: "none", source: "local", label: "Other" }),
  ] }) })));
  const disclosure = host.querySelector("[data-settings-disclosure]")!;
  const marker = disclosure.querySelector("[data-effect-markers]")!;
  expect(marker).not.toBeNull();
  expect(marker.parentElement).toBe(disclosure.querySelector("[data-disclosure-title]")!.parentElement);
  expect(disclosure.parentElement!.querySelectorAll("[data-effect-markers]")).toHaveLength(1);
  expect(disclosure.querySelector("button button")).toBeNull();
  const button = disclosure.querySelector("button[aria-expanded]")!;
  expect(button.getAttribute("aria-labelledby")).toBe(disclosure.querySelector("[data-disclosure-title]")!.id);
});
