// Settings host scope (review 2026-10-15 UI-01 / UI-02): a picked Settings host that goes offline stays
// the target (unavailable, no edits, never another host), and the host parts of 浏览器 / 通知 edit the
// Settings target, not the focus host.
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HOST_PALETTE, type HostsState, type HostView } from "../src/shared/hosts";
import type { DaemonState } from "../src/shared/ipc";

const A = "ssh-aaaa1111"; // the host picked in Settings
const B = "local"; // the focus host

const fx = vi.hoisted(() => {
  const calls: { host: string; method: string; arg?: unknown }[] = [];
  const daemon = (host: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => (arg?: unknown) => {
          calls.push({ host, method, arg });
          if (method === "patchNotificationLevels" || method === "notificationLevels") return Promise.resolve({ host });
          return Promise.resolve(null);
        },
      },
    );
  const apis = new Map<string, unknown>();
  const apiFor = (host: string) => {
    if (!apis.has(host)) apis.set(host, daemon(host));
    return apis.get(host);
  };
  return { calls, focusApi: daemon("<focus-api>"), apiFor, state: {} as Record<string, unknown> };
});

vi.mock("../src/renderer/src/bridge", () => ({ api: fx.focusApi, apiFor: fx.apiFor, bridge: { api: fx.focusApi } }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}(${Object.values(p).join(",")})` : key), locale: "en" }) }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select(fx.state), { getState: () => fx.state, setState: () => {}, subscribe: () => () => {} }),
  agentHost: (s: { hosts: HostsState | null }) => s.hosts?.active ?? "local",
  featuresOf: () => new Set<string>(),
}));
// Pieces of the notifications page that need the module host: not under test here.
vi.mock("../src/renderer/src/modules/react", () => ({ useSlot: () => [] }));
vi.mock("../src/renderer/src/modules/Outlet", () => ({ SettingsSections: () => null }));
vi.mock("../src/renderer/src/lib/notifyDevice", () => ({ useDeviceOff: () => ({}), setDeviceOff: () => {} }));
vi.mock("../src/renderer/src/lib/notificationLevelsStore", () => ({
  useNotificationLevels: () => ({ supported: true, view: null, error: null }),
  patchNotificationLevels: (patch: unknown) => {
    fx.calls.push({ host: "<focus-store>", method: "patchNotificationLevels", arg: patch });
    return Promise.resolve({});
  },
}));

import { resolveSettingsTarget, setSettingsHost, settingsHostChoice } from "../src/renderer/src/lib/settingsHost";
import { resolveHostScope } from "../src/renderer/src/lib/hostScope";
import { daemonApiOf, TargetHostContext, useTargetFeatures, useTargetHostId, useTargetSidebar } from "../src/renderer/src/lib/targetHost";
import { HeldHostDataContext } from "../src/renderer/src/lib/heldHostData";
import { SettingsHostFrame, SettingsHostPart } from "../src/renderer/src/components/SettingsHostFrame";
import { Section } from "../src/renderer/src/components/settings/Form";
import { patchHostNotificationLevels, projectMutePatch } from "../src/renderer/src/modules/notifications/targetLevels";
import { NotificationsPage } from "../src/renderer/src/modules/notifications/NotificationsPage";

const online = (hostId: string): DaemonState => ({ kind: "connected", baseUrl: "mock://", hostId });
const up = { status: "up" as const, localPort: 1, error: null, attempt: 0, retryAt: null, upSince: 1 };
type AState = "online" | "off" | "retrying" | "removed";

function hostsState(a: AState): HostsState {
  const views: HostView[] = [
    { id: B, kind: "local", label: "HOST-B", target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, autoConnect: true, color: HOST_PALETTE[0], platform: "linux", conn: { epoch: "e-b", tunnel: null, daemon: online(B), cutexBuild: null } },
  ];
  if (a !== "removed") {
    const conn =
      a === "online"
        ? { conn: { epoch: "e-a", tunnel: up, daemon: online(A), cutexBuild: null } }
        : a === "retrying"
          ? { conn: { epoch: "e-a", tunnel: { ...up, status: "retrying" as const, retryAt: 9 }, daemon: { kind: "unreachable" as const, baseUrl: "", message: "timeout" }, cutexBuild: null } }
          : {};
    views.push({ id: A, kind: "ssh", label: "HOST-A", target: "host-a", remotePort: 24270, cutexPath: "cutex", paired: true, lastConnectedAt: null, autoConnect: false, color: HOST_PALETTE[1], platform: "linux", ...conn });
  }
  return { scope: { kind: "host", id: B }, active: B, startOn: "last", hosts: views, groups: [], tunnel: null, weakSecretStorage: false };
}

const projectsOf = (...ids: string[]) => ({ projects: { projects: ids.map((id) => ({ project_id: id, presentation: { display_name: `project ${id}`, badge_label: "", color: null } })) } });

/** Store state: focus B; A as given. A's slice exists while it has a connection. */
function setState(a: AState, aFeatures: string[] = ["notification-levels", "browser-relay-v1"]) {
  const hosts = hostsState(a);
  const byHost: Record<string, unknown> =
    a === "online" || a === "retrying"
      ? { [A]: { epoch: "e-a", daemon: a === "online" ? online(A) : { kind: "unreachable", baseUrl: "", message: "timeout" }, features: new Set(aFeatures), featuresKnown: true, sidebar: projectsOf("alpha-project"), approvals: null, services: null, waiting: null } }
      : {};
  Object.assign(fx.state, { hosts, daemon: online(B), byHost, features: new Set(["notification-levels", "browser-relay-v1"]), featuresKnown: true, sidebar: projectsOf("focus-project"), approvals: null, services: null, selectedHost: null });
  return resolveHostScope({ hosts, daemon: online(B), byHost: byHost as never });
}

/** What a page inside a frame / part sees as its target. */
function Probe() {
  return h("span", { "data-probe": useTargetHostId() }, [...useTargetFeatures()].sort().join(" "), " | ", (useTargetSidebar()?.projects?.projects ?? []).map((p) => p.project_id).join(" "));
}

beforeEach(() => {
  fx.calls.length = 0;
  setSettingsHost(null);
});

describe("UI-01: a picked Settings host that disconnects stays the target", () => {
  it("A picked while online: A, available", () => {
    expect(resolveSettingsTarget(setState("online"), A)).toEqual({ hostId: A, available: true });
  });

  it("A disconnects (⏻ off or retrying): still A, unavailable — never the focus host B", () => {
    expect(resolveSettingsTarget(setState("off"), A)).toEqual({ hostId: A, available: false });
    expect(resolveSettingsTarget(setState("retrying"), A)).toEqual({ hostId: A, available: false });
  });

  it("no write goes to B while A is the offline target: A's own connection, the frame disabled", async () => {
    const scope = setState("off");
    const target = resolveSettingsTarget(scope, A);
    // Daemon calls of the target are A's (they fail while it is off) — not the focus api.
    expect(daemonApiOf(target.hostId, scope.focus)).toBe(fx.apiFor(A));
    expect(daemonApiOf(target.hostId, scope.focus)).not.toBe(fx.focusApi);
    await patchHostNotificationLevels(target.hostId, scope.focus, { methods: { preset: "quiet" } });
    expect(fx.calls.map((c) => c.host)).toEqual([A]);
    // The page stays (drafts kept), says why, and its controls are disabled.
    const html = renderToStaticMarkup(h(SettingsHostFrame, { target, children: h("input", { defaultValue: "draft" }) }));
    expect(html).toContain(`data-settings-host-offline="${A}"`);
    expect(html).toContain("settings.hostOffline(HOST-A)");
    expect(html).toMatch(/<fieldset disabled="" data-settings-host="ssh-aaaa1111"/);
    expect(html).toContain('value="draft"');
  });

  it("an offline target keeps showing what it last reported (held data), not an empty page", () => {
    // Read once while online (the frame remembers it), then A goes off.
    renderToStaticMarkup(h(SettingsHostFrame, { target: resolveSettingsTarget(setState("online"), A), children: h(Probe) }));
    const html = renderToStaticMarkup(h(SettingsHostFrame, { target: resolveSettingsTarget(setState("off"), A), children: h(Probe) }));
    expect(html).toContain(`data-probe="${A}"`);
    expect(html).toContain("browser-relay-v1 notification-levels | alpha-project");
    // The held data is A's only: another host's page under it reads live data.
    const other = renderToStaticMarkup(h(HeldHostDataContext.Provider, { value: { hostId: A, features: new Set(["x"]), featuresKnown: true, sidebar: null } }, h(TargetHostContext.Provider, { value: B }, h(Probe))));
    expect(other).toContain("focus-project");
    expect(other).not.toContain(">x");
  });

  it("A reconnects: the same target, available again, controls enabled, live data", () => {
    setState("off");
    expect(resolveSettingsTarget(setState("off"), A).available).toBe(false);
    const target = resolveSettingsTarget(setState("online"), A);
    expect(target).toEqual({ hostId: A, available: true });
    const html = renderToStaticMarkup(h(SettingsHostFrame, { target, children: h(Probe) }));
    expect(html).not.toContain("settings.hostOffline");
    expect(html).toMatch(/<fieldset data-settings-host="ssh-aaaa1111"/);
    expect(html).toContain("browser-relay-v1 notification-levels | alpha-project");
  });

  it("an explicit switch moves the target; a removed host falls back to the focus host", () => {
    setSettingsHost(A);
    expect(settingsHostChoice()).toBe(A);
    setSettingsHost(B);
    expect(resolveSettingsTarget(setState("online"), settingsHostChoice())).toEqual({ hostId: B, available: true });
    expect(resolveSettingsTarget(setState("removed"), A)).toEqual({ hostId: B, available: true });
    expect(resolveSettingsTarget(setState("online"), null)).toEqual({ hostId: B, available: true });
  });

  it("without a host list (older state) the focus host counts as available", () => {
    expect(resolveSettingsTarget({ focus: "local", host: () => null }, null)).toEqual({ hostId: "local", available: true });
  });
});

describe("UI-02: host parts edit the Settings target, not the focus host", () => {
  // Parts have no heading (owner 2026-10-19): the host is named by its cards' tags.
  const part = (children: ReactNode, requires?: string[]) => renderToStaticMarkup(h(SettingsHostPart, { title: "part.host", requires, children: [children, h(Section, { key: "card", title: "card", source: "host", children: "x" })] }));

  it("target ≠ focus: the part's pages read A and say so", () => {
    setState("online");
    setSettingsHost(A);
    const html = part(h(Probe));
    expect(html).toContain(`data-settings-part-host="${A}"`);
    expect(html).toContain(`data-probe="${A}"`);
    expect(html).toContain("alpha-project");
    expect(html).not.toContain("focus-project");
    expect(html).toContain("HOST-A");
  });

  it("no pick: the part edits the focus host, and still names it", () => {
    setState("online");
    const html = part(h(Probe));
    expect(html).toContain(`data-probe="${B}"`);
    expect(html).toContain("HOST-B");
  });

  it("the picked host offline: the part stays on A, unavailable", () => {
    setState("off");
    setSettingsHost(A);
    const html = part(h(Probe));
    expect(html).toContain(`data-probe="${A}"`);
    expect(html).toContain("settings.hostOffline(HOST-A)");
    expect(html).toContain("<fieldset disabled=");
  });

  it("a target without the part's capability shows 「需要升级 cutex」 instead of the rows", () => {
    setState("online", ["something-else"]);
    setSettingsHost(A);
    const html = part(h(Probe), ["browser-relay-v1"]);
    expect(html).toContain("modules.needsUpgrade(browser-relay-v1)");
    expect(html).not.toContain("data-probe");
  });

  it("notifications: target ≠ focus patches A only (按项目通知 is hidden until its sub-page, owner 2026-10-19)", async () => {
    setState("online");
    setSettingsHost(A);
    const html = renderToStaticMarkup(h(NotificationsPage));
    expect(html).toContain('data-settings-part="device"');
    expect(html).toContain(`data-settings-part-host="${A}"`);
    expect(html).not.toContain("project alpha-project");
    expect(html).not.toContain("project focus-project");
    await patchHostNotificationLevels(A, B, projectMutePatch(null, "alpha-project"));
    expect(fx.calls).toEqual([{ host: A, method: "patchNotificationLevels", arg: { projectOverrides: { "alpha-project": "mute" } } }]);
  });

  it("notifications: a legacy target (no notification-levels) shows the upgrade notice for its tables", () => {
    setState("online", ["browser-relay-v1"]);
    setSettingsHost(A);
    const html = renderToStaticMarkup(h(NotificationsPage));
    expect(html).toContain("modules.needsUpgrade(notification-levels)");
    expect(html).not.toContain("project alpha-project");
  });

  it("the focus host's tables still go through the shared store (bell, project menu)", async () => {
    await patchHostNotificationLevels(B, B, { events: { preset: "default" } });
    expect(fx.calls.map((c) => c.host)).toEqual(["<focus-store>"]);
  });
});
