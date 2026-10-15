import { describe, expect, it } from "vitest";
import { appearanceVars, clampPaneWidth, DEFAULT_APPEARANCE, fontStack, MIN_CONVERSATION_W, parseAppearance, RANGES } from "../src/renderer/src/lib/appearanceModel";
import { buildFontPlan, FALLBACK_FONT_VARIABLES } from "../src/renderer/src/lib/fontFaces";

describe("parseAppearance", () => {
  it("defaults, clamps to the wide ranges, and migrates the old capsule size", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    const p = parseAppearance({ zoom: 999, chatFontSize: 3, sidebarWidth: 300.4, readingWidth: 0, density: "comfortable", uiFont: "  Inter  " });
    expect(p.zoom).toBe(RANGES.zoom[1]);
    expect(p.chatFontSize).toBe(RANGES.chatFontSize[0]);
    expect(p.sidebarWidth).toBe(300);
    expect(p.readingWidth).toBe(0);
    expect(p.density).toBe("comfortable");
    expect(p.uiFont).toBe("Inter");
    expect(parseAppearance({}).capsuleScale).toBe(100);
    expect(parseAppearance({ capsuleScale: 200 }).capsuleScale).toBe(200);
  });
});

describe("side pane width / clampPaneWidth", () => {
  it("parses, clamps and exposes the side pane width", () => {
    expect(parseAppearance({ sidePaneWidth: 10 }).sidePaneWidth).toBe(RANGES.sidePaneWidth[0]);
    expect(parseAppearance({ sidePaneWidth: "x" }).sidePaneWidth).toBe(DEFAULT_APPEARANCE.sidePaneWidth);
    expect(appearanceVars({ ...DEFAULT_APPEARANCE, sidePaneWidth: 512 })["--sidepane-w"]).toBe("512px");
  });

  it("keeps the range and leaves the conversation its minimum", () => {
    const r = [260, 1600] as const;
    expect(clampPaneWidth(500.6, r)).toBe(501);
    expect(clampPaneWidth(100, r)).toBe(260);
    expect(clampPaneWidth(5000, r)).toBe(1600);
    // 1000px to share: the pane may take up to 1000 - MIN_CONVERSATION_W.
    expect(clampPaneWidth(900, r, 1000)).toBe(1000 - MIN_CONVERSATION_W);
    expect(clampPaneWidth(300, r, 1000)).toBe(300);
    // Too narrow for both: the range minimum wins.
    expect(clampPaneWidth(400, r, 500)).toBe(260);
  });
});

describe("appearanceVars / fontStack", () => {
  it("quotes families and falls back to the built-in stack", () => {
    expect(fontStack(["KingHwa_OldSong", "Noto Serif CJK SC", ""], "serif")).toBe(`KingHwa_OldSong, "Noto Serif CJK SC", serif`);
  });

  it("maps fields to CSS variables (0 width = none, chat follows UI when unset)", () => {
    const v = appearanceVars({ ...DEFAULT_APPEARANCE, readingWidth: 0, chatFontSize: 18, capsuleScale: 175 });
    expect(v["--reading-w"]).toBe("none");
    expect(v["--chat-font-size"]).toBe("18px");
    expect(v["--capsule-scale"]).toBe("1.75");
    expect(v["--font-chat"]).toBe(v["--font-sans"]);
    const selected = { ...DEFAULT_APPEARANCE, chatFont: "Source Serif 4", cjkFont: "KingHwa_OldSong" };
    // A pending choice cannot bypass Unicode routing via an unrestricted stack.
    expect(appearanceVars(selected)["--font-mono"]).toBe("monospace");
    expect(appearanceVars(selected)["--font-chat"]).toBe(FALLBACK_FONT_VARIABLES["--font-chat"]);
    const ready = buildFontPlan(selected, 1).variables;
    expect(appearanceVars(selected, ready)["--font-chat"]).toBe(ready["--font-chat"]);
    expect(appearanceVars(selected, ready)["--font-chat-cjk"]).toBe(ready["--font-chat-cjk"]);
  });
});
