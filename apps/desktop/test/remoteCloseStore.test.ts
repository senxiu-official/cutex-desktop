// Remote close in the renderer (lib/remoteClose.ts): the per-host 在线的桌面 store (read, live
// stateChanged / closeRequested, 关闭 and its refusals) and the countdown store (main's event, 取消 /
// 立即关闭 to main).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";

const fake = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  closeResult: null as unknown,
  calls: [] as string[],
  handlers: {} as Record<string, ((payload: unknown) => void)[]>,
  answers: [] as string[],
  hanging: false,
}));
vi.mock("../src/renderer/src/bridge", () => {
  const hostApi = (hostId: string) => ({
    onlineClients: async () => {
      fake.calls.push(`list ${hostId}`);
      return fake.rows[hostId] ?? { ok: true, value: [] };
    },
    closeOnlineClient: async (instanceId: string) => {
      fake.calls.push(`close ${hostId} ${instanceId}`);
      if (fake.hanging) return new Promise(() => {});
      return fake.closeResult ?? { ok: true, value: { instanceId, state: "closeRequested" } };
    },
  });
  const on = (event: string, fn: (payload: unknown) => void) => {
    (fake.handlers[event] ??= []).push(fn);
    return () => {};
  };
  const shell = {
    remoteClose: async () => null,
    answerRemoteClose: async (action: string) => void fake.answers.push(action),
  };
  return { api: hostApi("local"), bridge: { api: hostApi("local"), on, shell }, apiFor: hostApi };
});
vi.mock("../src/renderer/src/lib/useHostScope", () => ({ useHostLook: () => null, useHostData: () => null }));

import { fireHostReset } from "../src/renderer/src/lib/hostSwitch";
import { CLOSE_CONFIRM_TIMEOUT_MS, CLOSE_REQUEST_TIMEOUT_MS, answerRemoteClose, closeOnlineClient, loadOnlineClients, onlineClientsNow, remoteCloseCountdownNow } from "../src/renderer/src/lib/remoteClose";

const row = (instanceId: string, patch: Record<string, unknown> = {}) => ({
  instanceId, installId: "i", appName: "cutex-desktop", appVersion: "0.1.5", deviceName: instanceId, platform: "win32", userId: "owner", tokenId: null, local: false,
  connectedSince: null, lastSeen: "2026-10-19T10:00:00Z", allowRemoteClose: true, state: "online", current: false, self: false, ...patch,
});
const env = (method: string, params: unknown) => ({ cutexSessionId: "cutex.host", source: "cutex", cutex: { method, params } }) as unknown as EventEnvelope;
const hostEvent = (hostId: string, envelope: EventEnvelope) => fake.handlers.hostEvent?.forEach((h) => h({ hostId, epoch: "e", envelope }));

async function rowsOf(hostId: string) {
  return onlineClientsNow(hostId).rows;
}

describe("在线的桌面 store", () => {
  beforeEach(() => {
    fake.calls = [];
    fake.closeResult = null;
    fake.hanging = false;
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); });

  it("reads sorted (this desktop first) and follows stateChanged / closeRequested", async () => {
    fake.rows.h1 = { ok: true, value: [row("host-a", { lastSeen: "2026-10-19T10:05:00Z" }), row("self", { self: true })] };
    await loadOnlineClients("h1", "e");
    expect((await rowsOf("h1")).map((r) => r.instanceId)).toEqual(["self", "host-a"]);
    hostEvent("h1", env("cutex/client/closeRequested", { instanceId: "host-a", requestedBy: {}, graceSeconds: 15 }));
    expect((await rowsOf("h1")).find((r) => r.instanceId === "host-a")?.state).toBe("closeRequested");
    hostEvent("h1", env("cutex/client/stateChanged", { instanceId: "host-a", state: "cancelled" }));
    expect((await rowsOf("h1")).find((r) => r.instanceId === "host-a")?.state).toBe("cancelled");
    // Another host's event does not touch this list.
    hostEvent("h2", env("cutex/client/stateChanged", { instanceId: "host-a", state: "closing" }));
    expect((await rowsOf("h1")).find((r) => r.instanceId === "host-a")?.state).toBe("cancelled");
  });

  it("关闭: the row shows the request; client_not_found re-reads the list", async () => {
    fake.rows.h3 = { ok: true, value: [row("host-a")] };
    await loadOnlineClients("h3", "e");
    const pending = closeOnlineClient("h3", "host-a");
    await Promise.resolve();
    expect((await rowsOf("h3"))[0]!.state).toBe("closeRequested");
    hostEvent("h3", env("cutex/client/stateChanged", { instanceId: "host-a", state: "closing" }));
    expect((await pending).ok).toBe(true);
    expect(await rowsOf("h3")).toEqual([]);
    fake.closeResult = { ok: false, error: { code: "client_not_found", message: "gone" } };
    fake.rows.h3 = { ok: true, value: [] };
    const gone = await closeOnlineClient("h3", "host-a");
    expect(gone).toEqual({ ok: false, error: { code: "client_not_found", message: "gone" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.calls.filter((c) => c === "list h3")).toHaveLength(2);
    expect(await rowsOf("h3")).toEqual([]);
  });

  it("a forbidden close leaves the list alone", async () => {
    fake.rows.h4 = { ok: true, value: [row("host-a")] };
    await loadOnlineClients("h4", "e");
    fake.closeResult = { ok: false, error: { code: "client_close_forbidden", message: "no" } };
    const r = await closeOnlineClient("h4", "host-a");
    expect(r.ok).toBe(false);
    expect(fake.calls.filter((c) => c === "list h4")).toHaveLength(1);
    expect((await rowsOf("h4"))[0]!.state).toBe("online");
  });

  it("does not mistake HTTP 202 for success, then removes a closing acknowledgment and keeps it removed on polls", async () => {
    const host = "ack";
    fake.rows[host] = { ok: true, value: [row("target")] };
    await loadOnlineClients(host);
    const done = vi.fn();
    const pending = closeOnlineClient(host, "target").then(result => { done(result); return result; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).not.toHaveBeenCalled();
    hostEvent(host, env("cutex/client/stateChanged", { instanceId: "target", state: "closing" }));
    expect(await pending).toMatchObject({ ok: true, value: { state: "closing" } });
    fake.rows[host] = { ok: true, value: [row("target", { state: "closing" })] };
    await loadOnlineClients(host);
    expect(await rowsOf(host)).toEqual([]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("keeps a closing event terminal even when an older in-flight list returns online", async () => {
    fake.rows.race = { ok: true, value: [row("target")] };
    await loadOnlineClients("race", "e");
    const pending = closeOnlineClient("race", "target");
    hostEvent("race", env("cutex/client/stateChanged", { instanceId: "target", state: "closing" }));
    expect((await pending).ok).toBe(true);
    await loadOnlineClients("race", "e");
    expect(await rowsOf("race")).toEqual([]);
  });

  it("does not accept a previous connection epoch's closing acknowledgment", async () => {
    fake.rows.epoch = { ok: true, value: [row("target")] };
    await loadOnlineClients("epoch", "new");
    const pending = closeOnlineClient("epoch", "target");
    hostEvent("epoch", env("cutex/client/stateChanged", { instanceId: "target", state: "closing" }));
    expect((await rowsOf("epoch"))[0]!.state).toBe("closeRequested");
    fireHostReset("epoch");
    expect(await pending).toMatchObject({ ok: false });
  });

  it("recovers a missing event from the list and accepts disappearance only after the request was accepted", async () => {
    fake.rows.poll = { ok: true, value: [row("target")] };
    await loadOnlineClients("poll");
    const pending = closeOnlineClient("poll", "target");
    await vi.advanceTimersByTimeAsync(0);
    fake.rows.poll = { ok: true, value: [row("target", { state: "closing" })] };
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending).ok).toBe(true);
    fake.rows.gone = { ok: true, value: [row("target")] };
    await loadOnlineClients("gone");
    const gone = closeOnlineClient("gone", "target");
    await vi.advanceTimersByTimeAsync(0);
    fake.rows.gone = { ok: true, value: [] };
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await gone).ok).toBe(true);
  });

  it("hides a relaunch leftover of the same install; another install on the same device stays", async () => {
    const install = { installId: "inst-remote", tokenId: "mct-t" };
    fake.rows.relaunch = { ok: true, value: [
      row("old", { ...install, connectedSince: "2026-10-26T01:00:00Z", lastSeen: "2026-10-26T01:58:00Z" }),
      row("new", { ...install, connectedSince: "2026-10-26T01:59:00Z", lastSeen: "2026-10-26T02:00:00Z" }),
      row("dev", { installId: "inst-dev", tokenId: "mct-t", connectedSince: "2026-10-26T01:00:00Z", lastSeen: "2026-10-26T01:58:00Z" }),
    ] };
    await loadOnlineClients("relaunch");
    expect((await rowsOf("relaunch")).map((r) => r.instanceId)).toEqual(["new", "dev"]);
  });

  it("lifecycle host: no relaunch-leftover rule (cutex replaces the row itself)", async () => {
    const install = { installId: "inst-remote", tokenId: "mct-t" };
    fake.rows.lcrelaunch = { ok: true, value: [
      row("old", { ...install, connectedSince: "2026-10-26T01:00:00Z", lastSeen: "2026-10-26T01:58:00Z" }),
      row("new", { ...install, connectedSince: "2026-10-26T01:59:00Z", lastSeen: "2026-10-26T02:00:00Z" }),
    ] };
    await loadOnlineClients("lcrelaunch", "e", true);
    expect((await rowsOf("lcrelaunch")).map((r) => r.instanceId)).toEqual(["new", "old"]);
  });

  it("lifecycle host: stateChanged exited removes the row and completes a pending close", async () => {
    fake.rows.lcexit = { ok: true, value: [row("target"), row("peer")] };
    await loadOnlineClients("lcexit", "e", true);
    hostEvent("lcexit", env("cutex/client/stateChanged", { instanceId: "peer", state: "exited" }));
    expect((await rowsOf("lcexit")).map((r) => r.instanceId)).toEqual(["target"]);
    const pending = closeOnlineClient("lcexit", "target");
    hostEvent("lcexit", env("cutex/client/stateChanged", { instanceId: "target", state: "exited" }));
    expect(await pending).toMatchObject({ ok: true });
    expect(await rowsOf("lcexit")).toEqual([]);
  });

  it("lifecycle host: cancelled puts the row back to normal (also as read)", async () => {
    fake.rows.lccancel = { ok: true, value: [row("target"), row("other", { state: "cancelled" })] };
    await loadOnlineClients("lccancel", "e", true);
    expect((await rowsOf("lccancel")).map((r) => r.state)).toEqual(["online", "online"]);
    const pending = closeOnlineClient("lccancel", "target");
    expect((await rowsOf("lccancel")).find((r) => r.instanceId === "target")!.state).toBe("closeRequested");
    hostEvent("lccancel", env("cutex/client/stateChanged", { instanceId: "target", state: "cancelled" }));
    expect(await pending).toMatchObject({ ok: false, error: { code: "remote_close_cancelled" } });
    expect((await rowsOf("lccancel")).find((r) => r.instanceId === "target")!.state).toBe("online");
  });

  it("cancellation returns a reason and restores an enabled retry", async () => {
    fake.rows.cancel = { ok: true, value: [row("target")] };
    await loadOnlineClients("cancel");
    const pending = closeOnlineClient("cancel", "target");
    hostEvent("cancel", env("cutex/client/stateChanged", { instanceId: "target", state: "cancelled" }));
    expect(await pending).toMatchObject({ ok: false, error: { code: "remote_close_cancelled" } });
    expect((await rowsOf("cancel"))[0]!.state).toBe("cancelled");
  });

  it("times out without a target report, survives stale busy snapshots, and allows a fresh retry", async () => {
    fake.rows.timeout = { ok: true, value: [row("target")] };
    await loadOnlineClients("timeout");
    const pending = closeOnlineClient("timeout", "target");
    fake.rows.timeout = { ok: true, value: [row("target", { state: "closeRequested" })] };
    await vi.advanceTimersByTimeAsync(CLOSE_CONFIRM_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, error: { code: "remote_close_timeout" } });
    await loadOnlineClients("timeout");
    expect((await rowsOf("timeout"))[0]!.state).toBe("online");
    const retry = closeOnlineClient("timeout", "target");
    expect((await rowsOf("timeout"))[0]!.state).toBe("closeRequested");
    hostEvent("timeout", env("cutex/client/stateChanged", { instanceId: "target", state: "closing" }));
    expect((await retry).ok).toBe(true);
  });

  it("bounds an HTTP call that never returns without treating an empty list as a successful close", async () => {
    fake.rows.hang = { ok: true, value: [row("target")] };
    await loadOnlineClients("hang");
    fake.hanging = true;
    const pending = closeOnlineClient("hang", "target");
    fake.rows.hang = { ok: true, value: [] };
    await vi.advanceTimersByTimeAsync(CLOSE_REQUEST_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, error: { code: "remote_close_timeout" } });
  });

  it("ends a pending request on host replacement and ignores its old HTTP result", async () => {
    fake.rows.reset = { ok: true, value: [row("target")] };
    await loadOnlineClients("reset");
    const pending = closeOnlineClient("reset", "target");
    fireHostReset("reset");
    expect(await pending).toMatchObject({ ok: false, error: { code: "remote_close_disconnected" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(await rowsOf("reset")).toEqual([]);
  });

});

describe("countdown store", () => {
  it("main's event shows it; 取消 hides at once and tells main; 立即关闭 marks closing", async () => {
    const view = { id: "rc-1", deviceName: "host-a", requesterLocal: false, hostId: "local", graceSeconds: 15, deadline: Date.now() + 15_000, closing: false };
    fake.handlers.remoteClose?.forEach((h) => h({ view }));
    expect(remoteCloseCountdownNow()).toMatchObject({ id: "rc-1" });
    answerRemoteClose("now");
    expect(remoteCloseCountdownNow()).toMatchObject({ closing: true });
    fake.handlers.remoteClose?.forEach((h) => h({ view }));
    answerRemoteClose("cancel");
    expect(remoteCloseCountdownNow()).toBeNull();
    await Promise.resolve();
    expect(fake.answers).toEqual(["now", "cancel"]);
  });
});
