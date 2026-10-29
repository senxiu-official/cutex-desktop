// @vitest-environment jsdom
import { act, createElement as h, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installImeGuards } from "../src/renderer/src/lib/ime";
import { AgentMentionInput, type AgentMentionInputHandle } from "../src/renderer/src/components/AgentMentionInput";
import { FontCombo } from "../src/renderer/src/components/settings/FontCombo";
import { Popover } from "../src/renderer/src/components/Menu";
import { OwnerReplyBox } from "../src/renderer/src/components/OwnerReplyBox";
import { Overlays } from "../src/renderer/src/components/Overlays";
import { closeDialog, promptDialog } from "../src/renderer/src/lib/contextMenu";
const fx = vi.hoisted(() => ({ reply: vi.fn(async () => ({ ok: true })) }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key, locale: "en" }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: (select: (state: unknown) => unknown) => select({ notify: vi.fn() }) }));
vi.mock("../src/renderer/src/lib/ownerNotifyStore", () => ({ ownerNotifyAct: fx.reply }));
vi.mock("../src/renderer/src/components/AgentMentionChip", () => ({ AgentMentionChip: () => null }));
vi.mock("../src/renderer/src/components/ForkProfileDialog", () => ({ ForkProfileDialog: () => null }));
vi.mock("../src/renderer/src/components/AgentInfoDialog", () => ({ AgentInfoDialog: () => null }));
vi.mock("../src/renderer/src/components/StopIdleDialog", () => ({ StopIdleDialog: () => null }));
vi.mock("../src/renderer/src/components/FolderBrowser", () => ({ FolderBrowser: () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let node: HTMLDivElement; let root: Root; let dispose: () => void;
beforeEach(() => { node = document.createElement("div"); document.body.append(node); root = createRoot(node); dispose = installImeGuards(document); fx.reply.mockClear(); });
afterEach(() => { act(() => { closeDialog(); root.unmount(); }); dispose(); node.remove(); document.getSelection()?.removeAllRanges(); });
const compose = (el: Element, type: "compositionstart" | "compositionend") => act(() => el.dispatchEvent(new CompositionEvent(type, { bubbles: true })));
const key = (el: Element, value: string, options: KeyboardEventInit & { keyCode?: number; which?: number } = {}) => { const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: value, ...options }); act(() => el.dispatchEvent(event)); return event; };
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => { const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });

it.each(["Enter", "Escape"])("prompt rename ignores composing %s (native, 229 and shared tracking), then handles the committed key", async (pressed) => {
  act(() => root.render(h(Overlays)));
  let result: Promise<string | null>;
  const settled = vi.fn();
  act(() => { result = promptDialog("Rename", "中文"); void result.then(settled); });
  const input = node.querySelector("input")!;
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { which: 229 }]) {
    expect(key(input, pressed, options).defaultPrevented).toBe(false);
    expect(node.querySelector('[role="dialog"]')).not.toBeNull(); expect(settled).not.toHaveBeenCalled();
  }
  compose(input, "compositionstart"); key(input, pressed);
  expect(node.querySelector('[role="dialog"]')).not.toBeNull();
  compose(input, "compositionend");
  await act(async () => { key(input, pressed); await Promise.resolve(); });
  expect(settled).toHaveBeenCalledWith(pressed === "Enter" ? "中文" : null);
});

it("multiline rename waits for a committed Ctrl+Enter", async () => {
  act(() => root.render(h(Overlays))); const settled = vi.fn();
  act(() => { void promptDialog("Note", "正文", { multiline: true }).then(settled); });
  const input = node.querySelector("textarea")!;
  key(input, "Enter", { ctrlKey: true, keyCode: 229 }); expect(settled).not.toHaveBeenCalled();
  await act(async () => { key(input, "Enter", { ctrlKey: true }); await Promise.resolve(); });
  expect(settled).toHaveBeenCalledWith("正文");
});

it("font search retains its composing draft and does not pick or cancel until committed", () => {
  const change = vi.fn(); act(() => root.render(h(FontCombo, { value: "", fonts: ["宋体"], defaultLabel: "Default", onChange: change })));
  const input = node.querySelector("input")!; act(() => input.focus()); type(input, "黑体"); compose(input, "compositionstart");
  key(input, "Enter"); key(input, "Escape", { keyCode: 229 });
  expect(change).not.toHaveBeenCalled(); expect(input.value).toBe("黑体"); expect(node.querySelector('[role="listbox"]')).not.toBeNull();
  compose(input, "compositionend"); key(input, "Enter"); expect(change).toHaveBeenCalledWith("黑体");
});

it("mention editor shields its parent send/select callback before local and native composition checks", () => {
  const ref = createRef<AgentMentionInputHandle>(); const parent = vi.fn((event) => event.preventDefault()); const changed = vi.fn();
  act(() => root.render(h(AgentMentionInput, { ref, value: "你好", onChange: changed, onKeyDown: parent })));
  const editor = ref.current!.element!;
  key(editor, "Enter", { isComposing: true }); key(editor, "Escape", { keyCode: 229 });
  compose(editor, "compositionstart"); key(editor, "Enter"); key(editor, "Escape");
  expect(parent).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  compose(editor, "compositionend"); key(editor, "Enter"); expect(parent).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled();
});

it("reply Ctrl+Enter and Escape do not send or close while composing", async () => {
  const close = vi.fn(); act(() => root.render(h(OwnerReplyBox, { record: { agentId: "agent", notificationId: "notice" }, onClose: close })));
  const input = node.querySelector("textarea")!; type(input, "回复"); compose(input, "compositionstart");
  key(input, "Enter", { ctrlKey: true }); key(input, "Escape"); expect(fx.reply).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  compose(input, "compositionend");
  await act(async () => { key(input, "Enter", { ctrlKey: true }); await Promise.resolve(); });
  expect(fx.reply).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledWith(true);
});

it("popover native Escape and digit shortcuts leave an input's composition alone", () => {
  const shortcut = vi.fn(() => true);
  act(() => root.render(h(Popover, { trigger: "Open", onKey: shortcut, children: () => h("input", { "aria-label": "Rule" }) })));
  act(() => node.querySelector("button")!.click()); const input = document.querySelector<HTMLInputElement>('input[aria-label="Rule"]')!; act(() => input.focus());
  compose(input, "compositionstart"); key(input, "Escape"); key(input, "1");
  expect(shortcut).not.toHaveBeenCalled(); expect(document.querySelector("[data-popover]")).not.toBeNull();
  compose(input, "compositionend"); key(input, "Escape"); expect(document.querySelector("[data-popover]")).toBeNull();
});
