// @vitest-environment jsdom
// The composer's placeholder (owner 2026-11-12: 「偶尔输入框文本会变成白色的，输入拼音时光标在占位文本右边，直到文字落地占位
// 文本才会消失」). After one @mention the composer keeps the mention editor (contenteditable) for that agent; its placeholder
// used `before:text-muted-foreground`, a colour not in @theme, so Tailwind made no rule and the placeholder took the text
// colour; and `data-empty` changed only when text was committed, so a pinyin composition sat to the right of it.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { act, createElement as h, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { compile } from "tailwindcss";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMentionInput, type AgentMentionInputHandle } from "../src/renderer/src/components/AgentMentionInput";
import { composerPlaceholder, TEXTAREA_PLACEHOLDER_CLASS, type ComposerPlaceholderState } from "../src/renderer/src/lib/composerPlaceholder";

vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ cachedProfileList: () => null, loadProfileList: async () => null }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STYLES = resolve(__dirname, "../src/renderer/src/styles.css");
const require = createRequire(resolve(__dirname, "../package.json"));
async function tailwind() {
  return compile(readFileSync(STYLES, "utf8"), {
    base: dirname(STYLES),
    loadStylesheet: async (id: string, base: string) => {
      const path = require.resolve(id === "tailwindcss" ? "tailwindcss/index.css" : id);
      return { path, base, content: readFileSync(path, "utf8") };
    },
  });
}
/** Every class must make CSS: an unknown utility (a colour missing from @theme) silently does nothing. */
async function cssOf(classes: string[]) {
  const { build } = await tailwind();
  let css = build([]);
  for (const name of new Set(classes)) {
    const next = build([name]);
    expect(next.length, `"${name}" generates no CSS`).toBeGreaterThan(css.length);
    css = next;
  }
  return css;
}

const t = ((key: string, vars?: { name: string }) => vars ? `${key}(${vars.name})` : key) as Parameters<typeof composerPlaceholder>[0];
const base: ComposerPlaceholderState = { delegation: false, awaiting: false, busy: false, noSteer: false, name: "Ada" };
const STATES: [string, Partial<ComposerPlaceholderState>, string][] = [
  ["idle", {}, "composer.placeholder(Ada)"],
  ["turn running (typing queues)", { busy: true }, "composer.placeholderBusy"],
  ["turn running, no-steer runtime", { busy: true, noSteer: true }, "composer.placeholderBusyNoSteer"],
  ["delegation turn (own overlay line)", { busy: true, delegation: true }, ""],
  ["awaiting a delegation (own line)", { awaiting: true }, ""],
];
// Composer's own classes on the mention editor (components/Composer.tsx).
const COMPOSER_EDITOR = "max-h-[min(15rem,var(--composer-input-max,15rem))] min-h-[calc(2lh+0.5rem)] min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words bg-transparent py-1 pr-2.5 outline-none";

let container: HTMLDivElement, root: Root;
const ref = createRef<AgentMentionInputHandle>();
const changed = vi.fn();
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); changed.mockReset(); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.getSelection()?.removeAllRanges(); });
function render(value: string, placeholder: string) {
  act(() => root.render(h(AgentMentionInput, { ref, value, placeholder, onChange: changed, className: COMPOSER_EDITOR, "aria-label": "Draft" })));
  return ref.current!.element!;
}
const composition = (element: HTMLElement, type: "compositionstart" | "compositionupdate" | "compositionend", data = "") =>
  act(() => element.dispatchEvent(new CompositionEvent(type, { bubbles: true, data })));
/** What the browser does to the DOM during a composition (the editor must not reconcile it). */
function browserComposes(element: HTMLElement, text: string) {
  act(() => {
    const tail = element.lastChild as Text;
    tail.data = text;
    const range = document.createRange(); range.setStart(tail, tail.length); range.collapse(true);
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: text, isComposing: true }));
  });
}

describe("composer placeholder text", () => {
  it.each(STATES)("%s", (_, state, text) => expect(composerPlaceholder(t, { ...base, ...state })).toBe(text));
});

describe("composer placeholder colour (both inputs, every state)", () => {
  let editorCss = "", textareaCss = "";
  beforeAll(async () => {
    textareaCss = await cssOf(TEXTAREA_PLACEHOLDER_CLASS.split(" "));
  }, 30_000);

  it.each(STATES.filter(([, , text]) => text))("%s: the mention editor's placeholder is --color-subtle and out of flow", async (_, state) => {
    const placeholder = composerPlaceholder(t, { ...base, ...state });
    const element = render("", placeholder);
    expect(element.dataset.empty).toBe("true");
    expect(element.getAttribute("data-placeholder")).toBe(placeholder);
    editorCss ||= await cssOf(element.className.split(/\s+/).filter(Boolean));
    const rule = editorCss.match(/\[data-empty="true"\]::before\s*\{[^}]*color:[^}]*\}/)?.[0];
    expect(rule, "a ::before colour rule exists").toBeTruthy();
    expect(rule).toContain("color: var(--color-subtle)");
    expect(editorCss).toMatch(/\[data-empty="true"\]::before\s*\{[^}]*position: absolute/);
    expect(element.className).not.toMatch(/muted-foreground/);
  }, 30_000);

  it("the textarea's placeholder is the same --color-subtle", () => {
    expect(textareaCss).toMatch(/::placeholder\s*\{\s*color: var\(--color-subtle\)/);
  });

  it("--color-subtle is a theme colour of its own, not the text colour", () => {
    const theme = readFileSync(STYLES, "utf8").match(/@theme \{[\s\S]*?\n\}/)![0];
    expect(theme).toContain("--color-subtle: var(--fg-subtle)");
  });

  it("a state switch (idle → turn running) changes only the text, never the colour classes", () => {
    const idle = render("", composerPlaceholder(t, base)).className;
    const running = render("", composerPlaceholder(t, { ...base, busy: true }));
    expect(running.className).toBe(idle);
    expect(running.getAttribute("data-placeholder")).toBe("composer.placeholderBusy");
    expect(running.dataset.empty).toBe("true");
  });
});

describe("IME composition hides the placeholder", () => {
  it("compositionstart hides it before any text is committed; compositionupdate keeps it hidden; compositionend commits once", () => {
    const element = render("", "composer.placeholderBusy");
    act(() => ref.current!.focus());
    expect(element.dataset.empty).toBe("true");
    composition(element, "compositionstart");
    expect(element.dataset.empty, "hidden as soon as composition starts").toBe("false");
    composition(element, "compositionupdate", "n");
    browserComposes(element, "n");
    composition(element, "compositionupdate", "ni");
    browserComposes(element, "ni");
    expect(element.dataset.empty).toBe("false");
    expect(changed, "nothing committed mid-composition").not.toHaveBeenCalled();
    browserComposes(element, "你");
    composition(element, "compositionend", "你");
    expect(changed).toHaveBeenCalledExactlyOnceWith("你", 1);
    expect(element.dataset.empty).toBe("false");
  });

  it("a cancelled composition (nothing committed) brings the placeholder back", () => {
    const element = render("", "composer.placeholder(Ada)");
    act(() => ref.current!.focus());
    composition(element, "compositionstart");
    composition(element, "compositionupdate", "n");
    browserComposes(element, "n");
    expect(element.dataset.empty).toBe("false");
    browserComposes(element, "");
    composition(element, "compositionend", "");
    expect(changed).not.toHaveBeenCalled();
    expect(element.dataset.empty).toBe("true");
  });

  it("a parent re-render mid-composition (a turn starts: new placeholder text) does not bring it back", () => {
    const element = render("", "composer.placeholder(Ada)");
    act(() => ref.current!.focus());
    composition(element, "compositionstart");
    browserComposes(element, "ni");
    render("", "composer.placeholderBusy");
    expect(element.dataset.empty).toBe("false");
    composition(element, "compositionend", "ni");
    expect(changed).toHaveBeenCalledExactlyOnceWith("ni", 2);
  });

  it("clearing the draft after a send shows the placeholder again", () => {
    const element = render("hello", "composer.placeholder(Ada)");
    expect(element.dataset.empty).toBe("false");
    render("", "composer.placeholder(Ada)");
    expect(element.dataset.empty).toBe("true");
  });
});
