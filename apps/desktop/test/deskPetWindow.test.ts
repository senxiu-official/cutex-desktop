// The pet's window as main creates it. Real input against the real window is outside this suite; this holds the option
// that decides whether the window can still take a left press after something has covered it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: { webPreferences?: Record<string, unknown> }[] = [];
const handlers = new Map<string, (event: unknown, raw: unknown) => unknown>();

vi.mock("electron", () => {
  const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
  class BrowserWindow {
    static getFocusedWindow = () => null;
    webContents = { send() {}, on() {}, setWindowOpenHandler() {} };
    constructor(options: { webPreferences?: Record<string, unknown> }) {
      created.push(options);
    }
    isDestroyed = () => false;
    setMenu() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    setShape() {}
    setBounds() {}
    once() {}
    on() {}
    loadFile = async () => {};
    destroy() {}
  }
  const image = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toBitmap: () => Buffer.alloc(4), toPNG: () => Buffer.alloc(0), toDataURL: () => "data:," };
  return {
    app: { isPackaged: true, on() {}, off() {} },
    BrowserWindow,
    ipcMain: { handle: (channel: string, fn: (event: unknown, raw: unknown) => unknown) => handlers.set(channel, fn), on() {} },
    Menu: { buildFromTemplate: () => ({ popup() {} }) },
    nativeImage: { createFromBitmap: () => image, createFromBuffer: () => image },
    screen: { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayNearestPoint: () => display, getCursorScreenPoint: () => ({ x: 0, y: 0 }), on() {}, off() {} },
    session: { fromPartition: () => ({ webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) },
  };
});

const { DeskPetService } = await import("../src/main/deskPet");
const { DESK_PET_CHANNEL } = await import("../src/shared/deskPet");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cutex-pet-window-"));
  created.length = 0;
  handlers.clear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the pet's window", () => {
  it("lets Chromium mark the page hidden while it is covered, or left presses stop reaching it afterwards", async () => {
    // With backgroundThrottling off the page is never marked hidden, so uncovering it never counts as being shown again
    // and Chromium's input child stays hidden. Presses then land on the top window, which eats them as it cannot activate.
    const service = new DeskPetService({ dir, isAppSender: () => true, packArt: () => null, locale: () => "en", sendView() {}, openSettings() {}, openPath: async () => {} });
    service.register();
    await handlers.get(DESK_PET_CHANNEL)!({}, { op: "start", labels: { clickThrough: "x", translucent: "x", mirror: "x", onlyInFront: "x", showCount: "x", size: "x", character: "x", hide: "x", settings: "x" } });
    expect(created).toHaveLength(1);
    expect(created[0]!.webPreferences).not.toHaveProperty("backgroundThrottling", false);
    service.dispose();
  });
});
