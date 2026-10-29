// @vitest-environment jsdom
import { act, createElement as h, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMentionInput, type AgentMentionInputHandle, type AgentMentionInputProps } from "../src/renderer/src/components/AgentMentionInput";
import { agentMentionMarkdown } from "../src/renderer/src/lib/agentMentions";
import { agentMentionEditorValue, atomicMentionSelection } from "../src/renderer/src/lib/agentMentionEditor";

vi.mock("../src/renderer/src/components/AgentMentionChip", () => ({
  AgentMentionChip: ({ name }: { name: string }) => h("span", null, "@" + name),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = "cutex.01234567-89ab-cdef-0123-456789abcdef";
const token = agentMentionMarkdown("A [review]", id);
let container: HTMLDivElement, root: Root;
const ref = createRef<AgentMentionInputHandle>();
let changed = vi.fn<AgentMentionInputProps["onChange"]>();
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container); changed = vi.fn();
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.getSelection()?.removeAllRanges(); });
function render(value: string, extra: Partial<AgentMentionInputProps> = {}) {
  act(() => root.render(h(AgentMentionInput, { ref, value, onChange: changed, "aria-label": "Draft", ...extra })));
  return ref.current!.element!;
}
function select(start: number, end = start) {
  act(() => { ref.current!.focus(); ref.current!.setSelectionRange(start, end); });
}
function key(element: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options })));
}
function clipboard(element: HTMLElement, type: string, plain = "", html = "") {
  const data = { getData: vi.fn((kind: string) => kind === "text/plain" ? plain : html), setData: vi.fn() };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  act(() => element.dispatchEvent(event));
  return { data, event };
}

describe("agent mention composer editor", () => {
  it("renders atomic chips while its handle and caret use escaped Markdown offsets", () => {
    const text = "Hi " + token + " done";
    const element = render(text);
    const chip = element.querySelector("[data-agent-mention-raw]")!;
    expect(chip.getAttribute("contenteditable")).toBe("false");
    expect(chip.textContent).toBe("@A [review]");
    expect(ref.current!.value).toBe(text);
    select(3 + token.length);
    expect(ref.current!.selectionStart).toBe(3 + token.length);
    select(5);
    expect(ref.current!.selectionStart).toBe(3 + token.length);
    expect(changed).not.toHaveBeenCalled();
  });

  it("copy/cut keeps canonical links and undo/redo restores the original token", () => {
    const element = render("a" + token + "b");
    select(1, 1 + token.length);
    expect(clipboard(element, "copy").data.setData).toHaveBeenCalledWith("text/plain", token);
    expect(clipboard(element, "cut").data.setData).toHaveBeenCalledWith("text/plain", token);
    expect(ref.current!.value).toBe("ab");
    expect(ref.current!.selectionStart).toBe(1);
    key(element, "z", { ctrlKey: true });
    expect(ref.current!.value).toBe("a" + token + "b");
    expect(ref.current!.selectionEnd).toBe(1 + token.length);
    key(element, "z", { ctrlKey: true, shiftKey: true });
    expect(ref.current!.value).toBe("ab");
  });

  it("backspace/delete remove one complete token and arrows cross it atomically", () => {
    const element = render("a" + token + "b");
    select(1);
    key(element, "ArrowRight");
    expect(ref.current!.selectionStart).toBe(1 + token.length);
    key(element, "Backspace");
    expect(ref.current!.value).toBe("ab");
    key(element, "z", { ctrlKey: true });
    select(1 + token.length);
    key(element, "ArrowLeft");
    expect(ref.current!.selectionStart).toBe(1);
    key(element, "Delete");
    expect(ref.current!.value).toBe("ab");
  });

  it("pastes plain Markdown, preserves links, normalizes newlines, never inserts HTML", () => {
    const element = render(token);
    select(token.length);
    clipboard(element, "paste", "\r\n" + token, '<img src=x onerror="bad()">');
    expect(ref.current!.value).toBe(token + "\n" + token);
    expect(element.querySelectorAll("[data-agent-mention-raw]")).toHaveLength(2);
    expect(element.querySelector("img")).toBeNull();
  });

  it("runs the parent paste handler first and respects image interception", () => {
    const parent = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    const element = render(token, { onPaste: parent });
    select(token.length);
    const { event } = clipboard(element, "paste", "ignored", "<b>ignored</b>");
    expect(parent).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    expect(ref.current!.value).toBe(token);
  });

  it("supports newlines including trailing blank lines, with parent send keys taking precedence", () => {
    const element = render(token);
    select(token.length);
    key(element, "Enter", { shiftKey: true });
    key(element, "Enter", { shiftKey: true });
    expect(ref.current!.value).toBe(token + "\n\n");
    expect(ref.current!.selectionStart).toBe(token.length + 2);
    render(ref.current!.value, { onKeyDown: event => event.preventDefault() });
    key(element, "Enter");
    expect(ref.current!.value).toBe(token + "\n\n");
  });

  it("does not reconcile IME text mid-composition and commits once at composition end", () => {
    const element = render(token + " ");
    select(token.length + 1);
    act(() => element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    const tail = element.lastChild as Text;
    act(() => {
      tail.data += "中文";
      const range = document.createRange(); range.setStart(tail, tail.length); range.collapse(true);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", isComposing: true }));
    });
    expect(changed).not.toHaveBeenCalled();
    act(() => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中文" })));
    expect(changed).toHaveBeenCalledExactlyOnceWith(token + " 中文", token.length + 3);
    expect(element.querySelectorAll("[data-agent-mention-raw]")).toHaveLength(1);
    key(element, "z", { ctrlKey: true });
    expect(ref.current!.value).toBe(token + " ");
  });

  it("serializes browser line blocks and expands selected fragments to full token boundaries", () => {
    const element = render(token);
    const sample = document.createElement("div");
    sample.innerHTML = "a<div>b</div><div><br></div>";
    expect(agentMentionEditorValue(sample)).toBe("a\nb\n");
    expect(atomicMentionSelection("a" + token + "b", 3, 5)).toEqual({ start: 1, end: 1 + token.length });
    select(0, token.length);
    clipboard(element, "paste", "plain");
    expect(ref.current!.value).toBe("plain");
    render("x" + token);
    expect(ref.current!.value).toBe("x" + token);
  });

  it("tracks ordinary browser edits and native history beforeinput without losing chips", () => {
    const element = render(token + " text");
    select(token.length + 5);
    act(() => {
      element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: "!" }));
      const tail = element.lastChild as Text;
      tail.data += "!";
      const range = document.createRange(); range.setStart(tail, tail.length); range.collapse(true);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "!" }));
    });
    expect(changed).toHaveBeenLastCalledWith(token + " text!", token.length + 6);
    const undo = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "historyUndo" });
    act(() => element.dispatchEvent(undo));
    expect(undo.defaultPrevented).toBe(true);
    expect(ref.current!.value).toBe(token + " text");
    expect(element.querySelectorAll("[data-agent-mention-raw]")).toHaveLength(1);
  });

  it("reports serialized selection and retains a programmatic range while blurred", () => {
    const selected = vi.fn();
    const element = render("a" + token + "b", { onSelect: selected });
    select(0);
    act(() => {
      const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
      document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(selected).toHaveBeenLastCalledWith(token.length + 2);
    act(() => { element.blur(); ref.current!.setSelectionRange(1, 1 + token.length); });
    expect(ref.current!.selectionStart).toBe(1);
    expect(ref.current!.selectionEnd).toBe(1 + token.length);
    act(() => ref.current!.focus());
    expect(ref.current!.selectionStart).toBe(1);
    expect(ref.current!.selectionEnd).toBe(1 + token.length);
  });

  it("honors atomic deletion for native beforeinput and selected fragments", () => {
    const element = render("a" + token + "b");
    select(1 + token.length);
    const deletion = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "deleteContentBackward" });
    act(() => element.dispatchEvent(deletion));
    expect(deletion.defaultPrevented).toBe(true);
    expect(ref.current!.value).toBe("ab");
    key(element, "z", { ctrlKey: true });
    select(2, 4);
    key(element, "Backspace");
    expect(ref.current!.value).toBe("ab");
  });
});
