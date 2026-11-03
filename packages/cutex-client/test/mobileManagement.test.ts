import { describe, expect, it } from "vitest";
import { CutexClient, CutexApiError } from "../src/index";

function fixture(status = 200) {
  const calls: { url: URL; method: string; body: unknown; auth: string | null }[] = [];
  const client = new CutexClient({ baseUrl: "http://phone-host:1234", token: "cxm1.phone" }, { fetch: async (input, init) => {
    calls.push({ url: new URL(String(input)), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify(status === 200 ? { cutexSessionId: "new" } : { contractVersion: 2, error: { source: "cutex", code: "owner_required", message: "owner required", retryable: false } }), { status });
  } });
  return { client, calls };
}

describe("paired-device management routes", () => {
  it("uses paired authentication and preserves filters/encoded path segments", async () => {
    const { client: c, calls } = fixture();
    await c.profiles(); await c.profileQuota("a/b"); await c.profileQuotaConfig("a/b");
    await c.usage({ from: "2026-11-01", to: "2026-11-01", groupBy: ["profile", "day"], source: "cutex" });
    await c.usagePrices(); await c.usageSources(); await c.profilePresets(); await c.profileAutoPick({ purpose: "quick_chat" }); await c.services(); await c.openService("a/b");
    expect(calls.map(c => c.url.pathname)).toEqual(["/v2/profiles", "/v2/profiles/a%2Fb/quota", "/v2/profiles/a%2Fb/quota-config", "/v2/usage", "/v2/usage/prices", "/v2/usage/sources", "/v2/profile-presets", "/v2/profile-auto-pick", "/v2/services", "/v2/services/a%2Fb/open"]);
    expect(calls[3]!.url.searchParams.get("groupBy")).toBe("profile,day");
    expect(calls.every(c => c.auth === "Bearer cxm1.phone")).toBe(true);
    expect(calls.at(-1)!.method).toBe("POST");
  });
  it("preserves caller-owned creation identity and stopped state", async () => {
    const { client: c, calls } = fixture();
    const body = { requestId: "intent-1", start: false, displayName: "task" };
    await c.createHumanSession(body); await c.createHumanSession(body);
    await c.createHumanAgent({ requestId: "intent-2", start: false, name: "Finch" });
    expect(calls.map(c => c.body)).toEqual([body, body, { requestId: "intent-2", start: false, name: "Finch" }]);
    expect(calls.at(-1)!.url.pathname).toBe("/v2/human/agents");
  });
  it("surfaces daemon permission errors without a second POST", async () => {
    const { client, calls } = fixture(403);
    await expect(client.createHumanSession({ requestId: "x", start: false })).rejects.toBeInstanceOf(CutexApiError);
    expect(calls).toHaveLength(1);
  });
});
