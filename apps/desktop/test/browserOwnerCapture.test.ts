// Component effect wiring only: hook/DOM stubs do not stand in for Electron acceptance.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  layer: null as unknown,
  effects: [] as (() => void | (() => void))[],
  install: vi.fn(),
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: (value: unknown) => ({ current: value === null ? mocks.layer : value }),
  useLayoutEffect: (effect: () => void | (() => void)) => { mocks.effects.push(effect); },
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: {} }));
vi.mock("../src/renderer/src/modules/browser/ownerInput", () => ({ installBrowserOwnerCapture: mocks.install }));
import { BrowserOwnerCapture } from "../src/renderer/src/modules/browser/BrowserOwnerCapture";

const guestId = "browser-test-guest";
beforeEach(() => { mocks.layer = { ownerDocument: {} }; mocks.effects.length = 0; mocks.install.mockReset(); });

function render(guest: unknown, viewportMissing = false) {
  const failed = vi.fn();
  const viewport = { current: viewportMissing ? null : { querySelector: vi.fn(() => guest) } };
  const element = BrowserOwnerCapture({ hostId: "local", tabKey: "instance", guestId,
    viewport: viewport as never, failed });
  const cleanup = mocks.effects[0]!();
  return { failed, element, cleanup };
}

describe("browser capture effect initialization diagnostics", () => {
  it.each(["missing-layer", "missing-viewport", "missing-webview", "wrong-guest"])("reports %s without installing listeners or marking ready", reason => {
    if (reason === "missing-layer") mocks.layer = null;
    const guest = reason === "missing-webview" ? null : { getAttribute: () => reason === "wrong-guest" ? "other-guest" : guestId };
    const f = render(guest, reason === "missing-viewport");
    expect(f.failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "browser_capture_target_unavailable" }));
    expect(mocks.install).not.toHaveBeenCalled();
    expect(f.cleanup).toBeUndefined();
    expect(f.element.props["data-browser-owner-capture"]).toBe(guestId);
    expect(f.element.props["data-browser-owner-ready"]).toBeUndefined();
  });
  it("installs only for the matching webview and returns exact cleanup", () => {
    const off = vi.fn(), guest = { getAttribute: () => guestId };
    mocks.install.mockReturnValueOnce(off);
    const f = render(guest);
    expect(f.failed).not.toHaveBeenCalled();
    expect(mocks.install).toHaveBeenCalledExactlyOnceWith(mocks.layer, guest, (mocks.layer as { ownerDocument: unknown }).ownerDocument,
      expect.any(Function), expect.any(Function));
    expect(f.cleanup).toBe(off); f.cleanup?.(); expect(off).toHaveBeenCalledOnce();
  });
  it("reports installation errors while retaining an unready capture layer", () => {
    const error = new Error("listener installation failed"); mocks.install.mockImplementationOnce(() => { throw error; });
    const f = render({ getAttribute: () => guestId });
    expect(f.failed).toHaveBeenCalledExactlyOnceWith(error);
    expect(f.element.props["data-browser-owner-capture"]).toBe(guestId);
    expect(f.element.props["data-browser-owner-ready"]).toBeUndefined();
  });
});
