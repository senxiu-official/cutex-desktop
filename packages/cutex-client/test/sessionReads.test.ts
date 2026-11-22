// r290 P4 scoped session reads: the pending requests alone, and an uploaded image by session + id.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { attachmentIdOfPath, CutexClient } from "../src/index";

function client(answer: (url: URL) => Response) {
  const fetch = vi.fn(async (input: string | URL | Request) => answer(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)));
  return { api: new CutexClient({ baseUrl: "https://host.example:1", token: "member-token" }, { fetch: fetch as typeof globalThis.fetch, clientId: "test" }), fetch };
}
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const id = createHash("sha256").update(png).digest("hex");

describe("serverRequests", () => {
  it("reads GET /v2/sessions/{id}/server-requests and keeps each request's generation", async () => {
    const native = { id: 7, method: "item/tool/requestUserInput", params: { questions: [] } };
    const { api, fetch } = client(() => Response.json({ contractVersion: 2, cutexSessionId: "cutex.a", runtimeGeneration: 3, requests: [{ runtimeGeneration: 3, native }] }));
    expect(await api.serverRequests("cutex.a")).toEqual({ contractVersion: 2, cutexSessionId: "cutex.a", runtimeGeneration: 3, requests: [{ runtimeGeneration: 3, native }] });
    expect(String(fetch.mock.calls[0]![0])).toBe("https://host.example:1/v2/sessions/cutex.a/server-requests");
  });

  it("refuses a malformed answer and a bad session id", async () => {
    const { api, fetch } = client(() => Response.json({ cutexSessionId: "cutex.a", requests: "no" }));
    await expect(api.serverRequests("cutex.a")).rejects.toThrow("bad server-requests answer");
    await expect(api.serverRequests("../x")).rejects.toThrow("bad session id");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("sessionAttachment", () => {
  it("reads the bytes by session + id and checks them against the id", async () => {
    const { api, fetch } = client(() => new Response(png, { headers: { "Content-Type": "image/png" } }));
    expect(await api.sessionAttachment("cutex.a", id)).toEqual({ bytes: png, mime: "image/png", size: png.length });
    expect(String(fetch.mock.calls[0]![0])).toBe(`https://host.example:1/v2/sessions/cutex.a/attachments/${id}`);
  });

  it("gone (404) is null; bytes that do not hash to the id are refused (null, like an event blob); a bad id never goes out", async () => {
    expect(await client(() => new Response("{}", { status: 404 })).api.sessionAttachment("cutex.a", id)).toBeNull();
    await expect(client(() => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } })).api.sessionAttachment("cutex.a", id)).resolves.toBeNull();
    const { api, fetch } = client(() => new Response(png));
    await expect(api.sessionAttachment("cutex.a", "../config")).rejects.toThrow("bad attachment id");
    await expect(api.sessionAttachment("cutex.a", id.toUpperCase())).rejects.toThrow("bad attachment id");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("attachmentIdOfPath", () => {
  it("finds the id of an upload-store path only", () => {
    expect(attachmentIdOfPath(`C:\\Users\\o\\.cutex\\runtime\\attachments\\cutex.a\\${id}.png`)).toBe(id);
    expect(attachmentIdOfPath(`/home/o/.cutex/runtime/attachments/s-0123/${id}.jpeg`)).toBe(id);
    expect(attachmentIdOfPath(`/work/${id}.png`)).toBeNull();
    expect(attachmentIdOfPath(`/x/attachments/a/${id}.svg`)).toBeNull();
    expect(attachmentIdOfPath(`/x/attachments/a/b/${id.slice(1)}.png`)).toBeNull();
  });
});
