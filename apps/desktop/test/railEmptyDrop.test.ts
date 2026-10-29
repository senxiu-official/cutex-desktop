// @vitest-environment jsdom
// Owner 2026-10-23: dropping a pane on the EMPTY space at the bottom of a Shelf Rail (below its last capsule) detaches it
// like dropping on 「新页」 (＋); a capsule keeps its own meaning, and so do the rail's buttons and the space above the
// last capsule (lib/sideDnd railEmptyBelow + probe).
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const { probe, railEmptyBelow } = await import("../src/renderer/src/lib/sideDnd");

describe("railEmptyBelow", () => {
  it("below the last capsule only; never on a button", () => {
    expect(railEmptyBelow(300, [40, 80, 120], false)).toBe(true);
    expect(railEmptyBelow(100, [40, 80, 120], false)).toBe(false);
    expect(railEmptyBelow(120, [40, 80, 120], false)).toBe(false);
    expect(railEmptyBelow(300, [40, 80, 120], true)).toBe(false);
    expect(railEmptyBelow(10, [], false)).toBe(true);
  });
});

describe("probe over a Shelf Rail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });
  const rect = (bottom: number) => ({ top: bottom - 30, bottom, left: 0, right: 30, width: 30, height: 30, x: 0, y: bottom - 30, toJSON() {} }) as DOMRect;
  function rail() {
    document.body.innerHTML = `<nav data-shelf-rail="s1"><button data-shelf-page="p1"></button><button data-shelf-page="p2"></button><button data-shelf-add="s1"></button><span id="gap"></span><button id="menu"></button></nav>`;
    const [p1, p2] = [...document.querySelectorAll("[data-shelf-page]")];
    vi.spyOn(p1!, "getBoundingClientRect").mockReturnValue(rect(60));
    vi.spyOn(p2!, "getBoundingClientRect").mockReturnValue(rect(100));
  }
  // jsdom has no elementsFromPoint.
  const over = (id: string) => void ((document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [document.querySelector(id)!]);

  it("the empty space below the last capsule is a new page of that Shelf", () => {
    rail();
    over("#gap");
    expect(probe(10, 400, null)).toEqual({ at: "newPage", shelfId: "s1" });
  });
  it("the ＋ is still the ＋; a capsule is still a page; a rail button is not empty space", () => {
    rail();
    over("[data-shelf-add]");
    expect(probe(10, 400, null)).toEqual({ at: "newPage", shelfId: "s1" });
    over("[data-shelf-page=p1]");
    expect(probe(10, 40, null).at).toBe("page");
    over("#menu");
    expect(probe(10, 400, null).at).not.toBe("newPage");
  });
  it("empty space ABOVE the last capsule (a gap between capsules) is not a drop target", () => {
    rail();
    over("#gap");
    expect(probe(10, 80, null).at).not.toBe("newPage");
  });
});
