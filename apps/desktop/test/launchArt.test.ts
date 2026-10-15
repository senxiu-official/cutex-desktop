import { describe, expect, it } from "vitest";
import { LAUNCH_ART_FILES, launchArtFrom } from "../src/renderer/src/lib/launchArt";

describe("launch artwork (optional, not in git)", () => {
  it("yields nothing when the images are missing", () => {
    expect(launchArtFrom({})).toEqual({});
  });
  it("needs both a portrait and a victory image per provider", () => {
    const art = launchArtFrom({
      [`../assets/launcher/${LAUNCH_ART_FILES.codex.portrait}`]: "/a.png",
      [`../assets/launcher/${LAUNCH_ART_FILES.codex.victory}`]: "/b.png",
      [`../assets/launcher/${LAUNCH_ART_FILES.claude.portrait}`]: "/c.png",
      "../assets/launcher/unrelated.png": "/d.png",
    });
    expect(art).toEqual({ codex: { portrait: "/a.png", victory: "/b.png" } });
  });
});
