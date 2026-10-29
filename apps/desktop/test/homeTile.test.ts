// Service template tiles (cutex `service-tiles`; modules/home/tile.ts, cutex-client home.ts): the template
// is read-only text; image and action paths stay inside the service (`cutex:service/<slug><path>`), never a
// URL, script or another host; each size draws only its parts.
import { describe, expect, it } from "vitest";
import { readServiceTile, readServiceTileAnswer, tilePath } from "@cutex-desktop/cutex-client";
import { tileActionLink, tileParts, tileRefreshMs } from "../src/renderer/src/modules/home/tile";

const full = {
  title: "第 12 章",
  subtitle: "《三体》",
  lines: ["a", "b", "c", "d"],
  image: "/covers/santi.jpg",
  progress: { value: 0.38, label: "14:06 / 37:12" },
  badge: "1.25×",
  actions: [
    { label: "继续播放", path: "/player?chapter=12" },
    { label: "外链", path: "https://evil.example/" },
    { label: "协议相对", path: "//evil.example/x" },
    { label: "脚本", path: "javascript:alert(1)" },
    { label: "上一级", path: "/a/../../etc" },
    { label: "编码上一级", path: "/a/%2e%2e/b" },
    { label: "内部", path: "/__cutex/admin" },
    { label: "空白", path: "/a b" },
  ],
  refreshSeconds: 5,
  sizes: ["w", "x", "m"],
  html: "<script>alert(1)</script>",
};

describe("service tile paths", () => {
  it("only paths inside the service", () => {
    for (const ok of ["/", "/player?chapter=12", "/covers/santi.jpg", "/a/%E4%B8%89", "/x?y=1&z=/w"]) expect(tilePath(ok), ok).toBe(ok);
    for (const bad of ["", "/a/b%20c", "player", "https://e.com/", "//e.com/x", "javascript:alert(1)", "data:image/png;base64,AA", "/a/../b", "/a/./b", "/a/%2E%2E/b", "/__cutex/x", "/__CUTEX", "/a b", "/a\\b", "/a#b", "/%zz", "/a\u0000", "/%2F%2Fevil.example", `/${"x".repeat(600)}`]) expect(tilePath(bad), bad).toBeNull();
  });

  it("an action's link is the in-app browser link of that service only", () => {
    expect(tileActionLink("audiobook", "/player?chapter=12")).toBe("cutex:service/audiobook/player?chapter=12");
    expect(tileActionLink("audiobook", "https://evil.example/")).toBeNull();
    expect(tileActionLink("Bad Slug", "/x")).toBeNull();
    expect(tileActionLink("audiobook", 42)).toBeNull();
  });
});

describe("service tile template", () => {
  it("drops unknown fields and bad values; clamps progress and refresh; text only", () => {
    const tile = readServiceTile(full)!;
    expect(tile).not.toHaveProperty("html");
    expect(tile.lines).toEqual(["a", "b", "c"]);
    expect(tile.actions).toEqual([{ label: "继续播放", path: "/player?chapter=12" }]);
    expect(tile.refreshSeconds).toBe(60);
    expect(tile.sizes).toEqual(["m", "w"]);
    expect(readServiceTile({ progress: { value: 7 } })!.progress).toEqual({ value: 1 });
    expect(readServiceTile({ title: "x".repeat(61) })).toBeNull();
    expect(readServiceTile({ title: "a\u0007b", badge: "toolongbadge!" })).toBeNull();
    expect(readServiceTile({ image: "https://evil.example/a.png", title: "t" })).toEqual({ title: "t" });
    expect(readServiceTile("nope")).toBeNull();
  });

  it("the answer: error and source kept, the template sanitised", () => {
    expect(readServiceTileAnswer({ tile: full, fetchedAt: "2026-10-20T00:00:00Z", error: null, source: "service" })).toMatchObject({ tile: { title: "第 12 章" }, source: "service", error: null });
    expect(readServiceTileAnswer({ tile: null, error: { code: "service_stopped", message: "stopped" }, source: "nonsense" })).toEqual({ tile: null, fetchedAt: null, error: { code: "service_stopped", message: "stopped" }, source: null });
  });

  it("sizes: s = icon only, m = title + one line, w = + image / progress / three lines, l = + actions", () => {
    expect(tileParts(full, "s", "audiobook")).toBeNull();
    expect(tileParts(full, "m", "audiobook")).toMatchObject({ title: "第 12 章", subtitle: "《三体》", lines: [], image: false, progress: null, actions: [] });
    expect(tileParts(full, "w", "audiobook")).toMatchObject({ lines: ["a", "b", "c"], image: true, progress: { value: 0.38, label: "14:06 / 37:12" }, badge: "1.25×", actions: [] });
    expect(tileParts(full, "l", "audiobook")!.actions).toEqual([{ label: "继续播放", link: "cutex:service/audiobook/player?chapter=12" }]);
    // Re-checked in the renderer too: a template that skipped main's check still draws no bad link.
    expect(tileParts({ title: "t", actions: [{ label: "x", path: "javascript:alert(1)" }] }, "l", "audiobook")!.actions).toEqual([]);
    expect(tileParts(null, "w", "audiobook")).toBeNull();
  });

  it("refresh: the template's refreshSeconds, 5 minutes by default", () => {
    expect(tileRefreshMs({ refreshSeconds: 120 })).toBe(120_000);
    expect(tileRefreshMs(null)).toBe(300_000);
  });
});
