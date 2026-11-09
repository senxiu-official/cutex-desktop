import { describe, expect, it } from "vitest";
import { CutexApiError, CutexClient, readRelayPairingStatus, RELAY_PAIRING_SWITCH_FEATURE } from "../src/index";

type Call = { method: string; url: string; body: unknown };

function mockClient(reply: (call: Call) => [number, unknown]) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? "GET", url: String(input), body: init?.body === undefined ? null : JSON.parse(String(init.body)) };
    calls.push(call);
    const [status, body] = reply(call);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { client: new CutexClient({ baseUrl: "http://h:1", token: "tok" }, { fetch, clientId: "c" }), calls };
}

const ON = { configured: true, enabled: true, listening: true, reason: null, bootstrapBind: "0.0.0.0:8443", bootstrapServerName: "eva-pair.example.love", restartRequired: false };
const OFF = { ...ON, enabled: false, listening: false, reason: "disabled" };

describe("public QR pairing switch (contract rev 9.4)", () => {
  it("names the capability", () => {
    expect(RELAY_PAIRING_SWITCH_FEATURE).toBe("relay-pairing-switch-v1");
  });

  it("reads the status leniently and refuses a reply without the three booleans", () => {
    expect(readRelayPairingStatus(ON)).toEqual({ configured: true, enabled: true, listening: true, reason: null, bootstrapBind: "0.0.0.0:8443", bootstrapServerName: "eva-pair.example.love" });
    expect(readRelayPairingStatus({ configured: false, enabled: false, listening: false, reason: "not_configured", bootstrapBind: null })).toEqual({ configured: false, enabled: false, listening: false, reason: "not_configured", bootstrapBind: null, bootstrapServerName: null });
    expect(() => readRelayPairingStatus({ configured: true, enabled: "yes", listening: false })).toThrow(/malformed/);
    expect(() => readRelayPairingStatus(null)).toThrow(/malformed/);
  });

  it("GET reads the status; POST sends exactly {enabled}", async () => {
    const { client, calls } = mockClient((call) => [200, call.method === "GET" ? ON : (call.body as { enabled: boolean }).enabled ? ON : OFF]);
    expect((await client.relayPairing()).listening).toBe(true);
    expect((await client.setRelayPairing(false)).enabled).toBe(false);
    expect((await client.setRelayPairing(true)).enabled).toBe(true);
    expect(calls.map((c) => [c.method, new URL(c.url).pathname, c.body])).toEqual([
      ["GET", "/v2/relay/pairing", null],
      ["POST", "/v2/relay/pairing", { enabled: false }],
      ["POST", "/v2/relay/pairing", { enabled: true }],
    ]);
  });

  it("refusals stay API errors with their code (409 not configured, 503 bind in use)", async () => {
    const { client } = mockClient(() => [503, { error: { code: "bootstrap_bind_unavailable", message: "address in use", details: { pairing: { ...ON, listening: false, reason: "bind_unavailable" } } } }]);
    const error = await client.setRelayPairing(true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CutexApiError);
    expect((error as CutexApiError).code).toBe("bootstrap_bind_unavailable");
  });
});
