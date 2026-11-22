// interrupt-send-many-v1: a submit with strategy "interrupt" may name the unread owner inputs that go along.
import { describe, expect, it, vi } from "vitest";
import { CutexClient } from "../src/index";

const selection = { inputIds: ["a", "b"], expectedRevs: { a: 3, b: 4 }, expectedTurnId: "t1", expectedRuntimeGeneration: 7 };
const body = (fetch: ReturnType<typeof vi.fn>) => JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

describe("submit interruptSend selection", () => {
  it("is sent with an interrupt, under the draft's own id", async () => {
    const fetch = vi.fn(async () => Response.json({ cutex: { result: { disposition: "started" } } }));
    const client = new CutexClient({ baseUrl: "http://private.invalid", token: null }, { fetch });
    await client.submitInput("session", [{ type: "text", text: "draft" }], "interrupt", { clientUserMessageId: "draft-1", interruptSend: selection });
    expect(body(fetch).params).toMatchObject({ strategy: "interrupt", clientUserMessageId: "draft-1", interruptSend: selection });
  });
  it.each(["auto", "queue"] as const)("is never sent with %s", async strategy => {
    const fetch = vi.fn(async () => Response.json({ cutex: { result: { disposition: "queued" } } }));
    const client = new CutexClient({ baseUrl: "http://private.invalid", token: null }, { fetch });
    await client.submitInput("session", [{ type: "text", text: "draft" }], strategy, { interruptSend: selection });
    expect(body(fetch).params).not.toHaveProperty("interruptSend");
  });
});
