// @vitest-environment jsdom
// Composer undo (review of aeeb8af79): the edit menu's 撤销 / 重做 on a plain textarea (main composer, side composer)
// arrive as beforeinput historyUndo / historyRedo and travel the draft history instead of the textarea's own.
import { act, createElement as h, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHistoryBeforeInput } from "../src/renderer/src/lib/draftUndo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

function Input({ travel, enabled }: { travel: (redo: boolean) => void; enabled: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useHistoryBeforeInput(ref, travel, enabled);
  return h("textarea", { ref });
}
const fire = (inputType: string, isComposing = false) => {
  const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType, isComposing });
  act(() => { container.querySelector("textarea")!.dispatchEvent(event); });
  return event;
};

it("historyUndo / historyRedo go to the draft history; typing and compositions are left alone; off when disabled", () => {
  const travel = vi.fn();
  act(() => root.render(h(Input, { travel, enabled: true })));
  expect(fire("historyUndo").defaultPrevented).toBe(true);
  expect(fire("historyRedo").defaultPrevented).toBe(true);
  expect(fire("insertText").defaultPrevented).toBe(false);
  expect(fire("historyUndo", true).defaultPrevented).toBe(false);
  expect(travel.mock.calls).toEqual([[false], [true]]);
  act(() => root.render(h(Input, { travel, enabled: false })));
  expect(fire("historyUndo").defaultPrevented).toBe(false);
  expect(travel).toHaveBeenCalledTimes(2);
});
