import { describe, expect, it } from "vitest";
import type { RawItem } from "../src/renderer/src/lib/timeline";
import { BROWSER_IMAGE_BASE64_LIMIT, BROWSER_TIMELINE_TOOLS, browserLoadedToolItem, browserTimelineDataImage,
  browserTimelineEn, browserTimelineImage, browserTimelineZhCN, browserToolName, browserToolView, browserTurnShots,
} from "../src/renderer/src/modules/browser/browserTimeline";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvN8AAAAASUVORK5CYII=";
const image = { type: "image", mimeType: "image/png", data: PNG };
const src = `data:image/png;base64,${PNG}`;
const mcp = (extra: Partial<RawItem> = {}): RawItem => ({ id: "item-1", type: "mcpToolCall", server: "cutex", tool: "browser_screenshot",
  status: "completed", arguments: { title: "Check the page", guestId: "g" }, result: { content: [image] }, ...extra });
const dynamic = (extra: Partial<RawItem> = {}): RawItem => ({ id: "item-1", type: "dynamicToolCall", namespace: "claude", tool: "browser_screenshot",
  status: "completed", arguments: JSON.stringify({ title: "Check the page" }), contentItems: [{ type: "inputImage", imageUrl: src }], ...extra });
const lazy = () => mcp({ truncated: true, result: { content: [{ type: "imageNotLoaded", fullItemRequired: true, mimeType: "image/png" }] } });

describe("browser timeline safe summaries", () => {
  it("matches exactly the nine tools from supported runtime identities", () => {
    for (const name of BROWSER_TIMELINE_TOOLS) {
      expect(browserToolName(mcp({ tool: name }))).toBe(name);
      expect(browserToolName(dynamic({ tool: name }))).toBe(name);
    }
    for (const wrong of [mcp({ server: "other" }), dynamic({ namespace: "shell" }), mcp({ tool: "browser_evaluate" }), mcp({ type: "commandExecution" })])
      expect(browserToolView(wrong)).toBeNull();
  });
  it("never projects fill text, argument JSON, raw errors or page text", () => {
    const secret = "never-show-this-OTP", title = `Fill ${secret}`;
    const view = browserToolView(mcp({ tool: "browser_act", arguments: { title, action: { kind: "fill", ref: "r1", text: secret } },
      error: { message: secret }, result: { content: [{ type: "text", text: secret }] } }));
    expect(view?.summary).toBe("browser.timeline.fill");
    expect(view?.state).toBe("failed");
    expect(view?.title).toBe("Fill …");
    expect(JSON.stringify(view)).not.toContain(secret);
  });
  it("action summaries are a finite vocabulary with no refs, URLs, options or prompt values", () => {
    for (const kind of ["click", "fill", "press", "scroll", "scrollIntoView", "select", "check", "uncheck", "hover", "wait", "back", "forward", "reload", "dialog"]) {
      const view = browserToolView(mcp({ tool: "browser_act", arguments: { title: "Action", action: { kind, text: "secret", promptText: "secret", values: ["secret"], ref: "secret" } } }));
      expect(view?.summary).toBe(`browser.timeline.${kind}`);
      expect(JSON.stringify(view)).not.toContain("secret");
    }
    expect(browserToolView(mcp({ tool: "browser_act", arguments: { action: { kind: "evaluate" } } }))?.summary).toBe("browser.timeline.act");
  });
  it("bounds Unicode titles and safely ignores malformed or huge argument text", () => {
    expect([...browserToolView(mcp({ arguments: { title: "🙂".repeat(220) + "\u0085" } }))!.title]).toHaveLength(200);
    expect(browserToolView(mcp({ arguments: "{" }))?.title).toBe("");
    expect(browserToolView(mcp({ arguments: " ".repeat(256 * 1024 + 1) }))?.title).toBe("");
  });
  it("displays only stable diagnostic codes and distinguishes delivery from business success", () => {
    const error = (code: string) => mcp({ result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message: "private" } }) }] } });
    expect(browserToolView(error("outcome_unknown"))?.errorCode).toBe("outcome_unknown");
    expect(browserToolView(error("private_token_value"))?.errorCode).toBeNull();
    expect(browserToolView(error("approval_required"))?.state).toBe("failed");
    expect(browserToolView(mcp({ status: "inProgress" }))?.state).toBe("running");
    expect(browserToolView(dynamic({ success: false }))?.state).toBe("failed");
    expect(browserTimelineEn["browser.timeline.done"]).toBe("Browser operation returned");
  });
  it("keeps both locales complete", () => expect(Object.keys(browserTimelineZhCN).sort()).toEqual(Object.keys(browserTimelineEn).sort()));
});

describe("browser tool screenshots", () => {
  it("preserves bounded actual MCP and dynamic images inline", () => {
    expect(browserToolView(mcp())).toMatchObject({ image: src, imageState: "ready" });
    expect(browserToolView(dynamic())).toMatchObject({ image: src, imageState: "ready" });
    expect(browserTimelineDataImage(src)).toBe(src);
  });
  it("never requests external, local or SVG URLs", () => {
    for (const bad of ["https://example.invalid/a.png?token=secret", "file:///secret.png", "blob:bad", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,broken"])
      expect(browserTimelineDataImage(bad)).toBeNull();
    expect(browserTimelineImage("image/svg+xml", PNG)).toBeNull();
  });
  it("requires base64 framing and the same maximum size as the wire budget", () => {
    for (const bad of ["", PNG + "=", PNG.slice(0, -1), "abcd=====", "!".repeat(12), "AAAA".repeat(BROWSER_IMAGE_BASE64_LIMIT / 4 + 1)])
      expect(browserTimelineImage("image/png", bad)).toBeNull();
    // Large valid framing must not recurse/overflow the JS regexp engine.
    expect(browserTimelineImage("image/png", "iVBORw0KGgoA" + "A".repeat(BROWSER_IMAGE_BASE64_LIMIT - 12))).not.toBeNull();
  });
  it("compact history is a lazy marker, never a broken base64 prefix", () => {
    expect(browserToolView(lazy())).toMatchObject({ image: null, imageState: "not-loaded" });
    expect(browserToolView(mcp({ truncated: true }))).toMatchObject({ image: null, imageState: "not-loaded" });
    expect(browserToolView(mcp({ result: { content: [image, image] } }))).toMatchObject({ image: null, imageState: "invalid" });
    expect(browserToolView(mcp({ result: { content: Array(9).fill({ type: "text", text: "" }) } })))
      .toMatchObject({ image: null, imageState: "invalid" });
  });
  it("full-item replacement requires the exact item, runtime/tool identity and complete image", () => {
    expect(browserLoadedToolItem({ item: mcp() }, lazy())).toEqual(mcp());
    for (const item of [mcp({ id: "other" }), mcp({ tool: "browser_read" }), mcp({ server: "other" }), dynamic(), lazy(), mcp({ result: { content: [] } })])
      expect(browserLoadedToolItem({ item }, lazy())).toBeNull();
  });
});

describe("owner-only turn screenshot metadata", () => {
  const shot = { id: "shot-1", turnId: "turn-1", createdAt: "2026-10-11T10:00:00Z", width: 1280, height: 720, mimeType: "image/png" };
  it("accepts exact-turn bounded metadata and discards unrelated payload fields", () => {
    expect(browserTurnShots([{ ...shot, path: "private", data: "private" }], "turn-1")).toEqual([shot]);
    expect(browserTurnShots([], "turn-1")).toEqual([]);
  });
  it("rejects cross-turn, duplicate, invalid, unbounded or nonimage metadata", () => {
    for (const field of [{ turnId: "other" }, { id: "../secret" }, { width: 1601 }, { height: 0 }, { width: 1.2 }, { mimeType: "image/svg+xml" }, { createdAt: "bad" }])
      expect(browserTurnShots([{ ...shot, ...field }], "turn-1")).toBeNull();
    expect(browserTurnShots([shot, shot], "turn-1")).toBeNull();
    expect(browserTurnShots(Array.from({ length: 257 }, (_, index) => ({ ...shot, id: `shot-${index}` })), "turn-1")).toBeNull();
    expect(browserTurnShots({}, "turn-1")).toBeNull();
  });
});
