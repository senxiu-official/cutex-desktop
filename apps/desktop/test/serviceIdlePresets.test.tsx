// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ServiceView } from "../src/shared/ipc";
import { SERVICES_IDLE_PRESETS_FEATURE } from "../src/shared/servicesSettings";
import type { MenuAction } from "../src/renderer/src/lib/contextMenu";

const f = vi.hoisted(() => ({ patch: vi.fn(), action: vi.fn(), error: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({
  api: { patchService: f.patch, serviceAction: f.action },
  apiFor: () => ({ patchService: f.patch, serviceAction: f.action, serviceTile: async () => null }),
  bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (text: string) => text,
}));
vi.mock("../src/renderer/src/i18n", async original => ({ ...await original<object>(), useI18n: () => ({ locale: "zh-CN", t: (key: string) => key }) }));
import { useApp } from "../src/renderer/src/store";
import { serviceMenu } from "../src/renderer/src/lib/services";
import { serviceStatus } from "../src/renderer/src/lib/status";
import { ServiceCards } from "../src/renderer/src/modules/services/ServiceCards";
import { zhCN } from "../src/renderer/src/modules/services/i18n";
import { en } from "../src/renderer/src/modules/services/i18n.en";
import { locales } from "../src/renderer/src/modules/services/i18n.locales";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const view = (extra: Partial<ServiceView> = {}): ServiceView => ({ slug: "web", displayName: "Web", host: "fixture", port: 31481, path: null,
  ownerCutexSessionId: null, projectId: null, runtime: "managed", lifetime: "persistent", health: "reachable", createdAt: "2026-11-04T00:00:00Z",
  lastSeenAt: null, url: "http://fixture:31481", localUrl: "http://127.0.0.1:31481", ...extra });
const menu = (service = view(), host = "local") => serviceMenu(service, key => key, f.error, undefined, host).filter((entry): entry is MenuAction => !!entry && typeof entry === "object");
let root: Root | undefined, div: HTMLDivElement | undefined;
beforeEach(() => {
  f.patch.mockReset().mockResolvedValue({}); f.action.mockReset().mockResolvedValue({}); f.error.mockReset();
  useApp.setState({ hosts: null, features: new Set([SERVICES_IDLE_PRESETS_FEATURE]), byHost: {} });
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; div?.remove(); div = undefined; });

it("offers all four presets only on capable persistent managed services", () => {
  const choice = menu().find(entry => entry.label === "services.idleStop")!;
  expect(Array.isArray(choice.submenu)).toBe(true);
  const children = choice.submenu as { label: string; info: string; onSelect(): void }[];
  expect(children.every(child => child.info === "services.idleStop.hint")).toBe(true);
  expect(children.map(child => child.label)).toEqual(["services.idleStop.1h", "services.idleStop.24h", "services.idleStop.7d", "✓ services.idleStop.forever"]);
  children[0]!.onSelect(); expect(f.patch).toHaveBeenCalledWith("web", { idleStopPreset: "1h" }); expect(f.action).not.toHaveBeenCalled();
  for (const service of [view({ runtime: "external" }), view({ runtime: "static" }), view({ lifetime: "ephemeral" }), view({ archived: true }), view({ youMayManage: false })])
    expect(menu(service).some(entry => entry.label === "services.idleStop")).toBe(false);
});

it("keeps old-host menus unchanged and scopes the gate to the service host", () => {
  useApp.setState({ features: new Set(), byHost: { remote: { features: new Set([SERVICES_IDLE_PRESETS_FEATURE]) } } as never });
  expect(menu().some(entry => entry.label === "services.idleStop")).toBe(false);
  expect(menu(view(), "remote").some(entry => entry.label === "services.idleStop")).toBe(true);
});

it("wakes through the explicit start action and treats a sleeper with past restarts as inactive", () => {
  const sleeper = view({ health: "stoppedIdle", stoppedIdle: true, stoppedIdleAt: "2026-11-04T01:00:00Z", process: { pid: null, startedAt: null, restarts: 9, lastExitCode: 1, lastExitAt: null, nextRestartAt: null } });
  expect(serviceStatus(sleeper)).toBe("stopped");
  menu(sleeper).find(entry => entry.label === "services.wake")!.onSelect();
  expect(f.action).toHaveBeenCalledWith("web", "start"); expect(f.patch).not.toHaveBeenCalled();
  expect(menu(view({ health: "stopped", stopped: true })).some(entry => entry.label === "services.start")).toBe(true);
});

it("shows the actual sleep time on the service card without a tile fetch or wake", () => {
  const slept = "2026-11-04T01:00:00Z";
  div = document.createElement("div"); document.body.appendChild(div); root = createRoot(div);
  act(() => root!.render(h(ServiceCards, { rows: [{ hostId: "local", key: "local/web", item: view({ health: "stoppedIdle", stoppedIdleAt: slept }) }],
    ownerName: () => "owner", hostName: () => "fixture", stale: () => false, tileEnabled: () => false, organizable: () => false, menu: () => [], refresh: async () => {}, error: f.error })));
  expect(div.textContent).toContain("services.health.stoppedIdle"); expect(div.textContent).toContain(new Date(slept).toLocaleString());
  expect(f.action).not.toHaveBeenCalled();
});

it("provides explicit direct-port guidance and translations for every app locale", () => {
  const keys = Object.keys(zhCN).filter(key => key.startsWith("services.idleStop") || ["services.wake", "services.health.stoppedIdle", "services.idleWakeFailed"].includes(key)) as (keyof typeof zhCN)[];
  expect(zhCN["services.idleStop.hint"]).toContain("直连端口"); expect(en["services.idleStop.hint"]).toContain("direct-port");
  for (const values of [en, ...Object.values(locales)]) for (const key of keys) expect(values[key]).toBeTruthy();
});
