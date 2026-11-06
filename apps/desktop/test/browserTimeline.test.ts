import { describe, expect, it } from "vitest";
import type { RawItem } from "../src/renderer/src/lib/timeline";
import { BROWSER_IMAGE_BASE64_LIMIT, BROWSER_TIMELINE_TOOLS, browserLoadedToolItem, browserShotStandalone, browserTimelineDataImage,
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

describe("a screenshot is its own row (owner 2026-10-24: no tall row folding into a work group line)", () => {
  it("a call with a screenshot (shown or to load) is standalone; a running or picture-less call folds", () => {
    expect(browserShotStandalone(mcp())).toBe(true);
    expect(browserShotStandalone(dynamic())).toBe(true);
    expect(browserShotStandalone(lazy())).toBe(true);
    expect(browserShotStandalone(mcp({ status: "inProgress", result: null }))).toBe(false);
    expect(browserShotStandalone(mcp({ tool: "browser_act", arguments: { title: "Click", action: { kind: "click" } }, result: { content: [] } }))).toBe(false);
  });
});

describe("browser timeline safe summaries", () => {
  it("matches exactly the nine tools from supported runtime identities", () => {
    for (const name of BROWSER_TIMELINE_TOOLS) {
      expect(browserToolName(mcp({ tool: name }))).toBe(name);
      expect(browserToolName(dynamic({ tool: name }))).toBe(name);
    }
    for (const wrong of [mcp({ server: "other" }), dynamic({ namespace: "shell" }), mcp({ tool: "browser_evaluate" }), mcp({ type: "commandExecution" })])
      expect(browserToolView(wrong)).toBeNull();
  });
  it("the one-tool surface (cutex design 059) shows each command as its own row, with the same safety", () => {
    const command = (args: Record<string, unknown>, extra: Partial<RawItem> = {}) => mcp({ tool: "browser", arguments: args, result: { content: [] }, ...extra });
    expect(browserToolName(command({ command: "open", args: { title: "Open", url: "https://example.com/" } }))).toBe("browser_open");
    expect(browserToolName(command({ command: "docs" }))).toBe("browser_docs");
    expect(browserToolName(command({ command: "status", args: { requestId: "browser-1" } }))).toBe("browser_status");
    expect(browserToolName(dynamic({ tool: "browser", arguments: JSON.stringify({ command: "visit", args: { title: "Books" } }) }))).toBe("browser_visit");
    for (const wrong of [{ command: "evaluate" }, { command: 1 }, {}]) expect(browserToolView(command(wrong))).toBeNull();
    expect(browserToolView(command({ command: "read" }, { server: "other" }))).toBeNull();
    const secret = "never-show-this-OTP";
    const view = browserToolView(command({ command: "act", args: { title: `Fill ${secret}`, guestId: "g", action: { kind: "fill", ref: "r1", text: secret } } }));
    expect(view?.summary).toBe("browser.timeline.fill");
    expect(view?.title).not.toContain(secret);
    expect(browserToolView(command({ command: "screenshot", args: { title: "Look", guestId: "g" } }, { result: { content: [image] } }))?.imageState).toBe("ready");
    expect(browserToolView(command({ command: "visit", args: { title: "Books", guestId: "g" } }))?.summary).toBe("browser.timeline.visit");
    const failed = browserToolView(command({ command: "read", args: { title: "Read", guestId: "g" } },
      { result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code: "outcome_unknown", requestId: "browser-1" } }) }] } }));
    expect(failed?.state).toBe("failed"); expect(failed?.errorCode).toBe("outcome_unknown");
  });
  it("browser scripts (cutex design 059) show the call title, never the code", () => {
    const code = "await tab.fill('r1', 'never-show-this-OTP')";
    const view = browserToolView(mcp({ tool: "browser_script", arguments: { title: "Sign in", code }, result: { content: [{ type: "text", text: JSON.stringify({ ok: true, output: "" }) }] } }));
    expect(view?.summary).toBe("browser.timeline.script"); expect(view?.title).toBe("Sign in"); expect(view?.state).toBe("done");
    expect(JSON.stringify(view)).not.toContain("never-show-this-OTP");
    expect(browserToolView(mcp({ tool: "browser_script_reset", arguments: {}, result: { content: [] } }))?.summary).toBe("browser.timeline.script_reset");
    const timedOut = browserToolView(mcp({ tool: "browser_script", arguments: { title: "Slow", code }, result: { isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: { code: "script_runtime_unavailable" } }) }] } }));
    expect(timedOut?.state).toBe("failed"); expect(timedOut?.errorCode).toBe("script_runtime_unavailable");
    const steps = browserToolView(mcp({ tool: "browser_script", arguments: { title: "Shop", code }, result: { content: [{ type: "text", text: JSON.stringify({ ok: true, output: "",
      steps: [{ step: 1, command: "open", ok: true, requestId: "browser-x" }, { step: 2, command: "act", kind: "fill", ok: true }, { step: 3, command: "act", kind: "evaluate", ok: true },
        { step: 4, command: "read", ok: false, error: "agent_paused" }, { step: 5, command: "script", ok: true }, { command: "<b>x</b>" }, "raw"] }) }] } }));
    expect(steps?.steps).toEqual([{ summary: "browser.timeline.open", ok: true, errorCode: null }, { summary: "browser.timeline.fill", ok: true, errorCode: null },
      { summary: "browser.timeline.act", ok: true, errorCode: null }, { summary: "browser.timeline.read", ok: false, errorCode: "agent_paused" }]);
    expect(browserToolView(mcp({ tool: "browser_read", arguments: { title: "R" }, result: { content: [{ type: "text", text: JSON.stringify({ steps: [{ command: "open", ok: true }] }) }] } }))?.steps).toEqual([]);
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
    expect(browserToolView(mcp())).toMatchObject({ image: { kind: "url", url: src }, imageState: "ready" });
    expect(browserToolView(dynamic())).toMatchObject({ image: { kind: "url", url: src }, imageState: "ready" });
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
  const hash = "a".repeat(64);
  const blob = { type: "cutexBlob", blobId: hash, sha256: hash, mime: "image/png", size: 8 * 1024 * 1024, url: `cutex-blob:cutex.remote/${hash}` };
  const referenced = (value: unknown = blob) => mcp({ result: { content: [{ type: "image", mimeType: "image/png", data: value }] } });
  it("accepts authenticated MCP and dynamic screenshot references beyond the old inline budget", () => {
    const expected = { image: { kind: "blob", blob }, imageState: "ready" };
    expect(browserToolView(referenced())).toMatchObject(expected);
    expect(browserToolView(dynamic({ contentItems: [{ type: "inputImage", imageUrl: blob }] }))).toMatchObject(expected);
    expect(browserShotStandalone(referenced())).toBe(true);
    expect(browserLoadedToolItem({ item: referenced() }, lazy())).toEqual(referenced());
  });
  it("retains complete references even when unrelated tool text was compacted", () => {
    expect(browserToolView({ ...referenced(), truncated: true })).toMatchObject({ image: { kind: "blob", blob }, imageState: "ready" });
  });
  it("rejects forged, oversized, mismatched and non-browser media descriptors", () => {
    for (const invalid of [
      { ...blob, url: "https://example.invalid/image?token=private" }, { ...blob, url: `cutex-media:cutex.remote/${hash}` }, { ...blob, sha256: "b".repeat(64) },
      { ...blob, size: 32 * 1024 * 1024 + 1 }, { ...blob, mime: "image/svg+xml" },
      { ...blob, mime: "audio/wav" }, { ...blob, blobId: "../secret" },
    ]) expect(browserToolView(referenced(invalid))).toMatchObject({ image: null, imageState: "invalid" });
    expect(browserToolView(mcp({ result: { content: [{ type: "image", mimeType: "image/jpeg", data: blob }] } })))
      .toMatchObject({ image: null, imageState: "invalid" });
    expect(browserToolView(mcp({ result: { content: [image, { type: "inputImage", imageUrl: blob }] } })))
      .toMatchObject({ image: null, imageState: "invalid" });
  });
  it("shows unavailable markers without echoing reasons or offering a futile full-item reload", () => {
    const unavailable = { type: "imageNotLoaded", reason: "never-show-this-OTP", size: 99 };
    for (const item of [referenced(unavailable), dynamic({ contentItems: [{ type: "inputImage", imageUrl: unavailable }] }), mcp({ result: { content: [unavailable] } })]) {
      const view = browserToolView(item);
      expect(view).toMatchObject({ image: { kind: "unavailable" }, imageState: "unavailable" });
      expect(JSON.stringify(view)).not.toContain("never-show-this-OTP");
      expect(browserShotStandalone(item)).toBe(true);
      expect(browserLoadedToolItem({ item }, lazy())).toBeNull();
    }
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
