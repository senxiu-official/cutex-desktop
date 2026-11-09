// cutex agent-memory-injection: main sends `memoryInjection: false` on create only when the owner turned it
// off (older cutex refuses the field; true is cutex's default), and the renderer may flip it later through the
// guarded cutex/session/defaults/update patch.
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
import { checkDefaultsPatch } from "../src/shared/sessionDefaults";
import { memoryInjectionOf } from "../src/shared/memoryInjection";

describe("memory injection", () => {
  let service: DaemonService;
  beforeEach(() => {
    fixture.clients.length = 0;
    service = new DaemonService(() => {});
  });
  afterEach(() => service.stop());

  it("create sends memoryInjection only when it is off", async () => {
    service.useEndpoint({ baseUrl: "http://a.invalid", token: "fake" } as any, { remote: true });
    const c = fixture.clients.at(-1);
    await service.createAgent({ name: "Ada", start: true, memoryInjection: false });
    expect(c.request.mock.calls.at(-1)[2].body).toMatchObject({ name: "Ada", memoryInjection: false });
    await service.createAgent({ name: "Bo", start: true, memoryInjection: true });
    expect(c.request.mock.calls.at(-1)[2].body).not.toHaveProperty("memoryInjection");
    await service.createAgent({ name: "Cy", start: true });
    expect(c.request.mock.calls.at(-1)[2].body).not.toHaveProperty("memoryInjection");
  });

  it("the defaults patch takes a boolean memoryInjection only", () => {
    expect(() => checkDefaultsPatch({ patch: { memoryInjection: false } })).not.toThrow();
    expect(() => checkDefaultsPatch({ patch: { memoryInjection: true }, expectedRevision: 2 })).not.toThrow();
    expect(() => checkDefaultsPatch({ patch: { memoryInjection: "false" } })).toThrow();
    expect(() => checkDefaultsPatch({ patch: { memoryInjection: false, permissions: "full-access" } })).toThrow();
  });

  it("reads cutex's projection: top level, then runtimeDefaults; absent = on", () => {
    expect(memoryInjectionOf({ memoryInjection: false, runtimeDefaults: { memoryInjection: true } })).toBe(false);
    expect(memoryInjectionOf({ runtimeDefaults: { memoryInjection: false } })).toBe(false);
    expect(memoryInjectionOf({ runtimeDefaults: {} })).toBe(true);
    expect(memoryInjectionOf(null)).toBe(true);
  });
});
