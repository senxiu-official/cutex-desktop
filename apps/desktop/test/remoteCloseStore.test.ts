// Remote close in the renderer (lib/remoteClose.ts): the per-host 在线的桌面 store (read, live
// stateChanged / closeRequested, 关闭 and its refusals) and the countdown store (main's event, 取消 /
// 立即关闭 to main).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";

const fake = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  closeResult: null as unknown,
  calls: [] as string[],
  handlers: {} as Record<string, ((payload: unknown) => void)[]>,
  answers: [] as string[],
}));
vi.mock("../src/renderer/src/bridge", () => {
  const hostApi = (hostId: string) => ({
    onlineClients: async () => {
      fake.calls.push(`list ${hostId}`);
      return fake.rows[hostId] ?? { ok: true, value: [] };
    },
    closeOnlineClient: async (instanceId: string) => {
      fake.calls.push(`close ${hostId} ${instanceId}`);
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

import { answerRemoteClose, closeOnlineClient, loadOnlineClients, onlineClientsNow, remoteCloseCountdownNow } from "../src/renderer/src/lib/remoteClose";

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
  });

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
    const r = await closeOnlineClient("h3", "host-a");
    expect(r.ok).toBe(true);
    expect((await rowsOf("h3"))[0]!.state).toBe("closeRequested");
    fake.closeResult = { ok: false, error: { code: "client_not_found", message: "gone" } };
    fake.rows.h3 = { ok: true, value: [] };
    const gone = await closeOnlineClient("h3", "host-a");
    expect(gone).toEqual({ ok: false, error: { code: "client_not_found", message: "gone" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
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
