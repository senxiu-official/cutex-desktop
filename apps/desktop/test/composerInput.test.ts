import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "../src/shared/ipc";
import { dataUrlBytes, imageInputItems, messageImages, sanitizeExtraInput } from "../src/shared/input";
import { newPendingSteer, reconcilePendingSteers } from "../src/renderer/src/lib/pendingSteers";
import { applyEvent, emptyTimeline, entryFromItem, timelineFromThreadRead } from "../src/renderer/src/lib/timeline";
import { lastAssistantText, timelineToMarkdown } from "../src/renderer/src/lib/transcript";

const png = "data:image/png;base64,iVBORw0KGgo=";

describe("image input items", () => {
  it("builds image / localImage items from draft images", () => {
    expect(
      imageInputItems([
        { id: "1", name: "a", preview: png, source: { kind: "data", url: png } },
        { id: "2", name: "b.png", preview: null, source: { kind: "path", path: "C:\\b.png" } },
      ]),
    ).toEqual([{ type: "image", url: png }, { type: "localImage", path: "C:\\b.png" }]);
  });
  it("sanitizes what main forwards", () => {
    const big = `data:image/png;base64,${"A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8)}`;
    expect(dataUrlBytes(png)).toBe(8);
    expect(
      sanitizeExtraInput([
        { type: "image", url: png },
        { type: "image", url: "https://evil/x.png" },
        { type: "image", url: big },
        { type: "localImage", path: "/tmp/x.png", extra: 1 },
        { type: "skill", name: "pdf", path: "/s/pdf" },
        { type: "text", text: "sneaky" },
        null,
      ]),
    ).toEqual([{ type: "image", url: png }, { type: "localImage", path: "/tmp/x.png" }, { type: "skill", name: "pdf", path: "/s/pdf" }]);
  });
  it("renders user-message images separately from the text", () => {
    const e = entryFromItem({ type: "userMessage", id: "u", content: [{ type: "text", text: "look" }, { type: "image", url: png }, { type: "localImage", path: "/p.png" }] }, "t");
    expect(e).toMatchObject({ kind: "user", text: "look", images: [{ kind: "url", url: png }, { kind: "path", path: "/p.png" }] });
    expect(messageImages([{ type: "text" }])).toEqual([]);
  });
});

function runningTimeline() {
  return timelineFromThreadRead({ thread: { id: "th", turns: [{ id: "t1", status: "inProgress", items: [{ type: "userMessage", id: "u1", content: [{ type: "text", text: "start" }] }] }] } });
}
const userItem = (id: string, text: string, turnId = "t1") => ({ source: "app_server", native: { kind: "notification", message: { method: "item/completed", params: { turnId, item: { type: "userMessage", id, content: [{ type: "text", text }] } } } } }) as never;

describe("pending steers", () => {
  it("stays until the matching userMessage arrives in its turn", () => {
    const tl = runningTimeline();
    let pending = [newPendingSteer(tl, "c1", "also check tests", 0, null)];
    expect(pending[0]!.turnId).toBe("t1");
    expect(reconcilePendingSteers(pending, tl)).toBe(pending);
    applyEvent(tl, userItem("u2", "something else"));
    pending = reconcilePendingSteers(pending, tl);
    expect(pending).toHaveLength(1);
    applyEvent(tl, userItem("u3", "also  check tests"));
    expect(reconcilePendingSteers(pending, tl)).toEqual([]);
  });
  it("one recorded item clears one bubble; an older identical message doesn't count", () => {
    const tl = runningTimeline();
    applyEvent(tl, userItem("u2", "go"));
    const a = newPendingSteer(tl, "a", "go", 0, "t1");
    const b = newPendingSteer(tl, "b", "go", 0, "t1");
    expect(a.baseline).toBe(1);
    expect(reconcilePendingSteers([a, b], tl)).toHaveLength(2);
    applyEvent(tl, userItem("u3", "go"));
    expect(reconcilePendingSteers([a, b], tl).map((p) => p.id)).toEqual(["b"]);
  });
  it("takes steers out of waiting when their turn ends (store re-checks them)", () => {
    const tl = runningTimeline();
    const pending = [newPendingSteer(tl, "c", "x", 1, "t1")];
    applyEvent(tl, { source: "app_server", native: { kind: "notification", message: { method: "turn/completed", params: { turn: { id: "t1", status: "interrupted" } } } } } as never);
    expect(reconcilePendingSteers(pending, tl).map((p) => p.state)).toEqual(["checking"]);
    const idle = emptyTimeline();
    expect(reconcilePendingSteers([newPendingSteer(idle, "d", "y", 0, null)], idle).map((p) => p.state)).toEqual(["checking"]);
  });
});

describe("goal and review in the timeline", () => {
  it("tracks thread/goal/updated and cleared", () => {
    const tl = runningTimeline();
    const goal = { threadId: "th", objective: "ship", status: "active", tokenBudget: null, tokensUsed: 1, timeUsedSeconds: 2, createdAt: 0, updatedAt: 0 };
    expect(applyEvent(tl, { source: "app_server", native: { kind: "notification", message: { method: "thread/goal/updated", params: { threadId: "th", turnId: null, goal } } } } as never)).toBe(true);
    expect(tl.goal?.objective).toBe("ship");
    applyEvent(tl, { source: "app_server", native: { kind: "notification", message: { method: "thread/goal/cleared", params: { threadId: "th" } } } } as never);
    expect(tl.goal).toBeNull();
  });
  it("turns review items into review entries; copy / export use them", () => {
    const entered = entryFromItem({ type: "enteredReviewMode", id: "r1", review: "current changes" }, "t");
    const exited = entryFromItem({ type: "exitedReviewMode", id: "r2", review: "- [P1] bug" }, "t");
    expect(entered).toEqual({ kind: "review", id: "r1", turnId: "t", phase: "entered", text: "current changes" });
    expect(lastAssistantText([entered, exited])).toBe("- [P1] bug");
    const md = timelineToMarkdown("Eva", [{ kind: "user", id: "u", text: "hi", turnId: "t" }, { kind: "tool", id: "c", turnId: "t", item: { type: "commandExecution", id: "c", command: "git diff" } }, exited], {
      user: "Me",
      assistant: "Eva",
      from: (n) => `From ${n}`,
      to: (n) => `To ${n}`,
      review: "Review",
      reviewTarget: "Review of",
      plan: "Plan",
    });
    expect(md).toBe("# Eva\n\n## Me\n\nhi\n\n- `git diff`\n\n## Review\n\n- [P1] bug\n");
  });
});

describe("IPC allowlists", () => {
  it("main and preload expose the same methods, covering every new one", () => {
    const list = (file: string, marker: string) => {
      const src = readFileSync(join(__dirname, "..", "src", file), "utf8");
      const at = src.indexOf(marker) + marker.length;
      const block = src.slice(at, src.indexOf("]", at));
      return new Set([...block.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!));
    };
    const main = list("main/index.ts", "new Set<InvokeMethod>([");
    const preload = list("preload/index.ts", "const METHODS: InvokeMethod[] = [");
    expect([...main].sort()).toEqual([...preload].sort());
    for (const m of ["threadGoal", "setThreadGoal", "clearThreadGoal", "startReview", "collaborationModes", "setMemoryMode", "resetMemory", "experimentalFeatures", "setExperimentalFeature", "saveMarkdown", "pickImages", "forkSession", "deleteSession", "hosts", "sshConfigHosts", "addSshHost", "pairSshHost", "updateSshHost", "removeSshHost", "switchHost", "reconnectHost", "testHost", "setHostStartOn", "browseDirs"]) expect(main.has(m), m).toBe(true);
  });
});
