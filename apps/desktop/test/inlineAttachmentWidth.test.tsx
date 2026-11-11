// @vitest-environment jsdom
// Owner 2026-10-23 (perf audit §2.5): the width handed to inline turn attachments (`timeline.turnAttachment`
// `TurnAttachmentProps.width`) moves in 8 px steps, rounded down — on a window or column drag the turns' attachments
// render every 8 px instead of on every step. Margin widths are unchanged.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: { on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));
const seen = vi.hoisted(() => ({ widths: [] as number[] }));
vi.mock("../src/renderer/src/lib/gutterItems", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTurnAttachmentItems: () => ITEMS,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ITEMS = [{ moduleId: "probe", mode: "show", missing: [], waiting: false, item: { id: "probe.attachment", Attachment: ({ width }: { width: number }) => (seen.widths.push(width), null) } }];
const { TurnAttachments, inlineWidth, INLINE_WIDTH_STEP } = await import("../src/renderer/src/modules/TurnAttachments");
const { useGutter } = await import("../src/renderer/src/lib/gutterStore");
const { COLUMN_PADDING } = await import("../src/renderer/src/lib/gutterLayout");
const { resetColumnGlide, resizeDrag } = await import("../src/renderer/src/lib/columnGlide");

const side = { width: 0 };
const geometry = (columnWidth: number) => ({ columnLeft: 100, columnWidth, left: side, right: side }) as never;

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  seen.widths = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useGutter.setState({ geometry: null });
});

describe("inline attachment width (modules/TurnAttachments)", () => {
  it("the column less its padding, rounded down to 8 px; never negative", () => {
    expect(INLINE_WIDTH_STEP).toBe(8);
    expect(inlineWidth(700 + 2 * COLUMN_PADDING)).toBe(696);
    expect(inlineWidth(703 + 2 * COLUMN_PADDING)).toBe(696);
    expect(inlineWidth(704 + 2 * COLUMN_PADDING)).toBe(704);
    expect(inlineWidth(10)).toBe(0);
    expect(inlineWidth(0)).toBe(0);
  });

  it("a 1 px-per-step drag over 64 px renders the attachment once per 8 px", async () => {
    act(() => useGutter.setState({ geometry: geometry(800) }));
    await act(async () => root.render(h(TurnAttachments, { sessionId: "eva", turnId: "t1" })));
    const first = seen.widths.length;
    expect(seen.widths.at(-1)).toBe(inlineWidth(800));
    for (let w = 799; w >= 736; w--) await act(async () => useGutter.setState({ geometry: geometry(w) }));
    const widths = seen.widths.slice(first);
    expect(widths.length).toBe(8);
    expect(widths.every((x) => x % 8 === 0 && x <= 799 - 2 * COLUMN_PADDING)).toBe(true);
    expect(seen.widths.at(-1)).toBe(inlineWidth(736));
  });

  it("a width drag (a Shelf's or a column's edge) holds the width: the attachment gets the new one once, on release", async () => {
    // perf/shelf-divider-drag: the 8 px steps were still one background commit each during an edge drag.
    act(() => useGutter.setState({ geometry: geometry(800) }));
    await act(async () => root.render(h(TurnAttachments, { sessionId: "eva", turnId: "t1" })));
    try {
      await act(async () => resizeDrag(true));
      const first = seen.widths.length;
      for (let w = 799; w >= 700; w -= 3) await act(async () => useGutter.setState({ geometry: geometry(w) }));
      expect(seen.widths.length).toBe(first);
      await act(async () => resizeDrag(false));
      expect(seen.widths.length).toBe(first + 1);
      expect(seen.widths.at(-1)).toBe(inlineWidth(700 + ((799 - 700) % 3)));
    } finally {
      resetColumnGlide();
    }
  });
});
