// Design 025 (a 1.5 GB image conversation could not be opened): main asks for history media as
// `cutex-media:` references only from a host that offers history-media-refs (older cutex refuses the
// parameter), reads one back as a data URL, and the renderer parses the reference.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ bootstrap: vi.fn(), history: vi.fn(), historyMedia: vi.fn(), features: [] as string[] }));
vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock("../src/main/errorLog", () => ({ logError: vi.fn() }));
vi.mock("@cutex-desktop/cutex-client", () => ({
  LIVE_DELTAS_FEATURE: "live-text-deltas",
  CutexClient: class {
    constructor(public endpoint: unknown) {}
    bootstrap = fixture.bootstrap;
    history = fixture.history;
    historyMedia = fixture.historyMedia;
    capabilities() { return Promise.resolve({ hostId: "h", featureList: fixture.features }); }
    host() { return new Promise(() => {}); }
  },
  CutexApiError: class extends Error {},
  CutexUnreachableError: class extends Error {},
  EventFeed: class {},
  openStream: vi.fn(),
  userAccessOf: () => ({ isOwner: true }),
}));
vi.mock("../src/renderer/src/store", () => ({ hostApi: () => ({}), useApp: { getState: () => ({ hosts: null }), subscribe: () => () => {} } }));
import { DaemonService } from "../src/main/daemon";
import { parseMediaRef } from "../src/renderer/src/lib/historyMedia";

let service: DaemonService;
beforeEach(() => {
  for (const fn of [fixture.bootstrap, fixture.history, fixture.historyMedia]) fn.mockReset().mockResolvedValue({});
  service = new DaemonService(() => {});
  service.useEndpoint({ baseUrl: "http://fixture.invalid", token: "fake" } as any, { remote: true });
});
afterEach(() => service.stop());

it("asks for media references only once the host offered history-media-refs", async () => {
  fixture.features = [];
  await service.capabilities();
  await service.bootstrap("s1", 30);
  await service.history("s1", "c", 30);
  expect(fixture.bootstrap).toHaveBeenLastCalledWith("s1", { turnLimit: 30, mediaRefs: false });
  expect(fixture.history).toHaveBeenLastCalledWith("s1", { limit: 30, cursor: "c", mediaRefs: false });
  fixture.features = ["history-pages", "history-media-refs"];
  // Capabilities are memoized for a connection; an upgraded daemon is a new connection.
  service.useEndpoint({ baseUrl: "http://upgraded.invalid", token: "fake" } as any, { remote: true });
  await service.capabilities();
  await service.bootstrap("s1", 30);
  await service.history("s1", null, 30);
  expect(fixture.bootstrap).toHaveBeenLastCalledWith("s1", { turnLimit: 30, mediaRefs: true });
  expect(fixture.history).toHaveBeenLastCalledWith("s1", { limit: 30, cursor: null, mediaRefs: true });
});

it("a new connection forgets the capability until it is read again", async () => {
  fixture.features = ["history-media-refs"];
  await service.capabilities();
  service.useEndpoint({ baseUrl: "http://other.invalid", token: "fake" } as any, { remote: true });
  await service.bootstrap("s1", 30);
  expect(fixture.bootstrap).toHaveBeenLastCalledWith("s1", { turnLimit: 30, mediaRefs: false });
});

it("reads a media reference back as a data URL", async () => {
  fixture.historyMedia.mockResolvedValueOnce({ contentType: "image/png", data: "iVBORw0K", etag: null }).mockResolvedValueOnce(null);
  expect(await service.historyMedia("cutex.s1", "a".repeat(64))).toEqual({ dataUrl: "data:image/png;base64,iVBORw0K" });
  expect(await service.historyMedia("cutex.s1", "a".repeat(64))).toBeNull();
});

it("parses cutex-media references and nothing else", () => {
  const sha = "0123456789abcdef".repeat(4);
  expect(parseMediaRef(`cutex-media:cutex.01a15e45-5685/${sha}`)).toEqual({ sessionId: "cutex.01a15e45-5685", sha256: sha });
  expect(parseMediaRef(`cutex-media:/${sha}`)).toBeNull();
  expect(parseMediaRef("cutex-media:cutex.s1/abc")).toBeNull();
  expect(parseMediaRef("data:image/png;base64,AAAA")).toBeNull();
  expect(parseMediaRef(undefined)).toBeNull();
});
