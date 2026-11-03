import { describe, expect, it, vi } from "vitest";
import { CutexClient } from "../src/index";

describe("owner-admission-held-v1 opt-in", () => {
  it.each(["auto", "queue", "interrupt"] as const)("passes allowHeld for %s once with the original identity", async strategy => {
    const held = { disposition: "held", heldBy: "hostBusy", clientUserMessageId: "owner-1", heldSince: "2026-11-01T00:00:00Z", heldUntil: "2026-11-01T00:01:00Z", appServerAccepted: false, queue: null };
    const fetch = vi.fn(async () => Response.json({ cutex: { result: held } }));
    const client = new CutexClient({ baseUrl: "http://private.invalid", token: null }, { fetch });
    const input = [{ type: "text", text: "original" }];
    expect(await client.submitInput("session", input, strategy, { clientUserMessageId: "owner-1", allowHeld: true })).toEqual(held);
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ method: "cutex/userInput/submit", params: { input, strategy, clientUserMessageId: "owner-1", allowHeld: true } });
  });
  it.each([undefined, false])("omits allowHeld for legacy callers (%s)", async allowHeld => {
    const fetch = vi.fn(async () => Response.json({ cutex: { result: { disposition: "queued" } } }));
    const client = new CutexClient({ baseUrl: "http://private.invalid", token: null }, { fetch });
    await client.submitInput("session", [{ type: "text", text: "original" }], "auto", { allowHeld });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.params).not.toHaveProperty("allowHeld");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
