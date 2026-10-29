// profile-runtime-variants (docs/design/048): the new-agent page sends the variant it showed as `variantId`
// (lib/profileVariants createVariantId), and main forwards it to `POST /v2/human/agents` checked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {
    request = vi.fn(async () => ({ cutexSessionId: "new-agent" }));
    constructor(public endpoint: unknown) { fixture.clients.push(this); }
    host() { return new Promise(() => {}); }
  },
  CutexApiError: class extends Error {},
  CutexUnreachableError: class extends Error {},
  EventFeed: class {},
  openStream: vi.fn(),
}));
import { DaemonService } from "../src/main/daemon";
import { createVariantId } from "../src/renderer/src/lib/profileVariants";

describe("new agent: variantId", () => {
  it("is the variant the page showed; auto pick and older hosts send none", () => {
    expect(createVariantId({ id: "dsh" }, "omega")).toBe("dsh");
    expect(createVariantId({ id: "codex" }, "omega")).toBe("codex");
    expect(createVariantId({ id: "dsh" }, "auto:deepseek")).toBeUndefined();
    expect(createVariantId(null, "omega")).toBeUndefined();
  });

  let service: DaemonService;
  beforeEach(() => {
    fixture.clients.length = 0;
    service = new DaemonService(() => {});
  });
  afterEach(() => service.stop());

  it("main forwards it to POST /v2/human/agents, and refuses a malformed one", async () => {
    service.useEndpoint({ baseUrl: "http://a.invalid", token: "fake" } as any, { remote: true });
    const c = fixture.clients.at(-1);
    await service.createAgent({ name: "Ada", profile: "omega", variantId: createVariantId({ id: "dsh" }, "omega"), start: true });
    expect(c.request).toHaveBeenCalledWith("POST", "/v2/human/agents", { body: expect.objectContaining({ name: "Ada", profile: "omega", variantId: "dsh", start: true }) });
    await service.createAgent({ name: "Bo", profile: "auto:deepseek", start: true });
    expect(c.request.mock.calls.at(-1)[2].body).not.toHaveProperty("variantId");
    await expect(service.createAgent({ name: "Cy", profile: "omega", variantId: "../x", start: true })).rejects.toThrow("bad variant id");
  });
});
