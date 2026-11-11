// @vitest-environment jsdom
// A pane edge drag (lib/appearance previewWidth): the width's variable moves only on the elements that read it
// (`data-live-width`), never on <html> — an inherited custom property there restyled the whole document per step.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {} }));

const { commitLiveWidths, getAppearance, previewWidth } = await import("../src/renderer/src/lib/appearance");

describe("live pane widths", () => {
  afterEach(() => document.body.replaceChildren());

  it("moves --sidebar-w on its readers only, and stores it on <html> once, on release", () => {
    const card = document.body.appendChild(document.createElement("div"));
    card.setAttribute("data-live-width", "sidebarWidth");
    const other = document.body.appendChild(document.createElement("div"));
    const root = document.documentElement;
    const before = root.style.getPropertyValue("--sidebar-w");
    previewWidth("sidebarWidth", 301);
    previewWidth("sidebarWidth", 302);
    expect(card.style.getPropertyValue("--sidebar-w")).toBe("302px");
    expect(other.style.getPropertyValue("--sidebar-w")).toBe("");
    expect(root.style.getPropertyValue("--sidebar-w")).toBe(before);
    commitLiveWidths();
    expect(getAppearance().sidebarWidth).toBe(302);
    expect(root.style.getPropertyValue("--sidebar-w")).toBe("302px");
    expect(card.style.getPropertyValue("--sidebar-w")).toBe("");
  });

  it("a width nothing reads in CSS (the side pane's) sets no variable while dragging", () => {
    const root = document.documentElement;
    const before = root.style.getPropertyValue("--sidepane-w");
    previewWidth("sidePaneWidth", 333);
    expect(root.style.getPropertyValue("--sidepane-w")).toBe(before);
    commitLiveWidths();
    expect(getAppearance().sidePaneWidth).toBe(333);
  });
});
