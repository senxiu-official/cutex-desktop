import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (...parts: string[]) => readFileSync(join(__dirname, "../src/renderer/src", ...parts), "utf8");

describe("turn diff opening (2026-10-28 perf report C)", () => {
  it("a single conversation keeps the column fiber it uses beside a Shelf", () => {
    const paneHost = src("components/PaneHost.tsx");
    expect(paneHost).toContain("if (framed || (selectedId && !columnPage)) body = <ConversationColumns");
    expect(paneHost).toContain("single={!framed}");
    expect(paneHost).toContain("{framed || columnPage || selectedId ? body : <MainOutlet>");
  });

  it("the timeline receives stable callbacks from Conversation", () => {
    const conversation = src("components/Conversation.tsx");
    expect(conversation).toContain("<MemoTimelineBody ");
    expect(conversation).toContain("onLoadOlder={loadOlderFor}");
    expect(conversation).toContain("onRelease={release}");
    expect(conversation).not.toContain("onLoadOlder={() =>");
  });
});
