// @vitest-environment jsdom
import { act, createElement as h, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchablePickerBody, SearchableSelect, type SearchablePickerOption } from "../src/renderer/src/components/SearchablePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const options: SearchablePickerOption[] = [
  { value: "alice", label: "Alice", group: "项目甲", searchText: "Claude lead" },
  { value: "blocked", label: "Unavailable", group: "项目甲", disabled: true },
  { value: "lin", label: "林晓", group: "项目甲", searchText: "remote engineer" },
  { value: "zoe", label: "Élodie", group: "Remote Team", searchText: "Gemini" },
  { value: "bob", label: "Bob", group: "项目甲" },
];
let root: Root, host: HTMLDivElement;
const picked = vi.fn(), parentKey = vi.fn();
beforeEach(() => {
  picked.mockReset(); parentKey.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function mount(items = options) {
  act(() => root.render(h("div", { onKeyDown: parentKey }, h(SearchablePickerBody, {
    options: items, onPick: picked, placeholder: "搜索", emptyLabel: "没有结果", label: "选择成员",
  }))));
}
const input = () => document.querySelector<HTMLInputElement>("[data-menu-search]")!;
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
function type(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(value: string, target: Element = input(), extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...extra });
  act(() => { target.dispatchEvent(event); }); return event;
}

describe("SearchablePickerBody", () => {
  it("does not commit list rerenders when the pointer moves across options", () => {
    const committed = vi.fn();
    act(() => root.render(h(Profiler, { id: "picker", onRender: committed }, h(SearchablePickerBody, {
      options, onPick: picked, placeholder: "搜索", emptyLabel: "没有结果",
    }))));
    committed.mockClear();
    for (const row of rows()) {
      act(() => {
        row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      });
    }
    expect(committed).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
  });
  it("autofocuses search and filters CJK labels without replacing or defocusing the input", () => {
    mount(); const field = input();
    expect(document.activeElement).toBe(field);
    type("林"); expect(rows().map(row => row.textContent)).toEqual(["林晓"]);
    expect(input()).toBe(field); expect(document.activeElement).toBe(field);
    type("林晓"); expect(rows()).toHaveLength(1);
  });

  it.each([["aLiCe", ["Alice"]], ["éLODIE", ["Élodie"]], ["ＧＥＭＩＮＩ", ["Élodie"]],
    ["REMOTE", ["林晓", "Élodie"]], ["项目甲", ["Alice", "Unavailable", "林晓", "Bob"]]])("filters Unicode label, group and searchText: %s", (query, labels) => {
    mount(); type(query as string); expect(rows().map(row => row.textContent)).toEqual(labels);
  });

  it("keeps option order and repeated consecutive groups instead of regrouping by group name", () => {
    mount();
    expect(rows().map(row => row.textContent)).toEqual(["Alice", "Unavailable", "林晓", "Élodie", "Bob"]);
    const headings = [...host.querySelectorAll("div")].filter(el => el.classList.contains("text-subtle"));
    expect(headings.map(el => el.textContent)).toEqual(["项目甲", "Remote Team", "项目甲"]);
  });

  it("shows the empty label and makes Enter/arrows inert when no result matches", () => {
    mount(); type("missing"); expect(rows()).toEqual([]);
    expect(host.querySelector('[role="status"]')?.textContent).toBe("没有结果");
    key("ArrowDown"); key("ArrowUp"); key("Enter"); expect(picked).not.toHaveBeenCalled();
  });

  it("selects the first enabled item on Enter, wraps arrows, skips disabled and keeps search focus", () => {
    mount(); key("Enter"); expect(picked).toHaveBeenLastCalledWith("alice");
    picked.mockClear(); key("ArrowUp"); key("Enter"); expect(picked).toHaveBeenLastCalledWith("bob");
    key("ArrowDown"); key("Enter"); expect(picked).toHaveBeenLastCalledWith("alice");
    key("ArrowDown"); key("Enter"); expect(picked).toHaveBeenLastCalledWith("lin");
    expect(document.activeElement).toBe(input());
    expect(parentKey).not.toHaveBeenCalled();
  });

  it("uses filtered results rather than a stale active item and never picks disabled matches", () => {
    mount(); key("ArrowDown"); type("Élodie"); key("Enter"); expect(picked).toHaveBeenLastCalledWith("zoe");
    picked.mockClear(); type("Unavailable"); key("Enter"); key("ArrowDown");
    act(() => rows()[0]!.click()); expect(picked).not.toHaveBeenCalled();
  });

  it("supports arrows and Enter from a focused row, and routes printable typing back to search", () => {
    mount(); act(() => rows()[0]!.focus());
    key("ArrowDown", rows()[0]!); expect(document.activeElement?.textContent).toBe("林晓");
    key("Enter", document.activeElement!); expect(picked).toHaveBeenLastCalledWith("lin");
    key("林", document.activeElement!);
    expect(document.activeElement).toBe(input()); expect(input().value).toBe("林");
    expect(rows().map(row => row.textContent)).toEqual(["林晓"]);
  });

  it("does not navigate or select while composing, including keyCode 229 and composition events", () => {
    mount(); key("Enter", input(), { isComposing: true }); key("ArrowDown", input(), { keyCode: 229 });
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    act(() => input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    key("Enter"); key("ArrowDown"); expect(picked).not.toHaveBeenCalled();
    act(() => input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    key("Enter"); expect(picked).toHaveBeenCalledExactlyOnceWith("alice");
  });

  it("leaves Escape to the parent and stops other keys without preventing normal typing", () => {
    mount(); const letter = key("x"); expect(letter.defaultPrevented).toBe(false);
    key("ArrowLeft"); key("Tab"); expect(parentKey).not.toHaveBeenCalled();
    const escape = key("Escape"); expect(escape.defaultPrevented).toBe(false);
    expect(parentKey).toHaveBeenCalledOnce();
  });

  it("supports an initially empty list and a later live option update without losing the search draft", () => {
    mount([]); expect(host.querySelector('[role="status"]')).not.toBeNull();
    type("林"); mount(); expect(input().value).toBe("林"); expect(rows()[0]?.textContent).toBe("林晓");
    act(() => rows()[0]!.click()); expect(picked).toHaveBeenCalledExactlyOnceWith("lin");
  });
});

describe("SearchableSelect", () => {
  it("does not remeasure or dismiss on repeated internal list scrolling, but remeasures on resize", () => {
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    try {
      select(); act(() => host.querySelector("button")!.click());
      const field = input();
      const list = document.getElementById(field.getAttribute("aria-controls")!)!;
      expect(list).not.toBeNull();
      expect(measure).toHaveBeenCalled();
      measure.mockClear();
      act(() => {
        for (let index = 0; index < 20; index++) list.dispatchEvent(new Event("scroll"));
      });
      expect(measure).not.toHaveBeenCalled();
      expect(input()).toBe(field);
      expect(field.isConnected).toBe(true);
      act(() => window.dispatchEvent(new Event("resize")));
      expect(measure).toHaveBeenCalled();
      expect(input()).toBe(field);
      measure.mockClear();
      act(() => document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 })));
      expect(document.querySelector("[data-menu-search]")).toBeNull();
      expect(measure).not.toHaveBeenCalled();
    } finally { measure.mockRestore(); }
  });
  it("supports a small action trigger while keeping its accessible label and selecting by option value", () => {
    act(() => root.render(h(SearchableSelect, {
      value: "", options, onChange: picked, placeholder: "搜索成员", emptyLabel: "没有结果", label: "添加项目授权成员",
      triggerText: "直接添加", triggerClassName: "small-add-button", width: "w-72",
    })));
    const trigger = host.querySelector("button")!;
    expect(trigger.textContent).toBe("直接添加"); expect(trigger.className).toBe("small-add-button");
    expect(trigger.getAttribute("aria-label")).toBe("添加项目授权成员");
    act(() => trigger.click()); type("林"); key("Enter");
    expect(picked).toHaveBeenCalledExactlyOnceWith("lin");
    expect(document.querySelector("[data-menu-search]")).toBeNull();
  });
  it("uses an explicit empty-value trigger fallback independently of the search placeholder", () => {
    act(() => root.render(h(SearchableSelect, {
      value: "", options, onChange: picked, placeholder: "搜索成员", emptyLabel: "没有结果", label: "连接目标", triggerText: "选择目标",
    })));
    const trigger = host.querySelector("button")!;
    expect(trigger.textContent).toBe("选择目标"); expect(trigger.getAttribute("aria-label")).toBe("连接目标");
    expect(trigger.className).toContain("border-border");
    act(() => trigger.click()); expect(input().placeholder).toBe("搜索成员");
  });
  it("shows the selected option label ahead of the fallback trigger text", () => {
    act(() => root.render(h(SearchableSelect, {
      value: "alice", options, onChange: picked, placeholder: "搜索成员", emptyLabel: "没有结果", label: "连接目标", triggerText: "选择目标",
    })));
    expect(host.querySelector("button")!.textContent).toBe("Alice");
    expect(host.querySelector("button")!.dataset.tip).toBe("Alice");
  });
  function select(disabled = false) {
    act(() => root.render(h(SearchableSelect, { value: "alice", options, onChange: picked, placeholder: "搜索", emptyLabel: "没有结果", label: "选择成员", disabled })));
  }
  it("uses the existing Popover, shows the selected label, and closes on selection", () => {
    select(); const trigger = host.querySelector("button")!;
    expect(trigger.textContent).toBe("Alice"); expect(trigger.getAttribute("aria-label")).toBe("选择成员");
    act(() => trigger.click()); expect(document.activeElement).toBe(input());
    type("林"); key("Enter"); expect(picked).toHaveBeenCalledExactlyOnceWith("lin");
    expect(document.querySelector("[data-menu-search]")).toBeNull();
  });
  it("honors disabled and lets the Popover handle Escape", () => {
    select(true); act(() => host.querySelector("button")!.click()); expect(document.querySelector("[data-menu-search]")).toBeNull();
    select(); act(() => host.querySelector("button")!.click()); key("Escape");
    expect(document.querySelector("[data-menu-search]")).toBeNull(); expect(picked).not.toHaveBeenCalled();
  });
});
