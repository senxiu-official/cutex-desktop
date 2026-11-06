// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
const mocks = vi.hoisted(() => ({ save: vi.fn(), close: vi.fn(), notify: vi.fn(), current: true }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string, v?: { reason?: string }) => (v?.reason ? `${k}: ${v.reason}` : k) }) }));
vi.mock("../src/renderer/src/lib/shelves", () => ({ showShelfToast: mocks.notify }));
vi.mock("../src/renderer/src/lib/menus", () => ({ updateAgentBadge: mocks.save }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ closeMenu: mocks.close }));
vi.mock("../src/renderer/src/lib/hostSwitch", () => ({ captureHostAction: () => () => mocks.current }));
vi.mock("../src/renderer/src/lib/sidebar", () => ({ projectColor: (c: string) => c }));
import { AgentBadgeEditor } from "../src/renderer/src/components/AgentBadgeEditor";
import { badgeDraft, validBadgeText } from "../src/renderer/src/lib/sessionBadge";
import { installImeGuards } from "../src/renderer/src/lib/ime";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const session = { cutexSessionId: "a", revision: 12, badge: { text: "挂件", tint: "pink" } } as SessionResource;
beforeEach(() => { mocks.save.mockReset().mockResolvedValue(undefined); mocks.close.mockReset(); mocks.notify.mockReset(); mocks.current = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); act(() => root.render(h(AgentBadgeEditor, { session, hostId: "remote" }))); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const input = () => host.querySelector("input")!;
function text(value: string) { act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); }); }
const button = (key: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
async function submit() { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }
describe("tray badge editor", () => {
  it("preserves pinyin until candidate selection, then saves the completed Chinese badge", async () => {
    const cleanup = installImeGuards(document);
    try {
      act(() => input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
      text("zhuguan");
      expect(input().value).toBe("zhuguan");
      expect(host.querySelector('[role="alert"]')).toBeNull();
      act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true })));
      await submit(); expect(mocks.save).not.toHaveBeenCalled();
      text("主管");
      act(() => input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "主管" })));
      expect(input().value).toBe("主管");
      expect(button("settings.save").disabled).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 1));
      await submit(); expect(mocks.save).toHaveBeenCalledWith(session, "remote", { text: "主管", tint: "pink" });
    } finally { cleanup(); }
  });
  it("ignores the Safari keyCode 229 Escape even without isComposing", () => {
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true })));
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it("uses the four-column rule and preserves absent tint on an unchanged badge", () => {
    expect(validBadgeText("挂件")).toBe(true); expect(validBadgeText("ABCD")).toBe(true);
    expect(validBadgeText("ABCDE")).toBe(false); expect(validBadgeText(" ")).toBe(false); expect(validBadgeText("a\nb")).toBe(false);
    expect(validBadgeText("")).toBe(true); expect(badgeDraft("A", "blue", { text: "A" })).toEqual({ text: "A" });
  });
  it("keeps over-limit text visible and saves only a corrected draft", async () => {
    text("ABCDE"); expect(input().value).toBe("ABCDE");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await submit(); expect(mocks.save).not.toHaveBeenCalled();
    text("ABCD");
    await submit(); expect(mocks.save).toHaveBeenCalledWith(session, "remote", { text: "ABCD", tint: "pink" }); expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("saves the tint picked from the swatches", async () => {
    act(() => host.querySelector<HTMLButtonElement>('[role="radio"][data-tint="violet"]')!.click());
    await submit(); expect(mocks.save).toHaveBeenCalledWith(session, "remote", { text: "挂件", tint: "violet" });
  });
  it("clear writes null immediately through the same versioned writer", async () => {
    await act(async () => button("info.badgeClear").click()); expect(mocks.save).toHaveBeenCalledWith(session, "remote", null); expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("closes at once (the badge is drawn before cutex answers) and says a failure in a toast, without retrying", async () => {
    let fail!: (e: Error) => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>((_, no) => { fail = no; })); text("HELP"); await submit();
    expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.notify).not.toHaveBeenCalled();
    await act(async () => fail(new Error("已刷新，请重新编辑")));
    expect(mocks.notify).toHaveBeenCalledWith("info.badgeFailed: 已刷新，请重新编辑"); expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("does not save invalid labels or drafts from expired host connections", async () => {
    text("A B"); expect(button("settings.save").disabled).toBe(true); await submit(); expect(mocks.save).not.toHaveBeenCalled();
    text("HELP"); mocks.current = false; await submit(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("does not close a newer menu when an already-started save finishes after dismissal", async () => {
    let resolve!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>((yes) => { resolve = yes; }));
    await submit();
    expect(mocks.close).toHaveBeenCalledOnce();
    act(() => root.render(null));
    await act(async () => resolve());
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("keeps keyboard navigation inside editor and lets Escape dismiss it", () => {
    const onKey = vi.fn(); document.addEventListener("keydown", onKey);
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(onKey).not.toHaveBeenCalled();
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(mocks.close).toHaveBeenCalledOnce(); document.removeEventListener("keydown", onKey);
  });
});
