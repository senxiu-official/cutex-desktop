// App shortcuts under the browser host capture layer (handoff codex-browser-i2 §7 D-G): the layer
// preventDefaults the owner's trusted keydown and lets it bubble; window shortcut handlers still skip
// every other defaultPrevented key.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_CAPTURE_ATTR, isCaptureKeydown, shortcutKeyUsed } from "../src/renderer/src/lib/browserCapture";

const sideMocks = vi.hoisted(() => ({ goToPage: vi.fn(), newPage: vi.fn(), toggleModeForFocus: vi.fn(), toggleSideColumn: vi.fn(), runEscChain: vi.fn() }));
const terminalMocks = vi.hoisted(() => ({ open: vi.fn(() => ({ status: "opened" })), reveal: vi.fn(), list: vi.fn(() => []) }));

vi.mock("react", () => ({ useEffect: (effect: () => void) => effect() }));
vi.mock("../src/renderer/src/lib/sideActions", () => ({ goToPage: sideMocks.goToPage, newPage: sideMocks.newPage, toggleModeForFocus: sideMocks.toggleModeForFocus }));
vi.mock("../src/renderer/src/lib/sideOpen", () => ({ toggleSideColumn: sideMocks.toggleSideColumn }));
vi.mock("../src/renderer/src/lib/escLayers", () => ({ runEscChain: sideMocks.runEscChain }));
vi.mock("../src/renderer/src/lib/openOverlays", () => ({ anyOverlayOpen: () => false }));
vi.mock("../src/renderer/src/lib/escInterrupt", () => ({ overlayInDom: () => false }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
vi.mock("../src/renderer/src/store", () => ({ hostApi: () => ({}) }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { side: { list: terminalMocks.list, open: terminalMocks.open, reveal: terminalMocks.reveal } } }));

const { useSideShortcuts } = await import("../src/renderer/src/lib/useSideShortcuts");
const { startTerminals } = await import("../src/renderer/src/modules/terminal/terminals");

class FakeElement {
  constructor(private readonly attrs: Record<string, string> = {}) {}
  hasAttribute(name: string): boolean { return name in this.attrs; }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
}
const captureLayer = () => new FakeElement({ [BROWSER_CAPTURE_ATTR]: "guest-0123456789abcdef", tabindex: "0" });

type Key = { key: string; code: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean };
function keydown(key: Key, opts: { trusted?: boolean; prevented?: boolean; target?: unknown } = {}) {
  return {
    type: "keydown", isComposing: false, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...key,
    isTrusted: opts.trusted ?? true, defaultPrevented: opts.prevented ?? true, target: ("target" in opts ? opts.target : captureLayer()) as EventTarget | null,
    preventDefault: vi.fn(),
  };
}

const CTRL_SHIFT_M: Key = { key: "M", code: "KeyM", ctrlKey: true, shiftKey: true };
const F6: Key = { key: "F6", code: "F6" };
const CTRL_BACKQUOTE: Key = { key: "`", code: "Backquote", ctrlKey: true };

let listeners: Map<string, ((e: unknown) => void)[]>;
const dispatch = (e: unknown) => { for (const fn of listeners.get("keydown") ?? []) fn(e); };
let focused: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listeners = new Map();
  focused = vi.fn();
  const target = { focus: focused };
  const region = { getBoundingClientRect: () => ({ width: 10, height: 10 }), contains: () => false, dataset: {}, querySelector: () => target };
  const body = {};
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  vi.stubGlobal("document", { body, activeElement: body, querySelectorAll: () => [region], querySelector: () => null });
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (e: unknown) => void, capture?: boolean) => { if (!capture) listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    removeEventListener: () => {},
  });
  for (const m of [...Object.values(sideMocks), ...Object.values(terminalMocks)]) m.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("isCaptureKeydown / shortcutKeyUsed", () => {
  it("only a trusted keydown on a capture layer element is the exception", () => {
    expect(isCaptureKeydown(keydown(F6))).toBe(true);
    expect(isCaptureKeydown(keydown(F6, { trusted: false }))).toBe(false);
    expect(isCaptureKeydown(keydown(F6, { target: new FakeElement({ "data-browser-viewport": "" }) }))).toBe(false);
    expect(isCaptureKeydown(keydown(F6, { target: null }))).toBe(false);
    expect(isCaptureKeydown(keydown(F6, { target: {} }))).toBe(false);
    expect(isCaptureKeydown({ ...keydown(F6), type: "keyup" })).toBe(false);
  });
  it("defaultPrevented still means used for everything else; not prevented is never used", () => {
    expect(shortcutKeyUsed(keydown(F6))).toBe(false);
    expect(shortcutKeyUsed(keydown(F6, { trusted: false }))).toBe(true);
    expect(shortcutKeyUsed(keydown(F6, { target: new FakeElement() }))).toBe(true);
    expect(shortcutKeyUsed(keydown(F6, { prevented: false, trusted: false, target: null }))).toBe(false);
  });
});

describe("side shortcuts under the capture layer", () => {
  beforeEach(() => useSideShortcuts(true));

  it("Ctrl+Shift+M and F6 still run for a defaultPrevented capture-layer keydown", () => {
    dispatch(keydown(CTRL_SHIFT_M));
    expect(sideMocks.toggleModeForFocus).toHaveBeenCalledWith("maximised");
    dispatch(keydown(F6));
    expect(focused).toHaveBeenCalledTimes(1);
  });
  it("other defaultPrevented keydowns still bail", () => {
    dispatch(keydown(CTRL_SHIFT_M, { target: new FakeElement({ "data-browser-card": "" }) }));
    dispatch(keydown(F6, { target: new FakeElement() }));
    expect(sideMocks.toggleModeForFocus).not.toHaveBeenCalled();
    expect(focused).not.toHaveBeenCalled();
  });
  it("untrusted (synthetic) capture-layer keydowns still bail", () => {
    dispatch(keydown(CTRL_SHIFT_M, { trusted: false }));
    dispatch(keydown(F6, { trusted: false }));
    expect(sideMocks.toggleModeForFocus).not.toHaveBeenCalled();
    expect(focused).not.toHaveBeenCalled();
  });
});

describe("terminal Ctrl+` under the capture layer", () => {
  beforeEach(() => {
    startTerminals({ services: { ui: { notice: vi.fn() } }, t: (k: string) => k, signal: new AbortController().signal } as never);
  });

  it("runs for a defaultPrevented capture-layer keydown", () => {
    dispatch(keydown(CTRL_BACKQUOTE));
    expect(terminalMocks.open).toHaveBeenCalledTimes(1);
  });
  it("bails for other defaultPrevented and for untrusted keydowns", () => {
    dispatch(keydown(CTRL_BACKQUOTE, { target: new FakeElement() }));
    dispatch(keydown(CTRL_BACKQUOTE, { trusted: false }));
    expect(terminalMocks.open).not.toHaveBeenCalled();
  });
  it("still runs for an ordinary key nobody used", () => {
    dispatch(keydown(CTRL_BACKQUOTE, { prevented: false, target: new FakeElement() }));
    expect(terminalMocks.open).toHaveBeenCalledTimes(1);
  });
});

// The layer lives in the browser module (Codex I2b). Once merged, its marker must match this predicate.
const layerFile = join(__dirname, "../src/renderer/src/modules/browser/BrowserOwnerCapture.tsx");
describe.skipIf(!existsSync(layerFile))("capture layer marker", () => {
  it("BrowserOwnerCapture renders the attribute isCaptureKeydown checks", () => {
    expect(readFileSync(layerFile, "utf8")).toContain(`${BROWSER_CAPTURE_ATTR}=`);
  });
});
