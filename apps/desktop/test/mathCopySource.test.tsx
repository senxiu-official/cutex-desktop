// @vitest-environment jsdom
// 「复制源码」 on a formula's context menu (lib/mathMenu.ts, lib/menuTargets): above the view's own
// items where the view has a menu, alone where it has none; copies the TeX without delimiters, inline and display.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const copied = vi.hoisted(() => [] as string[]);
vi.mock("../src/renderer/src/bridge", () => ({
  api: { openExternal: () => Promise.resolve() },
  bridge: { on: () => () => {} },
  onEvent: () => () => {},
  cleanIpcMessage: (m: string) => m,
}));
vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
  translate: (key: string) => key,
}));
vi.mock("../src/renderer/src/lib/menus", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  copyText: (text: string) => void copied.push(text),
}));

const { Markdown } = await import("../src/renderer/src/components/Markdown");
const { loadKatex } = await import("../src/renderer/src/lib/katexRender");
const { contextMenu, closeMenu, useOverlayState } = await import("../src/renderer/src/lib/contextMenu");
const { mathSourceAt } = await import("../src/renderer/src/lib/mathMenu");
type Items = { label?: string; onSelect?: () => void }[] | null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let menu: Items = null;
function MenuProbe() {
  const state = useOverlayState();
  menu = (state.menu?.items as Items) ?? null;
  return null;
}

let root: Root | null = null;
async function mount(text: string, withMenu: boolean) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const body = h(Markdown, { text });
  await act(async () => {
    root!.render(h("div", null, h(MenuProbe), withMenu ? h("div", { onContextMenu: contextMenu(() => [{ label: "Own item", onSelect: () => {} }]) }, body) : body));
  });
  return container;
}
async function rightClick(target: Element) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
  });
}
const labels = () => (menu ?? []).map((item) => (typeof item === "string" ? item : item.label));

beforeAll(async () => {
  await loadKatex();
});
afterEach(async () => {
  await act(async () => {
    root?.unmount();
    closeMenu();
  });
  root = null;
  document.body.replaceChildren();
  copied.length = 0;
});

describe("Copy source on a formula", () => {
  it("adds the item above the view's own menu and copies the inline TeX", async () => {
    const view = await mount("其中 $E\\varepsilon_c=0$。", true);
    await rightClick(view.querySelector(".math-inline .katex-html")!);
    expect(labels()).toEqual(["menu.copyMathSource", "separator", "Own item"]);
    (menu![0] as { onSelect(): void }).onSelect();
    expect(copied).toEqual(["E\\varepsilon_c=0"]);
  });

  it("copies a display formula's TeX without $$ and outer line ends", async () => {
    const view = await mount("Then\n$$\n\\mathrm{MSE}=\\operatorname{Var}+b^2\n$$\n", true);
    await rightClick(view.querySelector(".math-display .katex")!);
    (menu![0] as { onSelect(): void }).onSelect();
    expect(copied).toEqual(["\\mathrm{MSE}=\\operatorname{Var}+b^2"]);
  });

  it("leaves the view's menu alone off a formula", async () => {
    const view = await mount("plain $x$ text", true);
    await rightClick(view.querySelector("p")!);
    expect(labels()).toEqual(["Own item"]);
  });

  it("opens a menu with just the item where the view has none", async () => {
    const view = await mount("\\[ a^2+b^2 \\] and \\(y\\)", false);
    await rightClick(view.querySelector(".math-display .katex")!);
    expect(labels()).toEqual(["menu.copyMathSource"]);
    (menu![0] as { onSelect(): void }).onSelect();
    expect(copied).toEqual(["a^2+b^2"]);
  });

  it("keeps the native menu (Copy) when text is selected there", async () => {
    const view = await mount("a $x^2$ b", true);
    const formula = view.querySelector(".math-inline")!;
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(view.querySelector("p")!);
    selection.addRange(range);
    await rightClick(formula.querySelector(".katex-html")!);
    expect(menu).toBeNull();
    selection.removeAllRanges();
  });

  it("reads the TeX for each delimiter", () => {
    const at = (source: string) => {
      const el = document.createElement("span");
      el.setAttribute("data-math-source", source);
      el.append(document.createElement("i"));
      return mathSourceAt(el.firstElementChild!);
    };
    expect([at("$x$"), at("$$ y $$"), at("\\(z\\)"), at("\\[\nw\n\\]")]).toEqual(["x", "y", "z", "w"]);
    expect(mathSourceAt(document.createElement("p"))).toBeNull();
  });
});
