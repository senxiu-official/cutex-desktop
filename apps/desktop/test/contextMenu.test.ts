// Context menus (lib/contextMenu.ts): entry normalisation and when an open menu dismisses itself.
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { normalizeEntries, watchMenuDismiss, type MenuAction } from "../src/renderer/src/lib/contextMenu";

const a = (label: string): MenuAction => ({ label, onSelect: () => {} });

describe("normalizeEntries", () => {
  it("drops falsy entries and redundant separators", () => {
    const out = normalizeEntries(["separator", a("x"), false, "separator", null, "separator", a("y"), "", "separator", undefined]);
    expect(out.map((e) => (e === "separator" ? "|" : e.label))).toEqual(["x", "|", "y"]);
  });
  it("returns empty when only separators remain", () => {
    expect(normalizeEntries(["separator", false, "separator"])).toEqual([]);
  });
});

describe("watchMenuDismiss", () => {
  const setup = () => {
    const win = new JSDOM(`<!doctype html><body><div id="timeline"></div><div id="sidebar"></div><div id="menu"><div id="row"></div></div></body>`).window;
    const doc = win.document;
    const close = vi.fn();
    const stop = watchMenuDismiss(() => doc.getElementById("menu"), close, win as unknown as Window);
    const fire = (id: string, type: string) => doc.getElementById(id)!.dispatchEvent(new win.Event(type, { bubbles: type !== "scroll" }));
    return { win, close, stop, fire };
  };

  it("stays open while code scrolls (a streaming timeline sticking to the bottom, sidebar re-renders)", () => {
    const { close, fire } = setup();
    fire("timeline", "scroll");
    fire("sidebar", "scroll");
    expect(close).not.toHaveBeenCalled();
  });
  it("closes on the user scrolling outside it, not inside it (a long submenu)", () => {
    const { close, fire } = setup();
    fire("row", "wheel");
    fire("row", "touchmove");
    expect(close).not.toHaveBeenCalled();
    fire("timeline", "wheel");
    expect(close).toHaveBeenCalledTimes(1);
    fire("sidebar", "touchmove");
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("closes on window blur and resize; stops listening once removed", () => {
    const { win, close, stop, fire } = setup();
    win.dispatchEvent(new win.Event("blur"));
    win.dispatchEvent(new win.Event("resize"));
    expect(close).toHaveBeenCalledTimes(2);
    stop();
    win.dispatchEvent(new win.Event("blur"));
    fire("timeline", "wheel");
    expect(close).toHaveBeenCalledTimes(2);
  });
});
