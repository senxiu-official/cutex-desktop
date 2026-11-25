// @vitest-environment jsdom
// Auto-switch cancellation on the real store (cross-review 2026-11-24, roster-bottom-review repro; only the bridge mocked):
// a switch given up (timeout / the owner moved) never selects later when the host's scope arrives, and an app-made
// open of an agent shown in another window keeps it unread (no jump). lib/services openOnItsHost, store openAgent.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ app: null as any, scope: null as any, opened: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_, key) => (..._args: unknown[]) => key === "setScope" ? fx.scope : Promise.resolve(undefined) });
  return { api, apiFor: () => api, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (s: string) => s };
});
vi.mock("../src/renderer/src/modules/app", () => ({ services: { side: { open: (...a: unknown[]) => (fx.opened(...a), { status: "opened" }) } } }));
vi.mock("../src/renderer/src/lib/sideServices", () => ({ sideShowsHost: (id: string) => fx.app?.getState().selectedHost === id }));
let resolveScope!: () => void;
let openOnItsHost: typeof import("../src/renderer/src/lib/services").openOnItsHost;
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  fx.opened.mockClear();
  fx.scope = new Promise<void>(resolve => { resolveScope = resolve; });
  const store = await import("../src/renderer/src/store");
  fx.app = store.useApp;
  store.setOpenRouter(null);
  fx.app.setState({
    hosts: { active: "local", scope: { kind: "host", id: "local" }, hosts: [{ id: "local", label: "Local" }, { id: "remote", label: "Remote" }] },
    features: new Set(), selectedId: "here", selectedHost: "local", view: { kind: "conversation" },
    byHost: { remote: { sidebar: { active: [{ cutexSessionId: "remote-agent", visible: true, lifecycle: "active", retiredAt: null, archiveKind: "active", lastActivityAt: "2026-11-24T00:00:00Z", native: { threadId: "t" }, runtime: {} }], retired: [], projects: null, hostRows: {} }, features: new Set() } },
  });
  openOnItsHost = (await import("../src/renderer/src/lib/services")).openOnItsHost;
}, 60000);
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const finishScopeSwitch = async () => {
  fx.app.setState((s: any) => ({ hosts: { ...s.hosts, scope: { kind: "all" } } }));
  resolveScope();
  await drain();
};
it("timeout cancels the delayed real openAgent selection too", async () => {
  const pending = openOnItsHost("board", "remote", "/");
  await vi.advanceTimersByTimeAsync(4001);
  expect(await pending).toBe("not-switched");
  expect(fx.app.getState().selectedId).toBe("here");
  await finishScopeSwitch();
  expect(fx.app.getState().selectedId).toBe("here");
  expect(fx.opened).not.toHaveBeenCalled();
});
it("a later owner selection survives the delayed real openAgent selection", async () => {
  const pending = openOnItsHost("board", "remote", "/");
  fx.app.setState({ selectedId: "owner-new-choice", selectedHost: "local" });
  expect(await pending).toBe("moved");
  await finishScopeSwitch();
  expect(fx.app.getState().selectedId).toBe("owner-new-choice");
  expect(fx.opened).not.toHaveBeenCalled();
});
it("keepUnread survives routing to the agent's existing desk window", async () => {
  const store = await import("../src/renderer/src/store");
  const { usePanes } = await import("../src/renderer/src/lib/paneStore");
  const { defaultLayout } = await import("../src/renderer/src/lib/paneLayout");
  const { useDesks } = await import("../src/renderer/src/lib/deskStore");
  const { routeOpen } = await import("../src/renderer/src/lib/windowRoute");
  const { recordTurnEndOn, turnMarksOn, unreadCount } = await import("../src/renderer/src/lib/turnUnread");
  const desk = "d000000000001";
  useDesks.setState({ desks: [{ deskId: desk, handle: {}, content: { kind: "conversation", hostId: "remote", sessionId: "remote-agent" } }] as never });
  usePanes.of(desk).setState({ layout: defaultLayout({ sidebarOpen: true, sidebarWidth: 220, hostId: "remote", sessionId: "remote-agent" }) });
  fx.app.setState((s: any) => ({ hosts: { ...s.hosts, scope: { kind: "all" } } }));
  recordTurnEndOn("remote", "remote-agent", { turnId: "unread-1", status: "completed" }, false);
  expect(unreadCount(turnMarksOn("remote")["remote-agent"])).toBe(1);
  store.setOpenRouter(routeOpen);
  await fx.app.getState().openAgent("remote-agent", "remote", { keepUnread: true });
  await drain();
  expect(unreadCount(turnMarksOn("remote")["remote-agent"])).toBe(1);
});
