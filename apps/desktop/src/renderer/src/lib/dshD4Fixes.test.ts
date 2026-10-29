// r265 D4: desktop items left open by the real-daemon E2E (shots/r265-e2e/RESULTS.md D-5..D-8).
import { afterEach, describe, expect, it } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { plainPreview, previewFromResource, previewLine } from "./activity";
import { applyMark, markReverted, parseMarks, previewOfKept, putMark, resetRevertMarks } from "./revertedPreview";
import type { TimelineEntry, TurnView } from "./timeline";
import { agentFeaturesOf, lacks } from "./agentFeatures";
import { readDshContext } from "./dshContext";
import { offlineAutoStartNote } from "./runtimeWording";
import { en, zhCN } from "./profileVariantMessages";

const dsh = (features: Record<string, unknown> | undefined) => agentFeaturesOf({ native: { schema: { protocol: "dsh-acp-subset", capabilities: { features } } } });

describe("D-7 「计费数据不可用」 follows the runtime's billingUsage", () => {
  it("shows only when the runtime says billing is unavailable", () => {
    expect(lacks(dsh({ billingUsage: false }), "billingUsage")).toBe(true);
    expect(lacks(dsh({ billingUsage: true }), "billingUsage")).toBe(false);
    // Unknown (no schema yet / an older map without the field): no claim either way, no hint.
    expect(lacks(dsh(undefined), "billingUsage")).toBe(false);
    expect(lacks(agentFeaturesOf({ launchBinding: { runtime: "dsh" } }), "billingUsage")).toBe(false);
    expect(lacks(agentFeaturesOf(null), "billingUsage")).toBe(false);
  });
  it("cutex r265: billingUsage true with dshContext.billing \"unavailable\" shows the meter and no hint", () => {
    const features = dsh({ turnSteer: false, threadFork: true, threadRevert: true, threadDelete: true, contextOccupancy: true, billingUsage: true, textInputOnly: false, imageInput: true });
    expect(lacks(features, "billingUsage")).toBe(false);
    expect(lacks(features, "contextOccupancy")).toBe(false);
    const ctx = readDshContext({ used: 24_000, size: 1_000_000, observedAt: "2026-10-27T00:00:00Z", source: "acp", billing: "unavailable" });
    expect(ctx).toMatchObject({ used: 24_000, size: 1_000_000, billing: "unavailable" });
  });
  it("keeps reading ACP occupancy whatever the billing note says", () => {
    const base = { used: 10, size: 100, observedAt: "2026-10-27T00:00:00Z", source: "acp" };
    expect(readDshContext({ ...base, billing: "unavailable" })?.billing).toBe("unavailable");
    expect(readDshContext({ ...base, billing: "reported" })).toEqual({ ...base, billing: "reported" });
    expect(readDshContext(base)).toEqual(base);
    expect(readDshContext({ ...base, billing: 0 })).toBeNull();
  });
});

describe("D-8 the offline line names the agent's runtime", () => {
  it("keeps app-server for cute-codex only", () => {
    expect(offlineAutoStartNote("codex")).toEqual({ key: "conversation.offlineAutoStart" });
    expect(offlineAutoStartNote("dsh")).toEqual({ key: "conversation.offlineAutoStartRuntime", vars: { runtime: "DSH" } });
    expect(offlineAutoStartNote("claude")).toEqual({ key: "conversation.offlineAutoStartRuntime", vars: { runtime: "Claude" } });
  });
  it("the runtime wording does not mention app-server", () => {
    for (const text of [zhCN["conversation.offlineAutoStartRuntime"], en["conversation.offlineAutoStartRuntime"]]) {
      expect(text).toContain("{runtime}");
      expect(text).not.toMatch(/app-server/);
    }
  });
});

describe("D-6 the sidebar line after 回退", () => {
  afterEach(() => resetRevertMarks());
  const turn = (id: string, entryIds: string[]): TurnView => ({ id, status: "completed", startedAt: null, completedAt: null, entryIds });
  const entries = new Map<string, TimelineEntry>([
    ["u1", { kind: "user", id: "u1", turnId: "t1", text: "first question" }],
    ["a1", { kind: "agent", id: "a1", turnId: "t1", text: "**first** reply", streaming: false }],
    ["u2", { kind: "user", id: "u2", turnId: "t2", text: "second question" }],
    ["a2", { kind: "agent", id: "a2", turnId: "t2", text: "ok-pro", streaming: false }],
    ["u3", { kind: "user", id: "u3", turnId: "t3", text: "only asked" }],
  ]);
  const timeline = { turns: [turn("t1", ["u1", "a1"]), turn("t2", ["u2", "a2"]), turn("t3", ["u3"])], entries };
  const resource = (output: string, at: string, tool?: { text: string; at: string }) => ({ cutexSessionId: "s1", activity: { lastOutput: { displayText: output, updatedAt: at }, ...(tool ? { lastToolCall: { displayText: tool.text, updatedAt: tool.at } } : {}) } }) as unknown as SessionResource;

  it("takes the last message of the turns that stay", () => {
    expect(previewOfKept(timeline, "t2", 5, plainPreview)).toEqual({ kind: "output", text: "first reply", at: 5 });
    expect(previewOfKept(timeline, "t3", 5)).toEqual({ kind: "output", text: "ok-pro", at: 5 });
    // Nothing before the first turn; a turn not loaded: unknown → empty (the row shows its status).
    expect(previewOfKept(timeline, "t1", 5)).toEqual({ kind: "output", text: "", at: 5 });
    expect(previewOfKept(timeline, "older", 5)).toEqual({ kind: "output", text: "", at: 5 });
    const askedOnly = { turns: [turn("t3", ["u3"]), turn("t4", [])], entries };
    expect(previewOfKept(askedOnly, "t4", 5)).toEqual({ kind: "input", text: "only asked", at: 5 });
  });

  it("the projection's removed reply gives way to the kept message; a newer reply shows again", () => {
    const before = Date.parse("2026-10-27T08:00:00Z");
    expect(previewFromResource(resource("ok-pro", "2026-10-27T08:00:00Z"))?.text).toBe("ok-pro");
    markReverted("s1", { hideUpTo: before, replacement: { kind: "output", text: "first reply", at: before } });
    expect(previewLine(previewFromResource(resource("ok-pro", "2026-10-27T08:00:00Z")), false)?.text).toBe("first reply");
    // The next reply after the revert.
    expect(previewFromResource(resource("new answer", "2026-10-27T08:05:00Z"))?.text).toBe("new answer");
    // A running step after the revert keeps the kept message under it; a removed step goes.
    const running = previewFromResource(resource("ok-pro", "2026-10-27T08:00:00Z", { text: "$ ls", at: "2026-10-27T08:06:00Z" }));
    expect(running?.kind).toBe("tool");
    expect(previewLine(running, false)?.text).toBe("first reply");
    expect(previewFromResource(resource("ok-pro", "2026-10-27T07:59:00Z", { text: "$ ls", at: "2026-10-27T08:00:00Z" }))?.text).toBe("first reply");
    // Another agent is untouched.
    expect(previewFromResource({ ...resource("ok-pro", "2026-10-27T08:00:00Z"), cutexSessionId: "s2" } as SessionResource)?.text).toBe("ok-pro");
  });

  it("nothing kept: the row shows no stale line", () => {
    const out = applyMark({ kind: "output", text: "ok-pro", at: 10 }, null, { hideUpTo: 10, replacement: { kind: "output", text: "", at: 10 } });
    expect(out.said).toBeNull();
    expect(previewLine(out.fallback, false)).toBeNull();
  });

  it("marks are capped and survive a malformed store", () => {
    let marks = new Map();
    for (let i = 0; i < 5; i++) marks = putMark(marks, `s${i}`, { hideUpTo: i, replacement: { kind: "output", text: "", at: i } }, 3);
    expect([...marks.keys()]).toEqual(["s2", "s3", "s4"]);
    expect([...parseMarks([...marks]).keys()]).toEqual(["s2", "s3", "s4"]);
    expect(parseMarks([["x", { hideUpTo: "no" }], ["y", { hideUpTo: 1, replacement: { kind: "tool", text: "", at: 1 } }], "junk"]).size).toBe(0);
    expect(parseMarks("{}").size).toBe(0);
  });
});
