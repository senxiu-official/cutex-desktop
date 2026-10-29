// The Windows caption buttons (docs/design/029, shared/windowChrome): a transparent fill always, the symbols in
// the theme's foreground (readable over the window colour's scrim), main accepting #rrggbbaa fills and only
// opaque symbol colours; the first overlay transparent too (no dark block before the page reports its theme).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTION_FILL, captionColors, initialCaption, isOverlayColor, isSymbolColor, luminance, toHex6 } from "../src/shared/windowChrome";

describe("caption buttons' colours", () => {
  it("the fill is always transparent; the symbols take the theme's foreground", () => {
    expect(CAPTION_FILL).toBe("#00000000");
    expect(captionColors({ fg: "#ececec", win: "#0e0e0f" })).toEqual({ color: "#00000000", symbolColor: "#ececec" });
    expect(captionColors({ fg: " #1d1d1f ", win: "#f1f1f3" })).toEqual({ color: "#00000000", symbolColor: "#1d1d1f" });
    // Palettes give rgb() too.
    expect(captionColors({ fg: "rgb(45, 43, 38)", win: "rgb(239, 237, 229)" }).symbolColor).toBe("#2d2b26");
  });

  it("an unreadable or too-faint foreground falls back by the window colour's brightness", () => {
    expect(captionColors({ fg: "", win: "#f1f1f3" }).symbolColor).toBe("#333333");
    expect(captionColors({ fg: "var(--x)", win: "#101010" }).symbolColor).toBe("#e5e5e5");
    // Grey on grey (contrast < 3:1): the fallback.
    expect(captionColors({ fg: "#9a9a9a", win: "#8a8a8a" }).symbolColor).toBe("#333333");
    expect(captionColors({ fg: "#333333", win: "" }).symbolColor).toBe("#333333");
  });

  it("parses the colours the renderer reads", () => {
    expect(toHex6("#abc")).toBe("#aabbcc");
    expect(toHex6("#AABBCC")).toBe("#aabbcc");
    expect(toHex6("#aabbcc80")).toBe("#aabbcc");
    expect(toHex6("rgba(255, 0, 16, 0.5)")).toBe("#ff0010");
    expect(toHex6("rgb(255 0 16)")).toBe("#ff0010");
    expect(toHex6("hsl(0 0% 0%)")).toBeNull();
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("main accepts #rrggbb / #rrggbbaa fills, only opaque symbols; nothing else", () => {
    expect(isOverlayColor("#00000000")).toBe(true);
    expect(isOverlayColor("#1c1c1d")).toBe(true);
    expect(isOverlayColor("rgba(0,0,0,0)")).toBe(false);
    expect(isOverlayColor("#000")).toBe(false);
    expect(isOverlayColor(null)).toBe(false);
    expect(isSymbolColor("#e5e5e5")).toBe(true);
    expect(isSymbolColor("#e5e5e580")).toBe(false);
  });

  it("the first overlay (before the page reports its theme) is transparent too", () => {
    expect(initialCaption(true)).toEqual({ color: "#00000000", symbolColor: "#e5e5e5" });
    expect(initialCaption(false)).toEqual({ color: "#00000000", symbolColor: "#333333" });
    const main = readFileSync(join(__dirname, "../src/main/index.ts"), "utf8");
    expect(main).not.toMatch(/#1c1c1d|#f6f6f7/);
    expect(main).toContain("initialCaption(nativeTheme.shouldUseDarkColors)");
    expect(main).toContain("isOverlayColor(color) && isSymbolColor(symbolColor)");
  });
});
