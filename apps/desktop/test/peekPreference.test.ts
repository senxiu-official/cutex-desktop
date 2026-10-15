import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PeekSetting } from "../src/renderer/src/lib/peekTarget";
import { gutterLayout, PEEK_MIN } from "../src/renderer/src/lib/gutterLayout";
import { setGutterGeometry } from "../src/renderer/src/lib/gutterStore";
import { currentPeekTarget, setPeekState, setPeekWhere, usePeek } from "../src/renderer/src/lib/peekStore";

const env = vi.hoisted(() => ({ setting: "auto" as PeekSetting, rightOpen: vi.fn() }));
vi.mock("../src/renderer/src/modules/app", () => ({ appModules: () => ({ modules: [], statuses: () => new Map() }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ hosts: { active: "local" }, selectedId: "s", view: { kind: "conversation" } }) }, agentHost: () => "local" }));
vi.mock("../src/renderer/src/lib/prefs", () => ({ getUiPrefs: () => ({ peekTarget: env.setting }) }));
vi.mock("../src/renderer/src/lib/sideComponents", () => ({
  sideRegistry: () => new Map([["test.peek", { moduleId: "test", item: {
    peekable: true, defaultBinding: "host", parseParams: (params: unknown) => params, init: (params: unknown) => params,
  } }]]),
  dedupeKeyOf: () => "same-ref", sideViewNow: () => ({ hostId: "local", sessionId: "s" }), specFrom: () => null,
}));
vi.mock("../src/renderer/src/lib/sideLayoutStore", () => ({
  useSide: { getState: () => ({ scope: "host:local", mode: null }) },
  updateLayout: env.rightOpen, bumpRevealed: vi.fn(), flashInstance: vi.fn(), setMode: vi.fn(),
}));
const { sideOpen, sideOpenPeek } = await import("../src/renderer/src/lib/sideServices");

function width(readingWidth: number, cardWidth = 1400) {
  setGutterGeometry(gutterLayout({ cardWidth, readingWidth, shift: 0, sideCover: 0, columnPadding: 24, capsule: null, conversationVisible: true }), cardWidth);
}
beforeEach(() => {
  vi.stubGlobal("document", { activeElement: null, body: {} });
  vi.stubGlobal("HTMLElement", class {});
  usePeek.setState({ peek: null, flash: 0, revealed: 0 });
  env.setting = "auto"; env.rightOpen.mockClear(); width(0);
});
afterEach(() => vi.unstubAllGlobals());

describe("per-open reference-card placement", () => {
  it.each(["auto", "right", "left"] as const)("keeps an explicit left peek on a full-width chat despite global %s", (setting) => {
    env.setting = setting;
    expect(sideOpenPeek("test.peek", { key: "turn" }, "left")).toMatchObject({ status: "opened", where: "peek" });
    const peek = usePeek.getState().peek!;
    expect(peek).toMatchObject({ preference: "left", where: "overlay" });
    expect(currentPeekTarget(peek, setting, 0, PEEK_MIN, true)).toBe("overlay");
    expect(env.rightOpen).not.toHaveBeenCalled();
  });

  it("retains explicit placement while resizing, changing state, and changing global settings", () => {
    sideOpenPeek("test.peek", {}, "left");
    const id = usePeek.getState().peek!.id;
    setPeekState(id, { title: "loaded" }, 2);
    setPeekWhere("gutter");
    expect(usePeek.getState().peek).toMatchObject({ id, state: { title: "loaded" }, preference: "left", where: "gutter" });
    expect(currentPeekTarget(usePeek.getState().peek, "right", 400, PEEK_MIN, true)).toBe("gutter");
    expect(currentPeekTarget(usePeek.getState().peek, "auto", 80, PEEK_MIN, true)).toBe("overlay");
    expect(currentPeekTarget(usePeek.getState().peek, "right", 0, PEEK_MIN, true)).toBe("overlay");
  });

  it("ordinary opens continue to follow live settings, even when opened under the left preference", () => {
    env.setting = "left";
    sideOpen("test.peek", {}, { target: "peek" });
    const peek = usePeek.getState().peek!;
    expect(peek.preference).toBeUndefined();
    expect(currentPeekTarget(peek, "auto", 0, PEEK_MIN, true)).toBe("page");
    expect(currentPeekTarget(peek, "left", 0, PEEK_MIN, true)).toBe("overlay");
    expect(currentPeekTarget(peek, "auto", 400, PEEK_MIN, true)).toBe("gutter");
    expect(currentPeekTarget(peek, "right", 400, PEEK_MIN, true)).toBe("page");
  });

  it("reopening the same reference updates its placement intent without replacing its identity", () => {
    sideOpenPeek("test.peek", {}, "left");
    const first = usePeek.getState().peek!;
    width(700);
    sideOpen("test.peek", {}, { target: "peek" });
    expect(usePeek.getState().peek).toMatchObject({ id: first.id, where: "gutter" });
    expect(usePeek.getState().peek!.preference).toBeUndefined();
    expect(usePeek.getState().flash).toBe(1);
    sideOpenPeek("test.peek", {}, "left");
    expect(usePeek.getState().peek).toMatchObject({ id: first.id, preference: "left" });
  });

  it("the host uses the per-open preference and leaves room below the top-entry row", () => {
    const source = readFileSync(new URL("../src/renderer/src/components/gutter/PeekCard.tsx", import.meta.url), "utf8");
    expect(source).toContain("currentPeekTarget(peek, setting, g.width, PEEK_MIN, true)");
    expect(source).toContain("Math.max(g.topInset + 8, (topStackBottom ?? 0) + 8)");
    expect(currentPeekTarget({ preference: "left" }, "auto", 500, PEEK_MIN, false)).toBe("page");
  });
});
