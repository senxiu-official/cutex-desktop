// Main process: Windows sandbox readiness / unelevated setup go to the agent's runtime as the native
// methods cutex allows (windows-sandbox-readiness), with exactly the params its fence accepts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ clients: [] as any[] }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, shell: {} }));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {
    native = vi.fn(async (_sessionId: string, method: string) => (method === "windowsSandbox/readiness" ? { status: "notConfigured" } : { started: true }));
    constructor(public endpoint: unknown) { fixture.clients.push(this); }
    host() { return new Promise(() => {}); }
  },
  CutexApiError: class extends Error {},
  CutexUnreachableError: class extends Error {},
  EventFeed: class {},
  openStream: vi.fn(),
}));
import { DaemonService } from "../src/main/daemon";

let service: DaemonService;
function connect() {
  service.useEndpoint({ baseUrl: "http://a.invalid", token: "fake" } as any, { remote: true });
  return fixture.clients.at(-1);
}

beforeEach(() => {
  fixture.clients.length = 0;
  service = new DaemonService(() => {});
});
afterEach(() => service.stop());

describe("windows sandbox native calls", () => {
  it("reads readiness without params and starts only the unelevated setup", async () => {
    const c = connect();
    expect(await service.windowsSandboxReadiness("s1")).toBe("notConfigured");
    expect(c.native).toHaveBeenCalledWith("s1", "windowsSandbox/readiness", undefined);
    expect(await service.setupWindowsSandbox("s1")).toEqual({ started: true });
    expect(c.native).toHaveBeenLastCalledWith("s1", "windowsSandbox/setupStart", { mode: "unelevated" });
  });

  it("reads an unknown answer or a refusal (older cutex: native_method_denied) as null", async () => {
    const c = connect();
    c.native.mockResolvedValueOnce({ status: "maybe" });
    expect(await service.windowsSandboxReadiness("s1")).toBeNull();
    c.native.mockRejectedValueOnce(new Error("403 native_method_denied"));
    expect(await service.windowsSandboxReadiness("s1")).toBeNull();
  });
});
