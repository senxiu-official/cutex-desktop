import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AVATAR_EMOJI_SET, bundledEmoji, defaultEmoji, emojiUrl, seedHash } from "./agentEmoji";

const ASSETS = new URL("../assets/emoji/", import.meta.url);

describe("bundled avatar emoji set", () => {
  it("has ~80 unique entries, each with a small bundled SVG", () => {
    expect(AVATAR_EMOJI_SET.length).toBe(80);
    expect(new Set(AVATAR_EMOJI_SET.map((e) => e.glyph)).size).toBe(AVATAR_EMOJI_SET.length);
    expect(new Set(AVATAR_EMOJI_SET.map((e) => e.code)).size).toBe(AVATAR_EMOJI_SET.length);
    for (const e of AVATAR_EMOJI_SET) {
      const file = new URL(`${e.code}.svg`, ASSETS);
      expect(existsSync(file), e.code).toBe(true);
      const svg = readFileSync(file, "utf8");
      expect(svg.startsWith("<svg"), e.code).toBe(true);
      expect(svg.length, e.code).toBeLessThan(4096);
      expect(svg, e.code).not.toMatch(/<script|href="http|xlink:href="http/);
      expect(emojiUrl(e), e.code).toBeTruthy();
      // the code points in the file name are the glyph's
      expect([...e.glyph].map((c) => c.codePointAt(0)!.toString(16)).join("-")).toBe(e.code);
    }
  });

  it("maps stored values back to the bundled picture, ignoring variation selectors and spaces", () => {
    expect(bundledEmoji("🦊")?.name).toBe("fox");
    expect(bundledEmoji(" ☁ ")?.code).toBe("2601-fe0f");
    expect(bundledEmoji("☁️")?.code).toBe("2601-fe0f");
    expect(bundledEmoji("🐉")).toBeNull();
    expect(bundledEmoji("")).toBeNull();
    expect(bundledEmoji(null)).toBeNull();
  });
});

describe("default emoji pick", () => {
  it("is stable: the same id always gets the same emoji (pinned values = every device agrees)", () => {
    expect(seedHash("")).toBe(seedHash(""));
    const ids = ["0b6f7c2e-1d1a-4b7e-9a51-6a2f3c4d5e6f", "demo-director-r2", "a"];
    const pinned = ids.map((id) => defaultEmoji(id).code);
    expect(ids.map((id) => defaultEmoji(id).code)).toEqual(pinned);
    expect(pinned).toMatchInlineSnapshot(`
      [
        "1f41d",
        "1f419",
        "1f98c",
      ]
    `);
  });

  it("spreads ids evenly over the set, including ids that differ only at the end", () => {
    const counts = new Map<string, number>();
    const n = 8000;
    for (let i = 0; i < n; i++) {
      const id = `demo-analysis-${i.toString(36)}-r${i % 4}`;
      const code = defaultEmoji(id).code;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    expect(counts.size).toBe(AVATAR_EMOJI_SET.length);
    const expected = n / AVATAR_EMOJI_SET.length;
    let chi = 0;
    for (const e of AVATAR_EMOJI_SET) chi += ((counts.get(e.code) ?? 0) - expected) ** 2 / expected;
    // 79 degrees of freedom: p = 0.001 at ≈ 124
    expect(chi).toBeLessThan(124);
  });

  it("gives a typical project's agents (shared prefix) mostly different emoji", () => {
    const names = ["demopolya-2", "demo-ui-r3", "demo-director-r2", "demo-quant-config-r1", "demo-quant-engine-r1", "demo-quant-integration-r1", "demo-quant-review-r1", "demo-analysis-retina-r1", "demo-analysis-public-r1", "demo-analysis-spatial-r1", "demo-analysis-protocol-r1", "demo-polyadb-human-glm-r1", "demo-kidney-glm-r2", "demo-heart-nuclei-glm-r2", "demo-heart-nuclei-claude-r3", "demo-polyasite-mouse-claude-r3", "demo-kidney-claude-r3"];
    const distinct = new Set(names.map((n) => defaultEmoji(n).code)).size;
    // 17 picks from 80: expected ≈ 15.4 distinct
    expect(distinct).toBeGreaterThanOrEqual(13);
    // UUID-like session ids, sequential
    const uuids = Array.from({ length: 40 }, (_, i) => `7f3e9c10-0000-4000-8000-${i.toString(16).padStart(12, "0")}`);
    expect(new Set(uuids.map((u) => defaultEmoji(u).code)).size).toBeGreaterThanOrEqual(25);
  });
});
