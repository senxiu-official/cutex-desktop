import { describe, expect, it } from "vitest";
import { CutexClient, readCreatedPairingInvite, readPairingInvite, readPairingInvites } from "../src/index";

type Call = { method: string; url: string; body: unknown };

function mockClient(reply: (call: Call) => [number, unknown] = () => [200, {}]) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? "GET", url: String(input), body: init?.body === undefined ? null : JSON.parse(String(init.body)) };
    calls.push(call);
    const [status, body] = reply(call);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { client: new CutexClient({ baseUrl: "http://h:1", token: "tok" }, { fetch, clientId: "c" }), calls };
}

const FUTURE = new Date(Date.now() + 120_000).toISOString();
const HEX = "a".repeat(64);
const pendingRow = { inviteId: "rpi-1", expiresAt: FUTURE, userId: "owner", scope: "full", status: "pending", deviceId: null, requestId: "rpr-1", deviceName: "Pixel 9", platform: "android", csrSha256: HEX, keySha256: HEX.toUpperCase(), shortCode: "012345", route: "relay" };

describe("pairing v2 owner endpoints (contract rev 9.1)", () => {
  it("lists invites leniently: statuses, the request, expiry", () => {
    const now = Date.now();
    const rows = readPairingInvites({
      invites: [
        pendingRow,
        { inviteId: "rpi-2", expiresAt: FUTURE, status: "invited" },
        { inviteId: "rpi-3", expiresAt: FUTURE, status: "committing", requestId: "rpr-3", shortCode: "999999", deviceName: "x", platform: "toaster" },
        { inviteId: "rpi-4", expiresAt: new Date(now - 1000).toISOString(), status: "pending", requestId: "rpr-4", shortCode: "111111" },
        { inviteId: "../x", status: "invited" },
        null,
      ],
    }, now);
    expect(rows.map((r) => [r.inviteId, r.status])).toEqual([["rpi-1", "pending"], ["rpi-2", "invited"], ["rpi-3", "approving"], ["rpi-4", "expired"]]);
    expect(rows[0]!.request).toEqual({ requestId: "rpr-1", deviceName: "Pixel 9", platform: "android", shortCode: "012345", csrSha256: HEX, keySha256: HEX, route: "relay" });
    expect(rows[1]!.request).toBeNull();
    expect(rows[1]!.scope).toBe("full");
    expect(rows[2]!.request?.platform).toBe("other");
    expect(rows[2]!.request?.route).toBeNull();
    expect(readPairingInvites(null)).toEqual([]);
    // A request without a six-digit code is not shown as decidable.
    expect(readPairingInvite({ ...pendingRow, shortCode: "12345" })?.request).toBeNull();
  });

  it("reads a created invite: the v2 string, relay or direct only", () => {
    const relay = readCreatedPairingInvite({ ...pendingRow, status: "invited", qr: "cutex-pair:v2:abc", payload: { bootstrapOrigin: "https://eva-pair.example", directUrls: ["http://100.64.0.1:24270", 3] } });
    expect(relay).toMatchObject({ qr: "cutex-pair:v2:abc", relay: true, bootstrapOrigin: "https://eva-pair.example", directUrls: ["http://100.64.0.1:24270"] });
    const direct = readCreatedPairingInvite({ inviteId: "rpi-9", expiresAt: FUTURE, status: "invited", qr: "cutex-pair:v2:def", relay: false, payload: { directUrls: ["http://100.64.0.1:24270"] } });
    expect(direct.relay).toBe(false);
    expect(() => readCreatedPairingInvite({ inviteId: "rpi-9", qr: "cutex-pair:v1?c=X" })).toThrow("malformed");
  });

  it("sends the documented requests", async () => {
    const { client, calls } = mockClient((call) => [200, call.method === "GET" ? { invites: [pendingRow] } : call.method === "POST" && call.url.endsWith("/invites") ? { inviteId: "rpi-5", expiresAt: FUTURE, status: "invited", qr: "cutex-pair:v2:x", payload: {} } : { ...pendingRow, status: "approved" }]);
    expect((await client.pairingInvites())[0]!.request?.shortCode).toBe("012345");
    await client.createPairingInvite({ userId: "u-0123456789ab", scope: "chat", label: "  phone  " });
    await client.createPairingInvite();
    await client.cancelPairingInvite("rpi-5");
    expect((await client.approvePairingRequest("rpi-1", "rpr-1", "012345"))?.status).toBe("approved");
    await client.denyPairingRequest("rpi-1", "rpr-1");
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["GET", "http://h:1/v2/pairing/invites", null],
      ["POST", "http://h:1/v2/pairing/invites", { userId: "u-0123456789ab", scope: "chat", label: "phone" }],
      ["POST", "http://h:1/v2/pairing/invites", {}],
      ["DELETE", "http://h:1/v2/pairing/invites/rpi-5", null],
      ["POST", "http://h:1/v2/pairing/invites/rpi-1/approve", { requestId: "rpr-1", shortCode: "012345", confirm: true }],
      ["POST", "http://h:1/v2/pairing/invites/rpi-1/deny", { requestId: "rpr-1" }],
    ]);
  });

  it("refuses bad ids, scopes and codes before any request", async () => {
    const { client, calls } = mockClient();
    for (const id of [".", "..", "a/b", ""]) {
      await expect(client.cancelPairingInvite(id)).rejects.toThrow("bad invite id");
      await expect(client.approvePairingRequest(id, "rpr-1", "123456")).rejects.toThrow("bad invite id");
    }
    await expect(client.approvePairingRequest("rpi-1", "rpr-1", "12345")).rejects.toThrow("bad short code");
    await expect(client.approvePairingRequest("rpi-1", "../x", "123456")).rejects.toThrow("bad request id");
    await expect(client.createPairingInvite({ scope: "root" as never })).rejects.toThrow("bad scope");
    await expect(client.createPairingInvite({ userId: "root" })).rejects.toThrow("bad user id");
    expect(calls).toEqual([]);
  });

  it("keeps refusals as API errors", async () => {
    await expect(mockClient(() => [403, { error: { code: "owner_local_only", message: "no" } }]).client.pairingInvites()).rejects.toMatchObject({ code: "owner_local_only", status: 403 });
  });
});
