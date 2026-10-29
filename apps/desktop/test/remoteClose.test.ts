// Remote close of a desktop client (cutex `client-remote-close`, docs/research/remote-close-desktop-20261019.md):
// wire readers / bodies, host event filtering, presence + heartbeat scheduling (main/clientPresence.ts with
// a fake daemon), the countdown (cancel / timeout / immediate / joined requests / hanging reports), and the
// 「在线的桌面」 gating.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { clientPresenceBody, closeGraceSeconds, readClientCloseRequested, readClientPresenceReply, readOnlineClients, type ClientCloseRequested } from "@cutex-desktop/cutex-client";
import {
  applyClientState,
  clientStateChangeOf,
  closeGate,
  closeRequestFor,
  dropRelaunchLeftovers,
  presenceDelayMs,
  QUIT_WATCHDOG_MS,
  presenceRetryable,
  RemoteCloseCountdown,
  REPORT_TIMEOUT_MS,
  secondsLeft,
  sortOnlineClients,
  type OnlineClientView,
  type RemoteCloseView,
} from "../src/shared/remoteClose";
import { ClientPresenceService, EXIT_REPORT_TIMEOUT_MS, loadInstallId } from "../src/main/clientPresence";
import { parsePrefs } from "../src/shared/shell";

const ME = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

const env = (method: string, params: unknown): EventEnvelope =>
  ({ contractVersion: 2, eventId: "e1", cursor: "c1", streamId: "s", sequence: 1, receivedAt: "", cutexSessionId: "cutex.host", hostId: "H", sensitivity: "owner", correlation: {}, source: "cutex", cutex: { method, params } }) as unknown as EventEnvelope;
const closeReq = (instanceId: string, extra: Record<string, unknown> = {}) => env("cutex/client/closeRequested", { instanceId, requestedBy: { deviceName: "host-a", userId: "owner", local: false }, graceSeconds: 15, at: "2026-10-19T10:00:00Z", ...extra });

describe("wire", () => {
  it("presence body: bounded fields, ids checked, allowRemoteClose defaults on", () => {
    const body = clientPresenceBody({ installId: ME, instanceId: OTHER, appName: "cutex-desktop", appVersion: "0.1.6", deviceName: " host-a ", platform: "win32", allowRemoteClose: true });
    expect(body).toEqual({ installId: ME, instanceId: OTHER, appName: "cutex-desktop", appVersion: "0.1.6", deviceName: "host-a", platform: "win32", allowRemoteClose: true });
    expect(clientPresenceBody({ ...body, allowRemoteClose: false }).allowRemoteClose).toBe(false);
    expect(() => clientPresenceBody({ ...body, instanceId: "../x" })).toThrow(/instance/);
  });

  it("presence reply: heartbeat clamped, default 60", () => {
    expect(readClientPresenceReply({ instanceId: ME, heartbeatSeconds: 60 }, ME)).toEqual({ instanceId: ME, heartbeatSeconds: 60, state: "online", closeRequest: null });
    expect(readClientPresenceReply({ heartbeatSeconds: 1 }, ME).heartbeatSeconds).toBe(15);
    expect(readClientPresenceReply({ heartbeatSeconds: 99999 }, ME).heartbeatSeconds).toBe(600);
    expect(readClientPresenceReply(null, ME)).toEqual({ instanceId: ME, heartbeatSeconds: 60, state: "online", closeRequest: null });
  });

  it("client list: tolerant rows, unknown state reads online, rows without id dropped", () => {
    const rows = readOnlineClients({ clients: [{ instanceId: ME, deviceName: "host-a", appVersion: "0.1.5", state: "closing", allowRemoteClose: false, current: true, tokenId: null }, { deviceName: "no id" }, { instanceId: OTHER, state: "weird" }] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ instanceId: ME, state: "closing", allowRemoteClose: false, current: true, tokenId: null, userId: null });
    expect(rows[1]).toMatchObject({ instanceId: OTHER, state: "online", allowRemoteClose: true, current: false });
    expect(readOnlineClients({})).toEqual([]);
  });

  it("close request: grace 15 by default, clamped", () => {
    expect(closeGraceSeconds(undefined)).toBe(15);
    expect(closeGraceSeconds(0)).toBe(3);
    expect(closeGraceSeconds(1000)).toBe(120);
    expect(readClientCloseRequested({ instanceId: ME })).toMatchObject({ instanceId: ME, graceSeconds: 15, requestedBy: { deviceName: null, userId: null, local: false } });
    expect(readClientCloseRequested({})).toBeNull();
  });
});

describe("host events", () => {
  it("closeRequested only for this instance", () => {
    expect(closeRequestFor(closeReq(ME), ME)).toMatchObject({ instanceId: ME, graceSeconds: 15, requestedBy: { deviceName: "host-a" } });
    expect(closeRequestFor(closeReq(OTHER), ME)).toBeNull();
    expect(closeRequestFor(env("cutex/client/stateChanged", { instanceId: ME, state: "closing" }), ME)).toBeNull();
    expect(closeRequestFor(env("cutex/client/closeRequested", "garbage"), ME)).toBeNull();
  });

  it("stateChanged: known states only", () => {
    expect(clientStateChangeOf(env("cutex/client/stateChanged", { instanceId: ME, state: "cancelled" }))).toEqual({ instanceId: ME, state: "cancelled" });
    expect(clientStateChangeOf(env("cutex/client/stateChanged", { instanceId: ME, state: "gone" }))).toBeNull();
    expect(clientStateChangeOf(closeReq(ME))).toBeNull();
  });
});

describe("presence scheduling (pure)", () => {
  it("heartbeat after success; 5 s doubling backoff after failures, capped at the heartbeat", () => {
    expect(presenceDelayMs(60, 0)).toBe(60_000);
    expect(presenceDelayMs(null, 0)).toBe(60_000);
    expect(presenceDelayMs(60, 1)).toBe(5_000);
    expect(presenceDelayMs(60, 2)).toBe(10_000);
    expect(presenceDelayMs(60, 4)).toBe(40_000);
    expect(presenceDelayMs(60, 5)).toBe(60_000);
    expect(presenceDelayMs(30, 50)).toBe(30_000);
  });

  it("retryable: unreachable, 5xx, 429; not a 4xx refusal", () => {
    expect(presenceRetryable(null)).toBe(true);
    expect(presenceRetryable(503)).toBe(true);
    expect(presenceRetryable(429)).toBe(true);
    expect(presenceRetryable(404)).toBe(false);
    expect(presenceRetryable(403)).toBe(false);
  });

  it("prefs: allowRemoteClose absent = on, false kept", () => {
    expect(parsePrefs({}).allowRemoteClose).toBeUndefined();
    expect(parsePrefs({ allowRemoteClose: false }).allowRemoteClose).toBe(false);
    expect(parsePrefs({ allowRemoteClose: "no" }).allowRemoteClose).toBeUndefined();
  });
});

describe("install id", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "rc-install-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("created once and kept; a garbled file is replaced", () => {
    const file = join(dir, "client-install.json");
    const a = loadInstallId(file);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(loadInstallId(file)).toBe(a);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ installId: a });
    writeFileSync(file, "{nope");
    const b = loadInstallId(file);
    expect(b).not.toBe(a);
    expect(loadInstallId(file)).toBe(b);
  });
});

// ---------- ClientPresenceService with a fake daemon ----------

function fakeHost(features: string[]) {
  const calls: { kind: string; body?: Record<string, unknown>; outcome?: string }[] = [];
  const state = { fail: null as Error | null, heartbeat: 60 };
  const client = {
    clientPresence: vi.fn(async (body: Record<string, unknown>) => {
      calls.push({ kind: "presence", body });
      if (state.fail) throw state.fail;
      return { instanceId: body.instanceId, heartbeatSeconds: state.heartbeat };
    }),
    reportClientClosing: vi.fn(async (instanceId: string, outcome: string) => {
      calls.push({ kind: "closing", outcome, body: { instanceId } });
    }),
  };
  const daemon = { capabilities: vi.fn(async () => ({ featureList: features })), activeClient: () => client };
  return { calls, state, client, daemon };
}

const IDENTITY = { installId: ME, instanceId: OTHER, appName: "cutex-desktop", appVersion: "0.1.6", deviceName: "sam-laptop", platform: "linux" };
const connected = { kind: "connected" as const, baseUrl: "http://127.0.0.1:1", hostId: "H" };
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("ClientPresenceService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(features = ["client-remote-close"]) {
    const host = fakeHost(features);
    let allow = true;
    const requested: [string, ClientCloseRequested][] = [];
    const svc = new ClientPresenceService({
      daemonFor: (hostId) => (hostId === "local" ? (host.daemon as never) : null),
      allowRemoteClose: () => allow,
      identity: () => IDENTITY,
      onCloseRequested: (hostId, r) => requested.push([hostId, r]),
    });
    return { host, svc, requested, setAllow: (v: boolean) => (allow = v) };
  }

  it("registers on connect, heartbeats every heartbeatSeconds, stops on disconnect", async () => {
    const { host, svc } = setup();
    svc.onDaemonState("local", connected);
    await flush();
    expect(host.calls.filter((c) => c.kind === "presence")).toHaveLength(1);
    expect(host.calls[0]!.body).toMatchObject({ ...IDENTITY, allowRemoteClose: true });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(host.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(host.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(host.calls).toHaveLength(3);
    svc.forgetHost("local");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(host.calls).toHaveLength(3);
  });

  it("a host without the capability is never called", async () => {
    const { host, svc } = setup([]);
    svc.onDaemonState("local", connected);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(host.calls).toHaveLength(0);
  });

  it("a lost connection pauses; reconnect registers again at once", async () => {
    const { host, svc } = setup();
    svc.onDaemonState("local", connected);
    await flush();
    svc.onDaemonState("local", { kind: "unreachable", baseUrl: "", message: "down" });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(host.calls).toHaveLength(1);
    svc.onDaemonState("local", connected);
    await flush();
    expect(host.calls).toHaveLength(2);
  });

  it("failures back off (5 s, 10 s …); success returns to the heartbeat", async () => {
    const { host, svc } = setup();
    host.state.fail = new Error("unreachable");
    svc.onDaemonState("local", connected);
    await flush();
    expect(host.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(host.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(host.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(host.calls).toHaveLength(3);
    host.state.fail = null;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(host.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(host.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(host.calls).toHaveLength(5);
  });

  it("the setting re-sends at once with the new flag", async () => {
    const { host, svc, setAllow } = setup();
    svc.onDaemonState("local", connected);
    await flush();
    setAllow(false);
    svc.resendAll();
    await flush();
    expect(host.calls).toHaveLength(2);
    expect(host.calls[1]!.body).toMatchObject({ allowRemoteClose: false });
    // The heartbeat restarts from the re-send.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(host.calls).toHaveLength(3);
  });

  it("close requests: only ours reach the countdown; switched off → declined with cancelled", async () => {
    const { host, svc, requested, setAllow } = setup();
    // Not registered yet: nothing is addressed to this instance.
    svc.onHostEvent("local", closeReq(OTHER));
    expect(requested).toHaveLength(0);
    svc.onDaemonState("local", connected);
    await flush();
    host.calls.length = 0;
    svc.onHostEvent("local", closeReq(ME));
    expect(requested).toHaveLength(0);
    svc.onHostEvent("local", closeReq(OTHER));
    expect(requested).toEqual([["local", expect.objectContaining({ instanceId: OTHER, graceSeconds: 15 })]]);
    setAllow(false);
    // A repeat of the same request is deduplicated; a new one (another `at`) is declined.
    svc.onHostEvent("local", closeReq(OTHER, { at: "2026-10-19T10:05:00Z" }));
    await flush();
    expect(requested).toHaveLength(1);
    expect(host.calls).toEqual([{ kind: "closing", outcome: "cancelled", body: { instanceId: OTHER } }]);
  });

  it("stop(): no more calls", async () => {
    const { host, svc } = setup();
    svc.onDaemonState("local", connected);
    await flush();
    svc.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(host.calls).toHaveLength(1);
    svc.onDaemonState("local", connected);
    await flush();
    expect(host.calls).toHaveLength(1);
  });
});

// ---------- client-presence-lifecycle (r264): closing exited, close requests from the presence reply ----------

describe("ClientPresenceService lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const LIFECYCLE = ["client-remote-close", "client-presence-lifecycle"];
  const AT = "2026-10-26T03:00:00.000Z";
  const pending = { requestedBy: { deviceName: "host-a", userId: "owner", local: false }, graceSeconds: 20, at: AT };

  function lifecycleHost(features: string[]) {
    const calls: string[] = [];
    const state = { reply: {} as Record<string, unknown>, hang: false };
    const client = {
      clientPresence: vi.fn(async (body: Record<string, unknown>) => {
        calls.push("presence");
        return { instanceId: body.instanceId, heartbeatSeconds: 60, state: "online", closeRequest: null, ...state.reply };
      }),
      reportClientClosing: vi.fn((_instanceId: string, outcome: string) => {
        calls.push(`closing ${outcome}`);
        return state.hang ? new Promise<void>(() => {}) : Promise.resolve();
      }),
    };
    return { calls, state, client, daemon: { capabilities: vi.fn(async () => ({ featureList: features })), activeClient: () => client } };
  }

  function setup(hostFeatures: Record<string, string[]>) {
    const hosts = Object.fromEntries(Object.entries(hostFeatures).map(([id, f]) => [id, lifecycleHost(f)]));
    const requested: [string, ClientCloseRequested][] = [];
    let allow = true;
    const svc = new ClientPresenceService({
      daemonFor: (hostId) => (hosts[hostId]?.daemon as never) ?? null,
      allowRemoteClose: () => allow,
      identity: () => IDENTITY,
      onCloseRequested: (hostId, r) => requested.push([hostId, r]),
    });
    for (const id of Object.keys(hosts)) svc.onDaemonState(id, { ...connected, hostId: id });
    return { hosts, svc, requested, setAllow: (v: boolean) => (allow = v) };
  }

  it("a presence reply carrying closeRequest starts the countdown; the event and later beats do not double it", async () => {
    const { hosts, svc, requested } = setup({ local: LIFECYCLE });
    hosts.local!.state.reply = { state: "closeRequested", closeRequest: pending };
    await flush();
    expect(requested).toEqual([["local", { instanceId: OTHER, ...pending }]]);
    // The event for the same request arrives late; the next heartbeat still reports it.
    svc.onHostEvent("local", closeReq(OTHER, { at: AT, graceSeconds: 20 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(hosts.local!.calls.filter((c) => c === "presence")).toHaveLength(2);
    expect(requested).toHaveLength(1);
    // A new request (another `at`) is a new countdown request.
    hosts.local!.state.reply = { state: "closeRequested", closeRequest: { ...pending, at: "2026-10-26T03:05:00.000Z" } };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requested).toHaveLength(2);
  });

  it("the event first, then the reply with the same request: handled once", async () => {
    const { hosts, svc, requested } = setup({ local: LIFECYCLE });
    await flush();
    svc.onHostEvent("local", closeReq(OTHER, { at: AT }));
    hosts.local!.state.reply = { state: "closeRequested", closeRequest: pending };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requested).toHaveLength(1);
  });

  it("a reply's close request while remote close is off: declined with cancelled, once", async () => {
    const { hosts, requested, setAllow } = setup({ local: LIFECYCLE });
    setAllow(false);
    hosts.local!.state.reply = { state: "closeRequested", closeRequest: pending };
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(requested).toHaveLength(0);
    expect(hosts.local!.calls.filter((c) => c.startsWith("closing"))).toEqual(["closing cancelled"]);
  });

  it("without the feature: no exited call and the quit is not held", async () => {
    const { hosts, svc } = setup({ local: ["client-remote-close"] });
    await flush();
    const hold = vi.fn();
    const quitAgain = vi.fn();
    expect(svc.beforeQuit(hold, quitAgain)).toBe(false);
    expect(hold).not.toHaveBeenCalled();
    await svc.reportExited();
    expect(hosts.local!.calls).toEqual(["presence"]);
  });

  it("with the feature: before-quit holds, sends exited once, then quits again; the second pass goes on", async () => {
    const { hosts, svc } = setup({ local: LIFECYCLE });
    await flush();
    const hold = vi.fn();
    const quitAgain = vi.fn();
    expect(svc.beforeQuit(hold, quitAgain)).toBe(true);
    expect(hold).toHaveBeenCalledTimes(1);
    // Another quit while reporting: held too, no second round.
    expect(svc.beforeQuit(hold, quitAgain)).toBe(true);
    await flush();
    expect(quitAgain).toHaveBeenCalledTimes(1);
    expect(hosts.local!.client.reportClientClosing).toHaveBeenCalledTimes(1);
    expect(hosts.local!.client.reportClientClosing).toHaveBeenCalledWith(OTHER, "exited", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(svc.beforeQuit(hold, quitAgain)).toBe(false);
    // No heartbeat after exited (the host fences the id).
    await vi.advanceTimersByTimeAsync(300_000);
    expect(hosts.local!.calls.filter((c) => c === "presence")).toHaveLength(1);
  });

  it("hung hosts never hold the quit beyond the timeout; hosts are called in parallel; legacy hosts skipped", async () => {
    const { hosts, svc } = setup({ a: LIFECYCLE, b: LIFECYCLE, old: ["client-remote-close"], none: [] });
    await flush();
    hosts.a!.state.hang = true;
    hosts.b!.state.hang = true;
    const quitAgain = vi.fn();
    expect(svc.beforeQuit(() => {}, quitAgain)).toBe(true);
    // Both calls are out before either settles.
    expect(hosts.a!.calls.at(-1)).toBe("closing exited");
    expect(hosts.b!.calls.at(-1)).toBe("closing exited");
    expect(hosts.old!.client.reportClientClosing).not.toHaveBeenCalled();
    expect(hosts.none!.client.reportClientClosing).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(EXIT_REPORT_TIMEOUT_MS - 1);
    expect(quitAgain).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(quitAgain).toHaveBeenCalledTimes(1);
    expect(EXIT_REPORT_TIMEOUT_MS).toBeLessThanOrEqual(800);
  });

  it("a host whose connection ended is not called", async () => {
    const { hosts, svc } = setup({ a: LIFECYCLE, b: LIFECYCLE });
    await flush();
    svc.forgetHost("b");
    await svc.reportExited();
    expect(hosts.a!.client.reportClientClosing).toHaveBeenCalledTimes(1);
    expect(hosts.b!.client.reportClientClosing).not.toHaveBeenCalled();
  });
});

// ---------- the countdown ----------

describe("RemoteCloseCountdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(report?: (hostId: string, instanceId: string, outcome: string) => Promise<void>, forceQuit?: () => void) {
    const reports: string[] = [];
    const views: (RemoteCloseView | null)[] = [];
    const quit = vi.fn();
    const c = new RemoteCloseCountdown({
      ...(forceQuit ? { forceQuit } : {}),
      now: () => Date.now(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      report: report ?? (async (hostId, instanceId, outcome) => void reports.push(`${hostId} ${instanceId} ${outcome}`)),
      quit,
      onChange: (v) => views.push(v),
    });
    return { c, reports, views, quit };
  }
  const req = (graceSeconds = 15, deviceName: string | null = "host-a"): ClientCloseRequested => ({ instanceId: ME, requestedBy: { deviceName, userId: "owner", local: false }, graceSeconds, at: "" });

  it("timeout: reports closing, then quits", async () => {
    const { c, reports, views, quit } = setup();
    c.request("local", req());
    expect(views.at(-1)).toMatchObject({ deviceName: "host-a", graceSeconds: 15, closing: false, hostId: "local" });
    expect(secondsLeft(views.at(-1)!.deadline, Date.now())).toBe(15);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reports).toEqual([`local ${ME} closing`]);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(views.at(-1)).toMatchObject({ closing: true });
  });

  it("a quit that does not end the app is forced after the watchdog (the dialog never stays at 正在关闭)", async () => {
    const forceQuit = vi.fn();
    const { c, quit } = setup(undefined, forceQuit);
    c.request("local", req());
    await c.answer("now");
    expect(quit).toHaveBeenCalledTimes(1);
    c.dispose(); // will-quit runs dispose(); the watchdog must survive it
    await vi.advanceTimersByTimeAsync(QUIT_WATCHDOG_MS - 1);
    expect(forceQuit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(forceQuit).toHaveBeenCalledTimes(1);
  });

  it("cancel never arms the quit watchdog", async () => {
    const forceQuit = vi.fn();
    const { c } = setup(undefined, forceQuit);
    c.request("local", req());
    await c.answer("cancel");
    await vi.advanceTimersByTimeAsync(QUIT_WATCHDOG_MS * 2);
    expect(forceQuit).not.toHaveBeenCalled();
  });

  it("cancel: reports cancelled, never quits, view cleared", async () => {
    const { c, reports, views, quit } = setup();
    c.request("local", req());
    await vi.advanceTimersByTimeAsync(5_000);
    await c.answer("cancel");
    expect(views.at(-1)).toBeNull();
    expect(reports).toEqual([`local ${ME} cancelled`]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(quit).not.toHaveBeenCalled();
    expect(c.view()).toBeNull();
  });

  it("立即关闭: reports closing and quits at once; buttons are then ignored", async () => {
    const { c, reports, quit } = setup();
    c.request("local", req());
    await c.answer("now");
    expect(reports).toEqual([`local ${ME} closing`]);
    expect(quit).toHaveBeenCalledTimes(1);
    await c.answer("cancel");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(reports).toHaveLength(1);
    // Quitting: a new request is ignored.
    expect(c.request("local", req())).toBe(false);
  });

  it("a hanging report does not keep the app open", async () => {
    const { c, quit } = setup(() => new Promise(() => {}));
    c.request("local", req(3));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REPORT_TIMEOUT_MS);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("a failing report still quits", async () => {
    const { c, quit } = setup(async () => {
      throw new Error("unreachable");
    });
    c.request("local", req());
    await c.answer("now");
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("a second request joins: earlier deadline wins, every host hears the outcome", async () => {
    const { c, reports, views } = setup();
    c.request("local", req(15));
    const first = views.at(-1)!;
    await vi.advanceTimersByTimeAsync(2_000);
    c.request("workstation", req(5, "kai-laptop"));
    expect(views.at(-1)!.id).toBe(first.id);
    expect(views.at(-1)!.deviceName).toBe("host-a");
    expect(secondsLeft(views.at(-1)!.deadline, Date.now())).toBe(5);
    await c.cancel();
    expect(reports.sort()).toEqual([`local ${ME} cancelled`, `workstation ${ME} cancelled`]);
  });

  it("a later request does not extend the countdown; a forgotten host is not told", async () => {
    const { c, reports, quit } = setup();
    c.request("local", req(5));
    c.request("workstation", req(60));
    c.forgetHost("workstation");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(reports).toEqual([`local ${ME} closing`]);
  });

  it("a new countdown after a cancel gets a new id", async () => {
    const { c, views } = setup();
    c.request("local", req());
    const a = views.at(-1)!.id;
    await c.cancel();
    c.request("local", req());
    expect(views.at(-1)!.id).not.toBe(a);
  });
});

// ---------- 在线的桌面 gating ----------

const row = (patch: Partial<OnlineClientView>): OnlineClientView => ({
  instanceId: OTHER, installId: "i", appName: "cutex-desktop", appVersion: "0.1.5", deviceName: "host-a", platform: "win32", userId: "owner", tokenId: null, local: false,
  connectedSince: null, lastSeen: "2026-10-19T10:00:00Z", allowRemoteClose: true, state: "online", current: false, self: false, ...patch,
});
const OWNER = { isOwner: true, userId: "owner", scope: "full" as const };
const MIA = { isOwner: false, userId: "mia", scope: "full" as const };

describe("closeGate", () => {
  it("this desktop: no button", () => {
    expect(closeGate(row({ self: true }), OWNER)).toBe("self");
  });
  it("owner with full control closes any desktop", () => {
    expect(closeGate(row({}), OWNER)).toBe("ok");
    expect(closeGate(row({ userId: "mia" }), OWNER)).toBe("ok");
    expect(closeGate(row({}), { ...OWNER, scope: null })).toBe("ok");
  });
  it("a narrowed device may not close", () => {
    expect(closeGate(row({}), { ...OWNER, scope: "chat" })).toBe("forbidden");
    expect(closeGate(row({ userId: "mia" }), { ...MIA, scope: "read" })).toBe("forbidden");
  });
  it("another user: only their own desktops", () => {
    expect(closeGate(row({ userId: "mia" }), MIA)).toBe("ok");
    expect(closeGate(row({ userId: "owner" }), MIA)).toBe("forbidden");
    expect(closeGate(row({ userId: null }), { ...MIA, userId: null })).toBe("forbidden");
  });
  it("remote close switched off on that desktop; a close under way", () => {
    expect(closeGate(row({ allowRemoteClose: false }), OWNER)).toBe("disabled");
    expect(closeGate(row({ state: "closeRequested" }), OWNER)).toBe("busy");
    expect(closeGate(row({ state: "closing" }), OWNER)).toBe("busy");
    expect(closeGate(row({ state: "cancelled" }), OWNER)).toBe("ok");
  });
  it("sort: this desktop first, then the latest heartbeat", () => {
    const rows = sortOnlineClients([row({ instanceId: "a", lastSeen: "2026-10-19T10:00:00Z" }), row({ instanceId: "b", lastSeen: "2026-10-19T10:05:00Z" }), row({ instanceId: "self", self: true, lastSeen: "2026-10-19T09:00:00Z" })]);
    expect(rows.map((r) => r.instanceId)).toEqual(["self", "b", "a"]);
  });
  it("stateChanged applies to its row only (unknown: same list)", () => {
    const rows = [row({ instanceId: "a" }), row({ instanceId: "b" })];
    expect(applyClientState(rows, { instanceId: "b", state: "closing" }).map((r) => r.state)).toEqual(["online", "closing"]);
    expect(applyClientState(rows, { instanceId: "zz", state: "closing" })).toBe(rows);
    expect(applyClientState(rows, { instanceId: "b", state: "exited" }).map((r) => r.instanceId)).toEqual(["a"]);
    expect(applyClientState(rows, { instanceId: "zz", state: "exited" })).toBe(rows);
  });
});

describe("dropRelaunchLeftovers", () => {
  const T = (min: number) => new Date(Date.UTC(2026, 9, 26, 2, min)).toISOString();
  const launch = (instanceId: string, connected: number, seen: number, patch: Partial<OnlineClientView> = {}) =>
    row({ instanceId, installId: "inst-remote", tokenId: "mct-t", deviceName: "remote", connectedSince: T(connected), lastSeen: T(seen), ...patch });

  it("hides an older launch of the same install that stopped beating before the newest launch connected", () => {
    const rows = [launch("old", 0, 9), launch("new", 10, 12)];
    expect(dropRelaunchLeftovers(rows).map((r) => r.instanceId)).toEqual(["new"]);
  });
  it("keeps an older launch that still beats after the new one connected (a second running instance)", () => {
    const rows = [launch("old", 0, 11), launch("new", 10, 12)];
    expect(dropRelaunchLeftovers(rows)).toBe(rows);
  });
  it("keeps other installs and other credentials on the same device", () => {
    const rows = [launch("old", 0, 9), launch("dev", 0, 9, { installId: "inst-dev" }), launch("other-token", 0, 9, { tokenId: "mct-x" }), launch("new", 10, 12)];
    expect(dropRelaunchLeftovers(rows).map((r) => r.instanceId)).toEqual(["dev", "other-token", "new"]);
  });
  it("never hides this desktop's row or rows without both times", () => {
    expect(dropRelaunchLeftovers([launch("self", 0, 9, { self: true }), launch("new", 10, 12)])).toHaveLength(2);
    expect(dropRelaunchLeftovers([launch("a", 0, 9, { connectedSince: null }), launch("new", 10, 12)])).toHaveLength(2);
    expect(dropRelaunchLeftovers([launch("a", 0, 9, { lastSeen: null }), launch("new", 10, 12)])).toHaveLength(2);
    expect(dropRelaunchLeftovers([launch("a", 0, 9, { installId: "" }), launch("new", 10, 12, { installId: "" })])).toHaveLength(2);
  });
});
