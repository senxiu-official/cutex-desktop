// 项目看板 window service (main/board.ts) with Electron faked: its channel answers only its own window; it reads hosts
// only while the window is on screen (hidden / minimised / closed = no daemon calls); clicks show the main window and
// forward a checked target; prefs from the window are sanitised.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  handler: null as null | ((event: unknown, request: unknown) => Promise<unknown>),
  windows: [] as FakeWin[],
  userData: "",
}));
type FakeWin = { webContents: { send: ReturnType<typeof vi.fn> }; visible: boolean; minimized: boolean; destroyed: boolean; emit(e: string): void; destroy(): void; alwaysOnTop: unknown };

vi.mock("electron", () => {
  class FakeWindow {
    webContents = { send: vi.fn(), setWindowOpenHandler() {}, on() {} };
    destroyed = false;
    visible = false;
    minimized = false;
    alwaysOnTop: unknown = null;
    handlers = new Map<string, (() => void)[]>();
    constructor() {
      fake.windows.push(this as unknown as FakeWin);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    isMaximized() { return false; }
    isFullScreen() { return false; }
    getBounds() { return { x: 0, y: 0, width: 720, height: 1100 }; }
    setAlwaysOnTop(v: unknown) { this.alwaysOnTop = v; }
    setMenu() {}
    once(e: string, fn: () => void) { this.on(e, fn); }
    on(e: string, fn: () => void) { this.handlers.set(e, [...(this.handlers.get(e) ?? []), fn]); }
    emit(e: string) { for (const fn of this.handlers.get(e) ?? []) fn(); }
    show() { this.visible = true; this.emit("show"); }
    focus() {}
    restore() { this.minimized = false; this.emit("restore"); }
    loadFile() { return Promise.resolve(); }
    loadURL() { return Promise.resolve(); }
  }
  return {
    app: { isPackaged: true, getPath: () => fake.userData },
    BrowserWindow: FakeWindow,
    ipcMain: { handle: (_c: string, fn: typeof fake.handler) => void (fake.handler = fn) },
    screen: { getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }], getPrimaryDisplay: () => ({ id: 1 }) },
  };
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardWindow } from "../src/main/board";
import type { BoardState } from "../src/shared/board";

function daemon() {
  return {
    currentState: { kind: "connected" },
    capabilities: vi.fn(async () => ({ featureList: [] })),
    sidebar: vi.fn(async () => ({ active: [], retired: [], projects: { schema: "x", projects: [] }, hostRows: {} })),
    asks: vi.fn(async () => []),
    ownerNotifications: vi.fn(async () => []),
    approvals: vi.fn(async () => []),
    services: vi.fn(async () => ({ services: [] })),
    profileQuota: vi.fn(async () => []),
    projectBoard: vi.fn(async () => ({ projects: [] })),
  };
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

let d: ReturnType<typeof daemon>;
let board: BoardWindow;
let opened: unknown[];
let shown: number;
const ask = async (request: unknown, sender: unknown = fake.windows.at(-1)!.webContents) => fake.handler!({ sender }, request);

beforeEach(() => {
  vi.useFakeTimers();
  fake.windows.length = 0;
  fake.userData = mkdtempSync(join(tmpdir(), "board-test-"));
  d = daemon();
  opened = [];
  shown = 0;
  board = new BoardWindow({
    hosts: () => [{ id: "eva", kind: "local", label: "host-a", target: null, remotePort: null, cutexPath: null, paired: true, lastConnectedAt: null, conn: { epoch: "e1", tunnel: null, daemon: { kind: "connected", baseUrl: "x", hostId: "h" }, cutexBuild: null } }],
    daemonFor: () => d as never,
    shell: { locale: "zh-CN", terms: null, appIcon: () => null, show: () => void shown++ } as never,
    openInApp: (t) => void opened.push(t),
  });
  board.start();
});
afterEach(async () => {
  board.dispose();
  vi.useRealTimers();
  // Let a prefs save finish before its folder goes (else it logs after the test file has ended).
  await (board as unknown as { saving: Promise<void> }).saving;
  rmSync(fake.userData, { recursive: true, force: true });
});

describe("BoardWindow", () => {
  it("refuses calls from any other sender", async () => {
    board.open();
    await expect(ask({ op: "state" }, { other: true })).rejects.toThrow("untrusted sender");
    expect(board.isBoardSender(fake.windows[0]!.webContents as never)).toBe(true);
  });

  it("reads only while the window is on screen", async () => {
    board.onHostEvent("eva", "cutex/ask/created");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(d.sidebar).not.toHaveBeenCalled(); // no window
    board.open();
    const win = fake.windows[0]!;
    await vi.advanceTimersByTimeAsync(10);
    expect(d.sidebar).not.toHaveBeenCalled(); // created, not shown yet
    win.emit("ready-to-show");
    await flush();
    expect(d.sidebar).toHaveBeenCalledTimes(1);
    expect(d.asks).toHaveBeenCalledTimes(2); // open + closed
    expect(d.projectBoard).not.toHaveBeenCalled(); // no G1 capability
    win.minimized = true;
    win.emit("minimize");
    const calls = d.sidebar.mock.calls.length;
    board.onHostEvent("eva", "cutex/ask/updated");
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(d.sidebar.mock.calls.length).toBe(calls);
    win.minimized = false;
    win.emit("restore");
    await flush();
    expect(d.sidebar.mock.calls.length).toBe(calls + 1);
    win.destroy();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(d.sidebar.mock.calls.length).toBe(calls + 1);
  });

  it("with project-board-summary-v1: one summary read replaces the list reads", async () => {
    d.capabilities.mockResolvedValue({ featureList: ["project-board-summary-v1"] as never[] });
    board.open();
    fake.windows[0]!.emit("ready-to-show");
    await flush();
    expect(d.projectBoard).toHaveBeenCalledTimes(1);
    expect(d.asks).not.toHaveBeenCalled();
    expect(d.ownerNotifications).not.toHaveBeenCalled();
  });

  it("clicks show the main window and forward checked targets only", async () => {
    board.open();
    await ask({ op: "open", target: { kind: "agent", hostId: "eva", sessionId: "s1" } });
    expect(shown).toBe(1);
    expect(opened).toEqual([{ kind: "agent", hostId: "eva", sessionId: "s1" }]);
    await expect(ask({ op: "open", target: { kind: "run", cmd: "x" } })).rejects.toThrow("bad board target");
    expect(opened).toHaveLength(1);
  });

  it("prefs from the window: toggles apply, bounds cannot be set, always-on-top reaches the window", async () => {
    board.open();
    const s = (await ask({ op: "prefs", patch: { alwaysOnTop: true, view: "thumbnail", bounds: { x: 1, y: 1, width: 900, height: 900 } } })) as BoardState;
    expect(s.prefs).toMatchObject({ alwaysOnTop: true, view: "thumbnail", bounds: null });
    expect(fake.windows[0]!.alwaysOnTop).toBe(true);
    expect(board.setOpenOnLaunch(true)).toBe(true);
    expect(board.openOnLaunch).toBe(true);
  });
});

// Review P2 (board-window-review C1/C2): these fail on 77c8a2eb8.
describe("BoardWindow: no requests after hiding, no duplicate reads after restore", () => {
  const hang = <T,>(value: T) => {
    let release!: () => void;
    const promise = new Promise<T>((resolve) => (release = () => resolve(value)));
    return { promise, release: () => release() };
  };

  it("minimised during the capability lookup: no follow-up request starts when it answers", async () => {
    const caps = hang({ featureList: [] as never[] });
    d.capabilities.mockImplementationOnce(() => caps.promise);
    board.open();
    const win = fake.windows[0]!;
    win.emit("ready-to-show");
    await flush();
    win.minimized = true;
    win.emit("minimize");
    caps.release();
    await flush();
    expect(d.sidebar).not.toHaveBeenCalled();
    expect(d.asks).not.toHaveBeenCalled();
    expect(d.projectBoard).not.toHaveBeenCalled();
  });

  it("hidden during the list reads: the per-profile quota reads do not start", async () => {
    d.sidebar.mockResolvedValue({ active: [{ cutexSessionId: "s1", profile: "Ceobe", activityStatus: "idle", runtime: { status: "online" } }], retired: [], projects: { schema: "x", projects: [] }, hostRows: {} } as never);
    const asks = hang([] as never[]);
    d.asks.mockImplementationOnce(() => asks.promise);
    board.open();
    const win = fake.windows[0]!;
    win.emit("ready-to-show");
    await flush();
    expect(d.asks).toHaveBeenCalled();
    win.visible = false;
    win.emit("hide");
    asks.release();
    await flush();
    expect(d.profileQuota).not.toHaveBeenCalled();
  });

  it("minimise → restore during a read: the host is not read twice at once", async () => {
    const caps = hang({ featureList: [] as never[] });
    d.capabilities.mockImplementationOnce(() => caps.promise);
    board.open();
    const win = fake.windows[0]!;
    win.emit("ready-to-show");
    await flush();
    win.minimized = true;
    win.emit("minimize");
    win.minimized = false;
    win.emit("restore");
    await flush();
    expect(d.capabilities).toHaveBeenCalledTimes(1);
    caps.release();
    await flush();
    // The old read stops (it began before the minimise); one fresh read follows once the 10 s gap is over.
    expect(d.sidebar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(d.capabilities).toHaveBeenCalledTimes(2);
    expect(d.sidebar).toHaveBeenCalledTimes(1);
  });
});
