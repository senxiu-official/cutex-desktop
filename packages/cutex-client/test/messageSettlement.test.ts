import { describe, expect, it, vi } from "vitest";
import { CutexClient } from "../src/client";

const request = { messageId: "m1", expectedEvidenceToken: "evidence", requestId: "owner-close-1", reason: "Owner has reviewed this separately" };
function client(fetch: typeof globalThis.fetch) {
  return new CutexClient({ baseUrl: "http://fixture.invalid", token: "fixture-token" }, { fetch: ((input, init) => String(input).endsWith("/v2/capabilities") ? Promise.resolve(Response.json({featureList:["agent-bus-message-settlement-v1"]})) : fetch(input,init)) as typeof globalThis.fetch, sleep: async () => {} });
}
describe("message settlement HTTP contract", () => {
  it("uses the strict body and preserves the caller's key/payload on an explicit replay", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "m1", changed: false, settlement: { state: "closed" } })));
    const api = client(fetch);
    await api.closeBusMessage({ ...request, rendererCannotAdd: true } as typeof request);
    // A distinct Response is required for each read of a fetch body.
    fetch.mockResolvedValue(new Response(JSON.stringify({ messageId: "m1", changed: false, settlement: { state: "closed" } })));
    expect(await api.closeBusMessage(request)).toMatchObject({ changed: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe("http://fixture.invalid/v2/agent-bus/stuck-messages/close");
      expect(init.method).toBe("POST"); expect(JSON.parse(init.body)).toEqual(request);
    }
  });
  it.each([403, 404, 409, 503])("preserves %i and never automatically replays the mutation", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "settlement_refused", message: "refused" } }), { status }));
    await expect(client(fetch).closeBusMessage(request)).rejects.toMatchObject({ status, code: "settlement_refused" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry an ambiguous network failure, even with an idempotency key", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("connection lost after request body"));
    await expect(client(fetch).closeBusMessage(request)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("on-demand stale ACK evidence collector", () => {
  function evidenceClient(fetch: typeof globalThis.fetch, feature = true, owner = true) {
    return new CutexClient({ baseUrl: "http://fixture.invalid", token: "fixture-token" }, { fetch: ((input, init) => String(input).endsWith("/v2/capabilities")
      ? Promise.resolve(Response.json({ featureList: feature ? ["agent-bus-stale-ack-settlement-v1"] : [], ...(owner ? {} : { user: { id: "reader", isOwner: false } }) })) : fetch(input, init)) as typeof globalThis.fetch, sleep: async () => {} });
  }
  it("uses the exact endpoint and strict ID-only body, returning null ineligibility unchanged", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ messageId: "m1", settlement: null }));
    expect(await evidenceClient(fetch).busMessageEvidence({ messageId: "m1", extra: true } as { messageId: string })).toEqual({ messageId: "m1", settlement: null });
    expect(fetch).toHaveBeenCalledExactlyOnceWith("http://fixture.invalid/v2/agent-bus/stuck-messages/evidence", expect.objectContaining({ method: "POST", body: '{"messageId":"m1"}' }));
  });
  it.each([404, 503])("preserves %i without an automatic retry or close", async status => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({ error: { code: "evidence_unavailable", message: "Unavailable" } }, { status }));
    await expect(evidenceClient(fetch).busMessageEvidence({ messageId: "m1" })).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([[false, true], [true, false]])("requires the new capability and owner authorization (%s/%s)", async (feature, owner) => {
    const fetch = vi.fn();
    await expect(evidenceClient(fetch, feature, owner).busMessageEvidence({ messageId: "m1" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["", " ", "x".repeat(513)])("rejects invalid IDs before any discovery or request", async messageId => {
    const fetch = vi.fn(); await expect(evidenceClient(fetch).busMessageEvidence({ messageId })).rejects.toThrow("bad settlement messageId");
    expect(fetch).not.toHaveBeenCalled();
  });
});
