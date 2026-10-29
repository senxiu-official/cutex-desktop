// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installContentSelection, stripSelectionChrome } from "../src/renderer/src/lib/contentSelection";
import { resetKeybindingsForTests, setKeybindingPlatform, setRecordingKeys, bindingConflicts } from "../src/renderer/src/lib/keybindings";

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; document.body.replaceChildren(); document.getSelection()?.removeAllRanges(); resetKeybindingsForTests(); setKeybindingPlatform(null); });
function setup() {
  document.body.innerHTML = '<nav>NAV CHROME</nav><div class="selectable" tabindex="0">MESSAGE BODY</div><div class="markdown">OTHER CONTENT</div><input value="draft"><textarea>draft two</textarea><div contenteditable="true"><span contenteditable="false">mention</span> rich draft</div>';
  cleanup = installContentSelection(document);
}
const key = (target: EventTarget = document.body, extra: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true, ...extra });
  target.dispatchEvent(event); return event;
};
const point = (selector: string) => document.querySelector(selector)!.dispatchEvent(new Event("pointerdown", { bubbles: true }));

describe("content-scoped select all", () => {
  it("prevents whole-window selection when no content block was chosen", () => { setup(); expect(key().defaultPrevented).toBe(true); expect(document.getSelection()?.toString()).toBe(""); });
  it("selects only the clicked content block, then clears that scope after a chrome click", () => {
    setup(); point(".selectable"); key(); expect(document.getSelection()?.toString()).toBe("MESSAGE BODY");
    point("nav"); key(); expect(document.getSelection()?.toString()).toBe("");
  });
  it("uses keyboard focus on a copyable value and ignores detached blocks", () => {
    setup(); const block = document.querySelector<HTMLElement>(".selectable")!; block.focus(); key(block); expect(document.getSelection()?.toString()).toBe("MESSAGE BODY");
    block.remove(); key(); expect(document.getSelection()?.toString()).toBe("");
  });
  it("does not activate surrounding prose from its chrome, but keeps explicitly copyable values in buttons", () => {
    setup(); document.querySelector(".markdown")!.innerHTML = 'BODY<button>COLLAPSE</button>';
    point(".markdown button"); key(); expect(document.getSelection()?.toString()).toBe("");
    document.querySelector(".markdown button")!.innerHTML = '<span data-copy-value>copy/path</span>';
    point("[data-copy-value]"); key(); expect(document.getSelection()?.toString()).toBe("copy/path");
  });
  it("preserves native select-all for inputs, textareas and a contenteditable mention", () => {
    setup(); for (const selector of ["input", "textarea", '[contenteditable="true"] span']) expect(key(document.querySelector(selector)!).defaultPrevented).toBe(false);
  });
  it("respects handled page shortcuts, IME and different modifier combinations", () => {
    setup(); expect(key(document.body, { isComposing: true }).defaultPrevented).toBe(false); expect(key(document.body, { altKey: true }).defaultPrevented).toBe(false);
    const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true }); event.preventDefault(); document.body.dispatchEvent(event);
    expect(document.getSelection()?.toString()).toBe("");
  });
  it("uses the registry's platform command key and physical-key matching", () => {
    setup(); point(".selectable"); setKeybindingPlatform("mac");
    expect(key().defaultPrevented).toBe(false);
    expect(key(document.body, { ctrlKey: false, metaKey: true, key: "ф", code: "KeyA" }).defaultPrevented).toBe(true);
    expect(document.getSelection()?.toString()).toBe("MESSAGE BODY");
    setKeybindingPlatform("other");
    expect(key(document.body, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(false);
    expect(key(document.body, { key: "ф", code: "KeyA" }).defaultPrevented).toBe(true);
  });
  it("respects shortcut recording and keeps native select-all protected from rebinding", () => {
    setup(); point(".selectable"); setRecordingKeys(true);
    expect(key().defaultPrevented).toBe(false);
    expect(bindingConflicts("sidebar", "Mod+KeyA")).toContainEqual({ kind: "composer" });
  });
  it("custom clipboard serialization strips chrome while preserving real source values", () => {
    const template = document.createElement("template"); template.innerHTML = '<p>BODY<button>COPY</button><span data-avatar>AVATAR</span><code>sha256-value</code></p><div data-streamdown="code-block-header">typescript</div><pre>command</pre>';
    stripSelectionChrome(template.content); expect(template.content.textContent).toBe("BODYsha256-valuecommand");
  });
});
