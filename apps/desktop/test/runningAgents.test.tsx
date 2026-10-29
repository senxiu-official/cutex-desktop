// @vitest-environment jsdom
// 正在运行的智能体 widget (docs/widget-authoring-guide.md): declaration, defaults, the pure selection / timing logic,
// and rendering at a normal and at the smallest size.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const rowOf = (id: string, host: string, status: string, since: string | null) => ({ id, name: `agent-${id}`, status, hostId: host, session: { cutexSessionId: id, avatar: null, runtime: { activeTurnObservedAt: since } } });
const NOW = Date.UTC(2026, 9, 22, 3, 0, 0);
const ROWS = [
  rowOf("a", "local", "running", new Date(NOW - 5 * 60000).toISOString()),
  rowOf("b", "remote", "running", new Date(NOW - 90 * 60000).toISOString()),
  rowOf("c", "local", "idle", null),
  rowOf("d", "local", "running", null),
];
// Another host's row: its step comes from the session resource's activity projection.
(ROWS[1]!.session as Record<string, unknown>).activity = { lastToolCall: { displayText: "$ cargo test", updatedAt: new Date(NOW - 60000).toISOString() } };
vi.mock("../src/renderer/src/lib/scopedSidebarView", () => ({
  useScopedSidebar: () => ({ scope: { focus: "local" }, model: { groups: [{ online: ROWS }], chats: [] } }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { useApp } from "../src/renderer/src/store";
import mod, { RUNNING_AGENTS } from "../src/renderer/src/modules/running-agents";
import { RunningAgentsWidget } from "../src/renderer/src/modules/running-agents/RunningAgents";
import { longElapsed, minutesRunning, rowsThatFit, runningAgents } from "../src/renderer/src/modules/running-agents/runs";
import { settingsOf } from "../src/renderer/src/modules/home/desk";
import type { DesktopWidgetItem, DesktopWidgetProps } from "../src/renderer/src/modules/widgetTypes";

const kind = (mod.contributes!["desktop.widget"] as DesktopWidgetItem[])[0]!;

const props = (over: Partial<DesktopWidgetProps> = {}): DesktopWidgetProps => ({
  instanceId: RUNNING_AGENTS, width: 288, height: 224, steps: { w: 36, h: 28 }, cells: { w: 3, h: 2 }, units: { w: 5, h: 4 }, theme: "light", settings: settingsOf(kind, undefined), setSettings: () => {}, reducedMotion: false, arranging: false, now: NOW, hostId: "local", source: { kind: "module" },
  actions: { openAgent: async () => true, openPage: () => false, openService: async () => false, sendToAgent: async () => false },
  ...over,
});

describe("running agents: declaration", () => {
  it("declares its kind", () => {
    expect(kind.id).toBe(RUNNING_AGENTS);
    expect(kind.size).toEqual({ min: [24, 12], max: [60, 60], default: [36, 28], units: { min: [4, 2], max: [10, 10], default: [6, 4] } });
    expect(kind.multiple).toBe(true);
    expect(kind.refresh).toBe("minute");
    expect(kind.settings!.map((f) => f.key)).toEqual(["maxRows", "scope"]);
  });
  it("its defaults pass its own schema", () => {
    expect(settingsOf(kind, kind.defaults as never)).toEqual(kind.defaults);
  });
});

describe("running agents: logic", () => {
  it("keeps running rows, longest-running first, unknown start last", () => {
    expect(runningAgents(ROWS as never, "local", false).map((r) => r.row.id)).toEqual(["b", "a", "d"]);
  });
  it("this host only", () => {
    expect(runningAgents(ROWS as never, "local", true).map((r) => r.row.id)).toEqual(["a", "d"]);
  });
  it("elapsed time", () => {
    expect(minutesRunning(null, NOW)).toBeNull();
    expect(minutesRunning(NOW + 5000, NOW)).toBe(0);
    expect([4, 65, 59, 1500].map(longElapsed)).toEqual(["4m", "1h05", "59m", "1d"]);
  });
  it("rows that fit", () => {
    expect(rowsThatFit(224, 5)).toBe(4);
    expect(rowsThatFit(96, 5)).toBe(1);
    expect(rowsThatFit(640, 3)).toBe(3);
  });
});

describe("running agents: render", () => {
  it("lists the running agents, newest settings applied", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(RunningAgentsWidget, props())));
    const ids = [...host.querySelectorAll("[data-running-agent]")].map((e) => e.getAttribute("data-running-agent"));
    expect(ids).toEqual(["b", "a", "d"].slice(0, 3));
    expect(host.textContent).toContain("1h30");
    expect(host.textContent).toContain("5m");
    act(() => root.render(h(RunningAgentsWidget, props({ settings: { maxRows: 5, scope: "focus" } }))));
    expect([...host.querySelectorAll("[data-running-agent]")].map((e) => e.getAttribute("data-running-agent"))).toEqual(["a", "d"]);
    act(() => root.unmount());
  });
  it("the step line: the focus host's activity map, another host's projection, else 工作中 — no open view needed", () => {
    act(() => useApp.setState({ activity: { a: { kind: "tool", text: "$ npm test", at: NOW - 30000 } } }));
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(RunningAgentsWidget, props())));
    const line = (id: string) => host.querySelector(`[data-running-agent='${id}'] .home-sub`)?.textContent;
    expect(line("a")).toBe("$ npm test");
    expect(line("b")).toBe("$ cargo test");
    expect(line("d")).toBe("turn.activity.working");
    act(() => root.unmount());
    act(() => useApp.setState({ activity: {} }));
  });
  it("keeps room for the 「还有 N 个」 line when rows overflow", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(RunningAgentsWidget, props({ height: 180 }))));
    // 180 px: three rows alone (48 + 3 × 44 = 180), but three are running and fit, so no count line.
    expect(host.querySelectorAll("[data-running-agent]").length).toBe(3);
    expect(host.textContent).not.toContain("running-agents.more");
    act(() => root.render(h(RunningAgentsWidget, props({ height: 170 }))));
    // 170 px: two rows fit; one more is running → two rows and 「还有 1 个」 in the 20 px left (48 + 88 + 20 ≤ 170).
    expect(host.querySelectorAll("[data-running-agent]").length).toBe(2);
    expect(host.textContent).toContain('running-agents.more {"n":1}');
    act(() => root.unmount());
  });
  it("at the smallest size shows one row and the rest as a count", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(RunningAgentsWidget, props({ width: 192, height: 96, steps: { w: 24, h: 12 } }))));
    expect(host.querySelectorAll("[data-running-agent]").length).toBe(1);
    expect(host.textContent).toContain("running-agents.more");
    act(() => root.unmount());
  });
  it("click opens the agent through the action; nothing while arranged", () => {
    const openAgent = vi.fn(async () => true);
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(RunningAgentsWidget, props({ actions: { ...props().actions, openAgent } }))));
    act(() => (host.querySelector("[data-running-agent='a']") as HTMLElement).click());
    expect(openAgent).toHaveBeenCalledWith("local", "a");
    openAgent.mockClear();
    act(() => root.render(h(RunningAgentsWidget, props({ arranging: true, actions: { ...props().actions, openAgent } }))));
    act(() => (host.querySelector("button") as HTMLElement).click());
    expect(openAgent).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
