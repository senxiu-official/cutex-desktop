// @vitest-environment jsdom
// Explanation lines under menu items became an ⓘ + tooltip (lib/contextMenu MenuAction.info, components/Overlays,
// design 040 §2): the icon sits at the row's right, the tooltip shows while the row is active (hover or arrows), the
// text is the button's description for screen readers, and no extra row is drawn.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeMenu, openMenuAt } from "../src/renderer/src/lib/contextMenu";
import { Overlays } from "../src/renderer/src/components/Overlays";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(h(Overlays)));
});
afterEach(() => {
  act(() => closeMenu());
  act(() => root.unmount());
  host.remove();
});

const open = () =>
  act(() =>
    openMenuAt(10, 10, [
      { label: "允许混排", info: "一个窗格只放一种东西", onSelect: () => {} },
      { label: "复制", onSelect: () => {} },
      { label: "关闭", info: "2 个窗格会一起关闭，可撤销", danger: true, onSelect: () => {} },
    ]),
  );
const rows = () => [...document.querySelectorAll<HTMLElement>("[role=menuitem]")];

it("keeps the selected action when an asynchronously allowed file action is inserted", async () => {
  let finish!: (allowed: boolean) => void;
  const available = new Promise<boolean>((resolve) => { finish = resolve; });
  const selected = vi.fn(), inserted = vi.fn();
  act(() => openMenuAt(10, 10, [
    { label: "first", onSelect() {} },
    { label: "inserted", available: () => available, onSelect: inserted },
    { label: "selected", onSelect: selected },
  ]));
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => finish(true));
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(selected).toHaveBeenCalledOnce(); expect(inserted).not.toHaveBeenCalled();
});

it("a row with `info` gets an ⓘ and no extra row; the description is wired with aria-describedby", () => {
  open();
  expect(rows()).toHaveLength(3);
  expect(document.querySelectorAll("[data-menu-info]")).toHaveLength(2);
  expect(rows()[1]!.querySelector("[data-menu-info]")).toBeNull();
  const id = rows()[0]!.getAttribute("aria-describedby")!;
  expect(document.getElementById(id)!.textContent).toBe("一个窗格只放一种东西");
  expect(rows()[1]!.getAttribute("aria-describedby")).toBeNull();
  expect(rows()[0]!.parentElement!.getAttribute("title")).toBeNull();
});

it("the tooltip shows for the hovered row only, and moves with the arrows", () => {
  open();
  expect(document.querySelector("[data-menu-info-tip]")).toBeNull();
  act(() => rows()[0]!.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(document.querySelector("[data-menu-info-tip]")!.textContent).toBe("一个窗格只放一种东西");
  act(() => rows()[1]!.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(document.querySelector("[data-menu-info-tip]")).toBeNull();
  act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  expect(document.querySelector("[data-menu-info-tip]")!.textContent).toBe("2 个窗格会一起关闭，可撤销");
});

it("a disabled row's reason is its ⓘ: shown on hover like any other, read as its description (owner 2026-11-05)", () => {
  act(() => openMenuAt(10, 10, [
    { label: "分叉为新智能体", disabled: true, title: "运行时不支持分叉", onSelect: () => {} },
    { label: "复制", title: "复制名字", onSelect: () => {} },
  ]));
  const [fork, copy] = rows();
  expect(fork!.querySelector("[data-menu-info]")).not.toBeNull();
  expect(document.getElementById(fork!.getAttribute("aria-describedby")!)!.textContent).toBe("运行时不支持分叉");
  expect(fork!.parentElement!.getAttribute("title")).toBeNull();
  act(() => fork!.parentElement!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(document.querySelector("[data-menu-info-tip]")!.textContent).toBe("运行时不支持分叉");
  // An enabled row's title is the app tip (no native title in a menu).
  expect(copy!.querySelector("[data-menu-info]")).toBeNull();
  expect(copy!.parentElement!.getAttribute("data-tip")).toBe("复制名字");
  expect(copy!.parentElement!.getAttribute("title")).toBeNull();
});
