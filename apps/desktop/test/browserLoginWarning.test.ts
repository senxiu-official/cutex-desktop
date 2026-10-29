import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import { browserLoginIntentScript, browserLoginOrigin, browserLoginTypingInput, BrowserLoginWarningDismissals, readBrowserLoginIntent } from "../src/main/browser/loginWarning";
import { parseBrowserRequest } from "../src/main/browser/channel";

const input = (type: string, autocomplete = "", passwordForm = false) => Object.defineProperty({
  tagName: "INPUT", type, disabled: false, readOnly: false,
  getAttribute: (key: string) => key === "autocomplete" ? autocomplete : null,
  form: passwordForm ? { querySelector: () => ({ tagName: "INPUT" }) } : null,
}, "value", { get() { throw Error("input values must never be read"); } });
const probe = (element: unknown, typing: boolean, schedule = (callback: () => void) => callback()) =>
  runInNewContext(browserLoginIntentScript(typing), { document: { activeElement: element }, setTimeout: schedule }) as Promise<boolean>;
const guest = () => ({
  mainFrame: {}, focusedFrame: null as unknown, isDestroyed: () => false,
  executeJavaScriptInIsolatedWorld: vi.fn(async () => false as unknown),
});
const read = (value: ReturnType<typeof guest>, typing = false) => readBrowserLoginIntent(value as unknown as WebContents, typing);

describe("browser login structural probe", () => {
  it("detects password focus and typing in login fields without accessing values", async () => {
    expect(await probe(input("password"), false)).toBe(true);
    expect(await probe(input("email", "", true), true)).toBe(true);
    expect(await probe(input("text", "section-login username"), true)).toBe(true);
    expect(await probe(input("text", "one-time-code"), true)).toBe(true);
    expect(await probe(input("email", "", true), false)).toBe(false);
    expect(await probe(input("text"), true)).toBe(false);
    expect(await probe({ ...input("password"), disabled: true }, true)).toBe(false);
    expect(await probe({ tagName: "TEXTAREA" }, true)).toBe(false);
  });
  it("waits until native input has updated focus, and follows open shadow roots and same-origin frames", async () => {
    const document = { activeElement: { tagName: "BODY" } as unknown };
    let run!: () => void;
    const result = runInNewContext(browserLoginIntentScript(false), { document, setTimeout: (callback: () => void) => { run = callback; } });
    document.activeElement = { tagName: "IFRAME", contentDocument: { activeElement: { shadowRoot: { activeElement: input("password") } } } };
    run(); expect(await result).toBe(true);
  });
  it("keeps Tab/navigation keys as focus-only and reduces actual typing/paste to a bit", () => {
    expect(browserLoginTypingInput({ type: "keyDown", key: "Tab" })).toBe(false);
    expect(browserLoginTypingInput({ type: "keyDown", key: "a" })).toBe(true);
    expect(browserLoginTypingInput({ type: "keyDown", key: "v", control: true })).toBe(true);
    expect(browserLoginTypingInput({ type: "keyDown", key: "a", meta: true })).toBe(false);
    expect(browserLoginTypingInput({ type: "keyUp", key: "a" })).toBe(false);
  });
});

describe("main-owned focused-frame inspection", () => {
  it("uses isolated main-frame execution first and only a current owned http(s) child as fallback", async () => {
    const page = guest();
    const frame = { top: page.mainFrame, detached: false, url: "https://login.example/frame?secret=never-returned", executeJavaScript: vi.fn(async () => true) };
    page.focusedFrame = frame;
    expect(await read(page)).toBe(true);
    expect(frame.executeJavaScript).toHaveBeenCalledWith(browserLoginIntentScript(false), false);
    page.executeJavaScriptInIsolatedWorld.mockResolvedValue(true);
    frame.executeJavaScript.mockClear();
    expect(await read(page)).toBe(true);
    expect(frame.executeJavaScript).not.toHaveBeenCalled();
  });
  it("bounds a blocked frame probe so later owner activity can retry", async () => {
    vi.useFakeTimers();
    try {
      const page = guest();
      page.executeJavaScriptInIsolatedWorld.mockReturnValue(new Promise(() => {}));
      const result = read(page);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it.each(["foreign", "detached", "file"])("ignores %s frame metadata", async kind => {
    const page = guest();
    const frame = { top: kind === "foreign" ? {} : page.mainFrame, detached: kind === "detached", url: kind === "file" ? "file:///private" : "https://login.example", executeJavaScript: vi.fn(async () => true) };
    page.focusedFrame = frame;
    expect(await read(page)).toBe(false);
    expect(frame.executeJavaScript).not.toHaveBeenCalled();
  });
  it("rejects stale frame focus, navigated frame URLs and nonboolean page results", async () => {
    const page = guest();
    const frame = { top: page.mainFrame, detached: false, url: "https://login.example", executeJavaScript: vi.fn(async () => { frame.url += "/new"; return true; }) };
    page.focusedFrame = frame;
    expect(await read(page)).toBe(false);
    frame.executeJavaScript.mockImplementation(async () => { page.focusedFrame = null; return true; });
    expect(await read(page)).toBe(false);
    page.executeJavaScriptInIsolatedWorld.mockResolvedValue({ intent: true, value: "forged" });
    expect(await read(page)).toBe(false);
  });
});

it("dismisses only canonical origins within one host and validates the fixed owner request", () => {
  const state = new BrowserLoginWarningDismissals(), origin = "https://login.example";
  state.dismiss("a", origin);
  expect(state.allows("a", origin)).toBe(false);
  expect(state.allows("b", origin)).toBe(true);
  expect(state.allows("a", "https://elsewhere.example")).toBe(true);
  expect(browserLoginOrigin("https://login.example/path?token=secret#fragment")).toBe(origin);
  expect(parseBrowserRequest({ op: "dismissLoginWarning", tabKey: "tab", origin })).toEqual({ op: "dismissLoginWarning", tabKey: "tab", origin });
  for (const bad of [origin + "/path", origin + "/", "file:///private", "https://user:secret@login.example"]) {
    expect(() => parseBrowserRequest({ op: "dismissLoginWarning", tabKey: "tab", origin: bad })).toThrow();
  }
  expect(() => parseBrowserRequest({ op: "dismissLoginWarning", tabKey: "tab", origin, value: "must-not-cross" })).toThrow();
});


it("broadcasts dismissals to every live consumer and stops notifying an unsubscribed window", () => {
  const state = new BrowserLoginWarningDismissals();
  const first = vi.fn(), second = vi.fn();
  const unsubscribe = state.subscribe(first);
  state.subscribe(second);
  state.dismiss("local", "https://login.example");
  expect(first).toHaveBeenCalledWith("local", "https://login.example");
  expect(second).toHaveBeenCalledWith("local", "https://login.example");
  unsubscribe();
  state.dismiss("other-host", "https://login.example");
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  state.dismiss("other-host", "https://login.example");
  expect(second).toHaveBeenCalledTimes(2);
});
