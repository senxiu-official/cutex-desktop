// @vitest-environment jsdom
// Cross-review 2026-11-16 (gate-notice-review repro): the 服务 page used the focus host's read issue and refresh, so a
// healthy host-B project showed host A's busy line and kept refreshing host A. Issues are per host now.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const fx = vi.hoisted(() => {
  const refresh = vi.fn();
  const state = { hosts: { active: "host-a" }, servicesIssues: { "host-a": { code: "heavy_read_capacity_exceeded", detail: "host A is busy", retrying: true } } as Record<string, unknown>, refreshServices: refresh };
  const remote = { hostId: "host-b", services: [], features: new Set(["services"]), sidebar: null, daemon: { kind: "connected" } };
  const hosts = { data: [remote], missing: [], stale: new Set(), marks: false, multi: false, look: () => null };
  return { state, refresh, remote, hosts };
});
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s }));
vi.mock("../src/renderer/src/i18n", async original => ({ ...await original<object>(), useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: Object.assign((select: any) => select(fx.state), { getState: () => fx.state, setState: vi.fn(), subscribe: () => () => {} }) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { ui: {}, side: {} } }));
vi.mock("../src/renderer/src/lib/hostLists", () => ({ useListHosts: () => fx.hosts, openHostAgent: vi.fn() }));
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostData: () => fx.remote }));
vi.mock("../src/renderer/src/lib/projectIconSync", () => ({ useProjectIcons: () => ({}) }));
vi.mock("../src/renderer/src/components/ServiceClaimStrip", () => ({ ServiceClaimStrip: () => null }));
vi.mock("../src/renderer/src/components/Page", () => ({ PageBody: ({ children }: any) => children, PageToolbar: ({ children }: any) => children }));
import { ProjectServicesTab } from "../src/renderer/src/modules/services/ServicesPage";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
it("a healthy host B project must not display host A's read issue or retry host A", async () => {
  vi.useFakeTimers();
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(h(ProjectServicesTab, { hostId: "host-b", projectId: "project-b" })));
    expect(node.textContent).toContain("services.projectNone");
    expect.soft(node.querySelector("[data-read-issue]")).toBeNull();
    const initial = fx.refresh.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fx.refresh).toHaveBeenCalledTimes(initial);
  } finally { act(() => root.unmount()); node.remove(); vi.clearAllTimers(); vi.useRealTimers(); }
});

it("host B's own failed read shows on its project page and retries host B only", async () => {
  vi.useFakeTimers();
  fx.state.servicesIssues = { "host-a": fx.state.servicesIssues["host-a"], "host-b": { code: "heavy_read_capacity_exceeded", detail: "host B is busy", retrying: true } };
  fx.refresh.mockClear();
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(h(ProjectServicesTab, { hostId: "host-b", projectId: "project-b" })));
    expect(fx.refresh.mock.calls.map((c) => c[0])).toEqual(["host-b"]);
    const lines = [...node.querySelectorAll("[data-read-issue]")];
    expect(lines).toHaveLength(1);
    expect(lines[0]!.getAttribute("title")).toBe("host B is busy");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fx.refresh.mock.calls.map((c) => c[0])).toEqual(["host-b", "host-b"]);
  } finally { act(() => root.unmount()); node.remove(); vi.clearAllTimers(); vi.useRealTimers(); }
});
