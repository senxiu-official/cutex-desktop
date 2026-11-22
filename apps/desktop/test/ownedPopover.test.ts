// @vitest-environment jsdom
// Portaled popovers belong to the container their anchor is in (lib/ownedPopover; re-review of b8d26c931).
import { describe, expect, it } from "vitest";
import { OWNED_POPOVER, ownPopover, withinOwned } from "../src/renderer/src/lib/ownedPopover";

describe("withinOwned", () => {
  it("in the root, in a popover opened from it, in a popover opened from that one; not elsewhere or after unregistering", () => {
    document.body.innerHTML = `<div id="tray"><button id="row">row</button></div><div id="p1" ${OWNED_POPOVER}><button id="copy">copy</button><button id="more">more</button></div><div id="p2" ${OWNED_POPOVER}><span id="deep">x</span></div><button id="out">out</button>`;
    const $ = (id: string) => document.getElementById(id)!;
    const stop1 = ownPopover($("p1"), $("row"));
    const stop2 = ownPopover($("p2"), $("more"));
    expect(withinOwned($("tray"), $("row"))).toBe(true);
    expect(withinOwned($("tray"), $("copy"))).toBe(true);
    expect(withinOwned($("tray"), $("deep").firstChild)).toBe(true); // a text node, two popovers away
    expect(withinOwned($("tray"), $("out"))).toBe(false);
    expect(withinOwned($("tray"), null)).toBe(false);
    stop1();
    expect(withinOwned($("tray"), $("copy"))).toBe(false);
    expect(withinOwned($("tray"), $("deep"))).toBe(false);
    stop2();
  });
});
