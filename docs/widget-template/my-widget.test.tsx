// @vitest-environment jsdom
// Template (docs/widget-authoring-guide.md §2 Step 7): copy to apps/desktop/test/<id>.test.tsx and rename.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/i18n", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // Echo the vars so a test can see them ("my-widget.count {"n":5}").
  useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key), locale: "en" }),
}));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import mod, { MY_WIDGET } from "../src/renderer/src/modules/my-widget";
import { MyWidget } from "../src/renderer/src/modules/my-widget/Widget";
import { settingsOf } from "../src/renderer/src/modules/home/desk";
import type { DesktopWidgetItem, DesktopWidgetProps } from "../src/renderer/src/modules/widgetTypes";

const kind = (mod.contributes!["desktop.widget"] as DesktopWidgetItem[])[0]!;

const props = (over: Partial<DesktopWidgetProps> = {}): DesktopWidgetProps => ({
  instanceId: MY_WIDGET, width: 320, height: 208, steps: { w: 40, h: 26 }, cells: { w: 3, h: 2 }, units: { w: 6, h: 4 }, theme: "light", settings: settingsOf(kind, undefined), setSettings: () => {}, reducedMotion: false, arranging: false, now: 0, hostId: "local", source: { kind: "module" },
  actions: { openAgent: async () => false, openPage: () => false, openService: async () => false, sendToAgent: async () => false },
  ...over,
});

describe("my widget", () => {
  it("declares its kind", () => {
    expect(kind.id).toBe(MY_WIDGET);
    expect(kind.size.default).toEqual([36, 18]);
  });
  it("its defaults pass its own schema; a bad stored value falls back to the default", () => {
    expect(settingsOf(kind, kind.defaults as never)).toEqual(kind.defaults);
    expect(settingsOf(kind, { rows: 99, order: "nope" }).rows).toBe(5);
    expect(settingsOf(kind, { rows: 99, order: "nope" }).order).toBe("newest");
  });
  it("renders at a normal and at the smallest size", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(MyWidget, props())));
    expect(host.textContent).toContain("my-widget.empty");
    expect(host.textContent).toContain('my-widget.count {"n":5}');
    act(() => root.render(h(MyWidget, props({ settings: settingsOf(kind, { rows: 3 }) }))));
    expect(host.textContent).toContain('my-widget.count {"n":3}');
    act(() => root.render(h(MyWidget, props({ width: 208, height: 96, steps: { w: 26, h: 12 }, cells: { w: 2, h: 1 }, units: { w: 4, h: 2 } }))));
    expect(host.textContent).not.toContain("my-widget.empty");
    act(() => root.unmount());
  });
  it("does nothing on click while the desktop is arranged", () => {
    const openPage = vi.fn(() => true);
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(h(MyWidget, props({ arranging: true, actions: { ...props().actions, openPage } }))));
    act(() => host.querySelector("button")!.click());
    expect(openPage).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
