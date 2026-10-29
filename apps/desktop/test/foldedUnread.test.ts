// @vitest-environment jsdom
// Owner 2026-10-22 (docs/design/002): a conversation folded to its strip, or in 只看 Shelf, is NOT being looked at —
// store looksAt says no even when it is the selected one, so a turn ending meanwhile leaves an unread mark; expanding
// it (the strip's click, leaving 只看 Shelf) marks it read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/renderer/src/bridge", () => {
  const api = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : () => Promise.resolve(null)) });
  return { api, apiFor: () => api, bridge: { api, apiFor: () => api, on: () => () => {} }, onEvent: () => () => {}, cleanIpcMessage: (m: string) => m };
});

import { looksAt, useApp } from "../src/renderer/src/store";
import { setFoldedTest } from "../src/renderer/src/lib/foldedTest";
import { expandStrip, foldedKeys, isFolded, startConvStrips, useStrips } from "../src/renderer/src/lib/convStrips";
import { leaveShelfOnly, useShelfOnly } from "../src/renderer/src/lib/shelfOnly";
import { conversationPanes, defaultLayout, focusPane, openBeside } from "../src/renderer/src/lib/paneLayout";
import { usePanes } from "../src/renderer/src/lib/paneStore";
import { getTurnMarks, recordTurnEnd } from "../src/renderer/src/lib/turnUnread";

const one = () => defaultLayout({ sidebarOpen: true, sidebarWidth: 256, hostId: "local", sessionId: "a1" });
const two = () => openBeside(one(), { hostId: "local", sessionId: "b2" }, 10);
const state = (selectedId: string) => ({ selectedId, selectedHost: "local", hosts: null, view: { kind: "conversation" as const }, views: {} });

let stop: () => void = () => {};
beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  useStrips.setState({ strips: {} });
  useShelfOnly.setState({ records: {} });
  stop = startConvStrips();
});
afterEach(() => {
  stop();
  setFoldedTest(null);
  vi.restoreAllMocks();
});

describe("folded = not looked at", () => {
  it("foldedKeys: the strips and the 只看 Shelf conversations on screen", () => {
    const l = focusPane(two(), conversationPanes(two())[0]!, 20);
    expect(foldedKeys(l, { "local|b2": { at: 1 } }, {})).toEqual(["local|b2"]);
    expect(foldedKeys(one(), {}, { "local|a1": { at: 1, shelfId: "s", before: null } })).toEqual(["local|a1"]);
    // A strip of the focused pane is never drawn (focusing expands it): not folded.
    expect(foldedKeys(focusPane(two(), conversationPanes(two())[1]!, 20), { "local|b2": { at: 1 } }, {})).toEqual([]);
  });

  it("looksAt: the selected conversation in 只看 Shelf is not looked at; back to normal it is", () => {
    usePanes.setState({ layout: one() });
    expect(looksAt(state("a1"), "local", "a1")).toBe(true);
    useShelfOnly.setState({ records: { "local|a1": { at: 1, shelfId: "s", before: null } } });
    expect(isFolded("local", "a1")).toBe(true);
    expect(looksAt(state("a1"), "local", "a1")).toBe(false);
    useShelfOnly.setState({ records: {} });
    expect(looksAt(state("a1"), "local", "a1")).toBe(true);
  });

  it("a strip's turn end leaves an unread mark; expanding the strip marks it read", () => {
    const l = focusPane(two(), conversationPanes(two())[0]!, 20);
    usePanes.setState({ layout: l });
    useStrips.setState({ strips: { "local|b2": { at: 1 } } });
    const viewing = looksAt({ ...state("a1"), views: { "local\u0000b2": { visible: true } } } as never, "local", "b2");
    expect(viewing).toBe(false);
    useApp.setState({ hosts: null } as never);
    recordTurnEnd("b2", { turnId: "t1", status: "completed" }, viewing);
    expect(getTurnMarks().b2).toBeTruthy();
    expandStrip(conversationPanes(l)[1]!);
    expect(getTurnMarks().b2).toBeUndefined();
  });

  it("leaving 只看 Shelf marks it read", () => {
    usePanes.setState({ layout: one() });
    useShelfOnly.setState({ records: { "local|a1": { at: 1, shelfId: "s", before: null } } });
    recordTurnEnd("a1", { turnId: "t2", status: "completed" }, false);
    expect(getTurnMarks().a1).toBeTruthy();
    leaveShelfOnly(conversationPanes(one())[0]!);
    expect(getTurnMarks().a1).toBeUndefined();
    expect(useShelfOnly.getState().records).toEqual({});
  });
});
