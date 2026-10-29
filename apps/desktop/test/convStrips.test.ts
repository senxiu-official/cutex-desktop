// 收起一个会话 (docs/design/002; lib/convStrips): which panes are drawn as strips — only with two workspaces, never
// the focused one, never both — whether a pane can fold / 独占 can act; stored strips read back; and 「太窄？收起 X」's
// rule (lib/narrowRoom): previews only, narrower than their comfortable width, with a workspace to fold.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m }));

import { canSolo, canStrip, readStrips, stripPanes } from "../src/renderer/src/lib/convStrips";
import { comfortWidth, COMFORT_WIDTH, narrowChipShown } from "../src/renderer/src/lib/narrowRoom";
import { conversationPanes, defaultLayout, focusPane, openBeside, type PaneLayout } from "../src/renderer/src/lib/paneLayout";

const one = () => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
const two = () => openBeside(one(), { hostId: "local", sessionId: "b2" }, 10);
const rec = { at: 1 };

describe("stripPanes / canStrip / canSolo", () => {
  it("one workspace: never a strip, nothing can fold, 独占 does nothing", () => {
    const l = one();
    const [main] = conversationPanes(l);
    expect(stripPanes(l, { "local|a1": rec })).toEqual([]);
    expect(canStrip(l, main!, {})).toBe(false);
    expect(canSolo(l, main!)).toBe(false);
  });

  it("two workspaces: a stored strip on the unfocused one is drawn; the focused one never is", () => {
    const l = two();
    const [left, right] = conversationPanes(l) as [string, string];
    expect(l.focus).toBe(right);
    expect(stripPanes(l, { "local|a1": rec })).toEqual([left]);
    // Focused: expanded whatever is stored (聚焦窄条 = 展开它).
    expect(stripPanes(l, { "local|b2": rec })).toEqual([]);
    const focusedLeft: PaneLayout = focusPane(l, left, 20);
    expect(stripPanes(focusedLeft, { "local|a1": rec, "local|b2": rec })).toEqual([right]);
    // Another host's conversation of the same id: not this one.
    expect(stripPanes(l, { "ssh-x|a1": rec })).toEqual([]);
  });

  it("can fold: two workspaces, an agent, and the other one stays expanded (never both)", () => {
    const l = two();
    const [left, right] = conversationPanes(l) as [string, string];
    expect(canStrip(l, left, {})).toBe(true);
    expect(canStrip(l, right, {})).toBe(true);
    // The left is a strip already: it cannot fold again, and the right (the last expanded) cannot fold.
    expect(canStrip(l, left, { "local|a1": rec })).toBe(false);
    expect(canStrip(l, right, { "local|a1": rec })).toBe(false);
    expect(canStrip(l, "nope", {})).toBe(false);
  });

  it("独占 acts while another workspace is still expanded", () => {
    const l = two();
    const [left, right] = conversationPanes(l) as [string, string];
    expect(canSolo(l, right)).toBe(true);
    expect(canSolo(l, left)).toBe(true);
  });

  it("stored strips read back; malformed ones dropped", () => {
    expect(readStrips(null)).toEqual({});
    expect(readStrips([])).toEqual({});
    expect(readStrips({ "local|a1": { at: 5 }, nobar: { at: 1 }, "local|b2": null, "local|c3": { at: "x", gave: { owner: "local|a1", shelfId: "s1", before: 400 } } })).toEqual({
      "local|a1": { at: 5 },
      "local|c3": { at: 0, gave: { owner: "local|a1", shelfId: "s1", before: 400 } },
    });
    expect(readStrips({ "local|a1": { at: 1, gave: { owner: 3 } } })).toEqual({ "local|a1": { at: 1 } });
  });
});

describe("「太窄？收起 X」 (lib/narrowRoom)", () => {
  it("previews only: a page, an artifact, a web page, a file preview, a diff — not a terminal or a file tree", () => {
    for (const kind of ["page:projects.page", "artifacts.view", "browser.tab", "workspace.preview", "diff.view"]) expect(comfortWidth(kind)).toBe(COMFORT_WIDTH);
    for (const kind of ["terminal.tab", "workspace.files", "conversation.projection", ""]) expect(comfortWidth(kind)).toBeNull();
    // A kind that declares a wider minimum reads comfortably at that.
    expect(comfortWidth("browser.tab", 700)).toBe(700);
    expect(comfortWidth("browser.tab", 280)).toBe(COMFORT_WIDTH);
  });

  it("shown below the comfortable width, measured, with a workspace to fold", () => {
    expect(narrowChipShown({ width: 420, comfort: 560, canFold: true })).toBe(true);
    expect(narrowChipShown({ width: 560, comfort: 560, canFold: true })).toBe(false);
    expect(narrowChipShown({ width: 420, comfort: 560, canFold: false })).toBe(false);
    expect(narrowChipShown({ width: 420, comfort: null, canFold: true })).toBe(false);
    expect(narrowChipShown({ width: null, comfort: 560, canFold: true })).toBe(false);
    expect(narrowChipShown({ width: 0, comfort: 560, canFold: true })).toBe(false);
  });
});
