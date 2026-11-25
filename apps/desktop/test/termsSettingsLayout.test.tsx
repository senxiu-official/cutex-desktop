// @vitest-environment jsdom
// Settings → 术语 layout (owner 2026-11-24): one column of fields with one right edge. Every row's word field(s) sit
// on one line; Director / Operator stack their 「侧栏显示」 field under them in the same column (its label to its left,
// 「留空隐藏」 as placeholder + tooltip), with no separate reset. One 恢复默认 per row resets the whole term. Character
// counters float (focus / near the limit) and never take a line; no 「默认：…」 hint line.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/renderer/src/lib/agentLook", () => ({ useAgentLook: () => ({ color: "#3366cc", family: "openai", themes: null, isDirector: false, isOperator: false, project: null, pinned: false }), useMinorDot: () => false, useProjectStyleWorn: () => new Set() }));
vi.mock("../src/renderer/src/lib/directorAvatars", () => ({ useDirectorAvatarUrl: () => null }));
vi.mock("../src/renderer/src/lib/portraitPacks", () => ({ portraitFor: () => null, portraitRefOf: () => null, usePortraitImage: () => null, usePortraitPacks: () => ({ index: {} }) }));
vi.mock("../src/renderer/src/lib/avatarStylePreview", () => ({ useStyleAssignmentPreview: () => null }));
import { I18nProvider } from "../src/renderer/src/i18n";
import { TermsSection } from "../src/renderer/src/components/settings/TermsSettings";
import { resetTerm, setSidebarRoleLabel, setTerm, TERM_IDS } from "../src/renderer/src/lib/terms";
import { TextInput } from "../src/renderer/src/components/settings/Form";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, div: HTMLDivElement;
beforeEach(() => { div = document.createElement("div"); document.body.append(div); root = createRoot(div); });
afterEach(() => { act(() => root.unmount()); div.remove(); for (const l of ["zh-CN", "en"] as const) for (const id of TERM_IDS) resetTerm(l, id); });

async function mount(locale: "zh-CN" | "en") {
  localStorage.setItem("cutex-desktop.locale", locale);
  await act(async () => root.render(h(I18nProvider, null, h(TermsSection))));
}
const fields = (id: string) => div.querySelector<HTMLElement>(`[data-term-fields="${id}"]`)!;

describe("术语 layout", () => {
  for (const locale of ["zh-CN", "en"] as const) {
    it(`${locale}: one column, one field width, sidebar field stacked under Director / Operator`, async () => {
      await mount(locale);
      const perRow = locale === "en" ? 2 : 1;
      const widths = new Set<string>();
      for (const id of TERM_IDS) {
        const col = fields(id);
        expect(col.className).toContain("flex-col");
        expect(col.className).toContain("items-end"); // one right edge
        const first = col.firstElementChild!;
        expect(first.querySelectorAll("input")).toHaveLength(perRow);
        const sidebar = col.querySelector(`[data-term-sidebar="${id}"]`);
        if (id === "director" || id === "operator" || id === "assistant") {
          expect(sidebar).not.toBeNull();
          expect(sidebar!.previousElementSibling).toBe(first); // under the word field(s), same column
          expect(sidebar!.querySelectorAll("input")).toHaveLength(1);
          expect(sidebar!.querySelector("button")).toBeNull(); // no separate reset
          expect(sidebar!.querySelector("[title]")?.getAttribute("title")).toBe(locale === "en" ? "Leave empty to hide" : "留空隐藏");
        } else expect(sidebar).toBeNull();
        for (const input of col.querySelectorAll("input")) widths.add([...input.classList].find((c) => /^w-\d+$/.test(c))!);
      }
      expect(widths).toEqual(new Set([locale === "en" ? "w-32" : "w-36"]));
      // No counter line and no 「默认：…」 hint line under any row.
      expect(div.querySelectorAll("[data-floating-counter]")).toHaveLength(div.querySelectorAll("[data-term-fields] input").length);
      expect(div.textContent).not.toMatch(/默认：|Default: /);
    });
  }

  it("one 恢复默认 per row resets the whole term, sidebar label included", async () => {
    setTerm("zh-CN", "director", "one", "总管家");
    setSidebarRoleLabel("zh-CN", "director", "总管");
    await mount("zh-CN");
    const row = fields("director").closest("[data-setting-row]")!;
    expect(row.hasAttribute("data-modified")).toBe(true);
    const restore = [...row.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") === "恢复默认");
    expect(restore).toHaveLength(1);
    act(() => restore[0]!.click());
    expect(row.hasAttribute("data-modified")).toBe(false);
    expect(fields("director").querySelector<HTMLInputElement>("[data-term-sidebar] input")!.value).toBe("主管");
  });
});

describe("floating counter", () => {
  it("hidden until focus or near the limit; never its own line", async () => {
    localStorage.setItem("cutex-desktop.locale", "en");
    const view = (value: string) => act(async () => root.render(h(I18nProvider, null, h(TextInput, { value, onChange: () => {}, maxLength: 24, floatingCounter: true, label: "x" }))));
    await view("agent");
    const counter = () => div.querySelector<HTMLElement>("[data-floating-counter]")!;
    expect(counter().className).toContain("absolute");
    expect(counter().className).toContain("opacity-0");
    expect(counter().className).toContain("group-focus-within/count:opacity-100");
    expect(counter().parentElement!.className).not.toContain("flex-col");
    expect(div.querySelector("input")!.getAttribute("aria-describedby")).toBe(counter().id);
    await view("x".repeat(20)); // 4 left: shown
    expect(counter().dataset.floatingCounter).toBe("shown");
    expect(counter().className).not.toContain("opacity-0");
    await view("x".repeat(25)); // over: shown, in danger colour
    expect(counter().className).toContain("text-danger");
    // Without the option the counter keeps its line (other settings unchanged).
    await act(async () => root.render(h(I18nProvider, null, h(TextInput, { value: "a", onChange: () => {}, maxLength: 24, label: "x" }))));
    expect(div.querySelector("[data-floating-counter]")).toBeNull();
    expect(div.querySelector("input")!.parentElement!.className).toContain("flex-col");
  });
});
