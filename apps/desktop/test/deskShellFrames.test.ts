// Multi-window P4 (docs/desktop-modules.md §24.17): the desk window's own guards, on a fake BrowserWindow.
// Sub-frames load only documents leased to this desk; when the desk closes, is destroyed, loses its renderer or
// its main frame navigates, every document and page channel leased to its webContents is released.
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { on: vi.fn() },
  BrowserWindow: class {},
  nativeTheme: { shouldUseDarkColors: false },
  screen: { on: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock("../src/main/windowState", () => ({
  forgetDeskBounds: vi.fn(),
  initialDeskBounds: () => ({ bounds: { x: 0, y: 0, width: 800, height: 600 }, maximized: false }),
  trackWindowState: vi.fn(),
  workAreas: () => [],
}));
const { DeskShell } = await import("../src/main/deskShell");

const MAIN = 7;
const DESK = 21;
const OWNED = "cutex-plugin://frame/00000000-0000-0000-0000-000000000001/index.html";

class FakeContents extends EventEmitter {
  constructor(readonly id: number) {
    super();
  }
  setWindowOpenHandler = vi.fn();
  setZoomFactor = vi.fn();
  setBackgroundThrottling = vi.fn();
  isDestroyed = () => false;
}
class FakeWindow extends EventEmitter {
  readonly webContents: FakeContents;
  constructor(id: number) {
    super();
    this.webContents = new FakeContents(id);
  }
  isDestroyed = () => false;
  destroy = vi.fn();
  isVisible = () => true;
  isMinimized = () => false;
}

function setup() {
  const releaseFrames = vi.fn();
  const emit = vi.fn();
  const shell = new DeskShell({
    mainWindow: () => null,
    icon: () => ({}) as never,
    background: () => "#000",
    ownsFrameUrl: (url, place) => url === OWNED && place === DESK,
    releaseFrames,
    emit,
    contextMenu: vi.fn(),
    created: vi.fn(),
    enabled: () => true,
  });
  const ticket = shell.registry.issue(MAIN)!;
  expect(shell.registry.admit({ url: "about:blank", frameName: ticket.name, openerId: MAIN })).toBe(ticket.deskId);
  const main = new FakeWindow(MAIN);
  const desk = new FakeWindow(DESK);
  const entry = shell.adopt(main as never, desk as never, ticket.name);
  expect(entry?.contentsId).toBe(DESK);
  return { shell, desk, releaseFrames, emit, deskId: ticket.deskId };
}

const frameNav = (url: string, isMainFrame: boolean) => ({ url, isMainFrame, preventDefault: vi.fn() });

describe("deskShell: a desk's frame documents", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => {
    s = setup();
  });

  it("closing the desk releases its webContents' documents and forgets it", () => {
    s.desk.emit("closed");
    expect(s.releaseFrames).toHaveBeenCalledWith(DESK);
    expect(s.shell.registry.byContents(DESK)).toBeNull();
    expect(s.emit).toHaveBeenCalledWith({ deskId: s.deskId, kind: "closed" });
  });

  it("its webContents destroyed releases them", () => {
    s.desk.webContents.emit("destroyed");
    expect(s.releaseFrames).toHaveBeenCalledWith(DESK);
  });

  it("its renderer gone releases them", () => {
    s.desk.webContents.emit("render-process-gone", {}, { reason: "crashed" });
    expect(s.releaseFrames).toHaveBeenCalledWith(DESK);
  });

  it("its main frame navigating releases them; same-document or sub-frame navigation does not", () => {
    s.desk.webContents.emit("did-start-navigation", {}, "about:blank#x", true, true);
    s.desk.webContents.emit("did-start-navigation", {}, OWNED, false, false);
    expect(s.releaseFrames).not.toHaveBeenCalled();
    s.desk.webContents.emit("did-start-navigation", {}, "about:blank", false, true);
    expect(s.releaseFrames).toHaveBeenCalledWith(DESK);
  });

  it("sub-frames load only a document leased to this desk; the main frame never navigates", () => {
    const owned = frameNav(OWNED, false);
    s.desk.webContents.emit("will-frame-navigate", owned);
    expect(owned.preventDefault).not.toHaveBeenCalled();
    const foreign = frameNav(OWNED.replace("01/", "02/"), false);
    s.desk.webContents.emit("will-frame-navigate", foreign);
    expect(foreign.preventDefault).toHaveBeenCalled();
    const top = frameNav(OWNED, true);
    s.desk.webContents.emit("will-frame-navigate", top);
    expect(top.preventDefault).toHaveBeenCalled();
  });
});
