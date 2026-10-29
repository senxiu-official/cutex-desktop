// @vitest-environment jsdom
// 点击与手势 draws mouse gestures as icon keycaps (owner 2026-10-24): the word (左键点击 …) is their tooltip and
// accessible name, keys stay text keycaps, and a one-line key of the icons sits under the meaning chips. A rebindable
// command's key (桌面: paneDesktop) is the effective binding (lib/keybindings) and follows a rebind live.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => {
  const { gestureZhCN } = await import("../src/renderer/src/i18n/gestureCatalog");
  const zh = gestureZhCN as Record<string, string>;
  return { ...(await importOriginal<object>()), useI18n: () => ({ t: (key: string) => zh[key] ?? key, locale: "zh-CN" }) };
});

const { GestureGuide } = await import("../src/renderer/src/components/settings/GestureGuide");
const { GESTURE_ICONS, MouseMiddle } = await import("../src/renderer/src/components/GestureIcons");
const { GESTURE_INPUTS, GESTURES } = await import("../src/renderer/src/lib/gestures");
const { resetBindings, setBindings } = await import("../src/renderer/src/lib/keybindings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => resetBindings());

const desktopKeys = (el: ParentNode) => [...el.querySelectorAll('[data-gesture-block="desktop"] dt kbd:not([data-gesture-input])')].map((k) => k.textContent);

function render() {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(h(GestureGuide));
  return host;
}

describe("gesture icons", () => {
  it("every mouse gesture is an icon keycap named by its word (tooltip + aria-label); no word is printed in the chips", () => {
    const el = render();
    const caps = [...el.querySelectorAll<HTMLElement>("dt [data-gesture-input]")];
    const used = GESTURES.flatMap((b) => b.rows.flatMap((r) => r.gestures.filter((g) => g.input))).length;
    expect(caps).toHaveLength(used);
    const words: Record<string, string> = { left: "左键点击", right: "右键点击", middle: "中键点击", drag: "拖动", longPress: "长按" };
    for (const cap of caps) {
      const input = cap.dataset.gestureInput!;
      expect(cap.getAttribute("role")).toBe("img");
      expect(cap.getAttribute("aria-label")).toBe(words[input]);
      expect(cap.getAttribute("title")).toBe(words[input]);
      expect(cap.querySelector("svg")).not.toBeNull();
      expect(cap.textContent).toBe("");
    }
    for (const dt of el.querySelectorAll("dt")) for (const w of Object.values(words)) expect(dt.textContent, w).not.toContain(w);
  });

  it("a command's key is its effective binding as a text keycap (default Ctrl+Shift+D), one per combo", () => {
    expect(desktopKeys(render())).toEqual(["Ctrl+Shift+D"]);
    setBindings("paneDesktop", ["Mod+KeyJ", "F9"]);
    const el = render();
    expect(desktopKeys(el)).toEqual(["Ctrl+J", "F9"]);
    expect(el.querySelector('[data-gesture-block="desktop"] dt')!.textContent).toBe("或Ctrl+J或F9");
  });

  it("follows a rebind live, and a command with no key drops out of its line", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(GestureGuide)));
    expect(desktopKeys(host)).toEqual(["Ctrl+Shift+D"]);
    act(() => setBindings("paneDesktop", ["Alt+KeyD"]));
    expect(desktopKeys(host)).toEqual(["Alt+D"]);
    act(() => setBindings("paneDesktop", []));
    const dt = host.querySelector('[data-gesture-block="desktop"] dt')!;
    expect(desktopKeys(host)).toEqual([]);
    expect(dt.textContent).not.toContain("或");
    expect(dt.querySelectorAll("[data-gesture-input]")).toHaveLength(1);
    act(() => root.unmount());
  });

  it("the icons' key at the top: one entry per input, icon + word", () => {
    const key = render().querySelector("[data-gesture-legend] [data-gesture-icons]")!;
    const items = [...key.children];
    expect(items).toHaveLength(GESTURE_INPUTS.length);
    expect(items.map((i) => i.textContent)).toEqual(["左键点击", "右键点击", "中键点击", "拖动", "长按"]);
    for (const i of items) expect(i.querySelector("svg")).not.toBeNull();
  });

  it("lucide's mouse-left / mouse-right, a drawn middle click (wheel filled), hand-grab and timer", () => {
    expect(Object.keys(GESTURE_ICONS).sort()).toEqual([...GESTURE_INPUTS].sort());
    expect(GESTURE_ICONS.middle).toBe(MouseMiddle);
    const svg = renderToStaticMarkup(h(MouseMiddle, { size: 14 }));
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain("lucide-mouse-middle");
  });
});
