import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ hostSessions: vi.fn(), log: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock("../src/main/errorLog", () => ({ logError: fixture.log }));
vi.mock("@cutex-desktop/cutex-client", () => ({
  CutexClient: class {
    constructor(public endpoint: unknown) {}
    hostSessions = fixture.hostSessions;
    host() { return new Promise(() => {}); }
    sessions() { return Promise.resolve({ sessions: [] }); }
    projects() { return Promise.resolve({ projects: [] }); }
  },
  CutexApiError: class extends Error {},
  CutexUnreachableError: class extends Error {},
  EventFeed: class {},
  openStream: vi.fn(),
}));
import { DaemonService } from "../src/main/daemon";

let service: DaemonService;
beforeEach(() => {
  fixture.hostSessions.mockReset();
  fixture.log.mockReset();
  service = new DaemonService(() => {});
  service.useEndpoint({ baseUrl: "http://fixture.invalid", token: "fake" } as any, { remote: true });
});
afterEach(() => service.stop());

it("reports truncation after the pagination limit without logging rows or cursors", async () => {
  fixture.hostSessions.mockImplementation(async () => ({
    data: [{ id: `session-${fixture.hostSessions.mock.calls.length}`, name: "private-name" }],
    nextCursor: "private-cursor",
  }));
  const snapshot = await service.sidebar();
  expect(fixture.hostSessions).toHaveBeenCalledTimes(50);
  expect(Object.keys(snapshot.hostRows!)).toHaveLength(50);
  expect(fixture.log).toHaveBeenCalledExactlyOnceWith({
    source: "sidebar-pagination", message: "host session listing truncated at page limit", pages: 50, rows: 50,
  });
});

it("does not report truncation when the last allowed page completes the list", async () => {
  fixture.hostSessions.mockImplementation(async () => ({
    data: [{ id: `session-${fixture.hostSessions.mock.calls.length}` }],
    nextCursor: fixture.hostSessions.mock.calls.length === 50 ? null : "next",
  }));
  const snapshot = await service.sidebar();
  expect(Object.keys(snapshot.hostRows!)).toHaveLength(50);
  expect(fixture.hostSessions).toHaveBeenCalledTimes(50);
  expect(fixture.log).not.toHaveBeenCalled();
});

it("follows cursors and stops at the terminal page", async () => {
  fixture.hostSessions.mockResolvedValueOnce({ data: [{ id: "one" }], nextCursor: "next" });
  fixture.hostSessions.mockResolvedValueOnce({ data: [{ id: "two" }], nextCursor: null });
  expect(Object.keys((await service.sidebar()).hostRows!)).toEqual(["one", "two"]);
  expect(fixture.hostSessions.mock.calls).toEqual([["", undefined], ["", "next"]]);
  expect(fixture.log).not.toHaveBeenCalled();
});
