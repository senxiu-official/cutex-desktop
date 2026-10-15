import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "@cutex-desktop/protocol";
import { nextPreview, type ActivityPreview } from "../src/renderer/src/lib/activity";

function ev(method: string, params: unknown): EventEnvelope {
  return {
    contractVersion: 2, eventId: "e", cursor: "c", streamId: "s", sequence: 1, receivedAt: "2026-10-06T00:00:00Z",
    cutexSessionId: "a", hostId: "h", source: "app_server", sensitivity: "owner", correlation: {},
    native: { kind: "notification", message: { method, params } },
  };
}

describe("activity preview", () => {
  it("shows the concrete tool action, then the start of the next output", () => {
    let p: ActivityPreview | undefined = nextPreview(undefined, ev("item/started", { item: { type: "commandExecution", id: "1", command: "pnpm test" } }));
    expect(p).toMatchObject({ kind: "tool", text: "$ pnpm test" });
    for (const delta of ["All ", "tests\n", "passed."]) p = nextPreview(p, ev("item/agentMessage/delta", { itemId: "m1", delta })) ?? p;
    expect(p).toMatchObject({ kind: "output", text: "All tests passed." });
  });

  it("ignores events that do not change the preview", () => {
    expect(nextPreview(undefined, ev("thread/tokenUsage/updated", {}))).toBeUndefined();
    expect(nextPreview(undefined, ev("thread/prediction/updated", { threadId: "t", requestId: "p" }))).toBeUndefined();
    expect(nextPreview(undefined, ev("item/started", { item: { type: "agentMessage", id: "x" } }))).toBeUndefined();
  });
});
