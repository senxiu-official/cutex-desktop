// Profile-generator (host02, 2026-10-23): every finished generated image reached the renderer as a
// 2–6 MB base64 `result` in item/completed, twice (host feed + the open agent's feed), although the
// timeline shows nothing of it. Main drops the payload before the event crosses IPC.
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { LIVE_IMAGE_INLINE_MAX, withoutLiveImages } from "../src/main/eventMedia";

const PNG = "iVBORw0KGgoAAAANSUhEUgAABLEAAAUdCAYAAAAHFtF1" + "A".repeat(3 * 1024 * 1024);

function envelope(method: string, params: Record<string, unknown>): EventEnvelope {
  return {
    contractVersion: 2,
    eventId: "e1",
    cursor: "c2:1",
    streamId: "s",
    sequence: 1,
    receivedAt: "2026-10-23T09:31:17.807Z",
    cutexSessionId: "cutex.01a15e45",
    hostId: "host02",
    source: "app_server",
    sensitivity: "owner",
    correlation: { runtimeGeneration: 5, threadId: "t", turnId: "turn-1", itemId: "exec-1" },
    native: { kind: "notification", message: { method, params } },
  } as unknown as EventEnvelope;
}

const generated = (result: string) => ({
  type: "imageGeneration",
  id: "exec-1",
  status: "completed",
  revisedPrompt: "Create ONE standalone anime character pose reference",
  result,
  transparentBackground: true,
  failure: null,
  savedPath: "C:\\Users\\o\\.cutex\\runtime\\light\\agents\\a\\generated_images\\a\\exec-1.png",
});

describe("live generated images stay out of the renderer", () => {
  it("item/completed keeps the item but not its image bytes", () => {
    const event = envelope("item/completed", { threadId: "t", turnId: "turn-1", completedAtMs: 1, item: generated(PNG) });
    const light = withoutLiveImages(event);
    const item = (light.native!.message.params as { item: Record<string, unknown> }).item;
    expect(item.result).toBe("");
    expect(item.resultOmittedBytes).toBe(PNG.length);
    expect(item).toMatchObject({ type: "imageGeneration", id: "exec-1", status: "completed", savedPath: generated("").savedPath, revisedPrompt: generated("").revisedPrompt });
    expect(light.native!.message.params).toMatchObject({ threadId: "t", turnId: "turn-1", completedAtMs: 1 });
    expect(light).toMatchObject({ cursor: "c2:1", cutexSessionId: "cutex.01a15e45", correlation: { itemId: "exec-1" } });
    expect(JSON.stringify(light).length).toBeLessThan(2000);
    // The parsed event is not mutated (the feed may still hold it).
    expect((event.native!.message.params as { item: { result: string } }).item.result).toBe(PNG);
  });

  it("a finished turn's items lose their image bytes too", () => {
    const event = envelope("turn/completed", { threadId: "t", turn: { id: "turn-1", status: "completed", items: [{ type: "agentMessage", id: "a", text: "done" }, generated(PNG)] } });
    const turn = (withoutLiveImages(event).native!.message.params as { turn: { id: string; items: Record<string, unknown>[] } }).turn;
    expect(turn.id).toBe("turn-1");
    expect(turn.items[0]).toEqual({ type: "agentMessage", id: "a", text: "done" });
    expect(turn.items[1]!.result).toBe("");
  });

  it("anything else is passed through as the same object", () => {
    const small = envelope("item/completed", { item: generated("c21hbGw=".repeat(10)) });
    const atLimit = envelope("item/completed", { item: generated("A".repeat(LIVE_IMAGE_INLINE_MAX)) });
    const reference = envelope("item/completed", { item: generated("cutex-media:cutex.x/" + "a".repeat(64)) });
    const command = envelope("item/completed", { item: { type: "commandExecution", id: "c", aggregatedOutput: "x".repeat(LIVE_IMAGE_INLINE_MAX * 2) } });
    // A browser screenshot in tool output is shown (modules/browser): never touched.
    const screenshot = envelope("item/completed", { item: { type: "mcpToolCall", id: "m", result: { content: [{ type: "image", mimeType: "image/png", data: PNG }] } } });
    const started = envelope("turn/started", { turn: { id: "turn-2", status: "inProgress", items: [] } });
    const cutexEvent = { ...envelope("x", {}), native: undefined, cutex: { method: "cutex/queue/changed", params: {} } } as unknown as EventEnvelope;
    for (const event of [small, atLimit, reference, command, screenshot, started, cutexEvent]) expect(withoutLiveImages(event)).toBe(event);
  });
});
