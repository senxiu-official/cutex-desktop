// @vitest-environment jsdom
// Composer undo (survey C1, 2026-11-25): with `onHistory`, the mention editor hands Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y and the
// edit menu's 撤销 / 重做 (beforeinput historyUndo / Redo) to the composer's whole-draft history instead of its own.
import { act, createElement as h, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMentionInput, type AgentMentionInputHandle } from "../src/renderer/src/components/AgentMentionInput";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ cachedProfileList: () => null, loadProfileList: async () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement, root: Root;
const ref = createRef<AgentMentionInputHandle>();
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

function mount(onHistory: (redo: boolean) => void, onChange = vi.fn()) {
  act(() => root.render(h(AgentMentionInput, { ref, value: "hello", onChange, onHistory, "aria-label": "Draft" })));
  return ref.current!.element!;
}
const key = (el: HTMLElement, init: KeyboardEventInit) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(event); });
  return event;
};

describe("mention editor undo goes to the composer", () => {
  it("Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo, through onHistory", () => {
    const history = vi.fn();
    const changed = vi.fn();
    const el = mount(history, changed);
    expect(key(el, { key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    key(el, { key: "Z", ctrlKey: true, shiftKey: true });
    key(el, { key: "y", ctrlKey: true });
    expect(history.mock.calls).toEqual([[false], [true], [true]]);
    expect(changed).not.toHaveBeenCalled();
  });

  it("the edit menu's 撤销 / 重做 (beforeinput) too", () => {
    const history = vi.fn();
    const el = mount(history);
    for (const inputType of ["historyUndo", "historyRedo"]) {
      const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType });
      act(() => { el.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    }
    expect(history.mock.calls).toEqual([[false], [true]]);
  });
});
