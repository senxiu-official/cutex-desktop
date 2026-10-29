// @vitest-environment jsdom
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installImeGuards, isImeComposing } from "../src/renderer/src/lib/ime";
import { graphemeCount } from "../src/renderer/src/lib/graphemes";
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars: Record<string, unknown> = {}) => `${key}:${JSON.stringify(vars)}` }) }));
import { TextField, TextInput } from "../src/renderer/src/components/settings/Form";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, cleanup: () => void;
beforeEach(() => { cleanup = installImeGuards(document); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); cleanup(); });
const input = () => host.querySelector("input")!;
function set(value: string) { act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); }); }
function composition(type: "compositionstart" | "compositionend") { act(() => input().dispatchEvent(new CompositionEvent(type, { bubbles: true }))); }
it("suspends a native maximum while composing and restores it without cutting the candidate", async () => {
  act(() => root.render(h("input", { maxLength: 2 })));
  composition("compositionstart"); expect(input().hasAttribute("maxlength")).toBe(false);
  input().value = "zhuguan"; expect(isImeComposing({ target: input() })).toBe(true);
  input().value = "主管"; composition("compositionend");
  await new Promise((resolve) => setTimeout(resolve, 1));
  expect(input().maxLength).toBe(2); expect(input().value).toBe("主管");
});
it("blocks a composing form submit, including a final keyCode 229 implicit submit", () => {
  const submit = vi.fn((event: Event) => event.preventDefault());
  act(() => root.render(h("form", null, h("input"))));
  host.querySelector("form")!.addEventListener("submit", submit);
  composition("compositionstart");
  host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(submit).not.toHaveBeenCalled();
  composition("compositionend");
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }));
  host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(submit).not.toHaveBeenCalled();
});
it("keeps composition local until the candidate is committed, before a parent's normalizer", () => {
  const changes = vi.fn();
  function Field() { const [value, change] = useState(""); return h(TextInput, { value, onChange: (next: string) => { changes(next); change(next.replace(/[^\d]/g, "")); } }); }
  act(() => root.render(h(Field)));
  composition("compositionstart"); set("pinyin"); expect(input().value).toBe("pinyin"); expect(changes).not.toHaveBeenCalled();
  set("12"); composition("compositionend"); expect(changes).toHaveBeenCalledWith("12"); expect(input().value).toBe("12");
});
it("counts graphemes and leaves an over-limit setting draft editable without committing it", () => {
  const commit = vi.fn();
  act(() => root.render(h(TextField, { value: "", maxLength: 2, onCommit: commit })));
  expect(input().hasAttribute("maxlength")).toBe(false);
  composition("compositionstart"); set("zhuguan");
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(commit).not.toHaveBeenCalled();
  set("主管長"); composition("compositionend");
  act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(commit).not.toHaveBeenCalled(); expect(input().value).toBe("主管長"); expect(input().getAttribute("aria-invalid")).toBe("true");
  set("主管"); act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(commit).toHaveBeenCalledWith("主管");
  expect(graphemeCount("e\u0301👩🏽‍💻🇹🇼")).toBe(3);
});
