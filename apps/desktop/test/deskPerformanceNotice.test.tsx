// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), cleanIpcMessage: (m: string) => m, bridge: { on: () => () => {}, window: { desk: {} } } }));
vi.mock("../src/renderer/src/i18n", async original => ({ ...await original<object>(), useI18n: () => ({ t: (key: string) => ({ "creation.experimental": "实验功能", "ownerNotify.ack": "知道了", ...zhCN })[key as keyof typeof zhCN] ?? key }) }));
import { zhCN, en } from "../src/renderer/src/lib/deskMessages";
import { DeskPerformanceNotice } from "../src/renderer/src/components/DeskPerformanceNotice";
import { MultiWindowRow } from "../src/renderer/src/components/settings/AppSettings";
import { adoptShellState, multiWindowOn } from "../src/renderer/src/lib/multiWindowPref";
import { getUiPrefs, setUiPref } from "../src/renderer/src/lib/prefs";
import type { ShellState } from "../src/shared/ipc";
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const setOn = (on: boolean) => act(() => adoptShellState({ prefs: { multiWindow: on } } as ShellState));
const render = (count: number) => act(() => root.render(h(DeskPerformanceNotice, { count })));
beforeEach(() => { localStorage.clear(); setUiPref("deskPerformanceHintDone", false); setOn(false); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); setOn(false); });

it("keeps multi-window default-off and suppresses the notice while off even with open desks", () => {
  expect(multiWindowOn()).toBe(false);
  render(4); expect(host.textContent).toBe("");
});
it("shows at three open desks, and not at zero, one or two", () => {
  setOn(true);
  for (const count of [0, 1, 2]) { render(count); expect(host.querySelector('[role="status"]')).toBeNull(); }
  for (const count of [3, 4]) { render(count); expect(host.textContent).toContain(zhCN["desk.performanceHint"]); }
  setOn(false); expect(host.textContent).toBe("");
});
it("remains dismissible after falling below and returning to the threshold", () => {
  setOn(true); render(3); render(2); expect(host.textContent).toBe(""); render(3);
  expect(host.querySelector("button")!.textContent).toBe("知道了");
});
it("acknowledgment survives remount, more windows and a prefs reload", async () => {
  setOn(true); render(3);
  act(() => host.querySelector("button")!.click());
  expect(host.textContent).toBe(""); expect(getUiPrefs().deskPerformanceHintDone).toBe(true);
  act(() => root.unmount()); root = createRoot(host); render(8); expect(host.textContent).toBe("");
  expect(JSON.parse(localStorage.getItem("cutex-desktop.ui")!).deskPerformanceHintDone).toBe(true);
  vi.resetModules();
  expect((await import("../src/renderer/src/lib/prefs")).getUiPrefs().deskPerformanceHintDone).toBe(true);
});
it("uses the existing experimental badge and gives the same CPU, typing and window advice in Settings", () => {
  act(() => root.render(h(MultiWindowRow)));
  expect(host.querySelector('[data-tag="neutral"]')!.textContent).toBe("实验功能");
  expect(host.textContent).toContain(zhCN["desk.performanceHint"]);
  expect(en["desk.settingHint"]).toContain(en["desk.performanceHint"]);
  expect(en["desk.performanceHint"]).toContain("CPU");
  expect(en["desk.performanceHint"]).toContain("typing");
});
