// Desktop presence wire (clients.ts): the presence reply keeps `state` / `closeRequest` (r264 reads a
// missed close request from it), `stateChanged` carries `exited`, and `closing {outcome: "exited"}`
// (client-presence-lifecycle) goes out like the other outcomes.
import { describe, expect, it } from "vitest";
import { CutexClient, readClientPresenceReply, readClientStateChanged, readPendingCloseRequest } from "../src/index";

const ME = "11111111-2222-4333-8444-555555555555";
const AT = "2026-10-26T03:00:00.000Z";
const request = { requestedBy: { deviceName: "host-a", userId: "owner", local: false }, graceSeconds: 20, at: AT };

describe("readClientPresenceReply", () => {
  it("keeps state and the open close request", () => {
    expect(readClientPresenceReply({ instanceId: ME, heartbeatSeconds: 60, state: "closeRequested", closeRequest: request }, ME)).toEqual({
      instanceId: ME,
      heartbeatSeconds: 60,
      state: "closeRequested",
      closeRequest: { requestedBy: { deviceName: "host-a", userId: "owner", local: false }, graceSeconds: 20, at: AT },
    });
  });

  it("an older host (no state / closeRequest) reads online, null", () => {
    expect(readClientPresenceReply({ instanceId: ME, heartbeatSeconds: 60 }, ME)).toEqual({ instanceId: ME, heartbeatSeconds: 60, state: "online", closeRequest: null });
    expect(readClientPresenceReply(null, ME)).toEqual({ instanceId: ME, heartbeatSeconds: 60, state: "online", closeRequest: null });
  });

  it("a close request only counts while closeRequested; unknown state reads online", () => {
    expect(readClientPresenceReply({ state: "closing", closeRequest: request }, ME)).toMatchObject({ state: "closing", closeRequest: null });
    expect(readClientPresenceReply({ state: "weird", closeRequest: request }, ME)).toMatchObject({ state: "online", closeRequest: null });
    expect(readClientPresenceReply({ state: "closeRequested", closeRequest: null }, ME)).toMatchObject({ state: "closeRequested", closeRequest: null });
  });

  it("closeRequest: grace clamped, garbled requester tolerated, no `at` = none", () => {
    expect(readPendingCloseRequest({ at: AT, graceSeconds: 9999, requestedBy: "x" })).toEqual({ requestedBy: { deviceName: null, userId: null, local: false }, graceSeconds: 120, at: AT });
    expect(readPendingCloseRequest({ at: AT })?.graceSeconds).toBe(15);
    expect(readPendingCloseRequest({ graceSeconds: 15, requestedBy: request.requestedBy })).toBeNull();
    expect(readPendingCloseRequest("nope")).toBeNull();
  });
});

describe("readClientStateChanged", () => {
  it("reads exited next to the row states; unknown states are dropped", () => {
    expect(readClientStateChanged({ instanceId: ME, state: "exited" })).toEqual({ instanceId: ME, state: "exited" });
    expect(readClientStateChanged({ instanceId: ME, state: "cancelled" })).toEqual({ instanceId: ME, state: "cancelled" });
    expect(readClientStateChanged({ instanceId: ME, state: "gone" })).toBeNull();
  });
});

describe("CutexClient presence calls", () => {
  function mock(reply: unknown) {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as typeof globalThis.fetch;
    return { client: new CutexClient({ baseUrl: "http://h:1", token: "tok" }, { fetch, clientId: "c" }), calls };
  }

  it("clientPresence returns state + closeRequest", async () => {
    const { client } = mock({ instanceId: ME, heartbeatSeconds: 60, state: "closeRequested", closeRequest: request });
    const reply = await client.clientPresence({ installId: ME, instanceId: ME, appName: "cutex-desktop", appVersion: "0.2.1", deviceName: "d", platform: "win32", allowRemoteClose: true });
    expect(reply).toMatchObject({ state: "closeRequested", closeRequest: { at: AT, graceSeconds: 20 } });
  });

  it("reportClientClosing sends exited; other outcomes still refused", async () => {
    const { client, calls } = mock({ instanceId: ME, state: "exited" });
    await client.reportClientClosing(ME, "exited");
    expect(calls).toEqual([{ url: `http://h:1/v2/clients/${ME}/closing`, method: "POST", body: { outcome: "exited" } }]);
    await expect(client.reportClientClosing(ME, "gone" as never)).rejects.toThrow("bad outcome");
  });
});
